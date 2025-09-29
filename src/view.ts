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

/** Unique identifier for the spaced repetition view type in Obsidian's workspace */
export const VIEW_TYPE_SPACED_REPETITION = 'spaced-repetition-view';

/**
 * Represents the different states/screens of the review interface
 *
 * - filter: Initial screen for setting up review filters
 * - question: Shows note title and asks user to recall content
 * - answer: Shows full note content and rating buttons
 * - empty: Displayed when no notes are available for review
 */
type ViewState = 'filter' | 'question' | 'answer' | 'empty';

/**
 * Logical operators for combining multiple filters
 *
 * - AND: Both conditions must be true
 * - OR: Either condition can be true
 */
type FilterConnector = 'AND' | 'OR';

/**
 * Represents a single filter condition for notes
 *
 * Filters are based on frontmatter properties and allow users to
 * focus their review sessions on specific subsets of their notes.
 */
interface Filter {
    /** The frontmatter property to filter on (e.g., "tags", "status") */
    property: string;

    /** The value that the property must match */
    value: string;

    /** How this filter combines with the previous one (AND/OR) */
    connector: FilterConnector;
}

/**
 * Main view class for the spaced repetition interface
 *
 * This view provides a complete review experience with four distinct modes:
 *
 * 1. **Filter Mode**: Users select which notes to review based on metadata
 * 2. **Question Mode**: Shows note title, user tries to recall content
 * 3. **Answer Mode**: Shows full note content, user rates their performance
 * 4. **Empty Mode**: Displayed when no notes are available for review
 *
 * The view handles:
 * - Complex filtering logic with AND/OR operators
 * - Keyboard shortcuts for efficient reviewing
 * - Progress tracking through review sessions
 * - Integration with the SM-2 scheduling system
 * - Responsive UI that adapts to different screen sizes
 */
export class SpacedRepetitionView extends ItemView {
    /** Reference to the main plugin for accessing settings and data */
    plugin: SpacedRepetitionPlugin;

    /** Current interface state determining what UI elements are shown */
    currentState: ViewState = 'filter';

    /** Array of notes queued for review in the current session */
    reviewQueue: ReviewItem[] = [];

    /** Index of the currently displayed note in the review queue */
    currentReviewIndex: number = 0;

    /** Array of active filters for selecting which notes to review */
    currentFilters: Filter[] = [];

    /** Obsidian component for managing UI lifecycle and cleanup */
    component: Component;

    /**
     * Creates a new spaced repetition view instance
     *
     * @param leaf - Obsidian workspace leaf that will contain this view
     * @param plugin - Main plugin instance for accessing functionality
     */
    constructor(leaf: WorkspaceLeaf, plugin: SpacedRepetitionPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.component = new Component();
    }

    /**
     * Returns the unique identifier for this view type
     * Used by Obsidian to manage and distinguish different view types
     */
    getViewType() {
        return VIEW_TYPE_SPACED_REPETITION;
    }

    /**
     * Returns the display name shown in tabs and workspace management
     */
    getDisplayText() {
        return 'Spaced Repetition';
    }

    /**
     * Returns the icon identifier for this view's tab
     * Uses Lucide icon names (clock = schedule/time-related)
     */
    getIcon() {
        return 'clock';
    }

    /**
     * Lifecycle method called when the view is opened
     * Initializes the view and renders the initial interface
     */
    async onOpen() {
        this.renderView();
    }

    /**
     * Lifecycle method called when the view is closed
     * Performs cleanup to prevent memory leaks
     */
    async onClose() {
        this.component.unload();
    }

    /**
     * Main rendering method that displays the appropriate interface
     * based on the current state
     *
     * This is the central dispatcher that determines which specific
     * UI to show based on the current workflow state.
     */
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

    /**
     * Handles spacebar key presses for streamlined review workflow
     *
     * Spacebar behavior:
     * - In question mode: Show the answer
     * - In answer mode: Rate as "Good" and move to next note
     *
     * This allows users to quickly review notes with minimal keyboard input.
     */
    public handleSpacebar(): void {
        if (this.currentState === 'question') {
            this.currentState = 'answer';
            this.renderView();
        } else if (this.currentState === 'answer') {
            this.handleRating('good');
        }
    }

