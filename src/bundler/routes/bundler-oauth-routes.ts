/**
 * RFC 9728 Protected Resource Metadata endpoint - the discovery document a
 * spec-compliant MCP client fetches after receiving a 401 with a
 * WWW-Authenticate: Bearer resource_metadata="..." challenge (see
 * bundler-mcp-routes.ts's bundle-scoped /mcp/:bundleId handling). Scoped
 * per bundle because the bare /mcp endpoint is shared across every bundle
 * and has no other way to say which one an agent is authorizing for.
 *
 * This document is non-sensitive and meant to be fetched directly by
 * browser-based OAuth client code, so it is served with an open CORS
 * policy - the same treatment RFC 8414 Authorization Server Metadata and
 * RFC 9728 Protected Resource Metadata documents commonly get elsewhere.
 */

import { Router, Request, Response } from "express";
import { buildProtectedResourceMetadata } from "../core/oauth/protected-resource-metadata.js";

export function createOAuthRoutes(): Router {
  const router = Router();

  router.get(
    "/.well-known/oauth-protected-resource/mcp/:bundleId",
    (req: Request, res: Response) => {
      const bundleId = req.params.bundleId as string;
      res.set("Access-Control-Allow-Origin", "*");
      res.json(buildProtectedResourceMetadata(bundleId));
    }
  );

  return router;
}
