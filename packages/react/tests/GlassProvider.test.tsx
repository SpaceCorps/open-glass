/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { GlassProvider, useGlassContext } from "../src/context/GlassContext";
import { useGlassElement } from "../src/hooks/useGlassElement";

const ConsumerComponent: React.FC = () => {
  const ctx = useGlassContext();
  const { elementRef } = useGlassElement({ cornerRadius: 18 });

  return (
    <div ref={elementRef} data-testid="glass-item">
      <span>Context ready: {String(ctx !== null)}</span>
    </div>
  );
};

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("GlassProvider and useGlassElement", () => {
  it("mounts provider with underlying canvas and renders children", () => {
    const { container } = render(
      <GlassProvider>
        <ConsumerComponent />
      </GlassProvider>,
    );

    const canvas = container.querySelector("canvas.open-glass-canvas");
    expect(canvas).not.toBeNull();
    expect(screen.getByTestId("glass-item")).toBeDefined();
    expect(screen.getByText("Context ready: true")).toBeDefined();
  });

  it("throws when useGlassContext is used outside of GlassProvider", () => {
    // Suppress console.error in test for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ConsumerComponent />)).toThrow(
      "useGlassContext must be used within a <GlassProvider>",
    );
    spy.mockRestore();
  });
});