    /**
     * Renders the filter selection interface
     *
     * @param container - HTML element to render the interface into
     *
     * This interface allows users to:
     * - Select notes based on frontmatter properties
     * - Combine multiple filters with AND/OR logic
     * - See statistics about available notes
     * - Monitor daily new card limits
     * - Start targeted review sessions
     */
    private async renderFilterView(container: HTMLElement) {
        // Create main container with styling
        const filterContainer = container.createDiv({ cls: 'sr-filter-view' });

        // Main heading
        filterContainer.createEl('h2', { text: 'Filter Review' });

        // Get all available frontmatter properties from tracked notes
        const allProperties = await this.getAllProperties();

        if (allProperties.length === 0) {
            // No properties available - likely no tracked notes yet
            filterContainer.createEl('p', {
                text: 'No properties found',
                cls: 'sr-no-properties'
            });
        } else {
            // Container for adding new filters
            const filterControls = filterContainer.createDiv({ cls: 'sr-filter-controls' });

            // 1. Properties Dropdown
            const propertyDropdown = new DropdownComponent(filterControls);
            propertyDropdown.addOption('', 'Select property');
            allProperties.forEach(prop => {
                propertyDropdown.addOption(prop, prop);
            });

            // 2. Values Dropdown (initially empty)
            const valueDropdown = new DropdownComponent(filterControls);
            valueDropdown.addOption('', 'Select value');

            // Event handler: populate the value dropdown when a property is selected
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
            
            // 3. Connector Dropdown (only displayed if there are existing filters)
            if (this.currentFilters.length > 0) {
                const connectorContainer = filterControls.createDiv({ cls: 'sr-filter-connector-container' });
                connectorContainer.createSpan({ text: 'Add with:', cls: 'sr-connector-label' });

                connectorDropdown = new DropdownComponent(connectorContainer);
                connectorDropdown.addOption('AND', 'AND');
                connectorDropdown.addOption('OR', 'OR');
                connectorDropdown.setValue('AND');
            }

            
            // 4. Button to add the new filter            
            new ButtonComponent(filterControls)
                .setButtonText('Add Filter')
                .onClick(() => {
                    const property = propertyDropdown.getValue();
                    const value = valueDropdown.getValue();
                    // Default to 'AND' for the first filter if the dropdown isn't visible
                    const connector = connectorDropdown ? connectorDropdown.getValue() as FilterConnector : 'AND';

                    if (property && value) {
                        this.currentFilters.push({ property, value, connector });
                        this.renderView();
                    }
                });
        }


        // ========================================
        // Current Filters Display Section
        // ========================================
        if (this.currentFilters.length > 0) {
            const filtersDisplay = filterContainer.createDiv({ cls: 'sr-current-filters' });
            filtersDisplay.createEl('h3', { text: 'Current Filters:' });

            this.currentFilters.forEach((filter, index) => {
                const filterItem = filtersDisplay.createDiv({ cls: 'sr-filter-item' });

                // Remove filter button
                const removeBtn = filterItem.createEl('button', {
                    text: 'Ã—', // HTML entity for multiplication sign, used as close/remove icon
                    cls: 'sr-remove-filter'
                });
                removeBtn.onclick = () => {
                    this.currentFilters.splice(index, 1);
                    this.renderView();
                };

                // Display the filter condition
                if (index === 0) {
                    filterItem.createSpan({ text: `${filter.property} = ${filter.value}` });
                } else {
                    // Prepend connector for filters after the first one
                    filterItem.createSpan({
                        text: ` ${filter.connector} ${filter.property} = ${filter.value}`,
                        cls: 'sr-filter-connector-text'
                    });
                }
            });
        }

        
        
        // ========================================
        // Statistics and Limits Section
        // ========================================
        const stats = filterContainer.createDiv({ cls: 'sr-stats' });
        // Get total tracked items
        const totalItems = this.plugin.srManager.getTrackedNotes().length;
        // Get items matching current filters
        const filteredItems = await this.getFilteredItems();
        // Get daily new card limit information
        const dailyInfo = this.plugin.srManager.getDailyLimitInfo();


        // Display counts
        stats.createEl('p', { text: `Total items: ${totalItems}` });
        stats.createEl('p', { text: `Filtered items: ${filteredItems.length}` });
        

        // Display daily limit details
        if (dailyInfo.limit === -1) {
            stats.createEl('p', { text: 'Daily limit: Unlimited new cards' });
        } else {
            const limitText = `Daily limit: ${dailyInfo.used}/${dailyInfo.limit} new cards reviewed today`;
            const limitEl = stats.createEl('p', { text: limitText });

             // Visual feedback when approaching/hitting the limit
            if (dailyInfo.remaining === 0) {
                limitEl.style.color = 'var(--text-error)';
                limitEl.style.fontWeight = 'bold';
            } else if (dailyInfo.remaining <= 3 && dailyInfo.limit > 5) {
                limitEl.style.color = 'var(--text-warning)';
            }


            if (dailyInfo.remaining > 0) {
                stats.createEl('p', {
                    text: `Remaining new cards today: ${dailyInfo.remaining}`,
                    cls: 'sr-remaining-cards'
                });
            }
        }

        // Display new cards in the filtered set and warn if over the daily limit
        const newInFiltered = filteredItems.filter(item => item.isNew).length;
        if (newInFiltered > 0) {
            const newCardsText = `New cards in filtered results: ${newInFiltered}`;
            const newCardsEl = stats.createEl('p', { text: newCardsText });


            if (dailyInfo.limit !== -1 && newInFiltered > dailyInfo.remaining) {
                newCardsEl.style.color = 'var(--text-warning)';
                stats.createEl('p', {
                    text: `âš ï¸ Only ${dailyInfo.remaining} of these new cards will be available today`,
                    cls: 'sr-warning-text'
                });
            }
        }


        // ========================================
        // Action Buttons
        // ========================================
        const actions = filterContainer.createDiv({ cls: 'sr-actions' });

       // Button to manually apply filters (updates queue/stats)
        new ButtonComponent(actions)
            .setButtonText('Apply Filters')
            .setCta()
            .onClick(async () => {
                await this.applyFilters();
            });

        // Button to clear all active filters
        new ButtonComponent(actions)
            .setButtonText('Clear Filters')
            .onClick(() => {
                this.currentFilters = [];
                this.renderView();
            });

        // Button to start the review session
        const startBtn = new ButtonComponent(actions)
            .setButtonText('Start Review')
            .setCta()
            .onClick(async () => {
                await this.startReview();
            });

        // Disable the start button if the filtered queue is empty
        if(filteredItems.length === 0 && this.currentFilters.length > 0){
            startBtn.setDisabled(true);
            startBtn.setTooltip('No notes match the current filters');
        } else if(filteredItems.length === 0){
            startBtn.setDisabled(true);
            startBtn.setTooltip('No notes due for review');
        }
    }


