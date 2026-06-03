import { ItemView, ToggleComponent, WorkspaceLeaf } from 'obsidian';
import { PanelState, VIEW_TYPE_INKFLOW } from './types';

export interface SuggestionPanelCallbacks {
	onInsert: (text: string) => void;
	onRegenerate: () => void;
	onToggle: (enabled: boolean) => void;
	getEnabled: () => boolean;
}

export class InkflowSuggestionView extends ItemView {
	private callbacks: SuggestionPanelCallbacks;
	private bodyEl!: HTMLElement;
	private toggle!: ToggleComponent;
	private regenerateButton!: HTMLButtonElement;
	private state: PanelState = { status: 'idle' };

	constructor(leaf: WorkspaceLeaf, callbacks: SuggestionPanelCallbacks) {
		super(leaf);
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return VIEW_TYPE_INKFLOW;
	}

	getDisplayText(): string {
		return 'Writing suggest';
	}

	getIcon(): string {
		return 'pencil';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('inkflow-panel');

		const header = container.createDiv({ cls: 'inkflow-header' });
		header.createEl('h4', {
			text: 'Writing suggest',
			cls: 'inkflow-title',
		});
		const toggleWrapper = header.createDiv({ cls: 'inkflow-toggle' });
		this.toggle = new ToggleComponent(toggleWrapper);
		this.toggle.setValue(this.callbacks.getEnabled());
		this.toggle.onChange((value) => this.callbacks.onToggle(value));

		this.bodyEl = container.createDiv({ cls: 'inkflow-body' });

		const footer = container.createDiv({ cls: 'inkflow-footer' });
		this.regenerateButton = footer.createEl('button', {
			text: '再生成',
			cls: 'inkflow-regenerate',
		});
		this.regenerateButton.addEventListener('click', () => {
			this.callbacks.onRegenerate();
		});

		this.render(this.state);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setEnabled(enabled: boolean): void {
		// setValue does not fire onChange, so this won't loop back into onToggle.
		this.toggle?.setValue(enabled);
	}

	render(state: PanelState): void {
		this.state = state;
		if (!this.bodyEl) {
			return;
		}

		this.bodyEl.empty();
		this.regenerateButton.disabled = state.status === 'loading';

		switch (state.status) {
			case 'loading':
				this.bodyEl.createDiv({ cls: 'inkflow-spinner' });
				break;
			case 'done':
				this.renderSuggestions(state.suggestions ?? []);
				break;
			case 'error':
				this.bodyEl.createDiv({
					cls: 'inkflow-error',
					text: state.error ?? 'エラーが発生しました。',
				});
				break;
			case 'idle':
			default:
				this.bodyEl.createDiv({
					cls: 'inkflow-empty',
					text: '執筆中に手を止めると候補が表示されます。',
				});
				break;
		}
	}

	private renderSuggestions(suggestions: string[]): void {
		if (suggestions.length === 0) {
			this.bodyEl.createDiv({
				cls: 'inkflow-empty',
				text: '候補がありませんでした。',
			});
			return;
		}

		for (const suggestion of suggestions) {
			const card = this.bodyEl.createDiv({ cls: 'inkflow-card' });
			card.createDiv({ cls: 'inkflow-card-text', text: suggestion });
			const insertButton = card.createEl('button', {
				text: '挿入',
				cls: 'inkflow-insert',
			});
			insertButton.addEventListener('click', () => {
				this.callbacks.onInsert(suggestion);
			});
		}
	}
}
