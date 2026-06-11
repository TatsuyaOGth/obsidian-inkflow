import { ItemView, ToggleComponent, WorkspaceLeaf, setIcon } from 'obsidian';
import { Logger } from './logger';
import { SuggestionEntry, VIEW_TYPE_INKFLOW } from './types';

export interface SuggestionPanelCallbacks {
	onInsert: (text: string) => void;
	onToggleAuto: (value: boolean) => void;
	onGenerate: () => void;
	getAutoGenerate: () => boolean;
	getShowInsertButton: () => boolean;
}

export class InkflowSuggestionView extends ItemView {
	private callbacks: SuggestionPanelCallbacks;
	private bodyEl!: HTMLElement;
	private scrollToLatestBtn!: HTMLButtonElement;
	private toggle!: ToggleComponent;
	private statusIconEl!: HTMLElement;
	private statusTextEl!: HTMLElement;
	private generateBtn!: HTMLButtonElement;

	private entries: SuggestionEntry[] = [];
	private entryEls = new Map<number, HTMLElement>();
	private nextEntryId = 0;
	private autoScroll = true;
	private generating = false;
	private isAutoScrolling = false;

	constructor(
		leaf: WorkspaceLeaf,
		callbacks: SuggestionPanelCallbacks,
		private logger: Logger,
	) {
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
		toggleWrapper.createSpan({ text: 'Auto', cls: 'inkflow-toggle-label' });
		this.toggle = new ToggleComponent(toggleWrapper);
		this.toggle.setValue(this.callbacks.getAutoGenerate());
		this.toggle.onChange((value) => this.callbacks.onToggleAuto(value));

		const bodyWrapper = container.createDiv({ cls: 'inkflow-body-wrapper' });
		this.bodyEl = bodyWrapper.createDiv({ cls: 'inkflow-body' });
		this.bodyEl.addEventListener('scroll', () => this.onBodyScroll());
		// Covers a smooth scroll interrupted by the user before reaching the bottom.
		this.bodyEl.addEventListener('scrollend', () => {
			this.isAutoScrolling = false;
		});

		this.scrollToLatestBtn = bodyWrapper.createEl('button', {
			text: '最新の提案へ',
			cls: 'inkflow-scroll-to-latest',
		});
		this.scrollToLatestBtn.addEventListener('click', () => {
			this.autoScroll = true;
			this.scrollToLatestBtn.removeClass('is-visible');
			this.scrollToBottom();
		});

		const footer = container.createDiv({ cls: 'inkflow-footer' });
		const status = footer.createDiv({ cls: 'inkflow-status' });
		this.statusIconEl = status.createDiv({ cls: 'inkflow-status-icon' });
		this.statusTextEl = status.createSpan({ cls: 'inkflow-status-text' });
		this.generateBtn = footer.createEl('button', {
			text: '生成',
			cls: 'inkflow-generate',
		});
		this.generateBtn.addEventListener('click', () => this.callbacks.onGenerate());
		this.renderStatus();

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

	/**
	 * Appends a resolved (done or error) entry.
	 * Trims oldest entries when the list exceeds maxEntries.
	 */
	appendResult(
		result: { suggestions: string[] } | { error: string },
		maxEntries: number,
	): void {
		const id = this.nextEntryId++;
		const entry: SuggestionEntry =
			'suggestions' in result
				? { id, status: 'done', suggestions: result.suggestions }
				: { id, status: 'error', error: result.error };
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
	}

	/** Switches the status footer between idle and generating. */
	setGenerating(generating: boolean): void {
		this.generating = generating;
		this.renderStatus();
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
			text: 'Autoをオンにするか、生成ボタンを押すと提案が表示されます。',
		});
	}

	private appendEntryEl(entry: SuggestionEntry): void {
		if (!this.bodyEl) return;
		const el = this.bodyEl.createDiv({ cls: 'inkflow-entry' });
		this.entryEls.set(entry.id, el);
		this.renderEntryContent(entry, el);
	}

	// The icon slot has a fixed size, so switching states never shifts layout
	// or moves the scroll position.
	private renderStatus(): void {
		if (!this.statusIconEl || !this.statusTextEl) return;
		this.statusIconEl.empty();
		if (this.generating) {
			this.statusIconEl.createDiv({ cls: 'inkflow-spinner' });
			this.statusTextEl.setText('提案を考え中');
		} else {
			setIcon(this.statusIconEl, 'pen-line');
			this.statusTextEl.setText('待機中');
		}
		if (this.generateBtn) {
			this.generateBtn.disabled = this.generating;
		}
	}

	private renderEntryContent(entry: SuggestionEntry, el: HTMLElement): void {
		switch (entry.status) {
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
		if (this.isAutoScrolling) {
			// A smooth scroll passes through non-bottom positions; don't treat
			// them as the user scrolling away.
			if (atBottom) {
				this.isAutoScrolling = false;
			}
			return;
		}
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
		this.isAutoScrolling = true;
		this.bodyEl.scrollTo({ top: this.bodyEl.scrollHeight, behavior: 'smooth' });
	}
}
