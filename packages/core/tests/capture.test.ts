/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createGlassEngine, DomCapturePipeline, ensureXhtmlNamespace } from "../src/ts/index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("packages/core DomCapturePipeline and texture ingestion", () => {
  it("initializes pipeline, attaches observers, and marks dirty state on DOM mutations", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<h1>Hello Glass</h1><p>Underlying content</p>";
    document.body.appendChild(container);

    const pipeline = new DomCapturePipeline(container, { fps: 30 });
    expect(pipeline.targetElement).toBe(container);
    expect(pipeline.isDirty).toBe(true);

    // Capture element
    const canvas = await pipeline.captureElement(container);
    expect(canvas).toBeDefined();

    // Mark dirty via mutation
    const child = document.createElement("span");
    child.textContent = "New mutation";
    container.appendChild(child);

    pipeline.invalidate();
    expect(pipeline.isDirty).toBe(true);

    pipeline.destroy();
    expect(pipeline.targetElement).toBeNull();
    document.body.removeChild(container);
  });

  it("handles invalidate, attach, detach, and setFps", () => {
    const container1 = document.createElement("div");
    const container2 = document.createElement("div");

    const pipeline = new DomCapturePipeline(null, { fps: 20 });
    expect(pipeline.frameInterval).toBe(50);

    pipeline.setFps(60);
    expect(Math.round(pipeline.frameInterval)).toBe(17);

    pipeline.attach(container1);
    expect(pipeline.targetElement).toBe(container1);

    pipeline.attach(container2);
    expect(pipeline.targetElement).toBe(container2);

    pipeline.detach();
    expect(pipeline.targetElement).toBeNull();

    pipeline.invalidate();
    expect(pipeline.isDirty).toBe(true);

    pipeline.destroy();
  });

  it("captures element using captureElement with fallback in jsdom", async () => {
    const el = document.createElement("section");
    el.style.width = "400px";
    el.style.height = "200px";
    el.innerHTML = "<p>Refracted text content</p>";
    document.body.appendChild(el);

    const pipeline = new DomCapturePipeline(el);
    const result = await pipeline.capture();
    expect(result).toBeDefined();

    pipeline.destroy();
    document.body.removeChild(el);
  });

  it("engine.updateBackgroundSource accepts canvas/image source and sets hasBackgroundSource === true", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;

    const mockGl = {
      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      deleteTexture: vi.fn(),
    };

    canvas.getContext = vi.fn().mockImplementation((contextId) => {
      if (contextId === "webgl2") {
        return mockGl as any;
      }
      return null;
    });

    const engine = await createGlassEngine(canvas, {
      backend: "webgl2",
      width: 400,
      height: 300,
    });

    expect(engine.hasBackgroundSource()).toBe(false);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 400;
    sourceCanvas.height = 300;

    engine.updateBackgroundSource(sourceCanvas);
    expect(engine.hasBackgroundSource()).toBe(true);

    // Accepting a source is not the same as being able to refract it. The mock context is not a real
    // WebGl2RenderingContext, so the Rust renderer never came up and there is nothing to composite.
    expect(engine.isRenderReady?.() ?? false).toBe(false);

    // Nothing on the JS side uploads a texture any more: `WebGl2Renderer` owns the background texture,
    // and the old `texImage2D` fallback wrote into a JS texture no sampler ever read. Its absence is
    // asserted rather than merely unmentioned, so reintroducing the dead upload fails here.
    expect(mockGl.texImage2D).not.toHaveBeenCalled();
    expect(mockGl.createTexture).not.toHaveBeenCalled();

    // Calling render with background source active
    engine.render();
    expect(mockGl.clear).toHaveBeenCalled();

    engine.destroy();
    expect(engine.hasBackgroundSource()).toBe(false);
    expect(mockGl.deleteTexture).not.toHaveBeenCalled();
  });
});

describe("foreignObject XHTML namespace", () => {
  it("wraps a namespaced HTML root inside the foreignObject markup", () => {
    const el = document.createElement("div");
    el.className = "underlying";
    el.innerHTML = "<p>Refracted</p>";
    document.body.appendChild(el);

    const pipeline = new DomCapturePipeline(el);
    const markup = pipeline.buildSvgMarkup(el, 100, 50);

    expect(markup).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">');
    expect(markup).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(markup).toMatch(
      /<foreignObject width="100%" height="100%"><div[^>]*xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/,
    );
    expect(markup.endsWith("</foreignObject></svg>")).toBe(true);

    pipeline.destroy();
    document.body.removeChild(el);
  });

  it("injects the XHTML namespace exactly once, whatever the serializer emitted", () => {
    const alreadyNamespaced = '<div xmlns="http://www.w3.org/1999/xhtml" class="x"><p>Hi</p></div>';
    expect(ensureXhtmlNamespace(alreadyNamespaced)).toBe(alreadyNamespaced);
    expect(ensureXhtmlNamespace(alreadyNamespaced).match(/xmlns=/g)).toHaveLength(1);

    const bare = '<div class="x"><p>Hi</p></div>';
    const injected = ensureXhtmlNamespace(bare);
    expect(injected).toBe('<div class="x" xmlns="http://www.w3.org/1999/xhtml"><p>Hi</p></div>');
    expect(injected.match(/xmlns=/g)).toHaveLength(1);
    expect(ensureXhtmlNamespace(injected)).toBe(injected);

    // Self-closing roots keep their slash.
    expect(ensureXhtmlNamespace('<img src="a.png" />')).toBe(
      '<img src="a.png" xmlns="http://www.w3.org/1999/xhtml" />',
    );
  });
});

