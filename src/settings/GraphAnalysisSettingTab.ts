import { App, PluginSettingTab, Setting, Modal } from 'obsidian';
import GraphAnalysisPlugin from '../main';
import { t } from '../i18n';
import type { AiProvider, AiResponseLanguage, UiLanguage } from '../types/types';
import { configureI18n } from '../i18n';
import { BEDROCK_TUNING, BEDROCK_TUNING_DEFAULTS, parseTuningValue, resolveTuningValue } from '../services/BedrockTuning';

export class GraphAnalysisSettingTab extends PluginSettingTab {
    plugin: GraphAnalysisPlugin;
    private exclusionStatsEl: HTMLElement | null = null;

    constructor(app: App, plugin: GraphAnalysisPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('graph-analysis-settings');

        new Setting(containerEl).setName(t('settings.excludeHeading')).setHeading();
        const exclusionContainer = containerEl.createDiv({ cls: 'graph-settings-section-container' });

        new Setting(exclusionContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.excludeFolders.name'))
            .setDesc(t('settings.excludeFolders.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.excludeFolders.placeholder'))
                .setValue(this.plugin.settings.excludeFolders.join(','))
                .onChange(async (value) => {
                    this.plugin.settings.excludeFolders = value.split(',').map(s => s.trim()).filter(s => s);
                    await this.plugin.saveSettings();
                    this.updateExclusionStats();
                }));

        new Setting(exclusionContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.excludeTags.name'))
            .setDesc(t('settings.excludeTags.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.excludeTags.placeholder'))
                .setValue(this.plugin.settings.excludeTags.join(','))
                .onChange(async (value) => {
                    this.plugin.settings.excludeTags = value.split(',').map(s => s.trim()).filter(s => s);
                    await this.plugin.saveSettings();
                    this.updateExclusionStats();
                }));

        this.createExclusionStatsSection(exclusionContainer);

        new Setting(containerEl).setName(t('settings.llmHeading')).setHeading();
        const apiContainer = containerEl.createDiv({ cls: 'graph-settings-section-container' });

        new Setting(apiContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.aiProvider.name'))
            .setDesc(t('settings.aiProvider.desc'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('gemini', t('settings.aiProvider.gemini'))
                    .addOption('bedrock', t('settings.aiProvider.bedrock'))
                    .setValue(this.plugin.settings.aiProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.aiProvider = value as AiProvider;
                        await this.plugin.saveSettings();
                        this.display();
                    });
                return dropdown;
            });

        if (this.plugin.settings.aiProvider === 'bedrock') {
            this.createBedrockSettings(apiContainer);
        } else {
            this.createGeminiSettings(apiContainer);
        }

        new Setting(containerEl).setName(t('settings.languageHeading')).setHeading();
        this.createLanguageSettings(containerEl);
    }

