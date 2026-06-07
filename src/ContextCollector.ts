import { App, Editor, TFile } from 'obsidian';
import { Logger } from './logger';
import { InkflowSettings } from './types';

export interface CollectedContext {
	prefix: string;
	frontmatter: string | null;
	promptOverride: string | null;
}

/**
 * Gathers the text before the cursor (prefix) and the note's frontmatter,
 * which are fed to the OllamaClient as context.
 */
export class ContextCollector {
	constructor(
		private app: App,
		private getSettings: () => InkflowSettings,
		private logger: Logger,
	) {}

	collect(editor: Editor, file: TFile | null): CollectedContext {
		const cursor = editor.getCursor();
		const before = editor.getRange({ line: 0, ch: 0 }, cursor);
		const prefix = before.slice(-this.getSettings().contextLength);
		const frontmatter = this.formatFrontmatter(file);
		const promptOverride = this.getPromptOverride(file);
		this.logger.debug('collect', { prefixLength: prefix.length, hasFrontmatter: frontmatter !== null, hasPromptOverride: promptOverride !== null });
		return { prefix, frontmatter, promptOverride };
	}

	private formatFrontmatter(file: TFile | null): string | null {
		if (!file) {
			return null;
		}
		const frontmatter =
			this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			return null;
		}

		const lines = Object.entries(frontmatter)
			.filter(([key]) => key !== 'position' && key !== 'inkflow_prompt')
			.map(([key, value]) => `${key}: ${formatValue(value)}`);

		return lines.length > 0 ? lines.join('\n') : null;
	}

	private getPromptOverride(file: TFile | null): string | null {
		if (!file) return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const val: unknown = fm?.['inkflow_prompt'];
		return typeof val === 'string' && val.trim() ? val.trim() : null;
	}
}

function formatValue(value: unknown): string {
	return Array.isArray(value) ? value.join(', ') : String(value);
}
