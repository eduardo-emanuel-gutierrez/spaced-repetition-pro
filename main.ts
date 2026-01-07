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

export default class SpacedRepetitionPlugin extends Plugin {
    settings: SpacedRepetitionSettings;
    srManager: SpacedRepetitionManager;

    async onload() {
        await this.loadSettings();

        this.srManager = new SpacedRepetitionManager(this);
        await this.srManager.loadData();

        this.registerView(
            VIEW_TYPE_SPACED_REPETITION,
            (leaf) => new SpacedRepetitionView(leaf, this)
        );

        this.registerInterval(
            window.setInterval(() => {
                this.srManager.saveData().catch(error => {
                    console.error('Error in automatic save:', error);
                });
            }, 2 * 60 * 1000)
        );

        this.addCommand({
            id: 'start-review-session',
            name: 'Start review session',
            callback: () => {
                this.activateView();
            }
        });

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TFile | TFolder) => {
                this.addContextMenu(menu, file);
            })
        );


        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (file instanceof TFile && this.srManager.isNoteTracked(file)) {
                    const trackedNotes = this.srManager.getTrackedNotes();
                    const item = trackedNotes.find(item => item.path === oldPath);
                    if (item) {
                        const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
                        if (oldFile instanceof TFile) {
                            this.srManager.untrackNote(oldFile);
                        }
                        item.path = file.path;
                        await this.srManager.trackNote(file);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (file instanceof TFile && this.srManager.isNoteTracked(file)) {
                    this.srManager.untrackNote(file);
                }
            })
        );

        this.addSettingTab(new SpacedRepetitionSettingTab(this.app, this));
    }

    async onunload() {


        if (this.srManager) {
            try {
                await this.srManager.saveData();
                new Notice('Spaced Repetition data saved successfully');
            } catch (error) {
                console.error('Error saving data during unload:', error);
                new Notice('Error saving data before closing');
            }
        }
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_SPACED_REPETITION);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_SPACED_REPETITION,
                    active: true,
                });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    private addContextMenu(menu: Menu, file: TFile | TFolder) {
        menu.addItem((item: MenuItem) => {
            item
                .setTitle('Track for review')
                .setIcon('clock')
                .onClick(async () => {
                    await this.trackItems(file);
                });
        });

        menu.addItem((item: MenuItem) => {
            item
                .setTitle('Untrack from review') 
                .setIcon('x')
                .onClick(async () => {
                    await this.untrackItems(file);
                });
        });
    }

    private async trackItems(file: TFile | TFolder) {
        let count = 0;
        let errors = 0;

        try {
            if (file instanceof TFile) {
                if (file.extension === 'md') {
                    const wasAlreadyTracked = this.srManager.isNoteTracked(file);
                    if (!wasAlreadyTracked) {
                        await this.srManager.trackNote(file);
                        count = 1;
                    }
                }
            } else if (file instanceof TFolder) {
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

    private async untrackItems(file: TFile | TFolder) {
        let count = 0;

        if (file instanceof TFile) {
            if (this.srManager.untrackNote(file)) {
                count = 1;
            }
        } else if (file instanceof TFolder) {
            const files = await this.getMarkdownFilesInFolder(file);
            for (const mdFile of files) {
                if (this.srManager.untrackNote(mdFile)) {
                    count++;
                }
            }
        }

        if (count > 0) {
            new Notice(`Untracked ${count} item${count > 1 ? 's' : ''}`, 3000);
        } else {
            new Notice('No tracked items found to remove', 3000);
        }
    }

    private async getMarkdownFilesInFolder(folder: TFolder): Promise<TFile[]> {
        const files: TFile[] = [];

        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                files.push(child);
            } else if (child instanceof TFolder) {
                const subFiles = await this.getMarkdownFilesInFolder(child);
                files.push(...subFiles);
            }
        }

        return files;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