    /**
     * Renders the question view (ViewState: 'question')
     * Displays the note title and buttons to proceed.
     * @param container - HTML element to render the interface into
     */
    private async renderQuestionView(container: HTMLElement) {
        const questionContainer = container.createDiv({ cls: 'sr-question-view' });

       // Check for queue exhaustion
        if (this.reviewQueue.length === 0 || this.currentReviewIndex >= this.reviewQueue.length) {
            this.currentState = 'empty';
            this.renderView();
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];
        const file = this.app.vault.getAbstractFileByPath(currentItem.path) as TFile;


        // Skip item if file is missing (deleted)
        if (!file) {
            this.currentReviewIndex++;
            this.renderView();
            return;
        }

        // Note title (the question prompt)
        questionContainer.createEl('h1', { text: file.basename, cls: 'sr-question-title' });


        const buttonsContainer = questionContainer.createDiv({ cls: 'sr-buttons' });


        // Button to reveal the answer (transition to 'answer' state)
        new ButtonComponent(buttonsContainer)
            .setButtonText('Show Answer')
            .setCta()
            .onClick(() => {
                this.currentState = 'answer';
                this.renderView();
            });


        // Button to open the source file
        new ButtonComponent(buttonsContainer)
            .setButtonText('Open File')
            .setIcon('external-link')
            .onClick(async () => {
                await this.app.workspace.getLeaf('tab').openFile(file);
            });


        // Spacebar shortcut hint
        const shortcutHint = questionContainer.createEl('p', {
            text: 'Press Spacebar to show answer',
            cls: 'sr-progress-text'
        });
        shortcutHint.style.marginTop = '20px';
        shortcutHint.style.opacity = '0.7';

        // Progress display
        const progress = questionContainer.createDiv({ cls: 'sr-progress' });
        progress.createEl('p', {
            text: `${this.currentReviewIndex + 1} / ${this.reviewQueue.length}`,
            cls: 'sr-progress-text'
        });
    }

