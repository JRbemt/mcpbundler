/**
 * Audit Log - Structured audit logging for security-relevant operations
 *
 * Provides audit logging for both API operations (authenticated via API keys) and
 * bundler runtime operations (session-based). Captures user identity, IP address,
 * user agent, action type, success/failure, and optional details.
 *
 * Two audit contexts:
 * - API: User CRUD, token management, credential operations, auth events
 * - Bundler: MCP tool/resource/prompt operations, upstream connection events
 */

import { Request } from "express";
import logger from "./logger.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { STORE } from "../../api/middleware/auth.js";


// TODO: Log all actions
export enum AuditApiAction {
  // Bundle operations
  BUNDLE_CREATE = "bundle.create",
  BUNDLE_UPDATE = "bundle.update",
  BUNDLE_DELETE = "bundle.delete",
  BUNDLE_VIEW = "bundle.view",

  // Token operations
  TOKEN_CREATE = "token.create",
  TOKEN_REVOKE = "token.revoke",
  TOKEN_DELETE = "token.delete",
  TOKEN_VIEW = "token.view",

  // MCP operations
  MCP_CREATE = "mcp.create",
  MCP_UPDATE = "mcp.update",
  MCP_DELETE = "mcp.delete",
  MCP_VIEW = "mcp.view",

  // Credential operations
  CREDENTIAL_BIND = "credential.bind",
  CREDENTIAL_UPDATE = "credential.update",
  CREDENTIAL_DELETE = "credential.delete",
  CREDENTIAL_DECRYPT = "credential.decrypt",

  // Auth operations
  AUTH_SUCCESS = "auth.success",
  AUTH_FAILURE = "auth.failure",
  API_KEY_USED = "api_key.used",

  // User operations
  USER_CREATE = "user.create",
  USER_UPDATE = "user.update",
  USER_REVOKE = "user.revoke",
  USER_DELETE = "user.delete",
  USER_VIEW = "user.view",
  PERMISSION_ADD = "permission.add",
  PERMISSION_REMOVE = "permission.remove",

  // System operations
  WILDCARD_TOKEN_USED = "wildcard_token.used",
  OTHER = "other"
}

export interface LogEntry {
  success?: boolean;
  errorMessage?: string;
  details?: Record<string, any>;
}

export interface AuditLogEntry extends LogEntry {
  action: AuditApiAction;
  apiKeyId: string;
  apiKeyName: string;
  ip: string;
  userAgent: string;
}

type ContextKeys = "ip" | "userAgent" | "apiKeyId" | "apiKeyName";


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

export interface AuditBundlerEntry extends LogEntry {
  action: AuditBundlerAction;
  sessionId: string;
}

export function auditApiLog(entry: Omit<AuditLogEntry, ContextKeys>, req: Request): void;
export function auditApiLog(entry: AuditLogEntry): void;

/**
 * Logs an audit event
 * Structured logging for security-relevant operations
 */
export function auditApiLog(
  entry: AuditLogEntry | Omit<AuditLogEntry, ContextKeys>,
  req?: Request
): void {

  const fullEntry: AuditLogEntry =
    req
      ? { ...entry, ...getApiAuditContext(req) }
      : (entry as AuditLogEntry);

  const logEntry = {
    audit: true,
    system: "api",
    timestamp: new Date().toISOString(),
    ...fullEntry,
    success: fullEntry?.success ?? true,
  };

  if (entry.success === false || entry.errorMessage) {
    logger.warn(logEntry, `Audit: ${entry.action} - FAILED`);
  } else {
    logger.info(logEntry, `Audit: ${entry.action}`);
  }
}

export function auditApiLogSession(entry: Omit<AuditLogEntry, ContextKeys>) {
  const ctx = STORE.getStore();
  if (ctx) {
    auditApiLog(entry, ctx);
  } else {
    logger.error(entry, "No request identified")
    throw new Error("No request identified");
  }

}

/**
 * Helper to extract audit context from Express request
 */
export function getApiAuditContext(req: Request): Pick<AuditLogEntry, ContextKeys> {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? "unknown",
    userAgent: req.headers["user-agent"] ?? "unkown",
    apiKeyId: req.apiAuth?.userId ?? "unauthorized",
    apiKeyName: req.apiAuth?.apiKeyName ?? "unauthorized"
  };
}



/***
 * Bundler works with authenticated sessions and not authenticated users
 */
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