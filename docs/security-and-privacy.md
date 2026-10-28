# Security and privacy

This document supports community plugin review and explains automated scanner findings for the release bundle (`main.js`).

## What the plugin does with your data

- **Local by default:** Graph metrics (Rust/WebAssembly), vault analysis caches, and derived chart data are stored via Obsidian `loadData` / `saveData` on your device.
- **Optional cloud AI, one provider at a time:** when you run Vault Analysis or a tab analysis, note content and prompts are sent to the provider selected in settings. Nothing is sent on plugin load.
  - **Google Gemini** (default): Google's Generative Language API, using **your** API key.
  - **AWS Bedrock**: Bedrock in **your** AWS account, signed with temporary credentials from your AWS CLI profile.
- **No plugin backend:** There is no first-party server; the plugin does not collect analytics.

## Network access

| Trigger | Endpoint | Mechanism |
|---------|----------|-----------|
| Vault Analysis / tab AI, provider = Gemini | `generativelanguage.googleapis.com` | Obsidian [`requestUrl`](https://docs.obsidian.md/Reference/TypeScript+API/requestUrl) only ([`src/services/GeminiRestClient.ts`](../src/services/GeminiRestClient.ts)) |
| Vault Analysis / tab AI, provider = Bedrock | `bedrock-runtime.<region>.amazonaws.com` (`POST /model/<id>/converse`) | Obsidian `requestUrl` only, SigV4-signed with `@smithy/signature-v4` ([`src/services/BedrockRestClient.ts`](../src/services/BedrockRestClient.ts)) |
| Bedrock credentials (before the first Bedrock call, then about hourly) | None from the plugin. The AWS CLI may call AWS STS or IAM Identity Center itself. | Local `child_process.execFile` of the configured `aws` binary: `aws configure export-credentials --profile <p> --format process` ([`src/services/AwsCliCredentials.ts`](../src/services/AwsCliCredentials.ts)) |

### Bedrock credential handling

- The plugin never stores AWS keys. Settings hold only the profile name, region, model ID, and CLI path.
- Temporary credentials from the CLI are kept in memory, refreshed 5 minutes before they expire, and shared by concurrent requests.
- Error messages include only the CLI's stderr, never its stdout (which contains the credentials).
- Bedrock error messages saved to `data.json` contain the status, AWS request ID, stop reason and output size, never prompt or output text.

See also the **Privacy and network** section in [README.md](../README.md) and the disclosure in plugin settings.

## Automated scan: `fetch()` / `request()`

Community scanners often count substrings in the minified `main.js` bundle.

- **`fetch(`** — Release builds do not bundle `@google/genai` or an AWS SDK client; Gemini and Bedrock calls use `requestUrl` only. Any remaining `fetch(` matches are unrelated (e.g. minified helper names) and should be zero or minimal after `npm run audit:bundle`.
- **`request`** — Most matches are **not** HTTP calls, for example:
  - `requestAnimationFrame` (graph view rendering)
  - `requestUrl` (Obsidian API name in strings or types)
  - Error text such as `GenerateRequestsPerDay…` (quota messages)

Run `node scripts/audit-release-bundle.mjs` after `npm run build` for a categorized report to attach to your obsidian-releases PR.

## Automated scan: `atob()` / `btoa()`

Earlier builds embedded the WASM file using runtime `atob()` on a base64 string. **Current builds** embed the `.wasm` file with esbuild’s **binary loader** ([`src/wasm/embedded.ts`](../src/wasm/embedded.ts)), which emits a `Uint8Array` literal and does **not** use `atob`/`btoa` in `dist/main.js`.

## WebAssembly and exported linear memory

The graph engine is compiled with **wasm-bindgen** (`wasm-pack build --target web`) and embedded in `main.js` at build time ([`docs/publishing.md`](publishing.md)). This matches Obsidian’s release layout (single `main.js` asset).

- The `.wasm` module **exports linear memory** as required by wasm-bindgen for JavaScript↔Rust FFI. This is standard for Rust WASM plugins and is **not** used to expose arbitrary host access to vault data.
- Plugin TypeScript only calls exported functions defined in [`graph-analysis-wasm/src/api.rs`](../graph-analysis-wasm/src/api.rs) (e.g. `build_graph_from_vault`, centrality helpers). The host does not read or write the WASM memory buffer directly.
- WASM runs inside the browser/Electron sandbox like other Obsidian webviews.

We do **not** strip the memory export from the binary; doing so would break wasm-bindgen initialization.

## PR appendix (copy-paste for reviewers)

```
Network: the user's selected AI provider only, when the user runs Vault Analysis or a tab analysis. Gemini: user API key. Bedrock: SigV4 with temporary credentials from the user's AWS CLI profile. requestUrl only in both cases.
Local process: Bedrock credentials come from `aws configure export-credentials` via child_process.execFile (desktop-only plugin).
fetch/atob/btoa: not present in release main.js (REST clients + embedded WASM bytes).
request substring counts include false positives (requestAnimationFrame, requestUrl identifier).
WASM memory export: standard wasm-bindgen; no direct host memory access in plugin code.
```

## AI client implementation

The plugin uses thin REST clients instead of vendor SDKs, so the release bundle avoids SDK `fetch`/`atob` helpers:

- **Gemini:** [`GeminiRestClient.ts`](../src/services/GeminiRestClient.ts) instead of `@google/genai`.
- **Bedrock:** [`BedrockRestClient.ts`](../src/services/BedrockRestClient.ts) instead of `@aws-sdk/client-bedrock-runtime`. Only the SigV4 signer (`@smithy/signature-v4`, `@aws-crypto/sha256-js`) is bundled; it makes no network calls.
