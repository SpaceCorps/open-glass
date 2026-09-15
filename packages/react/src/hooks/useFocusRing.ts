import { useCallback, useRef, useState, type FocusEvent, type PointerEvent } from "react";

export interface FocusRingHandlers<T extends HTMLElement> {
  onFocus: (event: FocusEvent<T>) => void;
  onBlur: (event: FocusEvent<T>) => void;
  onPointerDown: (event: PointerEvent<T>) => void;
}

export interface UseFocusRingResult<T extends HTMLElement> {
  isFocusVisible: boolean;
  focusRingHandlers: FocusRingHandlers<T>;
}

/**
 * Resolves `:focus-visible` in JavaScript, because `packages/react` styles everything inline and
 * inline styles cannot express a pseudo-class. The boolean is folded into the component's own
 * `border` / `boxShadow` instead.
 *
 * The modality is tracked from the pointer, not read off the element: probed against this repo's
 * jsdom, `element.matches(":focus-visible")` returns `true` for *any* focused element, mouse-focused
 * included, so gating on it would make "a mouse click shows no ring" both untestable and
 * unenforceable.
 */
export function useFocusRing<T extends HTMLElement = HTMLElement>(): UseFocusRingResult<T> {
  const [isFocusVisible, setIsFocusVisible] = useState(false);
  // Set by a pointerdown that is about to move focus here, and consumed by the focus that follows.
  const pointerFocusRef = useRef(false);

  const onPointerDown = useCallback(() => {
    pointerFocusRef.current = true;
  }, []);

  const onFocus = useCallback(() => {
    setIsFocusVisible(!pointerFocusRef.current);
    pointerFocusRef.current = false;
  }, []);

  const onBlur = useCallback(() => {
    setIsFocusVisible(false);
    pointerFocusRef.current = false;
  }, []);

  return {
    isFocusVisible,
    focusRingHandlers: { onFocus, onBlur, onPointerDown },
  };
}