describe("capture failure handling", () => {
  const attachedElement = () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>content</p>";
    document.body.appendChild(el);
    return el;
  };

  it("keeps dirty set on failure and backs off instead of retrying every frame", async () => {
    const el = attachedElement();
    const onError = vi.fn();
    const pipeline = new DomCapturePipeline(el, {
      fps: 60,
      maxFailures: 3,
      maxBackoffMs: 1000,
      onError,
    });

    const captureSpy = vi
      .spyOn(pipeline, "captureElement")
      .mockRejectedValue(new Error("rasterization failed"));

    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    const firstResult = await pipeline.capture();
    expect(firstResult).toBeNull();
    // Still dirty: nothing was captured, so the target remains unrepresented and a later attempt must
    // be allowed through. Clearing it made the first failure permanent, because `capture()` returns the
    // cached frame early on `!dirty`.
    expect(pipeline.isDirty).toBe(true);
    expect(pipeline.failureCount).toBe(1);

    const totalCalls = 60;
    for (let i = 1; i < totalCalls; i += 1) {
      clock += 5;
      await expect(pipeline.capture()).resolves.toBeNull();
    }

    // Bounded: the pipeline stops attempting once maxFailures consecutive failures are reached.
    expect(pipeline.failureCount).toBe(3);
    expect(pipeline.isFailing).toBe(true);
    expect(captureSpy).toHaveBeenCalledTimes(3);
    expect(captureSpy.mock.calls.length).toBeLessThan(totalCalls);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), 3);
    expect((pipeline.lastCaptureError as Error).message).toBe("rasterization failed");
    // Bounded by the circuit breaker, not by dropping the dirty flag: the work is still outstanding.
    expect(pipeline.isDirty).toBe(true);

    pipeline.destroy();
    document.body.removeChild(el);
  });

  it("rejects when the foreignObject raster fails to load instead of resolving a blank canvas", async () => {
    const el = attachedElement();
    const pipeline = new DomCapturePipeline(el, { fps: 60 });

    // jsdom never loads an image, so neither handler fires on its own: stand in an Image whose `src`
    // setter reports the failure the real browser reports when the SVG payload cannot be decoded.
    const OriginalImage = globalThis.Image;
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      set src(_value: string) {
        this.onerror?.(new Event("error"));
      }
    }
    (globalThis as any).Image = FailingImage;

    try {
      // Used to resolve an OffscreenCanvas that had never been drawn into — truthy, uploaded as an
      // all-zero texture, and indistinguishable from a good frame to every caller.
      await expect(pipeline.captureElement(el)).rejects.toThrow(
        /foreignObject raster did not load/,
      );

      const result = await pipeline.capture();
      expect(result).toBeNull();
      expect(pipeline.failureCount).toBe(1);
      expect(pipeline.lastCaptureError).toBeInstanceOf(Error);
      expect(pipeline.isDirty).toBe(true);
    } finally {
      (globalThis as any).Image = OriginalImage;
      pipeline.destroy();
      document.body.removeChild(el);
    }
  });

  it("invalidate() resets the failure backoff so a real DOM change gets a fresh attempt", async () => {
    const el = attachedElement();
    const pipeline = new DomCapturePipeline(el, { fps: 60, maxFailures: 2, maxBackoffMs: 1000 });

    const captureSpy = vi
      .spyOn(pipeline, "captureElement")
      .mockRejectedValue(new Error("rasterization failed"));

    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    for (let i = 0; i < 40; i += 1) {
      await pipeline.capture();
      clock += 5;
    }
    expect(pipeline.isFailing).toBe(true);
    const failedAttempts = captureSpy.mock.calls.length;

    pipeline.invalidate();
    expect(pipeline.failureCount).toBe(0);
    expect(pipeline.isFailing).toBe(false);
    expect(pipeline.lastCaptureError).toBeNull();
    expect(pipeline.isDirty).toBe(true);

    const canvas = document.createElement("canvas");
    captureSpy.mockResolvedValue(canvas);
    await expect(pipeline.capture()).resolves.toBe(canvas);
    expect(captureSpy.mock.calls.length).toBe(failedAttempts + 1);
    expect(pipeline.failureCount).toBe(0);

    pipeline.destroy();
    document.body.removeChild(el);
  });
});
