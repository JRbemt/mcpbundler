/**
 * Route Utilities - Middleware for API routes
 *
 * Provides reusable middleware for request/response validation, error handling,
 * and audit logging. Handlers return data; the wrapper validates and sends.
 */

import { Request, Response, RequestHandler, NextFunction } from "express";
import { z, ZodError } from "zod";
import { sendZodError } from "./error-formatter.js";
import { AuditApiAction, auditApiLog } from "../../../shared/utils/audit-log.js";
import logger from "../../../shared/utils/logger.js";

/**
 * Result type for handlers that may return early (e.g., 404, 403)
 * Use `sent()` to indicate response was already sent
 */
export type HandlerResult<T> = T | { __sent: true };

export function sent(): { __sent: true } {
  return { __sent: true };
}

function isSent<T>(result: HandlerResult<T>): result is { __sent: true } {
  return typeof result === "object" && result !== null && "__sent" in result;
}

/**
 * Options for validated handler
 */
export interface HandlerOptions<TRes = unknown> {
  /** Audit action to log */
  action: AuditApiAction;
  /** Custom error message for 500 errors */
  errorMessage?: string;
  /** Success status code (default: 200, use 204 for no-content) */
  successStatus?: number;
  /** Extract audit details from request and result */
  getAuditDetails?: (req: Request, result?: TRes) => Record<string, unknown>;
}

/**
 * Middleware to validate request body against a Zod schema
 */
export function validateBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendZodError(res, result.error, "Validation failed");
      return;
    }
    req.validated = result.data;
    next();
  };
}

/**
 * Core response handler logic - shared by validatedHandler and asyncHandler
 */
async function handleResponse<TRes>(
  result: HandlerResult<TRes>,
  responseSchema: z.ZodType<TRes> | null,
  req: Request,
  res: Response,
  options: HandlerOptions<TRes>
): Promise<void> {
  if (isSent(result)) {
    return;
  }

  const status = options.successStatus ?? 200;

  // 204 No Content - no response body
  if (status === 204) {
    auditApiLog({
      action: options.action,
      success: true,
      details: options.getAuditDetails?.(req),
    }, req);
    res.status(204).send();
    return;
  }

  // Validate response if schema provided
  const validated = responseSchema ? responseSchema.parse(result) : result;

  auditApiLog({
    action: options.action,
    success: true,
    details: options.getAuditDetails?.(req, validated as TRes),
  }, req);

  res.status(status).json(validated);
}

/**
 * Create a handler with request body validation, response validation, and audit logging
 *
 * Handler returns data (or uses sent() for early responses like 404).
 * Wrapper validates response against schema and sends it.
 * Use successStatus: 204 for DELETE endpoints (no response body).
 *
 * @param requestSchema - Zod schema for request body validation
 * @param responseSchema - Zod schema for response validation (null for 204)
 * @param handler - Handler returning response data (or sent() for early exit)
 * @param options - Audit action and other options
 */
export function validatedHandler<TReq, TRes>(
  requestSchema: z.ZodType<TReq>,
  responseSchema: z.ZodType<TRes> | null,
  handler: (req: Request<any, any, any>, res: Response<any>, data: TReq) => Promise<HandlerResult<TRes>>,
  options: HandlerOptions<TRes>
): RequestHandler[] {
  return [
    validateBody(requestSchema),
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const result = await handler(req, res, req.validated as TReq);
        await handleResponse(result, responseSchema, req, res, options);
      } catch (error: unknown) {
        handleError(error, req, res, options);
      }
    },
  ];
}

/**
 * Handler for routes without request body validation
 *
 * Handler returns data (or uses sent() for early responses).
 * Use successStatus: 204 for DELETE endpoints (no response body).
 */
export function asyncHandler<TRes>(
  responseSchema: z.ZodType<TRes> | null,
  handler: (req: Request<any, any, any>, res: Response<any>) => Promise<HandlerResult<TRes>>,
  options: HandlerOptions<TRes>
): RequestHandler {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const result = await handler(req, res);
      await handleResponse(result, responseSchema, req, res, options);
    } catch (error: unknown) {
      handleError(error, req, res, options);
    }
  };
}

/**
 * Centralized error handling for route handlers
 */
function handleError<TRes>(
  error: unknown,
  req: Request,
  res: Response,
  options: HandlerOptions<TRes>
): void {
  const err = error as Error & { status?: number };

  // Handle Zod validation errors (request or response)
  if (error instanceof ZodError) {
    auditApiLog({
      action: options.action,
      success: false,
      errorMessage: "Validation error",
      details: options.getAuditDetails?.(req),
    }, req);

    logger.error(
      {
        endpoint: `${req.method} ${req.originalUrl}`,
        error: error.issues,
      },
      "Validation failed"
    );
    sendZodError(res, error, "Validation error");
    return;
  }

  // Handle errors with status codes (thrown by services)
  const status = err.status ?? 500;

  auditApiLog({
    action: options.action,
    success: false,
    errorMessage: err.message,
    details: options.getAuditDetails?.(req),
  }, req);

  logger.error(
    { error: err.message, stack: err.stack, status },
    options.errorMessage ?? "Request failed"
  );

  res.status(status).json({
    error: status >= 500 ? (options.errorMessage ?? "Internal server error") : err.message,
  });
}

/**
 * Send 404 response and log audit failure
 */
export function sendNotFound(
  res: Response,
  entity: string,
  req: Request,
  action: AuditApiAction,
  details?: Record<string, unknown>
): { __sent: true } {
  auditApiLog({
    action,
    success: false,
    errorMessage: `${entity} not found`,
    details,
  }, req);
  res.status(404).json({ error: `${entity} not found` });
  return sent();
}

/**
 * Send 403 response and log audit failure
 */
export function sendForbidden(
  res: Response,
  req: Request,
  action: AuditApiAction,
  message?: string,
  details?: Record<string, unknown>
): { __sent: true } {
  auditApiLog({
    action,
    success: false,
    errorMessage: message ?? "Forbidden",
    details,
  }, req);
  res.status(403).json({
    error: "Forbidden",
    message: message ?? "You do not have permission to perform this action",
  });
  return sent();
}

/**
 * Send 401 response and log audit failure
 */
export function sendUnauthorized(
  res: Response,
  req: Request,
  action: AuditApiAction,
  details?: Record<string, unknown>
): { __sent: true } {
  auditApiLog({
    action,
    success: false,
    errorMessage: "Unauthorized",
    details,
  }, req);
  res.status(401).json({ error: "Invalid or expired token" });
  return sent();
}

/**
 * Send 409 conflict response and log audit failure
 */
export function sendConflict(
  res: Response,
  message: string,
  req: Request,
  action: AuditApiAction,
  details?: Record<string, unknown>
): { __sent: true } {
  auditApiLog({
    action,
    success: false,
    errorMessage: message,
    details,
  }, req);
  res.status(409).json({ error: message });
  return sent();
}
