/**
 * UpstreamEventCoordinator - Upstream notification management and debouncing
 *
 * Subscribes to list change notifications from all upstream MCPs in a session and
 * forwards them to the client. Implements debouncing to coalesce rapid changes into
 * single notifications (default 500ms).
 *
 * Listens for three event types:
 * - tools_list_changed: Tool definitions updated
 * - resources_list_changed: Resource list updated
 * - prompts_list_changed: Prompt list updated
 *
 * Maintains event listener references for proper cleanup on session close.
 */

import EventEmitter from "events";
import { Upstream, UPSTREAM_EVENTS } from "../upstream.js";
import logger from "../../utils/logger.js";

/**
 * Coordinates upstream event handling and notification debouncing.
 * Manages event listeners for upstream list changes and forwards notifications to clients.
 */
export class UpstreamEventCoordinator extends EventEmitter {
    private readonly sessionId: string;
    private readonly debounceMs: number;
    private notificationDebounce: Map<string, NodeJS.Timeout>;
    private upstreamListeners: Map<Upstream, {
        toolsChanged: () => void;
        resourcesChanged: () => void;
        promptsChanged: () => void;
    }>;

    constructor(sessionId: string, debounceMs: number = 500) {
        super();
        this.sessionId = sessionId;
        this.debounceMs = debounceMs;
        this.notificationDebounce = new Map();
        this.upstreamListeners = new Map();
    }

    /**
     * Attach event listeners to an upstream for list change notifications.
     */
    public attachUpstream(upstream: Upstream): void {
        // Create bound functions to store references for cleanup
        const toolsChangedHandler = () => {
            this.handleUpstreamToolsChanged(upstream);
        };
        const resourcesChangedHandler = () => {
            this.handleUpstreamResourcesChanged(upstream);
        };
        const promptsChangedHandler = () => {
            this.handleUpstreamPromptsChanged(upstream);
        };

        // Store references for cleanup
        this.upstreamListeners.set(upstream, {
            toolsChanged: toolsChangedHandler,
            resourcesChanged: resourcesChangedHandler,
            promptsChanged: promptsChangedHandler
        });

        // Subscribe to upstream list change events
        upstream.on(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED, toolsChangedHandler);
        upstream.on(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED, resourcesChangedHandler);
        upstream.on(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED, promptsChangedHandler);
    }

    /**
     * Handle upstream tools list changed event.
     */
    private handleUpstreamToolsChanged(upstream: Upstream): void {
        logger.info({
            sessionId: this.sessionId,
            namespace: upstream.getNamespace()
        }, "Upstream tools changed");

        this.scheduleNotification("tools");
    }

    /**
     * Handle upstream resources list changed event.
     */
    private handleUpstreamResourcesChanged(upstream: Upstream): void {
        logger.info({
            sessionId: this.sessionId,
            namespace: upstream.getNamespace()
        }, "Upstream resources changed");

        this.scheduleNotification("resources");
    }

    /**
     * Handle upstream prompts list changed event.
     */
    private handleUpstreamPromptsChanged(upstream: Upstream): void {
        logger.info({
            sessionId: this.sessionId,
            namespace: upstream.getNamespace()
        }, "Upstream prompts changed");

        this.scheduleNotification("prompts");
    }

    /**
     * Schedule a debounced notification to the client.
     * Multiple rapid changes are coalesced into a single notification.
     */
    private scheduleNotification(type: "tools" | "resources" | "prompts"): void {
        const key = `${type}_list_changed`;

        // Clear existing timer for this notification type
        if (this.notificationDebounce.has(key)) {
            clearTimeout(this.notificationDebounce.get(key)!);
        }

        // Schedule new notification after debounce period
        this.notificationDebounce.set(key, setTimeout(() => {
            this.sendNotificationToClient(type);
            this.notificationDebounce.delete(key);
        }, this.debounceMs));
    }

    /**
     * Send notification to client via event emission.
     * Session will wire this up to MCP notification system.
     */
    private sendNotificationToClient(type: "tools" | "resources" | "prompts"): void {
        logger.info({
            sessionId: this.sessionId,
            type
        }, "Sending list_changed notification to client");

        // Emit event that session will forward to MCP client
        this.emit(`notify_${type}_changed`, {
            jsonrpc: "2.0" as const,
            method: `notifications/${type}/list_changed`,
            params: {}
        });
    }

    /**
     * Detach all event listeners and clean up resources.
     */
    public detachAll(): void {
        // Remove event listeners from upstreams
        for (const [upstream, listeners] of this.upstreamListeners.entries()) {
            upstream.removeListener(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED, listeners.toolsChanged);
            upstream.removeListener(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED, listeners.resourcesChanged);
            upstream.removeListener(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED, listeners.promptsChanged);
        }
        this.upstreamListeners.clear();

        // Clear notification debounce timers
        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer);
        }
        this.notificationDebounce.clear();
    }
}
