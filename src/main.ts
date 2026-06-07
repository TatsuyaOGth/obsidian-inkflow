import { MarkdownView, Notice, Plugin } from 'obsidian';
import { ContextCollector } from './ContextCollector';
import { IdleDetector } from './IdleDetector';
import { InkflowError, OllamaClient } from './OllamaClient';
import { InkflowSettingTab } from './SettingsTab';
import { InkflowSuggestionView } from './SuggestionPanel';
import {
	DEFAULT_SETTINGS,
	InkflowSettings,
	PanelState,
	VIEW_TYPE_INKFLOW,
} from './types';

const ERROR_MESSAGES: Record<InkflowError['kind'], string> = {
	connection: 'Ollamaに接続できません。起動しているか確認してください。',
	parse: 'レスポンスのパースに失敗しました。',
	timeout: 'リクエストがタイムアウトしました。',
};

export default class InkflowPlugin extends Plugin {
	settings!: InkflowSettings;

	private ollamaClient!: OllamaClient;
	private contextCollector!: ContextCollector;
	private idleDetector!: IdleDetector;
	private requestGeneration = 0;

	async onload() {
		await this.loadSettings();

		this.ollamaClient = new OllamaClient(() => this.settings);
		this.contextCollector = new ContextCollector(
			this.app,
			() => this.settings,
		);
		this.idleDetector = new IdleDetector(
			this.settings.idleSeconds * 1000,
			() => this.onIdle(),
		);
		if (this.settings.enabled) {
			this.idleDetector.start();
		}

		this.registerView(
			VIEW_TYPE_INKFLOW,
			(leaf) =>
				new InkflowSuggestionView(leaf, {
					onInsert: (text) => this.insertSuggestion(text),
					onRegenerate: () => this.regenerate(),
					onToggle: (enabled) => this.setEnabled(enabled),
					getEnabled: () => this.settings.enabled,
				}),
		);

		this.addRibbonIcon('pencil', 'Open suggestion panel', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-panel',
			name: 'Open suggestion panel',
			callback: () => {
				void this.activateView();
			},
		});

		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				// Resuming typing cancels any in-flight request (spec §1): bump
				// the generation so a pending response is discarded on arrival.
				this.requestGeneration++;
				this.idleDetector.notifyActivity();
			}),
		);

		this.addSettingTab(new InkflowSettingTab(this.app, this));
	}

	onunload() {
		this.idleDetector?.stop();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<InkflowSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Re-applies the idle interval when the idleSeconds setting changes.
	applyIdleSeconds() {
		this.idleDetector?.setIdleMs(this.settings.idleSeconds * 1000);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_INKFLOW)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) {
				return;
			}
			leaf = rightLeaf;
			await leaf.setViewState({
				type: VIEW_TYPE_INKFLOW,
				active: true,
			});
		}
		await workspace.revealLeaf(leaf);
	}

	private getView(): InkflowSuggestionView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INKFLOW)[0];
		const view = leaf?.view;
		return view instanceof InkflowSuggestionView ? view : null;
	}

	// Finds the editor to act on. Clicking a button in the side panel makes the
	// panel the active leaf, so getActiveViewOfType returns null; fall back to
	// the most recently used main-area leaf (the note the user was editing).
	private getTargetMarkdownView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) {
			return active;
		}
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view;
		return view instanceof MarkdownView ? view : null;
	}

	private renderPanel(state: PanelState): void {
		this.getView()?.render(state);
	}

	private setEnabled(enabled: boolean): void {
		this.settings.enabled = enabled;
		void this.saveSettings();
		this.getView()?.setEnabled(enabled);
		if (enabled) {
			this.idleDetector.start();
		} else {
			this.idleDetector.stop();
		}
	}

	private onIdle(): void {
		// Only auto-generate when enabled and the panel is open, so we never
		// issue background Ollama requests the user can't see.
		if (!this.settings.enabled || !this.getView()) {
			return;
		}
		void this.runSuggestion(++this.requestGeneration);
	}

	private regenerate(): void {
		void this.runSuggestion(++this.requestGeneration);
	}

	private async runSuggestion(generation: number): Promise<void> {
		const view = this.getTargetMarkdownView();
		const editor = view?.editor;
		if (!editor) {
			return;
		}

		const { prefix, frontmatter, promptOverride } = this.contextCollector.collect(
			editor,
			view.file,
		);
		this.renderPanel({ status: 'loading' });

		try {
			const suggestions = await this.ollamaClient.fetchSuggestions(
				prefix,
				frontmatter,
				promptOverride,
			);
			if (generation === this.requestGeneration) {
				this.renderPanel({ status: 'done', suggestions });
			}
		} catch (error) {
			if (generation !== this.requestGeneration) {
				return;
			}
			this.renderPanel({
				status: 'error',
				error: this.toErrorMessage(error),
			});
		}
	}

	private toErrorMessage(error: unknown): string {
		if (error instanceof InkflowError) {
			return ERROR_MESSAGES[error.kind];
		}
		return 'エラーが発生しました。';
	}

	private insertSuggestion(text: string): void {
		const view = this.getTargetMarkdownView();
		const editor = view?.editor;
		if (!editor) {
			new Notice('挿入先のエディターが見つかりません。');
			return;
		}
		const cursor = editor.getCursor();
		editor.replaceRange(text, cursor);
		// Move the cursor to the end of the inserted text and refocus the editor
		// so the user can keep writing or insert again.
		const lines = text.split('\n');
		const lastLine = lines[lines.length - 1] ?? '';
		const endCursor =
			lines.length === 1
				? { line: cursor.line, ch: cursor.ch + text.length }
				: { line: cursor.line + lines.length - 1, ch: lastLine.length };
		editor.setCursor(endCursor);
		editor.focus();
	}
}
