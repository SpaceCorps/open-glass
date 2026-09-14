import { describe, expect, it, vi } from "vite-plus/test";
import {
  createGlassEngine,
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

  it("negotiates webgpu if navigator.gpu is present and adapter resolves", async () => {
    const originalNavigator = globalThis.navigator;
    // Mock navigator.gpu
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
      const backend = await negotiateBackend("auto");
      expect(backend).toBe("webgpu");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
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
