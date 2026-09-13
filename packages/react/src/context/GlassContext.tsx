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
  type GlassEngine,
  type GlassEngineConfig,
  type GlassQuadDescriptor,
} from "@open-glass/core";

export interface GlassContextValue {
  engine: GlassEngine | null;
  registerElement: (descriptor: GlassQuadDescriptor) => void;
  updateElement: (id: string | number, descriptor: Partial<GlassQuadDescriptor>) => void;
  unregisterElement: (id: string | number) => void;
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
}

export const GlassProvider: React.FC<GlassProviderProps> = ({
  children,
  config,
  className,
  style,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<GlassEngine | null>(null);
  const elementsRef = useRef<Map<string | number, GlassQuadDescriptor>>(new Map());
  const rafRef = useRef<number | null>(null);

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

  // GPU Synchronized Render Loop
  useEffect(() => {
    if (!engine) return;

    const renderLoop = () => {
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
  }, [engine]);

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

  return (
    <GlassContext.Provider
      value={{
        engine,
        registerElement,
        updateElement,
        unregisterElement,
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
