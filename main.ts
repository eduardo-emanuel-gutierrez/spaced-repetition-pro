import {
    Plugin,
    WorkspaceLeaf,
    Notice,
    TFile,
    TFolder,
    Menu,
    MenuItem
} from 'obsidian';
import { SpacedRepetitionView, VIEW_TYPE_SPACED_REPETITION } from './src/view';
import { SpacedRepetitionManager } from './src/sr-manager';
import { SpacedRepetitionSettingTab, SpacedRepetitionSettings, DEFAULT_SETTINGS } from './src/settings';

/**
 * Main plugin class for Spaced Repetition Pro
 *
 * This class serves as the entry point for the plugin and handles:
 * - Plugin initialization and cleanup
 * - Settings management and persistence
 * - Command registration and keyboard shortcuts
 * - Context menu integration for file/folder operations
 * - View management and activation
 * - File system event handling (rename, delete)
 *
 * The plugin follows the SM-2 algorithm for spaced repetition scheduling
 * and provides a comprehensive review system for Obsidian notes.
 */
export default class SpacedRepetitionPlugin extends Plugin {
    /** Plugin configuration settings loaded from Obsidian's data storage */
    settings: SpacedRepetitionSettings;
    /** Core spaced repetition manager that handles the SM-2 algorithm and data persistence */
    srManager: SpacedRepetitionManager;
    /** Auto-save interval ID for periodic data backup */
    private saveInterval: number;

    /**
     * Plugin lifecycle method called when the plugin loads
     *
     * Initializes all plugin components in the correct order:
     * 1. Load user settings
     * 2. Initialize the spaced repetition manager
     * 3. Load review data from storage
     * 4. Register views, commands, and event handlers
     * 5. Set up auto-save mechanism
     */


