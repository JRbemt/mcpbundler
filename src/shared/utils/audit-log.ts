/**
 * Audit Log - Structured audit logging for bundler runtime operations
 *
 * Captures session-based MCP operations: tool calls, resource reads, prompt access,
 * and upstream connection events. Each entry records the action, session ID,
 * success/failure, and optional structured details.
 */

import logger from "./logger.js";


export enum AuditBundlerAction {
  // MCP runtime events (session operations)
  MCP_TOOLS_LIST = "mcp.tools.list",
  MCP_TOOL_CALL = "mcp.tool.call",
  MCP_RESOURCES_LIST = "mcp.resources.list",
  MCP_RESOURCE_READ = "mcp.resource.read",
  MCP_RESOURCE_TEMPLATES_LIST = "mcp.resource_templates.list",
  MCP_PROMPTS_LIST = "mcp.prompts.list",
  MCP_PROMPT_GET = "mcp.prompt.get",

  // Upstream connection events
  UPSTREAM_CONNECT = "upstream.connect",
  UPSTREAM_DISCONNECT = "upstream.disconnect",
}

export interface LogEntry {
  success?: boolean;
  errorMessage?: string;
  details?: Record<string, any>;
}

export interface AuditBundlerEntry extends LogEntry {
  action: AuditBundlerAction;
  sessionId: string;
}

export function auditBundlerLog(entry: AuditBundlerEntry): void {
  const logEntry = {
    audit: true,
    system: "bundler",
    timestamp: new Date().toISOString(),
    ...entry,
    success: entry?.success ?? true,
  };

  if (entry.success === false || entry.errorMessage) {
    logger.warn(logEntry, `Bundler Audit: ${entry.action} - FAILED`);
  } else {
    logger.info(logEntry, `Bundler Audit: ${entry.action}`);
  }
}

export type AuditDetails<T> =
  | Record<string, unknown>
  | ((ctx: { result?: T; error?: unknown }) => Record<string, unknown>);

const BACKEND_URL = (process.env.BACKEND_URL ?? "").replace(/\/$/, "");

function pushTelemetry(args: {
  accessToken: string;
  action: AuditBundlerAction;
  success: boolean;
  latencyMs: number;
  toolName?: string;
  mcpNamespace?: string;
  bytesTransferred?: number;
  errorMessage?: string;
}): void {
  if (!BACKEND_URL) return;
  if (!args.accessToken) return;
  fetch(`${BACKEND_URL}/v1/bundler/telemetry`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: args.action,
      success: args.success,
      mcp_namespace: args.mcpNamespace ?? null,
      tool_name: args.toolName ?? null,
      latency_ms: Math.round(args.latencyMs),
      bytes_transferred: args.bytesTransferred ?? null,
      error_message: args.errorMessage ?? null,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => logger.warn({ err }, "Failed to push telemetry"));
  // Deliberately not awaited - telemetry push must never add latency to,
  // or be able to fail, the actual MCP response path.
}

export async function withAudit<T>(args: {
  fn: () => Promise<T>;
  action: AuditBundlerAction;
  sessionId: string;
  accessToken: string;
  toolName?: string;
  mcpNamespace?: string;
  bytesOf?: (result: T) => number;
  details?: AuditDetails<T>;
}): Promise<T> {
  const resolveDetails = (ctx: { result?: T; error?: unknown }) =>
    typeof args.details === "function"
      ? args.details(ctx)
      : args.details;

  const startedAt = Date.now();

  try {
    const result = await args.fn();
    const latencyMs = Date.now() - startedAt;

    auditBundlerLog({
      action: args.action,
      sessionId: args.sessionId,
      success: true,
      details: resolveDetails({ result }),
    });
    pushTelemetry({
      accessToken: args.accessToken,
      action: args.action,
      success: true,
      latencyMs,
      toolName: args.toolName,
      mcpNamespace: args.mcpNamespace,
      bytesTransferred: args.bytesOf ? args.bytesOf(result) : undefined,
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const errorMessage = e instanceof Error ? e.message : String(e);

    auditBundlerLog({
      action: args.action,
      sessionId: args.sessionId,
      success: false,
      errorMessage,
      details: resolveDetails({ error: e }),
    });
    pushTelemetry({
      accessToken: args.accessToken,
      action: args.action,
      success: false,
      latencyMs,
      toolName: args.toolName,
      mcpNamespace: args.mcpNamespace,
      errorMessage,
    });

    throw e;
  }
}
