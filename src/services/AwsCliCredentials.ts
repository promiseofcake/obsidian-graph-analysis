import { execFile } from 'child_process';

export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
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
        const hint = /sso|token|expired/i.test(msg)
            ? ` Try running: aws sso login --profile ${profile}`
            : '';
        throw new Error(`AWS credentials for profile "${profile}" unavailable: ${msg}.${hint}`);
    }

    let parsed: CredentialProcessOutput;
    try {
        parsed = JSON.parse(stdout) as CredentialProcessOutput;
    } catch {
        throw new Error(`AWS CLI returned unparseable credentials for profile "${profile}"`);
    }
    if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
        throw new Error(`AWS CLI returned incomplete credentials for profile "${profile}"`);
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

export function clearAwsCliCredentialCache(): void {
    cache.clear();
    inFlight.clear();
}
