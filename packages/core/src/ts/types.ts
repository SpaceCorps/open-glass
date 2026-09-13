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
  render(): void;
  destroy(): void;
}
