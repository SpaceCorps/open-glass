/**
 * @vitest-environment jsdom
 */
import React, { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as core from "@open-glass/core";
import {
  GlassProvider,
  type GlassContextValue,
  useGlassContext,
} from "../src/context/GlassContext";
import { useGlassElement } from "../src/hooks/useGlassElement";
import { GlassUnderlying } from "../src/components/GlassUnderlying";
import { GLASS_Z_CANVAS, GLASS_Z_UNDERLYING } from "../src/layers";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const domRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const mockEngine = () => ({
  backend: "webgl2" as const,
  canvas: document.createElement("canvas"),
  resize: vi.fn(),
  updateQuads: vi.fn(),
  updateBackgroundSource: vi.fn(),
  hasBackgroundSource: vi.fn().mockReturnValue(false),
  isRenderReady: vi.fn().mockReturnValue(false),
  render: vi.fn(),
  destroy: vi.fn(),
});

/** Replace rAF with a manual queue so a single frame can be driven deterministically. */
const stubAnimationFrames = () => {
  let pending: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

  return async () => {
    const frame = pending;
    pending = [];
    await act(async () => {
      for (const cb of frame) {
        cb(0);
      }
    });
  };
};

/** Capture every ResizeObserver callback the tree creates so they can be fired by hand. */
const stubResizeObserver = () => {
  const callbacks: ResizeObserverCallback[] = [];
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  return {
    restore: () => {
      globalThis.ResizeObserver = original;
    },
    fire: async () => {
      await act(async () => {
        for (const cb of callbacks) {
          cb([], {} as ResizeObserver);
        }
      });
    },
  };
};

const lastQuads = (engine: ReturnType<typeof mockEngine>): core.GlassQuadDescriptor[] => {
  const calls = engine.updateQuads.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as core.GlassQuadDescriptor[];
};

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

describe("GlassProvider layering", () => {
  it("paints the canvas above the underlying layer and leaves the content wrapper flat", () => {
    const { container } = render(
      <GlassProvider>
        <GlassUnderlying data-testid="underlying">
          <p>Below the glass</p>
        </GlassUnderlying>
      </GlassProvider>,
    );

    const canvas = container.querySelector<HTMLCanvasElement>("canvas.open-glass-canvas")!;
    const content = container.querySelector<HTMLElement>(".open-glass-content")!;
    const glassContainer = container.querySelector<HTMLElement>(".open-glass-container")!;
    const underlying = screen.getByTestId("underlying");

    expect(Number(canvas.style.zIndex)).toBe(GLASS_Z_CANVAS);
    expect(Number(underlying.style.zIndex)).toBe(GLASS_Z_UNDERLYING);
    expect(Number(canvas.style.zIndex)).toBeGreaterThan(Number(underlying.style.zIndex));

    // A stacking context here would trap the canvas below every descendant of the wrapper.
    expect(content.style.zIndex).toBe("");
    expect(glassContainer.style.isolation).toBe("isolate");
  });
});

describe("GlassProvider canvas sizing", () => {
  it("falls back to the viewport for a zero-size container and follows the ResizeObserver", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    const observer = stubResizeObserver();

    try {
      // jsdom reports every rect as 0x0, which is exactly the case `?? window.innerWidth` missed.
      await act(async () => {
        render(
          <GlassProvider>
            <p>content</p>
          </GlassProvider>,
        );
      });

      expect(window.innerWidth).toBeGreaterThan(0);
      expect(engine.resize).toHaveBeenCalledWith(window.innerWidth, window.innerHeight);

      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          return this.classList.contains("open-glass-container")
            ? domRect(0, 0, 640, 480)
            : domRect(0, 0, 0, 0);
        },
      );

      await observer.fire();

      expect(engine.resize).toHaveBeenLastCalledWith(640, 480);
    } finally {
      observer.restore();
    }
  });
});

