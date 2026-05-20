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

import { Prompt, Resource, ResourceTemplate, Tool } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import { Namespace } from "../upstream/upstream.js";

export interface INamespaceService {
    namespaceTool(namespace: Namespace, tool: Tool): Tool;
    namespaceResource(namespace: Namespace, resource: Resource): Resource;
    namespaceResourceTemplate(namespace: Namespace, template: ResourceTemplate): ResourceTemplate;
    namespacePrompt(namespace: Namespace, prompt: Prompt): Prompt;
    namespaceUri(namespace: Namespace, uri: string): string;
    extractNamespaceFromName(name: string): { namespace: string; address: string };
    extractNamespaceFromUri(uri: string): { namespace: string | undefined; address: string };
}

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
export class NamespaceResolver implements INamespaceService {
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
     * Extract namespace and original name from a prefixed name string.
     * Handles both regular prefixed names (namespace__name) and hashed names.
     * Used for tools and prompts.
     */
    public extractNamespaceFromName(name: string): { namespace: string; address: string } {
        // Check if this is a hashed name in the lookup table
        const lookup = this.toolLookup.get(name);
        if (lookup) {
            return { namespace: lookup.namespace, address: lookup.method };
        }

        // Otherwise parse as namespace__name format
        const idx = name.indexOf(this.separator);
        if (idx === -1) {
            throw new Error(`Missing namespace in name "${name}"`);
        }

        return {
            namespace: name.slice(0, idx),
            address: name.slice(idx + this.separator.length),
        };
    }

    /**
     * Extract namespace from a URI query parameter and return the original URI.
     * Used for resources and resource templates.
     */
    public extractNamespaceFromUri(uri: string): { namespace: string | undefined; address: string } {
        const url = new URL(uri, "http://dummy");
        const namespace = url.searchParams.get("namespace") || undefined;
        url.searchParams.delete("namespace");

        // Remove the dummy base if it was added
        let address = url.toString();
        if (address.startsWith("http://dummy")) {
            address = address.replace("http://dummy", "");
        }

        return { namespace, address };
    }

    /**
     * Determine whether a tool name should be hashed based on the current hash mode.
     */
    private shouldHashTool(namespace: Namespace, tool: Tool): boolean {
        switch (this.hashMode) {
            case ToolNameHashMode.NEVER:
                return false;
            case ToolNameHashMode.ALWAYS:
                return true;
            case ToolNameHashMode.THRESHOLD:
                const fullName = `${namespace}${this.separator}${tool.name}`;
                return fullName.length > this.hashThreshold;
        }
    }

    /** * Hash a tool name deterministically and preserve the original name in metadata. * Stores the mapping in the lookup table for later retrieval. */
    private hashToolName(namespace: Namespace, name: string): string {
        const hash = crypto.createHash("sha256").update(`mcpbundler:${namespace}${this.separator}${name}`).digest("hex").slice(0, 12);
        this.toolLookup.set(hash, {
            namespace: namespace,
            method: name
        });
        return hash;
    }

    /** * Process a tool for namespacing. Either hashes the name or adds a namespace prefix. */
    public namespaceTool(namespace: Namespace, tool: Tool): Tool {
        const shouldHash = this.shouldHashTool(namespace, tool);
        const hash: string | undefined = shouldHash ? this.hashToolName(namespace, tool.name) : undefined;

        const existingMeta = tool._meta as Record<string, unknown> | undefined;
        const existingUi = existingMeta?.ui as Record<string, unknown> | undefined;

        let namespacedUi: Record<string, unknown> | undefined;
        if (existingUi) {
            const originalResourceUri = existingUi.resourceUri as string | undefined;
            namespacedUi = {
                ...existingUi,
                ...(originalResourceUri ? { resourceUri: this.namespaceUri(namespace, originalResourceUri) } : {}),
            };
        }

        return {
            ...tool,
            name: shouldHash ? hash : `${namespace}${this.separator}${tool.name}`,
            title: `${namespace}${this.separator}${tool.name}`,
            _meta: {
                ...(existingMeta || {}),
                ...(namespacedUi ? { ui: namespacedUi } : {}),
                ...(shouldHash ? {
                    originalName: tool.name,
                    namespace,
                    hashAlgorithm: "sha256",
                    hashLength: 12,
                    createdBy: "mcpbundler.ai",
                } : {}),
            },
        } as Tool;
    }

    public namespaceUri(namespace: Namespace, uri: string): string {
        try {
            const url = new URL(uri);
            url.searchParams.set("namespace", namespace);
            return url.toString();
        } catch {
            const sep = uri.includes("?") ? "&" : "?";
            return `${uri}${sep}namespace=${encodeURIComponent(namespace)}`;
        }
    }

    public namespaceResource(namespace: Namespace, resource: Resource): Resource {
        return { ...resource, uri: this.namespaceUri(namespace, resource.uri) };
    }

    /** 
     * Add namespace prefix to a prompt name. 
     **/
    public namespacePrompt(namespace: Namespace, prompt: Prompt): Prompt {
        return { ...prompt, name: `${namespace}${this.separator}${prompt.name}` };
    }

    /**
     * Add namespace as query parameter to a resource template URI.
     */
    public namespaceResourceTemplate(namespace: Namespace, resource: ResourceTemplate): ResourceTemplate {
        return { ...resource, uriTemplate: this.namespaceUri(namespace, resource.uriTemplate) };
    }

    /**
     * Clear the tool lookup table.
     * Useful when changing configurations or resetting state.
     */
    public clearLookupTable(): void {
        this.toolLookup.clear();
    }
}
