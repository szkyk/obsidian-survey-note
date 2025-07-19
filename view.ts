import { ItemView, WorkspaceLeaf, TFile, ViewStateResult, Notice } from "obsidian";
import { EditorState, StateField, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, keymap, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, LanguageSupport } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { RangeSet, Range } from "@codemirror/state";
import SurveyNotePlugin from "main";

// A unique key to identify the view
export const VIEW_TYPE_SURVEYNOTE = "survey-note-view";

// Define section titles as constants
const SECTIONS = {
    BACKGROUND: "Purpose",
    SUMMARY: "Summary",
    CONTENT1: "Content1",
    SUPPLEMENT: "Supplement",
    CONTENT2: "Content2",
};

const markdownHighlighting = HighlightStyle.define([
    { tag: tags.heading1, class: "cm-heading-1" },
    { tag: tags.heading2, class: "cm-heading-2" },
    { tag: tags.heading3, class: "cm-heading-3" },
    { tag: tags.strong, class: "cm-strong" },
    { tag: tags.emphasis, class: "cm-emphasis" },
    { tag: tags.strikethrough, class: "cm-strikethrough" },
    { tag: tags.link, class: "cm-link" },
    { tag: tags.quote, class: "cm-quote" },
    { tag: tags.monospace, class: "cm-monospace" },
]);

class MarkdownLinkWidget extends WidgetType {
    constructor(private linkText: string, private url: string) {
        super();
    }

    eq(other: MarkdownLinkWidget) {
        return other.linkText === this.linkText && other.url === this.url;
    }

    toDOM() {
        console.log('Creating DOM element for markdown link:', this.linkText, this.url);
        const span = document.createElement('span');
        span.className = 'markdown-link-widget';
        span.textContent = this.linkText;
        span.title = this.url;
        span.style.cursor = 'pointer';
        span.style.color = 'var(--text-accent)';
        span.style.textDecoration = 'none';
        span.addEventListener('click', (e) => {
            console.log('Markdown link clicked:', this.url);
            e.preventDefault();
            this.openUrl();
        });
        span.addEventListener('mouseenter', () => {
            span.style.textDecoration = 'underline';
            // Show URL in a tooltip or status
            span.title = this.url;
        });
        span.addEventListener('mouseleave', () => {
            span.style.textDecoration = 'none';
        });
        return span;
    }

    private openUrl() {
        console.log('Opening URL:', this.url);
        window.open(this.url, '_blank');
    }
}

class CodeBlockWidget extends WidgetType {
    constructor(private code: string, private language: string = '') {
        super();
    }

    eq(other: CodeBlockWidget) {
        return other.code === this.code && other.language === this.language;
    }

    toDOM() {
        console.log('Creating DOM element for code block:', this.language, this.code.length, 'chars');
        const container = document.createElement('div');
        container.className = 'code-block-widget-container';
        
        const pre = document.createElement('pre');
        pre.className = 'code-block-widget';
        
        const code = document.createElement('code');
        if (this.language) {
            code.className = `language-${this.language}`;
        }
        code.textContent = this.code;
        
        // Make the code block clickable to focus and allow cursor positioning
        container.addEventListener('click', (e) => {
            console.log('Code block clicked, focusing for editing');
            e.preventDefault();
            e.stopPropagation();
            
            // Dispatch a custom event to signal that we want to edit this code block
            const customEvent = new CustomEvent('editCodeBlock', {
                detail: { target: container },
                bubbles: true
            });
            container.dispatchEvent(customEvent);
        });
        
        container.style.cursor = 'text';
        container.title = 'Click to edit code block';
        
        pre.appendChild(code);
        container.appendChild(pre);
        
        return container;
    }
}

class ImageWidget extends WidgetType {
    constructor(
        private altText: string, 
        private imagePath: string, 
        private plugin: SurveyNotePlugin,
        private width?: number,
        private height?: number,
        private align: 'left' | 'center' | 'right' = 'left'
    ) {
        super();
    }