describe("GlassProvider quad geometry", () => {
  const renderWithGeometry = async (engine: ReturnType<typeof mockEngine>) => {
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);

    // The element sits inside its own positioned ancestor, mirroring the demos: offsetParent is
    // emphatically not the provider's container.
    let elementRect = domRect(180, 90, 40, 30);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("open-glass-container")) return domRect(100, 50, 800, 600);
        const testId = (this as HTMLElement).dataset?.testid;
        if (testId === "positioned-ancestor") return domRect(150, 70, 400, 300);
        if (testId === "glass-item") return elementRect;
        return domRect(0, 0, 0, 0);
      },
    );

    const tick = stubAnimationFrames();

    await act(async () => {
      render(
        <div style={{ position: "relative", left: 100, top: 50 }}>
          <GlassProvider>
            <div data-testid="positioned-ancestor" style={{ position: "relative" }}>
              <ConsumerComponent />
            </div>
          </GlassProvider>
        </div>,
      );
    });

    return {
      tick,
      moveElement: (left: number, top: number) => {
        elementRect = domRect(left, top, 40, 30);
      },
    };
  };

  it("measures quads against the provider container, not the element's offsetParent", async () => {
    const engine = mockEngine();
    const { tick } = await renderWithGeometry(engine);

    // offsetParent-relative would be (30, 20); container-relative is (80, 40).
    const item = screen.getByTestId("glass-item");
    Object.defineProperty(item, "offsetParent", {
      configurable: true,
      get: () => screen.getByTestId("positioned-ancestor"),
    });

    await tick();

    const quads = lastQuads(engine);
    expect(quads).toHaveLength(1);
    expect(quads[0].x).toBe(80);
    expect(quads[0].y).toBe(40);
    expect(quads[0].width).toBe(40);
    expect(quads[0].height).toBe(30);
    expect(quads[0].cornerRadius).toBe(18);
  });

  it("keeps geometry in step from the rAF loop alone, with the context value memoized", async () => {
    const engine = mockEngine();
    const { tick, moveElement } = await renderWithGeometry(engine);

    await tick();
    expect(lastQuads(engine)[0].x).toBe(80);

    // Move the element without re-rendering anything: only the measured rect changes.
    moveElement(300, 250);
    await tick();

    const quads = lastQuads(engine);
    expect(quads[0].x).toBe(200);
    expect(quads[0].y).toBe(200);
  });

  it("hands out a stable context value across unrelated parent re-renders", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    const tick = stubAnimationFrames();

    const seen: GlassContextValue[] = [];
    const Probe: React.FC = () => {
      seen.push(useGlassContext());
      return null;
    };

    const Parent: React.FC = () => {
      const [count, setCount] = useState(0);
      return (
        <GlassProvider>
          <button type="button" onClick={() => setCount(count + 1)}>
            bump {count}
          </button>
          <Probe />
        </GlassProvider>
      );
    };

    await act(async () => {
      render(<Parent />);
    });
    await tick();

    const before = seen[seen.length - 1];
    await act(async () => {
      screen.getByRole("button", { name: /bump/ }).click();
    });

    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(before);
  });
});

describe("GlassProvider capture errors", () => {
  it("warns and notifies onCaptureError instead of swallowing a failed rasterization", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    vi.spyOn(core.DomCapturePipeline.prototype, "captureElement").mockRejectedValue(
      new Error("rasterization failed"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onCaptureError = vi.fn();

    const tick = stubAnimationFrames();

    let pipeline: core.DomCapturePipeline | null = null;
    const Probe: React.FC = () => {
      pipeline = useGlassContext().capturePipeline ?? null;
      return null;
    };

    await act(async () => {
      render(
        <GlassProvider captureUnderlying onCaptureError={onCaptureError}>
          <GlassUnderlying>
            <p>Layer content</p>
          </GlassUnderlying>
          <Probe />
        </GlassProvider>,
      );
    });

    await tick();

    expect(warn).toHaveBeenCalledWith("[open-glass] DOM capture failed:", expect.any(Error));
    expect(onCaptureError).toHaveBeenCalledWith(expect.any(Error));
    // The failed frame must not leave the pipeline dirty, or it re-serializes forever.
    expect(pipeline!.isDirty).toBe(false);
    expect(pipeline!.failureCount).toBe(1);
  });
});
