/**
 * openclaw-provider-fallback-router — OpenClaw plugin
 *
 * Hooks into `before_prompt_build` to detect when the primary provider
 * (e.g. codex) is in cooldown and injects a system-prompt notice directing
 * OpenClaw to use the configured fallback (e.g. claude-code).
 *
 * Cooldown is stored in ~/.openclaw/fallback-router.state.json.
 * Use the `openclaw-fallback-router` CLI to inspect and manage state.
 */
import { resolveConfig, DEFAULT_CONFIG, type PluginConfig } from "./default-config.js";
import { compilePatterns, matchesAnyPattern } from "./router.js";
import {
  isInCooldown,
  getRemainingMs,
  getCooldownUntil,
  setCooldown,
  clearCooldown,
  getFullStatus,
} from "./state.js";
import type { OpenClawPlugin, OpenClawPluginApi } from "./types.js";

const PLUGIN_ID = "provider-fallback-router";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isReadOnlyMode(api: OpenClawPluginApi): boolean {
  const mode =
    (api as unknown as { registrationMode?: string }).registrationMode ??
    (api.runtime as unknown as { registrationMode?: string }).registrationMode;
  return mode === "cli-metadata" || mode === "discovery" || mode === "tool-discovery";
}

/** Read this plugin's config block from the OpenClaw root config. */
function readPluginConfig(api: OpenClawPluginApi): Record<string, unknown> | undefined {
  // Direct injection (preferred — newer hosts inject pluginConfig directly)
  if (isRecord(api.pluginConfig) && Object.keys(api.pluginConfig).length > 0) {
    return api.pluginConfig;
  }
  // Fall back to config.plugins.entries["provider-fallback-router"].config
  const root = isRecord(api.config) ? api.config : undefined;
  const plugins = isRecord(root?.["plugins"]) ? root["plugins"] : undefined;
  const entries = isRecord(plugins?.["entries"]) ? plugins["entries"] : undefined;
  const entry = isRecord(entries?.[PLUGIN_ID]) ? entries[PLUGIN_ID] : undefined;
  return isRecord(entry?.["config"]) ? (entry["config"] as Record<string, unknown>) : undefined;
}

function log(
  api: OpenClawPluginApi,
  level: "info" | "warn" | "error",
  message: string,
): void {
  const logger = api.logger;
  if (logger?.[level]) {
    logger[level]!(`[${PLUGIN_ID}] ${message}`);
  } else {
    // Fall back to console so the message always appears somewhere
    if (level === "error") console.error(`[${PLUGIN_ID}]`, message);
    else console.log(`[${PLUGIN_ID}]`, message);
  }
}

// ── Plugin Object ─────────────────────────────────────────────────────────────

