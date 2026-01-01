/**
 * NamespaceResolver - Namespace collision resolution and tool name hashing
 *
 * Manages namespace prefixing for tools, resources, and prompts from multiple upstream
 * MCPs. Handles name collisions by prefixing items with namespace. For long tool names,
 * supports optional SHA-256 hashing to keep names under MCP client limits.
 *
 * Three hash modes:
 * - NEVER: Always use namespace__name format
 * - ALWAYS: Always hash tool names
 * - THRESHOLD: Hash only if name exceeds length threshold (default 64 chars)
 *
 * Hashed tool names store original name in metadata and annotations for debugging.
 * Maintains lookup table for reverse resolution.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import logger from "../../utils/logger.js";

/**
 * Hash modes for tool names
 */
export enum ToolNameHashMode {
    /** Never hash tool names - use namespace__toolname format */
    NEVER = "never",
    /** Hash all tool names regardless of length */
    ALWAYS = "always",
    /** Only hash tool names longer than specified threshold */
    THRESHOLD = "threshold"
}

/**
 * Manages namespace resolution, extraction, and tool name hashing.
 * Handles the separation and recombination of namespace prefixes for MCP capabilities.
 */
export class NamespaceResolver {
    private readonly separator: string;
    private hashMode: ToolNameHashMode;
    private readonly hashThreshold: number;
    private readonly toolLookup: Map<string, { namespace: string, method: string }>;

    constructor(
        separator: string = "__",
        hashMode: ToolNameHashMode = ToolNameHashMode.THRESHOLD,
        hashThreshold: number = 64
    ) {
        this.separator = separator;
        this.hashMode = hashMode;
        this.hashThreshold = hashThreshold;
        this.toolLookup = new Map();
    }

    /**
     * Get the current hash mode.
     */
    public getHashMode(): ToolNameHashMode {
        return this.hashMode;
    }

    /**
     * Set the hash mode and clear existing lookup table.
     */
    public setHashMode(mode: ToolNameHashMode): void {
        this.hashMode = mode;
        this.toolLookup.clear();
    }

    /**
     * Extract namespace and method from a namespaced string.
     * Throws an error if no separator is found.
     */
    public extractNamespace(namespacedMethod: string): { namespace: string, method: string } {
        const idx = namespacedMethod.indexOf(this.separator);
        if (idx === -1) {
            throw new Error(`Missing namespace in tool name "${namespacedMethod}"`);
        }
        const namespace = namespacedMethod.slice(0, idx);
        const method = namespacedMethod.slice(idx + this.separator.length);
        return { namespace, method };
    }

    /**
     * Lookup a hashed tool name to retrieve its original namespace and method.
     * Returns undefined if the hash is not found.
     */
    public lookupTool(hash: string): { namespace: string, method: string } | undefined {
        return this.toolLookup.get(hash);
    }

    /**
     * Determine whether a tool name should be hashed based on the current hash mode.
     */
    private shouldHashTool(namespace: string, tool: Tool): boolean {
        switch (this.hashMode) {
            case ToolNameHashMode.NEVER:
                return false;
            case ToolNameHashMode.ALWAYS:
                return true;
            case ToolNameHashMode.THRESHOLD:
                const fullName = `${namespace}${this.separator}${tool.name}`;
                return fullName.length > this.hashThreshold;
            default:
                return false;
        }
    }

    /**
     * Hash a tool name deterministically and preserve the original name in metadata.
     * Stores the mapping in the lookup table for later retrieval.
     */
    private hashToolName(namespace: string, tool: Tool): Tool {
        const hash = crypto.createHash("sha256")
            .update(`${namespace}${this.separator}${tool.name}`)
            .digest("hex")
            .slice(0, 12);

        const readableTitle = `${namespace}::${tool.name}`;

        this.toolLookup.set(hash, {
            namespace: namespace,
            method: tool.name
        });

        return {
            ...tool,
            name: hash,
            title: tool.title,
            annotations: {
                ...(tool.annotations || {}),
                title: tool.annotations?.title ?? readableTitle,
            },
            _meta: {
                ...(tool._meta || {}),
                originalName: tool.name,
                namespace,
                hashAlgorithm: "sha256",
                hashLength: 12,
                createdBy: "mcpbundler.ai",
            },
        } as Tool;
    }

    /**
     * Process a tool for namespacing. Either hashes the name or adds a namespace prefix.
     */
    public namespaceTool(namespace: string, tool: Tool): Tool {
        if (this.shouldHashTool(namespace, tool)) {
            return this.hashToolName(namespace, tool);
        } else {
            return {
                ...tool,
                name: `${namespace}${this.separator}${tool.name}`
            };
        }
    }

    /**
     * Add namespace prefix to a resource URI.
     */
    public namespaceResource(namespace: string, uri: string): string {
        return `${namespace}${this.separator}${uri}`;
    }

    /**
     * Add namespace prefix to a prompt name.
     */
    public namespacePrompt(namespace: string, name: string): string {
        return `${namespace}${this.separator}${name}`;
    }

    /**
     * Add namespace prefix to a resource template URI.
     */
    public namespaceResourceTemplate(namespace: string, uri: string): string {
        return `${namespace}${this.separator}${uri}`;
    }

    /**
     * Clear the tool lookup table.
     * Useful when changing configurations or resetting state.
     */
    public clearLookupTable(): void {
        this.toolLookup.clear();
    }
}
