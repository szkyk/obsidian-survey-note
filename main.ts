import { App, Plugin, PluginSettingTab, Setting, MarkdownView, WorkspaceLeaf, addIcon } from 'obsidian';
import { SurveyNoteView, VIEW_TYPE_SURVEYNOTE } from './view';

// Add a custom icon for the view switch
addIcon('surveynote-icon', `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`);


interface SurveyNotePluginSettings {
	theme: 'auto' | 'dark' | 'light';
}

const DEFAULT_SETTINGS: SurveyNotePluginSettings = {
	theme: 'auto',
}

export default class SurveyNotePlugin extends Plugin {
	settings: SurveyNotePluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SURVEYNOTE,
			(leaf) => new SurveyNoteView(leaf, this)
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

		this.addSettingTab(new SurveyNoteSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.app.workspace.getLeavesOfType(VIEW_TYPE_SURVEYNOTE).forEach(leaf => {
					if (leaf.view instanceof SurveyNoteView) {
						leaf.view.applyTheme();
					}
				});
			})
		);
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
		// Re-apply theme to open views when settings change
		this.app.workspace.getLeavesOfType(VIEW_TYPE_SURVEYNOTE).forEach(leaf => {
			if (leaf.view instanceof SurveyNoteView) {
				leaf.view.applyTheme();
			}
		});
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

class SurveyNoteSettingTab extends PluginSettingTab {
	plugin: SurveyNotePlugin;

	constructor(app: App, plugin: SurveyNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Survey Note Settings'});

		new Setting(containerEl)
			.setName('Theme')
			.setDesc('Set the theme for the Survey Note view.')
			.addDropdown(dropdown => dropdown
				.addOption('auto', 'Auto (Follow Obsidian)')
				.addOption('dark', 'Dark')
				.addOption('light', 'Light')
				.setValue(this.plugin.settings.theme)
				.onChange(async (value: 'auto' | 'dark' | 'light') => {
					this.plugin.settings.theme = value;
					await this.plugin.saveSettings();
				}));
	}
}
