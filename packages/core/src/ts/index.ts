import initWasm, {
  calculate_fresnel,
  init_panic_hook,
  max_backdrop_bands,
  RendererBackend,
  WasmGlassEngine,
} from "@open-glass/core/wasm";
import { AUTO_BACKDROP_DEPTH } from "./bands";
import type {
  BackgroundTextureSource,
  GlassEngine,
  GlassEngineConfig,
  GlassQuadDescriptor,
  GlassRendererBackend,
  OpticalParams,
} from "./types";
import { warnOnce } from "./warn";

export * from "./types";
export * from "./capture";
export * from "./bands";

export type { InitInput, InitOutput, SyncInitInput } from "@open-glass/core/wasm";

export { calculate_fresnel, init_panic_hook, RendererBackend, WasmGlassEngine };

/**
 * Whether the renderer backend composites real pixels.
 *
 * `WebGl2Renderer` in `packages/core/src/renderer/webgl2.rs` is a complete dual-Kawase blur plus
 * rounded-rect composite pipeline, and `createGlassEngine()` now awaits `initWasmEngine()` before it
 * constructs the facade, so the renderer compiles its GLSL programs and issues draw calls at runtime
 * in the browser.
 *
 * The claim is measured, not assumed. `packages/core/tests/webgl2_browser.rs` uploads a
 * four-quadrant backdrop under `wasm-pack test --headless --chrome`, renders a panel over it and reads
 * the framebuffer back, asserting the interior is non-uniform and that each sample tracks the DOM
 * quadrant beneath it. In the playground under headless Chrome, hiding the glass canvas while leaving
 * the DOM untouched changes the pixels inside every panel and nothing outside one, and the mean
 * absolute luma gradient inside a panel measures ~1.5 with the canvas compositing against ~9.8 without
 * it: fine detail removed, large-scale structure kept, which is a blur rather than a flat fill.
 *
 * This flag is a static claim about the backend, not about any particular engine instance: it says
 * the WebGL2 path draws pixels when it comes up. Per-instance readiness is `isRenderReady()`, which
 * additionally requires a live `wasmEngine` (wasm loaded and the renderer constructed), a
 * `backgroundSource`, and a backdrop the renderer confirms it actually holds
 * (`WasmGlassEngine.has_real_background()`) — a headless context, a blocked wasm fetch, a rejected
 * texture upload or a capture that never rasterized all leave it `false` while this stays `true`.
 *
 * That last requirement is not belt-and-braces. `glass_composite.frag` writes `alpha = 1.0` across the
 * whole rounded-box SDF, so compositing over an empty backdrop paints a uniform opaque rectangle over
 * the DOM — worse than the CSS fallback. `WebGl2Renderer::render` skips the composite pass entirely
 * until a backdrop upload has succeeded, and this gate is what keeps consumers on CSS until then.
 *
 * Consumers key their CSS fallback off `GlassEngine.isRenderReady()`, never off
 * `hasBackgroundSource()` — an uploaded texture says nothing about whether anything was drawn with it.
 */
export const RENDERER_PRODUCES_PIXELS: boolean = true;

export const DEFAULT_OPTICAL_PARAMS: Required<OpticalParams> = {
  ior: 1.52,
  blurRadius: 16,
  dispersion: 0.04,
  rimPower: 3.5,
  sheenIntensity: 0.75,
  lightAngle: Math.PI / 4,
  roughness: 0.03,
  // The `saturate(180%)` every CSS fallback literal uses, so the handover to the GPU composite does
  // not visibly drain the colour out of the backdrop.
  saturation: 1.8,
  // Replaces the light the readiness handover takes away when the fallback overlay drops from alpha
  // 0.22 to 0.05, so the composite matches the CSS fallback's measured mean luma of 158 instead of
  // reading 1.4x darker. Must stay in step with `OpticalParams::default().brightness` in
  // `packages/core/src/optical/physics.rs`.
  brightness: 1.5,
  // A standard slab: thick enough that the ray's internal travel shifts the backdrop it lands on,
  // thin enough that the panel still reads as a pane rather than a block.
  thickness: 10.0,
  // Subtle macOS parity: the body magnifies the backdrop by ~2.5% of the panel's half-size, which is
  // the continuous body lensing Apple Glass shows without turning the window into a fisheye. Must stay
  // in step with `OpticalParams::default()` in `packages/core/src/optical/physics.rs`.
  curvature: 0.1,
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
 * How many depth bands the backdrop can be split into.
 *
 * Read from Rust (`max_backdrop_bands()`) once the wasm engine is loaded, so the band assignment on the
 * capture side cannot disagree with the number of samplers `glass_composite.frag` declares — a fourth
 * band would be uploaded, ignored by the shader, and its content would simply not appear in the glass.
 * The literal is only the value before wasm is up, where nothing uploads anything anyway.
 */
export let MAX_BACKDROP_BANDS = 3;

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

  try {
    const bands = max_backdrop_bands();
    if (bands > 0) {
      MAX_BACKDROP_BANDS = bands;
    }
  } catch {
    // An older wasm binary without the export: keep the literal, which is the value that binary was
    // built with.
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
    } else {
      console.warn(
        "[open-glass] WebGPU is supported by this browser but the WebGPU renderer is not " +
          "implemented yet; falling back to WebGL2.",
      );
    }
    return "webgl2";
  }
  // Auto negotiation always lands on WebGL2 while `WebGpuRenderer::new` is a stub that unconditionally
  // returns Err (see packages/core/src/renderer/webgpu.rs). Reporting "webgpu" off a resolving
  // `requestAdapter()` — true on any ordinary modern Chrome — was a lie with teeth: `WasmGlassEngine`
  // silently falls back to `WebGl2Renderer`, so a live WebGL2 renderer would be labelled "webgpu" and
  // every backend-gated code path skipped over it. This returns the backend that will actually run.
  return "webgl2";
}

