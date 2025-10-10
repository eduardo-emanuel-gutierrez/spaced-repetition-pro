import {
    ItemView,
    WorkspaceLeaf,
    TFile,
    MarkdownRenderer,
    Component,
    setIcon,
    ButtonComponent,
    DropdownComponent,
    Notice
} from 'obsidian';
import SpacedRepetitionPlugin from '../main';
import { ReviewItem } from './sr-manager';

export const VIEW_TYPE_SPACED_REPETITION = 'spaced-repetition-view';

type ViewState = 'filter' | 'question' | 'answer' | 'empty';

type FilterConnector = 'AND' | 'OR';

interface Filter {
    property: string;
    value: string;
    connector: FilterConnector;
}

export class SpacedRepetitionView extends ItemView {
    plugin: SpacedRepetitionPlugin;
    currentState: ViewState = 'filter';
    reviewQueue: ReviewItem[] = [];
    currentReviewIndex: number = 0;
    currentFilters: Filter[] = [];
    component: Component;

    constructor(leaf: WorkspaceLeaf, plugin: SpacedRepetitionPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.component = new Component();
    }

    getViewType() {
        return VIEW_TYPE_SPACED_REPETITION;
    }

    getDisplayText() {
        return 'Spaced Repetition';
    }

    getIcon() {
        return 'clock';
    }

    async onOpen() {
        this.renderView();
    }

    async onClose() {
        this.component.unload();
    }

    private async renderView() {
        const container = this.containerEl.children[1];
        container.empty();

        switch (this.currentState) {
            case 'filter':
                await this.renderFilterView(container);
                break;
            case 'question':
                await this.renderQuestionView(container);
                break;
            case 'answer':
                await this.renderAnswerView(container);
                break;
            case 'empty':
                this.renderEmptyView(container);
                break;
        }
    }

    public handleSpacebar(): void {
        if (this.currentState === 'question') {
            this.currentState = 'answer';
            this.renderView();
        } else if (this.currentState === 'answer') {
            this.handleRating('good');
        }
    }

