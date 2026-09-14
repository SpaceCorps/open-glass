import { useContext, useEffect, useId, useRef } from "react";
import type { OpticalParams } from "@open-glass/core";
import { GlassContext } from "../context/GlassContext";

export interface UseGlassElementOptions {
  id?: string | number;
  cornerRadius?: number;
  optical?: OpticalParams;
  disabled?: boolean;
}

export function useGlassElement<T extends HTMLElement = HTMLDivElement>(
  options: UseGlassElementOptions = {},
) {
  const generatedId = useId();
  const id = options.id ?? generatedId;
  const elementRef = useRef<T | null>(null);
  const context = useContext(GlassContext);

  const cornerRadius = options.cornerRadius ?? 16;
  const optical = options.optical;
  const disabled = options.disabled ?? false;

  useEffect(() => {
    if (!context || disabled) return;

    const el = elementRef.current;
    if (!el) return;

    const updateGeometry = () => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Quads live in the glass canvas's coordinate space, which is the provider's container — not
      // whatever positioned ancestor the element happens to sit inside. `offsetParent` is only a
      // fallback for a hook used outside a provider-rendered tree.
      const origin = context.containerRef?.current ?? el.offsetParent;
      const originRect = origin?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
      };

      const x = rect.left - originRect.left;
      const y = rect.top - originRect.top;

      context.registerElement(
        {
          id,
          x,
          y,
          width: rect.width,
          height: rect.height,
          cornerRadius,
          optical,
        },
        el,
      );
    };

    updateGeometry();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateGeometry();
          })
        : null;
    if (resizeObserver) {
      resizeObserver.observe(el);
    }

    window.addEventListener("scroll", updateGeometry, { passive: true });
    window.addEventListener("resize", updateGeometry, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", updateGeometry);
      window.removeEventListener("resize", updateGeometry);
      context.unregisterElement(id);
    };
  }, [context, id, cornerRadius, optical, disabled]);

  return { elementRef, id };
}
