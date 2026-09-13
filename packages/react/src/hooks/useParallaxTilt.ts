import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface UseParallaxTiltOptions {
  /** Enable interactive 3D parallax tilt on cursor and device motion. Defaults to true. */
  enableParallax?: boolean;
  /** Maximum tilt angle in degrees. Defaults to 12. */
  maxTiltAngle?: number;
  /** Enable device orientation listener. Defaults to true. */
  enableDeviceOrientation?: boolean;
}

export interface UseParallaxTiltResult {
  tiltX: number;
  tiltY: number;
  normalizedX: number;
  normalizedY: number;
  isHovered: boolean;
  containerProps: {
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  reset: () => void;
}

export function useParallaxTilt(options: UseParallaxTiltOptions = {}): UseParallaxTiltResult {
  const { enableParallax = true, maxTiltAngle = 12, enableDeviceOrientation = true } = options;

  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [normalizedX, setNormalizedX] = useState(0);
  const [normalizedY, setNormalizedY] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const isHoveredRef = useRef(false);
  isHoveredRef.current = isHovered;

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return false;
  });

  const reset = useCallback(() => {
    setTiltX(0);
    setTiltY(0);
    setNormalizedX(0);
    setNormalizedY(0);
    setIsHovered(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(e.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange as (e: MediaQueryListEvent) => void);
      return () => {
        mediaQuery.removeEventListener("change", handleChange as (e: MediaQueryListEvent) => void);
      };
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      return () => {
        mediaQuery.removeListener(handleChange);
      };
    }
  }, []);

  useEffect(() => {
    if (!enableParallax || prefersReducedMotion) {
      reset();
    }
  }, [enableParallax, prefersReducedMotion, reset]);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enableParallax || prefersReducedMotion) return;
      const target = e.currentTarget;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const rectLeft = typeof rect.left === "number" && !isNaN(rect.left) ? rect.left : 0;
      const rectTop = typeof rect.top === "number" && !isNaN(rect.top) ? rect.top : 0;
      const rawWidth =
        rect.width > 0 ? rect.width : target.clientWidth || target.offsetWidth || 200;
      const rawHeight =
        rect.height > 0 ? rect.height : target.clientHeight || target.offsetHeight || 200;
      const width =
        typeof rawWidth === "number" && !isNaN(rawWidth) && rawWidth > 0 ? rawWidth : 200;
      const height =
        typeof rawHeight === "number" && !isNaN(rawHeight) && rawHeight > 0 ? rawHeight : 200;

      const rawClientX =
        (e as any).clientX ??
        (e.nativeEvent as any)?.clientX ??
        (e as any).pageX ??
        (e.nativeEvent as any)?.pageX ??
        0;
      const rawClientY =
        (e as any).clientY ??
        (e.nativeEvent as any)?.clientY ??
        (e as any).pageY ??
        (e.nativeEvent as any)?.pageY ??
        0;

      const clientX = typeof rawClientX === "number" && !isNaN(rawClientX) ? rawClientX : 0;
      const clientY = typeof rawClientY === "number" && !isNaN(rawClientY) ? rawClientY : 0;

      const rawNx = (clientX - rectLeft) / width - 0.5;
      const rawNy = (clientY - rectTop) / height - 0.5;

      const nx = isNaN(rawNx) ? 0 : Math.max(-0.5, Math.min(0.5, rawNx));
      const ny = isNaN(rawNy) ? 0 : Math.max(-0.5, Math.min(0.5, rawNy));

      setNormalizedX(nx);
      setNormalizedY(ny);
      setTiltX(-ny * maxTiltAngle);
      setTiltY(nx * maxTiltAngle);
      setIsHovered(true);
    },
    [enableParallax, prefersReducedMotion, maxTiltAngle],
  );

  const handlePointerLeave = useCallback(
    (_e?: ReactPointerEvent<HTMLElement>) => {
      reset();
    },
    [reset],
  );

  useEffect(() => {
    if (
      !enableParallax ||
      prefersReducedMotion ||
      !enableDeviceOrientation ||
      typeof window === "undefined"
    ) {
      return;
    }

    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (isHoveredRef.current) return;

      const beta = event.beta;
      const gamma = event.gamma;
      if (beta === null || gamma === null || beta === undefined || gamma === undefined) return;

      // Beta pitch centered at 45 degrees, gamma roll centered at 0 degrees
      const clampedTiltX = Math.max(-maxTiltAngle, Math.min(maxTiltAngle, -(beta - 45)));
      const clampedTiltY = Math.max(-maxTiltAngle, Math.min(maxTiltAngle, gamma));

      setTiltX(clampedTiltX);
      setTiltY(clampedTiltY);

      if (maxTiltAngle > 0) {
        setNormalizedX((clampedTiltY / maxTiltAngle) * 0.5);
        setNormalizedY((-clampedTiltX / maxTiltAngle) * 0.5);
      }
    };

    window.addEventListener("deviceorientation", handleDeviceOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
    };
  }, [enableParallax, prefersReducedMotion, enableDeviceOrientation, maxTiltAngle]);

  return {
    tiltX,
    tiltY,
    normalizedX,
    normalizedY,
    isHovered,
    containerProps: {
      onPointerMove: handlePointerMove,
      onPointerLeave: handlePointerLeave,
    },
    reset,
  };
}
