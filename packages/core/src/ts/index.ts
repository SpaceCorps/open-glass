import type {
  GlassEngine,
  GlassEngineConfig,
  GlassQuadDescriptor,
  GlassRendererBackend,
  OpticalParams,
} from "./types";

export * from "./types";

export const DEFAULT_OPTICAL_PARAMS: Required<OpticalParams> = {
  ior: 1.52,
  blurRadius: 16,
  dispersion: 0.04,
  rimPower: 3.5,
  sheenIntensity: 0.75,
  lightAngle: Math.PI / 4,
  roughness: 0.03,
  tintColor: [1.0, 1.0, 1.0, 0.12],
};

/**
 * Probe WebGPU availability in the current browsing context.
 */
export async function probeWebGpuSupport(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return false;
  }
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Determine the active graphics backend given the user configuration.
 */
export async function negotiateBackend(
  requested: GlassRendererBackend = "auto",
): Promise<"webgpu" | "webgl2"> {
  if (requested === "webgl2") {
    return "webgl2";
  }
  if (requested === "webgpu") {
    const hasWebGpu = await probeWebGpuSupport();
    if (!hasWebGpu) {
      console.warn("[open-glass] WebGPU requested but not supported; falling back to WebGL2.");
      return "webgl2";
    }
    return "webgpu";
  }
  // Auto negotiation
  const hasWebGpu = await probeWebGpuSupport();
  return hasWebGpu ? "webgpu" : "webgl2";
}

class GlassEngineImpl implements GlassEngine {
  readonly backend: "webgpu" | "webgl2";
  readonly canvas: HTMLCanvasElement;
  private quads: GlassQuadDescriptor[] = [];
  private glContext: WebGL2RenderingContext | null = null;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, backend: "webgpu" | "webgl2") {
    this.canvas = canvas;
    this.backend = backend;
    this.initContext();
  }

  private initContext(): void {
    if (this.backend === "webgl2") {
      try {
        this.glContext = this.canvas.getContext("webgl2", {
          alpha: true,
          premultipliedAlpha: false,
          antialias: true,
        });
      } catch {
        this.glContext = null;
      }
    }
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.glContext) {
      this.glContext.viewport(0, 0, width, height);
    }
  }

  updateQuads(quads: GlassQuadDescriptor[]): void {
    if (this.destroyed) return;
    this.quads = [...quads];
  }

  render(): void {
    if (this.destroyed) return;
    if (this.glContext) {
      const gl = this.glContext;
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // In WebGL2 mode, execute FBO ping-pong blur and composite passes
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.quads = [];
    this.glContext = null;
  }
}

/**
 * Initialize an Apple Glass optical GPU engine on the given HTML canvas element.
 */
export async function createGlassEngine(
  canvas: HTMLCanvasElement,
  config: GlassEngineConfig = {},
): Promise<GlassEngine> {
  const backend = await negotiateBackend(config.backend ?? "auto");
  const engine = new GlassEngineImpl(canvas, backend);

  const initialWidth = config.width ?? canvas.clientWidth ?? 300;
  const initialHeight = config.height ?? canvas.clientHeight ?? 150;
  engine.resize(initialWidth, initialHeight);

  return engine;
}
