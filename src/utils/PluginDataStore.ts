import { App, TFile } from 'obsidian';
import type { TabAnalysisData, VaultAnalysisData } from '../ai/MasterAnalysisManager';
import type {
    DerivedVisualizationsData,
    FailedBatchesData,
    PluginCacheData,
    TabAnalysisError
} from '../types/plugin-cache-data';

export interface PluginDataHost {
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
}

const PLUGIN_ID = 'knowledge-graph-analysis';

const LEGACY_PATHS = {
    vaultAnalysis: 'vault-analysis.json',
    failedBatches: 'vault-analysis-failed-batches.json',
    structure: 'structure-analysis.json',
    evolution: 'evolution-analysis.json',
    actions: 'actions-analysis.json',
} as const;

export class PluginDataStore {
    /** Tail of the write chain; every read-modify-write runs after the previous one finishes. */
    private pendingWrite: Promise<void> = Promise.resolve();

    constructor(private readonly host: PluginDataHost) {}

    /**
     * Serialized read-modify-write of data.json. Concurrent setters (e.g. the background
     * derived-visualizations save) would otherwise write back a stale copy and drop other keys.
     * Return false from mutate to skip the write.
     */
    update(mutate: (data: Record<string, unknown>) => boolean | void | Promise<boolean | void>): Promise<void> {
        const run = this.pendingWrite.then(async () => {
            const data = (await this.read()) as Record<string, unknown>;
            if ((await mutate(data)) !== false) {
                await this.write(data as PluginCacheData);
            }
        });
        this.pendingWrite = run.catch(() => undefined);
        return run;
    }

    async read(): Promise<PluginCacheData> {
        const data = await this.host.loadData();
        if (data && typeof data === 'object') {
            return data as PluginCacheData;
        }
        return {};
    }

    async write(data: PluginCacheData): Promise<void> {
        await this.host.saveData(data);
    }

    async getVaultAnalysis(): Promise<VaultAnalysisData | null> {
        const analysis = (await this.read()).vaultAnalysis ?? null;
        if (!analysis?.results) {
            return analysis;
        }
        // Repair caches written by older builds that appended duplicate rows per path (last wins)
        const byPath = new Map(analysis.results.map(r => [r.path, r]));
        if (byPath.size === analysis.results.length) {
            return analysis;
        }
        const results = [...byPath.values()];
        return { ...analysis, results, totalFiles: results.length };
    }

    async setVaultAnalysis(data: VaultAnalysisData): Promise<void> {
        await this.update(cache => { cache.vaultAnalysis = data; });
    }

    async getFailedBatches(): Promise<FailedBatchesData | null> {
        return (await this.read()).failedBatches ?? null;
    }

    async setFailedBatches(data: FailedBatchesData): Promise<void> {
        await this.update(cache => { cache.failedBatches = data; });
    }

    async getTabAnalysis<T extends TabAnalysisData>(tabName: string): Promise<T | null> {
        const tab = (await this.read()).tabAnalyses?.[tabName];
        return (tab as T | undefined) ?? null;
    }

    async setTabAnalysis(tabName: string, data: TabAnalysisData): Promise<void> {
        await this.update(cache => {
            const tabs = (cache.tabAnalyses ?? {}) as Record<string, TabAnalysisData>;
            tabs[tabName] = data;
            cache.tabAnalyses = tabs;
        });
    }

    async getTabAnalysisError(tabName: string): Promise<TabAnalysisError | null> {
        return (await this.read()).tabAnalysisErrors?.[tabName] ?? null;
    }

    async setTabAnalysisError(tabName: string, error: TabAnalysisError): Promise<void> {
        await this.update(cache => {
            const errors = (cache.tabAnalysisErrors ?? {}) as Record<string, TabAnalysisError>;
            errors[tabName] = error;
            cache.tabAnalysisErrors = errors;
        });
    }

    async clearTabAnalysisError(tabName: string): Promise<void> {
        await this.update(cache => {
            const errors = cache.tabAnalysisErrors as Record<string, TabAnalysisError> | undefined;
            if (!errors?.[tabName]) return false;
            delete errors[tabName];
            return true;
        });
    }

    async getDerivedVisualizations(): Promise<DerivedVisualizationsData | null> {
        return (await this.read()).derivedVisualizations ?? null;
    }

    async setDerivedVisualizations(data: DerivedVisualizationsData): Promise<void> {
        await this.update(cache => { cache.derivedVisualizations = data; });
    }

    /**
     * One-time import from legacy per-file cache under .obsidian/plugins/.../responses/
     * using Vault API (getAbstractFileByPath + read), not Node fs or vault.adapter.
     */
    async migrateLegacyCacheFromVaultFiles(app: App): Promise<void> {
        await this.update(data => this.migrateLegacyCache(app, data as PluginCacheData));
    }

    private async migrateLegacyCache(app: App, cache: PluginCacheData): Promise<boolean> {

        const base = `${app.vault.configDir}/plugins/${PLUGIN_ID}/responses`;
        let changed = false;

        if (!cache.vaultAnalysis) {
            const parsed = await this.readLegacyJsonFile(app, `${base}/${LEGACY_PATHS.vaultAnalysis}`);
            if (parsed) {
                cache.vaultAnalysis = parsed as VaultAnalysisData;
                changed = true;
            }
        }

        if (!cache.failedBatches) {
            const parsed = await this.readLegacyJsonFile(app, `${base}/${LEGACY_PATHS.failedBatches}`);
            if (parsed) {
                cache.failedBatches = parsed as FailedBatchesData;
                changed = true;
            }
        }

        if (!cache.tabAnalyses) {
            cache.tabAnalyses = {};
        }

        const tabKeys: Array<{ tab: string; file: string }> = [
            { tab: 'structure', file: LEGACY_PATHS.structure },
            { tab: 'evolution', file: LEGACY_PATHS.evolution },
            { tab: 'actions', file: LEGACY_PATHS.actions },
        ];

        for (const { tab, file } of tabKeys) {
            if (cache.tabAnalyses[tab]) {
                continue;
            }
            const parsed = await this.readLegacyJsonFile(app, `${base}/${file}`);
            if (parsed) {
                cache.tabAnalyses[tab] = parsed as TabAnalysisData;
                changed = true;
            }
        }

        return changed;
    }

    private async readLegacyJsonFile(app: App, vaultPath: string): Promise<unknown> {
        const file = app.vault.getAbstractFileByPath(vaultPath);
        if (!(file instanceof TFile)) {
            return null;
        }
        try {
            return JSON.parse(await app.vault.read(file)) as unknown;
        } catch {
            return null;
        }
    }
}
