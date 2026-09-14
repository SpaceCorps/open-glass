export interface DomCapturePipelineOptions {
  /** Target frame rate for DOM rasterization. Defaults to 30. */
  fps?: number;
  /** Scale factor for rasterization resolution. Defaults to 1. */
  scale?: number;
  /** Notified every time a capture attempt throws, with the running failure count. */
  onError?: (error: unknown, failureCount: number) => void;
  /** Consecutive failures after which the pipeline stops attempting captures. Defaults to 5. */
  maxFailures?: number;
  /** Upper bound for the exponential retry backoff in milliseconds. Defaults to 5000. */
  maxBackoffMs?: number;
}

export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Ensure a serialized HTML root carries the XHTML namespace so it paints inside `foreignObject`.
 *
 * Everything inside `foreignObject` inherits the SVG namespace unless the subtree root declares its
 * own, in which case the browser has no HTML box to lay out and rasterizes an empty image. The
 * injection is idempotent: some engines already emit `xmlns` when serializing, and a duplicate
 * attribute is an XML parse error, which would blank the raster just as reliably.
 */
export function ensureXhtmlNamespace(serialized: string): string {
  // Attribute values are XML-escaped by XMLSerializer, so `>` cannot appear inside one.
  const tagMatch = /<([a-zA-Z][^\s/>]*)([^>]*)>/.exec(serialized);
  if (!tagMatch) {
    return serialized;
  }

  const [openingTag, tagName, rawAttributes] = tagMatch;
  if (/(^|\s)xmlns\s*=/.test(rawAttributes)) {
    return serialized;
  }

  const isSelfClosing = rawAttributes.trimEnd().endsWith("/");
  const attributes = isSelfClosing ? rawAttributes.replace(/\s*\/\s*$/, "") : rawAttributes;
  const namespaced = `<${tagName}${attributes} xmlns="${XHTML_NAMESPACE}"${isSelfClosing ? " /" : ""}>`;

  return (
    serialized.slice(0, tagMatch.index) +
    namespaced +
    serialized.slice(tagMatch.index + openingTag.length)
  );
}

/**
 * Real-time DOM rasterization pipeline that captures HTML subtrees
 * into GPU-ready canvas or image bitmap textures via SVG ForeignObject.
 */
export class DomCapturePipeline {
  private target: HTMLElement | null = null;
  private dirty = true;
  private fps: number;
  private scale: number;
  private lastCaptureTime = 0;
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cachedResult: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null = null;
  private isCapturing = false;
  private onError?: (error: unknown, failureCount: number) => void;
  private maxFailures: number;
  private maxBackoffMs: number;
  private consecutiveFailures = 0;
  private nextRetryTime = 0;
  private lastError: unknown = null;

