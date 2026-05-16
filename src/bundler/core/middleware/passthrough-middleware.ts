import { AbstractBundlerMiddleware } from "./bundler-middleware.js";

/**
 * Identity middleware — passes all tools and calls through unchanged.
 * Installed in every session by default. Serves as a reference implementation
 * and a safe no-op that can be left in place.
 */
export class PassthroughMiddleware extends AbstractBundlerMiddleware {
    readonly name = "passthrough";
}
