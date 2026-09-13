# open-glass

Apple Glass UI framework for the web rendered directly on the GPU via Rust, WebGPU, and React.

## Features

- **High-Performance Optical Physics**: Real-time Dual Kawase frosted glass blur, Snell's law refraction with Index of Refraction (IOR), chromatic aberration dispersion, specular rim lighting with Schlick Fresnel approximation, and tactile frosting micro-roughness.
- **WebGPU Native & WebGL2 Fallback**: Automatic device probing negotiates WebGPU when available and seamlessly falls back to WebGL2 shaders.
- **Declarative React Bridge**: Declarative React components (`<GlassProvider>`, `<GlassCanvas>`, `<GlassCard>`, `<GlassWindow>`, `<GlassDock>`, `<GlassButton>`, `<GlassNavbar>`) with DOM-to-GPU quad synchronization and pointer event passthrough.
- **Interactive Storybook Showcase**: Vite+ component catalog with live controls for all optical parameters, macOS desktop environment, and visionOS spatial interface.

## Monorepo Architecture

```text
open-glass/
├── packages/
│   ├── core/         # Rust optical physics engine & WebGPU/WebGL2 shaders
│   └── react/        # Declarative React components & GPU context bridge
└── apps/
    └── storybook/    # Interactive Vite+ component catalog and showcase
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v11+)
- [Rust](https://www.rust-lang.org/) (1.80+)
- [Vite+](https://viteplus.dev/) (`vp`)

### Installation & Development

```bash
# Install dependencies
pnpm install

# Build core and workspace packages
pnpm run build

# Run Vite+ interactive showcase
pnpm run dev

# Run all test suites
pnpm test
cargo test --workspace

# Lint and format checks
vp check
cargo clippy --workspace -- -D warnings
```

## License

MIT OR Apache-2.0