const plugin: OpenClawPlugin = {
  id: PLUGIN_ID,
  name: "Provider Fallback Router",
  description:
    "Automatically routes to a fallback provider (e.g. claude-code) when the primary provider (e.g. codex) hits rate limits, quota errors, or auth failures",

  /** Validate and coerce the plugin config block. */
  configSchema: {
    parse(value: unknown): PluginConfig {
      return resolveConfig(value);
    },
  },

  register(api: OpenClawPluginApi): void {
    // Skip full initialization during CLI metadata / discovery passes
    if (isReadOnlyMode(api)) {
      return;
    }

    const rawConfig = readPluginConfig(api);
    const config = resolveConfig(rawConfig);

    if (!config.enabled) {
      log(api, "info", "Plugin disabled via config.");
      return;
    }

    const compiledPatterns = compilePatterns(config.errorPatterns);
    const stateFile = config.stateFile;

    log(
      api,
      "info",
      `Plugin loaded — primary: ${config.primaryProvider}, ` +
        `fallback: ${config.fallbackChain.join(" → ")}, ` +
        `cooldown: ${config.cooldownMinutes}m`,
    );

    // ── before_prompt_build ────────────────────────────────────────────────
    // Called before every LLM request.  When the primary provider is in
    // cooldown we prepend a system-prompt notice that tells the gateway/agent
    // to prefer the fallback provider for this turn.
    api.on("before_prompt_build", () => {
      if (!config.enabled) return;

      const primary = config.primaryProvider;
      const fallback = config.fallbackChain[0];

      if (!isInCooldown(primary, stateFile)) return;
      if (!config.injectStatusHint) return;

      const remainingMs = getRemainingMs(primary, stateFile);
      const remainingMinutes = Math.ceil(remainingMs / 60_000);
      const until = getCooldownUntil(primary, stateFile) ?? "";

      const hint = [
        `[Provider Fallback Router] The primary provider "${primary}" is in cooldown.`,
        `Reason: A rate-limit, quota, or auth error was previously detected.`,
        `Cooldown expires: ${until} (~${remainingMinutes} minute(s) remaining).`,
        fallback
          ? `Recommended fallback: Use provider "${fallback}" for this request.`
          : "",
        `To clear the cooldown manually: openclaw-fallback-router clear ${primary}`,
      ]
        .filter(Boolean)
        .join("\n");

      return { prependSystemContext: hint };
    });

    // ── gateway_stop ───────────────────────────────────────────────────────
    api.on("gateway_stop", () => {
      log(api, "info", "Gateway stopped.");
    });

    // ── runtime.llm wrapping ───────────────────────────────────────────────
    // When OpenClaw exposes api.runtime.llm.complete we wrap it so that
    // plugin-initiated LLM calls (e.g. from other plugins using the runtime
    // LLM surface) also benefit from fallback routing.
    const runtimeLlm = api.runtime.llm;
    if (runtimeLlm && typeof runtimeLlm.complete === "function") {
      const originalComplete = runtimeLlm.complete.bind(runtimeLlm);
      runtimeLlm.complete = async (params) => {
        // If primary is in cooldown and a model override was NOT already set,
        // we inject the fallback provider as the model ref.
        const primary = config.primaryProvider;
        const fallback = config.fallbackChain[0];
        if (
          isInCooldown(primary, stateFile) &&
          fallback &&
          !params.model?.startsWith(fallback)
        ) {
          log(
            api,
            "info",
            `${primary} in cooldown — routing runtime.llm.complete to ${fallback}`,
          );
          return originalComplete({ ...params, model: `${fallback}/${params.model ?? ""}`.replace(/\/$/, "") });
        }

        try {
          const result = await originalComplete(params);
          // Soft-error detection: check returned text for error patterns
          if (
            result.text &&
            matchesAnyPattern(result.text, compiledPatterns)
          ) {
            log(api, "warn", `Error pattern detected in runtime.llm response from ${primary}.`);
            setCooldown(primary, config.cooldownMinutes, result.text.slice(0, 200), stateFile);
            if (fallback) {
              log(api, "info", `Retrying via fallback: ${fallback}`);
              return originalComplete({ ...params, model: fallback });
            }
          }
          return result;
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : String(err);
          if (matchesAnyPattern(msg, compiledPatterns)) {
            log(api, "warn", `Provider failure detected: ${msg.slice(0, 120)}`);
            setCooldown(primary, config.cooldownMinutes, msg, stateFile);
            if (fallback) {
              log(api, "info", `Switching to fallback provider: ${fallback}`);
              return originalComplete({ ...params, model: fallback });
            }
          }
          throw err;
        }
      };
    }
  },
};

export default plugin;

// ── Re-export utilities for programmatic use ──────────────────────────────────
export {
  isInCooldown,
  getRemainingMs,
  getCooldownUntil,
  setCooldown,
  clearCooldown,
  getFullStatus,
} from "./state.js";
export { compilePatterns, matchesAnyPattern, extractErrorText } from "./router.js";
export { resolveConfig, DEFAULT_CONFIG, DEFAULT_ERROR_PATTERNS } from "./default-config.js";
export type { PluginConfig } from "./default-config.js";
