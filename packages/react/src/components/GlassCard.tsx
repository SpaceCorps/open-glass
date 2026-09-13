import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { OpticalParams } from "@open-glass/core";
import { useGlassElement } from "../hooks/useGlassElement";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  cornerRadius?: number;
  optical?: OpticalParams;
  elevation?: "flat" | "raised" | "floating";
  interactive?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      children,
      cornerRadius = 20,
      optical,
      elevation = "raised",
      interactive = false,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLDivElement>({
      cornerRadius,
      optical,
    });

    const elevationStyles: Record<string, React.CSSProperties> = {
      flat: {
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.05)",
      },
      raised: {
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)",
      },
      floating: {
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.1)",
      },
    };

    return (
      <div
        ref={(node) => {
          elementRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={`open-glass-card ${interactive ? "interactive" : ""} ${className ?? ""}`}
        style={{
          position: "relative",
          borderRadius: `${cornerRadius}px`,
          border: "1px solid rgba(255, 255, 255, 0.28)",
          background: "rgba(255, 255, 255, 0.15)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          overflow: "hidden",
          transition: interactive ? "transform 0.2s ease, box-shadow 0.2s ease" : undefined,
          ...elevationStyles[elevation],
          ...style,
        }}
        {...rest}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: `${cornerRadius}px`,
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.2) 100%)",
            mixBlendMode: "overlay",
          }}
        />
        <div style={{ position: "relative", zIndex: 1, padding: "1.5rem" }}>{children}</div>
      </div>
    );
  },
);

GlassCard.displayName = "GlassCard";
