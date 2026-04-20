import { Bundle } from "../schemas.js";
/**
 * Interface for resloving bundle configurations
 * 
 */
export interface ResolverService {
    /**
     * Resolve a bundle token to its configuration
     *
     * @param token - Bundle token (e.g., "mcpb_live_...")
     * @returns Bundle configuration with upstreams
     * @throws Error if token is invalid, expired, or revoked
     */
    resolveBundle(token: string): Promise<Bundle>;
}