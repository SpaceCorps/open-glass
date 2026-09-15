import type { CSSProperties } from "react";
import { glassHandoverStyle, type GlassHandoverStyle } from "../surface";

/**
 * Shared style helpers for the form controls, so five components do not each re-derive the same
 * numbers. These are plain functions over `CSSProperties`, not components.
 */

export interface GlassFieldSurface extends GlassHandoverStyle {}

export interface GlassFocusRing {
  border: string;
  boxShadow: string;
}

/** The CSS `backdrop-filter` literal every form control falls back to before the renderer is ready. */
export const FIELD_CSS_BACKDROP = "blur(18px) saturate(180%)";

/**
 * The `background` / `backdropFilter` / `WebkitBackdropFilter` triple, mirroring `GlassCard`: the
 * literal while the CSS fallback is in charge, `none` plus a dialled-down tint once the GPU path
 * composites — keeping both on would stack two different glass models in one scene.
 *
 * Delegates to `glassHandoverStyle` so the overlay ramps over `GLASS_HANDOVER_MS` instead of
 * stepping the instant `isRenderReady` flips, the same fix Plan 00653 gave the panel components.
 */
export function fieldSurface(isRenderReady: boolean, transition?: string): GlassFieldSurface {
  return glassHandoverStyle({
    isRenderReady,
    fallbackBackground: "rgba(255, 255, 255, 0.14)",
    readyBackground: "rgba(255, 255, 255, 0.04)",
    cssBackdrop: FIELD_CSS_BACKDROP,
    transition,
  });
}

const RING_BORDER_WIDTH = "1px";

/**
 * The focus indicator, expressed as `border` + two stacked box-shadows and **never** as an
 * `outline`. Once the renderer is ready the control sets `backdrop-filter: none`, so an outline
 * would be drawn straight over GPU-composited pixels with no guaranteed contrast; a dark contrast
 * ring under a bright halo stays visible against both the light CSS-blur fallback and whatever the
 * composite paints.
 *
 * The unfocused state keeps the same border *width*, so gaining the ring never reflows layout.
 */
export function focusRing(isFocusVisible: boolean, invalid = false): GlassFocusRing {
  const restingBorder = invalid
    ? `${RING_BORDER_WIDTH} solid rgba(255, 120, 120, 0.75)`
    : `${RING_BORDER_WIDTH} solid rgba(255, 255, 255, 0.28)`;

  if (!isFocusVisible) {
    return {
      border: restingBorder,
      boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.18)",
    };
  }

  return {
    border: `${RING_BORDER_WIDTH} solid rgba(160, 205, 255, 0.95)`,
    boxShadow: [
      "inset 0 1px 2px rgba(0, 0, 0, 0.18)",
      "0 0 0 1px rgba(10, 15, 30, 0.85)",
      "0 0 0 3px rgba(120, 180, 255, 0.65)",
    ].join(", "),
  };
}

/** Applied on top of the surface when the control is disabled. */
export const disabledSurface: CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};

/** Shared label typography, so the five controls read as one family. */
export const fieldLabelStyle: CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "rgba(255, 255, 255, 0.85)",
};

/** Merges a caller-supplied `aria-describedby` with one the component needs to add. */
export function mergeDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}

/** Clamps `value` into `[min, max]` and snaps it to a `step` multiple offset from `min`. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Re-clamp: snapping can push a value at the boundary past it when `max - min` is not a step
  // multiple. Round to 6 decimals so a fractional step does not accumulate float noise.
  return Math.min(max, Math.max(min, Math.round(snapped * 1e6) / 1e6));
}
