import { MarkdownView, Notice, Plugin } from 'obsidian';
import { ContextCollector } from './ContextCollector';
import { Logger } from './logger';
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
	private isLoopActive = false;
	private activeRequests = 0;

	async onload() {
		await this.loadSettings();

		this.ollamaClient = new OllamaClient(
			() => this.settings,
			new Logger('[Inkflow:OllamaClient]', () => this.settings.debugMode),
		);
		this.contextCollector = new ContextCollector(
			this.app,
			() => this.settings,
			new Logger('[Inkflow:ContextCollector]', () => this.settings.debugMode),
		);

		this.registerView(
			VIEW_TYPE_INKFLOW,
			(leaf) =>
				new InkflowSuggestionView(
					leaf,
					{
						onInsert: (text) => this.insertSuggestion(text),
						onToggleAuto: (value) => this.setAutoGenerate(value),
						onGenerate: () => void this.triggerGeneration(),
						getAutoGenerate: () => this.settings.autoGenerate,
						getShowInsertButton: () => this.settings.showInsertButton,
					},
					new Logger('[Inkflow:SuggestionPanel]', () => this.settings.debugMode),
				),
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

		// No default hotkey; users can assign one in Obsidian's Hotkeys settings.
		this.addCommand({
			id: 'generate-now',
			name: 'Generate suggestions now',
			callback: () => {
				void this.triggerGeneration();
			},
		});

		this.addSettingTab(new InkflowSettingTab(this.app, this));

		// Restart the loop whenever the workspace layout changes (covers the case
		// where Obsidian restores the panel leaf from a previous session on startup).
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (!this.isLoopActive && this.getView()) {
					this.startGenerationLoop();
				}
			}),
		);

		this.startGenerationLoop();
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
		// Restart the loop if it had stopped (e.g. panel was closed); the call
		// is a no-op in manual mode or when the loop is already running.
		this.startGenerationLoop();
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

	private setAutoGenerate(value: boolean): void {
		if (this.settings.autoGenerate === value) return;
		this.settings.autoGenerate = value;
		void this.saveSettings();
		this.applyAutoGenerateSetting();
	}

	private get isGenerating(): boolean {
		return this.activeRequests > 0;
	}

	private startGenerationLoop(): void {
		if (!this.settings.autoGenerate || this.isLoopActive) return;
		this.isLoopActive = true;
		void this.generationCycle(++this.requestGeneration);
	}

	private stopGeneration(): void {
		this.isLoopActive = false;
		if (this.generationTimer !== null) {
			window.clearTimeout(this.generationTimer);
			this.generationTimer = null;
		}
		this.requestGeneration++;
	}

	/** Applies a change to the autoGenerate setting, starting or stopping the loop. */
	private applyAutoGenerateSetting(): void {
		if (this.settings.autoGenerate) {
			if (!this.getView()) return;
			if (this.isGenerating) {
				// A manual generation is in flight; mark the loop active so the
				// running cycle reschedules itself when it completes.
				this.isLoopActive = true;
				return;
			}
			this.startGenerationLoop();
		} else {
			this.stopLoopScheduling();
		}
	}

	// Stops scheduling without bumping requestGeneration, so an in-flight
	// generation may still finish and display its result.
	private stopLoopScheduling(): void {
		this.isLoopActive = false;
		if (this.generationTimer !== null) {
			window.clearTimeout(this.generationTimer);
			this.generationTimer = null;
		}
	}

	private async triggerGeneration(): Promise<void> {
		if (!this.getView()) {
			await this.activateView();
		}
		// In auto mode activateView may have just started a cycle; the request
		// counter is incremented synchronously, so this check prevents a double fire.
		if (this.isGenerating) return;
		// Cancel a pending auto-loop timer so the interval restarts after this run.
		if (this.generationTimer !== null) {
			window.clearTimeout(this.generationTimer);
			this.generationTimer = null;
		}
		void this.generationCycle(++this.requestGeneration);
	}

	// Runs one generation. In auto mode (isLoopActive) it reschedules itself;
	// a manual trigger runs it as a one-shot with isLoopActive === false.
	private async generationCycle(generation: number): Promise<void> {
		const view = this.getView();
		if (!view) {
			// Panel was closed; stop and let activateView/layout-change restart.
			this.isLoopActive = false;
			return;
		}

		const markdownView = this.getTargetMarkdownView();
		const editor = markdownView?.editor;
		if (!editor) {
			if (this.isLoopActive && this.settings.autoGenerate) {
				// No editor open; retry after interval without appending a loading entry.
				this.generationTimer = window.setTimeout(() => {
					this.generationTimer = null;
					void this.generationCycle(generation);
				}, this.settings.intervalSeconds * 1000);
			} else {
				new Notice('対象のエディターが見つかりません。');
			}
			return;
		}

		// Incremented synchronously (before any await) so triggerGeneration's
		// isGenerating guard is race-free.
		this.activeRequests++;
		view.setGenerating(true);

		try {
			const { prefix, frontmatter, promptOverride } = this.contextCollector.collect(
				editor,
				markdownView.file,
			);
			const suggestions = await this.ollamaClient.fetchSuggestions(
				prefix,
				frontmatter,
				promptOverride,
			);
			// Stale generation (cancelled mid-flight): drop the result.
			if (generation !== this.requestGeneration) return;
			view.appendResult({ suggestions }, this.settings.maxEntries);
		} catch (error) {
			if (generation !== this.requestGeneration) return;
			view.appendResult(
				{ error: this.toErrorMessage(error) },
				this.settings.maxEntries,
			);
			// Stop the loop on error; it will auto-restart on the next layout-change event.
			this.isLoopActive = false;
			return;
		} finally {
			this.activeRequests--;
			// Re-query the view (it may have been closed mid-flight); the counter
			// keeps the spinner on while an overlapping newer request runs.
			this.getView()?.setGenerating(this.activeRequests > 0);
		}

		if (generation !== this.requestGeneration) return;
		if (!this.isLoopActive || !this.settings.autoGenerate) return;

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
