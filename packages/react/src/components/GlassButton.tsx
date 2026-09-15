import React, {
  forwardRef,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";
import { useGlassElement } from "../hooks/useGlassElement";
import { glassHandoverStyle } from "../surface";

export interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  cornerRadius?: number;
  optical?: OpticalParams;
  variant?: "primary" | "secondary" | "ghost";
  glowColor?: string;
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      children,
      cornerRadius = 14,
      optical,
      variant = "primary",
      glowColor = "rgba(255, 255, 255, 0.4)",
      className,
      style,
      onPointerMove,
      onPointerLeave,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLButtonElement>({
      cornerRadius,
      optical,
    });

    const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
    const [isPressed, setIsPressed] = useState(false);

    // Same GPU handover as GlassCard / GlassWindow: the button registers a quad, so once the renderer
    // composites, keeping the CSS blur on would stack two different glass models in one scene.
    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;
    const handover = glassHandoverStyle({
      isRenderReady,
      fallbackBackground:
        variant === "primary" ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.12)",
      readyBackground:
        variant === "primary" ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.04)",
      cssBackdrop: "blur(16px)",
      transition: style?.transition ?? "transform 0.1s ease, box-shadow 0.15s ease",
    });

    const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setCoords({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      onPointerMove?.(e);
    };

    const handlePointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
      setCoords(null);
      setIsPressed(false);
      onPointerLeave?.(e);
    };

    // Merge rather than pick a winner: a caller's transform and the press scale must coexist.
    const pressScale = isPressed ? "scale(0.97)" : "scale(1)";
    const combinedTransform = style?.transform ? `${style.transform} ${pressScale}` : pressScale;

    return (
      <button
        ref={(node) => {
          elementRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={`open-glass-button ${variant} ${className ?? ""}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={() => setIsPressed(true)}
        onPointerUp={() => setIsPressed(false)}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "0.625rem 1.25rem",
          borderRadius: `${cornerRadius}px`,
          border: "1px solid rgba(255, 255, 255, 0.35)",
          ...handover,
          boxShadow: isPressed
            ? "0 2px 6px rgba(0, 0, 0, 0.15)"
            : "0 6px 20px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.08)",
          color: "#ffffff",
          fontWeight: 500,
          fontSize: "0.9375rem",
          cursor: "pointer",
          overflow: "hidden",
          userSelect: "none",
          outline: "none",
          ...style,
          // After `...style`: the caller's transform is already folded into combinedTransform and the
          // caller's transition into the handover, and spreading it last would drop the press scale
          // and the overlay cross-fade appended to them.
          transform: combinedTransform,
          transition: handover.transition,
        }}
        {...rest}
      >
        {/* Dynamic pointer tracking specular spotlight */}
        {coords && (
          <div
            style={{
              position: "absolute",
              top: `${coords.y}px`,
              left: `${coords.x}px`,
              width: "120px",
              height: "120px",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
              pointerEvents: "none",
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* Ambient top rim shine */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: `${cornerRadius}px`,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.02) 60%, transparent 100%)",
          }}
        />

        <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
      </button>
    );
  },
);

GlassButton.displayName = "GlassButton";