    async onload() {
        console.log('Loading Spaced Repetition Pro plugin');

        // Load user configuration from Obsidian's data storage
        await this.loadSettings();

        // Initialize the core spaced repetition manager with current settings
        this.srManager = new SpacedRepetitionManager(this);
        await this.srManager.loadData();

        // Register our custom view type with Obsidian's workspace system
        this.registerView(
            VIEW_TYPE_SPACED_REPETITION,
            (leaf) => new SpacedRepetitionView(leaf, this)
        );

        // Set up automatic data saving every 2 minutes to prevent data loss
        // This ensures that review progress is saved even if Obsidian crashes
        this.saveInterval = this.registerInterval(
            window.setInterval(() => {
                this.srManager.saveData().catch(error => {
                    console.error('Error in automatic save:', error);
                });
            }, 2 * 60 * 1000) /// 2 minutes interval
        );

        // Register the main command for starting review sessions
        this.addCommand({
            id: 'start-review-session',
            name: 'Start Review Session',
            callback: () => {
                this.activateView();
            }
        });

        // Add context menu options to files and folders for tracking operations
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TFile | TFolder) => {
                this.addContextMenu(menu, file);
            })
        );

        // Register global keyboard shortcuts for review operations
        // These only work when the spaced repetition view is active
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            const activeView = this.app.workspace.getActiveViewOfType(SpacedRepetitionView);
            if (activeView) {
                switch(evt.key) {
                    case '1':
                        activeView.handleRating('again');
                        evt.preventDefault();
                        break;
                    case '2':
                        activeView.handleRating('hard');
                        evt.preventDefault();
                        break;
                    case '3':
                        activeView.handleRating('good');
                        evt.preventDefault();
                        break;
                    case '4':
                        activeView.handleRating('easy');
                        evt.preventDefault();
                        break;
                    case ' ': // Barra espaciadora
                        activeView.handleSpacebar();
                        evt.preventDefault();
                        break;
                }
            }
        });

        // Agregar eventos para guardar cuando se renombran o eliminan archivos
        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (file instanceof TFile && this.srManager.isNoteTracked(file)) {
                    // Actualizar el path en los datos de revisiÃ³n
                    const trackedNotes = this.srManager.getTrackedNotes();
                    const item = trackedNotes.find(item => item.path === oldPath);
                    if (item) {
                        // Remover el item antiguo y agregar el nuevo con el path actualizado
                        this.srManager.untrackNote({ path: oldPath } as TFile);
                        item.path = file.path;
                        await this.srManager.trackNote(file);
                        console.log(`Updated tracking path: ${oldPath} -> ${file.path}`);
                    }
                }
            })
        );

        // When files are deleted, remove them from the tracking system
        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (file instanceof TFile && this.srManager.isNoteTracked(file)) {
                    this.srManager.untrackNote(file);
                    console.log(`Untracked deleted file: ${file.path}`);
                }
            })
        );

        // Add the settings tab to Obsidian's settings panel
        this.addSettingTab(new SpacedRepetitionSettingTab(this.app, this));
    }

    /**
     * Plugin lifecycle method called when the plugin unloads
     *
     * Performs cleanup operations:
     * - Clears auto-save interval
     * - Saves all pending data to prevent loss
     * - Logs completion status
     */
    async onunload() {
        console.log('Unloading Spaced Repetition Pro plugin');

        // Clear the auto-save interval to prevent memory leaks
        if (this.saveInterval) {
            window.clearInterval(this.saveInterval);
        }

        // Critical: Save all pending data before shutdown
        if (this.srManager) {
            try {
                await this.srManager.saveData();
                console.log('Successfully saved data before unloading');
            } catch (error) {
                console.error('Error saving data during unload:', error);
            }
        }
    }

    /**
     * Opens or focuses the spaced repetition view
     *
     * If a view already exists, it will be focused.
     * Otherwise, a new tab will be created with the review interface.
     * This method is called by the main command and can be used programmatically.
     */
    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_SPACED_REPETITION);

        if (leaves.length > 0) {
            // If a spaced repetition view already exists, focus it
            leaf = leaves[0];
        } else {
            // Create a new tab for the spaced repetition view
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_SPACED_REPETITION,
                    active: true,
                });
            }
        }

        // Bring the view to focus
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * Adds spaced repetition options to the context menu for files and folders
     *
     * @param menu - The context menu to add items to
     * @param file - The file or folder being right-clicked
     *
     * Adds two menu items:
     * - "Track for Review": Adds the file/folder to the spaced repetition system
     * - "Untrack from Review": Removes the file/folder from tracking
     */
    private addContextMenu(menu: Menu, file: TFile | TFolder) {
        // Option to start tracking files for review
        menu.addItem((item: MenuItem) => {
            item
                .setTitle('Track for Review')
                .setIcon('clock')
                .onClick(async () => {
                    await this.trackItems(file);
                });
        });

        // Option to stop tracking files for review
        menu.addItem((item: MenuItem) => {
            item
                .setTitle('Untrack from Review')
                .setIcon('x')
                .onClick(async () => {
                    await this.untrackItems(file);
                });
        });
    }

    /**
     * Adds files or folders to the spaced repetition tracking system
     *
     * @param file - The file or folder to track
     *
     * For files: Tracks the single markdown file if not already tracked
     * For folders: Recursively tracks all markdown files within the folder
     *
     * Shows a notification with the number of items added and any errors encountered.
     */
    private async trackItems(file: TFile | TFolder) {
        let count = 0;        // Successfully tracked items
        let errors = 0;       // Items that failed to track

        try {
            if (file instanceof TFile) {
                // Handle single file tracking
                if (file.extension === 'md') {
                    const wasAlreadyTracked = this.srManager.isNoteTracked(file);
                    if (!wasAlreadyTracked) {
                        await this.srManager.trackNote(file);
                        count = 1;
                    }
                }
            } else if (file instanceof TFolder) {
                // Handle folder tracking - get all markdown files recursively
                const files = await this.getMarkdownFilesInFolder(file);
                for (const mdFile of files) {
                    const wasAlreadyTracked = this.srManager.isNoteTracked(mdFile);
                    if (!wasAlreadyTracked) {
                        try {
                            await this.srManager.trackNote(mdFile);
                            count++;
                        } catch (error) {
                            console.error(`Failed to track ${mdFile.path}:`, error);
                            errors++;
                        }
                    }
                }
            }

            // Provide user feedback about the tracking operation
            if (count > 0) {
                const errorMsg = errors > 0 ? ` (${errors} errors)` : '';
                new Notice(`Added ${count} new item${count > 1 ? 's' : ''} for review${errorMsg}`, 3000);
            } else {
                new Notice('No new markdown files found to track', 3000);
            }

        } catch (error) {
            console.error('Error tracking items:', error);
            new Notice('Error tracking items. Check console for details.', 5000);
        }
    }

    /**
     * Removes files or folders from the spaced repetition tracking system
     *
     * @param file - The file or folder to untrack
     *
     * For files: Removes the single file from tracking
     * For folders: Recursively removes all files within the folder from tracking
     *
     * Shows a notification with the number of items removed.
     */
    private async untrackItems(file: TFile | TFolder) {
        let count = 0;

        if (file instanceof TFile) {
            // Handle single file untracking
            if (this.srManager.untrackNote(file)) {
                count = 1;
            }
        } else if (file instanceof TFolder) {
            // Handle folder untracking - remove all markdown files within
            const files = await this.getMarkdownFilesInFolder(file);
            for (const mdFile of files) {
                if (this.srManager.untrackNote(mdFile)) {
                    count++;
                }
            }
        }

        // Provide user feedback about the untracking operation
        if (count > 0) {
            new Notice(`Untracked ${count} item${count > 1 ? 's' : ''}`, 3000);
        } else {
            new Notice('No tracked items found to remove', 3000);
        }
    }

    /**
     * Recursively retrieves all markdown files within a folder
     *
     * @param folder - The folder to search
     * @returns Promise resolving to an array of TFile objects representing markdown files
     *
     * This method searches through the entire folder hierarchy to find all .md files.
     * It's used by the tracking operations to handle bulk folder operations.
     */
    private async getMarkdownFilesInFolder(folder: TFolder): Promise<TFile[]> {
        const files: TFile[] = [];

        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                // Found a markdown file - add it to our list
                files.push(child);
            } else if (child instanceof TFolder) {
                // Found a subfolder - recursively search it
                const subFiles = await this.getMarkdownFilesInFolder(child);
                files.push(...subFiles);
            }
        }

        return files;
    }

    /**
     * Loads plugin settings from Obsidian's data storage
     *
     * Merges default settings with any saved user preferences.
     * This ensures that new settings have defaults even if the user
     * hasn't configured them yet.
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Saves current plugin settings to Obsidian's data storage
     *
     * This method is called whenever settings are modified through
     * the settings tab interface.
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }
}