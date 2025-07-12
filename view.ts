import { ItemView, WorkspaceLeaf, TFile, ViewStateResult, Notice } from "obsidian";

// A unique key to identify the view
export const VIEW_TYPE_SURVEYNOTE = "surveynote-view";

// Define section titles as constants
const SECTIONS = {
    BACKGROUND: "背景目的",
    SUMMARY: "まとめ",
    CONTENT1: "内容1",
    CONTENT1_SUPPLEMENT: "内容1の補足",
    CONTENT2: "内容2",
    CONTENT2_SUPPLEMENT: "内容2の補足",
};

export class SurveyNoteView extends ItemView {
    file: TFile;
    private editorData: Record<string, string> = {};
    private saveTimeout: NodeJS.Timeout | null = null;
    private fileChangeHandler: (() => void) | null = null;
    private isUpdating: boolean = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_SURVEYNOTE;
    }

    getDisplayText() {
        if (this.file) {
            return this.file.basename;
        }
        return "SurveyNote";
    }

    getIcon() {
        return "surveynote-icon";
    }

    async onOpen() {
        // Add an action to switch back to Markdown view
        this.addAction("file-text", "Markdown表示に切り替え", () => {
            this.setMarkdownView();
        });

        // Set up file change monitoring
        this.setupFileChangeMonitoring();
    }

    async onClose() {
        // Clear any pending save timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }

        // Remove file change monitoring
        this.removeFileChangeMonitoring();
    }

    private setupFileChangeMonitoring() {
        if (this.file && !this.fileChangeHandler) {
            this.fileChangeHandler = () => {
                if (!this.isUpdating) {
                    this.refreshView();
                }
            };
            
            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file === this.file && this.fileChangeHandler) {
                        this.fileChangeHandler();
                    }
                })
            );
        }
    }

    private removeFileChangeMonitoring() {
        this.fileChangeHandler = null;
    }

    private async refreshView() {
        if (!this.file) return;
        
        // Check if there are pending save operations
        if (this.saveTimeout !== null) {
            // If there are pending saves, show a notice and don't update
            new Notice('保存中のため、外部の変更は一時的に無視されます。');
            return;
        }
        
        // Check if the current content differs from what's on disk
        const currentContent = await this.app.vault.read(this.file);
        const currentSections = await this.parseMarkdownContent(currentContent);
        
        // Compare current editor data with file content
        let hasLocalChanges = false;
        for (const key in this.editorData) {
            if (this.editorData[key] !== (currentSections[key] || '')) {
                hasLocalChanges = true;
                break;
            }
        }
        
        if (hasLocalChanges) {
            new Notice('ファイルが外部で変更されましたが、未保存の変更があります。手動で更新してください。');
            return;
        }
        
        // Refresh the view with the latest content
        await this.render();
    }

    private async parseMarkdownContent(content: string): Promise<Record<string, string>> {
        const lines = content.split("\n");
        const sections: Record<string, string> = {};
        let currentSection = "";

        for (const line of lines) {
            let isHeading = false;
            for (const key in SECTIONS) {
                const sectionTitle = SECTIONS[key as keyof typeof SECTIONS];
                if (line.trim().startsWith(`## ${sectionTitle}`)) {
                    currentSection = sectionTitle;
                    sections[currentSection] = "";
                    isHeading = true;
                    break;
                }
            }

            if (!isHeading && currentSection) {
                sections[currentSection] += line + "\n";
            }
        }
        
        for(const key in sections) {
            sections[key] = sections[key].trim();
        }

        return sections;
    }


    // Add getState and setState to handle view switching
    getState() {
        const state = super.getState();
        state.file = this.file?.path;
        return state;
    }

    async setState(state: any, result: ViewStateResult): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(state.file);
        if (file instanceof TFile) {
            // Remove existing file change monitoring
            this.removeFileChangeMonitoring();
            
            this.file = file;
            await this.render();
            
            // Set up file change monitoring for the new file
            this.setupFileChangeMonitoring();
        }
        return super.setState(state, result);
    }

    async setMarkdownView() {
        await this.leaf.setViewState({
            type: 'markdown',
            state: this.getState(),
        });
    }

    async parseMarkdown() {
        if (!this.file) return;

        const content = await this.app.vault.read(this.file);
        this.editorData = await this.parseMarkdownContent(content);
    }

    async saveMarkdown() {
        if (!this.file) return;

        // Set updating flag to prevent recursive updates
        this.isUpdating = true;

        try {
            // Build the new content from the editor data
            let newSectionContent = "";
            const sectionOrder = [
                SECTIONS.BACKGROUND, SECTIONS.SUMMARY,
                SECTIONS.CONTENT1, SECTIONS.CONTENT1_SUPPLEMENT,
                SECTIONS.CONTENT2, SECTIONS.CONTENT2_SUPPLEMENT
            ];

            for (const sectionTitle of sectionOrder) {
                const sectionContent = this.editorData[sectionTitle];
                if (sectionContent !== undefined) {
                    newSectionContent += `## ${sectionTitle}\n`;
                    newSectionContent += `${sectionContent.trim()}\n\n`;
                }
            }

            const fileCache = this.app.metadataCache.getFileCache(this.file);
            const originalContent = await this.app.vault.read(this.file);
            let finalContent = "";

            if (fileCache && fileCache.frontmatter && fileCache.frontmatterPosition) {
                // If frontmatter exists, preserve it
                const frontmatterEndOffset = fileCache.frontmatterPosition.end.offset;
                const frontmatter = originalContent.substring(0, frontmatterEndOffset);
                finalContent = frontmatter.trim() + "\n\n" + newSectionContent.trim();
            } else {
                // Otherwise, just write the new content
                finalContent = newSectionContent.trim();
            }

            await this.app.vault.modify(this.file, finalContent);
        } finally {
            // Reset updating flag
            this.isUpdating = false;
        }
    }

    private debouncedSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(async () => {
            await this.saveMarkdown();
            this.saveTimeout = null; // Clear the timeout after saving
        }, 500); // 500ms delay for debounced save
    }

    async render() {
        await this.parseMarkdown();

        const container = this.containerEl.children[1];
        container.empty();

        const rootEl = container.createDiv({ cls: "surveynote-view-root" });

        const headerEl = rootEl.createDiv({ cls: "surveynote-view-header" });
        headerEl.createEl("h2", { text: this.getDisplayText() });

        const gridEl = rootEl.createDiv({ cls: "surveynote-view-grid" });

        this.createGridItem(gridEl, SECTIONS.BACKGROUND, "background");
        this.createGridItem(gridEl, SECTIONS.SUMMARY, "summary");
        this.createGridItem(gridEl, SECTIONS.CONTENT1, "content1");
        this.createGridItem(gridEl, SECTIONS.CONTENT1_SUPPLEMENT, "content1_supplement");
        this.createGridItem(gridEl, SECTIONS.CONTENT2, "content2");
        this.createGridItem(gridEl, SECTIONS.CONTENT2_SUPPLEMENT, "content2_supplement");
    }

    createGridItem(parent: HTMLElement, title: string, cls: string) {
        const itemEl = parent.createDiv({ cls: `grid-item ${cls}` });
        // itemEl.createEl("h3", { text: title }); // ラベルを非表示にする
        const textarea = itemEl.createEl("textarea");
        
        // Always use the latest parsed data
        textarea.value = this.editorData[title] || "";
        
        // Real-time save with debounce
        textarea.oninput = () => {
            this.editorData[title] = textarea.value;
            this.debouncedSave();
        };
        
        // Save when focus is lost
        textarea.onblur = () => {
            this.editorData[title] = textarea.value;
            this.saveMarkdown();
        };

        // Add drag and drop functionality
        this.setupDragAndDrop(textarea, title);
    }

    private setupDragAndDrop(textarea: HTMLTextAreaElement, title: string) {
        // Prevent default drag behaviors
        textarea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            textarea.classList.add('drag-over');
        });

        textarea.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            textarea.classList.add('drag-over');
        });

        textarea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Only remove the class if we're actually leaving the textarea
            if (!textarea.contains(e.relatedTarget as Node)) {
                textarea.classList.remove('drag-over');
            }
        });

        textarea.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            textarea.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer?.files || []);
            
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    await this.handleImageDrop(file, textarea, title);
                }
            }
        });
    }

    private async handleImageDrop(file: File, textarea: HTMLTextAreaElement, title: string) {
        try {
            // Get the file content as array buffer
            const arrayBuffer = await file.arrayBuffer();
            
            // Generate a unique filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = file.name.split('.').pop() || 'png';
            const filename = `${file.name.replace(/\.[^/.]+$/, '')}-${timestamp}.${extension}`;
            
            // Use the file manager to get the new file parent and path
            const newFileParent = this.app.fileManager.getNewFileParent(this.file.path);
            let attachmentPath = filename;
            
            // Check if there's an attachments folder setting
            const attachmentFolderPath = (this.app.vault as any).getConfig?.('attachmentFolderPath');
            
            if (attachmentFolderPath) {
                // Create the attachment folder if it doesn't exist
                const attachmentFolder = this.app.vault.getAbstractFileByPath(attachmentFolderPath);
                if (!attachmentFolder) {
                    await this.app.vault.createFolder(attachmentFolderPath);
                }
                attachmentPath = `${attachmentFolderPath}/${filename}`;
            } else {
                // Use default behavior: save in the same folder as the current file
                attachmentPath = `${newFileParent.path}/${filename}`;
            }
            
            // Ensure the path is unique
            let finalPath = attachmentPath;
            let counter = 1;
            while (this.app.vault.getAbstractFileByPath(finalPath)) {
                const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
                const basePath = attachmentFolderPath || newFileParent.path;
                finalPath = `${basePath}/${nameWithoutExt}-${counter}.${extension}`;
                counter++;
            }
            
            // Save the file using Obsidian's vault
            const createdFile = await this.app.vault.createBinary(finalPath, arrayBuffer);
            
            // Generate markdown link
            const markdownLink = this.app.fileManager.generateMarkdownLink(createdFile, this.file.path);
            
            // Insert the link at cursor position or at the end
            const cursorPosition = textarea.selectionStart;
            const currentValue = textarea.value;
            const newValue = currentValue.substring(0, cursorPosition) + 
                           '\n' + markdownLink + '\n' + 
                           currentValue.substring(cursorPosition);
            
            textarea.value = newValue;
            this.editorData[title] = newValue;
            
            // Save immediately after dropping
            await this.saveMarkdown();
            
            // Set cursor position after the inserted link
            const newCursorPosition = cursorPosition + markdownLink.length + 2;
            textarea.setSelectionRange(newCursorPosition, newCursorPosition);
            textarea.focus();
            
        } catch (error) {
            console.error('Error handling image drop:', error);
            // Show error message to user
            new Notice('画像の保存に失敗しました: ' + error.message);
        }
    }
}