    eq(other: ImageWidget) {
        return other.altText === this.altText && 
               other.imagePath === this.imagePath &&
               other.width === this.width &&
               other.height === this.height &&
               other.align === this.align;
    }

    toDOM() {
        console.log('Creating DOM element for image:', this.altText, this.imagePath, 'Size:', this.width, 'x', this.height, 'Align:', this.align);
        const container = document.createElement('div');
        container.className = `image-widget-container image-align-${this.align}`;
        
        const img = document.createElement('img');
        img.className = 'image-widget';
        img.alt = this.altText;
        img.title = this.altText || this.imagePath;
        img.style.borderRadius = '4px';
        img.style.cursor = 'pointer';
        
        // Apply size constraints
        if (this.width && this.height) {
            console.log('Applying exact size:', this.width, 'x', this.height);
            img.style.width = `${this.width}px`;
            img.style.height = `${this.height}px`;
            img.style.objectFit = 'cover'; // Maintain aspect ratio while fitting dimensions
        } else if (this.width) {
            console.log('Applying width only:', this.width);
            img.style.width = `${this.width}px`;
            img.style.height = 'auto';
        } else if (this.height) {
            console.log('Applying height only:', this.height);
            img.style.height = `${this.height}px`;
            img.style.width = 'auto';
        } else {
            // Default responsive behavior
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
        }
        
        // Try to resolve the image path
        this.loadImage(img);
        
        img.addEventListener('click', (e) => {
            console.log('Image clicked:', this.imagePath);
            e.preventDefault();
            // TODO: Open image in full size or image viewer
        });
        
        img.addEventListener('error', () => {
            console.log('Image failed to load:', this.imagePath);
            img.style.display = 'none';
            const fallback = document.createElement('span');
            fallback.className = 'image-widget-fallback';
            fallback.textContent = `📷 ${this.altText || this.imagePath}`;
            fallback.style.color = 'var(--text-muted)';
            fallback.style.fontStyle = 'italic';
            container.appendChild(fallback);
        });
        
        container.appendChild(img);
        return container;
    }

