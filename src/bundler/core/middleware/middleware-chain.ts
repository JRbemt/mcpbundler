import { CallToolRequest, CallToolResult, Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { BundlerMiddleware, MiddlewareContext } from "./middleware.js";
import logger from "../../../shared/utils/logger.js";

/**
 * Ordered chain of BundlerMiddleware instances for a single session.
 *
 * Execution semantics:
 * - `transformToolList`  : sequential fold - each middleware receives the output of the previous.
 * - `handleOwnToolCall`  : first-match wins - iterates until a middleware returns non-null.
 * - `onBeforeToolCall`   : first-match wins - iterates until a middleware returns a CallToolResult; a throwing middleware is skipped and the next one still runs.
 * - `onAfterToolCall`    : all middlewares called in registration order.
 * - `onUpstreamAttached` : all middlewares called in registration order.
 * - `teardown`           : all middlewares called in registration order; errors are logged, not thrown.
 */
export class MiddlewareChain {
    private readonly middlewares: BundlerMiddleware[] = [];

    add(middleware: BundlerMiddleware): void {
        if (this.has(middleware.name)) {
            throw new Error(`Middleware "${middleware.name}" is already registered in this chain`);
        }
        this.middlewares.push(middleware);
    }

    remove(name: string): boolean {
        const idx = this.middlewares.findIndex((m) => m.name === name);
        if (idx === -1) return false;
        this.middlewares.splice(idx, 1);
        return true;
    }

    has(name: string): boolean {
        return this.middlewares.some((m) => m.name === name);
    }

    get(name: string): BundlerMiddleware | undefined {
        return this.middlewares.find((m) => m.name === name);
    }

    getNames(): string[] {
        return this.middlewares.map((m) => m.name);
    }

    async transformToolList(tools: Tool[], ctx: MiddlewareContext): Promise<Tool[]> {
        let result = tools;
        for (const mw of this.middlewares) {
            try {
                result = await mw.transformToolList(result, ctx);
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, err },
                    "Middleware transformToolList failed, skipping",
                );
            }
        }
        return result;
    }

    async transformResourceList(resources: Resource[], ctx: MiddlewareContext): Promise<Resource[]> {
        let result = resources;
        for (const mw of this.middlewares) {
            try {
                result = await mw.transformResourceList(result, ctx);
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, err },
                    "Middleware transformResourceList failed, skipping",
                );
            }
        }
        return result;
    }

    async transformPromptList(prompts: Prompt[], ctx: MiddlewareContext): Promise<Prompt[]> {
        let result = prompts;
        for (const mw of this.middlewares) {
            try {
                result = await mw.transformPromptList(result, ctx);
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, err },
                    "Middleware transformPromptList failed, skipping",
                );
            }
        }
        return result;
    }

    async handleOwnToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<CallToolResult | null> {
        for (const mw of this.middlewares) {
            try {
                const result = await mw.handleOwnToolCall(params, ctx);
                if (result !== null) return result;
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, tool: params.name, err },
                    "Middleware handleOwnToolCall failed",
                );
            }
        }
        return null;
    }

    async onBeforeToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<CallToolResult | void> {
        for (const mw of this.middlewares) {
            try {
                const result = await mw.onBeforeToolCall(params, ctx);
                if (result) return result;
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, tool: params.name, err },
                    "Middleware onBeforeToolCall failed, skipping",
                );
            }
        }
    }

    async onAfterToolCall(
        params: CallToolRequest["params"],
        result: CallToolResult,
        ctx: MiddlewareContext,
    ): Promise<CallToolResult> {
        let current = result;
        for (const mw of this.middlewares) {
            try {
                current = await mw.onAfterToolCall(params, current, ctx);
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, tool: params.name, err },
                    "Middleware onAfterToolCall failed, skipping",
                );
            }
        }
        return current;
    }

    async onUpstreamAttached(namespace: string, ctx: MiddlewareContext): Promise<void> {
        for (const mw of this.middlewares) {
            try {
                await mw.onUpstreamAttached(namespace, ctx);
            } catch (err) {
                logger.error(
                    { middleware: mw.name, sessionId: ctx.sessionId, namespace, err },
                    "Middleware onUpstreamAttached failed, skipping",
                );
            }
        }
    }

    async teardown(): Promise<void> {
        for (const mw of this.middlewares) {
            try {
                await mw.teardown();
            } catch (err) {
                logger.error({ middleware: mw.name, err }, "Middleware teardown failed");
            }
        }
    }
}
