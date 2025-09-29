import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import SpacedRepetitionPlugin from '../main';

/**
 * Interface defining the plugin's configuration options
 *
 * These settings control the behavior of the spaced repetition system
 * and are persisted in Obsidian's plugin data storage.
 */
export interface SpacedRepetitionSettings {
    /** Maximum number of new notes to introduce per day (1-1000, or -1 for unlimited) */
    newCardsPerDay: number;
    /** File path for storing review data JSON (relative to vault root) */
    dataLocation: string;
}

/**
 * Default configuration values applied when the plugin is first installed
 * or when settings are missing/corrupted
 */
export const DEFAULT_SETTINGS: SpacedRepetitionSettings = {
    newCardsPerDay: 20,
    dataLocation: 'spaced-repetition-data.json'
}

/**
 * Settings tab class that creates the plugin's configuration interface
 *
 * This tab appears in Obsidian's settings under "Community Plugins" and provides:
 * - User-configurable options for the spaced repetition system
 * - Real-time statistics about tracked notes
 * - Maintenance tools for data cleanup
 * - Keyboard shortcut reference
 * - Information about the SM-2 algorithm
 *
 * The interface validates user input and provides immediate feedback
 * when settings are modified.
 */
export class SpacedRepetitionSettingTab extends PluginSettingTab {
    /** Reference to the main plugin instance for accessing settings and data */
    plugin: SpacedRepetitionPlugin;