    private async renderFilterView(container: HTMLElement) {
        const filterContainer = container.createDiv({ cls: 'sr-filter-view' });

        filterContainer.createEl('h2', { text: 'Filter Review' });

        const allProperties = await this.getAllProperties();

        if (allProperties.length === 0) {
            filterContainer.createEl('p', {
                text: 'No properties found',
                cls: 'sr-no-properties'
            });
        } else {
            const filterControls = filterContainer.createDiv({ cls: 'sr-filter-controls' });

            const propertyDropdown = new DropdownComponent(filterControls);
            propertyDropdown.addOption('', 'Select property');
            allProperties.forEach(prop => {
                propertyDropdown.addOption(prop, prop);
            });

            const valueDropdown = new DropdownComponent(filterControls);
            valueDropdown.addOption('', 'Select value');

            propertyDropdown.onChange(async (property) => {
                valueDropdown.selectEl.empty();
                valueDropdown.addOption('', 'Select value');

                if (property) {
                    const values = await this.getPropertyValues(property);
                    values.forEach(value => {
                        valueDropdown.addOption(value, value);
                    });
                }
            });

            let connectorDropdown: DropdownComponent | null = null;

            if (this.currentFilters.length > 0) {
                const connectorContainer = filterControls.createDiv({ cls: 'sr-filter-connector-container' });
                connectorContainer.createSpan({ text: 'Add with:', cls: 'sr-connector-label' });

                connectorDropdown = new DropdownComponent(connectorContainer);
                connectorDropdown.addOption('AND', 'AND');
                connectorDropdown.addOption('OR', 'OR');
                connectorDropdown.setValue('AND');
            }

            new ButtonComponent(filterControls)
                .setButtonText('Add Filter')
                .onClick(() => {
                    const property = propertyDropdown.getValue();
                    const value = valueDropdown.getValue();
                    const connector = connectorDropdown ? connectorDropdown.getValue() as FilterConnector : 'AND';

                    if (property && value) {
                        this.currentFilters.push({ property, value, connector });
                        this.renderView();
                    }
                });
        }

        if (this.currentFilters.length > 0) {
            const filtersDisplay = filterContainer.createDiv({ cls: 'sr-current-filters' });
            filtersDisplay.createEl('h3', { text: 'Current Filters:' });

            this.currentFilters.forEach((filter, index) => {
                const filterItem = filtersDisplay.createDiv({ cls: 'sr-filter-item' });

                const removeBtn = filterItem.createEl('button', {
                    text: '×',
                    cls: 'sr-remove-filter'
                });
                removeBtn.onclick = () => {
                    this.currentFilters.splice(index, 1);
                    this.renderView();
                };

                if (index === 0) {
                    filterItem.createSpan({ text: `${filter.property} = ${filter.value}` });
                } else {
                    filterItem.createSpan({
                        text: ` ${filter.connector} ${filter.property} = ${filter.value}`,
                        cls: 'sr-filter-connector-text'
                    });
                }
            });
        }

        const stats = filterContainer.createDiv({ cls: 'sr-stats' });
        const totalItems = this.plugin.srManager.getTrackedNotes().length;
        const filteredItems = await this.getFilteredItems();
        const dailyInfo = this.plugin.srManager.getDailyLimitInfo();

        stats.createEl('p', { text: `Total items: ${totalItems}` });
        stats.createEl('p', { text: `Filtered items: ${filteredItems.length}` });

        if (dailyInfo.limit === -1) {
            stats.createEl('p', { text: 'Daily limit: Unlimited new cards' });
        } else {
            const limitText = `Daily limit: ${dailyInfo.used}/${dailyInfo.limit} new cards reviewed today`;
            const limitEl = stats.createEl('p', { text: limitText });

            if (dailyInfo.remaining === 0) {
                limitEl.classList.add('sr-limit-error');
            } else if (dailyInfo.remaining <= 3 && dailyInfo.limit > 5) {
                limitEl.classList.add('sr-limit-warning');
            }

            if (dailyInfo.remaining > 0) {
                stats.createEl('p', {
                    text: `Remaining new cards today: ${dailyInfo.remaining}`,
                    cls: 'sr-remaining-cards'
                });
            }
        }

        const newInFiltered = filteredItems.filter(item => item.isNew).length;
        if (newInFiltered > 0) {
            const newCardsText = `New cards in filtered results: ${newInFiltered}`;
            const newCardsEl = stats.createEl('p', { text: newCardsText });

            if (dailyInfo.limit !== -1 && newInFiltered > dailyInfo.remaining) {
                newCardsEl.classList.add('sr-new-cards-warning');
                stats.createEl('p', {
                    text: `⚠️ Only ${dailyInfo.remaining} of these new cards will be available today`,
                    cls: 'sr-warning-text'
                });
            }
        }

        const actions = filterContainer.createDiv({ cls: 'sr-actions' });

        new ButtonComponent(actions)
            .setButtonText('Apply Filters')
            .setCta()
            .onClick(async () => {
                await this.applyFilters();
            });

        new ButtonComponent(actions)
            .setButtonText('Clear Filters')
            .onClick(() => {
                this.currentFilters = [];
                this.renderView();
            });

        const startBtn = new ButtonComponent(actions)
            .setButtonText('Start Review')
            .setCta()
            .onClick(async () => {
                await this.startReview();
            });

        if(filteredItems.length === 0 && this.currentFilters.length > 0){
            startBtn.setDisabled(true);
            startBtn.setTooltip('No notes match the current filters');
        } else if(filteredItems.length === 0){
            startBtn.setDisabled(true);
            startBtn.setTooltip('No notes due for review');
        }
    }

    private async renderQuestionView(container: HTMLElement) {
        const questionContainer = container.createDiv({ cls: 'sr-question-view' });

        if (this.reviewQueue.length === 0 || this.currentReviewIndex >= this.reviewQueue.length) {
            this.currentState = 'empty';
            this.renderView();
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];
        const abstractFile = this.app.vault.getAbstractFileByPath(currentItem.path);

        if (!(abstractFile instanceof TFile)) {
            this.currentReviewIndex++;
            this.renderView();
            return;
        }

        const file = abstractFile;

        questionContainer.createEl('h1', { text: file.basename, cls: 'sr-question-title' });

        const buttonsContainer = questionContainer.createDiv({ cls: 'sr-buttons' });

        new ButtonComponent(buttonsContainer)
            .setButtonText('Show Answer')
            .setCta()
            .onClick(() => {
                this.currentState = 'answer';
                this.renderView();
            });

        new ButtonComponent(buttonsContainer)
            .setButtonText('Open File')
            .setIcon('external-link')
            .onClick(async () => {
                await this.app.workspace.getLeaf('tab').openFile(file);
            });

        const shortcutHint = questionContainer.createEl('p', {
            text: 'Press Spacebar to show answer',
            cls: 'sr-shortcut-hint'
        });

        const progress = questionContainer.createDiv({ cls: 'sr-progress' });
        progress.createEl('p', {
            text: `${this.currentReviewIndex + 1} / ${this.reviewQueue.length}`,
            cls: 'sr-progress-text'
        });
    }