    private createGeminiSettings(apiContainer: HTMLElement): void {
        let apiKeyTextComponent: { inputEl: HTMLInputElement };
        new Setting(apiContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.geminiApiKey.name'))
            .setDesc((() => {
                const doc = this.containerEl.ownerDocument;
                const frag = doc.createDocumentFragment();
                frag.append(doc.createTextNode(t('settings.geminiApiKey.descPrefix')));
                const link = doc.createElement('a');
                link.textContent = t('settings.geminiApiKey.getKeyLink');
                link.href = 'https://aistudio.google.com/apikey';
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener');
                frag.append(link);
                return frag;
            })())
            .addText(text => {
                text.setPlaceholder(t('settings.geminiApiKey.placeholder'))
                    .setValue(this.plugin.settings.geminiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiApiKey = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
                apiKeyTextComponent = text;
                return text;
            })
            .addExtraButton(btn => {
                btn.setIcon('eye')
                    .setTooltip(t('settings.geminiApiKey.showTooltip'))
                    .onClick(() => {
                        const input = apiKeyTextComponent.inputEl;
                        const isVisible = input.type === 'text';
                        input.type = isVisible ? 'password' : 'text';
                        btn.setIcon(isVisible ? 'eye' : 'eye-off');
                        btn.setTooltip(isVisible ? t('settings.geminiApiKey.showTooltip') : t('settings.geminiApiKey.hideTooltip'));
                    });
                return btn;
            });

        this.createNetworkDisclosure(apiContainer, t('settings.networkDisclosure.desc'));
    }

    private createBedrockSettings(apiContainer: HTMLElement): void {
        const fields: Array<{ key: 'bedrockAwsProfile' | 'bedrockRegion' | 'bedrockModelId' | 'awsCliPath'; i18n: string }> = [
            { key: 'bedrockAwsProfile', i18n: 'awsProfile' },
            { key: 'bedrockRegion', i18n: 'region' },
            { key: 'bedrockModelId', i18n: 'modelId' },
            { key: 'awsCliPath', i18n: 'cliPath' }
        ];
        for (const field of fields) {
            new Setting(apiContainer)
                .setClass('graph-settings-item')
                .setName(t(`settings.bedrock.${field.i18n}.name`))
                .setDesc(t(`settings.bedrock.${field.i18n}.desc`))
                .addText(text => text
                    .setPlaceholder(t(`settings.bedrock.${field.i18n}.placeholder`))
                    .setValue(this.plugin.settings[field.key])
                    .onChange(async (value) => {
                        this.plugin.settings[field.key] = value.trim();
                        await this.plugin.saveSettings();
                    }));
        }

        this.createBedrockTuningSettings(apiContainer);
        this.createNetworkDisclosure(apiContainer, t('settings.bedrock.networkDisclosure'));
    }

    /** Batching and retry knobs; invalid input is flagged and not saved. */
    private createBedrockTuningSettings(apiContainer: HTMLElement): void {
        new Setting(apiContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.bedrock.tuning.heading'))
            .setDesc(t('settings.bedrock.tuning.desc'))
            .addButton(button => button
                .setButtonText(t('settings.bedrock.tuning.reset'))
                .onClick(async () => {
                    Object.assign(this.plugin.settings, BEDROCK_TUNING_DEFAULTS);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        for (const spec of BEDROCK_TUNING) {
            new Setting(apiContainer)
                .setClass('graph-settings-item')
                .setName(t(`settings.bedrock.tuning.${spec.i18n}.name`))
                .setDesc(t(`settings.bedrock.tuning.${spec.i18n}.desc`, {
                    min: spec.min,
                    max: spec.max,
                    default: spec.defaultValue
                }))
                .addText(text => {
                    text.inputEl.type = 'number';
                    text.inputEl.min = String(spec.min);
                    text.inputEl.max = String(spec.max);
                    text.inputEl.step = spec.integer ? '1' : 'any';
                    text.setPlaceholder(String(spec.defaultValue))
                        .setValue(String(resolveTuningValue(spec, this.plugin.settings[spec.key])))
                        .onChange(async (value) => {
                            const parsed = parseTuningValue(spec, value);
                            text.inputEl.toggleClass('graph-settings-invalid', parsed === null);
                            if (parsed === null) return;
                            this.plugin.settings[spec.key] = parsed;
                            await this.plugin.saveSettings();
                        });
                    return text;
                });
        }
    }

    private createNetworkDisclosure(apiContainer: HTMLElement, desc: string): void {
        const networkDisclosureSetting = new Setting(apiContainer)
            .setName(t('settings.networkDisclosure.name'))
            .setDesc(desc);
        networkDisclosureSetting.settingEl.addClasses([
            'graph-settings-item',
            'graph-settings-network-disclosure'
        ]);
    }

    private createLanguageSettings(containerEl: HTMLElement): void {
        const languageContainer = containerEl.createDiv({ cls: 'graph-settings-section-container' });

        new Setting(languageContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.uiLanguage.name'))
            .setDesc(t('settings.uiLanguage.desc'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('auto', t('settings.uiLanguage.obsidian'))
                    .addOption('en', t('settings.uiLanguage.en'))
                    .addOption('zh-Hans', t('settings.uiLanguage.zhHans'))
                    .setValue(this.plugin.settings.uiLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.uiLanguage = value as UiLanguage;
                        configureI18n(this.plugin.settings.uiLanguage);
                        await this.plugin.saveSettings();
                        this.display();
                    });
                return dropdown;
            });

        new Setting(languageContainer)
            .setClass('graph-settings-item')
            .setName(t('settings.aiResponseLanguage.name'))
            .setDesc(t('settings.aiResponseLanguage.desc'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('auto', t('settings.aiResponseLanguage.auto'))
                    .addOption('en', t('settings.aiResponseLanguage.en'))
                    .addOption('zh-Hans', t('settings.aiResponseLanguage.zhHans'))
                    .setValue(this.plugin.settings.aiResponseLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.aiResponseLanguage = value as AiResponseLanguage;
                        await this.plugin.saveSettings();
                    });
                return dropdown;
            });
    }

    private createExclusionStatsSection(containerEl: HTMLElement): void {
        this.exclusionStatsEl = containerEl.createDiv({ cls: 'exclusion-stats' });
        this.updateExclusionStats();
    }

    private updateExclusionStats(): void {
        if (!this.exclusionStatsEl || !this.plugin.exclusionUtils) {
            return;
        }

        this.exclusionStatsEl.empty();

        try {
            const stats = this.plugin.exclusionUtils.getExclusionStats();
            const statsContainer = this.exclusionStatsEl.createDiv({ cls: 'stats-container' });

            const statsText = statsContainer.createDiv({ cls: 'stats-text' });
            const excludedParts: string[] = [];
            if (stats.excludedByFolder > 0) {
                excludedParts.push(t('settings.stats.excludedByFolder', { count: stats.excludedByFolder }));
            }
            if (stats.excludedByTag > 0) {
                excludedParts.push(t('settings.stats.excludedByTag', { count: stats.excludedByTag }));
            }
            const excludedBreakdown = excludedParts.length > 0 ? ` (${excludedParts.join(', ')})` : '';
            statsText.createDiv({
                text: t('settings.stats.excludedTotal', {
                    total: stats.totalExcluded,
                    breakdown: excludedBreakdown
                }),
                cls: 'stat-item excluded-total'
            });
            statsText.createDiv({
                text: t('settings.stats.includedTotal', {
                    included: stats.includedFiles,
                    total: stats.totalFiles
                }),
                cls: 'stat-item included-total'
            });

            if (stats.totalExcluded > 0) {
                const btn = statsContainer.createEl('button', {
                    text: t('settings.stats.showExcluded'),
                    cls: 'mod-cta'
                });
                btn.addEventListener('click', () => this.showExcludedFilesList());
            }
        } catch {
            this.exclusionStatsEl.createDiv({
                text: t('settings.stats.error'),
                cls: 'stat-error'
            });
        }
    }

    private showExcludedFilesList(): void {
        if (!this.plugin.exclusionUtils) return;

        const excludedFiles = this.plugin.exclusionUtils.getExcludedFiles();

        const modal = new ExcludedFilesModal(this.app, excludedFiles);
        modal.open();
    }
}

class ExcludedFilesModal extends Modal {
    private excludedFiles: string[];

    constructor(app: App, excludedFiles: string[]) {
        super(app);
        this.excludedFiles = excludedFiles;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: t('settings.excludedModal.title') });

        if (this.excludedFiles.length === 0) {
            contentEl.createDiv({ text: t('settings.excludedModal.empty') });
            return;
        }

        const fileList = contentEl.createDiv({ cls: 'excluded-files-list' });

        this.excludedFiles.forEach(filePath => {
            const fileItem = fileList.createDiv({ cls: 'excluded-file-item' });
            fileItem.createSpan({ text: filePath });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
