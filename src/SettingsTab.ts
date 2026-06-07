import { App, PluginSettingTab, Setting } from 'obsidian';
import InkflowPlugin from './main';
import { DEFAULT_SETTINGS, GRANULARITY_LABELS, Granularity } from './types';

export class InkflowSettingTab extends PluginSettingTab {
	plugin: InkflowPlugin;

	constructor(app: App, plugin: InkflowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Ollama URL')
			.setDesc('Ollama server base URL.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl)
					.setValue(this.plugin.settings.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaUrl =
							value.trim() || DEFAULT_SETTINGS.ollamaUrl;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Model name')
			.setDesc('Ollama model name to use.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.modelName)
					.setValue(this.plugin.settings.modelName)
					.onChange(async (value) => {
						this.plugin.settings.modelName =
							value.trim() || DEFAULT_SETTINGS.modelName;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Generation interval (seconds)')
			.setDesc('Seconds to wait after the previous output before starting the next generation.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.intervalSeconds))
					.setValue(String(this.plugin.settings.intervalSeconds))
					.onChange(async (value) => {
						this.plugin.settings.intervalSeconds = parsePositiveNumber(
							value,
							DEFAULT_SETTINGS.intervalSeconds,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Context length')
			.setDesc('Number of preceding characters to send as context.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.contextLength))
					.setValue(String(this.plugin.settings.contextLength))
					.onChange(async (value) => {
						this.plugin.settings.contextLength = parsePositiveNumber(
							value,
							DEFAULT_SETTINGS.contextLength,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Suggestion count')
			.setDesc('Number of suggestions to generate (1–3).')
			.addSlider((slider) =>
				slider
					.setLimits(1, 3, 1)
					.setValue(this.plugin.settings.suggestionCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.suggestionCount = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Granularity')
			.setDesc('How long each suggestion should be.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(GRANULARITY_LABELS)
					.setValue(this.plugin.settings.granularity)
					.onChange(async (value) => {
						this.plugin.settings.granularity = value as Granularity;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Timeout (ms)')
			.setDesc('Milliseconds to wait for a response before timing out.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.timeoutMs))
					.setValue(String(this.plugin.settings.timeoutMs))
					.onChange(async (value) => {
						this.plugin.settings.timeoutMs = parsePositiveNumber(
							value,
							DEFAULT_SETTINGS.timeoutMs,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Show insert button')
			.setDesc('Display an "insert" button on each suggestion card.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showInsertButton)
					.onChange(async (value) => {
						this.plugin.settings.showInsertButton = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Max suggestion batches')
			.setDesc('Maximum number of generation results to keep in the panel (oldest are removed).')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.maxEntries))
					.setValue(String(this.plugin.settings.maxEntries))
					.onChange(async (value) => {
						this.plugin.settings.maxEntries = parsePositiveNumber(
							value,
							DEFAULT_SETTINGS.maxEntries,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc(
				'Template for the system prompt. "{frontmatter}" is replaced with the note\'s frontmatter; if the note has none, the line containing it is removed.',
			)
			.addTextArea((textArea) => {
				textArea
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				textArea.inputEl.rows = 12;
				textArea.inputEl.addClass('inkflow-system-prompt');
			});

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('開発者コンソールに詳細なデバッグログを出力します。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

function parsePositiveNumber(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
