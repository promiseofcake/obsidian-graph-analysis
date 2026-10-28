/**
 * User-tunable Bedrock batching and retry settings: defaults and allowed ranges.
 * Shared by the settings tab (validation) and AIModelService (runtime clamping),
 * so a hand-edited or stale data.json can't push values out of range.
 */
export type BedrockTuningKey =
    | 'bedrockBatchSize'
    | 'bedrockBatchConcurrency'
    | 'bedrockBatchDelaySeconds'
    | 'bedrockMaxAttempts'
    | 'bedrockBackoffBaseSeconds'
    | 'bedrockBackoffMaxSeconds';

export interface BedrockTuningSpec {
    key: BedrockTuningKey;
    /** i18n key under settings.bedrock.tuning */
    i18n: string;
    defaultValue: number;
    min: number;
    max: number;
    integer: boolean;
}

export const BEDROCK_TUNING: BedrockTuningSpec[] = [
    // Each note reserves ~1K output tokens, so batches above ~50 exceed common output limits
    { key: 'bedrockBatchSize', i18n: 'batchSize', defaultValue: 30, min: 1, max: 50, integer: true },
    { key: 'bedrockBatchConcurrency', i18n: 'concurrency', defaultValue: 3, min: 1, max: 10, integer: true },
    { key: 'bedrockBatchDelaySeconds', i18n: 'batchDelay', defaultValue: 0, min: 0, max: 60, integer: false },
    { key: 'bedrockMaxAttempts', i18n: 'maxAttempts', defaultValue: 5, min: 1, max: 10, integer: true },
    { key: 'bedrockBackoffBaseSeconds', i18n: 'backoffBase', defaultValue: 2, min: 0.5, max: 30, integer: false },
    { key: 'bedrockBackoffMaxSeconds', i18n: 'backoffMax', defaultValue: 30, min: 1, max: 300, integer: false }
];

export const BEDROCK_TUNING_DEFAULTS = Object.fromEntries(
    BEDROCK_TUNING.map(spec => [spec.key, spec.defaultValue])
) as Record<BedrockTuningKey, number>;

/** Parse user input; returns null when it isn't a number in range (integers required where noted). */
export function parseTuningValue(spec: BedrockTuningSpec, raw: string): number | null {
    const value = Number(raw.trim());
    if (raw.trim() === '' || !Number.isFinite(value)) return null;
    if (spec.integer && !Number.isInteger(value)) return null;
    if (value < spec.min || value > spec.max) return null;
    return value;
}

/** Read a stored value, falling back to the default and clamping into range. */
export function resolveTuningValue(spec: BedrockTuningSpec, stored: unknown): number {
    const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : spec.defaultValue;
    const clamped = Math.min(spec.max, Math.max(spec.min, value));
    return spec.integer ? Math.round(clamped) : clamped;
}
