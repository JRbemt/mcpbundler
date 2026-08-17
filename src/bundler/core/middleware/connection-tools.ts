import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BundlerSystemToolsMiddleware } from "./builtin-tools.js";
import { DiscoveryClient } from "../discovery/discovery-client.js";
import { DeviceCodeResponse, DeviceTokenPollResult } from "../discovery/device-flow-client.js";
import { DeploymentBootstrapClient } from "../discovery/deployment-bootstrap-client.js";
import { SessionStateStore } from "../session/session-state-store.js";
import { RateLimitRule } from "./anonymous-rate-limit.js";
import logger from "../../../shared/utils/logger.js";

export interface ConnectionToolsDeps {
  discoveryClient: DiscoveryClient;
  requestDeviceCode: () => Promise<DeviceCodeResponse | null>;
  pollDeviceToken: (deviceCode: string) => Promise<DeviceTokenPollResult>;
  bootstrapClient: DeploymentBootstrapClient;
  stateStore: SessionStateStore;
  onConnected: (sessionId: string, bundleId: string, bundleAccessToken: string) => Promise<void>;
}

// start_connection mints a real Keycloak device code on every call (RFC
// 8628 device authorization request) - repeated calls exhaust Keycloak's
// own device-code issuance resources, not just the bundler's, so it gets
// the tightest limit in this file. 5 calls per 10 minutes matches
// requestDeviceCode's own fallback device-code lifetime
// (device-flow-client.ts: `expiresInSeconds: data.expires_in ?? 600`) -
// one device code's full lifetime is the natural retry window (mistyped
// code, closed browser, wrong bundle chosen), and legitimate retries
// rarely need more than a handful of attempts inside that window.
//
// check_connection_status is already self-throttled against Keycloak by
// PendingConnectionState.nextPollAllowedAt/intervalSeconds (this file's
// own handler, below) before any Keycloak call is made, so this limit
// exists only to bound a session that busy-loops the tool call itself
// while ignoring the "still waiting" guidance. At the RFC's minimum 5s
// polling interval, legitimate polling over a 5-minute window tops out
// at 60 calls, so 60 accommodates the full legitimate cadence.
export const CONNECTION_RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    id: "start-connection",
    toolNames: ["bundler__start_connection"],
    maxCalls: 5,
    windowMs: 10 * 60 * 1000,
  },
  {
    id: "check-connection-status",
    toolNames: ["bundler__check_connection_status"],
    maxCalls: 60,
    windowMs: 5 * 60 * 1000,
  },
];

const CONNECTION_STATE_KEY = "device-flow:pending-connection";
const SLOW_DOWN_INCREMENT_SECONDS = 5; // RFC 8628 section 3.5 recommended backoff step

interface PendingConnectionState {
  bundleId: string;
  deviceCode: string;
  intervalSeconds: number;
  /** Epoch ms - when Keycloak's device_code itself expires (RFC 8628 expires_in). */
  deviceExpiresAt: number;
  /** Epoch ms - server-side poll throttle honoring the RFC's interval/slow_down guidance. */
  nextPollAllowedAt: number;
}

/**
 * Registers the two device-flow proxy tools onto the given middleware
 * instance - the same BundlerSystemToolsMiddleware the anonymous session's
 * discovery tools (bundler__search_bundles/bundler__get_bundle) already use,
 * so an agent's session carries all four anonymous tools together.
 */
