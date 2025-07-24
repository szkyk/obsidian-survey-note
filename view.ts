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
    CONTENT2: "Content2",
    CONTENT3: "Content3",
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

class CheckboxWidget extends WidgetType {
    constructor(
        private indent: string,
        private isChecked: boolean,
        private lineNumber: number = 0,
        private hasChildren: boolean = false,
        private isCollapsed: boolean = false
    ) {
        super();
    }

    eq(other: CheckboxWidget) {
        return other.indent === this.indent && 
               other.isChecked === this.isChecked &&
               other.lineNumber === this.lineNumber &&
               other.hasChildren === this.hasChildren &&
               other.isCollapsed === this.isCollapsed;
    }

    toDOM() {
        const container = document.createElement('span');
        container.className = 'checkbox-widget-container';
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.userSelect = 'none';
        
        // Convert spaces to deeper indentation (same as list bullets)
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
            chevron.className = 'checkbox-chevron';
            chevron.textContent = this.isCollapsed ? '▶' : '▼';
            chevron.style.cursor = 'pointer';
            chevron.style.marginRight = '4px';
            chevron.style.marginLeft = '-8px';
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
                console.log('Checkbox chevron clicked for line:', this.lineNumber, 'collapsed:', this.isCollapsed);
                
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
        
        // Add custom checkbox
        const checkbox = document.createElement('div');
        checkbox.className = `checkbox-widget ${this.isChecked ? 'checked' : ''}`;
        checkbox.style.cursor = 'pointer';
        
        // Add checkmark if checked
        if (this.isChecked) {
            const checkmark = document.createElement('div');
            checkmark.className = 'checkbox-checkmark';
            checkmark.innerHTML = '✓';
            checkbox.appendChild(checkmark);
        }
        
        // Add click handler for checkbox toggle
        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Checkbox clicked for line:', this.lineNumber, 'current state:', this.isChecked);
            
            // Dispatch custom event to toggle checkbox state
            const toggleEvent = new CustomEvent('toggleCheckbox', {
                detail: { 
                    lineNumber: this.lineNumber, 
                    isChecked: this.isChecked,
                    indent: this.indent
                },
                bubbles: true
            });
            checkbox.dispatchEvent(toggleEvent);
        });
        
        container.appendChild(checkbox);
        
        return container;
    }
}

class CodeBlockWidget extends WidgetType {
    constructor(private code: string, private language: string = '', private isCollapsed: boolean = true) {
        super();
    }

    eq(other: CodeBlockWidget) {
        return other.code === this.code && other.language === this.language && other.isCollapsed === this.isCollapsed;
    }

    toDOM() {
        const container = document.createElement('div');
        container.className = 'code-block-widget-container';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'code-block-buttons';
        
        // Add collapse button
        const collapseButton = document.createElement('button');
        collapseButton.className = 'code-block-collapse-button';
        collapseButton.innerHTML = this.isCollapsed ? '⊞' : '⊟';
        collapseButton.title = this.isCollapsed ? 'Expand code block' : 'Collapse code block';
        collapseButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const toggleEvent = new CustomEvent('toggleCodeBlockCollapse', {
                detail: { target: container, isCollapsed: this.isCollapsed },
                bubbles: true
            });
            container.dispatchEvent(toggleEvent);
        });
        
        // Add copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'code-block-copy-button';
        copyButton.innerHTML = '📋';
        copyButton.title = 'Copy code';
        copyButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Copy button clicked');
            navigator.clipboard.writeText(this.code).then(() => {
                console.log('Code copied to clipboard');
                copyButton.innerHTML = '✓';
                setTimeout(() => {
                    copyButton.innerHTML = '📋';
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy code:', err);
            });
        });
        
        buttonContainer.appendChild(collapseButton);
        buttonContainer.appendChild(copyButton);
        
        const pre = document.createElement('pre');
        pre.className = 'code-block-widget';
        pre.style.position = 'relative';
        
        const code = document.createElement('code');
        if (this.language) {
            code.className = `language-${this.language}`;
        }
        code.textContent = this.code;
        
        // Show/hide content based on collapsed state
        if (this.isCollapsed) {
            const collapsedPreview = document.createElement('div');
            collapsedPreview.className = 'code-block-collapsed';
            collapsedPreview.textContent = `${this.language ? `[${this.language}] ` : ''}Code block (${this.code.split('\n').length} lines)`;
            pre.appendChild(collapsedPreview);
        } else {
            pre.appendChild(code);
        }
        
        // Make the code block clickable to focus and allow cursor positioning
        container.addEventListener('click', (e) => {
            console.log('Code block clicked, focusing for editing');
            e.preventDefault();
            e.stopPropagation();
            
            const customEvent = new CustomEvent('editCodeBlock', {
                detail: { target: container },
                bubbles: true
            });
            container.dispatchEvent(customEvent);
        });
        
        container.style.cursor = 'text';
        container.title = 'Click to edit code block';
        
        pre.appendChild(buttonContainer);
        container.appendChild(pre);
        
        return container;
    }
}

