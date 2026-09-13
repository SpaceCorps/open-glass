import React, { forwardRef, type CanvasHTMLAttributes } from "react";

export interface GlassCanvasProps extends CanvasHTMLAttributes<HTMLCanvasElement> {
  className?: string;
}

/**
 * Underlay/overlay HTML canvas element managed by the provider that paints GPU optical passes
 * while remaining transparent to pointer events.
 */
export const GlassCanvas = forwardRef<HTMLCanvasElement, GlassCanvasProps>(
  ({ className, style, ...rest }, ref) => {
    return (
      <canvas
        ref={ref}
        className={`open-glass-canvas ${className ?? ""}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          ...style,
        }}
        {...rest}
      />
    );
  },
);

GlassCanvas.displayName = "GlassCanvas";
