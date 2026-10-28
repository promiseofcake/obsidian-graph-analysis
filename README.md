# Knowledge Graph Analysis

> **Fork notice:** this is a fork of [luolanaaTUD/obsidian-graph-analysis](https://github.com/luolanaaTUD/obsidian-graph-analysis) by wluo, maintained by Lucas Kacher. It adds **AWS Bedrock** as an optional AI provider (see [Using AWS Bedrock](#using-aws-bedrock)) and fixes several cache bugs: settings saves overwriting cached analyses, duplicate results on incremental runs, and concurrent `data.json` writes clobbering each other. Google Gemini remains the default provider. To install this fork rather than the original, see [Installing this fork](#installing-this-fork).

Turns your [Obsidian](https://obsidian.md) vault into a knowledge graph, computes real graph-theory metrics locally (degree, betweenness, closeness, eigenvector centrality), and feeds those metrics to AI (Google Gemini or AWS Bedrock) to produce semantic analysis, structural analysis, evolution tracking, and one-click actionable suggestions.

Open the plugin by clicking the plugin icon <img src="docs/images/waypoints-icon.svg" alt="network icon" width="20" height="20" style="vertical-align: middle" /> in the left ribbon.

  
![Knowledge Graph Analysis demo](docs/images/plugin-demo.gif)

---

## Why This Plugin Exists

AI has made it dramatically faster to _acquire_ knowledge — reading, summarizing, and searching are no longer bottlenecks. But acquisition was never the hard part. The step that can't be skipped is **internalization**: turning a large, fast-growing pile of notes into an actual structure you understand and can act on.

That step gets harder, not easier, as input volume grows. A vault of a few dozen notes can be understood by skimming. A vault of a few thousand notes, growing daily, cannot — no amount of reading speed fixes that, because the bottleneck isn't reading, it's seeing the shape of the whole.

This plugin's premise: **making sense of a large, fast-growing vault requires graph structure and AI working together, not either one alone.**

- Graph algorithms (centrality, betweenness, closeness) tell you the _objective shape_ of your vault — which notes are hubs, which are bridges, where the structure is thin. This is reproducible and doesn't hallucinate.
- AI alone, reading note text, can summarize content but can't tell you which notes hold your thinking together or where the structural gaps are — it has no view of the whole network.
- Combined: the graph gives AI _quantitative, structural context_ instead of raw text, so the output is grounded in your vault's actual topology, not just keyword similarity.

**Pipeline: graph metrics (local WASM) → structured context → AI reasoning → concrete actions.**

---

## Who This Is For

**Good fit:**
- Vaults large enough (hundreds of notes+) that manual browsing no longer reveals the overall structure
- Users who want to know _which notes are structurally load-bearing_ (hubs/bridges), not just which notes are topically related
- Users with either a Google Gemini API key, or AWS access to Amazon Bedrock through an AWS CLI profile

**Not a fit:**
- Small vaults (a few dozen notes) — manual review is faster and the graph adds little
- Users who need zero cloud AI calls under any circumstance — local graph visualization still works without an API key, but AI analysis features do not
- Mobile users — **desktop only**, no mobile support

---

## Features

- **Interactive Graph View** — Force-directed visualization with centrality-based node sizing, color coding, and hover details
- **Four-Tab Vault Analysis** — Semantic Analysis, Knowledge Structure, Knowledge Evolution, and Recommended Actions
- **Suggested Connections** — AI-identified links you can add to your vault in one click
- **Priority Review Cards** — Surface hubs, bridges, and authorities that need attention
- **Exclusion Rules** — Filter out folders and tags; the graph refreshes automatically


### Interactive Graph View

The graph renders your vault as a network — notes are nodes, links are edges. Node size reflects degree centrality (more connections → larger node), and color can encode betweenness, closeness, or eigenvector centrality.

- **Settings panel** (top-left): Toggle node labels, connection arrows, and color strip
- **Hover**: Highlights adjacent connections and shows centrality scores
- **Drag**: Reposition nodes; the force layout updates in real time

<img src="docs/images/graph-view.png" alt="Graph View" width="800" loading="lazy" />

### Vault Analysis
  
Open the command palette (Cmd/Ctrl+P) and run **Generate AI analysis for entire vault** to analyze notes, or **View vault analysis results** to open the Vault Analysis window. The plugin computes graph metrics locally in WASM, then runs AI analysis with your configured provider (Google Gemini or AWS Bedrock). Results are organized into four tabs. Semantic Analysis produces the base data, and the other three tabs build on it independently: open a tab and click **Generate analysis**. Only one analysis runs at a time, so wait for one tab to finish before starting the next.

#### Semantic Analysis

The foundation layer. Notes are sent to the AI in batches of 30 (the text of each note, frontmatter removed, truncated to 8,000 characters). For each note it produces:

<img src="docs/images/semantic-analysis.png" alt="Semantic Analysis" width="800" loading="lazy" />

- **Summary** — Two to three sentences on the note's main concept or purpose
- **Keywords** — 3–6 key terms
- **Knowledge Domains** — Codes from the plugin's built-in knowledge taxonomy (67 subdivisions across technology, science, business, and other fields)

Notes under 50 characters are skipped without an AI call. Results are searchable, paginated, and update incrementally — only changed or new notes are re-analyzed.

#### Knowledge Structure

Reveals how your knowledge is organized by combining domain analysis with graph topology.

<img src="docs/images/knowledge-structure.png" alt="Knowledge Structure" width="800" loading="lazy" />


- **Domain Distribution** — Sunburst chart of knowledge domains across your vault
- **Network Analysis** — KDE centrality distributions plus AI-identified Knowledge Bridges (high betweenness), Foundations (high closeness), and Authorities (high eigenvector)
- **Knowledge Gaps** — Areas the AI identifies as underdeveloped based on graph structure and domain coverage

#### Knowledge Evolution

Tracks how your vault grows and shifts over time.

<img src="docs/images/knowledge-evolution.png" alt="Knowledge Evolution" width="800" loading="lazy" />

- **Development Timeline** — Calendar heatmap of note creation with AI-generated phases and narrative
- **Topic Introduction Patterns** — When new topics and domains first appeared
- **Focus Shift Analysis** — Compares recent activity against historical patterns to surface notable shifts

#### Recommended Actions

Turns analysis into concrete next steps.

The Structure, Evolution and Actions tabs each make one AI call that sends note summaries and metadata (titles, paths, keywords, domains, dates, graph metrics), not full note text. If a tab's generation fails, the error is saved and shown in that tab the next time you open it.

<img src="docs/images/recommended-actions.png" alt="Recommended Actions" width="800" loading="lazy" />

- **Network Metrics** — Scatter plots of Inbound vs Outbound links and Betweenness vs Eigenvector centrality
- **Notes Needing Review** — Priority cards (high / medium / low) for hubs, bridges, and authorities that may be stale or under-connected
- **Suggested Connections** — An interactive sub-graph of notes the AI recommends linking. Remove unwanted suggestions, then click **Add to Main Graph** to write `[[links]]` directly into your notes


### Settings

Under Obsidian settings → **Knowledge Graph Analysis**:

| Setting | Description |
|---|---|
| **Exclude Folders** | Comma-separated paths (e.g. `Archive, daily-notes`). Real-time stats show excluded vs included counts. |
| **Exclude Tags** | Comma-separated tags without `#` (e.g. `private, draft`). |
| **AI provider** | **Google Gemini (API key)** (default) or **AWS Bedrock (AWS CLI profile)**. Only the selected provider's fields are shown. |
| **Gemini API key** | Gemini only. Visit [Google AI Studio](https://aistudio.google.com/) to create a key. |
| **AWS profile** | Bedrock only. A profile name from `~/.aws/config`. |
| **AWS region** | Bedrock only. Region of the Bedrock runtime endpoint (default `us-east-1`). |
| **Model or inference profile ID** | Bedrock only. A model ID, inference profile ID, or inference profile ARN (e.g. `us.anthropic.claude-sonnet-5-5`). |
| **AWS CLI path** | Bedrock only. Absolute path to the `aws` binary (default `/usr/local/bin/aws`). |
| **UI language / AI response language** | Language for plugin labels and for AI-generated text. |
| **Visualization** | Graph appearance options in the graph view settings panel. |

---

## Using AWS Bedrock

Bedrock support lets the AI features run on models in your own AWS account instead of Google's API. The plugin never stores AWS keys. It gets short-lived credentials from the AWS CLI and keeps them in memory only.

### Prerequisites

- **AWS CLI v2** installed, with `aws configure export-credentials` available (any recent v2).
- **An AWS CLI profile** that resolves to credentials allowed to call `bedrock:InvokeModel` on the model or inference profile you'll use. Any profile type works: IAM Identity Center (SSO), `role_arn` + `source_profile`, or `credential_process`. The CLI does the role assumption; the plugin only reads the result.
- **Model access enabled** for that model in the account and region.
- **A model that supports Converse structured output** (JSON schema). Tested with `us.anthropic.claude-sonnet-5-5`; other Claude models with structured output should work but haven't been tested.

### Setup

1. Check that the profile works and can call the model, outside Obsidian:
   ```bash
   aws sso login --profile <profile>            # SSO profiles only
   aws sts get-caller-identity --profile <profile>
   aws bedrock-runtime converse --profile <profile> --region <region> \
     --model-id <model-id> \
     --messages '[{"role":"user","content":[{"text":"say hi"}]}]'
   ```
   If the last command fails, fix that first. The plugin will fail the same way.
2. In Obsidian, open **Settings → Knowledge Graph Analysis**, set **AI provider** to **AWS Bedrock (AWS CLI profile)**, and fill in the AWS profile, region, and model or inference profile ID.
3. Set **AWS CLI path** to the output of `which aws`. Obsidian launched from the Dock doesn't inherit your shell `PATH`, so this must be an absolute path.
4. Run **Generate AI analysis for entire vault** from the command palette.

### How it works

- **Credentials:** before calling Bedrock, the plugin runs `aws configure export-credentials --profile <profile> --format process`, caches the temporary credentials in memory, and refreshes them 5 minutes before they expire. Nothing is written to disk.
- **Inference:** each request is a SigV4-signed `POST` to `https://bedrock-runtime.<region>.amazonaws.com/model/<model-id>/converse`, sent through Obsidian's `requestUrl`. Structured output uses Converse's native JSON schema output. Because of Bedrock's schema limits, every field is required, and the number of results per batch isn't enforced by the schema.
- **Scheduling:** vault analysis runs 3 batches of 30 notes at a time, with no pause between batches (Gemini runs one at a time with a 6s pause). Throttling and transient server errors are retried with exponential backoff, up to 5 attempts. Daily-quota and request errors are not retried.
- **Parameters:** `temperature` and `topP` are not sent, because newer Claude models reject them. Output is capped at 16,384 tokens or more per request.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| "AWS credentials for profile … unavailable" | The SSO session expired: run `aws sso login --profile <profile>`. Or the profile name or AWS CLI path is wrong. |
| `403` / `AccessDenied` | The role can't invoke that model or inference profile, or model access isn't enabled. The `converse` check in step 1 fails the same way. |
| `400 The provided model identifier is invalid` | Wrong model ID for that region; use an inference profile ID such as `us.anthropic.claude-…`. |
| `400 … not supported for this model` | The model doesn't support Converse structured output. |
| "Bedrock response truncated at the output token limit" | A batch produced more output than the limit allows. |

Bedrock errors include the HTTP status, AWS request ID, stop reason and output size, never your note content. Failed batches are listed in the plugin's data and retried on the next run. Failed tab analyses show the error in the tab.

---

## Pricing

|Item|Cost|
|---|---|
|Plugin itself|Free, open source (MIT License)|
|Google Gemini API|Requires your own key from [Google AI Studio](https://aistudio.google.com/)|
|Gemini free tier|250K TPM, 500 requests/day per official docs — generally sufficient for summaries, keywords, and domain extraction|
|Beyond free tier|Billed at Google's standard Gemini rates; see [Google AI pricing](https://ai.google.dev/pricing) (subject to change)|
|AWS Bedrock|Billed to your AWS account at Bedrock's rates for the model you choose; see [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/). No free tier.|

Token use, for scale: a full first pass over a 92-note vault on Claude Sonnet 5.5 used about 78K tokens, mostly input. Each of the Structure, Evolution and Actions tabs is one more call of roughly 9–17K tokens. Incremental runs only send changed or new notes.

---

## Compatibility & Installation

|Item|Detail|
|---|---|
|Obsidian version|1.7.2+|
|Platforms|Desktop only (Windows / macOS / Linux) — **no mobile support**|
|Original plugin|Settings → Community plugins → search "Knowledge Graph Analysis". This installs the **upstream** plugin, without Bedrock support.|
|This fork|See [Installing this fork](#installing-this-fork)|
|Prerequisite for AI features|A Gemini API key, or an AWS CLI profile with Bedrock access; neither is needed for local graph visualization|

### Installing this fork

This fork uses the same plugin ID as the original (`knowledge-graph-analysis`), so it installs into the same folder, `<vault>/.obsidian/plugins/knowledge-graph-analysis/`, and **replaces** the original if you have it installed. Your settings and cached analyses (`data.json` in that folder) are kept. If the original later publishes a higher version number than this fork's, Obsidian's community plugin updater will offer it, and accepting it replaces this fork with the upstream version.

**Option 1: from GitHub with BRAT (auto-updates).** [BRAT](https://github.com/TfTHacker/obsidian42-brat) is a community plugin that installs and updates plugins straight from a GitHub repository's releases.

1. Install and enable **BRAT** from Settings → Community plugins.
2. In BRAT's settings, choose **Add beta plugin** and enter `promiseofcake/obsidian-graph-analysis`.
3. Enable **Knowledge Graph Analysis** under Settings → Community plugins.

BRAT checks the repo for new releases and updates the plugin. It needs a published GitHub release; see [Releasing](#releasing).

**Option 2: from a GitHub release, by hand.**

1. From the [latest release](https://github.com/promiseofcake/obsidian-graph-analysis/releases), download `main.js`, `manifest.json`, and `styles.css`.
2. Put them in `<vault>/.obsidian/plugins/knowledge-graph-analysis/` (create the folder if needed).
3. Reload Obsidian, then enable **Knowledge Graph Analysis** under Settings → Community plugins.

**Option 3: from source.** Build it (see [Build](#build)), then copy the build into your vault:

```bash
OBSIDIAN_VAULT_PATH="/path/to/your/vault" npm run copy-to-vault
```

Reload the plugin afterwards (toggle it off and on under Community plugins, or restart Obsidian).

---
## Privacy & Network

The plugin makes no network calls on load. Requests only fire when **you** trigger Vault Analysis or a tab's AI action.

|Scenario|What leaves your device|
|---|---|
|Vault Analysis with **Gemini**|Note text (up to 8,000 characters per note) and prompts, sent to Google Gemini (`generativelanguage.googleapis.com`) with **your own** API key|
|Vault Analysis with **Bedrock**|Note text and prompts, sent to Amazon Bedrock (`bedrock-runtime.<region>.amazonaws.com`) in **your own** AWS account, signed with temporary credentials from your AWS CLI profile|
|Structure / Evolution / Actions tabs|Note summaries and metadata (titles, paths, keywords, domains, dates, graph metrics) to the selected provider; not full note text|
|Bedrock credentials|The plugin runs the `aws` CLI locally. Any calls to AWS STS or IAM Identity Center are made by the CLI, not the plugin. Credentials stay in memory and are never written to disk.|
|Graph view / WASM metrics|Fully local — never leaves your device|

No plugin-owned backend server. All caches (semantic results, derived charts, tab analyses, recorded errors) live in Obsidian's local plugin data (`data.json` in the plugin folder). If your vault is synced to git or another service, that file goes with it, including AI summaries of your notes and, for Gemini, your API key.

AI requests go through Obsidian's own `requestUrl` API, with no bundled Google or AWS SDK. Bedrock requests are signed with [`@smithy/signature-v4`](https://www.npmjs.com/package/@smithy/signature-v4).

---

## Performance

|Operation|Benchmark|
|---|---|
|Graph metrics computation (degree, betweenness, closeness, eigenvector centrality)|**~60ms for a 1,000-note vault**, computed locally via Rust → WASM|
|AI semantic analysis, Gemini (first run, full vault)|Bound by Gemini's free-tier daily request cap (500/day) rather than by graph computation — large vaults may need multiple days for a full first pass, or a paid tier|
|AI semantic analysis, Bedrock|Three 30-note batches run in parallel in about 30s on Claude Sonnet 5.5, so a 92-note vault takes about a minute. Limited by your account's Bedrock quotas, not a daily cap.|
|AI semantic analysis (subsequent runs)|Incremental — only changed/new notes are re-analyzed, so ongoing use is much lighter than the first pass|
|Structure / Evolution / Actions tabs|One AI call each; about 30–75s per tab on Claude Sonnet 5.5 for a 92-note vault|

(Note: the 60ms figure is an official benchmark measured at 1,000 notes. Performance at 5,000+ or 10,000+ notes has not been benchmarked — any expectation of similar speed at that scale is an inference, not a reported fact. Test on a subset before running full analysis on a very large vault.)

## Technical Details

- **Rust → WebAssembly**: Graph algorithms (degree, betweenness, closeness, eigenvector centrality, force-directed layout) run in Rust compiled to WASM via [rustworkx](https://github.com/rustworkx/rustworkx), delivering native-speed computation in the browser
- **Google Gemini** (default provider): `gemini-3.1-flash-lite-preview` for per-note analysis and `gemini-3-flash-preview` for the tab analyses. Structured JSON output with temperature 0.3 — 250K TPM, 500 requests/day on the free tier, sufficient for summaries, keywords, and domain extraction. Responses match each note's language.
- **AWS Bedrock** (optional provider): any model you configure that supports Converse structured output; tested with Claude Sonnet 5.5. The same model is used for per-note and tab analyses. Credentials come from the AWS CLI; requests are SigV4-signed and sent via `requestUrl`. See [Using AWS Bedrock](#using-aws-bedrock).
- **Plugin data**: settings and all caches share one `data.json`. Writes are serialized, so a background save can't overwrite a newer one.

  

## Build
  
**Prerequisites:** Node.js, npm, Rust (with the `wasm32-unknown-unknown` target), and [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).

On macOS with Homebrew:

```bash
brew install rustup wasm-pack
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"   # rustup is keg-only
rustup default stable
rustup target add wasm32-unknown-unknown
```
  

```bash
git clone https://github.com/promiseofcake/obsidian-graph-analysis.git
cd obsidian-graph-analysis
npm install
npm run build
```
  
`npm run build` runs three steps in order:

1. **typecheck** — TypeScript type checking
2. **build-wasm** — Compiles the Rust graph library to WebAssembly via `wasm-pack build --target web`
3. **build:ts** — Bundles the plugin with esbuild, outputs to `dist/`, and embeds the WASM binary in `main.js`

To install into a vault, run `OBSIDIAN_VAULT_PATH="/path/to/your/vault" npm run copy-to-vault`, or copy `dist/main.js`, `dist/styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/knowledge-graph-analysis/`.

### Releasing

Pushing a version tag (e.g. `0.7.0`, no `v` prefix) runs `.github/workflows/release.yml`. It builds the plugin and creates a **draft** GitHub release with `main.js`, `manifest.json`, and `styles.css`. Publish the draft on GitHub to make it available for manual download and to BRAT.

```bash
npm version <patch|minor|major>   # bumps package.json, manifest.json, versions.json and commits
git push origin main --follow-tags
```

### Lint (Obsidian community guidelines)
  
This project uses [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin). Before submitting to the community plugin directory:

```bash
npm run lint:submission # errors only (recommended before release)
npm run lint # full report including UI sentence-case warnings
npm run lint:fix # auto-fix where supported
```

  ---

## Contributing

Contributions are welcome. Open issues or pull requests on [github.com/promiseofcake/obsidian-graph-analysis](https://github.com/promiseofcake/obsidian-graph-analysis). Changes that apply to the original plugin can also go upstream to [luolanaaTUD/obsidian-graph-analysis](https://github.com/luolanaaTUD/obsidian-graph-analysis).

  

## License

MIT — see the [LICENSE](LICENSE) file for details.
  

## Acknowledgments

- The [Obsidian](https://obsidian.md) team for the knowledge management platform
- The [rustworkx](https://github.com/rustworkx/rustworkx) team for the graph processing library
- The Rust and WebAssembly communities