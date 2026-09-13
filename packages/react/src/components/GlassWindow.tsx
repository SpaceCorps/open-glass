import React, {
  forwardRef,
  useContext,
  useEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";
import { useGlassElement } from "../hooks/useGlassElement";

import { useParallaxTilt } from "../hooks/useParallaxTilt";

export interface GlassWindowProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children?: ReactNode;
  cornerRadius?: number;
  optical?: OpticalParams;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  variant?: "macos" | "visionos";
  /** Enable interactive 3D parallax tilt on cursor and device motion. Defaults to true for visionos, false for macos. */
  enableParallax?: boolean;
  /** Maximum tilt angle in degrees. Defaults to 12. */
  maxTiltAngle?: number;
  /** Physical depth separation in pixels between outer glass plate and inner content. Defaults to 16. */
  depth?: number;
  /** Enable dynamic angle-dependent Fresnel highlights. Defaults to true for visionos. */
  enableFresnel?: boolean;
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
      enableParallax,
      maxTiltAngle = 12,
      depth = 16,
      enableFresnel,
      className,
      style,
      onPointerMove,
      onPointerLeave,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLDivElement>({
      cornerRadius,
      optical,
    });

    const context = useContext(GlassContext);
    const hasBackgroundSource = context?.hasBackgroundSource ?? false;

    const isVisionOS = variant === "visionos";
    const shouldEnableParallax = enableParallax ?? isVisionOS;
    const shouldEnableFresnel = enableFresnel ?? isVisionOS;

    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
      return false;
    });

    useEffect(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);

      const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
        setPrefersReducedMotion(e.matches);
      };

      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleChange as (e: MediaQueryListEvent) => void);
        return () => {
          mediaQuery.removeEventListener(
            "change",
            handleChange as (e: MediaQueryListEvent) => void,
          );
        };
      } else if (typeof mediaQuery.addListener === "function") {
        mediaQuery.addListener(handleChange);
        return () => {
          mediaQuery.removeListener(handleChange);
        };
      }
    }, []);

    const isParallaxActive = shouldEnableParallax && !prefersReducedMotion;

    const { tiltX, tiltY, normalizedX, normalizedY, isHovered, containerProps } = useParallaxTilt({
      enableParallax: isParallaxActive,
      maxTiltAngle,
    });

    const [isHoveredClose, setIsHoveredClose] = useState(false);

    const fresnelAngle = Math.atan2(normalizedY, normalizedX) * (180 / Math.PI) + 90;

    const specularBackground = shouldEnableFresnel
      ? `radial-gradient(circle at ${50 + normalizedX * 40}% ${50 + normalizedY * 40}%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.12) 35%, transparent 70%), linear-gradient(${fresnelAngle}deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.05) 25%, transparent 100%)`
      : "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.05) 15%, transparent 100%)";

    const transform3d = isParallaxActive
      ? `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`
      : undefined;

    const combinedTransform = style?.transform
      ? transform3d
        ? `${style.transform} ${transform3d}`
        : style.transform
      : transform3d;

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
        onPointerMove={(e) => {
          containerProps.onPointerMove(e);
          onPointerMove?.(e);
        }}
        onPointerLeave={(e) => {
          containerProps.onPointerLeave(e);
          onPointerLeave?.(e);
        }}
        style={{
          position: "relative",
          borderRadius: `${cornerRadius}px`,
          border:
            variant === "visionos"
              ? "1.5px solid rgba(255, 255, 255, 0.45)"
              : "1px solid rgba(255, 255, 255, 0.3)",
          background: hasBackgroundSource
            ? variant === "visionos"
              ? "rgba(255, 255, 255, 0.04)"
              : "rgba(240, 240, 245, 0.05)"
            : variant === "visionos"
              ? "rgba(255, 255, 255, 0.18)"
              : "rgba(240, 240, 245, 0.22)",
          backdropFilter: hasBackgroundSource ? "none" : "blur(32px) saturate(180%)",
          WebkitBackdropFilter: hasBackgroundSource ? "none" : "blur(32px) saturate(180%)",
          boxShadow:
            variant === "visionos"
              ? "0 30px 80px rgba(0, 0, 0, 0.35), 0 0 40px rgba(255, 255, 255, 0.15)"
              : "0 20px 50px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transformStyle: "preserve-3d",
          perspective: "1000px",
          transform: combinedTransform,
          transition:
            style?.transition ??
            (isParallaxActive
              ? isHovered
                ? "transform 0.1s cubic-bezier(0.2, 0, 0, 1)"
                : "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)"
              : "none"),
          ...style,
        }}
        {...rest}
      >
        {/* Specular edge sheen layer */}
        <div
          data-testid="specular-highlight"
          className="open-glass-specular-highlight"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: `${cornerRadius}px`,
            backgroundImage: specularBackground,
            transition: isHovered ? "background 0.05s ease-out" : "background 0.3s ease-out",
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
            transform: isParallaxActive ? `translateZ(${depth * 0.7}px)` : undefined,
            transformStyle: "preserve-3d",
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
            transform: isParallaxActive ? `translateZ(${depth}px)` : undefined,
            transformStyle: "preserve-3d",
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);

GlassWindow.displayName = "GlassWindow";
