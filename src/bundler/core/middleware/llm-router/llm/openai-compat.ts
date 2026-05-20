import logger from "../../../../../shared/utils/logger.js";
import { LLMClient, LLMClientConfig } from "./llm-client.js";

interface ChatCompletionResponse {
    choices: Array<{
        message: {
            content: string | null;
        };
    }>;
}

/**
 * OpenAI-compatible chat completion client.
 *
 * Works with any endpoint that speaks the /v1/chat/completions protocol:
 * Ollama (local Gemma, Llama, etc.), OpenAI, Groq, Mistral, etc.
 * Pass an empty apiKey for local endpoints that do not require authentication.
 */
export class OpenAICompatClient implements LLMClient {
    private readonly endpoint: string;
    private readonly model: string;
    private readonly apiKey: string | undefined;
    private readonly temperature: number;
    private readonly maxTokens: number;
    private readonly timeoutMs: number;

    constructor(config: LLMClientConfig) {
        this.endpoint = config.endpoint.replace(/\/$/, "");
        this.model = config.model;
        this.apiKey = config.apiKey;
        this.temperature = config.temperature ?? 0.1;
        this.maxTokens = config.maxTokens ?? 256;
        this.timeoutMs = config.timeoutMs ?? 10000;
    }

    async complete(systemPrompt: string, userMessage: string): Promise<string> {
        const url = `${this.endpoint}/chat/completions`;

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const body = JSON.stringify({
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            response_format: { type: "json_object" },
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            stream: false,
        });

        const response = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`LLM request failed: HTTP ${response.status} — ${text}`);
        }

        const data = await response.json() as ChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content;

        if (typeof content !== "string" || content.trim() === "") {
            throw new Error("LLM returned empty content");
        }

        logger.debug({ model: this.model, chars: content.length }, "LLM completion received");
        return content;
    }
}
