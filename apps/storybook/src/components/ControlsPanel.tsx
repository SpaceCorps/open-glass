import React from "react";
import type { OpticalParams } from "@open-glass/core";

export interface ControlsPanelProps {
  optical: Required<OpticalParams>;
  onChange: (updated: Required<OpticalParams>) => void;
  onReset: () => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({ optical, onChange, onReset }) => {
  const update = <K extends keyof OpticalParams>(key: K, value: OpticalParams[K]) => {
    onChange({
      ...optical,
      [key]: value,
    });
  };

  return (
    <div
      className="open-glass-controls"
      style={{
        padding: "1.25rem",
        borderRadius: "16px",
        background: "rgba(20, 20, 25, 0.75)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        color: "#f0f0f5",
        fontSize: "0.8125rem",
        width: "320px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: "0.5rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9375rem", letterSpacing: "-0.01em" }}>
          Optical Engine Physics
        </span>
        <button
          type="button"
          onClick={onReset}
          style={{
            background: "transparent",
            border: "none",
            color: "#a0a0b0",
            cursor: "pointer",
            fontSize: "0.75rem",
            textDecoration: "underline",
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Blur Radius */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Dual Kawase Blur</span>
            <span style={{ fontFamily: "monospace" }}>{optical.blurRadius.toFixed(0)}px</span>
          </div>
          <input
            type="range"
            min="1"
            max="32"
            step="1"
            value={optical.blurRadius}
            onChange={(e) => update("blurRadius", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Index of Refraction (IOR) */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Index of Refraction (IOR)</span>
            <span style={{ fontFamily: "monospace" }}>{optical.ior.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="1.0"
            max="2.5"
            step="0.01"
            value={optical.ior}
            onChange={(e) => update("ior", Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: "0.6875rem", color: "#888", marginTop: "2px" }}>
            1.00 Air · 1.49 Acrylic · 1.52 Crown Glass · 2.42 Diamond
          </div>
        </div>

        {/* Chromatic Aberration Dispersion */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Chromatic Dispersion</span>
            <span style={{ fontFamily: "monospace" }}>{optical.dispersion.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="0.2"
            step="0.005"
            value={optical.dispersion}
            onChange={(e) => update("dispersion", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Fresnel Sheen Intensity */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Fresnel Edge Sheen</span>
            <span style={{ fontFamily: "monospace" }}>{optical.sheenIntensity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="1.5"
            step="0.05"
            value={optical.sheenIntensity}
            onChange={(e) => update("sheenIntensity", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Rim Power */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Specular Rim Power</span>
            <span style={{ fontFamily: "monospace" }}>{optical.rimPower.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="1.0"
            max="8.0"
            step="0.5"
            value={optical.rimPower}
            onChange={(e) => update("rimPower", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Light Angle */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Light Angle</span>
            <span style={{ fontFamily: "monospace" }}>
              {Math.round((optical.lightAngle * 180) / Math.PI)}°
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.PI * 2}
            step="0.05"
            value={optical.lightAngle}
            onChange={(e) => update("lightAngle", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Frosting Grain / Roughness */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Frosting Micro-Roughness</span>
            <span style={{ fontFamily: "monospace" }}>{optical.roughness.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="0.1"
            step="0.005"
            value={optical.roughness}
            onChange={(e) => update("roughness", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Tint Opacity */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Glass Tint Opacity</span>
            <span style={{ fontFamily: "monospace" }}>{optical.tintColor[3].toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="0.6"
            step="0.02"
            value={optical.tintColor[3]}
            onChange={(e) => {
              const alpha = Number(e.target.value);
              const [r, g, b] = optical.tintColor;
              update("tintColor", [r, g, b, alpha]);
            }}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
};