    /**
     * Renders the answer view (ViewState: 'answer')
     * Displays the full note content and the rating buttons.
     * @param container - HTML element to render the interface into
     */
    private async renderAnswerView(container: HTMLElement) {
        const answerContainer = container.createDiv({ cls: 'sr-answer-view' });

         // Check for queue exhaustion
        if (this.reviewQueue.length === 0 || this.currentReviewIndex >= this.reviewQueue.length) {
            this.currentState = 'empty';
            this.renderView();
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];
        const file = this.app.vault.getAbstractFileByPath(currentItem.path) as TFile;

        // Skip item if file is missing (deleted)
        if (!file) {
            this.currentReviewIndex++;
            this.renderView();
            return;
        }

        // Note title
        answerContainer.createEl('h1', { text: file.basename, cls: 'sr-answer-title' });


        const contentContainer = answerContainer.createDiv({ cls: 'sr-content' });

        // Read and render Markdown content
        const content = await this.app.vault.read(file);
        await MarkdownRenderer.renderMarkdown(
            content,
            contentContainer,
            file.path,
            this.component
        );

        // Rating buttons section
        const ratingContainer = answerContainer.createDiv({ cls: 'sr-rating-buttons' });

        ratingContainer.createEl('h3', { text: 'How well did you remember?' });

        const buttonsRow = ratingContainer.createDiv({ cls: 'sr-buttons-row' });

        // Rating 1: Again (shortest interval)
        new ButtonComponent(buttonsRow)
            .setButtonText('Again (1)')
            .setClass('sr-rating-again')
            .onClick(() => this.handleRating('again'));

        // Rating 2: Hard
        new ButtonComponent(buttonsRow)
            .setButtonText('Hard (2)')
            .setClass('sr-rating-hard')
            .onClick(() => this.handleRating('hard'));


        // Rating 3: Good (moderate interval)
        new ButtonComponent(buttonsRow)
            .setButtonText('Good (3)')
            .setClass('sr-rating-good')
            .onClick(() => this.handleRating('good'));


        // Rating 4: Easy (longest interval)
        new ButtonComponent(buttonsRow)
            .setButtonText('Easy (4)')
            .setClass('sr-rating-easy')
            .onClick(() => this.handleRating('easy'));


        // Open file button
        const actionsContainer = answerContainer.createDiv({ cls: 'sr-actions' });
        new ButtonComponent(actionsContainer)
            .setButtonText('Open File')
            .setIcon('external-link')
            .onClick(async () => {
                await this.app.workspace.getLeaf('tab').openFile(file);
            });


        // Progress display
        const progress = answerContainer.createDiv({ cls: 'sr-progress' });
        progress.createEl('p', {
            text: `${this.currentReviewIndex + 1} / ${this.reviewQueue.length}`,
            cls: 'sr-progress-text'
        });
    }


