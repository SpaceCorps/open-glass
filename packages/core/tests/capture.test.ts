/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { createGlassEngine, DomCapturePipeline } from "../src/ts/index";

describe("packages/core DomCapturePipeline and texture ingestion", () => {
  it("initializes pipeline, attaches observers, and marks dirty state on DOM mutations", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<h1>Hello Glass</h1><p>Underlying content</p>";
    document.body.appendChild(container);

    const pipeline = new DomCapturePipeline(container, { fps: 30 });
    expect(pipeline.targetElement).toBe(container);
    expect(pipeline.isDirty).toBe(true);

    // Capture element
    const canvas = await pipeline.captureElement(container);
    expect(canvas).toBeDefined();

    // Mark dirty via mutation
    const child = document.createElement("span");
    child.textContent = "New mutation";
    container.appendChild(child);

    pipeline.invalidate();
    expect(pipeline.isDirty).toBe(true);

    pipeline.destroy();
    expect(pipeline.targetElement).toBeNull();
    document.body.removeChild(container);
  });

  it("handles invalidate, attach, detach, and setFps", () => {
    const container1 = document.createElement("div");
    const container2 = document.createElement("div");

    const pipeline = new DomCapturePipeline(null, { fps: 20 });
    expect(pipeline.frameInterval).toBe(50);

    pipeline.setFps(60);
    expect(Math.round(pipeline.frameInterval)).toBe(17);

    pipeline.attach(container1);
    expect(pipeline.targetElement).toBe(container1);

    pipeline.attach(container2);
    expect(pipeline.targetElement).toBe(container2);

    pipeline.detach();
    expect(pipeline.targetElement).toBeNull();

    pipeline.invalidate();
    expect(pipeline.isDirty).toBe(true);

    pipeline.destroy();
  });

  it("captures element using captureElement with fallback in jsdom", async () => {
    const el = document.createElement("section");
    el.style.width = "400px";
    el.style.height = "200px";
    el.innerHTML = "<p>Refracted text content</p>";
    document.body.appendChild(el);

    const pipeline = new DomCapturePipeline(el);
    const result = await pipeline.capture();
    expect(result).toBeDefined();

    pipeline.destroy();
    document.body.removeChild(el);
  });

  it("engine.updateBackgroundSource accepts canvas/image source and sets hasBackgroundSource === true", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;

    const mockGl = {
      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      deleteTexture: vi.fn(),
    };

    canvas.getContext = vi.fn().mockImplementation((contextId) => {
      if (contextId === "webgl2") {
        return mockGl as any;
      }
      return null;
    });

    const engine = await createGlassEngine(canvas, {
      backend: "webgl2",
      width: 400,
      height: 300,
    });

    expect(engine.hasBackgroundSource()).toBe(false);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 400;
    sourceCanvas.height = 300;

    engine.updateBackgroundSource(sourceCanvas);
    expect(engine.hasBackgroundSource()).toBe(true);

    // Calling render with background source active
    engine.render();
    expect(mockGl.clear).toHaveBeenCalled();

    // engine.destroy cleans up background textures
    engine.destroy();
    expect(engine.hasBackgroundSource()).toBe(false);
    expect(mockGl.deleteTexture).toHaveBeenCalled();
  });
});
