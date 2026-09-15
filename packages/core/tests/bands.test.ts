import { describe, expect, it, vi } from "vite-plus/test";
import {
  assignBands,
  AUTO_BACKDROP_DEPTH,
  bandDepth,
  compositeBand,
  type BackdropLayer,
} from "../src/ts/bands";

/** A layer whose raster and rect are whatever the test needs to see drawn. */
function layer(depth: number, rect: Partial<BackdropLayer["rect"]> = {}): BackdropLayer {
  return {
    depth,
    raster: { width: 10, height: 10 } as unknown as HTMLCanvasElement,
    rect: { x: 0, y: 0, width: 100, height: 100, ...rect },
  };
}

describe("packages/core backdrop bands", () => {
  it("orders bands far to near", () => {
    // The band index the shader samples is what carries the depth order, so this ordering is the whole
    // parallax: band 0 is sampled at the farthest distance.
    expect(assignBands([layer(80), layer(480), layer(200)], 3)).toEqual([2, 0, 1]);
  });

  it("sorts an unspecified depth as the farthest", () => {
    // AUTO selects the depth calibrated from the panel's own half-height, which models the wallpaper
    // case — so the layer nobody placed belongs behind the ones that were placed, not in front of them.
    expect(assignBands([layer(480), layer(AUTO_BACKDROP_DEPTH)], 3)).toEqual([1, 0]);
  });

  it("keeps equal depths in their input order", () => {
    // Otherwise two layers at the same depth could swap bands between frames, and each swap is a full
    // re-upload of both bands for no visible change.
    expect(assignBands([layer(200), layer(200), layer(200)], 3)).toEqual([0, 1, 2]);
  });

  it("merges a fourth layer into the nearest band rather than dropping it", () => {
    // Dropping it would make its content vanish from the glass entirely — the panel would refract a
    // scene the user is not looking at. Sharing the nearest band refracts it at a neighbour's distance,
    // which is wrong by a parallax offset rather than wrong by an absence.
    const bands = assignBands([layer(480), layer(300), layer(120), layer(40)], 3);
    expect(bands).toEqual([0, 1, 2, 2]);
  });

  it("still assigns a band when asked for fewer than one", () => {
    expect(assignBands([layer(480), layer(40)], 0)).toEqual([0, 0]);
  });

  it("takes a band's depth from its farthest explicit member", () => {
    // A band holds more than one member only where layers merged, at the nearest band. Over-blurring the
    // parallax of the frontmost content is the lesser error: sampling at the near depth would place
    // everything behind it at the wrong distance too.
    expect(bandDepth([120, 40])).toBe(120);
    expect(bandDepth([40, 120])).toBe(120);
  });

  it("ignores unspecified depths when any member declared one", () => {
    expect(bandDepth([AUTO_BACKDROP_DEPTH, 300])).toBe(300);
  });

  it("declares nothing when no member declared a depth", () => {
    // This is what keeps a single-layer app on exactly the calibrated look it had before banding.
    expect(bandDepth([AUTO_BACKDROP_DEPTH, AUTO_BACKDROP_DEPTH])).toBe(AUTO_BACKDROP_DEPTH);
    expect(bandDepth([])).toBe(AUTO_BACKDROP_DEPTH);
  });

  it("treats a zero depth as an explicit distance", () => {
    // Content pressed against the glass is a real answer — it refracts with no parallax at all — and
    // must not be mistaken for "unspecified", which would push it back to the calibrated fallback.
    expect(bandDepth([0])).toBe(0);
    expect(assignBands([layer(0), layer(AUTO_BACKDROP_DEPTH)], 3)).toEqual([1, 0]);
  });

  it("clears the band once and draws each member at its own rect", () => {
    // The rect is the placement fix: the composite maps a band across the whole panel by `v_uv`, so a
    // layer that does not fill the container has to be drawn where it actually sits. And the clear must
    // happen exactly once — per member it would erase everything drawn before it, leaving only the last.
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const target = {
      width: 400,
      height: 200,
      getContext: () => ({ clearRect, drawImage }),
    } as unknown as HTMLCanvasElement;

    const far = layer(480, { x: 0, y: 0, width: 400, height: 200 });
    const near = layer(80, { x: 24, y: 36, width: 120, height: 64 });
    expect(compositeBand(target, [far, near])).toBe(true);

    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(drawImage).toHaveBeenCalledTimes(2);
    // DOM order, so a member later in the layer list paints over an earlier one within the same band.
    expect(drawImage.mock.calls[0]).toEqual([far.raster, 0, 0, 400, 200]);
    expect(drawImage.mock.calls[1]).toEqual([near.raster, 24, 36, 120, 64]);
  });

  it("clears the band even when it has no members left", () => {
    // A band whose members all vanished must upload transparency, or the glass keeps refracting the last
    // raster of content that is no longer on the page.
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const target = {
      width: 400,
      height: 200,
      getContext: () => ({ clearRect, drawImage }),
    } as unknown as HTMLCanvasElement;

    expect(compositeBand(target, [])).toBe(true);
    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("skips a member that has never rasterized", () => {
    const drawImage = vi.fn();
    const target = {
      width: 400,
      height: 200,
      getContext: () => ({ clearRect: vi.fn(), drawImage }),
    } as unknown as HTMLCanvasElement;

    const empty: BackdropLayer = { ...layer(80), raster: null };
    expect(compositeBand(target, [empty])).toBe(true);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("skips a member measured at zero size", () => {
    // `drawImage` with a zero width throws in some engines and paints nothing in the rest, and a layer
    // measures 0x0 for a whole frame whenever it mounts hidden or before its first layout.
    const drawImage = vi.fn();
    const target = {
      width: 400,
      height: 200,
      getContext: () => ({ clearRect: vi.fn(), drawImage }),
    } as unknown as HTMLCanvasElement;

    expect(compositeBand(target, [layer(80, { width: 0, height: 0 })])).toBe(true);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("reports failure when the band canvas has no 2D context", () => {
    // A caller that uploaded the band anyway would hand the renderer an uninitialized canvas, so the
    // false is what keeps the previous band content in place instead.
    const target = {
      width: 400,
      height: 200,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    expect(compositeBand(target, [layer(80)])).toBe(false);
  });
});
