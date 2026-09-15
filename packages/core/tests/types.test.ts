import { describe, expect, it, vi } from "vite-plus/test";
import { max_backdrop_bands } from "@open-glass/core/wasm";
import {
  AUTO_BACKDROP_DEPTH,
  DEFAULT_OPTICAL_PARAMS,
  initWasmEngine,
  MAX_BACKDROP_BANDS,
} from "../src/ts/index";
import type { OpticalParams } from "../src/ts/types";

describe("packages/core types and defaults", () => {
  it("marks an unspecified backdrop depth with a value no real distance can take", () => {
    // The sentinel travels all the way into the shader as a plain float uniform, so it has to be a
    // value `resolveBackdropDepth` can tell apart from a measured distance. Must match
    // `AUTO_BACKDROP_DEPTH` in `packages/core/src/optical/physics.rs` and the `band_depth < 0.0` test in
    // `packages/core/src/shaders/glass_composite.frag`.
    expect(AUTO_BACKDROP_DEPTH).toBe(-1);
    expect(AUTO_BACKDROP_DEPTH).toBeLessThan(0);
  });

  it("starts from the band count the wasm binary was built with", () => {
    // The literal is only what the facade reports before wasm is up, where nothing uploads anything.
    expect(MAX_BACKDROP_BANDS).toBe(3);
  });

  it("takes the band count from Rust once the engine is loaded", async () => {
    // Read from `max_backdrop_bands()` rather than hard-coded, because the band assignment on the
    // capture side must not be able to disagree with the number of samplers `glass_composite.frag`
    // declares: a fourth band would upload, never be sampled, and its content would simply be missing
    // from the glass. The mocked binary reports a *different* count from the literal, so a facade that
    // never asked Rust fails here rather than agreeing by coincidence.
    vi.resetModules();
    vi.doMock("@open-glass/core/wasm", () => ({
      default: () => Promise.resolve({}),
      init_panic_hook: () => {},
      calculate_fresnel: () => 0,
      max_backdrop_bands: () => 2,
      RendererBackend: { Auto: 0, WebGpu: 1, WebGl2: 2 },
      WasmGlassEngine: class {},
    }));

    try {
      const facade = await import("../src/ts/index");
      await facade.initWasmEngine();
      expect(facade.MAX_BACKDROP_BANDS).toBe(2);
    } finally {
      vi.doUnmock("@open-glass/core/wasm");
      vi.resetModules();
    }
  });

  it("mirrors the band count the real wasm binary reports", async () => {
    await initWasmEngine();
    const { MAX_BACKDROP_BANDS: loaded } = await import("../src/ts/index");
    expect(loaded).toBe(max_backdrop_bands());
    expect(loaded).toBe(3);
  });

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
    // Replaces the light the readiness handover removes when the fallback overlay drops from alpha
    // 0.22 to 0.05: calibrated from the measured captures as (158.0 - 0.05 * 240.4) / (0.95 * 103.4).
    // Must match `OpticalParams::default().brightness` in `packages/core/src/optical/physics.rs`.
    expect(DEFAULT_OPTICAL_PARAMS.brightness).toBe(1.5);
    // The slab the dual-surface model propagates through, and the body dome's sag. Both must match
    // `OpticalParams::default()` in `packages/core/src/optical/physics.rs`, which is where the
    // curvature is calibrated against the ~2.5% macOS body magnification.
    expect(DEFAULT_OPTICAL_PARAMS.thickness).toBe(10.0);
    expect(DEFAULT_OPTICAL_PARAMS.curvature).toBe(0.1);
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
