import React, { useState } from "react";
import type { OpticalParams } from "@open-glass/core";
import {
  GlassButton,
  GlassCard,
  GlassCheckbox,
  GlassInput,
  GlassSelect,
  GlassSlider,
  GlassToggle,
  GlassWindow,
} from "@open-glass/react";

export interface FormsDemoProps {
  optical: Required<OpticalParams>;
}

const THEMES = [
  { value: "system", label: "Match System" },
  { value: "light", label: "Always Light" },
  { value: "dark", label: "Always Dark" },
  { value: "contrast", label: "High Contrast (unavailable)", disabled: true },
];

export const FormsDemo: React.FC<FormsDemoProps> = ({ optical }) => {
  const [displayName, setDisplayName] = useState("Ada Lovelace");
  const [email, setEmail] = useState("not-an-email");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [blurStrength, setBlurStrength] = useState(60);
  const [theme, setTheme] = useState("system");
  const [analytics, setAnalytics] = useState(false);
  const [partialSync, setPartialSync] = useState(true);

  const emailInvalid = !email.includes("@");

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: "700px",
        borderRadius: "28px",
        overflow: "hidden",
        background: "linear-gradient(150deg, #2b1055 0%, #16214a 45%, #071018 100%)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        padding: "3rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
      }}
    >
      {/* Backdrop detail, so there is something for the glass to refract. */}
      <div
        style={{
          position: "absolute",
          top: "12%",
          right: "8%",
          width: "440px",
          height: "440px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255, 128, 200, 0.4) 0%, transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "6%",
          left: "6%",
          width: "380px",
          height: "380px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(90, 200, 255, 0.35) 0%, transparent 70%)",
          filter: "blur(20px)",
        }}
      />

      <GlassCard optical={optical} elevation="flat" style={{ maxWidth: "560px", width: "100%" }}>
        <strong style={{ fontSize: "0.9375rem" }}>Tab through these.</strong>
        <p style={{ margin: "6px 0 0", fontSize: "0.8125rem", opacity: 0.85 }}>
          Every control below draws its focus indicator as a border plus stacked box-shadows, never
          an <code>outline</code>, so the ring survives the GPU composite. Click one with the mouse
          and no ring appears; reach it with the keyboard and it does.
        </p>
      </GlassCard>

      <GlassWindow title="Settings" optical={optical} style={{ maxWidth: "560px", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <GlassInput
            optical={optical}
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How should we address you?"
          />

          <GlassInput
            optical={optical}
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={emailInvalid}
            error={emailInvalid ? "That does not look like an email address." : undefined}
          />

          <GlassSelect
            optical={optical}
            label="Appearance"
            options={THEMES}
            value={theme}
            onValueChange={setTheme}
          />

          <GlassSlider
            optical={optical}
            id="forms-demo-blur"
            label={`Frosting strength — ${blurStrength}%`}
            min={0}
            max={100}
            step={5}
            value={blurStrength}
            onValueChange={setBlurStrength}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <span style={{ fontSize: "0.9375rem" }}>Notifications</span>
            <GlassToggle
              optical={optical}
              label="Notifications"
              checked={notifications}
              onCheckedChange={setNotifications}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <span style={{ fontSize: "0.9375rem", opacity: 0.6 }}>Reduce motion (disabled)</span>
            <GlassToggle
              optical={optical}
              label="Reduce motion"
              checked={reduceMotion}
              onCheckedChange={setReduceMotion}
              disabled
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <GlassCheckbox
              optical={optical}
              label="Share anonymous usage analytics"
              checked={analytics}
              onCheckedChange={setAnalytics}
            />
            <GlassCheckbox
              optical={optical}
              label="Sync everything (some items excluded)"
              checked={partialSync}
              indeterminate
              onCheckedChange={setPartialSync}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <GlassButton optical={optical} variant="ghost">
              Cancel
            </GlassButton>
            <GlassButton optical={optical} variant="primary">
              Save Changes
            </GlassButton>
          </div>
        </div>
      </GlassWindow>
    </div>
  );
};