    /**
     * Renders the empty view (ViewState: 'empty')
     * Displayed when the review session is complete.
     * @param container - HTML element to render the interface into
     */
    private renderEmptyView(container: HTMLElement) {
        const emptyContainer = container.createDiv({ cls: 'sr-empty-view' });

        // Completion icon
        const iconContainer = emptyContainer.createDiv({ cls: 'sr-empty-icon' });
        setIcon(iconContainer, 'check-circle');

        emptyContainer.createEl('h2', { text: 'No more notes to review' });
        emptyContainer.createEl('p', {
            text: 'You have completed all notes scheduled for today. Great work!'
        });


        // Button to return to the filter configuration
        const actionsContainer = emptyContainer.createDiv({ cls: 'sr-actions' });
        new ButtonComponent(actionsContainer)
            .setButtonText('Back to Filters')
            .setCta()
            .onClick(() => {
                this.currentState = 'filter';
                this.currentFilters = []; // Clear filters on return
                this.renderView();
            });
    }


    /**
     * Handles the user's rating, updates the schedule, and advances the review session.
     *
     * @param rating - The rating provided by the user ('again', 'hard', 'good', 'easy').
     */
    public async handleRating(rating: 'again' | 'hard' | 'good' | 'easy') {
        // Ensure the function is only executed in the 'answer' state
        if (this.currentState !== 'answer') {
            return;
        }

        const currentItem = this.reviewQueue[this.currentReviewIndex];

        // Core logic: Update the note's schedule using the plugin manager
        await this.plugin.srManager.updateNoteReview(currentItem.path, rating);

        // If rated 'again', clone the item and push it to the end of the queue for immediate re-review (leech management)
        if (rating === 'again') {
            const reviewAgain = { ...currentItem };
            this.reviewQueue.push(reviewAgain);
        }


        this.currentReviewIndex++; // Move to the next item

        // Check if the current queue is exhausted
        if (this.currentReviewIndex >= this.reviewQueue.length) {

            // Check for additional due notes not included in this filtered session
            const allDueNotes = this.plugin.srManager.getDueNotes();
            const remainingDueNotes = allDueNotes.filter(note =>
                !this.reviewQueue.some(queuedNote => queuedNote.path === note.path)
            );

            // If there are other due notes, go back to filter view
            if (remainingDueNotes.length > 0) {

                this.currentState = 'filter';
                this.reviewQueue = [];
                new Notice('More notes available. Adjust filters to continue.');
            } else {
                // If no more notes are due, go to empty view
                this.currentState = 'empty';
                this.reviewQueue = [];
            }
        } else {
            // Move to the next question
            this.currentState = 'question';
        }

        await this.renderView();
    }


    /**
     * Checks if there are any due notes that were not included in the current review queue.
     * Used in `handleRating` to determine if the user should be prompted to adjust filters.
     *
     * @param allDueNotes - List of all notes currently due from the manager.
     * @returns `true` if there are due notes outside the current queue.
     */
    private hasUntrackedDueNotes(allDueNotes: any[]): boolean {
        if (this.reviewQueue.length === 0) {
            return allDueNotes.length > 0;
        }


        const queuePaths = new Set(this.reviewQueue.map(item => item.path));

        // Returns true if any due note path is NOT present in the current review queue
        return allDueNotes.some(note => !queuePaths.has(note.path));
    }


    /**
     * Retrieves all unique frontmatter property keys from all tracked notes.
     * Used to populate the property selection dropdown in the filter view.
     *
     * @returns A promise resolving to a sorted array of unique property names.
     */
    private async getAllProperties(): Promise<string[]> {
        const properties = new Set<string>();
        const trackedNotes = this.plugin.srManager.getTrackedNotes();

        for (const note of trackedNotes) {
            const file = this.app.vault.getAbstractFileByPath(note.path) as TFile;
            if (file) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (cache?.frontmatter) {
                    Object.keys(cache.frontmatter).forEach(key => properties.add(key));
                }
            }
        }


