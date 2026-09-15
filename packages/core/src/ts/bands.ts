/**
 * The depth-band model: how a set of captured content layers becomes the small fixed number of
 * backdrop rasters the composite can sample.
 *
 * Pure functions over plain data, deliberately separate from the engine facade and from React: the
 * ordering rules and the merge behaviour are the part that can silently make content vanish from the
 * glass, and they are worth testing without a GPU or a DOM tree in the way.
 */

/**
 * "Nobody declared how far behind the glass this content sits."
 *
 * Mirrors `AUTO_BACKDROP_DEPTH` in packages/core/src/optical/physics.rs, where the shader-side fallback
 * — the panel's own half-height times `BODY_LENS_DEPTH_SCALE` — is derived and asserted. A real
 * distance is never negative, so one number carries both cases.
 */
export const AUTO_BACKDROP_DEPTH = -1;

/** Where a layer sits inside the glass container, in device pixels of the canvas' drawing buffer. */
export interface BackdropLayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One captured content layer, ready to be composited into a band. */
export interface BackdropLayer {
  /** Pixels behind the glass' rear face, or [`AUTO_BACKDROP_DEPTH`] for the calibrated default. */
  depth: number;
  /** The layer's most recent raster, or null when it has never rasterized. */
  raster: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null;
  /** Container-relative placement, from `getBoundingClientRect`. */
  rect: BackdropLayerRect;
}

/**
 * The band index for each layer, in the layers' own order. Band 0 is the farthest.
 *
 * Layers are ranked by depth descending, and a layer past `maxBands` shares the nearest band rather
 * than being dropped: dropping it would make its content vanish from the glass entirely, which is a
 * worse error than refracting it at a neighbour's distance. `AUTO_BACKDROP_DEPTH` sorts as the
 * farthest, because the calibrated fallback it selects models the wallpaper case — the layer nobody
 * bothered to place is the one behind everything.
 *
 * Ties keep their input order, so two layers at the same depth land in the same relative bands frame
 * after frame instead of swapping.
 */
export function assignBands(layers: Pick<BackdropLayer, "depth">[], maxBands: number): number[] {
  const bandCount = Math.max(1, Math.floor(maxBands));
  const ranked = layers
    .map((layer, index) => ({ index, depth: layer.depth }))
    .sort((a, b) => sortDepth(b.depth) - sortDepth(a.depth) || a.index - b.index);

  const bands: number[] = Array.from({ length: layers.length }, () => 0);
  ranked.forEach((layer, rank) => {
    bands[layer.index] = Math.min(rank, bandCount - 1);
  });
  return bands;
}

/**
 * The depth a whole band is sampled at: the farthest explicit depth among its members, else auto.
 *
 * The farthest rather than the nearest or the mean, because a band only ever holds more than one layer
 * when layers merged into it, and the merge happens at the nearest band — where over-blurring the
 * parallax of the frontmost content is less wrong than throwing the depth of the content behind it. A
 * band whose members all declared nothing declares nothing, which is what keeps a single-layer app on
 * exactly the calibrated look it had before banding.
 */
export function bandDepth(depths: number[]): number {
  const explicit = depths.filter((depth) => depth >= 0);
  return explicit.length > 0 ? Math.max(...explicit) : AUTO_BACKDROP_DEPTH;
}

/**
 * Clear `target` and draw every member's raster at its own rect. False when there is no 2D context.
 *
 * The per-member rect is also a placement fix that multi-band makes unavoidable: the composite maps a
 * band's texture across the whole panel by `v_uv`, which is only correct when the captured element
 * fills the container. Drawing each member into a container-sized band canvas at its measured rect is
 * what lets a layer that does *not* fill the container refract in the right place.
 *
 * The clear is unconditional and happens once: a member that shrank or moved must not leave its
 * previous frame's pixels behind, and a band whose members all vanished must upload transparency so
 * the band behind it shows through.
 */
export function compositeBand(
  target: HTMLCanvasElement | OffscreenCanvas,
  members: BackdropLayer[],
): boolean {
  const context = target.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) return false;

  context.clearRect(0, 0, target.width, target.height);
  for (const member of members) {
    if (!member.raster) continue;
    const { x, y, width, height } = member.rect;
    if (width <= 0 || height <= 0) continue;
    context.drawImage(member.raster as CanvasImageSource, x, y, width, height);
  }
  return true;
}

/** Sort key that puts `AUTO_BACKDROP_DEPTH` behind every explicit distance. */
function sortDepth(depth: number): number {
  return depth < 0 ? Number.POSITIVE_INFINITY : depth;
}
