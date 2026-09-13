import React, { forwardRef, useState, type HTMLAttributes, type ReactNode } from "react";
import type { OpticalParams } from "@open-glass/core";
import { useGlassElement } from "../hooks/useGlassElement";

export interface GlassWindowProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children?: ReactNode;
  cornerRadius?: number;
  optical?: OpticalParams;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  variant?: "macos" | "visionos";
}

export const GlassWindow = forwardRef<HTMLDivElement, GlassWindowProps>(
  (
    {
      title = "Window",
      children,
      cornerRadius = 22,
      optical,
      onClose,
      onMinimize,
      onMaximize,
      variant = "macos",
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

    const [isHoveredClose, setIsHoveredClose] = useState(false);

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
        className={`open-glass-window ${variant} ${className ?? ""}`}
        style={{
          position: "relative",
          borderRadius: `${cornerRadius}px`,
          border:
            variant === "visionos"
              ? "1.5px solid rgba(255, 255, 255, 0.45)"
              : "1px solid rgba(255, 255, 255, 0.3)",
          background:
            variant === "visionos" ? "rgba(255, 255, 255, 0.18)" : "rgba(240, 240, 245, 0.22)",
          backdropFilter: "blur(32px) saturate(180%)",
          WebkitBackdropFilter: "blur(32px) saturate(180%)",
          boxShadow:
            variant === "visionos"
              ? "0 30px 80px rgba(0, 0, 0, 0.35), 0 0 40px rgba(255, 255, 255, 0.15)"
              : "0 20px 50px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
        {...rest}
      >
        {/* Specular edge sheen layer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: `${cornerRadius}px`,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.05) 15%, transparent 100%)",
          }}
        />

        {/* Titlebar */}
        <div
          className="open-glass-window-titlebar"
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid rgba(255, 255, 255, 0.15)",
            userSelect: "none",
            cursor: "grab",
          }}
        >
          {/* Traffic lights */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              width: "60px",
            }}
            onMouseEnter={() => setIsHoveredClose(true)}
            onMouseLeave={() => setIsHoveredClose(false)}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#ff5f56",
                border: "1px solid #e0443e",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                fontSize: "9px",
                color: "#4d0000",
                lineHeight: 1,
              }}
            >
              {isHoveredClose ? "×" : ""}
            </button>
            <button
              type="button"
              aria-label="Minimize"
              onClick={onMinimize}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#ffbd2e",
                border: "1px solid #dea123",
                cursor: "pointer",
                padding: 0,
              }}
            />
            <button
              type="button"
              aria-label="Maximize"
              onClick={onMaximize}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#27c93f",
                border: "1px solid #1aab29",
                cursor: "pointer",
                padding: 0,
              }}
            />
          </div>

          <div
            style={{
              flex: 1,
              textAlign: "center",
              fontWeight: 500,
              fontSize: "0.875rem",
              color: "rgba(255, 255, 255, 0.92)",
              letterSpacing: "-0.01em",
              textShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          >
            {title}
          </div>

          <div style={{ width: "60px" }} />
        </div>

        {/* Content Area */}
        <div
          className="open-glass-window-content"
          style={{
            position: "relative",
            zIndex: 1,
            padding: "1.25rem",
            flex: 1,
            overflow: "auto",
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);

GlassWindow.displayName = "GlassWindow";