    private async loadImage(img: HTMLImageElement) {
        try {
            console.log('Loading image with path:', this.imagePath);
            
            // First try to find the file in the vault by exact path
            let file = this.plugin.app.vault.getAbstractFileByPath(this.imagePath);
            console.log('Direct path lookup result:', !!file, file?.path);
            
            if (!file) {
                // Try to resolve relative path from current file
                const currentFile = this.plugin.app.workspace.getActiveFile();
                if (currentFile) {
                    const resolvedPath = this.plugin.app.metadataCache.getFirstLinkpathDest(this.imagePath, currentFile.path);
                    if (resolvedPath instanceof TFile) {
                        file = resolvedPath;
                        console.log('Resolved via metadataCache:', file.path);
                    }
                }
            }
            
            if (!file) {
                // Try different path variations
                const pathVariations = [
                    this.imagePath,
                    this.imagePath.startsWith('/') ? this.imagePath.slice(1) : '/' + this.imagePath,
                    this.imagePath.replace(/^\.\//, ''),
                    this.imagePath.replace(/^\//, '')
                ];
                
                for (const variation of pathVariations) {
                    const testFile = this.plugin.app.vault.getAbstractFileByPath(variation);
                    if (testFile instanceof TFile) {
                        file = testFile;
                        console.log('Found with path variation:', variation, file.path);
                        break;
                    }
                }
            }
            
            if (file && file instanceof TFile) {
                console.log('Loading image from vault file:', file.path);
                const arrayBuffer = await this.plugin.app.vault.readBinary(file);
                const blob = new Blob([arrayBuffer]);
                const url = URL.createObjectURL(blob);
                img.src = url;
                
                img.addEventListener('load', () => {
                    console.log('Image loaded successfully from vault');
                });
                
                // Clean up blob URL when image is removed from DOM
                img.addEventListener('remove', () => {
                    URL.revokeObjectURL(url);
                });
            } else {
                // Try as external URL or data URI
                console.log('Trying image as external URL:', this.imagePath);
                if (this.imagePath.startsWith('http') || this.imagePath.startsWith('data:')) {
                    img.src = this.imagePath;
                } else {
                    console.log('Image file not found in vault, triggering error');
                    img.dispatchEvent(new Event('error'));
                }
            }
        } catch (error) {
            console.error('Error loading image:', error);
            img.dispatchEvent(new Event('error'));
        }
    }
}


function createInternalLinkExtension(plugin: SurveyNotePlugin) {
    const internalLinkRegex = /\[\[([^\]]+)\]\]/g;
    const internalImageRegex = /!\[\[([^\]]+)\]\]/g;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)\n?```/g;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    function parseImageOptions(optionsStr: string): { 
        width?: number; 
        height?: number; 
        align: 'left' | 'center' | 'right' 
    } {
        if (!optionsStr) return { align: 'left' };
        
        // Split by | to handle multiple options
        const parts = optionsStr.split('|').map(part => part.trim()).filter(part => part);
        
        let width: number | undefined;
        let height: number | undefined;
        let align: 'left' | 'center' | 'right' = 'left';
        
        for (const part of parts) {
            // Check if it's an alignment specification
            if (['left', 'center', 'right'].includes(part.toLowerCase())) {
                align = part.toLowerCase() as 'left' | 'center' | 'right';
                console.log('Found align:', align);
            }
            // Check if it's a size specification
            else {
                const sizeMatch = part.match(/^(\d+)?(?:x(\d+))?$/);
                if (sizeMatch) {
                    width = sizeMatch[1] ? parseInt(sizeMatch[1], 10) : undefined;
                    height = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : undefined;
                    console.log('Found size:', { width, height });
                }
            }
        }
        
        return { width, height, align };
    }
    
    function scanForLinks(text: string, selection?: { from: number; to: number }): Range<Decoration>[] {
        console.log('Scanning for links in text:', text, 'Selection:', selection);
        const newDecorations: Range<Decoration>[] = [];
        
        // Store markdown link, image, and code block positions for URL scanning
        const markdownLinkRanges: Array<{from: number, to: number}> = [];
        const imageRanges: Array<{from: number, to: number}> = [];
        const codeBlockRanges: Array<{from: number, to: number}> = [];
        
        // Scan for code blocks first ```language\ncode```
        let match;
        codeBlockRegex.lastIndex = 0;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const language = match[1] || '';
            const code = match[2] || '';
            
            codeBlockRanges.push({from, to});
            
            console.log('Found code block:', { match: match[0], language, codeLength: code.length, from, to });
            
            // Check if cursor/selection is within this code block range
            const cursorInRange = selection && (
                (selection.from >= from && selection.from <= to) ||
                (selection.to >= from && selection.to <= to) ||
                (selection.from <= from && selection.to >= to)
            );
            
            if (cursorInRange) {
                console.log('Cursor in code block range, showing original text');
                // Show original text when cursor is in range
                const decoration = Decoration.mark({
                    class: 'code-block-editing',
                    attributes: {
                        'data-language': language,
                        'title': `Code block${language ? ` (${language})` : ''}`,
                        'style': 'cursor: text; background-color: var(--background-modifier-hover);'
                    }
                });
                newDecorations.push(decoration.range(from, to));
            } else {
                console.log('Cursor outside code block range, showing code widget');
                // Show code block widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new CodeBlockWidget(code, language)
                });
                newDecorations.push(decoration.range(from, to));
            }
        }
        
        // Scan for internal images ![[filename|size]]
        internalImageRegex.lastIndex = 0;
        while ((match = internalImageRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const fullContent = match[1];
            
            // Parse filename and options (align|size)
            const parts = fullContent.split('|');
            const filename = parts[0];
            const optionsStr = parts.slice(1).join('|'); // Rejoin remaining parts
            
            imageRanges.push({from, to});
            
            console.log('Found internal image:', { match: match[0], filename, optionsStr, from, to });
            
            // Parse options (align and size)
            const { width, height, align } = parseImageOptions(optionsStr);
            console.log('Parsed options:', { width, height, align });
            
            // Check if cursor/selection is within this image range
            const cursorInRange = selection && (
                (selection.from >= from && selection.from <= to) ||
                (selection.to >= from && selection.to <= to) ||
                (selection.from <= from && selection.to >= to)
            );
            
            if (cursorInRange) {
                console.log('Cursor in internal image range, showing original text');
                // Show original text when cursor is in range
                const decoration = Decoration.mark({
                    class: 'image-editing',
                    attributes: {
                        'data-image-path': filename,
                        'data-alt-text': '',
                        'title': `Image: ${filename}${optionsStr ? ` (${optionsStr})` : ''}`,
                        'style': 'cursor: pointer; color: var(--text-accent); background-color: var(--background-modifier-hover);'
                    }
                });
                newDecorations.push(decoration.range(from, to));
            } else {
                console.log('Cursor outside internal image range, showing image widget');
                // Show image widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new ImageWidget('', filename, plugin, width, height, align)
                });
                newDecorations.push(decoration.range(from, to));
            }
        }
        
        // Scan for markdown images ![alt](src)
        imageRegex.lastIndex = 0;
        while ((match = imageRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const altText = match[1];
            const imagePath = match[2];
            
            imageRanges.push({from, to});
            
            console.log('Found image:', { match: match[0], altText, imagePath, from, to });
            
            // Check if cursor/selection is within this image range
            const cursorInRange = selection && (
                (selection.from >= from && selection.from <= to) ||
                (selection.to >= from && selection.to <= to) ||
                (selection.from <= from && selection.to >= to)
            );
            
            if (cursorInRange) {
                console.log('Cursor in image range, showing original text');
                // Show original text when cursor is in range
                const decoration = Decoration.mark({
                    class: 'image-editing',
                    attributes: {
                        'data-image-path': imagePath,
                        'data-alt-text': altText,
                        'title': `Image: ${altText || imagePath}`,
                        'style': 'cursor: pointer; color: var(--text-accent); background-color: var(--background-modifier-hover);'
                    }
                });
                newDecorations.push(decoration.range(from, to));
            } else {
                console.log('Cursor outside image range, showing image widget');
                // Show image widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new ImageWidget(altText, imagePath, plugin, undefined, undefined, 'left')
                });
                newDecorations.push(decoration.range(from, to));
            }
        }
        
        // Scan for internal links [[filename]] (non-image links only)
        internalLinkRegex.lastIndex = 0;
        while ((match = internalLinkRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const fullContent = match[1];
            
            // Skip if this position overlaps with an image or code block range
            const overlapsWithSpecial = [...imageRanges, ...codeBlockRanges].some(range => 
                (from >= range.from && from < range.to) || 
                (to > range.from && to <= range.to) ||
                (from <= range.from && to >= range.to)
            );
            
            if (overlapsWithSpecial) {
                console.log('Skipping internal link that overlaps with special content:', match[0]);
                continue;
            }
            
            // Parse filename
            const parts = fullContent.split('|');
            const filename = parts[0];
            
            console.log('Found internal link:', { match: match[0], filename, from, to });
            
            // Always treat [[...]] as regular internal link (images use ![[...]])
            const decoration = Decoration.mark({
                class: 'internal-link-mark',
                attributes: {
                    'data-filename': filename,
                    'data-link-type': 'internal',
                    'title': `Open "${filename}"`,
                    'style': 'cursor: pointer; color: var(--text-accent); text-decoration: none;'
                }
            });
            
            newDecorations.push(decoration.range(from, to));
        }
        
        // Scan for markdown links [name](url)
        markdownLinkRegex.lastIndex = 0;
        while ((match = markdownLinkRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const linkText = match[1];
            const url = match[2];
            
            markdownLinkRanges.push({from, to});
            
            console.log('Found markdown link:', { match: match[0], linkText, url, from, to });
            
            // Check if cursor/selection is within this markdown link range
            const cursorInRange = selection && (
                (selection.from >= from && selection.from <= to) ||
                (selection.to >= from && selection.to <= to) ||
                (selection.from <= from && selection.to >= to)
            );
            
            if (cursorInRange) {
                console.log('Cursor in markdown link range, showing original text');
                // Show original text when cursor is in range - use mark decoration
                const decoration = Decoration.mark({
                    class: 'markdown-link-editing',
                    attributes: {
                        'data-url': url,
                        'data-link-type': 'markdown',
                        'title': `Link: ${url}`,
                        'style': 'cursor: pointer; color: var(--text-accent); background-color: var(--background-modifier-hover);'
                    }
                });
                newDecorations.push(decoration.range(from, to));
            } else {
                console.log('Cursor outside markdown link range, showing widget');
                // Show widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new MarkdownLinkWidget(linkText, url)
                });
                newDecorations.push(decoration.range(from, to));
            }
        }
        
        // Scan for standalone URLs (but not if they're already part of markdown links, images, or code blocks)
        const excludedPositions = new Set<number>();
        markdownLinkRanges.forEach(range => {
            for (let i = range.from; i < range.to; i++) {
                excludedPositions.add(i);
            }
        });
        imageRanges.forEach(range => {
            for (let i = range.from; i < range.to; i++) {
                excludedPositions.add(i);
            }
        });
        codeBlockRanges.forEach(range => {
            for (let i = range.from; i < range.to; i++) {
                excludedPositions.add(i);
            }
        });
        
        urlRegex.lastIndex = 0;
        while ((match = urlRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const url = match[1];
            
            // Skip if this URL is part of a markdown link or image
            if (excludedPositions.has(from)) continue;
            
            console.log('Found standalone URL:', { match: match[0], url, from, to });
            
            const decoration = Decoration.mark({
                class: 'url-link-mark',
                attributes: {
                    'data-url': url,
                    'data-link-type': 'url',
                    'title': `Open ${url}`,
                    'style': 'cursor: pointer; color: var(--text-accent); text-decoration: underline;'
                }
            });
            
            newDecorations.push(decoration.range(from, to));
        }
        
        // Sort decorations by position to avoid the "Ranges must be added sorted" error
        newDecorations.sort((a, b) => a.from - b.from);
        
        console.log('Creating decorations:', newDecorations.length);
        return newDecorations;
    }

    const linkField = StateField.define<DecorationSet>({
        create(state) {
            console.log('Creating link field with initial state');
            const text = state.doc.toString();
            const selection = state.selection.main;
            const decorations = scanForLinks(text, selection);
            return Decoration.set(decorations);
        },
        update(decorations, tr) {
            decorations = decorations.map(tr.changes);
            
            if (tr.docChanged || tr.selection) {
                const text = tr.state.doc.toString();
                const selection = tr.state.selection.main;
                console.log('Document or selection changed, rescanning for links');
                const newDecorations = scanForLinks(text, selection);
                decorations = Decoration.set(newDecorations);
            }
            
            return decorations;
        },
        provide: f => EditorView.decorations.from(f)
    });
    
    return [linkField];
}

export class SurveyNoteView extends ItemView {
    plugin: SurveyNotePlugin;
    file: TFile;
    private editorData: Record<string, string> = {};
    private editors: Record<string, EditorView> = {};
    private saveTimeout: NodeJS.Timeout | null = null;
    private isUpdating: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: SurveyNotePlugin) {
        super(leaf);
        this.plugin = plugin;
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
        this.addAction("file-text", "Markdown表示に切り替え", () => {
            this.setMarkdownView();
        });
        this.applyStyles();
    }

    async onClose() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        for (const key in this.editors) {
            this.editors[key].destroy();
        }
    }

    applyStyles() {
        const container = this.containerEl.children[1] as HTMLElement;
        if (!container) return;

        // Apply theme
        const theme = this.plugin.settings.theme;
        const isObsidianDark = document.body.classList.contains('theme-dark');
        let finalTheme: 'dark' | 'light';
        if (theme === 'auto') {
            finalTheme = isObsidianDark ? 'dark' : 'light';
        } else {
            finalTheme = theme;
        }
        container.removeClass('surveynote-theme-dark', 'surveynote-theme-light');
        container.addClass(`surveynote-theme-${finalTheme}`);

        // Apply font size
        const fontSize = this.plugin.settings.fontSize;
        container.style.setProperty('--surveynote-font-size', `${fontSize}px`);
    }

    private async parseMarkdownContent(content: string): Promise<Record<string, string>> {
        const lines = content.split("\n");
        const sections: Record<string, string> = {};
        let currentSection = "";

        const sectionOrder = Object.values(SECTIONS).sort((a, b) => b.length - a.length);

        for (const line of lines) {
            let isHeading = false;
            for (const sectionTitle of sectionOrder) {
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

    getState() {
        const state = super.getState();
        state.file = this.file?.path;
        return state;
    }

    async setState(state: any, result: ViewStateResult): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(state.file);
        if (file instanceof TFile) {
            this.file = file;
            await this.renderView();
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
        if (!this.file || this.isUpdating) return;
        this.isUpdating = true;

        try {
            let newSectionContent = "";
            const sectionOrder = [
                SECTIONS.BACKGROUND, SECTIONS.SUMMARY,
                SECTIONS.CONTENT1, SECTIONS.SUPPLEMENT,
                SECTIONS.CONTENT2
            ];

            for (const sectionTitle of sectionOrder) {
                const sectionContent = this.editorData[sectionTitle];
                if (sectionContent !== undefined && sectionContent.trim() !== '') {
                    newSectionContent += `## ${sectionTitle}\n${sectionContent.trim()}\n\n`;
                }
            }

            const fileCache = this.app.metadataCache.getFileCache(this.file);
            const originalContent = await this.app.vault.read(this.file);
            let finalContent = "";

            if (fileCache?.frontmatter && fileCache.frontmatterPosition) {
                const frontmatterEndOffset = fileCache.frontmatterPosition.end.offset;
                const frontmatter = originalContent.substring(0, frontmatterEndOffset);
                finalContent = `${frontmatter.trim()}\n\n${newSectionContent.trim()}`;
            } else {
                finalContent = newSectionContent.trim();
            }

            if (originalContent.trim() !== finalContent.trim()) {
                await this.app.vault.modify(this.file, finalContent);
            }
        } finally {
            this.isUpdating = false;
        }
    }

    private debouncedSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveMarkdown();
            this.saveTimeout = null;
        }, 1000);
    }

    async renderView() {
        await this.parseMarkdown();
        const container = this.containerEl.children[1];
        container.empty();
        this.applyStyles(); // Apply styles on render

        const rootEl = container.createDiv({ cls: "surveynote-view-root" });
        const headerEl = rootEl.createDiv({ cls: "surveynote-view-header" });
        
        const titleInput = headerEl.createEl("input", {
            type: "text",
            value: this.getDisplayText(),
            cls: "surveynote-title-input"
        });

        let isComposing = false;

        this.registerDomEvent(titleInput, 'compositionstart', () => {
            isComposing = true;
        });

        this.registerDomEvent(titleInput, 'compositionend', () => {
            isComposing = false;
        });

        this.registerDomEvent(titleInput, 'blur', () => {
            this.handleTitleRename(titleInput.value);
        });

        this.registerDomEvent(titleInput, 'keydown', (evt) => {
            if (evt.key === 'Enter' && !isComposing) {
                this.handleTitleRename(titleInput.value);
                titleInput.blur();
            }
        });

        const gridEl = rootEl.createDiv({ cls: "surveynote-view-grid" });

        Object.entries(SECTIONS).forEach(([key, title]) => {
            const cls = key.toLowerCase();
            this.createGridItem(gridEl, title, cls);
        });
    }

    async handleTitleRename(newTitle: string) {
        if (!this.file.parent) {
            new Notice("Cannot rename file in the root folder.");
            return;
        }

        const oldPath = this.file.path;
        const oldTitle = this.file.basename;

        if (newTitle === oldTitle) {
            return;
        }

        if (!newTitle || newTitle.trim().length === 0) {
            new Notice("File name cannot be empty.");
            const titleInput = this.containerEl.querySelector('.surveynote-title-input') as HTMLInputElement;
            if(titleInput) titleInput.value = oldTitle;
            return;
        }

        const newPath = `${this.file.parent.path}/${newTitle}.md`;

        try {
            await this.app.fileManager.renameFile(this.file, newPath);
        } catch (err) {
            new Notice(`Error renaming file: ${err.message}`);
            const titleInput = this.containerEl.querySelector('.surveynote-title-input') as HTMLInputElement;
            if(titleInput) titleInput.value = oldTitle;
        }
    }

    createGridItem(parent: HTMLElement, title: string, cls: string) {
        console.log('Creating grid item:', title);
        const itemEl = parent.createDiv({ cls: `grid-item ${cls}` });
        const contentContainer = itemEl.createDiv({ cls: "grid-item-content" });

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                this.editorData[title] = update.state.doc.toString();
                this.debouncedSave();
            }
        });

        console.log('Creating editor state with internal link support');
        const state = EditorState.create({
            doc: this.editorData[title] || "",
            extensions: [
                keymap.of([...defaultKeymap, indentWithTab]),
                markdown({ base: markdownLanguage }),
                ...createInternalLinkExtension(this.plugin),
                EditorView.lineWrapping,
                syntaxHighlighting(markdownHighlighting),
                updateListener,
            ],
        });

        const editor = new EditorView({ state, parent: contentContainer });
        this.editors[title] = editor;

        // Add code block edit handler using standard addEventListener
        contentContainer.addEventListener('editCodeBlock', (event: Event) => {
            console.log('Edit code block event received');
            const customEvent = event as CustomEvent;
            const codeBlockContainer = customEvent.detail.target;
            
            // Find the position of this code block in the editor
            const editorElement = contentContainer.querySelector('.cm-editor');
            if (editorElement && codeBlockContainer) {
                // Focus the editor and try to position cursor at the code block
                editor.focus();
                
                // We'll search for the code block pattern in the text and position cursor there
                const text = editor.state.doc.toString();
                const codeBlockRegex = /```[\w]*\n?[\s\S]*?\n?```/g;
                let match;
                let blockIndex = 0;
                
                // Find all code blocks and determine which one was clicked
                const allCodeBlocks = contentContainer.querySelectorAll('.code-block-widget-container');
                const clickedIndex = Array.from(allCodeBlocks).indexOf(codeBlockContainer);
                
                while ((match = codeBlockRegex.exec(text)) !== null && blockIndex <= clickedIndex) {
                    if (blockIndex === clickedIndex) {
                        // Position cursor at the start of this code block
                        const pos = match.index + 3; // Position after the opening ```
                        editor.dispatch({
                            selection: { anchor: pos, head: pos },
                            scrollIntoView: true
                        });
                        console.log('Cursor positioned at code block', blockIndex, 'position', pos);
                        break;
                    }
                    blockIndex++;
                }
            }
        });

        // Add click handler for links
        this.registerDomEvent(contentContainer, 'click', (event) => {
            console.log('Click event detected:', event.target);
            const target = event.target as HTMLElement;
            console.log('Target classes:', target.className);
            
            // Check for internal links
            let linkElement: HTMLElement | null = null;
            if (target.classList.contains('internal-link-mark')) {
                linkElement = target;
            } else {
                linkElement = target.closest('.internal-link-mark') as HTMLElement;
            }
            
            if (linkElement) {
                const linkType = linkElement.getAttribute('data-link-type');
                console.log('Link type:', linkType);
                
                if (linkType === 'internal') {
                    const filename = linkElement.getAttribute('data-filename');
                    console.log('Filename from data attribute:', filename);
                    if (filename) {
                        console.log('Internal link clicked via DOM event:', filename);
                        event.preventDefault();
                        event.stopPropagation();
                        this.openInternalLink(filename);
                    }
                }
                return;
            }
            
            // Check for URL links
            let urlElement: HTMLElement | null = null;
            if (target.classList.contains('url-link-mark')) {
                urlElement = target;
            } else {
                urlElement = target.closest('.url-link-mark') as HTMLElement;
            }
            
            if (urlElement) {
                const url = urlElement.getAttribute('data-url');
                console.log('URL from data attribute:', url);
                if (url) {
                    console.log('URL link clicked via DOM event:', url);
                    event.preventDefault();
                    event.stopPropagation();
                    this.openUrl(url);
                }
                return;
            }
            
            // Check for markdown links in editing mode
            let markdownElement: HTMLElement | null = null;
            if (target.classList.contains('markdown-link-editing')) {
                markdownElement = target;
            } else {
                markdownElement = target.closest('.markdown-link-editing') as HTMLElement;
            }
            
            if (markdownElement) {
                const url = markdownElement.getAttribute('data-url');
                console.log('Markdown link URL from data attribute:', url);
                if (url) {
                    console.log('Markdown link clicked via DOM event:', url);
                    event.preventDefault();
                    event.stopPropagation();
                    this.openUrl(url);
                }
            }
        });

        // Add hover effects
        this.registerDomEvent(contentContainer, 'mouseenter', (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('internal-link-mark')) {
                target.style.textDecoration = 'underline';
            }
        }, true);

        this.registerDomEvent(contentContainer, 'mouseleave', (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('internal-link-mark')) {
                target.style.textDecoration = 'none';
            }
        }, true);

        // Use standard DOM event listeners on the parent container
        this.registerDomEvent(contentContainer, 'dragover', (event) => {
            event.preventDefault();
        });

        this.registerDomEvent(contentContainer, 'drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
                for (const file of Array.from(files)) {
                    if (file.type.startsWith("image/")) {
                        this.handleImageDrop(file, editor, title);
                    }
                }
            }
        });
    }

    private async openInternalLink(filename: string) {
        console.log('Opening internal link:', filename);
        const targetFile = this.plugin.app.vault.getAbstractFileByPath(filename + '.md') || 
                          this.plugin.app.metadataCache.getFirstLinkpathDest(filename, '');
        
        console.log('Target file found:', !!targetFile, targetFile?.path);
        
        if (targetFile instanceof TFile) {
            const leaf = this.plugin.app.workspace.getUnpinnedLeaf();
            console.log('Opening file in leaf');
            await leaf.openFile(targetFile);
        } else {
            console.log('File not found:', filename);
            new Notice(`File "${filename}" not found.`);
        }
    }

    private openUrl(url: string) {
        console.log('Opening URL in browser:', url);
        window.open(url, '_blank');
    }

    private async handleImageDrop(file: File, view: EditorView, title: string) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const newFileParent = this.app.fileManager.getNewFileParent(this.file.path);
            const extension = file.name.split('.').pop() || 'png';
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            
            let filePath: string;
            let counter = 0;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

            do {
                const suffix = counter === 0 ? '' : `-${counter}`;
                const filename = `${baseName}-${timestamp}${suffix}.${extension}`;
                filePath = `${newFileParent.path}/${filename}`;
                counter++;
            } while (await this.app.vault.adapter.exists(filePath));

            const createdFile = await this.app.vault.createBinary(filePath, arrayBuffer);
            const markdownLink = this.app.fileManager.generateMarkdownLink(createdFile, this.file.path);

            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: `\n${markdownLink}\n` }
            });

            this.editorData[title] = view.state.doc.toString();
            await this.saveMarkdown();
            
        } catch (error) {
            console.error('Error handling image drop:', error);
            new Notice('画像の保存に失敗しました: ' + error.message);
        }
    }
}
