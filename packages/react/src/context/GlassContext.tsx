import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  assignBands,
  AUTO_BACKDROP_DEPTH,
  bandDepth,
  compositeBand,
  createGlassEngine,
  DomCapturePipeline,
  MAX_BACKDROP_BANDS,
  type BackdropLayer,
  type GlassEngine,
  type GlassEngineConfig,
  type GlassQuadDescriptor,
} from "@open-glass/core";
import { GLASS_Z_CANVAS } from "../layers";

interface RegisteredElement {
  descriptor: GlassQuadDescriptor;
  element: HTMLElement | null;
}

/** One registered content layer: its declared depth, its own capture pipeline, and its last raster. */
interface RegisteredLayer {
  /** Stable across re-registrations, so a band's membership can be compared between frames. */
  id: number;
  depth: number;
  /** Null while capture is off — the layer stays registered, it just has nothing rasterizing it. */
  pipeline: DomCapturePipeline | null;
  raster: BackdropLayer["raster"];
  rect: BackdropLayer["rect"];
  /** Set when a capture lands, cleared once the band holding this layer has been re-uploaded. */
  dirty: boolean;
}

/** Options a content layer registers itself with. */
export interface RegisterUnderlyingOptions {
  /** Pixels behind the glass. Omitted, the shader uses the depth calibrated from the panel's size. */
  depth?: number;
}

export interface GlassContextValue {
  engine: GlassEngine | null;
  /**
   * Register a quad. Passing the backing node lets the provider re-measure geometry every frame
   * without a React render, which is what keeps a dragged or animated panel's quad in step.
   */
  registerElement: (descriptor: GlassQuadDescriptor, element?: HTMLElement | null) => void;
  updateElement: (id: string | number, descriptor: Partial<GlassQuadDescriptor>) => void;
  unregisterElement: (id: string | number) => void;
  /** Whether the GPU engine has a valid background texture source active. */
  hasBackgroundSource: boolean;
  /**
   * Whether the renderer is actually compositing pixels. Components key their CSS fallback off
   * this, never off `hasBackgroundSource` — an uploaded texture is not a drawn frame.
   */
  isRenderReady: boolean;
  /** The provider's layer container. Quad geometry is measured relative to it. */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Register an underlying HTML element to be captured by the DOM pipeline.
   *
   * Each registered element becomes its own depth band, ordered by `options.depth` — pixels behind the
   * glass — so a card floating just under a panel parallaxes less than the wallpaper behind it. Passing
   * `null` keeps its old meaning of clearing every layer.
   */
  registerUnderlying?: (element: HTMLElement | null, options?: RegisterUnderlyingOptions) => void;
  /** Stop capturing one registered layer, e.g. when the component holding it unmounts. */
  unregisterUnderlying?: (element: HTMLElement) => void;
  /**
   * The DOM capture pipeline of the *first* registered layer, if any.
   *
   * A single pipeline is no longer the whole picture — there is one per content layer — so this is a
   * compatibility handle for consumers that only ever had one layer to look at.
   */
  capturePipeline?: DomCapturePipeline | null;
}

export const GlassContext = createContext<GlassContextValue | null>(null);

export function useGlassContext(): GlassContextValue {
  const ctx = useContext(GlassContext);
  if (!ctx) {
    throw new Error("useGlassContext must be used within a <GlassProvider>");
  }
  return ctx;
}

export interface GlassProviderProps {
  children: ReactNode;
  config?: GlassEngineConfig;
  className?: string;
  style?: CSSProperties;
  /** Optional ref pointing to an underlying HTML element to capture and refract. */
  underlyingRef?: React.RefObject<HTMLElement | null>;
  /** Enable real-time DOM capture of the underlying layer. Defaults to false. */
  captureUnderlying?: boolean;
  /** Target frame rate for the DOM capture pipeline. Defaults to 30. */
  captureFps?: number;
  /** Notified when DOM capture fails. Failures are also warned about on the console. */
  onCaptureError?: (error: unknown) => void;
}

