import { Notice } from 'obsidian';
import { t } from '../i18n';
import { AwsAuthError } from '../services/AwsCliCredentials';
import { getAwsAuthMessage } from './GeminiErrorUtils';

export interface AwsAuthNoticeOptions {
    /** Extra line under the message, e.g. how much of a run was saved */
    detail?: string;
    /**
     * Shows a Retry button. Should check credentials and throw AwsAuthError if they still fail;
     * the notice stays open and reports that. On success the notice closes.
     */
    onRetry?: () => Promise<void>;
}

/**
 * Sticky notice for an AWS credential failure: says what broke, offers to copy the fix command,
 * and optionally retries in place. Stays until dismissed so it isn't missed after a long run.
 */
export function showAwsAuthNotice(error: AwsAuthError, options: AwsAuthNoticeOptions = {}): Notice {
    let notice: Notice | undefined;
    const fragment = createFragment(frag => {
        const messageEl = frag.createDiv({ text: getAwsAuthMessage(error) });
        if (options.detail) {
            frag.createDiv({ text: options.detail });
        }
        const statusEl = frag.createDiv();

        const actions = frag.createDiv({ cls: 'graph-analysis-notice-actions' });
        let command = error.fixCommand;
        const copyButton = actions.createEl('button', { text: t('notices.copyCommand') });
        copyButton.toggle(!!command);
        copyButton.addEventListener('click', (event) => {
            // Clicking a notice dismisses it; keep it open so the user can log in, then retry
            event.stopPropagation();
            if (!command) return;
            void navigator.clipboard.writeText(command).then(() => {
                copyButton.setText(t('notices.commandCopied'));
            });
        });

        const onRetry = options.onRetry;
        if (onRetry) {
            const retryButton = actions.createEl('button', { text: t('notices.retry'), cls: 'mod-cta' });
            retryButton.addEventListener('click', (event) => {
                event.stopPropagation();
                if (retryButton.disabled) return;
                retryButton.disabled = true;
                retryButton.setText(t('notices.checkingCredentials'));
                statusEl.setText('');
                void onRetry().then(
                    () => notice?.hide(),
                    (retryError: unknown) => {
                        retryButton.disabled = false;
                        retryButton.setText(t('notices.retry'));
                        if (retryError instanceof AwsAuthError) {
                            // The reason can change (e.g. logged in to the wrong profile), so refresh the text
                            messageEl.setText(getAwsAuthMessage(retryError));
                            command = retryError.fixCommand;
                            copyButton.toggle(!!command);
                            copyButton.setText(t('notices.copyCommand'));
                            statusEl.setText(t('notices.stillFailing', { time: new Date().toLocaleTimeString() }));
                        } else {
                            statusEl.setText(retryError instanceof Error ? retryError.message : String(retryError));
                        }
                    }
                );
            });
        }
        actions.toggle(!!command || !!onRetry);
    });
    notice = new Notice(fragment, 0);
    return notice;
}
