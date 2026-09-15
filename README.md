# open-glass

Apple Glass UI for the web. A React component library that renders frosted glass, backed by a Rust/WebAssembly optical core that refracts the live DOM on the GPU with dual-Kawase blur, dual-surface Snell's-law refraction through a volumetric glass slab and chromatic dispersion — and falls back to CSS `backdrop-filter` wherever that pipeline cannot come up.

## Project Status

Pre-alpha. This section is the source of truth for what is real — the rest of this README describes the architecture being built toward.

### Working today

- **React component library** — `<GlassProvider>`, `<GlassCanvas>`, `<GlassCard>`, `<GlassWindow>`, `<GlassDock>`, `<GlassButton>`, `<GlassNavbar>`, rendering frosted glass via CSS `backdrop-filter`, with pointer event passthrough.
- **DOM-to-quad synchronization** — components measure their own layout and publish quad descriptors (position, size, corner radius, optical parameters) into the glass context, ready for a GPU consumer. Quads are measured in the canvas's own coordinate space, against the container the canvas fills (`containerRef`), not against whatever positioned ancestor a caller happens to introduce. The provider re-measures every registered element at the top of its `requestAnimationFrame` loop, so a dragged or scrolled panel's quad stays correct with no React render involved.
- **Explicit three-layer compositing model** — `packages/react/src/layers.ts` names the stacking order once: refracted content below (`GLASS_Z_UNDERLYING`), the glass canvas above it (`GLASS_Z_CANVAS`), and each panel's own borders, text and children above that (`GLASS_Z_SURFACE`). The container sets `isolation: isolate` so an ancestor's stacking context cannot reorder it, and `.open-glass-content` declares no `zIndex` — one there would trap the canvas below every descendant. Glass panels nested inside other glass panels are a documented limitation, not a supported case.
- **DOM background capture** — background content is serialized into an SVG `<foreignObject>` and rasterized to an offscreen canvas. `ensureXhtmlNamespace()` (`packages/core/src/ts/capture.ts:25`, applied at `capture.ts:201`) gives the serialized root the `xmlns="http://www.w3.org/1999/xhtml"` it needs to paint inside an SVG document, idempotently, so engines that already emit the attribute do not end up with a duplicate. The pipeline throttles to a frame interval, backs off exponentially on failure and trips a `maxFailures` circuit breaker instead of re-serializing the DOM forever, reporting each failure through `onError`. The raster feeds the Rust renderer as its backdrop texture.
- **Optical physics in Rust** — Snell's law refraction, Schlick's Fresnel approximation, chromatic dispersion and dual-Kawase sample offsets, unit-tested under `cargo test` and compiled to WebAssembly by `scripts/build-wasm.sh`. The glass is modelled as a **slab with two interfaces**, not a single film: `dual_surface_refraction_offset` refracts the view ray into the glass at the front face, propagates it across `thickness` (default 10px), refracts it out again at the rear face — total internal reflection included — and returns the pixel displacement of the backdrop the ray finally lands on. Across the panel body the front normal carries a plano-convex dome, `volumetric_lens_normal`, whose sag is `curvature` (default 0.10) as a fraction of the panel's half-size; the dome tilts outward, so the transmitted rays converge and the body magnifies the backdrop — by ~2.5% of the panel's half-size at the default, which `BODY_LENS_DEPTH_SCALE` is calibrated to and a test asserts.
- **WebGL2 render pipeline in Rust** — `WebGl2Renderer` takes the `HtmlCanvasElement` and acquires the `webgl2` context itself through `web-sys`, compiles `kawase_blur.frag` and `glass_composite.frag` against a fullscreen-triangle vertex stage, and issues draw calls for a dual-Kawase ping-pong blur (traversed to a depth derived from `blur_radius`, up to 5 levels) followed by a per-quad rounded-rect composite with `OpticalParams` uniforms and alpha blending. **The composite refracts through both faces of the slab, everywhere on the panel.** It builds a front normal (the rim's SDF-gradient bevel plus the body's volumetric dome) and a rear normal (flat across the body, rolling into an inner bevel just inside the perimeter), then traces entry refraction, travel across `u_thickness` and exit refraction for each of R, G and B at its own index of refraction — so dispersion is now a real wavelength-dependent spread accumulated over two interfaces rather than one shared offset scaled per channel, and the rear face's inner bevel lights up the way the inside edge of thick glass does. Before this, `(1 - edge_proximity)` pinned every normal more than 8px inside the boundary to `(0, 0, 1)`, so the window body bent no light at all. The composite also applies a luma-preserving saturation term after the tint mix (`u_saturation`, default 1.8 — the `saturate(180%)` every CSS fallback literal uses) and then a multiplicative exposure gain (`u_brightness`, default 1.5) that buys back the luma the handover drops when the CSS overlay goes from alpha 0.22 to 0.05; the gain lands after the saturation clamp and before the additive sheen, so highlights are not scaled. The blur is calibrated so `blur_radius` R composites like CSS `blur(2R px)` (`packages/core/src/optical/physics.rs`'s `CSS_BLUR_PIXELS_PER_RADIUS` / `KAWASE_STEP_SCALE`), so the playground's 16px default reads like the `blur(32px)` literal it stands in for. Backdrop uploads from an `HTMLCanvasElement` or `OffscreenCanvas` are ingested by Rust. `createGlassEngine()` awaits `initWasmEngine()`, so the pipeline compiles its GLSL and draws in the browser.
- **The GPU path draws real refracted pixels.** `packages/core/tests/webgl2_browser.rs` runs under `wasm-pack test --headless --chrome` (`pnpm --filter @open-glass/core test:browser`) and reads the framebuffer back: it uploads a four-quadrant backdrop, renders a panel over it, and asserts the panel interior is non-uniform and that each sample tracks the DOM quadrant beneath it — which also pins the Y orientation of the whole upload/sample/composite chain. A negative control proves the driver would reject a GLSL typo, and a second test asserts a renderer with no backdrop draws nothing at all. Interior light bending has its own differential over a checkerboard backdrop, because tracking the quadrant underneath stays true for a panel that refracts only at its rim: at `curvature: 0.15, thickness: 15.0`, 220 of 260 interior samples move against a flat pane, by a mean of 4.09 levels; forcing the lens tilt to zero in the shader drops that to 18 samples and 0.24, all of them in the outermost ring. In the playground under headless Chrome, hiding the glass canvas while leaving the DOM untouched changes the pixels inside every panel and nothing outside one: the mean absolute luma gradient inside a panel measures ~1.5 with the canvas compositing against ~9.8 without it, i.e. fine detail removed while large-scale structure is kept, which is what a blur does.
- **CSS → GPU handover** — every panel component (`GlassCard`, `GlassWindow`, `GlassDock`, `GlassNavbar`, `GlassButton`) drops its CSS `backdrop-filter` and dials its background tint down only when the renderer reports `isRenderReady()`. That requires a live wasm renderer _and_ a backdrop the renderer confirms it holds (`WasmGlassEngine.has_real_background()`), so a headless context, a blocked wasm fetch, a rejected upload or a capture that never rasterized all keep consumers on CSS glass. `WebGl2Renderer::render` correspondingly skips the composite until an upload has succeeded — compositing over the empty placeholder texture would paint a flat opaque rectangle over the DOM, which is worse than the fallback it replaces. **The handover no longer steps.** `packages/react/src/surface.ts` owns it for all five components: the overlay's `background-color` cross-fades over `GLASS_HANDOVER_MS` (260ms, one frame budget over a quarter second) instead of jumping, composed onto whatever `transition` the caller already asked for rather than replacing it, while `backdrop-filter` still switches to `none` in one step because a filter list does not interpolate with `none`. The eight ready/fallback alpha literals are unchanged; what changed is that you no longer see them change. The composite's exposure gain then covers most of the brightness the dropped overlay took with it — measured over the region below, the GPU path went from 110.24 mean luma to 134.58 against the CSS fallback's 158.02.
- **Engine facade & backend probing** — `createGlassEngine()` probes for WebGPU, negotiates a backend, awaits `initWasmEngine()` and acquires a WebGL2 context. A failed wasm load never rethrows: the facade still resolves, `isRenderReady()` stays `false`, and consumers degrade to the CSS fallback — after saying why on the console, prefixed `[open-glass]`, once per failure class rather than once per frame.
- **Playground app** — `apps/playground`, a Vite+ single-page app with a control for every optical parameter — including Frosting Saturation and Glass Brightness (1.00 "composite as blurred" to 2.00, stepping by 0.05, defaulting to the calibrated 1.50), Glass Slab Thickness (0-30px, defaulting to 10) and Volumetric Lens Curvature (0.00 flat to 0.30, defaulting to the 0.10 macOS parity value) — and live-updating numeric readouts, a macOS-style desktop scene and a visionOS-style spatial scene.

