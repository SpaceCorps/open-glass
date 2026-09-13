import React, {
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useGlassContext } from "../context/GlassContext";

export interface GlassUnderlyingProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Marks and wraps an underlying HTML content layer to be captured
 * and refracted by the open-glass GPU pipeline in real time.
 */
export const GlassUnderlying: React.FC<GlassUnderlyingProps> = ({
  children,
  className,
  style,
  ...rest
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  let registerUnderlying: ((el: HTMLElement | null) => void) | undefined;
  try {
    const ctx = useGlassContext();
    registerUnderlying = ctx.registerUnderlying;
  } catch {
    // Graceful fallback if mounted without GlassProvider
  }

  useEffect(() => {
    if (containerRef.current && registerUnderlying) {
      registerUnderlying(containerRef.current);
    }
    return () => {
      if (registerUnderlying) {
        registerUnderlying(null);
      }
    };
  }, [registerUnderlying]);

  return (
    <div
      ref={containerRef}
      className={`open-glass-underlying ${className ?? ""}`}
      style={{
        position: "relative",
        zIndex: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
};

export const GlassBackground = GlassUnderlying;
