import { requestUrl } from 'obsidian';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { getAwsCliCredentials } from './AwsCliCredentials';

/** Tool name used to force structured (schema-shaped) output from Converse. */
const STRUCTURED_OUTPUT_TOOL = 'structured_output';

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
    temperature: number;
}

export interface BedrockConverseResult {
    /** Parsed tool input, i.e. the structured result */
    data: unknown;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

interface ConverseResponse {
    output?: {
        message?: {
            content?: Array<{ text?: string; toolUse?: { name?: string; input?: unknown } }>;
        };
    };
    stopReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

/**
 * Convert a Gemini structured-output schema to JSON Schema:
 * lowercase type names and drop Gemini-only keywords.
 */
export function geminiSchemaToJsonSchema(schema: unknown): unknown {
    if (Array.isArray(schema)) {
        return schema.map(geminiSchemaToJsonSchema);
    }
    if (!schema || typeof schema !== 'object') {
        return schema;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
        if (key === 'propertyOrdering' || key === 'nullable') continue;
        if (key === 'type' && typeof value === 'string') {
            out.type = value.toLowerCase();
        } else if (key === 'properties' && value && typeof value === 'object') {
            const props: Record<string, unknown> = {};
            for (const [name, prop] of Object.entries(value as Record<string, unknown>)) {
                props[name] = geminiSchemaToJsonSchema(prop);
            }
            out.properties = props;
        } else {
            out[key] = geminiSchemaToJsonSchema(value);
        }
    }
    return out;
}

function parseErrorBody(status: number, body: string, json: unknown): string {
    const err = json as { message?: string; Message?: string } | undefined;
    const msg = err?.message ?? err?.Message ?? body?.slice(0, 500) ?? 'Unknown error';
    return `${status} ${msg}`.trim();
}

/**
 * Bedrock Converse via Obsidian requestUrl, SigV4-signed with AWS CLI profile credentials.
 * Structured output is obtained by forcing a single tool call whose input schema is the response schema.
 */
export async function bedrockConverseStructured(params: BedrockConverseParams): Promise<BedrockConverseResult> {
    const credentials = await getAwsCliCredentials(params.awsCliPath, params.awsProfile);

    // Tool input must be an object; wrap so array-rooted schemas work too
    const inputSchema = {
        type: 'object',
        properties: { result: geminiSchemaToJsonSchema(params.responseSchema) },
        required: ['result']
    };

    const body = JSON.stringify({
        messages: [{ role: 'user', content: [{ text: params.prompt }] }],
        inferenceConfig: {
            maxTokens: params.maxTokens,
            // Newer Claude models reject temperature and topP together; send temperature only
            temperature: params.temperature
        },
        toolConfig: {
            tools: [{
                toolSpec: {
                    name: STRUCTURED_OUTPUT_TOOL,
                    description: 'Return the analysis result in the required structure.',
                    inputSchema: { json: inputSchema }
                }
            }],
            toolChoice: { tool: { name: STRUCTURED_OUTPUT_TOOL } }
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

    const toolUse = response.output?.message?.content?.find(c => c.toolUse?.name === STRUCTURED_OUTPUT_TOOL)?.toolUse;
    const input = toolUse?.input as { result?: unknown } | undefined;
    if (!input || input.result === undefined) {
        throw new Error(`Empty structured response from Bedrock (stopReason: ${response.stopReason ?? 'unknown'})`);
    }

    return {
        data: input.result,
        usage: {
            inputTokens: response.usage?.inputTokens ?? 0,
            outputTokens: response.usage?.outputTokens ?? 0,
            totalTokens: response.usage?.totalTokens ?? 0
        }
    };
}
