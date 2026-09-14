# open-glass

Apple Glass UI for the web. Today: a React component library that renders frosted glass with CSS. In progress: a Rust/WebAssembly optical core that will render the same components on the GPU with real refraction, dispersion and Kawase blur.

## Project Status

Pre-alpha. This section is the source of truth for what is real — the rest of this README describes the architecture being built toward.

### Working today

- **React component library** — `<GlassProvider>`, `<GlassCanvas>`, `<GlassCard>`, `<GlassWindow>`, `<GlassDock>`, `<GlassButton>`, `<GlassNavbar>`, rendering frosted glass via CSS `backdrop-filter`, with pointer event passthrough.
- **DOM-to-quad synchronization** — components measure their own layout and publish quad descriptors (position, size, corner radius, optical parameters) into the glass context, ready for a GPU consumer. Quads are measured in the canvas's own coordinate space, against the container the canvas fills (`containerRef`), not against whatever positioned ancestor a caller happens to introduce. The provider re-measures every registered element at the top of its `requestAnimationFrame` loop, so a dragged or scrolled panel's quad stays correct with no React render involved.
- **Explicit three-layer compositing model** — `packages/react/src/layers.ts` names the stacking order once: refracted content below (`GLASS_Z_UNDERLYING`), the glass canvas above it (`GLASS_Z_CANVAS`), and each panel's own borders, text and children above that (`GLASS_Z_SURFACE`). The container sets `isolation: isolate` so an ancestor's stacking context cannot reorder it, and `.open-glass-content` declares no `zIndex` — one there would trap the canvas below every descendant. Glass panels nested inside other glass panels are a documented limitation, not a supported case.
- **DOM background capture** — background content is serialized into an SVG `<foreignObject>` and rasterized to an offscreen canvas. `ensureXhtmlNamespace()` (`packages/core/src/ts/capture.ts:25`, applied at `capture.ts:201`) gives the serialized root the `xmlns="http://www.w3.org/1999/xhtml"` it needs to paint inside an SVG document, idempotently, so engines that already emit the attribute do not end up with a duplicate. The pipeline throttles to a frame interval, backs off exponentially on failure and trips a `maxFailures` circuit breaker instead of re-serializing the DOM forever, reporting each failure through `onError`. The raster feeds the Rust renderer as its backdrop texture.
- **Optical physics in Rust** — Snell's law refraction, Schlick's Fresnel approximation, chromatic dispersion and dual-Kawase sample offsets, unit-tested under `cargo test` and compiled to WebAssembly by `scripts/build-wasm.sh`.
- **WebGL2 render pipeline in Rust** — `WebGl2Renderer` takes the `HtmlCanvasElement` and acquires the `webgl2` context itself through `web-sys`, compiles `kawase_blur.frag` and `glass_composite.frag` against a fullscreen-triangle vertex stage, and issues draw calls for a 5-level dual-Kawase ping-pong blur followed by a per-quad rounded-rect composite with `OpticalParams` uniforms and alpha blending. Backdrop uploads from an `HTMLCanvasElement` or `OffscreenCanvas` are ingested by Rust. `createGlassEngine()` awaits `initWasmEngine()`, so the pipeline compiles its GLSL and draws in the browser; `packages/core/tests/webgl2_browser.rs` verifies both programs compile and link on a real driver under `wasm-pack test --headless --chrome` (`pnpm --filter @open-glass/core test:browser`), with a negative control proving the driver would reject a typo.
- **Engine facade & backend probing** — `createGlassEngine()` probes for WebGPU, negotiates a backend, awaits `initWasmEngine()` and acquires a WebGL2 context. A failed wasm load never rethrows: the facade still resolves, `isRenderReady()` stays `false`, and consumers degrade to the CSS fallback.
- **Playground app** — `apps/playground`, a Vite+ single-page app with a control for every optical parameter and live-updating numeric readouts, a macOS-style desktop scene and a visionOS-style spatial scene.

### Not implemented yet

