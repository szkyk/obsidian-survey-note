import { ItemView, WorkspaceLeaf, TFile, ViewStateResult, Notice } from "obsidian";
import { EditorState, StateField, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, keymap, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, history, historyKeymap } from "@codemirror/commands";
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

class ListBulletWidget extends WidgetType {
    constructor(
        private indent: string, 
        private hasChildren: boolean = false, 
        private isCollapsed: boolean = false,
        private lineNumber: number = 0
    ) {
        super();
    }

    eq(other: ListBulletWidget) {
        return other.indent === this.indent && 
               other.hasChildren === this.hasChildren && 
               other.isCollapsed === this.isCollapsed &&
               other.lineNumber === this.lineNumber;
    }

    toDOM() {
        const container = document.createElement('span');
        container.className = 'list-bullet-widget-container';
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.userSelect = 'none';
        
        // Convert spaces to deeper indentation
        const deeperIndent = this.indent.replace(/  /g, '    ');
        const tabIndent = this.indent.replace(/\t/g, '    ');
        const finalIndent = deeperIndent || tabIndent;
        
        // Add indent spacing
        if (finalIndent) {
            const indentSpan = document.createElement('span');
            indentSpan.textContent = finalIndent;
            indentSpan.style.whiteSpace = 'pre';
            container.appendChild(indentSpan);
        }
        
        // Add chevron if has children
        if (this.hasChildren) {
            const chevron = document.createElement('span');
            chevron.className = 'list-chevron';
            chevron.textContent = this.isCollapsed ? '▶' : '▼';
            chevron.style.cursor = 'pointer';
            chevron.style.marginRight = '4px';
            chevron.style.marginLeft = '-8px'; // Move slightly left but not too much
            chevron.style.fontSize = '0.8em';
            chevron.style.color = 'var(--text-muted)';
            chevron.style.transition = 'transform 0.2s ease, color 0.2s ease';
            chevron.style.userSelect = 'none';
            chevron.style.display = 'inline-flex';
            chevron.style.alignItems = 'center';
            chevron.style.justifyContent = 'center';
            chevron.style.width = '16px';
            chevron.style.height = '16px';
            chevron.style.borderRadius = '2px';
            chevron.style.position = 'relative';
            chevron.style.zIndex = '10';
            
            // Add click handler for chevron
            chevron.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Chevron clicked for line:', this.lineNumber, 'collapsed:', this.isCollapsed);
                
                // Dispatch custom event to toggle collapse state
                const toggleEvent = new CustomEvent('toggleListCollapse', {
                    detail: { 
                        lineNumber: this.lineNumber, 
                        isCollapsed: this.isCollapsed,
                        indent: this.indent
                    },
                    bubbles: true
                });
                chevron.dispatchEvent(toggleEvent);
            });
            
            // Add hover effects
            chevron.addEventListener('mouseenter', () => {
                chevron.style.color = 'var(--text-normal)';
                chevron.style.backgroundColor = 'var(--background-modifier-hover)';
                chevron.style.transform = 'scale(1.1)';
            });
            
            chevron.addEventListener('mouseleave', () => {
                chevron.style.color = 'var(--text-muted)';
                chevron.style.backgroundColor = 'transparent';
                chevron.style.transform = 'scale(1)';
            });
            
            container.appendChild(chevron);
        }
        
        // Add bullet point
        const bullet = document.createElement('span');
        bullet.className = 'list-bullet-widget';
        bullet.textContent = '· ';
        bullet.style.color = 'var(--text-normal)';
        bullet.style.fontWeight = 'bold';
        bullet.style.fontSize = '1.2em';
        
        container.appendChild(bullet);
        
        return container;
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
        
        // Add copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'code-block-copy-button';
        copyButton.innerHTML = '📋'; // Copy icon
        copyButton.title = 'Copy code';
        copyButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Copy button clicked');
            navigator.clipboard.writeText(this.code).then(() => {
                console.log('Code copied to clipboard');
                // Show brief feedback
                copyButton.innerHTML = '✓';
                setTimeout(() => {
                    copyButton.innerHTML = '📋';
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy code:', err);
            });
        });
        
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
        container.appendChild(copyButton);
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


