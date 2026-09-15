import React, {
  forwardRef,
  useContext,
  useId,
  type CSSProperties,
  type FocusEvent,
  type InputHTMLAttributes,
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
  mergeDescribedBy,
} from "./glassFieldStyles";
import { GLASS_Z_SURFACE } from "../layers";

export interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  cornerRadius?: number;
  optical?: OpticalParams;
  label?: string;
  error?: string;
  invalid?: boolean;
  containerStyle?: CSSProperties;
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  (
    {
      cornerRadius = 12,
      optical,
      label,
      error,
      invalid,
      containerStyle,
      className,
      style,
      id,
      disabled,
      onFocus,
      onBlur,
      onPointerDown,
      "aria-describedby": ariaDescribedBy,
      ...rest
    },
    ref,
  ) => {
    // The `<input>` is the glass element, not the wrapper: the quad has to match the visible field,
    // and `cornerRadius` is the input's radius.
    const { elementRef } = useGlassElement<HTMLInputElement>({
      cornerRadius,
      optical,
    });

    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;

    const { isFocusVisible, focusRingHandlers } = useFocusRing<HTMLInputElement>();
    const isInvalid = Boolean(invalid) || Boolean(error);

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
        className="open-glass-input-field"
        style={{ position: "relative", zIndex: GLASS_Z_SURFACE, ...containerStyle }}
      >
        {label ? (
          <label htmlFor={inputId} style={fieldLabelStyle}>
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
          id={inputId}
          className={`open-glass-input ${className ?? ""}`}
          disabled={disabled}
          aria-invalid={isInvalid ? true : undefined}
          aria-describedby={mergeDescribedBy(ariaDescribedBy, error ? errorId : undefined)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPointerDown={handlePointerDown}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 14px",
            borderRadius: `${cornerRadius}px`,
            color: "rgba(255, 255, 255, 0.95)",
            fontSize: "0.9375rem",
            fontFamily: "inherit",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            ...fieldSurface(isRenderReady),
            ...focusRing(isFocusVisible, isInvalid),
            ...(disabled ? disabledSurface : null),
            ...style,
          }}
          {...rest}
        />
        {error ? (
          <div
            id={errorId}
            role="alert"
            style={{ marginTop: "6px", fontSize: "0.75rem", color: "rgb(255, 150, 150)" }}
          >
            {error}
          </div>
        ) : null}
      </div>
    );
  },
);

GlassInput.displayName = "GlassInput";
