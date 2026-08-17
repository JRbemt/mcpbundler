/**
 * A named, self-contained configuration a session can be running: the set
 * of middlewares installed, the upstreams attached (or attachable), and the
 * loading strategy governing how those upstreams come online.
 *
 * Two stages exist today: the anonymous discovery stage (no upstreams, only
 * bundler-native discovery tools) and a bundle stage (a resolved bundle's
 * real middlewares and upstreams). Session.transitionTo moves a live
 * session from one to the other in place - see session.ts.
 */
import { BundlerMiddleware } from "../middleware/middleware.js";
import { MCPConfig } from "../schemas.js";
import { LoadingStrategy } from "./loading/loading-strategy.js";

export interface BundlerStage {
    readonly name: string;
    readonly middlewares: BundlerMiddleware[];
    readonly upstreams: MCPConfig[];
    readonly loadingStrategy: LoadingStrategy;
}
