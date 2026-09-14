# open-glass

Apple Glass UI for the web. Today: a React component library that renders frosted glass with CSS. In progress: a Rust/WebAssembly optical core that will render the same components on the GPU with real refraction, dispersion and Kawase blur.

## Project Status

Pre-alpha. This section is the source of truth for what is real — the rest of this README describes the architecture being built toward.

### Working today

- **React component library** — `<GlassProvider>`, `<GlassCanvas>`, `<GlassCard>`, `<GlassWindow>`, `<GlassDock>`, `<GlassButton>`, `<GlassNavbar>`, rendering frosted glass via CSS `backdrop-filter`, with pointer event passthrough.
- **DOM-to-quad synchronization** — components measure their own layout and publish quad descriptors (position, size, corner radius, optical parameters) into the glass context, ready for a GPU consumer.
- **Optical physics in Rust** — Snell's law refraction, Schlick's Fresnel approximation, chromatic dispersion and dual-Kawase sample offsets, unit-tested under `cargo test` and compiled to WebAssembly by `scripts/build-wasm.sh`.
- **WebGL2 render pipeline in Rust** — `WebGl2Renderer` takes the `HtmlCanvasElement` and acquires the `webgl2` context itself through `web-sys`, compiles `kawase_blur.frag` and `glass_composite.frag` against a fullscreen-triangle vertex stage, and issues draw calls for a 5-level dual-Kawase ping-pong blur followed by a per-quad rounded-rect composite with `OpticalParams` uniforms and alpha blending. Backdrop uploads from an `HTMLCanvasElement` or `OffscreenCanvas` are ingested by Rust. **Nothing in the browser calls it yet** — see below.
- **Engine facade & backend probing** — `createGlassEngine()` probes for WebGPU, negotiates a backend, and acquires a WebGL2 context.
- **Playground app** — `apps/playground`, a Vite+ single-page app with a control for every optical parameter and live-updating numeric readouts, a macOS-style desktop scene and a visionOS-style spatial scene.

### Not implemented yet

- **The WebGPU backend.** `WebGpuRenderer::new` in `packages/core/src/renderer/webgpu.rs` deliberately fails at construction (`Err("WebGPU backend not yet implemented")`) so that `RendererBackend::Auto` falls back to the WebGL2 renderer; its `GlassRenderer` impl is therefore never reached.
- **The WGSL shaders are not wired up.** `packages/core/src/shaders/` holds `glass_composite.wgsl`, `kawase_down.wgsl` and `kawase_up.wgsl` for that backend; no code reads them yet. (The GLSL siblings `kawase_blur.frag` and `glass_composite.frag` _are_ compiled, by the WebGL2 renderer via `include_str!`.)
- **The wasm engine does not run in the browser.** `initWasmEngine()` is exercised by the test suite only — the playground never calls it, so `isWasmEngineLoaded()` is `false` at runtime and the wasm code paths in the engine facade are inert. Every pixel of glass you see is CSS.
- **Per-quad `blurRadius` is not honoured.** `glass_composite.frag` samples a single `u_blurred_texture`, so `WebGl2Renderer::render` blurs the backdrop once at `average_blur_radius(&self.quads)` and every quad composites against that shared result. Two panels with different `blurRadius` values render identically.
- **The backdrop texture is always allocated.** `background_texture` is a plain `WebGlTexture` rather than an `Option`, seeded with a single transparent pixel, so `render()` composites over that placeholder when no backdrop has been uploaded.
- **`OpticalParams` do not affect rendering.** Every component publishes its optical parameters into the glass context, and the playground's `ControlsPanel` lets you edit them and shows the numeric values updating live, but each component's `backdrop-filter` is a hardcoded CSS literal: `GlassCard.tsx:66-67` (`blur(20px)`), `GlassNavbar.tsx:41-42` (`blur(24px) saturate(180%)`), `GlassDock.tsx:49-50` (`blur(28px) saturate(190%)`), `GlassWindow.tsx:159-160` (`blur(32px) saturate(180%)`), `GlassButton.tsx:84-85` (`blur(16px)`). No CSS property reads an `OpticalParams` field, so the sliders have no visual effect until the GPU renderer lands.
- **The DOM capture pipeline produces no usable texture yet.** Background content is serialized into an SVG `<foreignObject>` for rasterization, but the serialized `<div>` is missing the `xmlns="http://www.w3.org/1999/xhtml"` attribute it needs inside that SVG document (`packages/core/src/ts/capture.ts:142-143`), so the subtree paints nothing and the resulting raster is blank in real browsers.

So: the physics is real and tested, the component API is real and usable, and the pipe between them is not connected yet.

## Roadmap

1. **Initialize wasm at runtime** — have the playground and `GlassProvider` await `initWasmEngine()` so the engine is live in the browser.
2. **Per-quad blur** — one blur chain per distinct `blurRadius` (or a mip-level uniform), so the shared `average_blur_radius` backdrop goes away.
3. **Background texture ingestion in Rust** — the remaining `BackgroundTextureSource` variants (`ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLVideoElement`) still upload from TypeScript.
4. **WebGPU backend** — the WGSL passes, once the WebGL2 path is proven; until then WebGPU negotiation should fall back to WebGL2.
5. **Performance & polish** — frame budgets, resize handling, reduced-motion and reduced-transparency support.

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