export const GlassProvider: React.FC<GlassProviderProps> = ({
  children,
  config,
  className,
  style,
  underlyingRef,
  captureUnderlying = false,
  captureFps = 30,
  onCaptureError,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [engine, setEngine] = useState<GlassEngine | null>(null);
  const elementsRef = useRef<Map<string | number, RegisteredElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const layersRef = useRef<Map<HTMLElement, RegisteredLayer>>(new Map());
  const nextLayerIdRef = useRef(0);
  const bandCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  // What each band held at its last upload: member ids, depths and rects. A band has to be
  // re-composited whenever any of those change, not only when a member captured new pixels — an
  // unmounted far layer promotes the near one into band 0, and a dragged layer needs redrawing at its
  // new rect, and in neither case does a single raster differ from the frame before.
  const bandSignaturesRef = useRef<string[]>([]);
  const uploadedBandCountRef = useRef(0);
  /** The drawing-buffer size the band canvases were last sized to. */
  const bandSizeRef = useRef("");
  const [firstPipeline, setFirstPipeline] = useState<DomCapturePipeline | null>(null);
  const [hasBackgroundSource, setHasBackgroundSource] = useState(false);
  const [isRenderReady, setIsRenderReady] = useState(false);
  // Read by `registerUnderlying`, which children call from their own effects — before the provider's
  // effects have run — so the current values have to be readable without waiting for one.
  const captureFpsRef = useRef(captureFps);
  const captureUnderlyingRef = useRef(captureUnderlying);

  // Held in a ref so a new callback identity never re-creates the capture pipeline.
  const onCaptureErrorRef = useRef(onCaptureError);
  useEffect(() => {
    onCaptureErrorRef.current = onCaptureError;
  }, [onCaptureError]);

  const reportCaptureError = useCallback((err: unknown) => {
    console.warn("[open-glass] DOM capture failed:", err);
    onCaptureErrorRef.current?.(err);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let activeEngine: GlassEngine | null = null;

    const measureContainer = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      // An explicit zero check, not `??`: a collapsed container reports 0, which is a perfectly
      // defined number, so `??` would never fire and the canvas would stay 0x0 forever.
      const width = rect && rect.width > 0 ? rect.width : window.innerWidth;
      const height = rect && rect.height > 0 ? rect.height : window.innerHeight;
      return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
    };

    const handleResize = () => {
      if (!activeEngine) return;
      const { width, height } = measureContainer();
      activeEngine.resize(width, height);
    };

    createGlassEngine(canvas, config)
      .then((eng) => {
        if (!active) {
          eng.destroy();
          return;
        }
        activeEngine = eng;
        setEngine(eng);
        // Size once up front: the container may not have been laid out at mount.
        handleResize();
      })
      .catch((err) => {
        console.error("[open-glass] Failed to initialize GlassEngine:", err);
      });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            handleResize();
          })
        : null;
    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      if (activeEngine) {
        activeEngine.destroy();
      }
      setEngine(null);
      setIsRenderReady(false);
    };
  }, [config]);

  /** One pipeline per layer, wired the way the single pipeline was: first failure and give-up only. */
  const createPipeline = useCallback(
    (element: HTMLElement) => {
      const pipeline: DomCapturePipeline = new DomCapturePipeline(element, {
        fps: captureFpsRef.current,
        onError: (err, failureCount) => {
          if (failureCount === 1 || pipeline.isFailing) {
            reportCaptureError(err);
          }
        },
      });
      return pipeline;
    },
    [reportCaptureError],
  );

  /** `capturePipeline` exposes the first layer's pipeline; recompute it whenever the set changes. */
  const syncFirstPipeline = useCallback(() => {
    const first = layersRef.current.values().next().value;
    setFirstPipeline(first?.pipeline ?? null);
  }, []);

  const registerUnderlying = useCallback(
    (element: HTMLElement | null, options?: RegisterUnderlyingOptions) => {
      if (!element) {
        // Historic meaning of a null element: forget every layer.
        for (const layer of layersRef.current.values()) {
          layer.pipeline?.destroy();
        }
        layersRef.current.clear();
        syncFirstPipeline();
        return;
      }

      const depth = options?.depth ?? AUTO_BACKDROP_DEPTH;
      const existing = layersRef.current.get(element);
      if (existing) {
        // A depth change moves the layer between bands without changing a pixel of its raster, so it
        // has to be announced as dirty or the render loop would keep the old band content.
        if (existing.depth !== depth) {
          existing.depth = depth;
          existing.dirty = true;
        }
        return;
      }

      layersRef.current.set(element, {
        id: nextLayerIdRef.current++,
        depth,
        pipeline: captureUnderlyingRef.current ? createPipeline(element) : null,
        raster: null,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        dirty: false,
      });
      syncFirstPipeline();
    },
    [createPipeline, syncFirstPipeline],
  );

  const unregisterUnderlying = useCallback(
    (element: HTMLElement) => {
      const layer = layersRef.current.get(element);
      if (!layer) return;
      layer.pipeline?.destroy();
      layersRef.current.delete(element);
      syncFirstPipeline();
    },
    [syncFirstPipeline],
  );

  // Own the pipelines: created while capture is on, destroyed the moment it goes off or we unmount.
  useEffect(() => {
    captureFpsRef.current = captureFps;
    captureUnderlyingRef.current = captureUnderlying;

    if (!captureUnderlying) {
      for (const layer of layersRef.current.values()) {
        layer.pipeline?.destroy();
        layer.pipeline = null;
        layer.raster = null;
      }
      // The bands themselves are released by the render loop, which is where the engine lives.
      syncFirstPipeline();
      return;
    }

    for (const [element, layer] of layersRef.current) {
      if (layer.pipeline) {
        layer.pipeline.setFps(captureFps);
      } else {
        layer.pipeline = createPipeline(element);
        // A layer that registered while capture was off has nothing on the GPU yet.
        layer.dirty = false;
      }
    }
    syncFirstPipeline();

    return () => {
      for (const layer of layersRef.current.values()) {
        layer.pipeline?.destroy();
        layer.pipeline = null;
      }
    };
  }, [captureUnderlying, captureFps, createPipeline, syncFirstPipeline]);

  // The provider-level `underlyingRef` is just another layer, at the calibrated default depth.
  useEffect(() => {
    const element = underlyingRef?.current;
    if (!element) return;
    registerUnderlying(element);
    return () => {
      unregisterUnderlying(element);
    };
  }, [underlyingRef, registerUnderlying, unregisterUnderlying]);

  // GPU Synchronized Render Loop with DOM Capture
  useEffect(() => {
    if (!engine) return;

    const capturing = new Set<HTMLElement>();

    /**
     * Re-measure every registered quad and content layer against the container. This is what makes a
     * moving panel's glass follow it: `getBoundingClientRect` already accounts for scroll and CSS
     * transforms, and measuring here means geometry no longer depends on React re-rendering the
     * provider. Layer rects are measured in the same pass and the same coordinates, because that is
     * what places each layer's raster inside its band canvas.
     */
    const syncGeometry = () => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      for (const entry of elementsRef.current.values()) {
        const element = entry.element;
        if (!element || !element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        entry.descriptor = {
          ...entry.descriptor,
          x: rect.left - (containerRect?.left ?? 0),
          y: rect.top - (containerRect?.top ?? 0),
          width: rect.width,
          height: rect.height,
        };
      }
      for (const [element, layer] of layersRef.current) {
        if (!element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        layer.rect = {
          x: rect.left - (containerRect?.left ?? 0),
          y: rect.top - (containerRect?.top ?? 0),
          width: rect.width,
          height: rect.height,
        };
      }
    };

    /** Kick off a capture for every layer that has new pixels and is not already busy. */
    const captureLayers = () => {
      for (const [element, layer] of layersRef.current) {
        const pipeline = layer.pipeline;
        if (!pipeline || !pipeline.targetElement || capturing.has(element)) continue;
        if (!pipeline.isDirty) continue;
        capturing.add(element);
        pipeline
          .capture()
          .then((captured) => {
            if (captured) {
              layer.raster = captured;
              layer.dirty = true;
            }
          })
          .catch((err) => {
            // capture() resolves on rasterization failure, so reaching here means something
            // unexpected broke — never swallow it.
            reportCaptureError(err);
          })
          .finally(() => {
            capturing.delete(element);
          });
      }
    };

    /** The band canvas for `band`, sized to the GPU canvas' drawing buffer. */
    const bandCanvas = (band: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      let target = bandCanvasesRef.current[band];
      if (!target) {
        target = document.createElement("canvas");
        bandCanvasesRef.current[band] = target;
      }
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
      return target;
    };

    /** Drop every band from `first` up: they hold content that is no longer on the page. */
    const releaseBandsFrom = (first: number) => {
      if (first === uploadedBandCountRef.current) return;
      engine.releaseBackdropBandsFrom(first);
      bandSignaturesRef.current.length = first;
      uploadedBandCountRef.current = first;
    };

    /**
     * Group the layers into depth bands and upload the ones that changed.
     *
     * A band is re-composited only when its membership, a member's placement or a member's raster
     * changed, so a static scene uploads nothing at all — the per-pipeline `isDirty` gate is what makes
     * the whole loop free when the page is still.
     */
    const uploadBands = () => {
      const canvas = canvasRef.current;
      const size = canvas ? `${canvas.width}x${canvas.height}` : "";
      if (size !== bandSizeRef.current) {
        // Resizing a canvas clears it, and every raster inside it was drawn for the old size.
        bandSizeRef.current = size;
        bandSignaturesRef.current = [];
      }

      const layers = Array.from(layersRef.current.values());
      const bands = assignBands(layers, MAX_BACKDROP_BANDS);
      const groups: RegisteredLayer[][] = [];
      bands.forEach((band, index) => {
        (groups[band] ??= []).push(layers[index]);
      });

      groups.forEach((members, band) => {
        const signature = members
          .map(
            (member) =>
              `${member.id}@${member.depth}:${member.rect.x},${member.rect.y},${member.rect.width},${member.rect.height}`,
          )
          .join("|");
        const moved = signature !== bandSignaturesRef.current[band];
        const captured = members.some((member) => member.dirty);
        if (!moved && !captured) return;
        // Nothing has rasterized yet: uploading an empty band now would only clear the glass.
        if (!members.some((member) => member.raster)) return;

        const target = bandCanvas(band);
        if (!target || !compositeBand(target, members)) return;
        engine.updateBackdropBand(
          band,
          target,
          bandDepth(members.map((member) => member.depth)),
        );
        bandSignaturesRef.current[band] = signature;
        for (const member of members) {
          member.dirty = false;
        }
      });

      releaseBandsFrom(groups.length);

      const hasBands = groups.length > 0;
      setHasBackgroundSource((previous) => (previous === hasBands ? previous : hasBands));
    };

    const renderLoop = () => {
      syncGeometry();

      if (captureUnderlying) {
        captureLayers();
        uploadBands();
      } else {
        // Capture is off: the pipelines are already gone, and so must be the bands they filled.
        releaseBandsFrom(0);
        setHasBackgroundSource((previous) => (previous ? false : previous));
      }

      const quads = Array.from(elementsRef.current.values(), (entry) => entry.descriptor);
      engine.updateQuads(quads);
      engine.render();

      const renderReady = engine.isRenderReady?.() ?? false;
      // Only flip state on an actual change; assigning every frame would render every frame.
      setIsRenderReady((previous) => (previous === renderReady ? previous : renderReady));

      rafRef.current = requestAnimationFrame(renderLoop);
    };

    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [engine, captureUnderlying, reportCaptureError]);

  const registerElement = useCallback(
    (descriptor: GlassQuadDescriptor, element?: HTMLElement | null) => {
      const existing = elementsRef.current.get(descriptor.id);
      elementsRef.current.set(descriptor.id, {
        descriptor,
        element: element ?? existing?.element ?? null,
      });
    },
    [],
  );

  const updateElement = useCallback(
    (id: string | number, partial: Partial<GlassQuadDescriptor>) => {
      const existing = elementsRef.current.get(id);
      if (existing) {
        elementsRef.current.set(id, {
          ...existing,
          descriptor: { ...existing.descriptor, ...partial },
        });
      }
    },
    [],
  );

  const unregisterElement = useCallback((id: string | number) => {
    elementsRef.current.delete(id);
  }, []);

  const isBgActive = hasBackgroundSource || (engine?.hasBackgroundSource() ?? false);

  const contextValue = useMemo<GlassContextValue>(
    () => ({
      engine,
      registerElement,
      updateElement,
      unregisterElement,
      hasBackgroundSource: isBgActive,
      isRenderReady,
      containerRef,
      registerUnderlying,
      unregisterUnderlying,
      capturePipeline: firstPipeline,
    }),
    [
      engine,
      registerElement,
      updateElement,
      unregisterElement,
      isBgActive,
      isRenderReady,
      registerUnderlying,
      unregisterUnderlying,
      firstPipeline,
    ],
  );

  return (
    <GlassContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={`open-glass-container ${className ?? ""}`}
        style={{
          position: "relative",
          // Keeps the three-layer stacking model self-contained; see ../layers.ts.
          isolation: "isolate",
          width: "100%",
          height: "100%",
          minHeight: "100%",
          ...style,
        }}
      >
        <canvas
          ref={canvasRef}
          className="open-glass-canvas"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: GLASS_Z_CANVAS,
          }}
        />
        <div
          className="open-glass-content"
          style={{
            // Deliberately no zIndex: a stacking context here would trap the canvas below every
            // one of this wrapper's descendants, including the underlying layer it must cover.
            position: "relative",
            width: "100%",
            height: "100%",
          }}
        >
          {children}
        </div>
      </div>
    </GlassContext.Provider>
  );
};