- **The WebGPU backend.** `WebGpuRenderer::new` in `packages/core/src/renderer/webgpu.rs` deliberately fails at construction (`Err("WebGPU backend not yet implemented")`) so that `RendererBackend::Auto` falls back to the WebGL2 renderer; its `GlassRenderer` impl is therefore never reached.
- **The WGSL shaders are not wired up.** `packages/core/src/shaders/` holds `glass_composite.wgsl`, `kawase_down.wgsl` and `kawase_up.wgsl` for that backend; no code reads them yet. (The GLSL siblings `kawase_blur.frag` and `glass_composite.frag` _are_ compiled, by the WebGL2 renderer via `include_str!`.)
- **Per-quad `blurRadius` is not honoured.** `glass_composite.frag` samples a single `u_blurred_texture`, so `WebGl2Renderer::render` blurs the backdrop once at `average_blur_radius(&self.quads)` and every quad composites against that shared result. Two panels with different `blurRadius` values render identically.
- **The backdrop texture is always allocated.** `background_texture` is a plain `WebGlTexture` rather than an `Option`, seeded with a single transparent pixel, so `render()` composites over that placeholder when no backdrop has been uploaded.
- **`OpticalParams` do not affect rendering.** Every component publishes its optical parameters into the glass context, and the playground's `ControlsPanel` lets you edit them and shows the numeric values updating live, but each component's `backdrop-filter` is a hardcoded CSS literal: `GlassCard.tsx:68-69` (`blur(20px)`), `GlassNavbar.tsx:41-42` (`blur(24px) saturate(180%)`), `GlassDock.tsx:49-50` (`blur(28px) saturate(190%)`), `GlassWindow.tsx:171-172` (`blur(32px) saturate(180%)`), `GlassButton.tsx:88-89` (`blur(16px)`). `GlassCard` and `GlassWindow` now choose between their literal and `none` depending on whether the renderer reports itself ready — which is a switch between two constants, not a parameter being read. No CSS property reads an `OpticalParams` field. The parameters do now reach the GPU composite for `GlassCard` / `GlassWindow` quads, but the CSS literals of every other component are unaffected by them, so moving a slider changes nothing about `GlassDock`, `GlassNavbar` or `GlassButton`.

So: the physics is real and tested, the component API is real and usable, and the pipe between them is connected for `GlassCard` and `GlassWindow`.

## Roadmap

1. **Per-quad blur** — one blur chain per distinct `blurRadius` (or a mip-level uniform), so the shared `average_blur_radius` backdrop goes away.
2. **Background texture ingestion in Rust** — the remaining `BackgroundTextureSource` variants (`ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLVideoElement`) still upload from TypeScript.
3. **WebGPU backend** — the WGSL passes, once the WebGL2 path is proven; until then WebGPU negotiation should fall back to WebGL2.
4. **Performance & polish** — frame budgets, resize handling, reduced-motion and reduced-transparency support.

## Monorepo Architecture

```text
open-glass/
├── packages/
│   ├── core/         # Rust optical physics engine, WebGPU/WebGL2 shader sources, wasm + TS facade
│   └── react/        # Declarative React components & glass context bridge
└── apps/
    └── playground/   # Vite+ interactive showcase with a control per optical parameter
```

`packages/core` compiles the Rust optical crate to WebAssembly with `wasm-pack` and exposes it behind a
TypeScript facade (`createGlassEngine`, `initWasmEngine`, `calculateFresnel`). `packages/react` layers
declarative components on top, publishing each element's geometry as a glass quad. `apps/playground`
exercises the whole surface. It is **not** Storybook — it is a hand-written Vite+ single-page app.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v11+)
- [Rust](https://www.rust-lang.org/) (1.80+) with the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/)
- [Vite+](https://viteplus.dev/) (`vp`)

### Installation & Development

```bash
# Install dependencies
pnpm install

# Build the wasm core and workspace packages
pnpm run build

# Run the interactive playground
pnpm run dev

# Run all test suites
pnpm test
cargo test --workspace

# Lint and format checks
vp check
cargo clippy --workspace -- -D warnings
```

## Contributing

The Roadmap above is the priority order. If you are adding to the README, keep the Project Status
section honest: describe what the code does now, and put anything unbuilt under Roadmap.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([./LICENSE-APACHE](./LICENSE-APACHE))
- MIT License ([./LICENSE-MIT](./LICENSE-MIT))

at your option.
