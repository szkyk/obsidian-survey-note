import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, WorkspaceLeaf, addIcon } from 'obsidian';
import { SurveyNoteView, VIEW_TYPE_SURVEYNOTE } from './view';

// Add a custom icon for the view switch
addIcon('surveynote-icon', `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`);


interface SurveyNotePluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: SurveyNotePluginSettings = {
	mySetting: 'default'
}

export default class SurveyNotePlugin extends Plugin {
	settings: SurveyNotePluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SURVEYNOTE,
			(leaf) => new SurveyNoteView(leaf)
		);

		this.addCommand({
			id: 'open-surveynote-view',
			name: 'SurveyNote表示に切り替え',
			checkCallback: (checking: boolean) => {
				const leaf = this.app.workspace.activeLeaf;
				if (leaf?.view instanceof MarkdownView) {
					if (!checking) {
						this.setSurveyNoteView(leaf);
					}
					return true;
				}
				return false;
			}
		});

		this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onLayoutChange() {
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const file = leaf.view.file;
				const fileCache = file ? this.app.metadataCache.getFileCache(file) : null;
				
				// Check if the button already exists
				const existingButton = leaf.view.containerEl.querySelector('.surveynote-mode-button');

				if (fileCache?.frontmatter?.['survey-note-plugin'] === 'note') {
					if (!existingButton) {
						// Add a button to the header only if it doesn't exist
						const button = leaf.view.addAction('surveynote-icon', 'SurveyNote表示に切り替え', () => {
							this.setSurveyNoteView(leaf);
						});
						// Add a class for styling or identification
						button.classList.add('surveynote-mode-button');
					}
				} else {
					// If the property is not set, remove the button if it exists
					existingButton?.remove();
				}
			}
		});
	}


	onunload() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_SURVEYNOTE).forEach(leaf => {
			if (leaf.view instanceof SurveyNoteView) {
				// If we are in the SurveyNote view, switch back to markdown
				this.setMarkdownView(leaf);
			}
		});
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SURVEYNOTE);
	}

	async setSurveyNoteView(leaf: WorkspaceLeaf) {
		const state = leaf.view.getState();
		await leaf.setViewState({
			type: VIEW_TYPE_SURVEYNOTE,
			state: state,
			active: true,
		});
	}

	async setMarkdownView(leaf: WorkspaceLeaf) {
		const state = leaf.view.getState();
		await leaf.setViewState({
			type: 'markdown',
			state: state,
			active: true,
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: SurveyNotePlugin;

	constructor(app: App, plugin: SurveyNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
