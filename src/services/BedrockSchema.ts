/**
 * Convert a Gemini structured-output schema to the JSON Schema subset accepted by
 * Bedrock Converse structured output (outputConfig.textFormat json_schema):
 * - lowercase type names
 * - drop Gemini-only keywords (propertyOrdering, nullable)
 * - drop array size bounds the model rejects (maxItems; minItems other than 0/1)
 * - close every object with additionalProperties: false and require all of its properties
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
        if (key === 'propertyOrdering' || key === 'nullable' || key === 'maxItems') continue;
        if (key === 'minItems' && (typeof value !== 'number' || value > 1)) continue;
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
    if (out.type === 'object') {
        out.additionalProperties = false;
        // Bedrock caps optional fields per schema (24); require every property instead
        if (out.properties && typeof out.properties === 'object') {
            out.required = Object.keys(out.properties);
        }
    }
    return out;
}

/** Wrap a converted schema in an object root so array-rooted schemas are accepted. */
export function wrapResultSchema(responseSchema: unknown): Record<string, unknown> {
    return {
        type: 'object',
        properties: { result: geminiSchemaToJsonSchema(responseSchema) },
        required: ['result'],
        additionalProperties: false
    };
}
