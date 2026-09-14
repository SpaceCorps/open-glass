/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GlassEngine } from "@open-glass/core";
import { GlassContext, type GlassContextValue, GlassProvider } from "../src/context/GlassContext";

import { GlassCard } from "../src/components/GlassCard";
import { GlassWindow } from "../src/components/GlassWindow";
import { GlassDock } from "../src/components/GlassDock";
import { GlassButton } from "../src/components/GlassButton";
import { GlassNavbar } from "../src/components/GlassNavbar";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (typeof window !== "undefined" && !window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends MouseEvent {} as any;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockContext = (overrides: Partial<GlassContextValue> = {}): GlassContextValue => ({
  engine: null,
  registerElement: vi.fn(),
  updateElement: vi.fn(),
  unregisterElement: vi.fn(),
  hasBackgroundSource: false,
  isRenderReady: false,
  containerRef: { current: null },
  ...overrides,
});

const dockItems = [
  { id: "finder", label: "Finder", icon: <span>📁</span> },
  { id: "terminal", label: "Terminal", icon: <span>💻</span> },
];

describe("Open Glass React Components", () => {
  it("renders GlassCard with custom elevation and children", () => {
    render(
      <GlassProvider>
        <GlassCard data-testid="test-card" elevation="floating">
          <p>Card Content</p>
        </GlassCard>
      </GlassProvider>,
    );

    const card = screen.getByTestId("test-card");
    expect(card).toBeDefined();
    expect(screen.getByText("Card Content")).toBeDefined();
    expect(card.className).toContain("open-glass-card");
  });

  it("renders GlassWindow with traffic light actions and title", () => {
    const handleClose = vi.fn();
    const handleMinimize = vi.fn();
    const handleMaximize = vi.fn();

    render(
      <GlassProvider>
        <GlassWindow
          title="Finder"
          onClose={handleClose}
          onMinimize={handleMinimize}
          onMaximize={handleMaximize}
        >
          <div>Files view</div>
        </GlassWindow>
      </GlassProvider>,
    );

    expect(screen.getByText("Finder")).toBeDefined();
    expect(screen.getByText("Files view")).toBeDefined();

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const minBtn = screen.getByRole("button", { name: "Minimize" });
    fireEvent.click(minBtn);
    expect(handleMinimize).toHaveBeenCalledTimes(1);

    const maxBtn = screen.getByRole("button", { name: "Maximize" });
    fireEvent.click(maxBtn);
    expect(handleMaximize).toHaveBeenCalledTimes(1);
  });

  it("renders GlassDock with items and click triggers", () => {
    const onItemClick = vi.fn();
    const items = [
      { id: "finder", label: "Finder", icon: <span>📁</span>, onClick: onItemClick },
      { id: "terminal", label: "Terminal", icon: <span>💻</span> },
    ];

    render(
      <GlassProvider>
        <GlassDock items={items} />
      </GlassProvider>,
    );

    const finderBtn = screen.getByRole("button", { name: "Finder" });
    expect(finderBtn).toBeDefined();
    fireEvent.click(finderBtn);
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it("renders GlassButton and handles pointer events", () => {
    const onClick = vi.fn();
    render(
      <GlassProvider>
        <GlassButton onClick={onClick}>Click Me</GlassButton>
      </GlassProvider>,
    );

    const btn = screen.getByRole("button", { name: "Click Me" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(btn, { clientX: 20, clientY: 20 });
    fireEvent.pointerLeave(btn);
  });

  it("renders GlassNavbar with header element and content", () => {
    render(
      <GlassProvider>
        <GlassNavbar data-testid="test-navbar">
          <span>Logo</span>
          <nav>Menu</nav>
        </GlassNavbar>
      </GlassProvider>,
    );

    const navbar = screen.getByTestId("test-navbar");
    expect(navbar).toBeDefined();
    expect(screen.getByText("Logo")).toBeDefined();
    expect(screen.getByText("Menu")).toBeDefined();
  });

  it("initializes GlassWindow variant visionos with default parallax enabled", () => {
    render(
      <GlassProvider>
        <GlassWindow variant="visionos" title="Vision Window" data-testid="vision-window">
          <div>Vision content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("vision-window");
    expect(windowEl).toBeDefined();
    expect(windowEl.style.transform).toContain("perspective(1000px)");
    expect(windowEl.style.transform).toContain("rotateX(0deg)");
    expect(windowEl.style.transform).toContain("rotateY(0deg)");
    expect(windowEl.style.transformStyle).toBe("preserve-3d");
  });

  it("updates CSS 3D transform on pointermove over GlassWindow", () => {
    render(
      <GlassProvider>
        <GlassWindow
          variant="visionos"
          title="Tilt Window"
          data-testid="tilt-window"
          maxTiltAngle={12}
        >
          <div>Tilt content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("tilt-window");
    vi.spyOn(windowEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Move cursor to bottom-right quadrant: clientX = 150, clientY = 150
    // nx = (150 - 0)/200 - 0.5 = 0.25
    // ny = (150 - 0)/200 - 0.5 = 0.25
    // rotateX = -ny * 12 = -3deg
    // rotateY = nx * 12 = 3deg
    fireEvent.pointerMove(windowEl, { clientX: 150, clientY: 150 });

    expect(windowEl.style.transform).toContain("rotateX(-3deg)");
    expect(windowEl.style.transform).toContain("rotateY(3deg)");
  });

  it("resets back towards neutral tilt on pointerleave", () => {
    render(
      <GlassProvider>
        <GlassWindow variant="visionos" data-testid="leave-window">
          <div>Leave content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("leave-window");
    vi.spyOn(windowEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerMove(windowEl, { clientX: 180, clientY: 180 });
    expect(windowEl.style.transform).not.toContain("rotateX(0deg)");

    fireEvent.pointerLeave(windowEl);
    expect(windowEl.style.transform).toContain("rotateX(0deg)");
    expect(windowEl.style.transform).toContain("rotateY(0deg)");
  });

  it("updates specular highlight layer radial and linear gradient styles with pointer position", () => {
    render(
      <GlassProvider>
        <GlassWindow variant="visionos" data-testid="specular-window">
          <div>Content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("specular-window");
    const highlight = screen.getByTestId("specular-highlight");
    expect(highlight).toBeDefined();

    vi.spyOn(windowEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Move to (150, 150) -> nx = 0.25, ny = 0.25
    // radial center at: 50 + 0.25 * 40 = 60%, 50 + 0.25 * 40 = 60%
    // fresnelAngle = atan2(0.25, 0.25) * 180 / PI + 90 = 45 + 90 = 135deg
    fireEvent.pointerMove(windowEl, { clientX: 150, clientY: 150 });

    expect(highlight.style.background).toContain("radial-gradient(circle at 60% 60%");
    expect(highlight.style.background).toContain("linear-gradient(135deg");
  });

  it("updates rotation angles on deviceorientation events", () => {
    render(
      <GlassProvider>
        <GlassWindow variant="visionos" data-testid="orientation-window" maxTiltAngle={12}>
          <div>Orientation content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("orientation-window");

    // beta = 50 (5 deg forward from 45), gamma = 8 (8 deg roll)
    // tiltX = -(50 - 45) = -5deg
    // tiltY = 8deg
    const orientationEvent = new Event("deviceorientation") as any;
    orientationEvent.beta = 50;
    orientationEvent.gamma = 8;
    act(() => {
      window.dispatchEvent(orientationEvent);
    });

    expect(windowEl.style.transform).toContain("rotateX(-5deg)");
    expect(windowEl.style.transform).toContain("rotateY(8deg)");
  });

  it("suppresses 3D tilt transforms when enableParallax is false", () => {
    render(
      <GlassProvider>
        <GlassWindow variant="visionos" enableParallax={false} data-testid="no-parallax-window">
          <div>No parallax content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("no-parallax-window");
    expect(windowEl.style.transform).toBe("");

    fireEvent.pointerMove(windowEl, { clientX: 150, clientY: 150 });
    expect(windowEl.style.transform).toBe("");
  });

  it("suppresses 3D rotation transforms when prefers-reduced-motion is reduce", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(
        <GlassProvider>
          <GlassWindow variant="visionos" data-testid="reduced-motion-window">
            <div>Reduced motion content</div>
          </GlassWindow>
        </GlassProvider>,
      );

      const windowEl = screen.getByTestId("reduced-motion-window");
      expect(windowEl.style.transform).toBe("");

      fireEvent.pointerMove(windowEl, { clientX: 150, clientY: 150 });
      expect(windowEl.style.transform).toBe("");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("renders GlassCard and GlassWindow with CSS backdrop-filter fallback when background capture is inactive", () => {
    render(
      <GlassProvider>
        <GlassCard data-testid="fallback-card">Card Text</GlassCard>
        <GlassWindow title="Fallback Window" data-testid="fallback-window">
          Window Content
        </GlassWindow>
      </GlassProvider>,
    );

    const card = screen.getByTestId("fallback-card");
    const windowEl = screen.getByTestId("fallback-window");

    expect(card.style.backdropFilter).toContain("blur(20px)");
    expect(card.style.background).toBe("rgba(255, 255, 255, 0.15)");

    expect(windowEl.style.backdropFilter).toContain("blur(32px)");
    expect(windowEl.style.background).toBe("rgba(240, 240, 245, 0.22)");
  });

  it("keeps the CSS fallback when a background texture exists but the renderer draws nothing", () => {
    // hasBackgroundSource only says a texture was uploaded. Dropping the blur on that signal alone
    // is what left every panel invisible while the renderer was still a stub.
    render(
      <GlassContext.Provider
        value={mockContext({ hasBackgroundSource: true, isRenderReady: false })}
      >
        <GlassCard data-testid="texture-card">Card Text</GlassCard>
        <GlassWindow title="Texture Window" data-testid="texture-window">
          Window Content
        </GlassWindow>
      </GlassContext.Provider>,
    );

    const card = screen.getByTestId("texture-card");
    const windowEl = screen.getByTestId("texture-window");

    expect(card.style.backdropFilter).not.toBe("none");
    expect(card.style.backdropFilter).toContain("blur(20px)");
    expect(card.style.background).toBe("rgba(255, 255, 255, 0.15)");

    expect(windowEl.style.backdropFilter).not.toBe("none");
    expect(windowEl.style.backdropFilter).toContain("blur(32px)");
    expect(windowEl.style.background).toBe("rgba(240, 240, 245, 0.22)");
  });

  it("dials down CSS backdrop-filter once the renderer reports it is compositing pixels", () => {
    render(
      <GlassContext.Provider
        value={mockContext({ hasBackgroundSource: true, isRenderReady: true })}
      >
        <GlassCard data-testid="gpu-card">Card Text</GlassCard>
        <GlassWindow title="GPU Window" data-testid="gpu-window">
          Window Content
        </GlassWindow>
      </GlassContext.Provider>,
    );

    const card = screen.getByTestId("gpu-card");
    const windowEl = screen.getByTestId("gpu-window");

    expect(card.style.backdropFilter).toBe("none");
    expect(card.style.background).toBe("rgba(255, 255, 255, 0.03)");

    expect(windowEl.style.backdropFilter).toBe("none");
    expect(windowEl.style.background).toBe("rgba(240, 240, 245, 0.05)");
  });

  it("hands GlassDock, GlassNavbar and GlassButton over to the GPU on the same signal", () => {
    // All three register quads through useGlassElement, so the composite paints over them whether or
    // not they participate in the handover. They used to hardcode `backdropFilter`, which stacked the
    // CSS blur underneath an opaque GPU panel — two glass models fighting in one scene.
    const { unmount } = render(
      <GlassContext.Provider
        value={mockContext({ hasBackgroundSource: true, isRenderReady: false })}
      >
        <GlassDock items={dockItems} data-testid="fallback-dock" />
        <GlassNavbar data-testid="fallback-navbar">Navbar</GlassNavbar>
        <GlassButton data-testid="fallback-button">Button</GlassButton>
      </GlassContext.Provider>,
    );

    expect(screen.getByTestId("fallback-dock").style.backdropFilter).toContain("blur(28px)");
    expect(screen.getByTestId("fallback-navbar").style.backdropFilter).toContain("blur(24px)");
    expect(screen.getByTestId("fallback-button").style.backdropFilter).toContain("blur(16px)");

    unmount();

    render(
      <GlassContext.Provider
        value={mockContext({ hasBackgroundSource: true, isRenderReady: true })}
      >
        <GlassDock items={dockItems} data-testid="gpu-dock" />
        <GlassNavbar data-testid="gpu-navbar">Navbar</GlassNavbar>
        <GlassButton data-testid="gpu-button">Button</GlassButton>
      </GlassContext.Provider>,
    );

    const dock = screen.getByTestId("gpu-dock");
    const navbar = screen.getByTestId("gpu-navbar");
    const button = screen.getByTestId("gpu-button");

    expect(dock.style.backdropFilter).toBe("none");
    expect(dock.style.background).toBe("rgba(255, 255, 255, 0.04)");
    expect(navbar.style.backdropFilter).toBe("none");
    expect(navbar.style.background).toBe("rgba(255, 255, 255, 0.03)");
    expect(button.style.backdropFilter).toBe("none");
    expect(button.style.background).toBe("rgba(255, 255, 255, 0.08)");
  });

  it("keeps the dock, navbar and button on CSS glass with no provider at all", () => {
    // `useContext` outside a GlassProvider yields undefined, and a missing renderer must never be read
    // as a ready one.
    render(
      <>
        <GlassDock items={dockItems} data-testid="bare-dock" />
        <GlassNavbar data-testid="bare-navbar">Navbar</GlassNavbar>
        <GlassButton data-testid="bare-button">Button</GlassButton>
      </>,
    );

    expect(screen.getByTestId("bare-dock").style.backdropFilter).toContain("blur(28px)");
    expect(screen.getByTestId("bare-navbar").style.backdropFilter).toContain("blur(24px)");
    expect(screen.getByTestId("bare-button").style.backdropFilter).toContain("blur(16px)");
  });

  it("treats an engine without isRenderReady as not ready and keeps the fallback", () => {
    const legacyEngine = {
      backend: "webgl2",
      canvas: document.createElement("canvas"),
      resize: vi.fn(),
      updateQuads: vi.fn(),
      updateBackgroundSource: vi.fn(),
      hasBackgroundSource: vi.fn().mockReturnValue(true),
      render: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GlassEngine;

    expect(legacyEngine.isRenderReady?.() ?? false).toBe(false);

    render(
      <GlassContext.Provider
        value={mockContext({
          engine: legacyEngine,
          hasBackgroundSource: true,
          isRenderReady: legacyEngine.isRenderReady?.() ?? false,
        })}
      >
        <GlassCard data-testid="legacy-card">Card Text</GlassCard>
      </GlassContext.Provider>,
    );

    expect(screen.getByTestId("legacy-card").style.backdropFilter).toContain("blur(20px)");
  });

  it("preserves a caller transform on GlassWindow instead of clobbering the parallax tilt", () => {
    render(
      <GlassProvider>
        <GlassWindow
          variant="visionos"
          title="Positioned Window"
          data-testid="positioned-window"
          style={{ transform: "translate(10px, 20px)" }}
        >
          <div>Content</div>
        </GlassWindow>
      </GlassProvider>,
    );

    const windowEl = screen.getByTestId("positioned-window");

    expect(windowEl.style.transform).toContain("translate(10px, 20px)");
    expect(windowEl.style.transform).toContain("perspective(1000px)");
    expect(windowEl.style.transform).toContain("rotateX(");

    vi.spyOn(windowEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerMove(windowEl, { clientX: 150, clientY: 150 });

    // Both survive the tilt update: the caller's placement and the tilt itself.
    expect(windowEl.style.transform).toContain("translate(10px, 20px)");
    expect(windowEl.style.transform).toContain("rotateX(-3deg)");
    expect(windowEl.style.transform).toContain("rotateY(3deg)");
  });

  it("preserves a caller transform on GlassButton alongside the press scale", () => {
    render(
      <GlassProvider>
        <GlassButton style={{ transform: "translateY(4px)" }}>Press Me</GlassButton>
      </GlassProvider>,
    );

    const btn = screen.getByRole("button", { name: "Press Me" });
    expect(btn.style.transform).toContain("translateY(4px)");
    expect(btn.style.transform).toContain("scale(1)");

    fireEvent.pointerDown(btn);
    expect(btn.style.transform).toContain("translateY(4px)");
    expect(btn.style.transform).toContain("scale(0.97)");
  });
});