class MultiImageWidget extends WidgetType {
    constructor(
        private images: Array<{altText: string, imagePath: string, width?: number, height?: number}>,
        private plugin: SurveyNotePlugin
    ) {
        super();
    }

    eq(other: MultiImageWidget) {
        return JSON.stringify(this.images) === JSON.stringify(other.images);
    }

    toDOM() {
        const container = document.createElement('div');
        container.className = 'multi-image-container';
        
        this.images.forEach((imageData, index) => {
            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'multi-image-item';
            
            // Create individual image widget and append to wrapper
            const singleImageWidget = new ImageWidget(
                imageData.altText, 
                imageData.imagePath, 
                this.plugin, 
                imageData.width, 
                imageData.height
            );
            
            const imageDOM = singleImageWidget.toDOM();
            
            // Remove the default margin from individual image containers in multi-image context
            imageDOM.style.margin = '0';
            imageDOM.style.display = 'inline-block';
            
            imageWrapper.appendChild(imageDOM);
            container.appendChild(imageWrapper);
        });
        
        return container;
    }
}

class ImageWidget extends WidgetType {
    constructor(
        private altText: string, 
        private imagePath: string, 
        private plugin: SurveyNotePlugin,
        private width?: number,
        private height?: number
    ) {
        super();
    }

    eq(other: ImageWidget) {
        return other.altText === this.altText && 
               other.imagePath === this.imagePath &&
               other.width === this.width &&
               other.height === this.height;
    }

