import React, {
  forwardRef,
  useContext,
  useEffect,
  useRef,
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
import { disabledSurface, fieldSurface, focusRing } from "./glassFieldStyles";
import { GLASS_Z_SURFACE } from "../layers";

export interface GlassCheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange"
> {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  cornerRadius?: number;
  optical?: OpticalParams;
  label?: string;
}

export const GlassCheckbox = forwardRef<HTMLInputElement, GlassCheckboxProps>(
  (
    {
      checked,
      defaultChecked = false,
      indeterminate = false,
      onCheckedChange,
      onChange,
      cornerRadius = 6,
      optical,
      label,
      className,
      style,
      disabled,
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown,
      ...rest
    },
    ref,
  ) => {
    const { elementRef } = useGlassElement<HTMLInputElement>({
      cornerRadius,
      optical,
    });
    // Three consumers of one node: the glass registration, the forwarded ref, and this internal one
    // for the `indeterminate` DOM property.
    const innerRef = useRef<HTMLInputElement | null>(null);

    const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
    const isControlled = checked !== undefined;
    const isChecked = isControlled ? checked : uncontrolledChecked;

    const context = useContext(GlassContext);
    const isRenderReady = context?.isRenderReady ?? false;

    const { isFocusVisible, focusRingHandlers } = useFocusRing<HTMLInputElement>();

    // `indeterminate` has no attribute form, so it is set as a DOM property. `aria-checked="mixed"`
    // is set alongside it so AT reports the third state.
    useEffect(() => {
      if (innerRef.current) {
        innerRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const toggle = () => {
      if (disabled) return;
      const next = !isChecked;
      if (!isControlled) {
        setUncontrolledChecked(next);
      }
      onCheckedChange?.(next);
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      toggle();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (disabled) return;
      if (event.key !== " ") return;
      // Same single-actuation and testability reasoning as GlassToggle: cancel the UA's own
      // activation so the toggle fires exactly once.
      event.preventDefault();
      toggle();
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

    const input = (
      <input
        ref={(node) => {
          elementRef.current = node;
          innerRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        type="checkbox"
        className={`open-glass-checkbox ${className ?? ""}`}
        checked={isChecked}
        disabled={disabled}
        aria-checked={indeterminate ? "mixed" : isChecked}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "20px",
          height: "20px",
          margin: 0,
          flexShrink: 0,
          boxSizing: "border-box",
          borderRadius: `${cornerRadius}px`,
          cursor: "pointer",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
          ...fieldSurface(isRenderReady),
          ...focusRing(isFocusVisible),
          ...(isChecked || indeterminate
            ? {
                background: isRenderReady ? "rgba(90, 170, 255, 0.35)" : "rgba(90, 170, 255, 0.55)",
              }
            : null),
          ...(disabled ? disabledSurface : null),
          ...style,
        }}
        {...rest}
      />
    );

    if (!label) {
      return input;
    }

    return (
      <label
        className="open-glass-checkbox-field"
        style={{
          position: "relative",
          zIndex: GLASS_Z_SURFACE,
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "0.9375rem",
          color: "rgba(255, 255, 255, 0.9)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {input}
        <span>{label}</span>
      </label>
    );
  },
);

GlassCheckbox.displayName = "GlassCheckbox";
