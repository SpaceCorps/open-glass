import React, {
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useGlassContext, type GlassContextValue } from "../context/GlassContext";
import { GLASS_Z_UNDERLYING } from "../layers";

export interface GlassUnderlyingProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * Pixels behind the glass. Omit for the depth calibrated from each panel's own size.
   *
   * Layers are ordered by this: the farthest becomes the deepest band, so it parallaxes most under a
   * panel that moves over it. A wallpaper is a few hundred pixels back; a card floating just under the
   * glass is tens.
   */
  depth?: number;
}

/**
 * Marks and wraps an underlying HTML content layer to be captured
 * and refracted by the open-glass GPU pipeline in real time.
 */
export const GlassUnderlying: React.FC<GlassUnderlyingProps> = ({
  children,
  className,
  style,
  depth,
  ...rest
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  let registerUnderlying: GlassContextValue["registerUnderlying"];
  let unregisterUnderlying: GlassContextValue["unregisterUnderlying"];
  try {
    const ctx = useGlassContext();
    registerUnderlying = ctx.registerUnderlying;
    unregisterUnderlying = ctx.unregisterUnderlying;
  } catch {
    // Graceful fallback if mounted without GlassProvider
  }

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !registerUnderlying) return;
    registerUnderlying(element, { depth });
    return () => {
      // Not `registerUnderlying(null)` any more: that clears every layer, which is the wrong thing
      // for one of several to do on its way out.
      unregisterUnderlying?.(element);
    };
  }, [registerUnderlying, unregisterUnderlying, depth]);

  return (
    <div
      ref={containerRef}
      className={`open-glass-underlying ${className ?? ""}`}
      style={{
        position: "relative",
        zIndex: GLASS_Z_UNDERLYING,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
};

export const GlassBackground = GlassUnderlying;
