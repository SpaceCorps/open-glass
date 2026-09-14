import initWasm, {
  calculate_fresnel,
  init_panic_hook,
  RendererBackend,
  WasmGlassEngine,
} from "@open-glass/core/wasm";
import type {
  BackgroundTextureSource,
  GlassEngine,
  GlassEngineConfig,
  GlassQuadDescriptor,
  GlassRendererBackend,
  OpticalParams,
} from "./types";

export * from "./types";
export * from "./capture";

export type { InitInput, InitOutput, SyncInitInput } from "@open-glass/core/wasm";

export { calculate_fresnel, init_panic_hook, RendererBackend, WasmGlassEngine };

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

let wasmEngineLoaded = false;

/**
 * Check whether the WebAssembly optical engine is initialized and ready.
 */
export function isWasmEngineLoaded(): boolean {
  return wasmEngineLoaded;
}

/**
 * Initialize the open-glass WebAssembly optical engine.
 *
 * @param wasmModuleUrlOrBuffer Optional module source (URL, Response, ArrayBuffer, BufferSource, or WebAssembly.Module).
 * In browser contexts, defaults to the bundled wasm binary loaded via standard ES module mechanisms.
 * In Node.js / test environments, automatically resolves and loads the local wasm binary if no argument is provided.
 */
