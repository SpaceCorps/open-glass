import React, { useState } from "react";
import { DEFAULT_OPTICAL_PARAMS, type OpticalParams } from "@open-glass/core";
import {
  GlassButton,
  GlassCard,
  GlassDock,
  GlassNavbar,
  GlassProvider,
  GlassWindow,
} from "@open-glass/react";
import { ControlsPanel } from "./components/ControlsPanel";
import { DesktopDemo } from "./demos/DesktopDemo";
import { FormsDemo } from "./demos/FormsDemo";
import { VisionOSDemo } from "./demos/VisionOSDemo";

type ShowcaseView = "desktop" | "visionos" | "components" | "forms";

export const App: React.FC = () => {
  const [view, setView] = useState<ShowcaseView>("desktop");
  const [optical, setOptical] = useState<Required<OpticalParams>>({
    ...DEFAULT_OPTICAL_PARAMS,
  });
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [captureFps, setCaptureFps] = useState(30);
  // Depth of the demo's floating-card layer. The document layer behind it is fixed at 480px.
  const [nearBandDepth, setNearBandDepth] = useState(80);

  return (
    <GlassProvider captureUnderlying={captureEnabled} captureFps={captureFps}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          background: "#090a12",
        }}
      >
        {/* Top Navbar */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 2rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(15, 15, 22, 0.8)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.75rem" }}>💎</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1.125rem", letterSpacing: "-0.02em" }}>
                Open Glass
              </div>
              <div style={{ fontSize: "0.75rem", color: "#888" }}>Apple Glass UI for the web</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              background: "rgba(255,255,255,0.06)",
              borderRadius: "12px",
              padding: "4px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {(["desktop", "visionos", "components", "forms"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                style={{
                  background: view === v ? "rgba(255,255,255,0.18)" : "transparent",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 16px",
                  color: view === v ? "#fff" : "#a0a0b0",
                  fontWeight: 500,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {v === "desktop"
                  ? "macOS Desktop"
                  : v === "visionos"
                    ? "visionOS Spatial"
                    : v === "components"
                      ? "Component Catalog"
                      : "Form Controls"}
              </button>
            ))}
          </div>
        </header>

        {/* Main Content Area */}
        <div style={{ display: "flex", flex: 1, padding: "1.5rem", gap: "1.5rem" }}>
          {/* Main Stage */}
          <main style={{ flex: 1, minWidth: 0 }}>
            {view === "desktop" && (
              <DesktopDemo optical={optical} nearBandDepth={nearBandDepth} />
            )}
            {view === "visionos" && <VisionOSDemo optical={optical} />}
            {view === "forms" && <FormsDemo optical={optical} />}
            {view === "components" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2rem",
                  padding: "2rem",
                  borderRadius: "24px",
                  background: "linear-gradient(135deg, #1e1e2f 0%, #151522 50%, #0d0d17 100%)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <section>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>GlassCard</h2>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "16px",
                    }}
                  >
                    <GlassCard optical={optical} elevation="flat">
                      <h3>Flat Elevation</h3>
                      <p style={{ opacity: 0.8, fontSize: "0.875rem" }}>
                        Subtle frosted glass for inline groupings.
                      </p>
                    </GlassCard>
                    <GlassCard optical={optical} elevation="raised">
                      <h3>Raised Elevation</h3>
                      <p style={{ opacity: 0.8, fontSize: "0.875rem" }}>
                        Standard glass elevation with specular edge highlights.
                      </p>
                    </GlassCard>
                    <GlassCard optical={optical} elevation="floating">
                      <h3>Floating Elevation</h3>
                      <p style={{ opacity: 0.8, fontSize: "0.875rem" }}>
                        Deep drop shadow and intense rim reflection.
                      </p>
                    </GlassCard>
                  </div>
                </section>

                <section>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>GlassButton</h2>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <GlassButton optical={optical} variant="primary">
                      Primary Tactile
                    </GlassButton>
                    <GlassButton optical={optical} variant="secondary">
                      Secondary Action
                    </GlassButton>
                    <GlassButton optical={optical} variant="ghost">
                      Ghost Transparent
                    </GlassButton>
                  </div>
                </section>

                <section>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>GlassNavbar</h2>
                  <GlassNavbar optical={optical} sticky={false} style={{ borderRadius: "12px" }}>
                    <span style={{ fontWeight: 600 }}>Glass Navigation Bar</span>
                    <span style={{ opacity: 0.8, fontSize: "0.875rem" }}>Search & Actions</span>
                  </GlassNavbar>
                </section>

                <section>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>GlassWindow</h2>
                  <GlassWindow
                    title="Component Preview"
                    optical={optical}
                    style={{ maxWidth: "400px" }}
                  >
                    <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.9 }}>
                      Nested glass window within the component catalog.
                    </p>
                  </GlassWindow>
                </section>

                <section>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>GlassDock</h2>
                  <GlassDock
                    optical={optical}
                    items={[
                      { id: "1", label: "Item 1", icon: <span>🌟</span> },
                      { id: "2", label: "Item 2", icon: <span>⚡</span> },
                      { id: "3", label: "Item 3", icon: <span>🔥</span> },
                      { id: "4", label: "Item 4", icon: <span>💎</span> },
                    ]}
                  />
                </section>
              </div>
            )}
          </main>

          {/* Controls Sidebar */}
          <aside>
            <ControlsPanel
              optical={optical}
              onChange={setOptical}
              onReset={() => setOptical({ ...DEFAULT_OPTICAL_PARAMS })}
              captureEnabled={captureEnabled}
              onCaptureEnabledChange={setCaptureEnabled}
              captureFps={captureFps}
              onCaptureFpsChange={setCaptureFps}
              nearBandDepth={nearBandDepth}
              onNearBandDepthChange={setNearBandDepth}
            />
          </aside>
        </div>
      </div>
    </GlassProvider>
  );
};
