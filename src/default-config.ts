import { homedir } from "node:os";
import { join } from "node:path";

export const OPENCLAW_DIR = join(homedir(), ".openclaw");
export const DEFAULT_STATE_FILE = join(OPENCLAW_DIR, "fallback-router.state.json");

export const DEFAULT_ERROR_PATTERNS: string[] = [
  // Usage / quota limits
  "weekly limit",
  "daily limit",
  "usage limit",
  "limit reached",
  "limit has been reached",
  "monthly limit",
  // Quota
  "quota exceeded",
  "quota has been exceeded",
  "insufficient_quota",
  // Rate limiting
  "rate limit",
  "rate_limit_exceeded",
  "too many requests",
  "429",
  // Auth / session failures
  "auth expired",
  "login expired",
  "unauthorized",
  "token expired",
  "model login expired",
  "session expired",
  "authentication failed",
  "access denied",
  // Provider-specific
  "codex limit has been reached",
  "codex weekly limit",
  "codex daily limit",
];

export type PluginConfig = {
  /** Whether the plugin is active. */
  enabled: boolean;
  /** Primary provider to try first (e.g. "codex"). */
  primaryProvider: string;
  /** Fallback provider(s) to use when primary fails (e.g. ["claude-code"]). */
  fallbackChain: string[];
  /** Minutes to skip a failed provider. */
  cooldownMinutes: number;
  /**
   * Error text patterns that trigger a fallback.
   * Plain strings = case-insensitive substring match.
   * "/regex/flags" strings = compiled to RegExp.
   */
  errorPatterns: string[];
  /** Path to cooldown state file. null = use default. */
  stateFile: string | null;
  /** Inject a system-prompt notice when primary is in cooldown. */
  injectStatusHint: boolean;
};

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  primaryProvider: "codex",
  fallbackChain: ["claude-code"],
  cooldownMinutes: 60,
  errorPatterns: DEFAULT_ERROR_PATTERNS,
  stateFile: null,
  injectStatusHint: true,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveConfig(raw: unknown): PluginConfig {
  if (!isPlainObject(raw)) return { ...DEFAULT_CONFIG };

  return {
    enabled: typeof raw["enabled"] === "boolean" ? raw["enabled"] : DEFAULT_CONFIG.enabled,
    primaryProvider:
      typeof raw["primaryProvider"] === "string" && raw["primaryProvider"].trim()
        ? raw["primaryProvider"].trim()
        : DEFAULT_CONFIG.primaryProvider,
    fallbackChain: Array.isArray(raw["fallbackChain"])
      ? (raw["fallbackChain"] as unknown[]).filter((v): v is string => typeof v === "string")
      : DEFAULT_CONFIG.fallbackChain,
    cooldownMinutes:
      typeof raw["cooldownMinutes"] === "number" && raw["cooldownMinutes"] > 0
        ? Math.floor(raw["cooldownMinutes"])
        : DEFAULT_CONFIG.cooldownMinutes,
    errorPatterns: Array.isArray(raw["errorPatterns"])
      ? (raw["errorPatterns"] as unknown[]).filter((v): v is string => typeof v === "string")
      : DEFAULT_CONFIG.errorPatterns,
    stateFile:
      typeof raw["stateFile"] === "string" && raw["stateFile"].trim()
        ? raw["stateFile"].trim()
        : null,
    injectStatusHint:
      typeof raw["injectStatusHint"] === "boolean"
        ? raw["injectStatusHint"]
        : DEFAULT_CONFIG.injectStatusHint,
  };
}