### Not implemented yet

- **The WebGPU backend.** `WebGpuRenderer::new` in `packages/core/src/renderer/webgpu.rs` deliberately fails at construction (`Err("WebGPU backend not yet implemented")`) so that `RendererBackend::Auto` falls back to the WebGL2 renderer; its `GlassRenderer` impl is therefore never reached. Because of that, `negotiateBackend()` reports `"webgl2"` even on a browser whose `navigator.gpu.requestAdapter()` resolves: reporting `"webgpu"` would label a live WebGL2 renderer as something it is not.
- **The WGSL shaders are not wired up.** `packages/core/src/shaders/` holds `glass_composite.wgsl`, `kawase_down.wgsl` and `kawase_up.wgsl` for that backend; no renderer reads them yet. `cargo test` now parses and validates all three through `naga` (`packages/core/tests/wgsl_shaders.rs`, a host-only dev-dependency), so a WGSL type error is a red test rather than a surprise in the first WebGPU frame. (The GLSL siblings `kawase_blur.frag` and `glass_composite.frag` _are_ compiled, by the WebGL2 renderer via `include_str!`.)

#### Uniform buffer layout

The composite bind group's `@binding(0)` layout is fixed, even though nothing binds it yet, and it lives in `GlassCompositeUniforms` in `packages/core/src/renderer/uniforms.rs`. It is `#[repr(C, align(16))]` + `bytemuck::Pod`: twelve leading `f32`s filling three complete 16-byte rows, then `tint_color` at offset 48, `glass_bounds` at 64, `resolution` at 80, and an explicit `_padding` tail to a 96-byte stride. Every offset is asserted at compile time, and `packages/core/tests/wgsl_shaders.rs` checks the same offsets against `naga`'s own layout for the parsed and validated `struct GlassCompositeUniforms` — the compiler that will actually lay the buffer out, not a second parser. A companion test still parses the declaration's text and pins it to the Rust struct field for field, in the same order, for the narrower job of catching a type-spelling mismatch offsets alone would miss. Deciding this before the backend exists is deliberate: a wrongly-aligned uniform buffer does not fault, it reinterprets `curvature` as `tint_color.r`, so it reads as plausible-looking but wrong glass rather than as an error.

