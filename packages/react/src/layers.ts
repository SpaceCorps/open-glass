/**
 * Stacking order inside `.open-glass-container`.
 *
 * The glass canvas has to paint *above* the content it refracts and *below* the glass panels' own
 * borders, text and children:
 *
 *   underlying content (0) → GPU glass canvas (1) → glass panel surfaces (2+)
 *
 * The container sets `isolation: isolate` so the model is self-contained and cannot be reordered by
 * an ancestor's stacking context, and `.open-glass-content` deliberately declares no `zIndex` — a
 * stacking context there would trap the canvas below every one of its descendants.
 *
 * Known limitation, out of scope here: a glass panel nested *inside* another glass panel is
 * occluded by the outer panel's own background, so nested panels keep the CSS fallback.
 */

/** Captured content that sits below the glass and gets refracted. */
export const GLASS_Z_UNDERLYING = 0;

/** The GPU-composited glass canvas. */
export const GLASS_Z_CANVAS = 1;

/** A glass panel's own surface: borders, text and children. */
export const GLASS_Z_SURFACE = 2;
