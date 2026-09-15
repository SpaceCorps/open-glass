import React, { useState } from "react";
import type { OpticalParams } from "@open-glass/core";
import {
  GlassButton,
  GlassCard,
  GlassDock,
  type GlassDockItem,
  GlassNavbar,
  GlassUnderlying,
  GlassWindow,
} from "@open-glass/react";

export interface DesktopDemoProps {
  optical: Required<OpticalParams>;
  /** Depth of the floating-card layer, in pixels behind the glass. The document sits at 480. */
  nearBandDepth: number;
}

/** Pixels behind the glass for the document layer: the far band, and the reference for the near one. */
const DOCUMENT_BAND_DEPTH = 480;

export const DesktopDemo: React.FC<DesktopDemoProps> = ({ optical, nearBandDepth }) => {
  const [windowOpen, setWindowOpen] = useState(true);
  const [windowPos, setWindowPos] = useState({ x: 120, y: 110 });
  const [counter, setCounter] = useState(42);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, initialX: 120, initialY: 110 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only initiate drag on titlebar or header area
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".open-glass-window-content")) {
      return;
    }
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      initialX: windowPos.x,
      initialY: windowPos.y,
    });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setWindowPos({
      x: Math.max(20, dragStart.initialX + dx),
      y: Math.max(50, dragStart.initialY + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const dockItems: GlassDockItem[] = [
    {
      id: "finder",
      label: "Finder",
      icon: <span style={{ fontSize: "1.5rem" }}>🗂️</span>,
      active: windowOpen,
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
        minHeight: "750px",
        borderRadius: "24px",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 20% 30%, #5e2a84 0%, #1e1136 40%, #0c0817 100%), linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Background wallpaper glow orbs */}
      <div
        style={{
          position: "absolute",
          top: "12%",
          left: "22%",
          width: "350px",
          height: "350px",
          borderRadius: "50%",
          background: "linear-gradient(45deg, #ff0844 0%, #ffb199 100%)",
          filter: "blur(35px)",
          opacity: 0.7,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "18%",
          right: "18%",
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: "linear-gradient(45deg, #00c6ff 0%, #0072ff 100%)",
          filter: "blur(45px)",
          opacity: 0.65,
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
          <span style={{ color: "rgba(255,255,255,0.7)" }}>Window</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>Help</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.8125rem" }}>
          <span>100% 🔋</span>
          <span>Wi-Fi 📶</span>
          <span>Tue 9:41 AM</span>
        </div>
      </GlassNavbar>

      {/* Desktop Workspace with Underlying Document and Floating Glass */}
      <div style={{ position: "relative", flex: 1, padding: "1.5rem", overflow: "hidden" }}>
        {/* Rich Underlying Document Layer to be captured and refracted, at the far band */}
        <GlassUnderlying
          depth={DOCUMENT_BAND_DEPTH}
          style={{
            position: "absolute",
            inset: "1.5rem",
            bottom: "80px",
            overflow: "auto",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "24px",
            padding: "1.5rem",
            borderRadius: "18px",
            background: "rgba(10, 12, 24, 0.4)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            color: "#f8fafc",
          }}
        >
          {/* Article & Typography Column */}
          <div>
            <div
              style={{
                display: "inline-block",
                padding: "3px 10px",
                borderRadius: "20px",
                background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
                fontSize: "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: "10px",
              }}
            >
              Real-Time Optical Physics
            </div>

            <h1
              style={{
                fontSize: "1.85rem",
                fontWeight: 800,
                lineHeight: 1.2,
                margin: "0 0 12px 0",
                background: "linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Refraction of Live DOM Content in GPU Shaders
            </h1>

            <div
              style={{
                fontSize: "0.8rem",
                color: "#94a3b8",
                marginBottom: "16px",
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <span>By Rory Chatt</span>
              <span>•</span>
              <span>SpaceCorps Research</span>
              <span>•</span>
              <span style={{ color: "#38bdf8" }}>30 FPS Rasterization</span>
            </div>

            <p
              style={{
                fontSize: "0.875rem",
                lineHeight: 1.6,
                color: "#e2e8f0",
                margin: "0 0 14px 0",
              }}
            >
              The open-glass rendering pipeline transforms standard HTML elements into dynamic GPU
              textures. By combining SVG ForeignObject rasterization with Dual Kawase downsampling,
              arbitrary typography, high-contrast diagrams, and live user interactions refract under
              floating glass windows according to Snell's law:
            </p>

            <div
              style={{
                background: "rgba(30, 41, 59, 0.8)",
                borderLeft: "4px solid #38bdf8",
                padding: "10px 14px",
                borderRadius: "4px",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                color: "#7dd3fc",
                marginBottom: "14px",
              }}
            >
              n₁ • sin(θ₁) = n₂ • sin(θ₂)
            </div>

            <p
              style={{
                fontSize: "0.875rem",
                lineHeight: 1.6,
                color: "#cbd5e1",
                margin: "0 0 16px 0",
              }}
            >
              Notice how the chromatic aberration coefficient splits the RGB channels along the
              boundaries of this text. As you reposition the window above, notice the high-frequency
              contrast of the colored headings and vector illustrations warping dynamically beneath
              the frosted surface.
            </p>

            {/* Interactive counter and live metric pill */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
                padding: "12px",
                borderRadius: "12px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  Underlying State Counter
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#facc15" }}>
                  Active Mutations: {counter}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCounter((c) => c + 1)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Trigger Mutation (+1)
              </button>
            </div>
          </div>

          {/* Graphical Cards and Illustration Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* High-Contrast Colorful SVG Diagram Card */}
            <div
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "#c084fc",
                  marginBottom: "8px",
                }}
              >
                Spectral Dispersion Diagram
              </div>
              <svg
                viewBox="0 0 300 120"
                style={{ width: "100%", height: "120px", display: "block" }}
                aria-label="Refraction Ray Diagram"
              >
                <defs>
                  <linearGradient id="prismGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="50%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#c084fc" />
                  </linearGradient>
                </defs>
                <polygon
                  points="150,15 250,105 50,105"
                  fill="url(#prismGrad)"
                  opacity="0.3"
                  stroke="#818cf8"
                  strokeWidth="2"
                />
                <line x1="10" y1="60" x2="110" y2="60" stroke="#ffffff" strokeWidth="3" />
                <line x1="110" y1="60" x2="190" y2="55" stroke="#ef4444" strokeWidth="2.5" />
                <line x1="110" y1="60" x2="190" y2="70" stroke="#22c55e" strokeWidth="2.5" />
                <line x1="110" y1="60" x2="190" y2="85" stroke="#3b82f6" strokeWidth="2.5" />
                <line x1="190" y1="55" x2="290" y2="40" stroke="#ef4444" strokeWidth="2" />
                <line x1="190" y1="70" x2="290" y2="70" stroke="#22c55e" strokeWidth="2" />
                <line x1="190" y1="85" x2="290" y2="100" stroke="#3b82f6" strokeWidth="2" />
                <circle cx="110" cy="60" r="4" fill="#fff" />
                <text x="15" y="50" fill="#cbd5e1" fontSize="11" fontFamily="sans-serif">
                  Incident Ray
                </text>
                <text x="230" y="32" fill="#ef4444" fontSize="10" fontFamily="sans-serif">
                  Red (λ₁)
                </text>
                <text x="230" y="65" fill="#22c55e" fontSize="10" fontFamily="sans-serif">
                  Green (λ₂)
                </text>
                <text x="230" y="112" fill="#3b82f6" fontSize="10" fontFamily="sans-serif">
                  Blue (λ₃)
                </text>
              </svg>
            </div>

            {/* High-Contrast Photographic Artwork Card */}
            <div
              style={{
                display: "flex",
                gap: "14px",
                padding: "14px",
                borderRadius: "14px",
                background: "rgba(15, 23, 42, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "10px",
                  background:
                    "conic-gradient(from 180deg at 50% 50%, #f43f5e 0deg, #fb923c 72deg, #facc15 144deg, #22c55e 216deg, #3b82f6 288deg, #a855f7 360deg)",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fff" }}>
                  Chromatic Lens Target
                </div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px" }}>
                  High-saturation radial test target for measuring edge dispersion and frosted glass
                  blurring.
                </div>
              </div>
            </div>

            {/* Animated Progress Indicator */}
            <div
              style={{
                padding: "14px",
                borderRadius: "14px",
                background: "rgba(15, 23, 42, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  marginBottom: "6px",
                }}
              >
                <span>Dual Kawase Sampling Buffer</span>
                <span style={{ color: "#38bdf8", fontWeight: 600 }}>
                  {(counter * 7) % 100}% Active
                </span>
              </div>
              <div
                style={{
                  height: "8px",
                  borderRadius: "4px",
                  background: "rgba(255, 255, 255, 0.1)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(counter * 7) % 100}%`,
                    background: "linear-gradient(90deg, #38bdf8, #818cf8, #ec4899)",
                    borderRadius: "4px",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </GlassUnderlying>

        {/*
          Near band: cards sitting just under the glass, laid across the path the window is dragged
          along. Both layers are refracted by the same panel at the same time, so dragging the window
          across them shows the parallax directly — these shift by a fraction of what the document
          behind them does, because they are a fraction of its distance away.
        */}
        <GlassUnderlying
          depth={nearBandDepth}
          style={{
            position: "absolute",
            left: "3.5rem",
            right: "3.5rem",
            top: "210px",
            display: "flex",
            gap: "16px",
            pointerEvents: "none",
          }}
        >
          {[
            { label: "Now Playing", value: "Kawase Mix", accent: "#f472b6" },
            { label: "Depth", value: `${nearBandDepth}px`, accent: "#38bdf8" },
            { label: "Far Band", value: `${DOCUMENT_BAND_DEPTH}px`, accent: "#a78bfa" },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                flex: 1,
                padding: "0.75rem 0.9rem",
                borderRadius: "14px",
                background: "rgba(255, 255, 255, 0.16)",
                border: `1px solid ${card.accent}`,
                boxShadow: `0 12px 30px rgba(0, 0, 0, 0.45)`,
                color: "#f8fafc",
              }}
            >
              <div style={{ fontSize: "0.7rem", opacity: 0.75, letterSpacing: "0.06em" }}>
                {card.label.toUpperCase()}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: card.accent }}>
                {card.value}
              </div>
            </div>
          ))}
        </GlassUnderlying>

        {/* Floating Interactive Glass Window */}
        {windowOpen && (
          <GlassWindow
            title="System Monitor: GPU Glass Core"
            optical={optical}
            onClose={() => setWindowOpen(false)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              position: "absolute",
              left: `${windowPos.x}px`,
              top: `${windowPos.y}px`,
              width: "450px",
              minHeight: "270px",
              cursor: isDragging ? "grabbing" : "grab",
              zIndex: 5,
            }}
          >
            <div style={{ color: "#fff", fontSize: "0.875rem" }}>
              <p style={{ margin: "0 0 1rem 0", opacity: 0.9, lineHeight: 1.5 }}>
                Drag this glass window over the underlying document and illustrations to observe
                real-time GPU refraction, chromatic dispersion, and frosted blur distortion.
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
                  Mutate DOM: {counter}
                </GlassButton>
                <GlassButton
                  optical={optical}
                  variant="secondary"
                  onClick={() => setWindowPos((p) => ({ x: p.x + 30, y: p.y + 20 }))}
                  style={{ padding: "0.5rem 1rem" }}
                >
                  Nudge Position
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
