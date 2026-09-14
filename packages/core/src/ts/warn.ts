/**
 * One-shot diagnostics for failures that live inside a render loop.
 *
 * Every failure path in this package is a never-throw path: a broken capture, a rejected texture
 * upload or a driver-level render error must all degrade to the CSS fallback rather than take the
 * host application down. The cost of that contract is silence — a total failure of the GPU pipeline
 * presents as glass that merely looks wrong. These helpers buy the diagnosis back without spamming
 * the console 60 times a second: the first occurrence of each key warns, every later one is dropped.
 */

const warnedKeys = new Set<string>();

/**
 * Emit `console.warn` for `key` the first time it is seen, and never again.
 *
 * The `[open-glass]` prefix is applied here rather than by callers so every warning this package
 * emits is greppable and attributable.
 */
export function warnOnce(key: string, message: string, ...details: unknown[]): void {
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[open-glass] ${message}`, ...details);
  }
}

/**
 * Whether `key` has already been warned about.
 */
export function hasWarned(key: string): boolean {
  return warnedKeys.has(key);
}

/**
 * Forget every recorded key, so the next `warnOnce` for each warns again.
 *
 * Intended for tests: process-lifetime state makes "warns exactly once" untestable across cases.
 */
export function resetWarnOnce(): void {
  warnedKeys.clear();
}
