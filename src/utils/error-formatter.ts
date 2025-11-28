import { z } from "zod";
import { Response } from "express";

/**
 * Formats Zod validation errors into a concise, human-readable string.
 * Extracts field paths and error messages from Zod errors and joins them.
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors.map(err => {
    const field = err.path.join(".") || "data";
    return `${field}: ${err.message}`;
  }).join(", ");
}

/**
 * Sends a formatted 400 Bad Request response for Zod validation errors.
 * Includes both a user-friendly error message and detailed error information.
 */
export function sendZodError(res: Response, error: z.ZodError, context: string): void {
  const message = formatZodError(error);
  res.status(400).json({
    error: `${context}: ${message}`,
    details: error.errors
  });
}
