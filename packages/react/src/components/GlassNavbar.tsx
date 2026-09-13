import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { OpticalParams } from "@open-glass/core";
import { useGlassElement } from "../hooks/useGlassElement";

export interface GlassNavbarProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  optical?: OpticalParams;
  sticky?: boolean;
}

export const GlassNavbar = forwardRef<HTMLElement, GlassNavbarProps>(
  ({ children, optical, sticky = true, className, style, ...rest }, ref) => {
    const { elementRef } = useGlassElement<HTMLElement>({
      cornerRadius: 0,
      optical,
    });

    return (
      <header
        ref={(node) => {
          elementRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={`open-glass-navbar ${sticky ? "sticky" : ""} ${className ?? ""}`}
        style={{
          position: sticky ? "sticky" : "relative",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.875rem 2rem",
          borderBottom: "1px solid rgba(255, 255, 255, 0.25)",
          background: "rgba(255, 255, 255, 0.14)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
          ...style,
        }}
        {...rest}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.02) 100%)",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {children}
        </div>
      </header>
    );
  },
);

GlassNavbar.displayName = "GlassNavbar";
