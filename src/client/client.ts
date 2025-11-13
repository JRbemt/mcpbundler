#!/usr/bin/env node

import { EventSource } from "eventsource"
globalThis.EventSource = EventSource;

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { BearerTokenAuthProvider } from "./bearer-auth.js";
import logger from "../utils/logger.js";

// Local testing configuration
// Make sure bundler server is running with MOCK_AUTH=true
const AUTH_TOKEN = "dev-token";          // Valid mock token (resolves to localhost:3001 upstream)
const BUNDLER_URL = "http://localhost:3009/sse"; // Bundler server endpoint

const client = new Client({
  name: "example-client",
  version: "1.0.0"
}, {
  capabilities: {

  }
});

// Create transport with collection token auth provider
// Token resolves to collection automatically (no collectionId parameter needed)
const transport = new SSEClientTransport(new URL(BUNDLER_URL), {
  authProvider: new BearerTokenAuthProvider(AUTH_TOKEN)
});

logger.info({ bundlerUrl: BUNDLER_URL, token: AUTH_TOKEN.substring(0, 8) + '...' }, "Connecting to bundler");

await client.connect(transport);
const tools = await client.listTools();
logger.info({ toolCount: tools.tools.length }, "Connected to bundler successfully");
logger.info({ tools: tools.tools }, "Available tools");
//https://modelcontextprotocol.io/specification/2025-06-18/server/tools