import { GraphAnalysisSettings } from '../types/types';
import { geminiGenerateContent } from './GeminiRestClient';
import { bedrockConverseStructured } from './BedrockRestClient';
import { createKnowledgeNetworkSchema } from '../ai/schemas/knowledge-network.schema';
import { createVaultSemanticAnalysisSchema } from '../ai/schemas/vault-semantic-analysis.schema';
import { createKnowledgeEvolutionSchema } from '../ai/schemas/knowledge-evolution.schema';
import { createRecommendedActionsSchema } from '../ai/schemas/recommended-actions.schema';
import {
    SemanticAnalysisError,
    SemanticErrorType,
    classifyGeminiError
} from '../utils/GeminiErrorUtils';

export interface TokenUsage {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
}

export interface AIResponse<T = string> {
    result: T;
    tokenUsage: TokenUsage;
}

export type { SemanticErrorType };
export { SemanticAnalysisError };

export class AIModelService {
    private app: { workspace: { containerEl: HTMLElement } };
    private settings: GraphAnalysisSettings;

    /** Window from app workspace (avoids global for pop-out compatibility) */
    private get win(): Window {
        return this.app.workspace.containerEl.ownerDocument.defaultView!;
    }
    // Gemini 3 Flash: RPM 5 -> 12s between requests
    private readonly ADVANCED_RATE_LIMIT_DELAY = 12000;
    private readonly MODEL_NAME = 'gemini-3-flash-preview';
    private readonly SEMANTIC_MODEL_NAME = 'gemini-3.1-flash-lite-preview'; // Default when no modelOverride

    private get isBedrock(): boolean {
        return this.settings?.aiProvider === 'bedrock';
    }

    public getModelName(): string {
        return this.isBedrock ? this.settings.bedrockModelId : this.MODEL_NAME;
    }

    public getSemanticModelName(): string {
        return this.isBedrock ? this.settings.bedrockModelId : this.SEMANTIC_MODEL_NAME;
    }

    constructor(app: { workspace: { containerEl: HTMLElement } }, settings: GraphAnalysisSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * Update settings (useful when settings change)
     */
    public updateSettings(settings: GraphAnalysisSettings): void {
        this.settings = settings;
    }

    /** Whether the selected provider has the settings it needs to make calls. */
    public isConfigured(): boolean {
        if (this.isBedrock) {
            return !!(this.settings.bedrockAwsProfile?.trim()
                && this.settings.bedrockRegion?.trim()
                && this.settings.bedrockModelId?.trim()
                && this.settings.awsCliPath?.trim());
        }
        return !!this.settings?.geminiApiKey?.trim();
    }

    private getApiKey(): string {
        const key = this.settings?.geminiApiKey?.trim();
        if (!key) {
            throw new Error('Gemini API key not configured. Please configure your API key in settings.');
        }
        return key;
    }

    /**
     * Single provider call. Gemini returns JSON text to parse; Bedrock returns the parsed structure.
     */
    private async callModel(
        model: string,
        prompt: string,
        responseSchema: unknown,
        maxOutputTokens: number,
        temperature: number,
        topP: number,
        thinkingBudget: number
    ): Promise<{ text?: string; data?: unknown; tokenUsage: TokenUsage }> {
        if (this.isBedrock) {
            if (!this.isConfigured()) {
                throw new Error('Bedrock not configured. Please set AWS profile, region, and model ID in settings.');
            }
            const response = await bedrockConverseStructured({
                awsCliPath: this.settings.awsCliPath.trim(),
                awsProfile: this.settings.bedrockAwsProfile.trim(),
                region: this.settings.bedrockRegion.trim(),
                modelId: this.settings.bedrockModelId.trim(),
                prompt,
                responseSchema,
                maxTokens: maxOutputTokens,
                temperature
            });
            return {
                data: response.data,
                tokenUsage: {
                    promptTokens: response.usage.inputTokens,
                    candidatesTokens: response.usage.outputTokens,
                    totalTokens: response.usage.totalTokens
                }
            };
        }

        const response = await geminiGenerateContent({
            apiKey: this.getApiKey(),
            model,
            prompt,
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema,
                temperature,
                topP,
                maxOutputTokens,
                thinkingConfig: {
                    thinkingBudget
                }
            }
        });
        return {
            text: response.text,
            tokenUsage: {
                promptTokens: response.usageMetadata?.promptTokenCount || 0,
                candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
                totalTokens: response.usageMetadata?.totalTokenCount || 0
            }
        };
    }

