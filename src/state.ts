import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_STATE_FILE } from "./default-config.js";

type CooldownEntry = {
  cooldownUntil: number;
  setAt: string;
  reason: string;
};

type StateFile = {
  version: 1;
  providers: Record<string, CooldownEntry>;
};

function emptyState(): StateFile {
  return { version: 1, providers: {} };
}

export function resolveStateFile(stateFile: string | null | undefined): string {
  const f = stateFile ?? DEFAULT_STATE_FILE;
  return f.replace(/^~/, homedir());
}

function cleanExpiredEntries(state: StateFile): StateFile {
  const now = Date.now();
  const providers: Record<string, CooldownEntry> = {};
  for (const [name, entry] of Object.entries(state.providers)) {
    if (entry.cooldownUntil && now < entry.cooldownUntil) {
      providers[name] = entry;
    }
  }
  return { ...state, providers };
}

export function readState(stateFile: string | null | undefined): StateFile {
  const path = resolveStateFile(stateFile);
  try {
    if (!existsSync(path)) return emptyState();
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("providers" in parsed) ||
      typeof (parsed as Record<string, unknown>)["providers"] !== "object"
    ) {
      return emptyState();
    }
    return cleanExpiredEntries(parsed as StateFile);
  } catch {
    return emptyState();
  }
}

function writeState(state: StateFile, stateFile: string | null | undefined): void {
  const path = resolveStateFile(stateFile);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(state, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, json, "utf8");
  try {
    renameSync(tmp, path);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      // Cross-device rename: fall back to direct write
      writeFileSync(path, json, "utf8");
    }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    if (err.code !== "EXDEV") throw e;
  }
}

function isLockStale(lockPath: string, staleAfterMs = 30_000): boolean {
  try {
    const stat = statSync(lockPath);
    return Date.now() - stat.mtimeMs > staleAfterMs;
  } catch {
    return true;
  }
}

function acquireLock(stateFilePath: string, maxRetries = 5, retryDelayMs = 50): string {
  const lockFile = `${stateFilePath}.lock`;
  for (let i = 0; i <= maxRetries; i++) {
    if (isLockStale(lockFile)) {
      try { unlinkSync(lockFile); } catch { /* already gone */ }
    }
    try {
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return lockFile;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST" || i === maxRetries) throw e;
      // Busy-wait (writes are infrequent; ms-scale lock hold)
      const until = Date.now() + retryDelayMs;
      while (Date.now() < until) { /* spin */ }
    }
  }
  throw new Error(`[fallback-router] Could not acquire lock on ${stateFilePath}.lock`);
}

function releaseLock(lockFile: string): void {
  try { unlinkSync(lockFile); } catch { /* ignore */ }
}

function withLock<T>(stateFilePath: string, fn: () => T): T {
  const dir = dirname(stateFilePath);
  mkdirSync(dir, { recursive: true });
  const lock = acquireLock(stateFilePath);
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isInCooldown(provider: string, stateFile: string | null | undefined): boolean {
  const state = readState(stateFile);
  const entry = state.providers[provider];
  if (!entry) return false;
  return Date.now() < entry.cooldownUntil;
}

export function getRemainingMs(provider: string, stateFile: string | null | undefined): number {
  const state = readState(stateFile);
  const entry = state.providers[provider];
  if (!entry) return 0;
  const remaining = entry.cooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getCooldownUntil(
  provider: string,
  stateFile: string | null | undefined,
): string | null {
  const state = readState(stateFile);
  const entry = state.providers[provider];
  if (!entry || Date.now() >= entry.cooldownUntil) return null;
  return new Date(entry.cooldownUntil).toISOString();
}

export function setCooldown(
  provider: string,
  minutes: number,
  reason: string,
  stateFile: string | null | undefined,
): void {
  const path = resolveStateFile(stateFile);
  withLock(path, () => {
    const state = readState(stateFile);
    state.providers[provider] = {
      cooldownUntil: Date.now() + minutes * 60_000,
      setAt: new Date().toISOString(),
      reason: reason || "provider failure detected",
    };
    writeState(state, stateFile);
  });
}

export function clearCooldown(
  provider: string | undefined,
  stateFile: string | null | undefined,
): void {
  const path = resolveStateFile(stateFile);
  withLock(path, () => {
    const state = readState(stateFile);
    if (provider === undefined) {
      state.providers = {};
    } else {
      delete state.providers[provider];
    }
    writeState(state, stateFile);
  });
}

export type ProviderStatusEntry = {
  inCooldown: true;
  cooldownUntil: string;
  remainingMinutes: number;
  setAt: string;
  reason: string;
};

export function getFullStatus(stateFile: string | null | undefined): {
  providers: Record<string, ProviderStatusEntry>;
} {
  const state = readState(stateFile);
  const now = Date.now();
  const result: Record<string, ProviderStatusEntry> = {};
  for (const [name, entry] of Object.entries(state.providers)) {
    if (!entry.cooldownUntil || now >= entry.cooldownUntil) continue;
    const remainingMs = entry.cooldownUntil - now;
    result[name] = {
      inCooldown: true,
      cooldownUntil: new Date(entry.cooldownUntil).toISOString(),
      remainingMinutes: Math.ceil(remainingMs / 60_000),
      setAt: entry.setAt,
      reason: entry.reason,
    };
  }
  return { providers: result };
}