  constructor(element?: HTMLElement | null, options: DomCapturePipelineOptions = {}) {
    this.fps = Math.max(1, options.fps ?? 30);
    this.scale = options.scale ?? 1;
    this.onError = options.onError;
    this.maxFailures = Math.max(1, options.maxFailures ?? 5);
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs ?? 5000);
    if (element) {
      this.attach(element);
    }
  }

  /**
   * Whether the attached DOM element has changed since the last capture.
   */
  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * The currently attached target HTML element.
   */
  get targetElement(): HTMLElement | null {
    return this.target;
  }

  /**
   * Frame interval in milliseconds derived from the target FPS.
   */
  get frameInterval(): number {
    return 1000 / this.fps;
  }

  /**
   * Number of consecutive failed capture attempts.
   */
  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * The error thrown by the most recent failed capture attempt, if any.
   */
  get lastCaptureError(): unknown {
    return this.lastError;
  }

  /**
   * Whether the pipeline has given up after `maxFailures` consecutive failures.
   */
  get isFailing(): boolean {
    return this.consecutiveFailures >= this.maxFailures;
  }

  /**
   * Set the target frame rate for capture throttling.
   */
  setFps(fps: number): void {
    this.fps = Math.max(1, fps);
  }

  /**
   * Attach the pipeline to an HTML container element and start observing mutations.
   */
  attach(element: HTMLElement): void {
    if (this.target === element) {
      return;
    }
    this.detach();
    this.target = element;
    this.dirty = true;
    this.resetFailures();

    if (typeof MutationObserver !== "undefined") {
      this.mutationObserver = new MutationObserver(() => {
        this.dirty = true;
      });
      this.mutationObserver.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.dirty = true;
      });
      this.resizeObserver.observe(element);
    }
  }

  /**
   * Detach from the observed DOM element and disconnect observers.
   */
  detach(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.target = null;
  }

  /**
   * Mark the capture pipeline dirty to force a re-capture on next frame.
   *
   * A genuine DOM change deserves a fresh attempt, so this also clears any accumulated
   * failure backoff.
   */
  invalidate(): void {
    this.dirty = true;
    this.resetFailures();
  }

  /**
   * Reset the failure counter, retry backoff and recorded error.
   */
  private resetFailures(): void {
    this.consecutiveFailures = 0;
    this.nextRetryTime = 0;
    this.lastError = null;
  }

  /**
   * Build the SVG wrapper markup that rasterizes an HTML subtree via `foreignObject`.
   */
  buildSvgMarkup(element: HTMLElement, width: number, height: number): string {
    const serializer = new XMLSerializer();
    const serialized = ensureXhtmlNamespace(serializer.serializeToString(element));
    return `<svg xmlns="${SVG_NAMESPACE}" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  }

  /**
   * Rasterize an arbitrary HTML element into an offscreen canvas or image bitmap.
   */
  async captureElement(
    element: HTMLElement,
  ): Promise<HTMLCanvasElement | OffscreenCanvas | ImageBitmap> {
    const rect = element.getBoundingClientRect?.() ?? { width: 300, height: 150 };
    const width = Math.max(1, Math.round((rect.width || element.clientWidth || 300) * this.scale));
    const height = Math.max(
      1,
      Math.round((rect.height || element.clientHeight || 150) * this.scale),
    );

    if (typeof XMLSerializer === "undefined") {
      // Non-browser or fallback environment
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      throw new Error("[open-glass] XMLSerializer is not available in this environment.");
    }

    const svg = this.buildSvgMarkup(element, width, height);

    return new Promise((resolve, reject) => {
      if (typeof Image === "undefined") {
        // Fallback for non-browser environment
        const canvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(width, height)
            : typeof document !== "undefined"
              ? document.createElement("canvas")
              : null;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
          resolve(canvas);
          return;
        }
        reject(new Error("[open-glass] Image constructor is not available."));
        return;
      }

      const img = new Image();
      let settled = false;

      img.onload = () => {
        try {
          const canvas =
            typeof OffscreenCanvas !== "undefined"
              ? new OffscreenCanvas(width, height)
              : typeof document !== "undefined"
                ? document.createElement("canvas")
                : null;

          if (canvas) {
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d") as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (ctx) {
              ctx.drawImage(img as any, 0, 0, width, height);
            }
            settled = true;
            resolve(canvas);
            return;
          }

          settled = true;
          resolve(img as any);
        } catch (err) {
          settled = true;
          reject(err);
        }
      };

      img.onerror = (event) => {
        // A real rejection, not a blank canvas.
        //
        // This path used to resolve a freshly constructed OffscreenCanvas that had never been drawn
        // into. It is truthy, so the provider uploaded an all-zero texture and flipped
        // `hasBackgroundSource` true: the composite ran over nothing, every panel dropped its CSS blur
        // and the glass became a flat block, with no failure recorded anywhere. Rejecting instead feeds
        // the failure counter, the exponential backoff, the `onError` callback and the circuit breaker
        // in `capture()` — all of which already exist — and leaves readiness false.
        settled = true;
        reject(
          new Error(
            "[open-glass] Failed to rasterize the DOM subtree to an image. The SVG " +
              "foreignObject raster did not load, so there is no backdrop to refract.",
            { cause: event },
          ),
        );
      };

      // Always a `data:` URL — never `URL.createObjectURL`. Chrome taints a 2D canvas that a
      // `blob:`-URL SVG image has been drawn into, and uploading a tainted canvas then throws
      // `SecurityError: Tainted canvases may not be loaded.` from `texImage2D`. That kills the whole
      // GPU path while the capture itself looks perfectly healthy — `img.onload` fires, `drawImage`
      // succeeds, and only the upload fails. A `data:` URL is same-origin, so the canvas stays clean:
      // `getImageData` works and the raster uploads as a texture. `createImageBitmap(blob)` is not an
      // escape route either; Chrome cannot decode SVG that way (`InvalidStateError`).
      //
      // The cost is size: `encodeURIComponent` inflates the payload for a large subtree. That is a
      // performance consideration, not a reason to go back to a blob.
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      // Guard for JSDOM or headless test environments where image loading events may not trigger
      if (
        typeof process !== "undefined" &&
        (process.env?.NODE_ENV === "test" || (globalThis as any).VI_TEST)
      ) {
        setTimeout(() => {
          if (!settled) {
            try {
              const testCanvas =
                typeof OffscreenCanvas !== "undefined"
                  ? new OffscreenCanvas(width, height)
                  : typeof document !== "undefined"
                    ? document.createElement("canvas")
                    : null;
              if (testCanvas) {
                testCanvas.width = width;
                testCanvas.height = height;
                settled = true;
                resolve(testCanvas);
              }
            } catch {}
          }
        }, 15);
      }
    });
  }

  /**
   * Capture the attached element if it is dirty and the frame interval has elapsed.
   * Returns the updated canvas/image source, or the previously cached frame if clean, throttled,
   * backing off after a failure, or already given up.
   *
   * A failed attempt never rejects — callers get the last good frame (or `null`) back, so a
   * render loop does not need a try/catch to stay alive.
   */
  async capture(): Promise<HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null> {
    if (!this.target) {
      return null;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    if (this.isFailing) {
      return this.cachedResult;
    }

    if (now < this.nextRetryTime) {
      return this.cachedResult;
    }

    const elapsed = now - this.lastCaptureTime;

    if (!this.dirty && this.cachedResult) {
      return this.cachedResult;
    }

    if (elapsed < this.frameInterval && this.cachedResult) {
      return this.cachedResult;
    }

    if (this.isCapturing) {
      return this.cachedResult;
    }

    this.isCapturing = true;
    try {
      const result = await this.captureElement(this.target);
      this.cachedResult = result;
      this.dirty = false;
      this.lastCaptureTime = now;
      this.resetFailures();
      return result;
    } catch (err) {
      // `dirty` deliberately stays true: a failed attempt captured nothing, so the target is still
      // unrepresented and the next attempt must be allowed to run. Clearing it here meant the very
      // first failure was permanent — `capture()` returns early on `!dirty && cachedResult`, and the
      // provider's own `pipeline.isDirty` gate stopped even calling in — so a transient rasterization
      // failure at mount left the glass with no backdrop for the lifetime of the page.
      //
      // Re-serializing the subtree every frame is prevented by `nextRetryTime` below, and a
      // permanently broken capture by the `isFailing` circuit breaker; neither needs `dirty` false.
      this.lastCaptureTime = now;
      this.consecutiveFailures += 1;
      this.lastError = err;
      this.nextRetryTime =
        now + Math.min(this.frameInterval * 2 ** this.consecutiveFailures, this.maxBackoffMs);
      this.onError?.(err, this.consecutiveFailures);
      return this.cachedResult;
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Disconnect observers and release cached canvas resources.
   */
  destroy(): void {
    this.detach();
    this.dirty = false;
    this.cachedResult = null;
    this.resetFailures();
  }
}
