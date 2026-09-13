import { describe, expect, it, vi } from "vite-plus/test";
import { createGlassEngine, negotiateBackend, probeWebGpuSupport } from "../src/ts/index";

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
});
