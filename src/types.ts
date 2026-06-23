/**
 * Minimal type stubs for the OpenClaw Plugin SDK.
 * These mirror the shapes observed in @martian-engineering/lossless-claw.
 * Replace with official @openclaw/plugin-sdk types when they become available.
 */

export type RuntimeLlmCompleteParams = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  purpose?: string;
};

export type RuntimeLlmCompleteResult = {
  text: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ToolContext = {
  sessionId: string;
  sessionKey: string;
};

export type BeforePromptBuildResult = {
  prependSystemContext?: string;
} | undefined | null | void;

export type PluginLifecycleEvent = Record<string, unknown>;

export type OpenClawPluginApi = {
  /** Plugin ID as resolved by the host. */
  id: string;

  /** Full OpenClaw config object (read-only snapshot). */
  config?: unknown;

  /** This plugin's config block, injected directly by the host when available. */
  pluginConfig?: Record<string, unknown>;

  /** Host-provided logger. */
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };

  /** Runtime API surface. */
  runtime: {
    /** Host-managed LLM completion (for plugin-initiated calls). */
    llm?: {
      complete: (params: RuntimeLlmCompleteParams) => Promise<RuntimeLlmCompleteResult>;
    };
    /** Structured child-logger factory. */
    logging?: {
      getChildLogger?: (context: Record<string, unknown>) => unknown;
    };
    /** Registration mode — "cli-metadata", "discovery", or undefined for live. */
    registrationMode?: string;
    [key: string]: unknown;
  };

  /** Resolve a path relative to the agent workspace. */
  resolvePath: (path: string) => string;

  /** Register a lifecycle event handler. */
  on(event: "before_prompt_build", handler: () => BeforePromptBuildResult): void;
  on(event: "gateway_start", handler: () => void | Promise<void>): void;
  on(event: "gateway_stop", handler: () => void | Promise<void>): void;
  on(event: "session_end", handler: (event: PluginLifecycleEvent) => void | Promise<void>): void;
  on(event: "before_reset", handler: (event: PluginLifecycleEvent, ctx: ToolContext) => void | Promise<void>): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;

  /** Register a context engine (used by lossless-claw — we intentionally do not call this). */
  registerContextEngine?: (id: string, factory: () => unknown) => void;

  /** Register an agent-facing tool. */
  registerTool?: (factory: (ctx: ToolContext) => unknown, opts?: { name: string }) => void;

  /** Register a slash command. */
  registerCommand?: (command: unknown) => void;

  /** Registration mode exposed at the top level (older hosts). */
  registrationMode?: string;
};

/** Plugin object shape expected by the OpenClaw extension loader. */
export type OpenClawPlugin = {
  id: string;
  name: string;
  description?: string;
  configSchema?: {
    parse: (value: unknown) => unknown;
  };
  register: (api: OpenClawPluginApi) => void;
};
