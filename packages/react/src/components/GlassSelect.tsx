import React, {
  forwardRef,
  useContext,
  useId,
  type ChangeEvent,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";
import { useGlassElement } from "../hooks/useGlassElement";
import { useFocusRing } from "../hooks/useFocusRing";
import { disabledSurface, fieldLabelStyle, fieldSurface, focusRing } from "./glassFieldStyles";
import { GLASS_Z_SURFACE } from "../layers";

export interface GlassSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface GlassSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: GlassSelectOption[];
  onValueChange?: (value: string) => void;
  cornerRadius?: number;
  optical?: OpticalParams;
  label?: string;
  placeholder?: string;
  children?: ReactNode;
}

/**
 * A **native `<select>` styled as glass**. A custom listbox needs full ARIA combobox semantics, focus
 * trapping and type-ahead, and a half-implemented one is worse for AT users than a styled native
 * element — which also brings the platform popup on mobile for free.
 */
export const GlassSelect = forwardRef<HTMLSelectElement, GlassSelectProps>(
  (
    {
      options,
      onValueChange,
      cornerRadius = 12,
      optical,
      label,
      placeholder,
      className,
      style,
      id,
      disabled,
      children,
      onChange,
      onFocus,
      onBlur,
      onPointerDown,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLSelectElement>({
      cornerRadius,
      optical,
    });

    const generatedId = useId();
    const selectId = id ?? generatedId;

    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;

    const { isFocusVisible, focusRingHandlers } = useFocusRing<HTMLSelectElement>();

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
      onChange?.(event);
      onValueChange?.(event.target.value);
    };

    const handleFocus = (event: FocusEvent<HTMLSelectElement>) => {
      focusRingHandlers.onFocus(event);
      onFocus?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLSelectElement>) => {
      focusRingHandlers.onBlur(event);
      onBlur?.(event);
    };

    const handlePointerDown = (event: PointerEvent<HTMLSelectElement>) => {
      focusRingHandlers.onPointerDown(event);
      onPointerDown?.(event);
    };

    return (
      <div
        className="open-glass-select-field"
        style={{ position: "relative", zIndex: GLASS_Z_SURFACE }}
      >
        {label ? (
          <label htmlFor={selectId} style={fieldLabelStyle}>
            {label}
          </label>
        ) : null}
        <div style={{ position: "relative" }}>
          <select
            ref={(node) => {
              elementRef.current = node;
              if (typeof ref === "function") {
                ref(node);
              } else if (ref) {
                ref.current = node;
              }
            }}
            id={selectId}
            className={`open-glass-select ${className ?? ""}`}
            disabled={disabled}
            // Keyboard handling is deliberately not intercepted: opening the popup cannot be
            // reimplemented, and swallowing keys would break type-ahead. This is the one control
            // that delegates fully.
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPointerDown={handlePointerDown}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 36px 10px 14px",
              borderRadius: `${cornerRadius}px`,
              color: "rgba(255, 255, 255, 0.95)",
              fontSize: "0.9375rem",
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              ...fieldSurface(isRenderReady),
              ...focusRing(isFocusVisible),
              ...(disabled ? disabledSurface : null),
              ...style,
            }}
            {...rest}
          >
            {/* The dropdown list itself is UA-rendered and is *not* glass — that is the accepted
                cost of keeping native combobox semantics. */}
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {children ??
              options?.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
          </select>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: "14px",
              top: "50%",
              transform: "translateY(-50%)",
              // Never eats a click that belongs to the select.
              pointerEvents: "none",
              fontSize: "0.625rem",
              color: "rgba(255, 255, 255, 0.7)",
            }}
          >
            ▼
          </span>
        </div>
      </div>
    );
  },
);

GlassSelect.displayName = "GlassSelect";
