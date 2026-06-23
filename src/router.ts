/** Compiled pattern: a RegExp for regex-form patterns, or a lowercase string for substring match. */
type CompiledPattern = RegExp | string;

/**
 * Compile the errorPatterns array once at plugin startup.
 * Supports two forms:
 *   - Plain string:           "weekly limit"          → case-insensitive substring match
 *   - Regex string:           "/rate[\\s-]*limit/i"   → compiled to RegExp
 */
export function compilePatterns(patterns: string[]): CompiledPattern[] {
  return patterns.map((p) => {
    const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) {
      return new RegExp(m[1]!, m[2] || "i");
    }
    return p.toLowerCase();
  });
}

/** Return true when text matches at least one compiled pattern. */
export function matchesAnyPattern(text: string, patterns: CompiledPattern[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return patterns.some((p) => {
    if (p instanceof RegExp) return p.test(text);
    return lower.includes(p);
  });
}

/**
 * Extract error-like text from an unknown return value for soft-error detection.
 * Returns null when the value has no recognizable error text.
 */
export function extractErrorText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const key of ["error", "err", "message", "msg", "output", "text", "stderr"]) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field === "string") return field;
    }
  }
  return null;
}
