import { ItemView, WorkspaceLeaf, TFile, ViewStateResult } from "obsidian";

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
    }

    async onClose() {
        // Clear any pending save timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
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
            this.file = file;
            await this.render();
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

        this.editorData = sections;
    }

    async saveMarkdown() {
        if (!this.file) return;

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
    }

    private debouncedSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveMarkdown();
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
    }
}
