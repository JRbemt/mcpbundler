import { Upstream } from "../upstream.js";
import logger from "../../utils/logger.js";

/**
 * Manages permission checking for MCP capabilities (tools, resources, prompts).
 * Supports exact string matches, wildcard patterns, and regex patterns.
 */
export class PermissionManager {
    /**
     * Check if a name matches any pattern in the allowed list.
     * Supports exact matches, wildcard (*), and regex patterns.
     */
    private matchesPattern(name: string, patterns: string[]): boolean {
        return patterns.some(pattern => {
            if (pattern === "*") return true;
            if (pattern === name) return true;

            try {
                const regex = new RegExp(pattern);
                return regex.test(name);
            } catch {
                return false;
            }
        });
    }

    /**
     * Check if a tool is allowed for a given upstream.
     * Supports exact matches and regex patterns in allowed_tools list.
     */
    public isToolAllowed(upstream: Upstream, toolName: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowed_tools;
        if (allowed.length === 0) return false;
        return this.matchesPattern(toolName, allowed);
    }

    /**
     * Check if a resource is allowed for a given upstream.
     * Supports exact matches and regex patterns in allowed_resources list.
     */
    public isResourceAllowed(upstream: Upstream, resourceUri: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowed_resources;
        if (allowed.length === 0) return false;
        return this.matchesPattern(resourceUri, allowed);
    }

    /**
     * Check if a prompt is allowed for a given upstream.
     * Supports exact matches and regex patterns in allowed_prompts list.
     */
    public isPromptAllowed(upstream: Upstream, promptName: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowed_prompts;
        if (allowed.length === 0) return false;
        return this.matchesPattern(promptName, allowed);
    }

    /**
     * Log a permission denial event.
     */
    public logPermissionDenied(
        sessionId: string,
        type: "tool" | "resource" | "prompt",
        namespace: string,
        name: string
    ): void {
        logger.warn({
            sessionId,
            namespace,
            [type]: name
        }, `${type.charAt(0).toUpperCase() + type.slice(1)} access denied by permissions`);
    }
}
