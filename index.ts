export { default } from "./src/plugin.js";
export {
  isInCooldown,
  getRemainingMs,
  getCooldownUntil,
  setCooldown,
  clearCooldown,
  getFullStatus,
} from "./src/state.js";
export { compilePatterns, matchesAnyPattern, extractErrorText } from "./src/router.js";
export { resolveConfig, DEFAULT_CONFIG, DEFAULT_ERROR_PATTERNS } from "./src/default-config.js";
export type { PluginConfig } from "./src/default-config.js";
