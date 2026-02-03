/**
 * PermissionManager - Per-MCP permission enforcement
 *
 * Enforces granular access control for tools, resources, and prompts at the per-MCP
 * level. Each MCP in a bundle has its own allow-lists for each capability type.
 *
 * Three access patterns:
 * - ["*"]: Allow all (default)
 * - []: Deny all
 * - ["name1", "name2"]: Allow specific names (supports regex patterns)
 *
 * Empty arrays deny all access. Patterns support exact matches, wildcard (*), and
 * regex expressions for flexible permission rules.
 */

import logger from "../../../shared/utils/logger.js";
import { MCPConfig } from "../schemas.js";

export interface IPermissionService {
    isToolAllowed(config: MCPConfig, toolName: string): boolean;
    isResourceAllowed(config: MCPConfig, resourceUri: string): boolean;
    isPromptAllowed(config: MCPConfig, promptName: string): boolean;
}

/**
 * Manages permission checking for MCP capabilities (tools, resources, prompts).
 * Supports exact string matches, wildcard patterns, and regex patterns.
 */
export class PermissionManager implements IPermissionService {
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
     * Check if a tool is allowed for a given MCP config.
     * Supports exact matches and regex patterns in allowed_tools list.
     */
    public isToolAllowed(config: MCPConfig, toolName: string): boolean {
        const permissions = config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowedTools;
        if (allowed.length === 0) return false;
        return this.matchesPattern(toolName, allowed);
    }

    /**
     * Check if a resource is allowed for a given MCP config.
     * Supports exact matches and regex patterns in allowed_resources list.
     */
    public isResourceAllowed(config: MCPConfig, resourceUri: string): boolean {
        const permissions = config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowedResources;
        if (allowed.length === 0) return false;
        return this.matchesPattern(resourceUri, allowed);
    }

    /**
     * Check if a prompt is allowed for a given MCP config.
     * Supports exact matches and regex patterns in allowed_prompts list.
     */
    public isPromptAllowed(config: MCPConfig, promptName: string): boolean {
        const permissions = config.permissions;
        if (!permissions) return true;

        const allowed = permissions.allowedPrompts;
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