class GlassEngineImpl implements GlassEngine {
  readonly backend: "webgpu" | "webgl2";
  readonly canvas: HTMLCanvasElement;
  private quads: GlassQuadDescriptor[] = [];
  private glContext: WebGL2RenderingContext | null = null;
  private wasmEngine: WasmGlassEngine | null = null;
  private destroyed = false;
  private backgroundSource: BackgroundTextureSource | null = null;
  // No JS-side WebGL background texture. There used to be one, filled by a `texImage2D` fallback in
  // `updateBackgroundSource`, and nothing in the repo ever sampled it: `WebGl2Renderer` owns its own
  // `background_texture` and the composite shader only ever reads the blur mip chain. The fallback
  // wrote pixels into a texture that was allocated, uploaded to and deleted without being drawn, which
  // made a failed Rust upload look survivable. Removed rather than kept as a decorative no-op.
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
      } catch (error) {
        // Fall back gracefully to the CSS path if WasmGlassEngine construction fails — but say why.
        // `WebGl2Renderer::new` formats the driver's own info log (`shader compilation failed: {log}`,
        // `program link failed: {log}`, `blur framebuffer is incomplete (status {status})`) and this
        // catch used to discard all of it, so a GLSL error presented as glass that never turned on.
        this.wasmEngine = null;
        warnOnce(
          "wasm-renderer-construction",
          "the wasm glass renderer could not be constructed; falling back to CSS glass:",
          error,
        );
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
          // Positional, and the order must mirror `OpticalParams`' field order in
          // `packages/core/src/optical/physics.rs`. A swap here is silent — it would feed the
          // saturation or brightness into a tint channel — so `packages/core/tests/webgl2_browser.rs`'s
          // `the_saturation_term_reaches_the_composite` and `the_brightness_term_holds_the_handover_luma`,
          // plus `engine.test.ts`' argument-order assertion, all pin it.
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
            optical.saturation,
            optical.brightness,
            optical.thickness,
            optical.curvature,
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
   * Hand one band's canvas-backed raster to the Rust renderer, which owns the WebGL2 band textures.
   *
   * `uploaded` is false when Rust cannot accept this source, so the caller falls back to the JS
   * upload. `error` carries a thrown rejection rather than warning about it here: the JS path may
   * still accept the same source, and only a failure of *both* paths is worth telling anyone about.
   */
  private uploadBandViaWasm(
    band: number,
    source: BackgroundTextureSource,
    depth: number,
  ): {
    uploaded: boolean;
    error: unknown;
  } {
    if (!this.wasmEngine) return { uploaded: false, error: null };
    try {
      if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
        this.wasmEngine.set_band_from_canvas(band, source, depth);
        return { uploaded: true, error: null };
      }
      if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
        this.wasmEngine.set_band_from_offscreen_canvas(band, source, depth);
        return { uploaded: true, error: null };
      }
    } catch (error) {
      return { uploaded: false, error };
    }
    return { uploaded: false, error: null };
  }

  /**
   * Upload one depth band's raster, band 0 farthest.
   *
   * `depth` is the distance in pixels behind the glass' rear face; omitted, it is
   * [`AUTO_BACKDROP_DEPTH`], which asks the shader for the depth calibrated from the panel's own size.
   * Uploading past `MAX_BACKDROP_BANDS` is rejected by Rust and warned about here rather than silently
   * ignored, because a band the shader never samples means content missing from the glass.
   */
  updateBackdropBand(
    band: number,
    source: BackgroundTextureSource,
    depth: number = AUTO_BACKDROP_DEPTH,
  ): void {
    if (this.destroyed) return;
    this.backgroundSource = source;

    // Thrown upload failures accumulate here instead of being swallowed. A tainted capture canvas
    // makes *every* upload route throw `SecurityError`, and with both catches silent the symptom was
    // glass that composites over a permanently blank texture — flat, and with nothing in the console.
    let uploadError: unknown = null;

    // Routed off the presence of the wasm engine, deliberately not off `this.backend`. The renderer
    // that actually runs is `WebGl2Renderer` whatever `negotiateBackend` reported, so gating the
    // upload on `backend === "webgl2"` meant a browser negotiated onto any other backend kept a live
    // wasm renderer that could never be handed a backdrop — and composited a grey block over the DOM
    // because `backgroundSource` was assigned anyway.
    //
    // ImageBitmap / ImageData / HTMLImageElement / HTMLVideoElement are not accepted by the Rust
    // entry points; those sources leave the backdrop untouched, which `isRenderReady()` reflects.
    if (this.wasmEngine) {
      const wasmUpload = this.uploadBandViaWasm(band, source, depth);
      if (wasmUpload.uploaded) {
        return;
      }
      uploadError = wasmUpload.error;
    }

    if (this.backend === "webgpu") {
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
      } catch (error) {
        uploadError = error;
      }
    }

    if (uploadError) {
      warnOnce(
        "background-texture-upload",
        "failed to upload the backdrop texture; the glass composite has no content to refract " +
          "and will render flat:",
        uploadError,
      );
    }
  }

  releaseBackdropBandsFrom(band: number): void {
    if (this.destroyed) return;
    if (!this.wasmEngine) return;
    try {
      this.wasmEngine.release_bands_from(band);
    } catch (error) {
      // An older wasm binary without the export. Warn rather than swallow: a band that keeps being
      // sampled after its content layer unmounted refracts a raster of something that is no longer on
      // the page, which looks like a rendering bug with no obvious cause.
      warnOnce("backdrop-band-release", "failed to release backdrop bands:", error);
    }
  }

  /**
   * The single-band path every consumer outside the provider still uses.
   *
   * One raster at the calibrated depth *and* a release of everything nearer, so a caller that switches
   * from the banded API back to this one does not leave a stale near band being refracted over its new
   * backdrop.
   */
  updateBackgroundSource(source: BackgroundTextureSource): void {
    this.updateBackdropBand(0, source, AUTO_BACKDROP_DEPTH);
    this.releaseBackdropBandsFrom(1);
  }

  hasBackgroundSource(): boolean {
    return this.backgroundSource !== null;
  }

  /**
   * Whether the renderer holds a backdrop raster it can actually refract.
   *
   * Asked of Rust rather than inferred from `backgroundSource`, because assigning that field says
   * only that a source was handed over — not that `texImage2D` accepted it. `WebGl2Renderer` sets its
   * own flag exclusively on a successful upload, never for the 1x1 transparent seed it allocates at
   * construction.
   */
  private hasRealBackdrop(): boolean {
    if (!this.wasmEngine) return false;
    try {
      return this.wasmEngine.has_real_background();
    } catch {
      // An older wasm binary without the export: treat the unknown as not ready rather than claiming
      // a backdrop we cannot confirm.
      return false;
    }
  }

  isRenderReady(): boolean {
    return (
      RENDERER_PRODUCES_PIXELS &&
      !this.destroyed &&
      this.backgroundSource !== null &&
      this.wasmEngine !== null &&
      // A live renderer is not a drawn frame: without a real backdrop the composite pass is skipped
      // (see WebGl2Renderer::render), so reporting readiness here would strip every consumer's CSS
      // blur in exchange for an empty canvas.
      this.hasRealBackdrop()
    );
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
      } catch (error) {
        // Fallback to a WebGL2 clear if wasm render errors in a headless/mock context.
        warnOnce("wasm-render", "the wasm renderer threw while drawing a frame:", error);
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

  // Mount the wasm optical engine before constructing the facade: GlassEngineImpl's constructor only
  // builds a WasmGlassEngine when isWasmEngineLoaded() is already true. Failure here is not fatal —
  // no WebGL2, a blocked wasm fetch or a headless context must still yield a working engine that
  // degrades to the CSS fallback, so this never rethrows.
  try {
    await initWasmEngine();
  } catch (error) {
    console.warn(
      "[open-glass] wasm optical engine failed to initialize; using CSS fallback:",
      error,
    );
  }

  const engine = new GlassEngineImpl(canvas, backend);

  // An explicit zero check, not `??`: an unlaid-out canvas reports clientWidth 0, which is a
  // perfectly defined number, so `??` would never fire and the engine would start 0x0.
  const measuredWidth = canvas.clientWidth > 0 ? canvas.clientWidth : 300;
  const measuredHeight = canvas.clientHeight > 0 ? canvas.clientHeight : 150;
  const initialWidth = config.width && config.width > 0 ? config.width : measuredWidth;
  const initialHeight = config.height && config.height > 0 ? config.height : measuredHeight;
  engine.resize(initialWidth, initialHeight);

  return engine;
}
