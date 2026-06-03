import { Plugin } from 'obsidian';
import { InkflowSettingTab } from './SettingsTab';
import { DEFAULT_SETTINGS, InkflowSettings } from './types';

export default class InkflowPlugin extends Plugin {
	settings!: InkflowSettings;

	async onload() {
		await this.loadSettings();
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
}
