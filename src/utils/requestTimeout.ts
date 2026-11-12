/** An AI provider request got no response in time. Not retried. */
export class RequestTimeoutError extends Error {
    constructor(provider: string, ms: number) {
        super(`${provider} request timed out after ${Math.round(ms / 1000)}s`);
        this.name = 'RequestTimeoutError';
    }
}

/** Structured analysis asks for 16k+ output tokens, which can take a few minutes. */
export const AI_REQUEST_TIMEOUT_MS = 300_000;

/**
 * requestUrl has no timeout or abort, so race it against a timer. A request that loses
 * the race keeps running in the background; its result is ignored.
 */
export function withRequestTimeout<T>(promise: Promise<T>, provider: string, ms: number = AI_REQUEST_TIMEOUT_MS): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new RequestTimeoutError(provider, ms)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
