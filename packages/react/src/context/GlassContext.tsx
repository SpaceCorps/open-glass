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
  createGlassEngine,
  DomCapturePipeline,
  type GlassEngine,
  type GlassEngineConfig,
  type GlassQuadDescriptor,
} from "@open-glass/core";
import { GLASS_Z_CANVAS } from "../layers";

interface RegisteredElement {
  descriptor: GlassQuadDescriptor;
  element: HTMLElement | null;
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
  /** Register an underlying HTML element to be captured by the DOM pipeline. */
  registerUnderlying?: (element: HTMLElement | null) => void;
  /** The active DOM capture pipeline instance, if enabled. */
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
  const registeredUnderlyingRef = useRef<HTMLElement | null>(null);
  const [pipeline, setPipeline] = useState<DomCapturePipeline | null>(null);
  const [hasBackgroundSource, setHasBackgroundSource] = useState(false);
  const [isRenderReady, setIsRenderReady] = useState(false);

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

  // Manage DOM Capture Pipeline
  useEffect(() => {
    if (!captureUnderlying) {
      if (pipeline) {
        pipeline.destroy();
        setPipeline(null);
        setHasBackgroundSource(false);
      }
      return;
    }

    const targetEl = underlyingRef?.current ?? registeredUnderlyingRef.current;
    const newPipeline: DomCapturePipeline = new DomCapturePipeline(targetEl, {
      fps: captureFps,
      onError: (err, failureCount) => {
        // Warn on the first failure and once the pipeline gives up, not on every attempt.
        if (failureCount === 1 || newPipeline.isFailing) {
          reportCaptureError(err);
        }
      },
    });
    setPipeline(newPipeline);

    return () => {
      newPipeline.destroy();
      setPipeline(null);
      setHasBackgroundSource(false);
    };
  }, [captureUnderlying, captureFps, underlyingRef, reportCaptureError]);

  // Keep pipeline target in sync if underlyingRef or registeredUnderlying changes
  useEffect(() => {
    if (!pipeline) return;
    const targetEl = underlyingRef?.current ?? registeredUnderlyingRef.current;
    if (targetEl && pipeline.targetElement !== targetEl) {
      pipeline.attach(targetEl);
    }
  }, [pipeline, underlyingRef]);

  // GPU Synchronized Render Loop with DOM Capture
  useEffect(() => {
    if (!engine) return;

    let isCapturing = false;

    /**
     * Re-measure every registered quad against the container. This is what makes a moving panel's
     * glass follow it: `getBoundingClientRect` already accounts for scroll and CSS transforms, and
     * measuring here means geometry no longer depends on React re-rendering the provider.
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
    };

    const renderLoop = () => {
      syncGeometry();

      if (
        pipeline &&
        captureUnderlying &&
        pipeline.targetElement &&
        !isCapturing &&
        pipeline.isDirty
      ) {
        isCapturing = true;
        pipeline
          .capture()
          .then((captured) => {
            if (captured && engine) {
              engine.updateBackgroundSource(captured);
              setHasBackgroundSource(true);
            }
          })
          .catch((err) => {
            // capture() resolves on rasterization failure, so reaching here means something
            // unexpected broke — never swallow it.
            reportCaptureError(err);
          })
          .finally(() => {
            isCapturing = false;
          });
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
  }, [engine, pipeline, captureUnderlying, reportCaptureError]);

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

  const registerUnderlying = useCallback(
    (element: HTMLElement | null) => {
      registeredUnderlyingRef.current = element;
      if (pipeline) {
        if (element) {
          pipeline.attach(element);
        } else {
          pipeline.detach();
          setHasBackgroundSource(false);
        }
      }
    },
    [pipeline],
  );

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
      capturePipeline: pipeline,
    }),
    [
      engine,
      registerElement,
      updateElement,
      unregisterElement,
      isBgActive,
      isRenderReady,
      registerUnderlying,
      pipeline,
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
