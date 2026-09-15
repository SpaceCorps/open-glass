import { describe, expect, it, vi } from "vite-plus/test";
import {
  createGlassEngine,
  DEFAULT_OPTICAL_PARAMS,
  negotiateBackend,
  probeWebGpuSupport,
  RENDERER_PRODUCES_PIXELS,
} from "../src/ts/index";

describe("packages/core engine negotiation", () => {
  it("falls back to webgl2 when navigator.gpu is absent", async () => {
    // In node/test environment, navigator.gpu is not available
    const support = await probeWebGpuSupport();
    expect(support).toBe(false);

    const backend = await negotiateBackend("auto");
    expect(backend).toBe("webgl2");
  });

  it("respects explicit webgl2 requested backend", async () => {
    const backend = await negotiateBackend("webgl2");
    expect(backend).toBe("webgl2");
  });

  it("falls back to webgl2 when webgpu requested but unavailable", async () => {
    const backend = await negotiateBackend("webgpu");
    expect(backend).toBe("webgl2");
  });

  it("still reports webgl2 when navigator.gpu is present and an adapter resolves", async () => {
    // `WebGpuRenderer::new` is a stub that unconditionally returns Err, so `WasmGlassEngine` silently
    // builds a `WebGl2Renderer` whatever backend it is asked for. Reporting "webgpu" here — true on any
    // ordinary modern Chrome — labelled a live WebGL2 renderer as something else, and every
    // backend-gated branch in the facade then skipped it. The probe still tells the truth about the
    // browser; only the negotiated backend is pinned to what will actually run.
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({}),
        },
      },
      writable: true,
      configurable: true,
    });

    try {
      const support = await probeWebGpuSupport();
      expect(support).toBe(true);
      expect(await negotiateBackend("auto")).toBe("webgl2");
      expect(await negotiateBackend("webgpu")).toBe("webgl2");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });

  it("uploads the backdrop to a live wasm renderer even on a WebGPU-capable browser", async () => {
    // Regression test for a backdrop that never arrived. The upload used to be gated on
    // `this.backend === "webgl2"`, so on a browser whose `requestAdapter()` resolves — where
    // negotiation reported "webgpu" while `WasmGlassEngine` had quietly fallen back to
    // `WebGl2Renderer` — the renderer kept a live pipeline that was never handed a raster, and
    // composited a flat block over the DOM because `backgroundSource` was assigned regardless. Routing
    // on the existence of the wasm engine is what this pins; `navigator.gpu` is mocked so a
    // reintroduced backend gate would fail here rather than only in a real browser.
    vi.resetModules();

    const uploads: unknown[] = [];
    const quadArgs: number[][] = [];
    class FakeWasmEngine {
      constructor(..._args: unknown[]) {}
      set_background_from_canvas(source: unknown) {
        uploads.push(source);
      }
      set_background_from_offscreen_canvas(source: unknown) {
        uploads.push(source);
      }
      has_real_background() {
        return uploads.length > 0;
      }
      resize() {}
      clear_quads() {
        quadArgs.length = 0;
      }
      add_quad(...args: number[]) {
        quadArgs.push(args);
      }
      render() {}
      free() {}
    }

    vi.doMock("@open-glass/core/wasm", () => ({
      default: () => Promise.resolve({}),
      init_panic_hook: () => {},
      calculate_fresnel: () => 0,
      RendererBackend: { Auto: 0, WebGpu: 1, WebGl2: 2 },
      WasmGlassEngine: FakeWasmEngine,
    }));

    const originalNavigator = globalThis.navigator;
    const originalCanvasClass = (globalThis as any).HTMLCanvasElement;
    // The upload route type-tests its source against these globals, which the node environment lacks.
    class StubCanvas {
      width = 0;
      height = 0;
      clientWidth = 400;
      clientHeight = 200;
      getContext() {
        return null;
      }
    }
    (globalThis as any).HTMLCanvasElement = StubCanvas;
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } },
      writable: true,
      configurable: true,
    });

    try {
      const { createGlassEngine: create } = await import("../src/ts/index");
      const canvas = new StubCanvas() as unknown as HTMLCanvasElement;
      const engine = await create(canvas, { width: 400, height: 200 });

      const source = new StubCanvas() as unknown as HTMLCanvasElement;
      engine.updateBackgroundSource(source);

      expect(uploads).toEqual([source]);
      expect(engine.hasBackgroundSource()).toBe(true);
      // A confirmed upload into a live renderer is the whole readiness condition.
      expect(engine.isRenderReady?.() ?? false).toBe(true);

      // `add_quad` is positional and must mirror `OpticalParams`' Rust field order, with `saturation`,
      // `brightness`, `thickness` then `curvature` between `roughness` and the four tint channels. A
      // swap would feed the chroma boost, the exposure gain or a slab dimension into a tint channel, and
      // `updateQuads` swallows every throw from this call, so nothing else here would notice; the
      // browser tests' chroma, luma and interior-bending differentials are the other half of this guard.
      // Every override is deliberately a value no neighbour and no tint channel holds (1.0, 1.0, 1.0,
      // 0.12), so any adjacent transposition changes this array.
      engine.updateQuads([
        {
          id: "panel",
          x: 8,
          y: 16,
          width: 100,
          height: 50,
          cornerRadius: 12,
          optical: { saturation: 1.42, brightness: 1.17, thickness: 14.5, curvature: 0.23 },
        },
      ]);
      expect(quadArgs).toHaveLength(1);
      expect(quadArgs[0]).toEqual([
        8,
        16,
        100,
        50,
        12,
        DEFAULT_OPTICAL_PARAMS.ior,
        DEFAULT_OPTICAL_PARAMS.blurRadius,
        DEFAULT_OPTICAL_PARAMS.dispersion,
        DEFAULT_OPTICAL_PARAMS.rimPower,
        DEFAULT_OPTICAL_PARAMS.sheenIntensity,
        DEFAULT_OPTICAL_PARAMS.lightAngle,
        DEFAULT_OPTICAL_PARAMS.roughness,
        1.42,
        1.17,
        14.5,
        0.23,
        ...DEFAULT_OPTICAL_PARAMS.tintColor,
      ]);

      engine.destroy();
    } finally {
      (globalThis as any).HTMLCanvasElement = originalCanvasClass;
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
      vi.doUnmock("@open-glass/core/wasm");
      vi.resetModules();
    }
  });

  it("reports readiness false until the renderer confirms it holds a backdrop", async () => {
    // `has_real_background()` is asked of Rust rather than inferred from `backgroundSource`: the field
    // records only that a source was handed over, not that `texImage2D` accepted it. A renderer that
    // rejected the upload must keep consumers on CSS glass, because `WebGl2Renderer::render` skips the
    // composite and would otherwise leave them with a blank canvas and no blur.
    vi.resetModules();

    class RejectingWasmEngine {
      constructor(..._args: unknown[]) {}
      set_background_from_canvas() {
        throw new Error("SecurityError: Tainted canvases may not be loaded.");
      }
      has_real_background() {
        return false;
      }
      resize() {}
      render() {}
      free() {}
    }

    vi.doMock("@open-glass/core/wasm", () => ({
      default: () => Promise.resolve({}),
      init_panic_hook: () => {},
      calculate_fresnel: () => 0,
      RendererBackend: { Auto: 0, WebGpu: 1, WebGl2: 2 },
      WasmGlassEngine: RejectingWasmEngine,
    }));

    const originalCanvasClass = (globalThis as any).HTMLCanvasElement;
    class StubCanvas {
      width = 0;
      height = 0;
      clientWidth = 400;
      clientHeight = 200;
      getContext() {
        return null;
      }
    }
    (globalThis as any).HTMLCanvasElement = StubCanvas;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { createGlassEngine: create } = await import("../src/ts/index");
      const engine = await create(new StubCanvas() as unknown as HTMLCanvasElement);

      engine.updateBackgroundSource(new StubCanvas() as unknown as HTMLCanvasElement);

      expect(engine.hasBackgroundSource()).toBe(true);
      expect(engine.isRenderReady?.() ?? false).toBe(false);
      // A rejected upload is reported, not swallowed: a tainted capture canvas makes every route throw.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[open-glass]"), expect.anything());

      engine.destroy();
    } finally {
      warn.mockRestore();
      (globalThis as any).HTMLCanvasElement = originalCanvasClass;
      vi.doUnmock("@open-glass/core/wasm");
      vi.resetModules();
    }
  });

  it("instantiates glass engine and resizes canvas", async () => {
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 400,
      clientHeight: 200,
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLCanvasElement;

    const engine = await createGlassEngine(canvas, {
      width: 500,
      height: 300,
    });

    expect(engine.backend).toBe("webgl2");
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(300);

    engine.resize(800, 600);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);

    engine.destroy();
  });

  it("reports isRenderReady false when the wasm renderer cannot be constructed", async () => {
    // The flag is a static claim about the WebGL2 backend, not about this instance: with getContext
    // mocked to null, WebGl2Renderer::new returns Err, `new WasmGlassEngine(...)` throws, and
    // initWasm()'s catch leaves wasmEngine null — so readiness must still be false with the flag on.
    expect(RENDERER_PRODUCES_PIXELS).toBe(true);

    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 400,
      clientHeight: 200,
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLCanvasElement;

    const engine = await createGlassEngine(canvas, { width: 400, height: 200 });

    expect(engine.isRenderReady?.() ?? false).toBe(false);

    // An uploaded background texture is not evidence that anything was drawn with it.
    engine.updateBackgroundSource({ width: 4, height: 4 } as unknown as HTMLCanvasElement);
    expect(engine.hasBackgroundSource()).toBe(true);
    expect(engine.isRenderReady?.() ?? false).toBe(false);

    engine.destroy();
  });

  it("falls back to 300x150 when the canvas has not been laid out", async () => {
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 0,
      clientHeight: 0,
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLCanvasElement;

    // `??` would have passed clientWidth 0 straight through and left the engine 0x0.
    const engine = await createGlassEngine(canvas);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);

    engine.destroy();
  });

  it("resolves with a usable engine when the wasm module cannot be loaded", async () => {
    // A rejected wasm load must never escape createGlassEngine: consumers keep a working facade that
    // degrades to CSS. Mocked and imported inside this test so the rest of the file keeps loading the
    // real wasm binary.
    vi.resetModules();
    vi.doMock("@open-glass/core/wasm", () => ({
      default: () => Promise.reject(new Error("simulated wasm fetch failure")),
      init_panic_hook: () => {},
      calculate_fresnel: () => 0,
      RendererBackend: { Auto: 0, WebGpu: 1, WebGl2: 2 },
      WasmGlassEngine: class {},
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { createGlassEngine: create } = await import("../src/ts/index");
      const canvas = {
        width: 0,
        height: 0,
        clientWidth: 400,
        clientHeight: 200,
        getContext: vi.fn().mockReturnValue(null),
      } as unknown as HTMLCanvasElement;

      const engine = await create(canvas);

      expect(engine.backend).toBe("webgl2");
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(200);
      expect(engine.isRenderReady?.() ?? false).toBe(false);
      expect(() => engine.render()).not.toThrow();
      expect(warn).toHaveBeenCalled();

      engine.destroy();
    } finally {
      warn.mockRestore();
      vi.doUnmock("@open-glass/core/wasm");
      vi.resetModules();
    }
  });
});
