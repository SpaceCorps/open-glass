/** Overlay cross-fade duration for the CSS → GPU handover, in milliseconds. */
export const GLASS_HANDOVER_MS = 260;

export interface GlassHandoverOptions {
  /** Whether the renderer reports it is compositing real pixels. */
  isRenderReady: boolean;
  /** Overlay veil painted while the CSS `backdrop-filter` fallback is in charge. */
  fallbackBackground: string;
  /** Overlay veil left on top of the GPU composite. */
  readyBackground: string;
  /** The component's CSS `backdrop-filter` literal, used only while not ready. */
  cssBackdrop: string;
  /**
   * Whatever transition the component would otherwise have emitted, including a caller's own
   * `style.transition`. The handover entry is appended to it rather than replacing it.
   */
  transition?: string;
}

export interface GlassHandoverStyle {
  background: string;
  backdropFilter: string;
  WebkitBackdropFilter: string;
  transition: string;
}

/**
 * The CSS → GPU handover in one place: which overlay veil to paint, whether the CSS
 * `backdrop-filter` is still on, and the transition that keeps the veil change continuous.
 *
 * Every panel component used to step its overlay alpha down the instant `isRenderReady` flipped
 * (~780ms after mount), which read as a visible darkening because the GPU composite mixes only 12%
 * white back in. The alphas themselves are unchanged — the luma comes back from the composite's
 * `brightness` term — but the change now ramps over {@link GLASS_HANDOVER_MS}.
 *
 * `background` stays the shorthand rather than the `background-color` longhand: the react suite reads
 * `el.style.background`, and the shorthand sets the colour anyway. The transition names
 * `background-color`, which is the animatable longhand — `background` itself is not interpolable, so
 * naming it would produce a step again.
 *
 * `backdropFilter` still switches to `none` in one step, deliberately. `none` does not interpolate
 * with a filter list, so there is nothing to ramp; leaving a `blur(0px)` behind instead would keep a
 * backdrop root alive for no visual gain, and the evidence harness detects readiness by polling for
 * exactly `backdropFilter === "none"`.
 */
export function glassHandoverStyle(options: GlassHandoverOptions): GlassHandoverStyle {
  const { isRenderReady, fallbackBackground, readyBackground, cssBackdrop, transition } = options;
  const backdropFilter = isRenderReady ? "none" : cssBackdrop;
  const handover = `background-color ${GLASS_HANDOVER_MS}ms linear`;
  // "none" is not a transition entry that can be composed with one — it is the absence of any — so it
  // is dropped rather than joined, which would invalidate the whole declaration.
  const base = transition && transition !== "none" ? transition : undefined;

  return {
    background: isRenderReady ? readyBackground : fallbackBackground,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    transition: base ? `${base}, ${handover}` : handover,
  };
}
