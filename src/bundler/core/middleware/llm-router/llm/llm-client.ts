/**
 * Generic LLM client abstraction for tool routing.
 *
 * Decouples the namespace selector from any specific provider. New providers
 * are added by implementing LLMClient and registering via createLLMClient.
 */

export interface LLMClientConfig {
    type: "openai-compatible";
    model: string;
    endpoint: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
}

export interface LLMClient {
    complete(systemPrompt: string, userMessage: string): Promise<string>;
}
