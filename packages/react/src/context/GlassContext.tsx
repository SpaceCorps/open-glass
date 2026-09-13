import React, {
  createContext,
  useContext,
  useEffect,
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

export interface GlassContextValue {
  engine: GlassEngine | null;
  registerElement: (descriptor: GlassQuadDescriptor) => void;
  updateElement: (id: string | number, descriptor: Partial<GlassQuadDescriptor>) => void;
  unregisterElement: (id: string | number) => void;
  /** Whether the GPU engine has a valid background texture source active. */
  hasBackgroundSource: boolean;
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
}

export const GlassProvider: React.FC<GlassProviderProps> = ({
  children,
  config,
  className,
  style,
  underlyingRef,
  captureUnderlying = false,
  captureFps = 30,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<GlassEngine | null>(null);
  const elementsRef = useRef<Map<string | number, GlassQuadDescriptor>>(new Map());
  const rafRef = useRef<number | null>(null);
  const registeredUnderlyingRef = useRef<HTMLElement | null>(null);
  const [pipeline, setPipeline] = useState<DomCapturePipeline | null>(null);
  const [hasBackgroundSource, setHasBackgroundSource] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let activeEngine: GlassEngine | null = null;

    createGlassEngine(canvas, config)
      .then((eng) => {
        if (!active) {
          eng.destroy();
          return;
        }
        activeEngine = eng;
        setEngine(eng);
      })
      .catch((err) => {
        console.error("[open-glass] Failed to initialize GlassEngine:", err);
      });

    const handleResize = () => {
      if (!canvas || !activeEngine) return;
      const width = canvas.parentElement?.clientWidth ?? window.innerWidth;
      const height = canvas.parentElement?.clientHeight ?? window.innerHeight;
      activeEngine.resize(width, height);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      active = false;
      window.removeEventListener("resize", handleResize);
      if (activeEngine) {
        activeEngine.destroy();
      }
      setEngine(null);
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
    const newPipeline = new DomCapturePipeline(targetEl, { fps: captureFps });
    setPipeline(newPipeline);

    return () => {
      newPipeline.destroy();
      setPipeline(null);
      setHasBackgroundSource(false);
    };
  }, [captureUnderlying, captureFps, underlyingRef]);

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

    const renderLoop = () => {
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
          .catch(() => {
            // Silently handle capture error or cancellation
          })
          .finally(() => {
            isCapturing = false;
          });
      }

      const quads = Array.from(elementsRef.current.values());
      engine.updateQuads(quads);
      engine.render();
      rafRef.current = requestAnimationFrame(renderLoop);
    };

    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [engine, pipeline, captureUnderlying]);

  const registerElement = (descriptor: GlassQuadDescriptor) => {
    elementsRef.current.set(descriptor.id, descriptor);
  };

  const updateElement = (id: string | number, partial: Partial<GlassQuadDescriptor>) => {
    const existing = elementsRef.current.get(id);
    if (existing) {
      elementsRef.current.set(id, { ...existing, ...partial });
    }
  };

  const unregisterElement = (id: string | number) => {
    elementsRef.current.delete(id);
  };

  const registerUnderlying = (element: HTMLElement | null) => {
    registeredUnderlyingRef.current = element;
    if (pipeline) {
      if (element) {
        pipeline.attach(element);
      } else {
        pipeline.detach();
        setHasBackgroundSource(false);
      }
    }
  };

  const isBgActive = hasBackgroundSource || (engine?.hasBackgroundSource() ?? false);

  return (
    <GlassContext.Provider
      value={{
        engine,
        registerElement,
        updateElement,
        unregisterElement,
        hasBackgroundSource: isBgActive,
        registerUnderlying,
        capturePipeline: pipeline,
      }}
    >
      <div
        className={`open-glass-container ${className ?? ""}`}
        style={{
          position: "relative",
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
            zIndex: 0,
          }}
        />
        <div
          className="open-glass-content"
          style={{
            position: "relative",
            zIndex: 1,
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
