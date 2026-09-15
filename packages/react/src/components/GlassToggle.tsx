import React, {
  forwardRef,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";
import { useGlassElement } from "../hooks/useGlassElement";
import { useFocusRing } from "../hooks/useFocusRing";
import { disabledSurface, fieldSurface, focusRing } from "./glassFieldStyles";
import { GLASS_Z_SURFACE } from "../layers";

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 30;
const KNOB_SIZE = 24;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

export interface GlassToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "value"
> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  cornerRadius?: number;
  optical?: OpticalParams;
  label?: string;
}

export const GlassToggle = forwardRef<HTMLButtonElement, GlassToggleProps>(
  (
    {
      checked,
      defaultChecked = false,
      onCheckedChange,
      // A pill: half the track height, unless the caller overrides it.
      cornerRadius = TRACK_HEIGHT / 2,
      optical,
      label,
      className,
      style,
      disabled,
      children,
      onClick,
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLButtonElement>({
      cornerRadius,
      optical,
    });

    const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
    const isControlled = checked !== undefined;
    const isChecked = isControlled ? checked : uncontrolledChecked;

    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;

    const { isFocusVisible, focusRingHandlers } = useFocusRing<HTMLButtonElement>();

    const toggle = () => {
      if (disabled) return;
      const next = !isChecked;
      if (!isControlled) {
        setUncontrolledChecked(next);
      }
      onCheckedChange?.(next);
    };

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      toggle();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (disabled) return;
      if (event.key !== " " && event.key !== "Enter") return;
      // `preventDefault` is load-bearing twice: it stops the page scrolling on Space, and it
      // suppresses the button's own native activation so the toggle fires once rather than twice.
      event.preventDefault();
      toggle();
    };

    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      focusRingHandlers.onFocus(event);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
      focusRingHandlers.onBlur(event);
      onBlur?.(event);
    };

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      focusRingHandlers.onPointerDown(event);
      onPointerDown?.(event);
    };

    const ring = focusRing(isFocusVisible);

    return (
      <button
        ref={(node) => {
          elementRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        type="button"
        role="switch"
        aria-checked={isChecked}
        aria-label={label && !children ? label : undefined}
        disabled={disabled}
        className={`open-glass-toggle ${className ?? ""}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        style={{
          position: "relative",
          zIndex: GLASS_Z_SURFACE,
          width: `${TRACK_WIDTH}px`,
          height: `${TRACK_HEIGHT}px`,
          padding: 0,
          borderRadius: `${cornerRadius}px`,
          cursor: "pointer",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
          ...fieldSurface(isRenderReady),
          ...ring,
          // The checked track tints on top of the surface, so keep it after `fieldSurface`.
          ...(isChecked
            ? {
                background: isRenderReady ? "rgba(90, 170, 255, 0.35)" : "rgba(90, 170, 255, 0.55)",
              }
            : null),
          ...(disabled ? disabledSurface : null),
          ...style,
        }}
        {...rest}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: `${KNOB_INSET}px`,
            left: isChecked ? `${TRACK_WIDTH - KNOB_SIZE - KNOB_INSET}px` : `${KNOB_INSET}px`,
            width: `${KNOB_SIZE}px`,
            height: `${KNOB_SIZE}px`,
            borderRadius: "50%",
            background: "rgba(255, 255, 255, 0.95)",
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.35)",
            transition: "left 0.18s ease",
          }}
        />
        {children}
      </button>
    );
  },
);

GlassToggle.displayName = "GlassToggle";
