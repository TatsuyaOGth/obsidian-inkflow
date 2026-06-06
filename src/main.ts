import { MarkdownView, Notice, Plugin } from 'obsidian';
import { ContextCollector } from './ContextCollector';
import { InkflowError, OllamaClient } from './OllamaClient';
import { InkflowSettingTab } from './SettingsTab';
import { InkflowSuggestionView } from './SuggestionPanel';
import { DEFAULT_SETTINGS, InkflowSettings, VIEW_TYPE_INKFLOW } from './types';

const ERROR_MESSAGES: Record<InkflowError['kind'], string> = {
	connection: 'Ollamaに接続できません。起動しているか確認してください。',
	parse: 'レスポンスのパースに失敗しました。',
	timeout: 'リクエストがタイムアウトしました。',
};

export default class InkflowPlugin extends Plugin {
	settings!: InkflowSettings;

	private ollamaClient!: OllamaClient;
	private contextCollector!: ContextCollector;
	private generationTimer: number | null = null;
	private requestGeneration = 0;

	async onload() {
		await this.loadSettings();

		this.ollamaClient = new OllamaClient(() => this.settings);
		this.contextCollector = new ContextCollector(this.app, () => this.settings);

		this.registerView(
			VIEW_TYPE_INKFLOW,
			(leaf) =>
				new InkflowSuggestionView(leaf, {
					onInsert: (text) => this.insertSuggestion(text),
					onToggle: (enabled) => this.setEnabled(enabled),
					getEnabled: () => this.settings.enabled,
					getShowInsertButton: () => this.settings.showInsertButton,
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

		this.addSettingTab(new InkflowSettingTab(this.app, this));

		if (this.settings.enabled) {
			this.startGenerationLoop();
		}
	}

	onunload() {
		this.stopGeneration();
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

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_INKFLOW)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) {
				return;
			}
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_INKFLOW, active: true });
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

	private setEnabled(enabled: boolean): void {
		this.settings.enabled = enabled;
		void this.saveSettings();
		this.getView()?.setEnabled(enabled);
		if (enabled) {
			this.getView()?.clearEntries();
			this.startGenerationLoop();
		} else {
			this.stopGeneration();
		}
	}

	private startGenerationLoop(): void {
		void this.generationCycle(++this.requestGeneration);
	}

	private stopGeneration(): void {
		if (this.generationTimer !== null) {
			window.clearTimeout(this.generationTimer);
			this.generationTimer = null;
		}
		this.requestGeneration++;
	}

	private async generationCycle(generation: number): Promise<void> {
		if (!this.settings.enabled) return;

		const view = this.getView();
		if (!view) return;

		const markdownView = this.getTargetMarkdownView();
		const editor = markdownView?.editor;
		if (!editor) return;

		const entryId = view.appendLoading(this.settings.maxEntries);

		try {
			const { prefix, frontmatter } = this.contextCollector.collect(
				editor,
				markdownView.file,
			);
			const suggestions = await this.ollamaClient.fetchSuggestions(
				prefix,
				frontmatter,
			);
			if (generation !== this.requestGeneration) return;
			view.resolveEntry(entryId, { suggestions });
		} catch (error) {
			if (generation !== this.requestGeneration) return;
			view.resolveEntry(entryId, { error: this.toErrorMessage(error) });
			// Stop the loop on error; user must toggle off/on to retry.
			return;
		}

		if (generation !== this.requestGeneration || !this.settings.enabled) return;

		this.generationTimer = window.setTimeout(() => {
			this.generationTimer = null;
			void this.generationCycle(++this.requestGeneration);
		}, this.settings.intervalSeconds * 1000);
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