    /**
     * Creates a new settings tab instance
     *
     * @param app - Obsidian app instance
     * @param plugin - Main plugin instance for accessing settings and functionality
     */
    constructor(app: App, plugin: SpacedRepetitionPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Builds and displays the complete settings interface
     *
     * This method constructs the entire settings UI including:
     * - Configuration options with validation
     * - Live statistics display
     * - Maintenance tools
     * - Help and reference information
     *
     * The display method is called by Obsidian when the user opens the settings tab.
     */
    display(): void {
        const { containerEl } = this;

        // Clear any existing content to ensure a fresh render
        containerEl.empty();

        // Main title for the settings page
        containerEl.createEl('h2', { text: 'Spaced Repetition Pro Settings' });

        // General description to orient users
        containerEl.createEl('p', {
            text: 'Configure your spaced repetition learning preferences.',
            cls: 'setting-item-description'
        });

        // ========================================
        // NEW CARDS PER DAY SETTING
        // ========================================
        // This setting controls the daily limit for introducing new notes to prevent cognitive overload
        new Setting(containerEl)
            .setName('New cards per day')
            .setDesc('Maximum number of new notes to introduce per day (1-1000).')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.newCardsPerDay))
                .onChange(async (value) => {
                    // Parse and validate the input value
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0 && num <= 1000) {
                        // Valid input - save the setting
                        this.plugin.settings.newCardsPerDay = num;
                        await this.plugin.saveSettings();
                    } else {
                        // Invalid input - show visual feedback with red border
                        text.inputEl.style.borderColor = 'var(--background-modifier-error)';
                        // Auto-clear the error styling after 2 seconds
                        setTimeout(() => {
                            text.inputEl.style.borderColor = '';
                        }, 2000);
                    }
                }));



        // ========================================
        // DATA FILE LOCATION SETTING
        // ========================================
        // This setting allows users to customize where their review data is stored
       
        new Setting(containerEl)
            .setName('Data file location')
            .setDesc('Path to the JSON file where review data is stored. Must end with .json')
            .addText(text => text
                .setPlaceholder('spaced-repetition-data.json')
                .setValue(this.plugin.settings.dataLocation)
                .onChange(async (value) => {
                    // Validate file path: must be .json, no parent directory traversal, no absolute paths
                    if (value.endsWith('.json') && !value.includes('..') && !value.startsWith('/')) {
                        // Valid path - save setting and reload data from new location
                        this.plugin.settings.dataLocation = value;
                        await this.plugin.saveSettings();
                        this.plugin.srManager.loadData();
                    } else {
                        // Invalid path - show visual feedback with red border
                        text.inputEl.style.borderColor = 'var(--background-modifier-error)';
                        // Auto-clear the error styling after 2 seconds
                        setTimeout(() => {
                            text.inputEl.style.borderColor = '';
                        }, 2000);
                    }
                }));
        
        // ========================================
        // STATISTICS SECTION
        // ========================================
        containerEl.createEl('h3', { text: 'Statistics' });
        
         // Container for all statistics displays
        const statsContainer = containerEl.createDiv({ cls: 'sr-stats-container' });
        
        // Get current statistics from the spaced repetition manager
        const stats = this.plugin.srManager.getStatistics();
        
        // Display total number of tracked notes
        new Setting(statsContainer)
            .setName('Total tracked notes')
            .setDesc(`${stats.total} notes are currently being tracked for review`);

        // Display number of notes due for review right now
        new Setting(statsContainer)
            .setName('Due for review')
            .setDesc(`${stats.due} notes are due for review right now`);

        // Display number of notes that have never been reviewed
        new Setting(statsContainer)
            .setName('New notes')
            .setDesc(`${stats.new} notes haven't been reviewed yet`);

        // Display number of notes in the learning phase (recently failed or low repetitions)
        new Setting(statsContainer)
            .setName('Learning notes')
            .setDesc(`${stats.learning} notes are in the learning phase`);
        
        // Display number of notes in the long-term review phase (established in memory)
        new Setting(statsContainer)
            .setName('Review notes')
            .setDesc(`${stats.review} notes are in the long-term review phase`);

        // ========================================
        // MAINTENANCE SECTION
        // ========================================
        containerEl.createEl('h3', { text: 'Maintenance' });

        // Cleanup tool for removing tracking data of deleted notes
        new Setting(containerEl)
            .setName('Clean up deleted notes')
            .setDesc('Remove tracked notes that no longer exist in your vault')
            .addButton(button => button
                .setButtonText('Clean up')
                .onClick(async () => {
                    // Perform cleanup and get count of removed notes
                    const cleaned = await this.plugin.srManager.cleanupDeletedNotes();
                    if (cleaned > 0) {
                        // Refresh the display to show updated statistics
                        this.display();
                        // Show success message with count
                        const { Notice } = require('obsidian');
                        new Notice(`Cleaned up ${cleaned} deleted note${cleaned > 1 ? 's' : ''}`);
                    } else {
                        // Show message when no cleanup was needed
                        const { Notice } = require('obsidian');
                        new Notice('No deleted notes found');
                    }
                }));

        // ========================================
        // KEYBOARD SHORTCUTS SECTION
        // ========================================
        containerEl.createEl('h3', { text: 'Keyboard Shortcuts' });
        
        // Container for keyboard shortcut information
        const shortcutsInfo = containerEl.createDiv({ cls: 'sr-shortcuts-info' });
        shortcutsInfo.createEl('p', { text: 'During review sessions, you can use these shortcuts:' });

        // List of available keyboard shortcuts for efficient reviewing
        const shortcutsList = shortcutsInfo.createEl('ul');
        shortcutsList.createEl('li', { text: 'Spacebar - Show answer / Mark as "Good"' });
        shortcutsList.createEl('li', { text: '1 - Rate as "Again" (forgot completely)' });
        shortcutsList.createEl('li', { text: '2 - Rate as "Hard" (difficult but remembered)' });
        shortcutsList.createEl('li', { text: '3 - Rate as "Good" (remembered with effort)' });
        shortcutsList.createEl('li', { text: '4 - Rate as "Easy" (remembered perfectly)' });

        // ========================================
        // ABOUT SECTION
        // ========================================
        containerEl.createEl('h3', { text: 'About' });

        const aboutContainer = containerEl.createDiv({ cls: 'sr-about' });

        // Explanation of the SM-2 algorithm
        aboutContainer.createEl('p', {
            text: 'Spaced Repetition Pro uses the SM-2 algorithm (SuperMemo 2) to calculate optimal review intervals for your notes.'
        });

        // How the algorithm adapts to performance
        aboutContainer.createEl('p', {
            text: 'The algorithm adapts to your performance, showing difficult notes more frequently and easy ones less often.'
        });

        // Link to additional documentation
        const docsLink = aboutContainer.createEl('p');
        docsLink.createEl('span', { text: 'For more information, visit the ' });
        docsLink.createEl('a', {
            text: 'plugin documentation',
            href: 'https://github.com/yourusername/obsidian-spaced-repetition-pro'
        });
    }
}
