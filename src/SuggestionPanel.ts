import { ItemView, ToggleComponent, WorkspaceLeaf } from 'obsidian';
import { SuggestionEntry, VIEW_TYPE_INKFLOW } from './types';

export interface SuggestionPanelCallbacks {
	onInsert: (text: string) => void;
	onToggle: (enabled: boolean) => void;
	getEnabled: () => boolean;
	getShowInsertButton: () => boolean;
}

export class InkflowSuggestionView extends ItemView {
	private callbacks: SuggestionPanelCallbacks;
	private bodyEl!: HTMLElement;
	private scrollToLatestBtn!: HTMLButtonElement;
	private toggle!: ToggleComponent;

	private entries: SuggestionEntry[] = [];
	private entryEls = new Map<number, HTMLElement>();
	private nextEntryId = 0;
	private autoScroll = true;

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
		header.createEl('h4', { text: 'Writing suggest', cls: 'inkflow-title' });
		const toggleWrapper = header.createDiv({ cls: 'inkflow-toggle' });
		this.toggle = new ToggleComponent(toggleWrapper);
		this.toggle.setValue(this.callbacks.getEnabled());
		this.toggle.onChange((value) => this.callbacks.onToggle(value));

		const bodyWrapper = container.createDiv({ cls: 'inkflow-body-wrapper' });
		this.bodyEl = bodyWrapper.createDiv({ cls: 'inkflow-body' });
		this.bodyEl.addEventListener('scroll', () => this.onBodyScroll());

		this.scrollToLatestBtn = bodyWrapper.createEl('button', {
			text: '最新の提案へ',
			cls: 'inkflow-scroll-to-latest',
		});
		this.scrollToLatestBtn.addEventListener('click', () => {
			this.autoScroll = true;
			this.scrollToLatestBtn.removeClass('is-visible');
			this.scrollToBottom();
		});

		if (this.entries.length === 0) {
			this.showEmptyState();
		} else {
			for (const entry of this.entries) {
				this.appendEntryEl(entry);
			}
		}
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.entryEls.clear();
	}

	setEnabled(enabled: boolean): void {
		this.toggle?.setValue(enabled);
	}

	/**
	 * Appends a loading entry and returns its ID.
	 * Trims oldest entries when the list exceeds maxEntries.
	 */
	appendLoading(maxEntries: number): number {
		const id = this.nextEntryId++;
		const entry: SuggestionEntry = { id, status: 'loading' };
		this.entries.push(entry);

		this.trimTo(maxEntries);

		if (this.bodyEl) {
			const emptyEl = this.bodyEl.querySelector('.inkflow-empty');
			emptyEl?.remove();

			this.appendEntryEl(entry);
			if (this.autoScroll) {
				this.scrollToBottom();
			}
		}
		return id;
	}

	/** Updates a loading entry to done or error status. */
	resolveEntry(id: number, result: { suggestions: string[] } | { error: string }): void {
		const entry = this.entries.find((e) => e.id === id);
		if (!entry) return;

		if ('suggestions' in result) {
			entry.status = 'done';
			entry.suggestions = result.suggestions;
		} else {
			entry.status = 'error';
			entry.error = result.error;
		}

		const el = this.entryEls.get(id);
		if (el) {
			el.empty();
			this.renderEntryContent(entry, el);
			if (this.autoScroll) {
				this.scrollToBottom();
			}
		}
	}

	/** Removes a single entry (e.g. a stale loading entry cancelled mid-flight). */
	removeEntry(id: number): void {
		const idx = this.entries.findIndex((e) => e.id === id);
		if (idx !== -1) this.entries.splice(idx, 1);
		const el = this.entryEls.get(id);
		if (el) {
			el.remove();
			this.entryEls.delete(id);
			if (this.entries.length === 0) {
				this.showEmptyState();
			}
		}
	}

	/** Clears all entries (called when re-enabling the plugin). */
	clearEntries(): void {
		this.entries = [];
		this.entryEls.clear();
		this.autoScroll = true;
		if (this.bodyEl) {
			this.bodyEl.empty();
			this.showEmptyState();
		}
		if (this.scrollToLatestBtn) {
			this.scrollToLatestBtn.removeClass('is-visible');
		}
	}

	private trimTo(maxEntries: number): void {
		while (this.entries.length > maxEntries) {
			const removed = this.entries.shift();
			if (!removed) break;
			const el = this.entryEls.get(removed.id);
			el?.remove();
			this.entryEls.delete(removed.id);
		}
	}

	private showEmptyState(): void {
		this.bodyEl.createDiv({
			cls: 'inkflow-empty',
			text: '機能を有効にすると提案が表示されます。',
		});
	}

	private appendEntryEl(entry: SuggestionEntry): void {
		if (!this.bodyEl) return;
		const el = this.bodyEl.createDiv({ cls: 'inkflow-entry' });
		this.entryEls.set(entry.id, el);
		this.renderEntryContent(entry, el);
	}

	private renderEntryContent(entry: SuggestionEntry, el: HTMLElement): void {
		switch (entry.status) {
			case 'loading':
				el.createDiv({ cls: 'inkflow-spinner' });
				break;
			case 'done':
				this.renderSuggestions(entry.suggestions ?? [], el);
				break;
			case 'error':
				el.createDiv({
					cls: 'inkflow-error',
					text: entry.error ?? 'エラーが発生しました。',
				});
				break;
		}
	}

	private renderSuggestions(suggestions: string[], container: HTMLElement): void {
		if (suggestions.length === 0) {
			container.createDiv({
				cls: 'inkflow-empty',
				text: '候補がありませんでした。',
			});
			return;
		}

		const showInsert = this.callbacks.getShowInsertButton();
		for (const suggestion of suggestions) {
			const card = container.createDiv({ cls: 'inkflow-card' });
			card.createDiv({ cls: 'inkflow-card-text', text: suggestion });
			if (showInsert) {
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

	private onBodyScroll(): void {
		if (!this.bodyEl || !this.scrollToLatestBtn) return;
		const { scrollTop, scrollHeight, clientHeight } = this.bodyEl;
		const atBottom = scrollTop + clientHeight >= scrollHeight - 8;
		if (atBottom) {
			this.autoScroll = true;
			this.scrollToLatestBtn.removeClass('is-visible');
		} else {
			this.autoScroll = false;
			this.scrollToLatestBtn.addClass('is-visible');
		}
	}

	private scrollToBottom(): void {
		if (!this.bodyEl) return;
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
	}
}