    private async renderAnswerView(container: HTMLElement) {
        const answerContainer = container.createDiv({ cls: 'sr-answer-view' });

        if (this.reviewQueue.length === 0 || this.currentReviewIndex >= this.reviewQueue.length) {
            this.currentState = 'empty';
            this.renderView();
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];
        const abstractFile = this.app.vault.getAbstractFileByPath(currentItem.path);

        if (!(abstractFile instanceof TFile)) {
            this.currentReviewIndex++;
            this.renderView();
            return;
        }

        const file = abstractFile;

        answerContainer.createEl('h1', { text: file.basename, cls: 'sr-answer-title' });

        const contentContainer = answerContainer.createDiv({ cls: 'sr-content' });

        const content = await this.app.vault.read(file);
        await MarkdownRenderer.renderMarkdown(
            content,
            contentContainer,
            file.path,
            this.component
        );

        const ratingContainer = answerContainer.createDiv({ cls: 'sr-rating-buttons' });

        ratingContainer.createEl('h3', { text: 'How well did you remember?' });

        const buttonsRow = ratingContainer.createDiv({ cls: 'sr-buttons-row' });

        new ButtonComponent(buttonsRow)
            .setButtonText('Again (1)')
            .setClass('sr-rating-again')
            .onClick(() => this.handleRating('again'));

        new ButtonComponent(buttonsRow)
            .setButtonText('Hard (2)')
            .setClass('sr-rating-hard')
            .onClick(() => this.handleRating('hard'));

        new ButtonComponent(buttonsRow)
            .setButtonText('Good (3)')
            .setClass('sr-rating-good')
            .onClick(() => this.handleRating('good'));

        new ButtonComponent(buttonsRow)
            .setButtonText('Easy (4)')
            .setClass('sr-rating-easy')
            .onClick(() => this.handleRating('easy'));

        const actionsContainer = answerContainer.createDiv({ cls: 'sr-actions' });
        new ButtonComponent(actionsContainer)
            .setButtonText('Open File')
            .setIcon('external-link')
            .onClick(async () => {
                await this.app.workspace.getLeaf('tab').openFile(file);
            });

        const progress = answerContainer.createDiv({ cls: 'sr-progress' });
        progress.createEl('p', {
            text: `${this.currentReviewIndex + 1} / ${this.reviewQueue.length}`,
            cls: 'sr-progress-text'
        });
    }

    private renderEmptyView(container: HTMLElement) {
        const emptyContainer = container.createDiv({ cls: 'sr-empty-view' });

        const iconContainer = emptyContainer.createDiv({ cls: 'sr-empty-icon' });
        setIcon(iconContainer, 'check-circle');

        emptyContainer.createEl('h2', { text: 'No more notes to review' });
        emptyContainer.createEl('p', {
            text: 'You have completed all notes scheduled for today. Great work!'
        });

        const actionsContainer = emptyContainer.createDiv({ cls: 'sr-actions' });
        new ButtonComponent(actionsContainer)
            .setButtonText('Back to Filters')
            .setCta()
            .onClick(() => {
                this.currentState = 'filter';
                this.currentFilters = [];
                this.renderView();
            });
    }

