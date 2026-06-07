import { requestUrl } from 'obsidian';
import { Logger } from './logger';
import { GRANULARITY_PROMPTS, InkflowSettings } from './types';

export type InkflowErrorKind = 'connection' | 'timeout' | 'parse';

export class InkflowError extends Error {
	constructor(
		public kind: InkflowErrorKind,
		message?: string,
	) {
		super(message ?? kind);
		this.name = 'InkflowError';
	}
}

/**
 * UI-independent client for Ollama's /api/chat endpoint. Builds the prompts,
 * issues the request with a self-managed timeout (requestUrl has none), and
 * parses the JSON suggestions out of the response.
 */
export class OllamaClient {
	constructor(
		private getSettings: () => InkflowSettings,
		private logger: Logger,
	) {}

	buildSystemPrompt(frontmatter: string | null): string {
		const template = this.getSettings().systemPrompt;
		if (frontmatter) {
			return template.replace(/\{frontmatter\}/g, frontmatter);
		}
		// No frontmatter: drop every line that contains the placeholder (spec §4).
		return template
			.split('\n')
			.filter((line) => !line.includes('{frontmatter}'))
			.join('\n');
	}

	buildUserPrompt(prefix: string): string {
		const { suggestionCount, granularity } = this.getSettings();
		const granularityText = GRANULARITY_PROMPTS[granularity];
		return (
			'以下の文章の続きを提案してください。\n\n' +
			`===\n${prefix}\n===\n\n` +
			`上記の続きを自然につながる形で${suggestionCount}個提案してください。\n` +
			`各提案は${granularityText}。\n` +
			'必ず以下のJSON形式のみで出力し、それ以外の文字を含めないでください。\n\n' +
			'{"suggestions": ["提案1", "提案2", "提案3"]}'
		);
	}

	async fetchSuggestions(
		prefix: string,
		frontmatter: string | null,
	): Promise<string[]> {
		const { ollamaUrl, modelName, timeoutMs, suggestionCount } =
			this.getSettings();

		const body = JSON.stringify({
			model: modelName,
			messages: [
				{ role: 'system', content: this.buildSystemPrompt(frontmatter) },
				{ role: 'user', content: this.buildUserPrompt(prefix) },
			],
			stream: false,
		});

		const url = `${ollamaUrl.replace(/\/+$/, '')}/api/chat`;

		this.logger.debug('fetch →', { url, model: modelName, body: JSON.parse(body) });

		let response;
		try {
			response = await this.withTimeout(
				requestUrl({
					url,
					method: 'POST',
					contentType: 'application/json',
					body,
					throw: false,
				}),
				timeoutMs,
			);
		} catch (error) {
			if (error instanceof InkflowError) {
				throw error;
			}
			this.logger.error('connection error', error);
			throw new InkflowError('connection', String(error));
		}

		this.logger.debug('fetch ←', { status: response.status });

		if (response.status < 200 || response.status >= 300) {
			throw new InkflowError(
				'connection',
				`Ollama responded with status ${response.status}`,
			);
		}

		return this.parseSuggestions(response.json, suggestionCount);
	}

	private parseSuggestions(
		responseJson: unknown,
		limit: number,
	): string[] {
		const content = (
			responseJson as { message?: { content?: unknown } } | null
		)?.message?.content;
		if (typeof content !== 'string') {
			throw new InkflowError('parse', 'Response had no message content');
		}

		const parsed = this.parseJsonContent(content);
		const suggestions = (parsed as { suggestions?: unknown }).suggestions;
		if (!Array.isArray(suggestions) || suggestions.length === 0) {
			throw new InkflowError('parse', 'Response had no suggestions array');
		}

		return suggestions.map((item) => String(item)).slice(0, limit);
	}

	private parseJsonContent(content: string): unknown {
		try {
			return JSON.parse(content);
		} catch {
			// Salvage: some models wrap the JSON in prose. Try the first {...} block.
			this.logger.warn('JSON parse: falling back to extraction');
			const start = content.indexOf('{');
			const end = content.lastIndexOf('}');
			if (start !== -1 && end > start) {
				try {
					return JSON.parse(content.slice(start, end + 1));
				} catch {
					throw new InkflowError('parse', 'Response was not valid JSON');
				}
			}
			throw new InkflowError('parse', 'Response was not valid JSON');
		}
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		let timer = 0;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = window.setTimeout(
				() => reject(new InkflowError('timeout')),
				timeoutMs,
			);
		});
		return Promise.race([promise, timeout]).finally(() =>
			window.clearTimeout(timer),
		);
	}
}
