import { execFile } from 'child_process';

export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
}

/**
 * Why AWS credentials could not be used. Each reason maps to one concrete fix for the user:
 * - sso_expired: the SSO session needs `aws sso login`
 * - rejected: AWS refused credentials the CLI handed out (expired or revoked mid-run)
 * - profile_not_found: the configured profile is not in ~/.aws/config
 * - cli_not_found: the configured AWS CLI path does not exist
 */
export type AwsAuthReason = 'sso_expired' | 'rejected' | 'profile_not_found' | 'cli_not_found' | 'other';

/** Credential failure that no amount of retrying fixes; the user has to act before the next request. */
export class AwsAuthError extends Error {
    constructor(
        message: string,
        public readonly reason: AwsAuthReason,
        public readonly profile: string,
        public readonly cliPath: string
    ) {
        super(message);
        this.name = 'AwsAuthError';
    }

    /** Shell command that fixes this failure, if there is one. */
    get fixCommand(): string | undefined {
        return this.reason === 'sso_expired' || this.reason === 'rejected'
            ? `aws sso login --profile ${this.profile}`
            : undefined;
    }
}

/** Classify AWS CLI stderr from `configure export-credentials`. */
export function classifyAwsCliFailure(message: string): AwsAuthReason {
    // execFile on a missing binary: "spawn /path/to/aws ENOENT"
    if (/\bENOENT\b/.test(message)) return 'cli_not_found';
    if (/config profile .* could not be found/i.test(message)) return 'profile_not_found';
    if (/sso|token|expired|refresh failed/i.test(message)) return 'sso_expired';
    return 'other';
}

interface CredentialProcessOutput {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    SessionToken?: string;
    Expiration?: string;
}

// Refresh this long before STS expiry so a long batch never signs with stale creds
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Credentials without an Expiration (static profiles) are re-read after this long
const NO_EXPIRY_TTL_MS = 15 * 60 * 1000;

const cache = new Map<string, { credentials: AwsCredentials; refreshAt: number }>();
// Concurrent callers share one CLI invocation instead of each spawning their own
const inFlight = new Map<string, Promise<AwsCredentials>>();

function runCli(cliPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(cliPath, args, { timeout: 60_000 }, (error, stdout, stderr) => {
            if (error) {
                // stderr only: stdout may carry credentials and must never reach error messages
                reject(new Error(String(stderr || error.message).trim()));
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * Resolve temporary credentials for an AWS profile via the AWS CLI.
 * The CLI handles role assumption / SSO / credential_process; this only reads the result.
 * Credentials are held in memory only and never persisted.
 */
export async function getAwsCliCredentials(cliPath: string, profile: string): Promise<AwsCredentials> {
    const key = `${cliPath}\u0000${profile}`;
    const cached = cache.get(key);
    if (cached && Date.now() < cached.refreshAt) {
        return cached.credentials;
    }

    let pending = inFlight.get(key);
    if (!pending) {
        pending = fetchCredentials(cliPath, profile, key).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return pending;
}

async function fetchCredentials(cliPath: string, profile: string, key: string): Promise<AwsCredentials> {
    let stdout: string;
    try {
        stdout = await runCli(cliPath, ['configure', 'export-credentials', '--profile', profile, '--format', 'process']);
    } catch (error) {
        const msg = (error as Error).message;
        throw new AwsAuthError(
            `AWS credentials for profile "${profile}" unavailable: ${msg}`,
            classifyAwsCliFailure(msg),
            profile,
            cliPath
        );
    }

    let parsed: CredentialProcessOutput;
    try {
        parsed = JSON.parse(stdout) as CredentialProcessOutput;
    } catch {
        throw new AwsAuthError(`AWS CLI returned unparseable credentials for profile "${profile}"`, 'other', profile, cliPath);
    }
    if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
        throw new AwsAuthError(`AWS CLI returned incomplete credentials for profile "${profile}"`, 'other', profile, cliPath);
    }

    const expiration = parsed.Expiration ? new Date(parsed.Expiration) : undefined;
    const credentials: AwsCredentials = {
        accessKeyId: parsed.AccessKeyId,
        secretAccessKey: parsed.SecretAccessKey,
        sessionToken: parsed.SessionToken,
        expiration
    };
    const refreshAt = expiration
        ? expiration.getTime() - REFRESH_MARGIN_MS
        : Date.now() + NO_EXPIRY_TTL_MS;
    cache.set(key, { credentials, refreshAt });
    return credentials;
}

/** Drop cached credentials for one profile so the next call asks the CLI again. */
export function invalidateAwsCliCredentials(cliPath: string, profile: string): void {
    cache.delete(`${cliPath}\u0000${profile}`);
}

export function clearAwsCliCredentialCache(): void {
    cache.clear();
    inFlight.clear();
}
