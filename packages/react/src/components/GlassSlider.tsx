import React, {
  forwardRef,
  useContext,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";
import { useGlassElement } from "../hooks/useGlassElement";
import { useFocusRing } from "../hooks/useFocusRing";
import {
  disabledSurface,
  fieldLabelStyle,
  fieldSurface,
  focusRing,
  snapToStep,
} from "./glassFieldStyles";
import { GLASS_Z_SURFACE } from "../layers";

export interface GlassSliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  cornerRadius?: number;
  optical?: OpticalParams;
  label?: string;
}

export const GlassSlider = forwardRef<HTMLInputElement, GlassSliderProps>(
  (
    {
      min = 0,
      max = 100,
      step = 1,
      value,
      defaultValue,
      onValueChange,
      cornerRadius = 8,
      optical,
      label,
      className,
      style,
      id,
      disabled,
      onChange,
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown,
      ...rest
    },
    ref,
  ) => {
    // The glass quad is the track, so the `<input>` itself registers.
    const { elementRef } = useGlassElement<HTMLInputElement>({
      cornerRadius,
      optical,
    });

    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? min);
    const isControlled = value !== undefined;
    const currentValue = isControlled ? value : uncontrolledValue;

    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;

    const { isFocusVisible, focusRingHandlers } = useFocusRing<HTMLInputElement>();

    const commit = (next: number) => {
      const snapped = snapToStep(next, min, max, step);
      if (snapped === currentValue) return;
      if (!isControlled) {
        setUncontrolledValue(snapped);
      }
      onValueChange?.(snapped);
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      if (disabled) return;
      commit(Number(event.target.value));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (disabled) return;

      let next: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = currentValue - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = currentValue + step;
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        case "PageDown":
          next = currentValue - step * 10;
          break;
        case "PageUp":
          next = currentValue + step * 10;
          break;
        default:
          return;
      }

      // `preventDefault` suppresses the UA's own stepping, so the value moves exactly one step in
      // every environment rather than two where the UA also handles the key — and it makes the
      // keyboard contract assertable under jsdom, which implements no range stepping at all.
      event.preventDefault();
      commit(next);
    };

    const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
      focusRingHandlers.onFocus(event);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
      focusRingHandlers.onBlur(event);
      onBlur?.(event);
    };

    const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
      focusRingHandlers.onPointerDown(event);
      onPointerDown?.(event);
    };

    return (
      <div
        className="open-glass-slider-field"
        style={{ position: "relative", zIndex: GLASS_Z_SURFACE }}
      >
        {label ? (
          <label htmlFor={id} style={fieldLabelStyle}>
            {label}
          </label>
        ) : null}
        <input
          ref={(node) => {
            elementRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
          }}
          // A native range gives the `role="slider"` mapping and AT support for free, so it is never
          // re-declared here and never hand-rolled.
          type="range"
          id={id}
          className={`open-glass-slider ${className ?? ""}`}
          min={min}
          max={max}
          step={step}
          value={currentValue}
          disabled={disabled}
          // Explicit even though native range implies all three: AT coverage of the implicit mapping
          // is uneven.
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPointerDown={handlePointerDown}
          style={{
            // The thumb is a UA pseudo-element and cannot be styled inline; that is out of scope
            // rather than a reason to introduce a stylesheet into this package.
            appearance: "none",
            WebkitAppearance: "none",
            width: "100%",
            height: "16px",
            boxSizing: "border-box",
            borderRadius: `${cornerRadius}px`,
            cursor: "pointer",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            ...fieldSurface(isRenderReady),
            ...focusRing(isFocusVisible),
            ...(disabled ? disabledSurface : null),
            ...style,
          }}
          {...rest}
        />
      </div>
    );
  },
);

GlassSlider.displayName = "GlassSlider";
