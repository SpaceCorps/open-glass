import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_OPTICAL_PARAMS } from "../src/ts/index";
import type { OpticalParams } from "../src/ts/types";

describe("packages/core types and defaults", () => {
  it("provides physically sensible default optical params", () => {
    expect(DEFAULT_OPTICAL_PARAMS.ior).toBeCloseTo(1.52); // Crown glass
    expect(DEFAULT_OPTICAL_PARAMS.blurRadius).toBe(16);
    expect(DEFAULT_OPTICAL_PARAMS.dispersion).toBe(0.04);
    expect(DEFAULT_OPTICAL_PARAMS.rimPower).toBe(3.5);
    expect(DEFAULT_OPTICAL_PARAMS.sheenIntensity).toBe(0.75);
    expect(DEFAULT_OPTICAL_PARAMS.roughness).toBe(0.03);
    // Matches the `saturate(180%)` in every CSS `backdrop-filter` fallback literal, so dropping the
    // fallback for the GPU composite does not visibly desaturate the panel.
    expect(DEFAULT_OPTICAL_PARAMS.saturation).toBe(1.8);
    expect(DEFAULT_OPTICAL_PARAMS.tintColor).toEqual([1.0, 1.0, 1.0, 0.12]);
  });

  it("allows customizing partial optical parameters", () => {
    const custom: OpticalParams = {
      ior: 1.49, // Acrylic
      blurRadius: 24,
      dispersion: 0.08,
    };

    const merged = { ...DEFAULT_OPTICAL_PARAMS, ...custom };
    expect(merged.ior).toBe(1.49);
    expect(merged.blurRadius).toBe(24);
    expect(merged.dispersion).toBe(0.08);
    expect(merged.sheenIntensity).toBe(DEFAULT_OPTICAL_PARAMS.sheenIntensity);
  });
});
