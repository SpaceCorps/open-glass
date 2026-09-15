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
  updateBackdropBand: vi.fn(),
  releaseBackdropBandsFrom: vi.fn(),
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

describe("GlassProvider depth bands", () => {
  /**
   * A 2D context for the band canvases, plus every `drawImage` placement they receive.
   *
   * The suite-wide `getContext` stub returns null so the engine falls back to CSS; a band canvas that
   * got that null would never composite, so the banding path needs a context of its own here.
   */
  const stubBandCanvases = () => {
    const drawn: { width: number; height: number; args: unknown[] }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind !== "2d") return null;
      return {
        clearRect: vi.fn(),
        drawImage: (...args: unknown[]) => {
          drawn.push({ width: this.width, height: this.height, args });
        },
      };
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    return drawn;
  };

  /** Rasterize every layer to its own canvas, so a band's members are distinguishable. */
  const stubCaptures = () => {
    const rasters = new Map<HTMLElement, HTMLCanvasElement>();
    vi.spyOn(core.DomCapturePipeline.prototype, "captureElement").mockImplementation(
      async (element: HTMLElement) => {
        let raster = rasters.get(element);
        if (!raster) {
          raster = document.createElement("canvas");
          rasters.set(element, raster);
        }
        return raster;
      },
    );
    return rasters;
  };

  /** Container-relative rects for the two layers the tests mount. */
  const stubLayerRects = () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains("open-glass-container")) return domRect(100, 50, 800, 600);
      const testId = (this as HTMLElement).dataset?.testid;
      if (testId === "far") return domRect(100, 50, 800, 600);
      if (testId === "near") return domRect(160, 130, 240, 120);
      return domRect(0, 0, 0, 0);
    });
  };

  it("gives the farthest layer the deepest band and releases the bands past the last one", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    const drawn = stubBandCanvases();
    const rasters = stubCaptures();
    stubLayerRects();
    const tick = stubAnimationFrames();

    await act(async () => {
      render(
        <GlassProvider captureUnderlying>
          {/* Mounted nearest-first, deliberately against the band order: a provider that banded by
              registration order rather than by depth would pass every assertion below if these two
              were declared in the order they end up in. */}
          <GlassUnderlying data-testid="near" depth={80}>
            <p>Floating card</p>
          </GlassUnderlying>
          <GlassUnderlying data-testid="far" depth={480}>
            <p>Wallpaper</p>
          </GlassUnderlying>
        </GlassProvider>,
      );
    });

    // The first frame starts the captures; the second is the first that has rasters to upload.
    await tick();
    await tick();

    const uploads = engine.updateBackdropBand.mock.calls;
    expect(uploads).toHaveLength(2);
    // Band 0 is the farthest, and its depth is what the shader parallaxes by.
    expect(uploads[0][0]).toBe(0);
    expect(uploads[0][2]).toBe(480);
    expect(uploads[1][0]).toBe(1);
    expect(uploads[1][2]).toBe(80);
    // Two different band canvases, or one band would be overwriting the other's pixels.
    expect(uploads[0][1]).not.toBe(uploads[1][1]);

    // Each layer is drawn at its own container-relative rect, not stretched over the container: the
    // composite maps a band across the panel by uv, so the near card has to sit where it really is.
    expect(drawn).toHaveLength(2);
    expect(drawn[0].args).toEqual([rasters.get(screen.getByTestId("far")), 0, 0, 800, 600]);
    expect(drawn[1].args).toEqual([rasters.get(screen.getByTestId("near")), 60, 80, 240, 120]);

    expect(engine.releaseBackdropBandsFrom).toHaveBeenLastCalledWith(2);
  });

  it("leaves a single layer's depth unspecified so the calibrated default still applies", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    stubBandCanvases();
    stubCaptures();
    stubLayerRects();
    const tick = stubAnimationFrames();

    await act(async () => {
      render(
        <GlassProvider captureUnderlying>
          <GlassUnderlying data-testid="far">
            <p>Wallpaper</p>
          </GlassUnderlying>
        </GlassProvider>,
      );
    });

    await tick();
    await tick();

    // This is what keeps every app written before banding on exactly the look it had.
    const uploads = engine.updateBackdropBand.mock.calls;
    expect(uploads).toHaveLength(1);
    expect(uploads[0][0]).toBe(0);
    expect(uploads[0][2]).toBe(core.AUTO_BACKDROP_DEPTH);
    expect(engine.releaseBackdropBandsFrom).toHaveBeenLastCalledWith(1);
  });

  it("releases the band an unmounted layer held, and destroys its pipeline", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    stubBandCanvases();
    stubCaptures();
    stubLayerRects();
    const destroy = vi.spyOn(core.DomCapturePipeline.prototype, "destroy");
    const tick = stubAnimationFrames();

    const Scene: React.FC<{ showNear: boolean }> = ({ showNear }) => (
      <GlassProvider captureUnderlying>
        <GlassUnderlying data-testid="far" depth={480}>
          <p>Wallpaper</p>
        </GlassUnderlying>
        {showNear ? (
          <GlassUnderlying data-testid="near" depth={80}>
            <p>Floating card</p>
          </GlassUnderlying>
        ) : null}
      </GlassProvider>
    );

    const view = render(<Scene showNear />);
    await act(async () => {});
    await tick();
    await tick();
    expect(engine.releaseBackdropBandsFrom).toHaveBeenLastCalledWith(2);

    await act(async () => {
      view.rerender(<Scene showNear={false} />);
    });
    await tick();

    // Band 1 still holds the card's last raster on the GPU until it is released — the glass would go
    // on refracting content that has left the page.
    expect(engine.releaseBackdropBandsFrom).toHaveBeenLastCalledWith(1);
    expect(destroy).toHaveBeenCalledTimes(1);

    view.unmount();
    // One per remaining layer: a leaked pipeline keeps serializing a detached subtree forever.
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("clears every layer when registerUnderlying is passed null", async () => {
    const engine = mockEngine();
    vi.spyOn(core, "createGlassEngine").mockResolvedValue(engine as unknown as core.GlassEngine);
    stubBandCanvases();
    stubCaptures();
    stubLayerRects();
    const destroy = vi.spyOn(core.DomCapturePipeline.prototype, "destroy");
    const tick = stubAnimationFrames();

    let clearLayers: (() => void) | null = null;
    const Probe: React.FC = () => {
      const { registerUnderlying } = useGlassContext();
      clearLayers = () => registerUnderlying?.(null);
      return null;
    };

    await act(async () => {
      render(
        <GlassProvider captureUnderlying>
          <GlassUnderlying data-testid="far" depth={480}>
            <p>Wallpaper</p>
          </GlassUnderlying>
          <GlassUnderlying data-testid="near" depth={80}>
            <p>Floating card</p>
          </GlassUnderlying>
          <Probe />
        </GlassProvider>,
      );
    });
    await tick();
    await tick();

    // The pre-banding meaning of a null element, kept so existing callers still behave.
    await act(async () => {
      clearLayers!();
    });
    await tick();

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(engine.releaseBackdropBandsFrom).toHaveBeenLastCalledWith(0);
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
    // The failed frame leaves the pipeline dirty: nothing was captured, so the work is still
    // outstanding and a later frame must be allowed to try again. Clearing it made the first failure
    // permanent — `capture()` returns early on `!dirty`, so a transient rasterization failure at mount
    // meant no backdrop for the lifetime of the page. Re-serializing every frame is prevented by the
    // retry backoff and the `isFailing` circuit breaker instead, which the failure count reflects.
    expect(pipeline!.isDirty).toBe(true);
    expect(pipeline!.failureCount).toBe(1);
  });
});
