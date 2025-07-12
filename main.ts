import { App, Plugin, PluginSettingTab, Setting, MarkdownView, WorkspaceLeaf, addIcon } from 'obsidian';
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

		// Add ribbon icon for easy switching
		this.addRibbonIcon('surveynote-icon', 'SurveyNote表示切り替え', (evt: MouseEvent) => {
			this.toggleView();
		});

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

		this.addCommand({
			id: 'open-markdown-view',
			name: 'マークダウン表示に切り替え',
			checkCallback: (checking: boolean) => {
				const leaf = this.app.workspace.activeLeaf;
				if (leaf?.view instanceof SurveyNoteView) {
					if (!checking) {
						this.setMarkdownView(leaf);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'toggle-surveynote-view',
			name: 'SurveyNote表示切り替え',
			callback: () => {
				this.toggleView();
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
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

	toggleView() {
		const leaf = this.app.workspace.activeLeaf;
		if (leaf?.view instanceof MarkdownView) {
			this.setSurveyNoteView(leaf);
		} else if (leaf?.view instanceof SurveyNoteView) {
			this.setMarkdownView(leaf);
		}
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
