import { MarkdownView, Notice, Plugin } from 'obsidian';
import { InkflowSettingTab } from './SettingsTab';
import { InkflowSuggestionView } from './SuggestionPanel';
import {
	DEFAULT_SETTINGS,
	InkflowSettings,
	PanelState,
	VIEW_TYPE_INKFLOW,
} from './types';

export default class InkflowPlugin extends Plugin {
	settings!: InkflowSettings;

	async onload() {
		await this.loadSettings();

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

		this.addSettingTab(new InkflowSettingTab(this.app, this));
	}

	onunload() {}

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
	// Wired up to the IdleDetector in a later step.
	applyIdleSeconds() {}

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

	private renderPanel(state: PanelState): void {
		this.getView()?.render(state);
	}

	private setEnabled(enabled: boolean): void {
		this.settings.enabled = enabled;
		void this.saveSettings();
		this.getView()?.setEnabled(enabled);
	}

	private insertSuggestion(text: string): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor;
		if (!editor) {
			new Notice('挿入先のエディターが見つかりません。');
			return;
		}
		editor.replaceRange(text, editor.getCursor());
	}

	// Fully implemented in a later step once the request pipeline exists.
	private regenerate(): void {
		this.renderPanel({ status: 'loading' });
	}
}
