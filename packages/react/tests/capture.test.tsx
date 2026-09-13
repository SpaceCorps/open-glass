/**
 * @vitest-environment jsdom
 */
import React, { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { GlassProvider, useGlassContext } from "../src/context/GlassContext";
import { GlassUnderlying } from "../src/components/GlassUnderlying";
import * as core from "@open-glass/core";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Consumer: React.FC = () => {
  const ctx = useGlassContext();
  return (
    <div data-testid="capture-status">
      <span data-testid="has-pipeline">{String(Boolean(ctx.capturePipeline))}</span>
      <span data-testid="has-bg">{String(ctx.hasBackgroundSource)}</span>
    </div>
  );
};

describe("React DOM Capture Pipeline Integration", () => {
  it("mounts capture pipeline when captureUnderlying is enabled", async () => {
    let capturedPipeline: core.DomCapturePipeline | null = null;

    const Probe: React.FC = () => {
      const ctx = useGlassContext();
      capturedPipeline = ctx.capturePipeline ?? null;
      return <span>Pipeline Mounted</span>;
    };

    render(
      <GlassProvider captureUnderlying captureFps={30}>
        <GlassUnderlying data-testid="underlying-layer">
          <p>Layer content</p>
        </GlassUnderlying>
        <Probe />
      </GlassProvider>,
    );

    expect(screen.getByText("Pipeline Mounted")).toBeDefined();
    expect(capturedPipeline).not.toBeNull();
    expect((capturedPipeline as any).targetElement).toBeDefined();
  });

  it("modifying text inside captured container marks pipeline dirty and forwards frames", async () => {
    const mockEngine: Partial<core.GlassEngine> = {
      backend: "webgl2",
      canvas: document.createElement("canvas"),
      resize: vi.fn(),
      updateQuads: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
      updateBackgroundSource: vi.fn(),
      hasBackgroundSource: vi.fn().mockReturnValue(true),
    };

    vi.spyOn(core, "createGlassEngine").mockResolvedValue(mockEngine as core.GlassEngine);

    const DynamicComponent: React.FC = () => {
      const [text, setText] = useState("Initial Text");
      const ctx = useGlassContext();

      return (
        <div>
          <GlassUnderlying>
            <p>{text}</p>
          </GlassUnderlying>
          <button type="button" onClick={() => setText("Updated Text")}>
            Update
          </button>
          <span data-testid="pipeline-dirty">
            {String(Boolean(ctx.capturePipeline?.isDirty))}
          </span>
        </div>
      );
    };

    render(
      <GlassProvider captureUnderlying>
        <DynamicComponent />
      </GlassProvider>,
    );

    // Initial state
    expect(screen.getByText("Initial Text")).toBeDefined();

    // Trigger update
    const btn = screen.getByRole("button", { name: "Update" });
    await act(async () => {
      btn.click();
    });

    expect(screen.getByText("Updated Text")).toBeDefined();
  });

  it("unmounting GlassProvider disconnects observers and cleans up", () => {
    let pipelineInstance: core.DomCapturePipeline | null = null;

    const Probe: React.FC = () => {
      const ctx = useGlassContext();
      pipelineInstance = ctx.capturePipeline ?? null;
      return null;
    };

    const { unmount } = render(
      <GlassProvider captureUnderlying>
        <GlassUnderlying>
          <p>Text</p>
        </GlassUnderlying>
        <Probe />
      </GlassProvider>,
    );

    expect(pipelineInstance).not.toBeNull();
    const disconnectSpy = vi.spyOn(pipelineInstance!, "destroy");

    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(pipelineInstance!.targetElement).toBeNull();
  });
});
