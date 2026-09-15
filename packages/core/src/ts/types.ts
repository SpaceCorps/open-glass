export interface OpticalParams {
  /** Index of Refraction (e.g. 1.0 = air, 1.49 = acrylic, 1.52 = crown glass). */
  ior?: number;
  /** Dual Kawase frosted glass blur radius in pixels. */
  blurRadius?: number;
  /** Chromatic aberration spectral dispersion coefficient. */
  dispersion?: number;
  /** Specular rim lighting falloff power. */
  rimPower?: number;
  /** Fresnel sheen intensity along glass boundaries. */
  sheenIntensity?: number;
  /** Directional light angle in radians. */
  lightAngle?: number;
  /** Surface micro-roughness / frosting grain intensity. */
  roughness?: number;
  /**
   * Chroma boost applied after the tint mix; 1.0 leaves the backdrop's saturation untouched, 1.8
   * matches the CSS `saturate(180%)` fallback.
   */
  saturation?: number;
  /**
   * Multiplicative exposure gain applied after the saturation clamp and before the additive sheen;
   * 1.0 leaves the composite as the blur chain produced it, 1.5 matches the mean luma of the CSS
   * fallback the readiness handover replaces. Unlike more tint alpha, a gain lifts chroma with luma.
   */
  brightness?: number;
  /**
   * Physical thickness of the glass slab in pixels. The refraction model propagates the entering ray
   * across this depth before it exits through the rear face, so thickness is what makes the entry
   * deviation visible at all; 0 collapses the slab to a thin sheet that bends light only at its bevel.
   */
  thickness?: number;
  /**
   * Curvature of the volumetric lens spanning the glass body: the convex dome's sag as a fraction of
   * the panel's half-size. The dome tilts the front-surface normal outward from the centre, which
   * converges the transmitted rays and so magnifies the backdrop. 0 is a flat pane that bends light
   * only at its perimeter, 0.10 is the subtle macOS-parity default, 0.25 reads as an obvious lens.
   */
  curvature?: number;
  /** Surface glass tint color (RGBA normalized 0.0 - 1.0). */
  tintColor?: [number, number, number, number];
}

export interface GlassQuadDescriptor {
  id: string | number;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
  optical?: OpticalParams;
}

export type GlassRendererBackend = "auto" | "webgpu" | "webgl2";

export type BackgroundTextureSource =
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | ImageData
  | HTMLImageElement
  | HTMLVideoElement;

export interface GlassEngineConfig {
  backend?: GlassRendererBackend;
  width?: number;
  height?: number;
  pixelRatio?: number;
  /** Enable automatic offscreen framebuffer allocation for background sampling. */
  enableBackgroundCapture?: boolean;
}

export interface GlassEngine {
  readonly backend: "webgpu" | "webgl2";
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  updateQuads(quads: GlassQuadDescriptor[]): void;
  /** Ingest an external image source or offscreen canvas as the background texture. */
  updateBackgroundSource(source: BackgroundTextureSource): void;
  /** Check if a valid background texture has been provided. */
  hasBackgroundSource(): boolean;
  /**
   * Whether the backend is actually compositing glass pixels, so consumers can drop their CSS
   * fallback. Optional: a stand-in engine need not implement it, and callers must treat a missing
   * implementation as `false` (`engine.isRenderReady?.() ?? false`).
   */
  isRenderReady?(): boolean;
  render(): void;
  destroy(): void;
}