        return Array.from(properties).sort();
    }

    /**
     * Retrieves all unique values for a specific frontmatter property across all tracked notes.
     * Used to populate the value selection dropdown in the filter view.
     *
     * @param property - The frontmatter property key to search values for.
     * @returns A promise resolving to a sorted array of unique string values.
     */
    private async getPropertyValues(property: string): Promise<string[]> {
        const values = new Set<string>();
        const trackedNotes = this.plugin.srManager.getTrackedNotes();

        for (const note of trackedNotes) {
            const file = this.app.vault.getAbstractFileByPath(note.path) as TFile;
            if (file) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (cache?.frontmatter?.[property]) {
                    const value = cache.frontmatter[property];

                    if (Array.isArray(value)) {
                        // Handle array-based properties (like tags)
                        value.forEach(v => {
                            if (v !== undefined && v !== null) {
                                values.add(String(v));
                            }
                        });
                    } else if (typeof value === 'string' || typeof value === 'number') {
                        // Handle scalar properties
                        values.add(String(value));
                    }
                }
            }
        }

        return Array.from(values).sort();
    }


    /**
     * Filters the currently due notes based on the active `currentFilters`.
     * Implements the boolean logic (AND/OR) defined by the filter chain.
     *
     * @returns A promise resolving to an array of notes that match all criteria.
     */
    private async getFilteredItems(): Promise<ReviewItem[]> {
        // Start filtering from all notes that are currently due
        let items = this.plugin.srManager.getDueNotes();

        if (this.currentFilters.length === 0) {
            return items;
        }

        const filteredItems: ReviewItem[] = [];

        for (const item of items) {
            const file = this.app.vault.getAbstractFileByPath(item.path) as TFile;
            if (!file) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) continue;

            let matchesAllFilters = true; 
            let currentResult = true; // The running boolean result for the current item

            for (let i = 0; i < this.currentFilters.length; i++) {
                const filter = this.currentFilters[i];
                const propValue = cache.frontmatter[filter.property];

                // Check for a match against the current filter
                let matches = false;

                if (Array.isArray(propValue)) {
                    // Array match: check if the filter value is one of the array elements
                    matches = propValue.includes(filter.value);
                } else if (propValue !== undefined && propValue !== null) {
                    // Scalar match: check for exact string equality
                    matches = String(propValue) === filter.value;
                }

                if (i === 0) {
                    // Initialize the result with the first filter's match status
                    currentResult = matches;
                } else {
                    // Combine with previous result using the connector (AND/OR)
                    if (filter.connector === 'AND') {
                        currentResult = currentResult && matches;
                    } else {
                        currentResult = currentResult || matches;
                    }
                }

                // Optimization: if the connector is 'AND' and the result is false, we can stop filtering this item
                if (filter.connector === 'AND' && !currentResult) {
                    break;
                }
            }

            // If the final accumulated result is true, include the item
            if (currentResult) {
                filteredItems.push(item);
            }
        }

        return filteredItems;
    }

    /**
     * Executes the filtering process and updates the internal `reviewQueue`.
     * Notifies the user of the result count.
     */
    private async applyFilters() {
        this.reviewQueue = await this.getFilteredItems();
        if(this.reviewQueue.length === 0){
            new Notice('No notes match the current filters',3000);
        } else {
            new Notice(`Filtered to ${this.reviewQueue.length} items`);
        }
    }


    /**
     * Initializes the review session.
     * Populates the queue with filtered notes or all due notes if no filters were set.
     */
    private async startReview() {

        // If the queue is empty, default to getting all due notes
        if (this.reviewQueue.length === 0) {
            this.reviewQueue = this.plugin.srManager.getDueNotes();
        }

        // Check the final queue size before starting
        if (this.reviewQueue.length === 0) {
            // Display specific message if notes were filtered out
            if(this.currentFilters.length > 0){
                new Notice('No notes match the applied filters. Clear filters or adjust criteria',4000);
            } else {
                new Notice('No notes due for review',3000);
            }
            this.currentState = 'empty'; // Transition to empty state
        } else {
            // Start the session
            this.currentReviewIndex = 0;
            this.currentState = 'question'; // Start the review loop
            new Notice(`Starting review session with ${this.reviewQueue.length} notes`);
        }
        await this.renderView(); // Render the new state
    }
}
