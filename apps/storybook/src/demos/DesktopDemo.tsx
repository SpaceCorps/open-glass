import React, { useState } from "react";
import type { OpticalParams } from "@open-glass/core";
import {
  GlassButton,
  GlassCard,
  GlassDock,
  type GlassDockItem,
  GlassNavbar,
  GlassWindow,
} from "@open-glass/react";

export interface DesktopDemoProps {
  optical: Required<OpticalParams>;
}

export const DesktopDemo: React.FC<DesktopDemoProps> = ({ optical }) => {
  const [windowOpen, setWindowOpen] = useState(true);
  const [windowPos, setWindowPos] = useState({ x: 80, y: 100 });
  const [counter, setCounter] = useState(42);

  const dockItems: GlassDockItem[] = [
    {
      id: "finder",
      label: "Finder",
      icon: <span style={{ fontSize: "1.5rem" }}>🗂️</span>,
      active: true,
      onClick: () => setWindowOpen((prev) => !prev),
    },
    {
      id: "terminal",
      label: "Terminal",
      icon: <span style={{ fontSize: "1.5rem" }}>📟</span>,
    },
    {
      id: "music",
      label: "Music",
      icon: <span style={{ fontSize: "1.5rem" }}>🎵</span>,
    },
    {
      id: "safari",
      label: "Safari",
      icon: <span style={{ fontSize: "1.5rem" }}>🧭</span>,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <span style={{ fontSize: "1.5rem" }}>⚙️</span>,
    },
  ];

  return (
    <div
      className="desktop-environment"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "700px",
        borderRadius: "24px",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 20% 30%, #5e2a84 0%, #1e1136 40%, #0c0817 100%), linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Dynamic colorful wallpaper background objects to showcase refraction & blur */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "25%",
          width: "350px",
          height: "350px",
          borderRadius: "50%",
          background: "linear-gradient(45deg, #ff0844 0%, #ffb199 100%)",
          filter: "blur(30px)",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "20%",
          right: "20%",
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: "linear-gradient(45deg, #00c6ff 0%, #0072ff 100%)",
          filter: "blur(40px)",
          opacity: 0.8,
        }}
      />

      {/* Top macOS Menu Bar */}
      <GlassNavbar optical={optical} style={{ height: "38px", padding: "0 1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.875rem" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem" }}></span>
          <span style={{ fontWeight: 600 }}>OpenGlass</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>File</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>Edit</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>View</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>Help</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.8125rem" }}>
          <span>100% 🔋</span>
          <span>Wi-Fi 📶</span>
          <span>Tue 9:41 AM</span>
        </div>
      </GlassNavbar>

      {/* Desktop Workspace */}
      <div style={{ position: "relative", flex: 1, padding: "2rem" }}>
        {/* Floating Interactive Glass Window */}
        {windowOpen && (
          <GlassWindow
            title="System Monitor — GPU Glass Core"
            optical={optical}
            onClose={() => setWindowOpen(false)}
            style={{
              position: "absolute",
              left: `${windowPos.x}px`,
              top: `${windowPos.y}px`,
              width: "440px",
              minHeight: "260px",
            }}
          >
            <div style={{ color: "#fff", fontSize: "0.875rem" }}>
              <p style={{ margin: "0 0 1rem 0", opacity: 0.9 }}>
                Apple Glass UI rendered on WebGPU with real-time Dual Kawase frosted glass blur,
                Snell's law refraction, and chromatic aberration dispersion.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "1.25rem",
                }}
              >
                <GlassCard
                  elevation="flat"
                  optical={optical}
                  style={{ padding: "0.75rem", borderRadius: "12px" }}
                >
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Optical Refraction</div>
                  <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>{optical.ior} IOR</div>
                </GlassCard>

                <GlassCard
                  elevation="flat"
                  optical={optical}
                  style={{ padding: "0.75rem", borderRadius: "12px" }}
                >
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Kawase Radius</div>
                  <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                    {optical.blurRadius}px
                  </div>
                </GlassCard>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <GlassButton
                  optical={optical}
                  onClick={() => setCounter((c) => c + 1)}
                  style={{ padding: "0.5rem 1rem" }}
                >
                  Count: {counter}
                </GlassButton>
                <GlassButton
                  optical={optical}
                  variant="secondary"
                  onClick={() => setWindowPos((p) => ({ x: p.x + 20, y: p.y + 10 }))}
                  style={{ padding: "0.5rem 1rem" }}
                >
                  Nudge Window
                </GlassButton>
              </div>
            </div>
          </GlassWindow>
        )}
      </div>

      {/* Bottom Floating Glass Dock */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          paddingBottom: "1.25rem",
          position: "relative",
          zIndex: 10,
        }}
      >
        <GlassDock items={dockItems} optical={optical} />
      </div>
    </div>
  );
};