    toDOM() {
        const container = document.createElement('div');
        container.className = 'image-widget-container';
        
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
            img.classList.add('image-with-explicit-size');
        } else if (this.width) {
            console.log('Applying width only:', this.width);
            img.style.width = `${this.width}px`;
            img.style.height = 'auto';
            img.classList.add('image-with-explicit-size');
        } else if (this.height) {
            console.log('Applying height only:', this.height);
            img.style.height = `${this.height}px`;
            img.style.width = 'auto';
            img.classList.add('image-with-explicit-size');
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
        
        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'image-resize-handle';
        resizeHandle.title = 'Drag to resize image';
        
        // Function to update handle position
        const updateHandlePosition = () => {
            const imgRect = img.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Position handle at bottom-right corner of the image with slight offset
            const rightPos = imgRect.right - containerRect.left - 3;
            const bottomPos = imgRect.bottom - containerRect.top - 3;
            
            resizeHandle.style.left = `${rightPos}px`;
            resizeHandle.style.top = `${bottomPos}px`;
        };
        
        // Update position when image loads
        img.addEventListener('load', updateHandlePosition);
        
        // Also update position on image resize
        const resizeObserver = new ResizeObserver(updateHandlePosition);
        resizeObserver.observe(img);
        
        // Initial position update (for images with predefined sizes)
        setTimeout(updateHandlePosition, 10);
        
        // Add resize functionality
        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // Get current image dimensions
            const imgRect = img.getBoundingClientRect();
            startWidth = imgRect.width;
            startHeight = imgRect.height;
            
            // Add temporary styles for better visual feedback
            document.body.style.cursor = 'nw-resize';
            document.body.style.userSelect = 'none';
            
            // Mouse move handler
            const handleMouseMove = (e: MouseEvent) => {
                if (!isResizing) return;
                
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                // Calculate new dimensions (use the larger delta for proportional scaling)
                const scaleFactor = Math.max(
                    (startWidth + deltaX) / startWidth,
                    (startHeight + deltaY) / startHeight
                );
                
                const newWidth = Math.max(50, Math.round(startWidth * scaleFactor));
                const newHeight = Math.max(50, Math.round(startHeight * scaleFactor));
                
                // Apply new dimensions temporarily
                img.style.width = `${newWidth}px`;
                img.style.height = `${newHeight}px`;
                img.style.objectFit = 'cover';
                
                // Update handle position during resize
                updateHandlePosition();
            };
            
            // Mouse up handler
            const handleMouseUp = (e: MouseEvent) => {
                if (!isResizing) return;
                
                isResizing = false;
                
                // Reset cursor and selection
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // Get final dimensions
                const imgRect = img.getBoundingClientRect();
                const finalWidth = Math.round(imgRect.width);
                const finalHeight = Math.round(imgRect.height);
                
                // Update the markdown with new dimensions
                this.updateImageSize(finalWidth, finalHeight);
                
                // Remove event listeners
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
            
            // Add global event listeners
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
        
        container.appendChild(img);
        container.appendChild(resizeHandle);
        return container;
    }

    private updateImageSize(width: number, height: number) {
        // Dispatch a custom event to update the markdown
        const updateEvent = new CustomEvent('updateImageSize', {
            detail: {
                imagePath: this.imagePath,
                altText: this.altText,
                width: width,
                height: height
            },
            bubbles: true
        });
        document.dispatchEvent(updateEvent);
    }

    private async loadImage(img: HTMLImageElement) {
        try {
            
            // First try to find the file in the vault by exact path
            let file = this.plugin.app.vault.getAbstractFileByPath(this.imagePath);
            
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

// State for managing code block collapse states
const codeBlockCollapseState = StateField.define<Map<number, boolean>>({
    create() {
        return new Map();
    },
    update(value, tr) {
        // Check for collapse toggle effects
        for (const effect of tr.effects) {
            if (effect.is(toggleCodeBlockEffect)) {
                const newValue = new Map(value);
                newValue.set(effect.value.blockIndex, effect.value.isCollapsed);
                return newValue;
            }
        }
        return value;
    }
});

const toggleCodeBlockEffect = StateEffect.define<{blockIndex: number, isCollapsed: boolean}>();

function createInternalLinkExtension(plugin: SurveyNotePlugin) {
    const internalLinkRegex = /\[\[([^\]]+)\]\]/g;
    const internalImageRegex = /!\[\[([^\]]+)\]\]/g;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)\n?```/g;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const listItemRegex = /^(\s*)([-*])( +)(?!\[[ x]\] )/gm;
    const checkboxRegex = /^(\s*)- (\[[ x]\]) /gm;
    const collapseMarkerRegex = /<!--(COLLAPSED|HIDDEN)-->/g;
    
    function parseImageOptions(optionsStr: string): { 
        width?: number; 
        height?: number;
    } {
        if (!optionsStr) return {};
        
        // Parse size specification (e.g., "300x200", "300", "x200")
        const sizeMatch = optionsStr.match(/^(\d+)?(?:x(\d+))?$/);
        if (sizeMatch) {
            const width = sizeMatch[1] ? parseInt(sizeMatch[1], 10) : undefined;
            const height = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : undefined;
            return { width, height };
        }
        
        return {};
    }
    
    // Parse list and checkbox structure to determine which items have children and should be hidden
    function parseListStructure(text: string): Map<number, { hasChildren: boolean, isCollapsed: boolean, shouldHide: boolean }> {
        const lines = text.split('\n');
        const listInfo = new Map<number, { hasChildren: boolean, isCollapsed: boolean, shouldHide: boolean }>();
        
        // First pass: identify all list items and checkboxes in the original text 
        const allListItems: Array<{ lineIndex: number, indentLevel: number, isCollapsed: boolean, originalLine: string }> = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Remove collapse markers for structure analysis but preserve original line
            const cleanLine = line.replace(/<!--(COLLAPSED|HIDDEN)-->/g, '');
            
            // Match both regular list items and checkboxes
            const listMatch = cleanLine.match(/^(\s*)([-*])( +)(?!\[[ x]\] )/);
            const checkboxMatch = cleanLine.match(/^(\s*)- (\[[ x]\]) /);
            
            if (listMatch || checkboxMatch) {
                const indent = listMatch ? listMatch[1] : (checkboxMatch ? checkboxMatch[1] : '');
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

    function scanForLinks(text: string, selection?: { from: number; to: number }, collapseStates?: Map<number, boolean>): Range<Decoration>[] {
        console.log('Scanning for links in text:', text, 'Selection:', selection);
        const newDecorations: Range<Decoration>[] = [];
        
        // Parse list structure first
        const listStructure = parseListStructure(text);
        
        // Store markdown link, image, code block, checkbox, and list item positions for URL scanning
        const markdownLinkRanges: Array<{from: number, to: number}> = [];
        const imageRanges: Array<{from: number, to: number}> = [];
        const codeBlockRanges: Array<{from: number, to: number}> = [];
        const checkboxRanges: Array<{from: number, to: number}> = [];
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
        let codeBlockIndex = 0;
        codeBlockRegex.lastIndex = 0;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const language = match[1] || '';
            const code = match[2] || '';
            const isCollapsed = collapseStates ? (collapseStates.get(codeBlockIndex) ?? true) : true;
            
            codeBlockRanges.push({from, to});
            
            
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
                        'data-block-index': codeBlockIndex.toString(),
                        'title': `Code block${language ? ` (${language})` : ''}`,
                        'style': 'cursor: text; background-color: var(--background-modifier-hover);'
                    }
                });
                newDecorations.push(decoration.range(from, to));
            } else {
                console.log('Cursor outside code block range, showing code widget');
                // Show code block widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new CodeBlockWidget(code, language, isCollapsed)
                });
                newDecorations.push(decoration.range(from, to));
            }
            codeBlockIndex++;
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
        
        // Scan for checkboxes - [ ] and - [x]
        checkboxRegex.lastIndex = 0;
        while ((match = checkboxRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            const indent = match[1]; // Leading spaces/tabs
            const checkboxState = match[2]; // [x] or [ ]
            const isChecked = checkboxState === '[x]';
            
            checkboxRanges.push({from, to});
            
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
            
            // Skip creating checkbox widgets for items that should be hidden
            const overlapsWithHidden = hiddenLineRanges.some(range => 
                (from >= range.from && from < range.to) || 
                (to > range.from && to <= range.to) ||
                (from <= range.from && to >= range.to)
            );
            
            if (overlapsWithHidden) {
                console.log('scanForLinks: Skipping checkbox widget creation for hidden line:', lineNumber);
                continue;
            }
            
            // Get list structure info for this line (includes checkbox structure now)
            const listInfo = listStructure.get(lineNumber) || { hasChildren: false, isCollapsed: false, shouldHide: false };
            
            console.log('scanForLinks: Found checkbox:', { 
                match: `"${match[0]}"`, 
                indent: `"${indent}"`, 
                checkboxState: `"${checkboxState}"`,
                isChecked,
                from, 
                to,
                lineNumber,
                hasChildren: listInfo.hasChildren,
                isCollapsed: listInfo.isCollapsed,
                shouldHide: listInfo.shouldHide
            });
            
            // Replace the entire match (indent + "- [x] " or "- [ ] ") with our custom widget
            const decoration = Decoration.replace({
                widget: new CheckboxWidget(indent, isChecked, lineNumber, listInfo.hasChildren, listInfo.isCollapsed)
            });
            newDecorations.push(decoration.range(from, to));
        }
        
        // First, scan for lines with multiple images and process them as groups
        const processedRanges = new Set<string>();
        const imageLines = text.split('\n');
        let imageLineStart = 0;

        for (let lineIndex = 0; lineIndex < imageLines.length; lineIndex++) {
            const line = imageLines[lineIndex];
            const lineEnd = imageLineStart + line.length;
            
            // Count images in this line
            const internalImages = [...line.matchAll(/!\[\[([^\]]+)\]\]/g)];
            const markdownImages = [...line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
            const totalImages = internalImages.length + markdownImages.length;
            
            if (totalImages > 1) {
                // Check if cursor/selection is within this multi-image line
                const cursorInRange = selection && (
                    (selection.from >= imageLineStart && selection.from <= lineEnd) ||
                    (selection.to >= imageLineStart && selection.to <= lineEnd) ||
                    (selection.from <= imageLineStart && selection.to >= lineEnd)
                );

                if (cursorInRange) {
                    console.log('Cursor in multi-image line, showing original text');
                    // Show original text when cursor is in range
                    const decoration = Decoration.mark({
                        class: 'image-editing',
                        attributes: {
                            'data-image-type': 'multi-image',
                            'title': `Multiple images (${totalImages} images)`,
                            'style': 'cursor: pointer; color: var(--text-accent); background-color: var(--background-modifier-hover);'
                        }
                    });
                    newDecorations.push(decoration.range(imageLineStart, lineEnd));
                } else {
                    // Process as multi-image line
                    const images: Array<{altText: string, imagePath: string, width?: number, height?: number, align?: 'left' | 'center' | 'right'}> = [];
                    
                    // Collect all images from this line
                    const allMatches: Array<{type: 'internal' | 'markdown', match: RegExpMatchArray, index: number}> = [];
                    
                    internalImages.forEach(match => {
                        allMatches.push({type: 'internal', match, index: match.index || 0});
                    });
                    
                    markdownImages.forEach(match => {
                        allMatches.push({type: 'markdown', match, index: match.index || 0});
                    });
                    
                    // Sort by position in line
                    allMatches.sort((a, b) => a.index - b.index);
                    
                    // Process each match
                    allMatches.forEach(item => {
                        if (item.type === 'internal') {
                            const fullContent = item.match[1];
                            const parts = fullContent.split('|');
                            const filename = parts[0];
                            const optionsStr = parts.slice(1).join('|');
                            const { width, height } = parseImageOptions(optionsStr);
                            images.push({ altText: '', imagePath: filename, width, height });
                        } else {
                            const altText = item.match[1] || '';
                            const imagePath = item.match[2];
                            images.push({ altText, imagePath, width: undefined, height: undefined });
                        }
                    });
                    
                    // Create multi-image widget for the entire line
                    const decoration = Decoration.replace({
                        widget: new MultiImageWidget(images, plugin)
                    });
                    newDecorations.push(decoration.range(imageLineStart, lineEnd));
                }
                
                // Mark this range as processed
                processedRanges.add(`${imageLineStart}-${lineEnd}`);
            }
            
            imageLineStart = lineEnd + 1; // +1 for newline character
        }

        // Scan for internal images ![[filename|size]]
        internalImageRegex.lastIndex = 0;
        while ((match = internalImageRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            
            // Skip if this image is part of a multi-image line
            let shouldSkip = false;
            for (const range of processedRanges) {
                const [rangeStart, rangeEnd] = range.split('-').map(Number);
                if (from >= rangeStart && to <= rangeEnd) {
                    shouldSkip = true;
                    break;
                }
            }
            if (shouldSkip) continue;
            
            const fullContent = match[1];
            
            // Parse filename and options (align|size)
            const parts = fullContent.split('|');
            const filename = parts[0];
            const optionsStr = parts.slice(1).join('|'); // Rejoin remaining parts
            
            imageRanges.push({from, to});
            
            
            // Parse options (size)
            const { width, height } = parseImageOptions(optionsStr);
            
            // Check if cursor/selection is within this image range
            const cursorInRange = selection && (
                (selection.from >= from && selection.from <= to) ||
                (selection.to >= from && selection.to <= to) ||
                (selection.from <= from && selection.to >= to)
            );
            
            if (cursorInRange) {
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
                // Show image widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new ImageWidget('', filename, plugin, width, height)
                });
                newDecorations.push(decoration.range(from, to));
            }
        }
        
        // Scan for markdown images ![alt](src)
        imageRegex.lastIndex = 0;
        while ((match = imageRegex.exec(text)) !== null) {
            const from = match.index;
            const to = match.index + match[0].length;
            
            // Skip if this image is part of a multi-image line
            let shouldSkip = false;
            for (const range of processedRanges) {
                const [rangeStart, rangeEnd] = range.split('-').map(Number);
                if (from >= rangeStart && to <= rangeEnd) {
                    shouldSkip = true;
                    break;
                }
            }
            if (shouldSkip) continue;
            
            const altText = match[1];
            const imagePath = match[2];
            
            imageRanges.push({from, to});
            
            
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
                // Show image widget when cursor is outside range
                const decoration = Decoration.replace({
                    widget: new ImageWidget(altText, imagePath, plugin)
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
            
            // Skip if this position overlaps with an image, code block, list item, or checkbox range
            const overlapsWithSpecial = [...imageRanges, ...codeBlockRanges, ...listItemRanges, ...checkboxRanges].some(range => 
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
        checkboxRanges.forEach(range => {
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
            const collapseStates = state.field(codeBlockCollapseState);
            const decorations = scanForLinks(text, selection, collapseStates);
            return Decoration.set(decorations);
        },
        update(decorations, tr) {
            // If document changed or collapse state changed, rebuild decorations
            if (tr.docChanged || tr.effects.some(e => e.is(toggleCodeBlockEffect))) {
                const text = tr.state.doc.toString();
                const selection = tr.state.selection.main;
                const collapseStates = tr.state.field(codeBlockCollapseState);
                console.log('Document or collapse state changed, rebuilding all decorations');
                const newDecorations = scanForLinks(text, selection, collapseStates);
                return Decoration.set(newDecorations);
            }
            
            // For selection changes only, try to map existing decorations safely
            if (tr.selection) {
                try {
                    decorations = decorations.map(tr.changes);
                    const text = tr.state.doc.toString();
                    const selection = tr.state.selection.main;
                    const collapseStates = tr.state.field(codeBlockCollapseState);
                    console.log('Selection changed, rescanning for links');
                    const newDecorations = scanForLinks(text, selection, collapseStates);
                    return Decoration.set(newDecorations);
                } catch (error) {
                    console.log('Error mapping decorations, rebuilding:', error);
                    const text = tr.state.doc.toString();
                    const selection = tr.state.selection.main;
                    const collapseStates = tr.state.field(codeBlockCollapseState);
                    const newDecorations = scanForLinks(text, selection, collapseStates);
                    return Decoration.set(newDecorations);
                }
            }
            
            return decorations;
        },
        provide: f => EditorView.decorations.from(f)
    });
    
    return [codeBlockCollapseState, linkField];
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
                
                const listMatch = beforeCursor.match(/^(\s*)([-*])$/);
                
                if (listMatch) {
                    const indent = listMatch[1];
                    const bullet = listMatch[2];
                    
                    console.log('handleInput: MATCHED! Converting list item:', { 
                        indent: `"${indent}"`, 
                        bullet: `"${bullet}"`,
                        indentLength: indent.length,
                        totalMatch: `"${listMatch[0]}"`
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
        }
        
        // Check for checkbox patterns: `- [ ` or `- [x`
        if (text === ' ' || text === '[') {
            const doc = view.state.doc;
            const line = doc.lineAt(from);
            const lineText = line.text;
            const pos = from - line.from;
            
            // Check for `- [ ` pattern
            if (text === ' ' && pos >= 3) {
                const beforeCursor = lineText.substring(0, pos);
                const checkboxMatch = beforeCursor.match(/^(\s*)- \[$/);
                
                if (checkboxMatch) {
                    const indent = checkboxMatch[1];
                    console.log('handleInput: Converting to unchecked checkbox:', { indent });
                    
                    const lineStart = line.from;
                    const bulletStart = lineStart + indent.length;
                    const bulletEnd = lineStart + beforeCursor.length;
                    
                    view.dispatch({
                        changes: [
                            {
                                from: bulletStart,
                                to: bulletEnd,
                                insert: '- [ ]'
                            },
                            {
                                from: bulletEnd,
                                to: bulletEnd,
                                insert: ' '
                            }
                        ],
                        selection: { anchor: bulletStart + 6 }, // Position after "- [ ] "
                        userEvent: "input.type"
                    });
                    
                    return true;
                }
            }
            
            // Check for `- [x ` pattern 
            if (text === ' ' && pos >= 4) {
                const beforeCursor = lineText.substring(0, pos);
                const checkboxMatch = beforeCursor.match(/^(\s*)- \[x$/);
                
                if (checkboxMatch) {
                    const indent = checkboxMatch[1];
                    console.log('handleInput: Converting to checked checkbox:', { indent });
                    
                    const lineStart = line.from;
                    const bulletStart = lineStart + indent.length;
                    const bulletEnd = lineStart + beforeCursor.length;
                    
                    view.dispatch({
                        changes: [
                            {
                                from: bulletStart,
                                to: bulletEnd,
                                insert: '- [x]'
                            },
                            {
                                from: bulletEnd,
                                to: bulletEnd,
                                insert: ' '
                            }
                        ],
                        selection: { anchor: bulletStart + 6 }, // Position after "- [x] "
                        userEvent: "input.type"
                    });
                    
                    return true;
                }
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
                
                // Check for checkbox pattern reconstruction
                const checkboxMatch = lineText.match(/^(\s*)(.+)$/);
                if (checkboxMatch) {
                    const indent = checkboxMatch[1];
                    const content = checkboxMatch[2];
                    
                    // Check if this looks like a line that would have a checkbox widget
                    const reconstructedChecked = indent + '- [x] ' + content;
                    const reconstructedUnchecked = indent + '- [ ] ' + content;
                    const testCheckedMatch = reconstructedChecked.match(/^(\s*)- (\[x\]) (.*)$/);
                    const testUncheckedMatch = reconstructedUnchecked.match(/^(\s*)- (\[ \]) (.*)$/);
                    
                    if ((testCheckedMatch || testUncheckedMatch) && content.trim().length > 0) {
                        console.log('handleBackspace: MATCHED! Converting back to checkbox markdown with indent:', `"${indent}"`);
                        
                        view.dispatch({
                            changes: {
                                from: line.from,
                                to: line.from + indent.length,
                                insert: indent + '- [ ] '
                            },
                            selection: { anchor: line.from + indent.length + 6 },
                            userEvent: "delete.backward"
                        });
                        
                        return true; // Prevent default backspace
                    } else {
                        console.log('handleBackspace: No match for checkbox reconstruction');
                    }
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
        this.addAction("plus", "新規SurveyNote作成", () => {
            this.createNewSurveyNote();
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
                if (line.trim().startsWith(`# ${sectionTitle}`)) {
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
        // Use the plugin's setMarkdownView method to properly handle manual view switch
        await this.plugin.setMarkdownView(this.leaf);
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
                SECTIONS.CONTENT1, SECTIONS.CONTENT2,
                SECTIONS.CONTENT3
            ];

            for (const sectionTitle of sectionOrder) {
                const sectionContent = this.editorData[sectionTitle];
                if (sectionContent !== undefined && sectionContent.trim() !== '') {
                    newSectionContent += `# ${sectionTitle}\n${sectionContent.trim()}\n\n`;
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

        // Get layout type from frontmatter
        const fileCache = this.app.metadataCache.getFileCache(this.file);
        const frontmatter = fileCache?.frontmatter;
        const layoutType = frontmatter?.['survey-note-view'];
        
        // Determine layout class
        let layoutClass = "";
        if (layoutType === "1") {
            layoutClass = "layout-1";
        } else if (layoutType === "2") {
            layoutClass = "layout-2";
        }
        // Default case (note, 3, or undefined) uses no additional class
        
        const gridEl = rootEl.createDiv({ cls: `surveynote-view-grid ${layoutClass}`.trim() });

        // Create grid items in the specific order to match CSS grid layout
        const gridOrder = [
            { key: "BACKGROUND", title: SECTIONS.BACKGROUND, cls: "background" },
            { key: "SUMMARY", title: SECTIONS.SUMMARY, cls: "summary" },
            { key: "CONTENT1", title: SECTIONS.CONTENT1, cls: "content1" },
            { key: "CONTENT2", title: SECTIONS.CONTENT2, cls: "content2" },
            { key: "CONTENT3", title: SECTIONS.CONTENT3, cls: "content3" }
        ];

        gridOrder.forEach(({ title, cls }) => {
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

        // Add handler for code block collapse toggle
        contentContainer.addEventListener('toggleCodeBlockCollapse', (event: Event) => {
            const customEvent = event as CustomEvent;
            const { target, isCollapsed } = customEvent.detail;
            
            console.log('Toggle code block collapse event:', { isCollapsed });
            
            // Find the block index by counting code blocks before this one
            const text = editor.state.doc.toString();
            const codeBlockRegex = /```(\w*)\n?([\s\S]*?)\n?```/g;
            const allCodeBlocks = contentContainer.querySelectorAll('.code-block-widget-container');
            const clickedIndex = Array.from(allCodeBlocks).indexOf(target);
            
            if (clickedIndex !== -1) {
                console.log('Toggling code block', clickedIndex, 'to collapsed:', !isCollapsed);
                
                // Dispatch the state effect to toggle collapse
                editor.dispatch({
                    effects: toggleCodeBlockEffect.of({
                        blockIndex: clickedIndex,
                        isCollapsed: !isCollapsed
                    })
                });
            }
        });

        // Add handler for checkbox toggle
        contentContainer.addEventListener('toggleCheckbox', (event: Event) => {
            const customEvent = event as CustomEvent;
            const { lineNumber, isChecked } = customEvent.detail;
            
            console.log('Toggle checkbox event:', { lineNumber, isChecked });
            
            // Toggle the checkbox state by manipulating the document
            this.toggleCheckbox(editor, lineNumber, isChecked);
        });

        // Add handler for image size updates
        document.addEventListener('updateImageSize', (event: Event) => {
            const customEvent = event as CustomEvent;
            const { imagePath, altText, width, height } = customEvent.detail;
            
            // Update the markdown text with new image dimensions
            this.updateImageInMarkdown(editor, imagePath, altText, width, height);
        });

        // Add click handler for links
        this.registerDomEvent(contentContainer, 'click', (event) => {
            const target = event.target as HTMLElement;
            
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

    private toggleCheckbox(editor: EditorView, lineNumber: number, isChecked: boolean) {
        const doc = editor.state.doc;
        const lines = doc.toString().split('\n');
        
        if (lineNumber >= lines.length) {
            console.log('toggleCheckbox: Invalid line number', lineNumber, 'total lines:', lines.length);
            return;
        }
        
        const line = lines[lineNumber];
        console.log('toggleCheckbox: Toggling checkbox for line', lineNumber, `"${line}"`);
        
        // Find the checkbox pattern in the line
        const checkboxMatch = line.match(/^(\s*)- (\[[ x]\]) (.*)$/);
        if (!checkboxMatch) {
            console.log('toggleCheckbox: No checkbox pattern found in line');
            return;
        }
        
        const indent = checkboxMatch[1];
        const currentState = checkboxMatch[2];
        const content = checkboxMatch[3];
        
        // Toggle the checkbox state
        const newState = isChecked ? '[ ]' : '[x]';
        const newLineContent = `${indent}- ${newState} ${content}`;
        
        console.log('toggleCheckbox: Changing from', `"${currentState}"`, 'to', `"${newState}"`);
        
        // Calculate line positions
        let lineStart = 0;
        for (let i = 0; i < lineNumber; i++) {
            lineStart += lines[i].length + 1; // +1 for newline character
        }
        const lineEnd = lineStart + line.length;
        
        // Apply the change
        editor.dispatch({
            changes: {
                from: lineStart,
                to: lineEnd,
                insert: newLineContent
            },
            userEvent: "select.pointer"
        });
        
        console.log('toggleCheckbox: Checkbox toggled successfully');
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

    private async createNewSurveyNote() {
        try {
            // Get current file's directory
            const currentDirectory = this.file?.parent;
            if (!currentDirectory) {
                new Notice("現在のノートのディレクトリが見つかりません。");
                return;
            }

            // Generate unique filename based on existing files in directory
            let counter = 1;
            let filename: string;
            let filePath: string;

            // First try "無題のファイル.md"
            filename = "無題のファイル.md";
            filePath = `${currentDirectory.path}/${filename}`;

            // If it exists, try "無題のファイル2.md", "無題のファイル3.md", etc.
            while (await this.app.vault.adapter.exists(filePath)) {
                counter++;
                filename = `無題のファイル${counter}.md`;
                filePath = `${currentDirectory.path}/${filename}`;
            }

            // Create content with frontmatter
            const content = `---
survey-note-view: note
---

# Purpose


# Summary


# Content1


# Content2


# Content3

`;

            // Create the new file
            const newFile = await this.app.vault.create(filePath, content);
            
            // Create a new tab in the same tab group as the current SurveyNote view
            const newLeaf = this.app.workspace.getLeaf(true);
            
            // Open the new file in the new tab
            await newLeaf.openFile(newFile);
            
            // Switch to SurveyNote view
            await this.plugin.setSurveyNoteView(newLeaf);
            
            new Notice(`新しいSurveyNoteを作成しました: ${filename}`);
            
        } catch (error) {
            console.error('Error creating new SurveyNote:', error);
            new Notice('新しいSurveyNoteの作成に失敗しました: ' + error.message);
        }
    }

    /**
     * Update image dimensions in markdown text
     */
    private updateImageInMarkdown(editor: EditorView, imagePath: string, altText: string, width: number, height: number) {
        const currentText = editor.state.doc.toString();
        
        // Patterns to match various image formats
        const internalImagePattern = new RegExp(`!\\[\\[${imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]*)?\\]\\]`, 'g');
        const markdownImagePattern = new RegExp(`!\\[${altText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(${imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^)]*)?\\)`, 'g');
        
        let updatedText = currentText;
        let wasUpdated = false;
        
        // Update internal image format: ![[image.png|200x300|center]]
        updatedText = updatedText.replace(internalImagePattern, (match) => {
            wasUpdated = true;
            
            // Check if dimensions already exist
            if (match.includes('|')) {
                // Remove existing size/alignment info and add new one
                const baseMatch = match.match(/^!\[\[([^\]|]+)/);
                if (baseMatch) {
                    const baseImagePath = baseMatch[1];
                    const newFormat = `![[${baseImagePath}|${width}x${height}]]`;
                    return newFormat;
                }
            } else {
                // Add dimensions to image without existing formatting
                const baseMatch = match.match(/^!\[\[([^\]]+)\]\]$/);
                if (baseMatch) {
                    const baseImagePath = baseMatch[1];
                    const newFormat = `![[${baseImagePath}|${width}x${height}]]`;
                    return newFormat;
                }
            }
            return match;
        });
        
        // Update markdown image format: ![alt](image.png|200x300|center)
        updatedText = updatedText.replace(markdownImagePattern, (match) => {
            wasUpdated = true;
            
            // Parse the existing format
            const markdownMatch = match.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (markdownMatch) {
                const altText = markdownMatch[1];
                const pathPart = markdownMatch[2];
                
                // Extract base path (remove existing size/alignment)
                const basePath = pathPart.split('|')[0];
                
                const newFormat = `![${altText}](${basePath}|${width}x${height})`;
                return newFormat;
            }
            return match;
        });
        
        if (wasUpdated) {
            // Update the editor content
            editor.dispatch({
                changes: {
                    from: 0,
                    to: editor.state.doc.length,
                    insert: updatedText
                }
            });
        }
    }
}
