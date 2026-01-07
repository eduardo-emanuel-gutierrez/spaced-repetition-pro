import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import SpacedRepetitionPlugin from '../main';

export interface SpacedRepetitionSettings {
    newCardsPerDay: number;
    dataLocation: string;
}

export const DEFAULT_SETTINGS: SpacedRepetitionSettings = {
    newCardsPerDay: 20,
    dataLocation: 'spaced-repetition-data.json'
}

export class SpacedRepetitionSettingTab extends PluginSettingTab {
    plugin: SpacedRepetitionPlugin;

    constructor(app: App, plugin: SpacedRepetitionPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Spaced Repetition Pro Settings' });

        containerEl.createEl('p', {
            text: 'Configure your spaced repetition learning preferences.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('New cards per day')
            .setDesc('Maximum number of new notes to introduce per day (1-1000).')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.newCardsPerDay))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0 && num <= 1000) {
                        this.plugin.settings.newCardsPerDay = num;
                        await this.plugin.saveSettings();
                        text.inputEl.classList.remove('sr-input-error');
                    } else {
                        text.inputEl.classList.add('sr-input-error');
                        setTimeout(() => {
                            text.inputEl.classList.remove('sr-input-error');
                        }, 2000);
                    }
                }));

        new Setting(containerEl)
            .setName('Data file location')
            .setDesc('Path to the JSON file where review data is stored. Must end with .json')
            .addText(text => text
                .setPlaceholder('spaced-repetition-data.json')
                .setValue(this.plugin.settings.dataLocation)
                .onChange(async (value) => {
                    if (value.endsWith('.json') && !value.includes('..') && !value.startsWith('/')) {
                        this.plugin.settings.dataLocation = value;
                        await this.plugin.saveSettings();
                        this.plugin.srManager.loadData();
                        text.inputEl.classList.remove('sr-input-error');
                    } else {
                        text.inputEl.classList.add('sr-input-error');
                        setTimeout(() => {
                            text.inputEl.classList.remove('sr-input-error');
                        }, 2000);
                    }
                }));

        containerEl.createEl('h3', { text: 'Statistics' });

        const statsContainer = containerEl.createDiv({ cls: 'sr-stats-container' });

        const stats = this.plugin.srManager.getStatistics();

        new Setting(statsContainer)
            .setName('Total tracked notes')
            .setDesc(`${stats.total} notes are currently being tracked for review`);

        new Setting(statsContainer)
            .setName('Due for review')
            .setDesc(`${stats.due} notes are due for review right now`);

        new Setting(statsContainer)
            .setName('New notes')
            .setDesc(`${stats.new} notes haven't been reviewed yet`);

        new Setting(statsContainer)
            .setName('Learning notes')
            .setDesc(`${stats.learning} notes are in the learning phase`);

        new Setting(statsContainer)
            .setName('Review notes')
            .setDesc(`${stats.review} notes are in the long-term review phase`);

        containerEl.createEl('h3', { text: 'Maintenance' });

        new Setting(containerEl)
            .setName('Clean up deleted notes')
            .setDesc('Remove tracked notes that no longer exist in your vault')
            .addButton(button => button
                .setButtonText('Clean up')
                .onClick(async () => {
                    const cleaned = await this.plugin.srManager.cleanupDeletedNotes();
                    if (cleaned > 0) {
                        this.display();
                        new Notice(`Cleaned up ${cleaned} deleted note${cleaned > 1 ? 's' : ''}`);
                    } else {
                        new Notice('No deleted notes found');
                    }
                }));

        containerEl.createEl('h3', { text: 'Keyboard Shortcuts' });

        const shortcutsInfo = containerEl.createDiv({ cls: 'sr-shortcuts-info' });
        shortcutsInfo.createEl('p', { text: 'During review sessions, you can use these shortcuts:' });

        const shortcutsList = shortcutsInfo.createEl('ul');
        shortcutsList.createEl('li', { text: 'Spacebar - Show answer / Mark as "Good"' });
        shortcutsList.createEl('li', { text: '1 - Rate as "Again" (forgot completely)' });
        shortcutsList.createEl('li', { text: '2 - Rate as "Hard" (difficult but remembered)' });
        shortcutsList.createEl('li', { text: '3 - Rate as "Good" (remembered with effort)' });
        shortcutsList.createEl('li', { text: '4 - Rate as "Easy" (remembered perfectly)' });

        containerEl.createEl('h3', { text: 'About' });

        const aboutContainer = containerEl.createDiv({ cls: 'sr-about' });

        aboutContainer.createEl('p', {
            text: 'Spaced Repetition Pro uses the SM-2 algorithm (SuperMemo 2) to calculate optimal review intervals for your notes.'
        });

        aboutContainer.createEl('p', {
            text: 'The algorithm adapts to your performance, showing difficult notes more frequently and easy ones less often.'
        });

        const docsLink = aboutContainer.createEl('p');
        docsLink.createEl('span', { text: 'For more information, visit the ' });
        docsLink.createEl('a', {
            text: 'plugin documentation',
            href: 'https://github.com/eduardo-emanuel-gutierrez/spaced-repetition-pro'
        });
    }
}