export function registerConnectionTools(middleware: BundlerSystemToolsMiddleware, deps: ConnectionToolsDeps): void {
  middleware.registerTool({
    tool: {
      name: "bundler__start_connection",
      description:
        "Begin connecting this session to a specific bundle by id. Starts a device-code authorization flow " +
        "and returns a short code plus a URL for a human to approve in a browser. After relaying that to the " +
        "human, call bundler__check_connection_status repeatedly until the connection completes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bundle_id: { type: "string", description: "The bundle ID from a previous bundler__search_bundles or bundler__get_bundle call." },
        },
        required: ["bundle_id"],
      },
    },
    handler: async (params, ctx): Promise<CallToolResult> => {
      const bundleId = String((params.arguments as Record<string, unknown>)?.bundle_id ?? "");
      if (!bundleId) {
        return { content: [{ type: "text", text: "bundle_id is required." }], isError: true };
      }

      const bundle = await deps.discoveryClient.getBundle(bundleId);
      if (!bundle) {
        return { content: [{ type: "text", text: `No public bundle found with id "${bundleId}".` }], isError: true };
      }

      const deviceCode = await deps.requestDeviceCode();
      if (!deviceCode) {
        return {
          content: [{
            type: "text",
            text: "Unable to start a connection right now - the authentication service is unavailable. Try again shortly.",
          }],
          isError: true,
        };
      }

      const now = Date.now();
      const state: PendingConnectionState = {
        bundleId,
        deviceCode: deviceCode.deviceCode,
        intervalSeconds: deviceCode.intervalSeconds,
        deviceExpiresAt: now + deviceCode.expiresInSeconds * 1000,
        nextPollAllowedAt: now + deviceCode.intervalSeconds * 1000,
      };
      await deps.stateStore.set(ctx.sessionId, CONNECTION_STATE_KEY, state);

      const linkHint = deviceCode.verificationUriComplete
        ? ` Or use this direct link: ${deviceCode.verificationUriComplete}`
        : "";

      return {
        content: [{
          type: "text",
          text:
            `To connect "${bundle.name}", go to ${deviceCode.verificationUri} and enter code ${deviceCode.userCode}.` +
            `${linkHint} This currently points at Keycloak's own device-approval page (a dedicated mcpbundler ` +
            `consent page is planned but not built yet). After approving, call bundler__check_connection_status ` +
            `to finish connecting.`,
        }],
      };
    },
  });

  middleware.registerTool({
    tool: {
      name: "bundler__check_connection_status",
      description:
        "Check whether the human has approved the connection started by bundler__start_connection. Call this " +
        "repeatedly until it reports the connection is complete - once complete, the bundle's real tools become " +
        "available in this same session with no reconnect needed.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    handler: async (_params, ctx): Promise<CallToolResult> => {
      const state = await deps.stateStore.get<PendingConnectionState>(ctx.sessionId, CONNECTION_STATE_KEY);
      if (!state) {
        return {
          content: [{ type: "text", text: "No connection is in progress. Call bundler__start_connection first." }],
          isError: true,
        };
      }

      const now = Date.now();

      if (now > state.deviceExpiresAt) {
        await deps.stateStore.delete(ctx.sessionId, CONNECTION_STATE_KEY);
        return {
          content: [{ type: "text", text: "The connection code expired before it was approved. Call bundler__start_connection to get a new one." }],
          isError: true,
        };
      }

      if (now < state.nextPollAllowedAt) {
        const waitSeconds = Math.ceil((state.nextPollAllowedAt - now) / 1000);
        return {
          content: [{ type: "text", text: `Still waiting for approval. Try again in about ${waitSeconds}s.` }],
        };
      }

      const poll = await deps.pollDeviceToken(state.deviceCode);

      if (poll.status === "pending") {
        state.nextPollAllowedAt = now + state.intervalSeconds * 1000;
        await deps.stateStore.set(ctx.sessionId, CONNECTION_STATE_KEY, state);
        return {
          content: [{ type: "text", text: `Still waiting for approval. Try again in about ${state.intervalSeconds}s.` }],
        };
      }

      if (poll.status === "slow_down") {
        state.intervalSeconds += SLOW_DOWN_INCREMENT_SECONDS;
        state.nextPollAllowedAt = now + state.intervalSeconds * 1000;
        await deps.stateStore.set(ctx.sessionId, CONNECTION_STATE_KEY, state);
        return {
          content: [{ type: "text", text: `Still waiting for approval. Polling slowed to every ${state.intervalSeconds}s.` }],
        };
      }

      if (poll.status === "denied") {
        await deps.stateStore.delete(ctx.sessionId, CONNECTION_STATE_KEY);
        return { content: [{ type: "text", text: "The connection request was denied." }], isError: true };
      }

      if (poll.status === "expired") {
        await deps.stateStore.delete(ctx.sessionId, CONNECTION_STATE_KEY);
        return {
          content: [{ type: "text", text: "The connection code expired before it was approved. Call bundler__start_connection to get a new one." }],
          isError: true,
        };
      }

      // poll.status === "approved" from here on.
      const bootstrapResult = await deps.bootstrapClient.bootstrap(poll.accessToken, state.bundleId);
      if (!bootstrapResult) {
        await deps.stateStore.delete(ctx.sessionId, CONNECTION_STATE_KEY);
        return {
          content: [{ type: "text", text: "Approved, but the bundler could not finish setting up the deployment. Call bundler__start_connection to try again." }],
          isError: true,
        };
      }

      const bundleId = state.bundleId;
      await deps.stateStore.delete(ctx.sessionId, CONNECTION_STATE_KEY);

      // onConnected fires regardless of status - the bootstrap endpoint's
      // underlying bundle resolver already skips entries with no resolvable
      // credential rather than failing the whole bundle (same precedent as
      // the dashboard's own bundle resolution), so whatever DID resolve is
      // usable immediately. Blocking the entire session on one still-missing
      // credential would contradict the step-up model everywhere else in
      // this design, where a partial deployment is never fully blocked.
      //
      // The pending-connection state above is already deleted by this point,
      // so a failure here cannot be retried by re-polling - the human would
      // have to start an entirely new device-code approval. That is a known
      // limitation; this catch only makes the failure visible and clean
      // rather than letting an internal error message reach the agent.
      try {
        await deps.onConnected(ctx.sessionId, bundleId, bootstrapResult.token);
      } catch (err) {
        logger.error({ sessionId: ctx.sessionId, bundleId, err }, "onConnected failed after approved device-flow connection");
        return {
          content: [{
            type: "text",
            text: `Approval succeeded, but the bundler could not attach the tools for "${bundleId}". ` +
              "Call bundler__start_connection to try again.",
          }],
          isError: true,
        };
      }

      if (bootstrapResult.status === "needs_credentials") {
        const missing = bootstrapResult.missingCredentials
          .map((c) => `${c.entryTitle} (${c.mcpNamespace})`)
          .join(", ");
        return {
          content: [{
            type: "text",
            text: `Connected. Tools that don't need ${missing} are available now. ` +
              `Ask the human to connect ${missing} for bundle "${bundleId}" before those specific tools will work.`,
          }],
        };
      }

      return {
        content: [{ type: "text", text: `Connected. The tools for "${bundleId}" are now available.` }],
      };
    },
  });
}
