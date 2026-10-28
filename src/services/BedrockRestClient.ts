import { requestUrl } from 'obsidian';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { getAwsCliCredentials } from './AwsCliCredentials';
import { wrapResultSchema } from './BedrockSchema';

export interface BedrockConverseParams {
    awsCliPath: string;
    awsProfile: string;
    region: string;
    /** Model ID or inference profile ID/ARN */
    modelId: string;
    prompt: string;
    /** Gemini-style response schema (uppercase types); converted to JSON Schema here */
    responseSchema: unknown;
    maxTokens: number;
}

export interface BedrockConverseResult {
    /** Parsed structured result */
    data: unknown;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

interface ConverseResponse {
    output?: {
        message?: {
            content?: Array<{ text?: string }>;
        };
    };
    stopReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

function parseErrorBody(status: number, body: string, json: unknown): string {
    const err = json as { message?: string; Message?: string } | undefined;
    const msg = err?.message ?? err?.Message ?? body?.slice(0, 500) ?? 'Unknown error';
    return `${status} ${msg}`.trim();
}

/**
 * Bedrock Converse via Obsidian requestUrl, SigV4-signed with AWS CLI profile credentials.
 * Structured output uses Converse native JSON schema output (outputConfig.textFormat).
 */
export async function bedrockConverseStructured(params: BedrockConverseParams): Promise<BedrockConverseResult> {
    const credentials = await getAwsCliCredentials(params.awsCliPath, params.awsProfile);

    const body = JSON.stringify({
        messages: [{ role: 'user', content: [{ text: params.prompt }] }],
        // No temperature/topP: newer Claude models reject them
        inferenceConfig: { maxTokens: params.maxTokens },
        outputConfig: {
            textFormat: {
                type: 'json_schema',
                structure: {
                    jsonSchema: {
                        name: 'result',
                        schema: JSON.stringify(wrapResultSchema(params.responseSchema))
                    }
                }
            }
        }
    });

    const hostname = `bedrock-runtime.${params.region}.amazonaws.com`;
    const path = `/model/${encodeURIComponent(params.modelId)}/converse`;

    const signer = new SignatureV4({
        service: 'bedrock',
        region: params.region,
        credentials,
        sha256: Sha256
    });
    const signed = await signer.sign({
        method: 'POST',
        protocol: 'https:',
        hostname,
        path,
        headers: { host: hostname, 'content-type': 'application/json' },
        body
    });

    // host is signed but set by the transport itself
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(signed.headers)) {
        if (name.toLowerCase() !== 'host') headers[name] = value;
    }

    const result = await requestUrl({
        url: `https://${hostname}${path}`,
        method: 'POST',
        headers,
        body,
        throw: false
    });

    let json: unknown;
    try {
        json = result.json;
    } catch {
        json = undefined;
    }

    if (result.status < 200 || result.status >= 300) {
        throw new Error(parseErrorBody(result.status, result.text, json));
    }

    const response = (json ?? {}) as ConverseResponse;
    if (response.stopReason === 'max_tokens') {
        throw new Error('Bedrock response truncated (max_tokens reached) - try fewer notes per batch');
    }

    const text = (response.output?.message?.content ?? [])
        .map(c => c.text ?? '')
        .join('')
        .trim();
    if (!text) {
        throw new Error(`Empty structured response from Bedrock (stopReason: ${response.stopReason ?? 'unknown'})`);
    }

    let parsed: { result?: unknown };
    try {
        parsed = JSON.parse(text) as { result?: unknown };
    } catch (parseError) {
        throw new Error(`Failed to parse Bedrock structured response: ${(parseError as Error).message}`);
    }
    if (parsed.result === undefined) {
        throw new Error('Bedrock structured response missing "result"');
    }

    return {
        data: parsed.result,
        usage: {
            inputTokens: response.usage?.inputTokens ?? 0,
            outputTokens: response.usage?.outputTokens ?? 0,
            totalTokens: response.usage?.totalTokens ?? 0
        }
    };
}
