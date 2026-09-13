/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlassProvider } from "../src/context/GlassContext";
import { GlassCard } from "../src/components/GlassCard";
import { GlassWindow } from "../src/components/GlassWindow";
import { GlassDock } from "../src/components/GlassDock";
import { GlassButton } from "../src/components/GlassButton";
import { GlassNavbar } from "../src/components/GlassNavbar";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

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
});
