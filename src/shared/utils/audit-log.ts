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

export async function withAudit<T>(args: {
  fn: () => Promise<T>;
  action: AuditBundlerAction;
  sessionId: string;
  details?: AuditDetails<T>;
}): Promise<T> {
  const resolveDetails = (ctx: { result?: T; error?: unknown }) =>
    typeof args.details === "function"
      ? args.details(ctx)
      : args.details;

  try {
    const result = await args.fn();

    auditBundlerLog({
      action: args.action,
      sessionId: args.sessionId,
      success: true,
      details: resolveDetails({ result }),
    });

    return result;
  } catch (e) {
    auditBundlerLog({
      action: args.action,
      sessionId: args.sessionId,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      details: resolveDetails({ error: e }),
    });

    throw e;
  }
}