    public async handleRating(rating: 'again' | 'hard' | 'good' | 'easy') {
        if (this.currentState !== 'answer') {
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];

        await this.plugin.srManager.updateNoteReview(currentItem.path, rating);

        if (rating === 'again') {
            const reviewAgain = { ...currentItem };
            this.reviewQueue.push(reviewAgain);
        }

        this.currentReviewIndex++;

        if (this.currentReviewIndex >= this.reviewQueue.length) {
            const allDueNotes = this.plugin.srManager.getDueNotes();
            const remainingDueNotes = allDueNotes.filter(note =>
                !this.reviewQueue.some(queuedNote => queuedNote.path === note.path)
            );

            if (remainingDueNotes.length > 0) {
                this.currentState = 'filter';
                this.reviewQueue = [];
                new Notice('More notes available. Adjust filters to continue.');
            } else {
                this.currentState = 'empty';
                this.reviewQueue = [];
            }
        } else {
            this.currentState = 'question';
        }

        await this.renderView();
    }

    private hasUntrackedDueNotes(allDueNotes: any[]): boolean {
        if (this.reviewQueue.length === 0) {
            return allDueNotes.length > 0;
        }

        const queuePaths = new Set(this.reviewQueue.map(item => item.path));

        return allDueNotes.some(note => !queuePaths.has(note.path));
    }

    private async getAllProperties(): Promise<string[]> {
        const properties = new Set<string>();
        const trackedNotes = this.plugin.srManager.getTrackedNotes();

        for (const note of trackedNotes) {
            const abstractFile = this.app.vault.getAbstractFileByPath(note.path);
            if (abstractFile instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(abstractFile);
                if (cache?.frontmatter) {
                    Object.keys(cache.frontmatter).forEach(key => properties.add(key));
                }
            }
        }

        return Array.from(properties).sort();
    }

    private async getPropertyValues(property: string): Promise<string[]> {
        const values = new Set<string>();
        const trackedNotes = this.plugin.srManager.getTrackedNotes();

        for (const note of trackedNotes) {
            const abstractFile = this.app.vault.getAbstractFileByPath(note.path);
            if (abstractFile instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(abstractFile);
                if (cache?.frontmatter?.[property]) {
                    const value = cache.frontmatter[property];

                    if (Array.isArray(value)) {
                        value.forEach(v => {
                            if (v !== undefined && v !== null) {
                                values.add(String(v));
                            }
                        });
                    } else if (typeof value === 'string' || typeof value === 'number') {
                        values.add(String(value));
                    }
                }
            }
        }

        return Array.from(values).sort();
    }

    private async getFilteredItems(): Promise<ReviewItem[]> {
        let items = this.plugin.srManager.getDueNotes();

        if (this.currentFilters.length === 0) {
            return items;
        }

        const filteredItems: ReviewItem[] = [];

        for (const item of items) {
            const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
            if (!(abstractFile instanceof TFile)) continue;

            const cache = this.app.metadataCache.getFileCache(abstractFile);
            if (!cache?.frontmatter) continue;

            let matchesAllFilters = true;
            let currentResult = true;

            for (let i = 0; i < this.currentFilters.length; i++) {
                const filter = this.currentFilters[i];
                const propValue = cache.frontmatter[filter.property];

                let matches = false;

                if (Array.isArray(propValue)) {
                    matches = propValue.includes(filter.value);
                } else if (propValue !== undefined && propValue !== null) {
                    matches = String(propValue) === filter.value;
                }

                if (i === 0) {
                    currentResult = matches;
                } else {
                    if (filter.connector === 'AND') {
                        currentResult = currentResult && matches;
                    } else {
                        currentResult = currentResult || matches;
                    }
                }

                if (filter.connector === 'AND' && !currentResult) {
                    break;
                }
            }

            if (currentResult) {
                filteredItems.push(item);
            }
        }

        return filteredItems;
    }

    private async applyFilters() {
        this.reviewQueue = await this.getFilteredItems();
        if(this.reviewQueue.length === 0){
            new Notice('No notes match the current filters',3000);
        } else {
            new Notice(`Filtered to ${this.reviewQueue.length} items`);
        }
    }

    private async startReview() {
        if (this.reviewQueue.length === 0) {
            this.reviewQueue = this.plugin.srManager.getDueNotes();
        }

        if (this.reviewQueue.length === 0) {
            if(this.currentFilters.length > 0){
                new Notice('No notes match the applied filters. Clear filters or adjust criteria',4000);
            } else {
                new Notice('No notes due for review',3000);
            }
            this.currentState = 'empty';
        } else {
            this.currentReviewIndex = 0;
            this.currentState = 'question';
            new Notice(`Starting review session with ${this.reviewQueue.length} notes`);
        }
        await this.renderView();
    }
}