export async function initWasmEngine(
  wasmModuleUrlOrBuffer?:
    | string
    | ArrayBuffer
    | ArrayBufferView
    | Response
    | URL
    | WebAssembly.Module,
): Promise<void> {
  if (wasmEngineLoaded) {
    return;
  }

  let source: unknown = wasmModuleUrlOrBuffer;

  // In Node.js environments where fetch does not support file:// URLs,
  // load the wasm file directly into a buffer if no custom source is provided.
  if (typeof source === "undefined" && typeof process !== "undefined" && process.versions?.node) {
    try {
      const { existsSync, readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const candidate1 = fileURLToPath(new URL("./wasm/open_glass_core_bg.wasm", import.meta.url));
      const candidate2 = fileURLToPath(
        new URL("../../dist/wasm/open_glass_core_bg.wasm", import.meta.url),
      );
      if (existsSync(candidate1)) {
        source = readFileSync(candidate1);
      } else if (existsSync(candidate2)) {
        source = readFileSync(candidate2);
      }
    } catch {
      // Fall through to standard default loader
    }
  }

  if (source !== undefined) {
    await initWasm({ module_or_path: source as any });
  } else {
    await initWasm();
  }

  try {
    init_panic_hook();
  } catch {
    // Console panic hook initialization is best-effort
  }

  wasmEngineLoaded = true;
}

/**
 * Calculate Fresnel reflectance using Schlick's approximation.
 * Delegates to the Rust WebAssembly implementation when initialized, or uses a TypeScript fallback.
 */
export function calculateFresnel(cosTheta: number, n1: number, n2: number): number {
  if (wasmEngineLoaded) {
    return calculate_fresnel(cosTheta, n1, n2);
  }
  const r0 = Math.pow((n1 - n2) / (n1 + n2), 2);
  const clampedCos = Math.max(0, Math.min(1, cosTheta));
  return r0 + (1 - r0) * Math.pow(1 - clampedCos, 5);
}

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
  private wasmEngine: WasmGlassEngine | null = null;
  private destroyed = false;
  private backgroundSource: BackgroundTextureSource | null = null;
  private bgTextureWebGL: WebGLTexture | null = null;
  private bgTextureWebGPU: unknown = null;

  constructor(canvas: HTMLCanvasElement, backend: "webgpu" | "webgl2") {
    this.canvas = canvas;
    this.backend = backend;
    this.initContext();
    this.initWasm();
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

  private initWasm(): void {
    if (isWasmEngineLoaded()) {
      try {
        const backendEnum =
          this.backend === "webgpu" ? RendererBackend.WebGpu : RendererBackend.WebGl2;
        const width = this.canvas.width || 300;
        const height = this.canvas.height || 150;
        this.wasmEngine = new WasmGlassEngine(this.canvas, backendEnum, width, height);
      } catch {
        // Fall back gracefully to pure JS/WebGL2 if WasmGlassEngine construction fails
        this.wasmEngine = null;
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
    if (this.wasmEngine) {
      try {
        this.wasmEngine.resize(width, height);
      } catch {
        // ignore
      }
    }
  }

  updateQuads(quads: GlassQuadDescriptor[]): void {
    if (this.destroyed) return;
    this.quads = [...quads];
    if (!this.wasmEngine && isWasmEngineLoaded()) {
      this.initWasm();
    }
    if (this.wasmEngine) {
      try {
        this.wasmEngine.clear_quads();
        for (const quad of quads) {
          const optical = { ...DEFAULT_OPTICAL_PARAMS, ...quad.optical };
          this.wasmEngine.add_quad(
            quad.x,
            quad.y,
            quad.width,
            quad.height,
            quad.cornerRadius,
            optical.ior,
            optical.blurRadius,
            optical.dispersion,
            optical.rimPower,
            optical.sheenIntensity,
            optical.lightAngle,
            optical.roughness,
            optical.tintColor[0],
            optical.tintColor[1],
            optical.tintColor[2],
            optical.tintColor[3],
          );
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Hand a canvas-backed backdrop to the Rust renderer, which owns the WebGL2 background texture.
   * Returns false when Rust cannot accept this source, so the caller falls back to the JS upload.
   */
  private uploadBackgroundViaWasm(source: BackgroundTextureSource): boolean {
    if (!this.wasmEngine) return false;
    try {
      if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
        this.wasmEngine.set_background_from_canvas(source);
        return true;
      }
      if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
        this.wasmEngine.set_background_from_offscreen_canvas(source);
        return true;
      }
    } catch {
      // Fall through to the JS texImage2D path if the Rust upload rejects the source
    }
    return false;
  }

  updateBackgroundSource(source: BackgroundTextureSource): void {
    if (this.destroyed) return;
    this.backgroundSource = source;

    // ImageBitmap / ImageData / HTMLImageElement / HTMLVideoElement are not accepted by the Rust
    // entry points, so those keep using the JS upload below.
    if (this.backend === "webgl2" && this.uploadBackgroundViaWasm(source)) {
      return;
    }

    if (this.backend === "webgl2" && this.glContext) {
      const gl = this.glContext;
      try {
        if (!this.bgTextureWebGL) {
          this.bgTextureWebGL = gl.createTexture();
        }
        if (this.bgTextureWebGL) {
          gl.bindTexture(gl.TEXTURE_2D, this.bgTextureWebGL);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            source as TexImageSource,
          );
        }
      } catch {
        // Fallback gracefully if context is mock or in headless environment
      }
    } else if (this.backend === "webgpu") {
      try {
        const gpuNav = typeof navigator !== "undefined" ? (navigator as any).gpu : null;
        if (gpuNav && (this.canvas as any)._gpuDevice) {
          const device = (this.canvas as any)._gpuDevice;
          const width = (source as any).width || this.canvas.width || 300;
          const height = (source as any).height || this.canvas.height || 150;
          if (!this.bgTextureWebGPU && device.createTexture) {
            this.bgTextureWebGPU = device.createTexture({
              size: [width, height, 1],
              format: "rgba8unorm",
              usage: 0x04 | 0x08 | 0x10, // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT
            });
          }
          if (this.bgTextureWebGPU && device.queue?.copyExternalImageToTexture) {
            device.queue.copyExternalImageToTexture(
              { source: source as any },
              { texture: this.bgTextureWebGPU },
              [width, height],
            );
          }
        }
      } catch {
        // Fallback gracefully
      }
    }
  }

  hasBackgroundSource(): boolean {
    return this.backgroundSource !== null;
  }

  render(): void {
    if (this.destroyed) return;
    if (!this.wasmEngine && isWasmEngineLoaded()) {
      this.initWasm();
    }
    if (this.wasmEngine) {
      try {
        this.wasmEngine.render();
        return;
      } catch {
        // Fallback to WebGL2 clear if wasm render errors in headless/mock context
      }
    }
    if (this.glContext) {
      const gl = this.glContext;
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.wasmEngine) {
      try {
        this.wasmEngine.free();
      } catch {
        // ignore
      }
      this.wasmEngine = null;
    }
    if (this.glContext && this.bgTextureWebGL) {
      try {
        this.glContext.deleteTexture(this.bgTextureWebGL);
      } catch {
        // ignore
      }
      this.bgTextureWebGL = null;
    }
    if (this.bgTextureWebGPU) {
      try {
        (this.bgTextureWebGPU as any).destroy?.();
      } catch {
        // ignore
      }
      this.bgTextureWebGPU = null;
    }
    this.backgroundSource = null;
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
