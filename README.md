# open-glass

Apple Glass UI for the web. Today: a React component library that renders frosted glass with CSS. In progress: a Rust/WebAssembly optical core that will render the same components on the GPU with real refraction, dispersion and Kawase blur.

## Project Status

Pre-alpha. This section is the source of truth for what is real — the rest of this README describes the architecture being built toward.

### Working today

- **React component library** — `<GlassProvider>`, `<GlassCanvas>`, `<GlassCard>`, `<GlassWindow>`, `<GlassDock>`, `<GlassButton>`, `<GlassNavbar>`, rendering frosted glass via CSS `backdrop-filter`, with pointer event passthrough.
- **DOM-to-quad synchronization** — components measure their own layout and publish quad descriptors (position, size, corner radius, optical parameters) into the glass context, ready for a GPU consumer.
- **DOM capture pipeline** — background content is captured to a texture source and handed to the engine facade.
- **Optical physics in Rust** — Snell's law refraction, Schlick's Fresnel approximation, chromatic dispersion and dual-Kawase sample offsets, unit-tested under `cargo test` and compiled to WebAssembly by `scripts/build-wasm.sh`.
- **Engine facade & backend probing** — `createGlassEngine()` probes for WebGPU, negotiates a backend, and acquires a WebGL2 context.
- **Playground app** — `apps/playground`, a Vite+ single-page app with live controls for every optical parameter, a macOS-style desktop scene and a visionOS-style spatial scene.

### Not implemented yet

- **GPU rendering.** `WebGl2Renderer::render` and `WebGpuRenderer::render` in `packages/core/src/renderer/` are stubs that return `Ok(())`. No shader is compiled and no draw call is issued.
- **The shaders are not wired up.** `packages/core/src/shaders/` holds WGSL and GLSL sources for the glass composite and Kawase passes; no code reads them yet.
- **The wasm engine does not run in the browser.** `initWasmEngine()` is exercised by the test suite only — the playground never calls it, so `isWasmEngineLoaded()` is `false` at runtime and the wasm code paths in the engine facade are inert. Every pixel of glass you see is CSS.
- **`web-sys` is declared but unused.** The GPU/canvas bindings are in `packages/core/Cargo.toml` awaiting the renderer implementation.

So: the physics is real and tested, the component API is real and usable, and the pipe between them is not connected yet.

## Roadmap

1. **Real WebGL2 renderer** — compile the GLSL passes, ping-pong FBOs for dual-Kawase blur, rounded-rect composite with `OpticalParams` uniforms and alpha blending. Rust owns the GL context via `web-sys`.
2. **Initialize wasm at runtime** — have the playground and `GlassProvider` await `initWasmEngine()` so the engine is live in the browser.
3. **Background texture ingestion in Rust** — move the captured DOM texture upload behind the wasm boundary.
4. **WebGPU backend** — the WGSL passes, once the WebGL2 path is proven; until then WebGPU negotiation should fall back to WebGL2.
5. **Performance & polish** — frame budgets, resize handling, reduced-motion and reduced-transparency support.

## Monorepo Architecture

```text
open-glass/
├── packages/
│   ├── core/         # Rust optical physics engine, WebGPU/WebGL2 shader sources, wasm + TS facade
│   └── react/        # Declarative React components & glass context bridge
└── apps/
    └── playground/   # Vite+ interactive showcase with live optical controls
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

MIT OR Apache-2.0
