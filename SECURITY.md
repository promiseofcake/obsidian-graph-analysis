---
version: 0.7.0
---

# Security disclosure

Report security issues privately via GitHub Security Advisories on the plugin repository.

## Data collection

| Data type | Scope | Purpose |
| --- | --- | --- |
| Markdown file paths | All markdown notes in the vault, minus folders/tags excluded in plugin settings | Build the note graph, centrality metrics, connectivity charts, and calendar activity |
| Note metadata (links, tags, frontmatter) | Same scope as paths | Resolve wikilinks and apply tag/folder exclusions without reading full note bodies for graph features |
| Note body text | Only notes selected for AI analysis, calendar word counts, or graph tooltips on hover | Semantic vault analysis, activity metrics, and preview snippets |
| Plugin data files | `.obsidian/plugins/knowledge-graph-analysis/` only | Cached AI responses and analysis JSON |

The plugin enumerates markdown files through Obsidian’s `vault.getMarkdownFiles()` API once per operation via a centralized helper, then filters paths using user-configured `excludeFolders` and `excludeTags`.

## Network activity

| Host | Direction | Purpose |
| --- | --- | --- |
| `generativelanguage.googleapis.com` | Outbound (HTTPS) | Google Gemini API calls when Gemini is the selected AI provider and the user runs an AI analysis (user's API key) |
| `bedrock-runtime.<region>.amazonaws.com` | Outbound (HTTPS) | Amazon Bedrock Converse calls when Bedrock is the selected AI provider and the user runs an AI analysis (SigV4, temporary credentials from the user's AWS CLI profile) |

With Bedrock selected, the plugin also runs the local AWS CLI to obtain credentials (see Permissions). Any AWS STS or IAM Identity Center calls needed to resolve the profile are made by the CLI process, not by the plugin.

No analytics or telemetry endpoints are used.

## Permissions

| Capability | Used | Notes |
| --- | --- | --- |
| Read vault markdown | Yes | Required for graph and analysis features |
| Write plugin data | Yes | Analysis caches via `Plugin.loadData` / `saveData` (Obsidian-managed `data.json`) |
| Execute local processes | Bedrock provider only | `child_process.execFile` (no shell) of the user-configured AWS CLI path with fixed arguments: `configure export-credentials --profile <profile> --format process`. Output is parsed in memory and never written to disk or included in error messages. |
| Modify notes | On explicit user action only | Recommended Actions → **Add to Main Graph** appends a `## Related Notes` section of `[[links]]` to the chosen notes via `vault.process` |
| Arbitrary filesystem access | No | No Node `fs` or `vault.adapter` in shipped `main.js`; legacy JSON under `.obsidian/plugins/.../responses/` is imported once via `vault.read` if present |

## Third-party code

- Rust graph algorithms compiled to WebAssembly (`graph-analysis-wasm`), embedded in `main.js` at build time
- D3 and other npm dependencies bundled into `main.js`
- Optional Gemini AI uses a thin REST client ([`src/services/GeminiRestClient.ts`](src/services/GeminiRestClient.ts)) with Obsidian `requestUrl` only (no `@google/genai` in the release bundle)
- Optional Bedrock AI uses a thin REST client ([`src/services/BedrockRestClient.ts`](src/services/BedrockRestClient.ts)) with Obsidian `requestUrl` only. Requests are signed with `@smithy/signature-v4` and `@aws-crypto/sha256-js` (no AWS SDK client in the release bundle)

Run `npm run audit:prod` locally before tagging a release.
