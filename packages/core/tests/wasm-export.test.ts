import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculate_fresnel,
  calculateFresnel,
  createGlassEngine,
  initWasmEngine,
  isWasmEngineLoaded,
  RendererBackend,
  WasmGlassEngine,
} from "../src/ts/index";

describe("packages/core wasm export and loader contracts", () => {
  it("package.json defines correct ./wasm exports and build:wasm script", () => {
    const pkgPath = resolve(__dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    expect(pkg.exports).toBeDefined();
    expect(pkg.exports["./wasm"]).toBeDefined();
    expect(pkg.exports["./wasm"].types).toBe("./dist/wasm/open_glass_core.d.ts");
    expect(pkg.exports["./wasm"].import).toBe("./dist/wasm/open_glass_core.js");

    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts["build:wasm"]).toContain("scripts/build-wasm.sh");
  });

  it("exports wasm loader functions and types", () => {
    expect(typeof isWasmEngineLoaded).toBe("function");
    expect(typeof initWasmEngine).toBe("function");
    expect(typeof calculateFresnel).toBe("function");
    expect(typeof calculate_fresnel).toBe("function");
    expect(RendererBackend).toBeDefined();
    expect(WasmGlassEngine).toBeDefined();
  });

  it("calculates Fresnel reflectance via pure TypeScript fallback before wasm init", () => {
    const fresnelNormal = calculateFresnel(1.0, 1.0, 1.5);
    const fresnelGrazing = calculateFresnel(0.0, 1.0, 1.5);

    // Normal incidence: ((1-1.5)/(1+1.5))^2 = 0.04
    expect(fresnelNormal).toBeCloseTo(0.04, 4);
    // Grazing incidence: 1.0
    expect(fresnelGrazing).toBeCloseTo(1.0, 4);
  });

  it("initializes WebAssembly engine and evaluates Fresnel via Rust wasm", async () => {
    await initWasmEngine();
    expect(isWasmEngineLoaded()).toBe(true);

    const fresnelWasm = calculate_fresnel(0.5, 1.0, 1.5);
    const fresnelUnified = calculateFresnel(0.5, 1.0, 1.5);

    expect(fresnelUnified).toBeCloseTo(fresnelWasm, 5);
    expect(fresnelUnified).toBeGreaterThan(0.04);
    expect(fresnelUnified).toBeLessThan(1.0);
  });

  it("integrates with createGlassEngine and operates with quads", async () => {
    const canvas = {
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    const engine = await createGlassEngine(canvas, { backend: "webgl2" });
    expect(engine.backend).toBe("webgl2");

    // Updating quads should succeed and forward to wasm engine when loaded
    expect(() => {
      engine.updateQuads([
        {
          id: "card-1",
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          cornerRadius: 12,
          optical: {
            ior: 1.52,
            blurRadius: 20,
          },
        },
      ]);
    }).not.toThrow();

    expect(() => engine.render()).not.toThrow();
    expect(() => engine.resize(1024, 768)).not.toThrow();
    expect(() => engine.destroy()).not.toThrow();
  });
});