`OpticalParams` carries no layout obligation and is free to grow. A new optical parameter has to be given a slot in `GlassCompositeUniforms::from_quad`, which destructures `OpticalParams` and `GlassQuad` exhaustively (no `..` rest pattern, deliberately) and therefore fails to compile until someone decides where in the buffer it goes.
- **Per-quad `blurRadius` is not honoured.** `glass_composite.frag` samples a single `u_blurred_texture`, so `WebGl2Renderer::render` blurs the backdrop once at `average_blur_radius(&self.quads)` and every quad composites against that shared result. Two panels with different `blurRadius` values render identically.
- **The backdrop texture is always allocated.** `background_texture` is a plain `WebGlTexture` rather than an `Option`, seeded with a single transparent pixel. `render()` no longer composites over that placeholder — it checks `has_real_background` and clears the canvas instead — but the allocation and the seed upload still happen unconditionally at construction, and the emptiness is tracked by a separate `bool` rather than expressed in the type.
- **`OpticalParams` do not affect the CSS fallback.** Every component publishes its optical parameters into the glass context, and the playground's `ControlsPanel` lets you edit them and shows the numeric values updating live, but each component's CSS `backdrop-filter` is a hardcoded literal: `blur(20px)` for `GlassCard`, `blur(24px) saturate(180%)` for `GlassNavbar`, `blur(28px) saturate(190%)` for `GlassDock`, `blur(32px) saturate(180%)` for `GlassWindow`, `blur(16px)` for `GlassButton`. Each now switches between its literal and `none` on renderer readiness, which is a choice between two constants, not a parameter being read. The parameters do reach the GPU composite for every quad, so a slider changes the rendered glass once the renderer is ready — and changes nothing at all while the CSS fallback is in charge.
- **The GPU composite is still less chromatic than the CSS fallback it replaces, though the gap has closed considerably.** All six numbers below come from one capture session over the same 400x130 region of the "System Monitor" window body used by [Plan 00612](plan://00612)'s evidence harness — before and after adding the exposure gain ([Plan 00653](plan://00653)), with the canvas-hidden control included because it is what says the scene did not move:

  | capture                 | mean luma | mean channel spread | σ R / G / B           | edge energy |
  | ----------------------- | --------- | ------------------- | --------------------- | ----------- |
  | GPU path, before        | 110.24    | 19.14               | 27.86 / 26.82 / 24.15 | 2.743       |
  | GPU path, after         | 134.58    | 30.25               | 27.52 / 25.10 / 20.85 | 2.320       |
  | canvas hidden (control) | 100.14    | 39.82               | 40.86 / 37.79 / 34.20 | 9.550       |
  | CSS fallback            | 158.02    | 39.67               | 33.68 / 31.54 / 23.86 | 2.091       |

  The gain closes 51% of the luma gap (47.76 → 23.44) and 55% of the mean-channel-spread gap (20.94 → 9.42), and it does exactly what a multiplicative gain should: holding the same build at `brightness: 1.0` and at 1.5 scales mean per-pixel channel spread by 1.498 on the region and 1.496 on a text-free patch of glass. Mean luma rises by only 1.24x because the two things a gain cannot touch are a large part of the pixel — the additive sheen, deliberately left outside it, and everything the DOM paints on top of the canvas (the ready overlay plus opaque labels, dividers and borders). Mean luma is affine in the gain, `luma(g) = 56.37 + 52.14g`, so reaching the CSS fallback's 158 would need g ≈ 1.95 rather than the calibrated 1.49; the residual 23 luma is a shortfall, not a rounding error. Per-channel σ and edge energy both fall slightly, for the same reason and not because the blur changed: fixed-luminance DOM content over brighter glass is a smaller step. (σ figures previously quoted here, 33.86 / 33.26 / 30.80, do not reproduce on this build — the same region and the same scripts read 27.86 / 26.82 / 24.15 before this change, so the whole table above is re-measured rather than carried forward.) Edge energy stays far below the canvas-hidden control's 9.55, so the composite is still a blur and not a flat fill. See the Roadmap for what's left.

So: the physics is real and tested, the component API is real and usable, and the pipe between them is connected end to end — the renderer composites the captured DOM behind every registered panel, with the CSS fallback still carrying anything the GPU path cannot.

## Roadmap

1. **Per-quad blur** — one blur chain per distinct `blurRadius` (or a mip-level uniform), so the shared `average_blur_radius` backdrop goes away.
2. **Background texture ingestion in Rust** — the remaining `BackgroundTextureSource` variants (`ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLVideoElement`) still upload from TypeScript.
3. **WebGPU backend** — the WGSL passes; until they exist, WebGPU negotiation reports and uses WebGL2.
4. **Performance & polish** — frame budgets, resize handling, reduced-motion and reduced-transparency support.
5. **Releasing the backdrop** — switching DOM capture off leaves the engine holding its last successful upload, so the glass keeps refracting a frozen frame instead of returning to the CSS fallback. There is no way to tell the engine its backdrop is gone.
6. **Closing the remaining chroma gap — and it is not a colour-grading problem.** Mean channel spread reads 30.25 against the CSS fallback's 39.67, and per-channel σ 27.5 / 25.1 / 20.9 against 33.7 / 31.5 / 23.9 (numbers in "Not implemented yet" above). Two levers have now been tried and are recorded here as **rejected**, not pending: a saturation default above 1.8 — 1.8 _is_ the `saturate(180%)` the CSS literals ask for, so anything higher is no longer parity but a different look, and the term already clips channels at 1.0 on bright backdrops; and a mid-tone contrast curve — the exposure gain is the linear case of exactly that, it scales per-pixel chroma by precisely its nominal factor (measured 1.498 at g = 1.5), and it still leaves 9.4 spread on the table, so a curvier version of the same operator would buy a different tone response rather than more chroma. What is left is spatial, and it sits in two specific places: the `foreignObject` capture raster, which is a re-rasterization of the DOM through an SVG document (subpixel text antialiasing, `currentColor` and inherited-style resolution, and image decode all differ from the live page, so chroma is lost before the pyramid ever sees the backdrop), and the dual-Kawase pyramid's cross-level averaging, where each up-pass bilinearly magnifies a lower level and averages it with the level above, mixing distant pixels' chroma together in a way a separable Gaussian at the same radius does not. Both are measurable against the canvas-hidden control, which carries 39.82 spread over the same region — the chroma is in the DOM; the pipeline loses it in transit.

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

## Form Controls

`packages/react` ships five glass form controls alongside the panel surfaces, so a login form, a
settings pane or a preferences dialog can be built out of the library rather than around it:

| Component       | Underlying element        | Notes                                                                                                                                    |
| --------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GlassInput`    | `<input>`                 | Optional `label`, `error` (rendered `role="alert"`) and `invalid`; `aria-describedby` merges with the caller's rather than replacing it. |
| `GlassToggle`   | `<button role="switch">`  | `checked` / `onCheckedChange`; both Space and Enter toggle.                                                                              |
| `GlassSlider`   | `<input type="range">`    | Arrows step by `step`, `Home`/`End` clamp, `PageUp`/`PageDown` move by `10 × step`.                                                      |
| `GlassCheckbox` | `<input type="checkbox">` | `indeterminate` is set as a DOM property and reported as `aria-checked="mixed"`.                                                         |
| `GlassSelect`   | `<select>`                | Styled native element; its dropdown list is UA-rendered and is not glass.                                                                |

Each one registers a glass quad through `useGlassElement` and switches its CSS `backdrop-filter`
literal to `none` on `isRenderReady`, exactly like the panel components.

**Native elements, deliberately.** Select, slider and checkbox wrap real form elements instead of
hand-rolled widgets. A custom listbox needs full ARIA combobox semantics, focus trapping and
type-ahead, and a half-implemented one is worse for assistive-technology users than a styled native
element — which also brings the platform popup on mobile for free. The slider and checkbox do add
explicit key handlers with `preventDefault()`, so a keypress produces exactly one step or toggle
rather than two, and so the keyboard contract is assertable rather than assumed.

**The focus ring is a box-shadow, never an `outline`.** `useFocusRing` resolves focus-visible in
JavaScript — inline styles cannot express a pseudo-class and this package has no stylesheet — by
tracking pointer modality: a `pointerdown` immediately before focus means the focus came from a
mouse and no ring is drawn. `focusRing()` in `packages/react/src/components/glassFieldStyles.ts`
then returns a `border` plus two stacked box-shadows, a dark contrast ring under a bright halo, so
the indicator holds up against both the light CSS-blur fallback and the GPU composite. An `outline`
would not: once the renderer is ready the control sets `backdrop-filter: none`, leaving the outline
drawn over GPU-composited pixels with no guaranteed contrast. The unfocused state keeps the same
border width, so gaining focus never reflows layout.

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
cargo fmt --all -- --check
```

## Contributing

The Roadmap above is the priority order. If you are adding to the README, keep the Project Status
section honest: describe what the code does now, and put anything unbuilt under Roadmap.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([./LICENSE-APACHE](./LICENSE-APACHE))
- MIT License ([./LICENSE-MIT](./LICENSE-MIT))

at your option.