class CollapseStateWidget extends WidgetType {
    constructor(private state: 'collapsed' | 'hidden') {
        super();
    }

    eq(other: CollapseStateWidget) {
        return other.state === this.state;
    }

    toDOM() {
        const span = document.createElement('span');
        span.className = 'collapse-state-marker';
        span.textContent = this.state === 'collapsed' ? '<!--COLLAPSED-->' : '<!--HIDDEN-->';
        return span;
    }
}

function createInternalLinkExtension(plugin: SurveyNotePlugin) {
    const internalLinkRegex = /\[\[([^\]]+)\]\]/g;
    const internalImageRegex = /!\[\[([^\]]+)\]\]/g;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)\n?```/g;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const listItemRegex = /^(\s*)([-*])( +)/gm;
    const collapseMarkerRegex = /<!--(COLLAPSED|HIDDEN)-->/g;
    
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
    
    // Parse list structure to determine which items have children and should be hidden
    function parseListStructure(text: string): Map<number, { hasChildren: boolean, isCollapsed: boolean, shouldHide: boolean }> {
        const lines = text.split('\n');
        const listInfo = new Map<number, { hasChildren: boolean, isCollapsed: boolean, shouldHide: boolean }>();
        
        // First pass: identify all list items in the original text 
        const allListItems: Array<{ lineIndex: number, indentLevel: number, isCollapsed: boolean, originalLine: string }> = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Remove collapse markers for structure analysis but preserve original line
            const cleanLine = line.replace(/<!--(COLLAPSED|HIDDEN)-->/g, '');
            const match = cleanLine.match(/^(\s*)([-*])( +)/);
            
            if (match) {
                const indent = match[1];
                const indentLevel = indent.length;
                const isCollapsed = line.includes('<!--COLLAPSED-->');
                
                allListItems.push({ lineIndex: i, indentLevel, isCollapsed, originalLine: line });
            }
        }
        
        // Second pass: determine children and visibility for each item
        for (let i = 0; i < allListItems.length; i++) {
            const currentItem = allListItems[i];
            let hasChildren = false;
            let shouldHide = false;
            
            // Check if this item has children (always check the complete structure based on indentation)
            for (let j = i + 1; j < allListItems.length; j++) {
                const nextItem = allListItems[j];
                if (nextItem.indentLevel > currentItem.indentLevel) {
                    hasChildren = true;
                    break;
                } else if (nextItem.indentLevel <= currentItem.indentLevel) {
                    // Found an item at same or lesser indentation level, so no more children
                    break;
                }
            }
            
            // Check if this item should be hidden (any ancestor is collapsed)
            for (let j = i - 1; j >= 0; j--) {
                const potentialParent = allListItems[j];
                if (potentialParent.indentLevel < currentItem.indentLevel) {
                    // This is a parent - check if it's collapsed
                    if (potentialParent.isCollapsed) {
                        shouldHide = true;
                        break; // Found the immediate collapsed parent
                    }
                    // If we find a parent at the same or less indentation that's not collapsed,
                    // we can stop checking further up the hierarchy
                    if (potentialParent.indentLevel <= currentItem.indentLevel - 2) {
                        break;
                    }
                }
            }
            
            listInfo.set(currentItem.lineIndex, { 
                hasChildren, 
                isCollapsed: currentItem.isCollapsed, 
                shouldHide 
            });
            
            console.log(`parseListStructure: Line ${currentItem.lineIndex}: indent=${currentItem.indentLevel}, hasChildren=${hasChildren}, isCollapsed=${currentItem.isCollapsed}, shouldHide=${shouldHide}, line="${currentItem.originalLine.trim()}"`);
        }
        
        return listInfo;
    }

    function scanForLinks(text: string, selection?: { from: number; to: number }): Range<Decoration>[] {
        console.log('Scanning for links in text:', text, 'Selection:', selection);
        const newDecorations: Range<Decoration>[] = [];
        
        // Parse list structure first
        const listStructure = parseListStructure(text);
        
        // Store markdown link, image, code block, and list item positions for URL scanning
        const markdownLinkRanges: Array<{from: number, to: number}> = [];
        const imageRanges: Array<{from: number, to: number}> = [];
        const codeBlockRanges: Array<{from: number, to: number}> = [];
        const listItemRanges: Array<{from: number, to: number}> = [];
        const hiddenLineRanges: Array<{from: number, to: number}> = [];
        
        // First, handle hidden lines due to collapsed parents
        const lines = text.split('\n');
        let lineStart = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = lineStart + line.length;
            
            // Check if this line should be hidden
            const lineInfo = listStructure.get(i);
            if (lineInfo && lineInfo.shouldHide) {
                console.log('scanForLinks: Processing hidden line:', i, `"${line}"`);
                
                // Hide the entire line including newline
                const hideStart = lineStart;
                const hideEnd = i < lines.length - 1 ? lineEnd + 1 : lineEnd; // Include newline if not last line
                
                hiddenLineRanges.push({from: hideStart, to: hideEnd});
                
                const decoration = Decoration.replace({
                    widget: new class extends WidgetType {
                        toDOM() {
                            const span = document.createElement('span');
                            span.style.display = 'none';
                            span.style.visibility = 'hidden';
                            span.style.height = '0';
                            span.style.width = '0';
                            span.style.margin = '0';
                            span.style.padding = '0';
                            span.style.overflow = 'hidden';
                            return span;
                        }
                    }()
                });
                newDecorations.push(decoration.range(hideStart, hideEnd));
            }
            
            lineStart = lineEnd + 1; // +1 for newline character
        }
        
        // Scan for code blocks ```language\ncode```
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
        
        // Scan for collapse state markers
        collapseMarkerRegex.lastIndex = 0;
        while ((match = collapseMarkerRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const markerType = match[1].toLowerCase();
            
            console.log('scanForLinks: Found collapse marker:', { 
                match: `"${match[0]}"`, 
                type: markerType, 
                from, 
                to 
            });
            
            // Replace marker with hidden widget
            const decoration = Decoration.replace({
                widget: new CollapseStateWidget(markerType as 'collapsed' | 'hidden')
            });
            newDecorations.push(decoration.range(from, to));
        }
        
        
        // Scan for list items (- or * at the beginning of line with spaces)
        let currentPos = 0;
        
        listItemRegex.lastIndex = 0;
        while ((match = listItemRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const indent = match[1]; // Leading spaces/tabs
            const bullet = match[2]; // - or *
            const spaces = match[3]; // Spaces after bullet
            
            listItemRanges.push({from, to});
            
            // Find which line this match corresponds to
            let lineNumber = 0;
            lineStart = 0;
            for (let i = 0; i < lines.length; i++) {
                const lineEnd = lineStart + lines[i].length;
                if (from >= lineStart && from <= lineEnd) {
                    lineNumber = i;
                    break;
                }
                lineStart = lineEnd + 1; // +1 for newline character
            }
            
            // Get list structure info for this line
            const listInfo = listStructure.get(lineNumber) || { hasChildren: false, isCollapsed: false, shouldHide: false };
            
            // Skip creating list widgets for items that should be hidden or overlap with hidden ranges
            const overlapsWithHidden = hiddenLineRanges.some(range => 
                (from >= range.from && from < range.to) || 
                (to > range.from && to <= range.to) ||
                (from <= range.from && to >= range.to)
            );
            
            if (listInfo.shouldHide || overlapsWithHidden) {
                console.log('scanForLinks: Skipping list widget creation for hidden line:', lineNumber, `"${lines[lineNumber]}"`, 'shouldHide:', listInfo.shouldHide, 'overlapsWithHidden:', overlapsWithHidden);
                continue;
            }
            
            console.log('scanForLinks: Found list item:', { 
                match: `"${match[0]}"`, 
                indent: `"${indent}"`, 
                bullet: `"${bullet}"`, 
                spaces: `"${spaces}"`, 
                from, 
                to,
                lineNumber,
                hasChildren: listInfo.hasChildren,
                isCollapsed: listInfo.isCollapsed,
                shouldHide: listInfo.shouldHide
            });
            
            // Replace the entire match (indent + bullet + spaces) with our custom widget
            const decoration = Decoration.replace({
                widget: new ListBulletWidget(indent, listInfo.hasChildren, listInfo.isCollapsed, lineNumber)
            });
            newDecorations.push(decoration.range(from, to));
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
            
            // Skip if this position overlaps with an image, code block, or list item range
            const overlapsWithSpecial = [...imageRanges, ...codeBlockRanges, ...listItemRanges].some(range => 
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
        
        // Scan for standalone URLs (but not if they're already part of markdown links, images, code blocks, or list items)
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
        listItemRanges.forEach(range => {
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
            // If document changed, completely rebuild decorations instead of mapping
            if (tr.docChanged) {
                const text = tr.state.doc.toString();
                const selection = tr.state.selection.main;
                console.log('Document changed, rebuilding all decorations');
                const newDecorations = scanForLinks(text, selection);
                return Decoration.set(newDecorations);
            }
            
            // For selection changes only, try to map existing decorations safely
            if (tr.selection) {
                try {
                    decorations = decorations.map(tr.changes);
                    const text = tr.state.doc.toString();
                    const selection = tr.state.selection.main;
                    console.log('Selection changed, rescanning for links');
                    const newDecorations = scanForLinks(text, selection);
                    return Decoration.set(newDecorations);
                } catch (error) {
                    console.log('Error mapping decorations, rebuilding:', error);
                    const text = tr.state.doc.toString();
                    const selection = tr.state.selection.main;
                    const newDecorations = scanForLinks(text, selection);
                    return Decoration.set(newDecorations);
                }
            }
            
            return decorations;
        },
        provide: f => EditorView.decorations.from(f)
    });
    
    return [linkField];
}

function createListInputHandler() {
    function handleInput(view: EditorView, from: number, to: number, text: string): boolean {
        console.log('handleInput: Input handler called:', { 
            from, 
            to, 
            text: `"${text}"`, 
            charCode: text.charCodeAt(0),
            length: text.length 
        });
        
        // Check if space was just typed
        if (text === ' ') {
            const doc = view.state.doc;
            const line = doc.lineAt(from);
            const lineText = line.text;
            const pos = from - line.from;
            
            console.log('handleInput: Space typed at position:', pos, 'in line:', `"${lineText}"`);
            console.log('handleInput: Current line length:', lineText.length, 'cursor relative pos:', pos);
            
            // Check if we're after - or * at the beginning of a line
            if (pos >= 1) {
                const beforeCursor = lineText.substring(0, pos);
                console.log('handleInput: Text before cursor:', `"${beforeCursor}"`);
                
                const match = beforeCursor.match(/^(\s*)([-*])$/);
                
                if (match) {
                    const indent = match[1];
                    const bullet = match[2];
                    
                    console.log('handleInput: MATCHED! Converting list item:', { 
                        indent: `"${indent}"`, 
                        bullet: `"${bullet}"`,
                        indentLength: indent.length,
                        totalMatch: `"${match[0]}"`
                    });
                    
                    // Replace the bullet with bullet + space to create the list pattern
                    const lineStart = line.from;
                    const bulletStart = lineStart + indent.length;
                    const bulletEnd = lineStart + beforeCursor.length;
                    
                    console.log('handleInput: Making change:', {
                        lineStart,
                        bulletStart,
                        bulletEnd,
                        replacing: `"${lineText.substring(indent.length, pos)}"`,
                        with: `"${bullet} "`
                    });
                    
                    // Create a combined transaction that includes both the bullet conversion 
                    // and the space insertion, so it appears as one undoable action
                    view.dispatch({
                        changes: [
                            {
                                from: bulletStart,
                                to: bulletEnd,
                                insert: bullet
                            },
                            {
                                from: bulletEnd,
                                to: bulletEnd,
                                insert: ' '
                            }
                        ],
                        selection: { anchor: bulletStart + 2 }, // Position after the bullet and space
                        userEvent: "input.type"
                    });
                    
                    console.log('handleInput: Combined change dispatched as single undoable action');
                    return true; // Prevent the space from being inserted again
                } else {
                    console.log('handleInput: No match for list pattern');
                }
            } else {
                console.log('handleInput: Position too early for list pattern');
            }
        } else {
            console.log('handleInput: Not a space character');
        }
        
        return false; // Allow default behavior
    }
    
    function handleBackspace(view: EditorView): boolean {
        const { state } = view;
        const { from, to } = state.selection.main;
        
        // Only handle when cursor is at a single position (not a selection)
        if (from !== to) return false;
        
        const doc = state.doc;
        const line = doc.lineAt(from);
        const lineText = line.text;
        const pos = from - line.from;
        
        console.log('handleBackspace: Backspace at position:', pos, 'in line:', `"${lineText}"`);
        
        // Check if we're at the beginning of a line that could have a list widget
        if (pos === 0 && lineText.length > 0) {
            // Check if this line would be displayed with a list widget
            // (i.e., it matches the pattern that would create a list widget)
            const listMatch = lineText.match(/^(\s*)(.+)$/);
            if (listMatch) {
                const indent = listMatch[1];
                const content = listMatch[2];
                
                console.log('handleBackspace: Line analysis:', {
                    indent: `"${indent}"`,
                    content: `"${content}"`,
                    hasContent: content.trim().length > 0
                });
                
                // Check if this looks like a line that would have a list widget
                // by seeing if it matches our list detection pattern when reconstructed
                const reconstructed = indent + '- ' + content;
                const testMatch = reconstructed.match(/^(\s*)([-*])(\s+)/);
                
                console.log('handleBackspace: Testing reconstruction:', {
                    reconstructed: `"${reconstructed}"`,
                    testMatch: !!testMatch
                });
                
                if (testMatch && content.trim().length > 0) {
                    console.log('handleBackspace: MATCHED! Converting back to regular list with indent:', `"${indent}"`);
                    
                    view.dispatch({
                        changes: {
                            from: line.from,
                            to: line.from + indent.length,
                            insert: indent + '- '
                        },
                        selection: { anchor: line.from + indent.length + 2 },
                        userEvent: "delete.backward"
                    });
                    
                    return true; // Prevent default backspace
                } else {
                    console.log('handleBackspace: No match for list reconstruction');
                }
            } else {
                console.log('handleBackspace: No line match');
            }
        } else {
            console.log('handleBackspace: Not at beginning of line or empty line');
        }
        
        return false; // Allow default behavior
    }
    
    function handleEnter(view: EditorView): boolean {
        const { state } = view;
        const { from, to } = state.selection.main;
        
        // Only handle when cursor is at a single position
        if (from !== to) return false;
        
        const doc = state.doc;
        const line = doc.lineAt(from);
        const lineText = line.text;
        const pos = from - line.from;
        
        console.log('handleEnter: Enter pressed at position:', pos, 'in line:', `"${lineText}"`);
        
        // Check if we're on a line that has list content
        const listMatch = lineText.match(/^(\s*)(.*)$/);
        if (listMatch) {
            const indent = listMatch[1];
            const content = listMatch[2].trim();
            
            console.log('handleEnter: Line analysis:', {
                indent: `"${indent}"`,
                content: `"${content}"`,
                hasContent: content.length > 0,
                posAfterIndent: pos >= indent.length
            });
            
            // If we're on a list line (has content) and not at the very beginning
            if (content.length > 0 && pos >= indent.length) {
                console.log('handleEnter: Creating new list item with indent:', `"${indent}"`);
                
                view.dispatch({
                    changes: {
                        from: from,
                        to: to,
                        insert: '\n' + indent
                    },
                    selection: { anchor: from + 1 + indent.length },
                    userEvent: "input.type"
                });
                
                return true; // Prevent default enter behavior
            } else {
                console.log('handleEnter: Not creating list item - no content or at beginning');
            }
        } else {
            console.log('handleEnter: No line match');
        }
        
        return false; // Allow default behavior
    }
    
    function handleTab(view: EditorView): boolean {
        const { state } = view;
        const { from, to } = state.selection.main;
        
        // Only handle when cursor is at a single position
        if (from !== to) return false;
        
        const doc = state.doc;
        const line = doc.lineAt(from);
        const lineText = line.text;
        const pos = from - line.from;
        
        console.log('handleTab: Tab pressed at position:', pos, 'in line:', `"${lineText}"`);
        
        // Check if we're at the beginning of a line or within the indent area
        const lineStart = line.from;
        const indentMatch = lineText.match(/^(\s*)/);
        
        if (indentMatch) {
            const currentIndent = indentMatch[1];
            const indentEnd = currentIndent.length;
            
            console.log('handleTab: Current indent analysis:', {
                currentIndent: `"${currentIndent}"`,
                indentEnd,
                cursorPos: pos,
                atBeginningOrIndent: pos <= indentEnd
            });
            
            // If we're at the beginning of the line or within the indent area
            if (pos <= indentEnd) {
                // Add 4 spaces for deeper indentation
                const newIndent = '    ';
                
                console.log('handleTab: Adding deeper indentation:', `"${newIndent}"`);
                
                view.dispatch({
                    changes: {
                        from: lineStart,
                        to: lineStart + currentIndent.length,
                        insert: currentIndent + newIndent
                    },
                    selection: { anchor: lineStart + currentIndent.length + newIndent.length },
                    userEvent: "input.indent"
                });
                
                return true; // Prevent default tab behavior
            } else {
                console.log('handleTab: Not at beginning/indent area, allowing default behavior');
            }
        }
        
        return false; // Allow default behavior
    }

    return [
        EditorView.inputHandler.of(handleInput),
        keymap.of([
            {
                key: "Backspace",
                run: handleBackspace
            },
            {
                key: "Enter",
                run: handleEnter
            },
            {
                key: "Tab",
                run: handleTab
            }
        ])
    ];
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

        console.log('Creating editor state with internal link support and list input handler');
        const state = EditorState.create({
            doc: this.editorData[title] || "",
            extensions: [
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                markdown({ base: markdownLanguage }),
                ...createInternalLinkExtension(this.plugin),
                ...createListInputHandler(),
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

        // Add handler for list collapse toggle
        contentContainer.addEventListener('toggleListCollapse', (event: Event) => {
            const customEvent = event as CustomEvent;
            const { lineNumber, isCollapsed, indent } = customEvent.detail;
            
            console.log('Toggle list collapse event:', { lineNumber, isCollapsed, indent });
            
            // Toggle the collapse state by manipulating the document
            this.toggleListCollapse(editor, lineNumber, isCollapsed, indent);
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

    private toggleListCollapse(editor: EditorView, lineNumber: number, isCollapsed: boolean, indent: string) {
        const doc = editor.state.doc;
        const lines = doc.toString().split('\n');
        
        if (lineNumber >= lines.length) {
            console.log('toggleListCollapse: Invalid line number', lineNumber, 'total lines:', lines.length);
            return;
        }
        
        const newCollapsedState = !isCollapsed;
        
        console.log('toggleListCollapse: Toggling collapse for line', lineNumber, 'from', isCollapsed, 'to', newCollapsedState);
        console.log('toggleListCollapse: Current line:', `"${lines[lineNumber]}"`);
        
        // Parse the current indent level of the parent item
        const parentLine = lines[lineNumber];
        const parentIndentMatch = parentLine.match(/^(\s*)/);
        const parentIndentLevel = parentIndentMatch ? parentIndentMatch[1].length : 0;
        
        console.log('toggleListCollapse: Parent indent level:', parentIndentLevel);
        
        // Find all child items that need to be toggled
        const changes = [];
        let lineStart = 0;
        
        // Calculate line positions and collect changes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = lineStart + line.length;
            
            if (i === lineNumber) {
                // Update parent line with collapsed marker
                let newLineContent: string;
                if (newCollapsedState) {
                    // Add collapsed marker if not already present
                    if (!line.includes('<!--COLLAPSED-->')) {
                        newLineContent = line + '<!--COLLAPSED-->';
                        console.log('toggleListCollapse: Adding COLLAPSED marker to parent');
                    } else {
                        console.log('toggleListCollapse: COLLAPSED marker already present on parent');
                        newLineContent = line;
                    }
                } else {
                    // Remove collapsed marker from parent
                    newLineContent = line.replace(/<!--COLLAPSED-->/g, '');
                    console.log('toggleListCollapse: Removing COLLAPSED marker from parent');
                }
                
                changes.push({
                    from: lineStart,
                    to: lineEnd,
                    insert: newLineContent
                });
            } else if (i > lineNumber) {
                // Check if this is a child item of the collapsed parent
                const lineIndentMatch = line.match(/^(\s*)([-*]\s+|.*)/);
                if (lineIndentMatch) {
                    const lineIndentLevel = lineIndentMatch[1].length;
                    const restOfLine = lineIndentMatch[2];
                    
                    // If indentation is greater than parent, it's a child
                    if (lineIndentLevel > parentIndentLevel && restOfLine.trim().length > 0) {
                        // Check if we've reached the next sibling or parent (same or lesser indentation)
                        let isChild = true;
                        
                        // Look ahead to see if there's a list item at same or lesser indentation
                        const nextListItemMatch = restOfLine.match(/^([-*]\s+)/);
                        if (nextListItemMatch && lineIndentLevel <= parentIndentLevel) {
                            isChild = false;
                        }
                        
                        if (isChild) {
                            let newChildContent: string;
                            if (newCollapsedState) {
                                // Add HIDDEN marker if not already present
                                if (!line.includes('<!--HIDDEN-->')) {
                                    newChildContent = line + '<!--HIDDEN-->';
                                    console.log('toggleListCollapse: Adding HIDDEN marker to child line', i);
                                } else {
                                    newChildContent = line;
                                }
                            } else {
                                // Remove HIDDEN marker
                                newChildContent = line.replace(/<!--HIDDEN-->/g, '');
                                console.log('toggleListCollapse: Removing HIDDEN marker from child line', i);
                            }
                            
                            changes.push({
                                from: lineStart,
                                to: lineEnd,
                                insert: newChildContent
                            });
                        }
                    } else if (lineIndentLevel <= parentIndentLevel && restOfLine.match(/^[-*]\s+/)) {
                        // Found next sibling or parent item, stop processing children
                        console.log('toggleListCollapse: Found next sibling/parent at line', i, 'stopping child processing');
                        break;
                    }
                }
            }
            
            lineStart = lineEnd + 1; // +1 for newline character
        }
        
        console.log('toggleListCollapse: Applying', changes.length, 'changes');
        
        // Apply all changes in a single transaction
        if (changes.length > 0) {
            editor.dispatch({
                changes: changes,
                userEvent: "select.pointer"
            });
            
            console.log('toggleListCollapse: Document updated successfully with', changes.length, 'changes');
        }
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
