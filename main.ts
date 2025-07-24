import { App, Plugin, PluginSettingTab, Setting, MarkdownView, WorkspaceLeaf, addIcon } from 'obsidian';
import { SurveyNoteView, VIEW_TYPE_SURVEYNOTE } from './view';

// Add custom icon for the SurveyNote view
addIcon('surveynote-icon', `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`);

/**
 * Settings interface for the SurveyNote plugin
 */
interface SurveyNotePluginSettings {
	theme: 'auto' | 'dark' | 'light';
	fontSize: number;
}

/**
 * Default plugin settings
 */
const DEFAULT_SETTINGS: SurveyNotePluginSettings = {
	theme: 'auto',
	fontSize: 16,
}

/**
 * Main plugin class for the SurveyNote plugin
 */
export default class SurveyNotePlugin extends Plugin {
	settings: SurveyNotePluginSettings;
	private viewedFiles: Set<string> = new Set();
	private manualViewSwitch: boolean = false;

	/**
	 * Plugin initialization
	 */
	async onload() {
		// Load user settings
		await this.loadSettings();

		// Register the custom SurveyNote view
		this.registerView(
			VIEW_TYPE_SURVEYNOTE,
			(leaf) => new SurveyNoteView(leaf, this)
		);

		// Add ribbon icon for easy view switching
		this.addRibbonIcon('surveynote-icon', 'SurveyNote表示切り替え', (evt: MouseEvent) => {
			this.toggleView();
		});

		// Command: Switch to SurveyNote view
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

		// Command: Switch to Markdown view
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

		// Command: Toggle between SurveyNote and Markdown view
		this.addCommand({
			id: 'toggle-surveynote-view',
			name: 'SurveyNote表示切り替え',
			callback: () => {
				this.toggleView();
			}
		});

		// Add settings tab
		this.addSettingTab(new SurveyNoteSettingTab(this.app, this));

		// Listen for CSS changes to update styles in real-time
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.app.workspace.getLeavesOfType(VIEW_TYPE_SURVEYNOTE).forEach(leaf => {
					if (leaf.view instanceof SurveyNoteView) {
						leaf.view.applyStyles();
					}
				});
			})
		);

		// Listen for active leaf changes to manage tab bar buttons
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.updateTabBarButtons();
			})
		);

		// Listen for metadata cache changes to update tab bar buttons
		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				this.updateTabBarButtons();
			})
		);

		// Listen for file open events to auto-switch to SurveyNote view
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					this.checkAndAutoSwitchToSurveyNote(file);
				}
			})
		);
	}

	/**
	 * Plugin cleanup
	 */
	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SURVEYNOTE);
	}

	/**
	 * Switch the given leaf to SurveyNote view
	 */
	async setSurveyNoteView(leaf: WorkspaceLeaf) {
		this.manualViewSwitch = true;
		const state = leaf.view.getState();
		await leaf.setViewState({
			type: VIEW_TYPE_SURVEYNOTE,
			state: state,
			active: true,
		});
		// Reset flag after a short delay to allow file-open event to complete
		setTimeout(() => {
			this.manualViewSwitch = false;
		}, 200);
	}

	/**
	 * Switch the given leaf to Markdown view
	 */
	async setMarkdownView(leaf: WorkspaceLeaf) {
		this.manualViewSwitch = true;
		const state = leaf.view.getState();
		await leaf.setViewState({
			type: 'markdown',
			state: state,
			active: true,
		});
		// Reset flag after a short delay to allow file-open event to complete
		setTimeout(() => {
			this.manualViewSwitch = false;
		}, 200);
	}

	/**
	 * Load plugin settings from storage
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Save plugin settings to storage and update active views
	 */
	async saveSettings() {
		await this.saveData(this.settings);
		// Re-apply styles to open views when settings change
		this.app.workspace.getLeavesOfType(VIEW_TYPE_SURVEYNOTE).forEach(leaf => {
			if (leaf.view instanceof SurveyNoteView) {
				leaf.view.applyStyles();
			}
		});
	}

	/**
	 * Toggle between SurveyNote and Markdown view for the active leaf
	 */
	toggleView() {
		const leaf = this.app.workspace.activeLeaf;
		if (leaf?.view instanceof MarkdownView) {
			this.setSurveyNoteView(leaf);
		} else if (leaf?.view instanceof SurveyNoteView) {
			this.setMarkdownView(leaf);
		}
	}

	/**
	 * Update tab bar buttons based on current file properties
	 */
	updateTabBarButtons() {
		const leaf = this.app.workspace.activeLeaf;
		if (!leaf?.view || !(leaf.view instanceof MarkdownView)) {
			return;
		}

		const file = leaf.view.file;
		if (!file) {
			return;
		}

		// Check if file has survey-note-view: note property
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;
		const hasSurveyNoteProperty = frontmatter && frontmatter['survey-note-view'];

		const markdownView = leaf.view as MarkdownView;

		// Remove existing action if it exists
		let actions = (markdownView as any).actions as any[];
		
		// Initialize actions array if it doesn't exist
		if (!actions) {
			(markdownView as any).actions = [];
			actions = (markdownView as any).actions;
		}
		
		if (actions) {
			const existingIndex = actions.findIndex((action: any) => action.id === 'surveynote-switch');
			
			if (existingIndex >= 0) {
				actions.splice(existingIndex, 1);
			}
		}

		// Add SurveyNote button if property exists, using the same method as SurveyNoteView
		if (hasSurveyNoteProperty) {
			// Check if action already exists by checking both the actions array and DOM
			const existsInDOM = document.querySelector('#surveynote-switch');
			
			if (!existsInDOM) {
				const action = (markdownView as any).addAction('surveynote-icon', 'SurveyNote表示に切り替え', () => {
					this.setSurveyNoteView(leaf);
				});
				
				// Set the id for proper cleanup
				if (action) {
					action.id = 'surveynote-switch';
				}
			}
		}

		// Force header update to reflect changes
		if ((markdownView as any).updateHeader) {
			(markdownView as any).updateHeader();
		}
	}

	/**
	 * Check if file has survey-note-view: note property and auto-switch to SurveyNote view
	 * Only switches on the first time viewing the file and not during manual view switches
	 */
	checkAndAutoSwitchToSurveyNote(file: any) {
		const filePath = file.path;
		
		// Skip auto-switch if this is a manual view switch
		if (this.manualViewSwitch) {
			console.log('Skipping auto-switch during manual view switch for:', filePath);
			return;
		}
		
		// Check if this file has already been viewed in this session
		if (this.viewedFiles.has(filePath)) {
			return;
		}

		// Mark this file as viewed
		this.viewedFiles.add(filePath);

		// Wait a bit for metadata to be loaded
		setTimeout(() => {
			const fileCache = this.app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;
			const hasSurveyNoteProperty = frontmatter && frontmatter['survey-note-view'];

			if (hasSurveyNoteProperty) {
				const leaf = this.app.workspace.activeLeaf;
				// Only switch if current view is MarkdownView (not already SurveyNoteView)
				if (leaf?.view instanceof MarkdownView && leaf.view.file === file) {
					console.log('Auto-switching to SurveyNote view for:', filePath);
					this.setSurveyNoteView(leaf);
				}
			}
		}, 100); // Small delay to ensure metadata is loaded
	}
}

/**
 * Settings tab for the SurveyNote plugin
 */
class SurveyNoteSettingTab extends PluginSettingTab {
	plugin: SurveyNotePlugin;

	constructor(app: App, plugin: SurveyNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Display the settings interface
	 */
	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Survey Note Settings'});

		// Theme setting
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

		// Font size setting
		new Setting(containerEl)
			.setName('Font Size')
			.setDesc('Set the font size for the editor panes (in pixels).')
			.addText(text => text
				.setPlaceholder('e.g., 16')
				.setValue(this.plugin.settings.fontSize.toString())
				.onChange(async (value) => {
					const newSize = parseInt(value, 10);
					if (!isNaN(newSize) && newSize > 0) {
						this.plugin.settings.fontSize = newSize;
						await this.plugin.saveSettings();
					}
				}));
	}
}