    /**
     * Structured output analysis using the configured model with response schema
     * This method ensures reliable JSON responses by using the structured output feature
     */
    public async generateStructuredAnalysis<T>(
        prompt: string,
        responseSchema: unknown,
        maxOutputTokens: number = 8192 * 2,
        temperature: number = 0.3, // more accurate results with lower temperature
        topP: number = 0.72
    ): Promise<AIResponse<T>> {
        const model = this.getModelName();

        try {
            const response = await this.callModel(model, prompt, responseSchema, maxOutputTokens, temperature, topP, -1);
            const tokenUsage = response.tokenUsage;

            if (response.data !== undefined) {
                return { result: response.data as T, tokenUsage };
            }

            const result = response.text || '';

            if (!result) {
                throw new Error(
                    'Empty response from Gemini API - check API key, request format, or content policy restrictions'
                );
            }

            let parsedResult: T;
            try {
                parsedResult = JSON.parse(result) as T;
            } catch (parseError) {
                throw new Error(`Failed to parse structured response: ${(parseError as Error).message}`);
            }

            return {
                result: parsedResult,
                tokenUsage
            };
        } catch (error) {
            const errorMessage = (error as Error).message;
            const errorType = classifyGeminiError(errorMessage);

            if (errorType === 'quota_exhausted') {
                throw new SemanticAnalysisError(errorMessage, 'quota_exhausted', model);
            }
            if (errorType === 'rate_limit') {
                await new Promise(resolve => this.win.setTimeout(resolve, this.ADVANCED_RATE_LIMIT_DELAY));
                return this.generateStructuredAnalysis(
                    prompt,
                    responseSchema,
                    maxOutputTokens,
                    temperature,
                    topP
                );
            }

            throw error;
        }
    }

    /**
     * Semantic analysis using Gemini for vault batch processing.
     * Uses native structured output (responseMimeType + responseSchema).
     * @param modelOverride When set, use this model instead of SEMANTIC_MODEL_NAME
     */
    public async generateSemanticAnalysis<T>(
        prompt: string,
        responseSchema: unknown,
        maxOutputTokens: number = 8192,
        temperature: number = 0.3,
        topP: number = 0.72,
        modelOverride?: string
    ): Promise<AIResponse<T>> {
        // Bedrock uses the configured model only; overrides are stored Gemini model names from failed batches
        const model = this.isBedrock ? this.getSemanticModelName() : (modelOverride ?? this.SEMANTIC_MODEL_NAME);

        try {
            const response = await this.callModel(model, prompt, responseSchema, maxOutputTokens, temperature, topP, 0);
            const tokenUsage = response.tokenUsage;

            if (response.data !== undefined) {
                return { result: response.data as T, tokenUsage };
            }

            const result = response.text?.trim() || '';

            if (!result) {
                throw new Error(
                    'Empty response from Gemini API - check API key, request format, or content policy restrictions'
                );
            }

            let parsedResult: T;
            try {
                parsedResult = JSON.parse(result) as T;
            } catch (parseError) {
                const msg = `Failed to parse semantic response: ${(parseError as Error).message}`;
                throw new SemanticAnalysisError(msg, 'json_parse', model);
            }

            return {
                result: parsedResult,
                tokenUsage
            };
        } catch (error) {
            if (error instanceof SemanticAnalysisError) throw error;

            const errorMessage = (error as Error).message;
            const errorType = classifyGeminiError(errorMessage);
            if (errorType === 'quota_exhausted') {
                throw new SemanticAnalysisError(errorMessage, 'quota_exhausted', model);
            }
            throw new SemanticAnalysisError(errorMessage, errorType, model);
        }
    }

    public createKnowledgeNetworkSchema(): unknown {
        return createKnowledgeNetworkSchema();
    }

    public createVaultSemanticAnalysisSchema(expectedResultCount: number): unknown {
        return createVaultSemanticAnalysisSchema(expectedResultCount);
    }

    public createKnowledgeEvolutionSchema(): unknown {
        return createKnowledgeEvolutionSchema();
    }

    public createRecommendedActionsSchema(): unknown {
        return createRecommendedActionsSchema();
    }

    public async waitForRateLimit(): Promise<void> {
        await new Promise(resolve => this.win.setTimeout(resolve, this.ADVANCED_RATE_LIMIT_DELAY));
    }

    public calculateDelay(_requestCount: number): number {
        return this.ADVANCED_RATE_LIMIT_DELAY;
    }
}
