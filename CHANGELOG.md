# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0]

First release of the promiseofcake fork.

### Added

- **AWS Bedrock provider (optional)**: choose Gemini or Bedrock in settings. Bedrock credentials come from an AWS CLI profile via `aws configure export-credentials` (assumed-role STS credentials, held in memory only). Inference calls Bedrock Converse directly through `requestUrl`, SigV4-signed, with native JSON-schema structured output.
- **Tab analysis error reporting**: failed Structure, Evolution or Actions runs are saved to `tabAnalysisErrors` and shown in the tab. Bedrock errors include the status, request ID, stop reason and output size, never prompt or note content.

### Changed

- The analysis results record the provider that actually ran, instead of always "Google Gemini".
- Fork attribution: the README fork notice, package/manifest author, and repo links point to `promiseofcake/obsidian-graph-analysis`. The original MIT notice is kept.

### Fixed

- **Settings saves overwrote cached analyses**: `saveSettings` wrote back the `data.json` snapshot from plugin load, wiping tab analyses and restoring stale failed batches.
- **Concurrent `data.json` writes clobbered each other**: all reads and writes are now serialized, so the background visualization save no longer undoes a failed-batch clear.
- **Incremental runs duplicated results**: results merge by path, already-analyzed failed notes aren't re-queued, and existing duplicate caches are deduped on read.
- **Stale failed batches**: the shared "empty" object accumulated entries, and failed batches that had since succeeded were never cleared.

## [0.6.1 – 0.6.7] (upstream)

Upstream left these under "Unreleased", but they shipped in 0.6.x before the fork.

### Removed

- Per-note **AI Summary** status bar button (sun icon), command palette action, and modal — use Obsidian's built-in AI for note summaries instead
- `AISummaryManager`, `note-summary.schema.ts`, and `AIModelService.createNoteSummarySchema()`

## [0.6.0]

### Added

- **Gemini 3.1 Flash Lite** — Semantic analysis now uses `gemini-3.1-flash-lite-preview` with 250K requests/day on the free tier, replacing the previous dual-model setup
- **Language matching** — Strengthened prompt instructs the AI to match each note's language in batch analysis; responses for Chinese notes are in Chinese, English in English, etc.

### Changed

- **Single model for semantic analysis** — Removed dual-model logic (gemini-2.5-flash-lite + gemini-2.5-flash) that alternated between models for quota limits. All semantic analysis now uses a single model
- **Network card UI** — Added 20px padding between outer card and main content in Bridge/Foundation/Authority domain cards
- **Theme-aware centrality palettes** — Default color palettes for betweenness, closeness, and eigenvector now switch automatically between light theme (BuGn, Warm, PuRd) and dark theme (Viridis, Plasma, Viridis) for better node visibility
- **Centrality gradient defaults** — Increased default steps from 6 to 12; palettes re-apply when switching themes


### Fixed

- Bridge/Foundation/Authority section not showing on fix branch due to `this.container.ownerDocument` being undefined when `renderNetworkAnalysis` was called without `renderStructureAnalysis`

### Removed

- `getSemanticModelForBatch` and alternate-model retry logic from VaultSemanticAnalysisManager
- `semanticModelCounter` and alternate-model retry from AISummaryManager

---

## [0.5.8]

*(Previous release — see git history for details)*
