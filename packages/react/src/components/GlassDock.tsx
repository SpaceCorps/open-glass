import React, { forwardRef, useState, type HTMLAttributes, type ReactNode } from "react";
import type { OpticalParams } from "@open-glass/core";
import { useGlassElement } from "../hooks/useGlassElement";

export interface GlassDockItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export interface GlassDockProps extends HTMLAttributes<HTMLDivElement> {
  items: GlassDockItem[];
  cornerRadius?: number;
  optical?: OpticalParams;
  magnification?: number;
}

export const GlassDock = forwardRef<HTMLDivElement, GlassDockProps>(
  ({ items, cornerRadius = 24, optical, magnification = 1.35, className, style, ...rest }, ref) => {
    const { elementRef } = useGlassElement<HTMLDivElement>({
      cornerRadius,
      optical,
    });

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
        className={`open-glass-dock ${className ?? ""}`}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "flex-end",
          gap: "12px",
          padding: "10px 16px",
          borderRadius: `${cornerRadius}px`,
          border: "1px solid rgba(255, 255, 255, 0.35)",
          background: "rgba(255, 255, 255, 0.16)",
          backdropFilter: "blur(28px) saturate(190%)",
          WebkitBackdropFilter: "blur(28px) saturate(190%)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.1)",
          ...style,
        }}
        onMouseLeave={() => setHoveredIndex(null)}
        {...rest}
      >
        {/* Specular sheen */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: `${cornerRadius}px`,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.15) 100%)",
          }}
        />

        {items.map((item, idx) => {
          let scale = 1.0;
          if (hoveredIndex !== null) {
            const dist = Math.abs(hoveredIndex - idx);
            if (dist === 0) {
              scale = magnification;
            } else if (dist === 1) {
              scale = 1.0 + (magnification - 1.0) * 0.5;
            }
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              onMouseEnter={() => setHoveredIndex(idx)}
              aria-label={item.label}
              style={{
                position: "relative",
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "rgba(255, 255, 255, 0.22)",
                border: "1px solid rgba(255, 255, 255, 0.4)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                color: "#ffffff",
                cursor: "pointer",
                transform: `scale(${scale}) translateY(-${(scale - 1) * 16}px)`,
                transformOrigin: "bottom center",
                transition: "transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1)",
                padding: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.icon}
              </div>

              {item.active && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "-6px",
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: "#ffffff",
                    boxShadow: "0 0 6px rgba(255,255,255,0.9)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  },
);

GlassDock.displayName = "GlassDock";
