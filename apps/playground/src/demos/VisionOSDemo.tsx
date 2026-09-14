import React, { useState } from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassButton, GlassCard, GlassWindow } from "@open-glass/react";

export interface VisionOSDemoProps {
  optical: Required<OpticalParams>;
}

export const VisionOSDemo: React.FC<VisionOSDemoProps> = ({ optical }) => {
  const [activeTab, setActiveTab] = useState<"apps" | "media" | "spatial">("spatial");

  return (
    <div
      className="visionos-environment"
      style={{
        position: "relative",
        width: "100%",
        minHeight: "700px",
        borderRadius: "28px",
        overflow: "hidden",
        background: "radial-gradient(ellipse at center, #1b263b 0%, #0d1b2a 60%, #000814 100%)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem",
        perspective: "1200px",
      }}
    >
      {/* Dynamic spatial glow backdrop */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "10%",
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123, 44, 191, 0.45) 0%, transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "10%",
          right: "15%",
          width: "450px",
          height: "450px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(72, 191, 227, 0.4) 0%, transparent 70%)",
          filter: "blur(50px)",
        }}
      />

      {/* Floating Spatial Window with 3D Tilt */}
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          zIndex: 5,
        }}
      >
        <GlassWindow
          title="visionOS Spatial Canvas"
          variant="visionos"
          optical={optical}
          cornerRadius={28}
          enableParallax={true}
          maxTiltAngle={14}
          depth={18}
          style={{ width: "100%" }}
        >
          <div style={{ color: "#fff" }}>
            <div
              style={{
                display: "flex",
                gap: "8px",
                marginBottom: "1.5rem",
                borderBottom: "1px solid rgba(255,255,255,0.15)",
                paddingBottom: "0.75rem",
              }}
            >
              {(["spatial", "apps", "media"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: activeTab === tab ? "rgba(255,255,255,0.25)" : "transparent",
                    border: "none",
                    borderRadius: "20px",
                    padding: "0.5rem 1.25rem",
                    color: "#fff",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <GlassCard
                elevation="floating"
                optical={optical}
                style={{ padding: "1.25rem", borderRadius: "18px" }}
              >
                <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.125rem" }}>
                  Spatial Glass Refraction
                </h3>
                <p style={{ margin: 0, opacity: 0.85, fontSize: "0.875rem", lineHeight: 1.5 }}>
                  VisionOS interfaces rely on physical volume glass displacement where elements
                  dynamically refract virtual scenes and physical surroundings with specular rim
                  reflections.
                </p>
              </GlassCard>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "12px",
                }}
              >
                {["Micro-Roughness", "Schlick Fresnel", "Dispersion"].map((feature, i) => (
                  <GlassCard
                    key={feature}
                    elevation="raised"
                    optical={optical}
                    style={{ padding: "1rem", borderRadius: "14px", textAlign: "center" }}
                  >
                    <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
                      {i === 0 ? "✨" : i === 1 ? "🔮" : "🌈"}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{feature}</div>
                  </GlassCard>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  marginTop: "0.5rem",
                }}
              >
                <GlassButton optical={optical} variant="secondary">
                  Dismiss
                </GlassButton>
                <GlassButton optical={optical} variant="primary">
                  Launch Experience
                </GlassButton>
              </div>
            </div>
          </div>
        </GlassWindow>
      </div>
    </div>
  );
};
