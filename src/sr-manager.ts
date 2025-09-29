import { TFile } from 'obsidian';
import SpacedRepetitionPlugin from '../main';

/**
 * Interface representing the review data for a single note
 *
 * This contains all the information needed by the SM-2 algorithm
 * to calculate when a note should be reviewed next and how difficult it is.
 */
export interface ReviewItem {
    /** File path of the note being tracked */
    path: string;
    /** Number of days until the next review (can be fractional for sub-daily intervals) */
    interval: number;
    /** SM-2 ease factor determining how much the interval increases after successful reviews */
    easeFactor: number;
    /** Count of consecutive successful reviews (resets to 0 on failure) */
    repetitions: number;
    /** Unix timestamp of when this note should be reviewed next */
    nextReviewDate: number;
    /** Unix timestamp of when this note was last reviewed (optional) */
    lastReviewDate?: number;
    /** Whether this note has never been reviewed before */
    isNew: boolean;
}

/**
 * Interface for the JSON data structure stored in the vault
 *
 * This represents the complete state of the spaced repetition system
 * that gets saved to and loaded from the data file.
 */
interface StorageData {
    /** Data format version for future compatibility */
    version: number;
    /** Array of all tracked review items */
    items: ReviewItem[];
    /** Date string of the last daily reset (format: Date.toDateString()) */
    lastResetDate?: string;
    /** Number of new cards that have been reviewed today */
    newCardsReviewedToday?: number;
}

/**
 * Core spaced repetition manager implementing the SM-2 algorithm
 *
 * This class handles:
 * - Loading and saving review data to JSON files
 * - Tracking which notes are in the system
 * - Calculating review schedules using the SM-2 algorithm
 * - Managing daily limits for new cards
 * - Providing statistics and due note lists
 * - Maintaining data consistency during file operations
 *
 * The SM-2 algorithm was developed by Piotr Wozniak for the SuperMemo software
 * and is one of the most widely used spaced repetition algorithms.
 */
export class SpacedRepetitionManager {
    /** Reference to the main plugin instance */
    private plugin: SpacedRepetitionPlugin;
    /** In-memory map of file paths to their review data for fast access */
    private reviewItems: Map<string, ReviewItem> = new Map();
    /** Path to the JSON file where review data is stored */
    private dataFilePath: string;
    /** Date string of the last daily counter reset */
    private lastResetDate: string='';
    /** Number of new cards reviewed today (resets daily) */
    private newCardsReviewedToday: number = 0;

    /**
     * Creates a new SpacedRepetitionManager instance
     *
     * @param plugin - Reference to the main plugin for accessing settings and Obsidian API
     */
    constructor(plugin: SpacedRepetitionPlugin) {
        this.plugin = plugin;
        this.dataFilePath = this.plugin.settings.dataLocation || 'spaced-repetition-data.json';
    }

    /**
     * Initializes daily tracking data for new cards
     *
     * Called when no previous date is found or when starting fresh.
     * Sets up the daily counter system for limiting new card reviews.
     */
    private initializeDailyData() {
        const today = new Date().toDateString();
        this.lastResetDate = today;
        this.newCardsReviewedToday = 0;  // CAMBIO: reviewed en lugar de added
    }

    /**
     * Checks if we need to reset the daily new card counter
     *
     * Compares the stored last reset date with today's date.
     * If they differ, resets the counter to 0 for the new day.
     * This ensures daily limits work correctly across day boundaries.
     */
    private checkDailyReset() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            console.log(`New day detected. Resetting new cards counter. Previous: ${this.newCardsReviewedToday}`);
            this.lastResetDate = today;
            this.newCardsReviewedToday = 0;  // CAMBIO: reviewed en lugar de added
        }
    }

    /**
     * Loads review data from the JSON file in the vault
     *
     * Handles multiple scenarios:
     * - File exists and has valid data: Load everything into memory
     * - File exists but is empty/corrupted: Initialize with empty data
     * - File doesn't exist: Create new file with default structure
     *
     * Also performs daily reset check after loading to ensure
     * the counter reflects the current day.
     */
    async loadData(): Promise<void> {
        try {
            const adapter = this.plugin.app.vault.adapter;

            if (await adapter.exists(this.dataFilePath)) {
                const content = await adapter.read(this.dataFilePath);

                if (content && content.trim()) {
                    const data: StorageData = JSON.parse(content);

                    // Load all review items into our in-memory map for fast access
                    this.reviewItems.clear();
                    for (const item of data.items || []) {
                        this.reviewItems.set(item.path, item);
                    }

                    // Restore daily tracking state
                    this.lastResetDate = data.lastResetDate || '';
                    this.newCardsReviewedToday = data.newCardsReviewedToday || 0;  // CAMBIO

                    // Check if we need to reset for a new day
                    this.checkDailyReset();

                    console.log(`Loaded ${this.reviewItems.size} review items`);
                } else {
                    // File exists but is empty - initialize with defaults
                    this.reviewItems.clear();
                    this.initializeDailyData();
                    await this.saveData();
                }
            } else {
                // File doesn't exist - create new one with default structure
                this.reviewItems.clear();
                this.initializeDailyData();
                await this.saveData();
                console.log('Created new spaced repetition data file');
            }
        } catch (error) {
            console.error('Error loading spaced repetition data:', error);
            // On any error, start fresh to prevent corruption
            this.reviewItems.clear();
            this.initializeDailyData();
            try {
                await this.saveData();
            } catch (saveError) {
                console.error('Error creating data file:', saveError);
            }
        }
    }

    /**
     * Saves current review data to the JSON file
     *
     * Serializes all in-memory data to JSON format and writes to the vault.
     * This includes all review items and daily tracking information.
     *
     * Uses pretty-printing (2-space indentation) to make the JSON
     * human-readable for debugging purposes.
     */
    async saveData(): Promise<void> {
        try {
            const data: StorageData = {
                version: 1,
                items: Array.from(this.reviewItems.values()),
                lastResetDate: this.lastResetDate,
                newCardsReviewedToday: this.newCardsReviewedToday  // CAMBIO
            };

            const jsonContent = JSON.stringify(data, null, 2);
            const adapter = this.plugin.app.vault.adapter;

            await adapter.write(this.dataFilePath, jsonContent);

            console.log(`Saved ${this.reviewItems.size} review items to ${this.dataFilePath}`);
        } catch (error) {
            console.error('Error saving spaced repetition data:', error);
            throw error;// Re-throw to let caller handle the error
        }
    }

    /**
     * Checks if a note is already being tracked in the spaced repetition system
     *
     * @param file - The file to check
     * @returns true if the note is already tracked, false otherwise
     */
    isNoteTracked(file: TFile): boolean {
        return this.reviewItems.has(file.path);
    }

    /**
     * Adds a new note to the spaced repetition tracking system
     *
     * @param file - The file to start tracking
     *
     * Creates a new ReviewItem with SM-2 default values:
     * - interval: 1 day (will be reviewed immediately)
     * - easeFactor: 2.5 (SM-2 default)
     * - repetitions: 0 (no successful reviews yet)
     * - nextReviewDate: now (available for immediate review)
     * - isNew: true (counts towards daily new card limit)
     *
     * The data is immediately saved to prevent loss if Obsidian crashes.
     */
    async trackNote(file: TFile): Promise<void> {
        if (this.reviewItems.has(file.path)) {
            // Already tracked - no action needed
            return;
        }

        const now = Date.now();
        const newItem: ReviewItem = {
            path: file.path,
            interval: 1,                    // Start with 1-day interval
            easeFactor: 2.5,                // SM-2 default ease factor
            repetitions: 0,                 // No successful reviews yet
            nextReviewDate: now,            // Available for immediate review
            isNew: true                     // Counts towards new card limit
        };

        this.reviewItems.set(file.path, newItem);

        // Critical: Save immediately to prevent data loss
        try {
            await this.saveData();
            console.log(`Successfully tracked note: ${file.path}`);
        } catch (error) {
            // If save fails, rollback the change to maintain consistency
            this.reviewItems.delete(file.path);
            console.error(`Failed to track note ${file.path}:`, error);
            throw error;
        }
    }

    /**
     * Removes a note from the spaced repetition tracking system
     *
     * @param file - The file to stop tracking
     * @returns true if the note was tracked and removed, false if it wasn't tracked
     *
     * The removal is immediately saved to disk. If saving fails,
     * the change is logged but not rolled back since the user
     * explicitly requested the removal.
     */
    untrackNote(file: TFile): boolean {
        const wasTracked = this.reviewItems.delete(file.path);

        if (wasTracked) {
            // Save the change immediately
            this.saveData().then(() => {
                console.log(`Successfully untracked note: ${file.path}`);
            }).catch((error) => {
                console.error(`Failed to save after untracking ${file.path}:`, error);
                // Note: We don't rollback here since the user requested removal
            });
        }

        return wasTracked;
    }

    /**
     * Gets all notes currently being tracked by the system
     *
     * @returns Array of all ReviewItem objects in the system
     *
     * This is primarily used by the statistics display and debugging.
     * The returned array is a copy, so modifications won't affect the original data.
     */
    getTrackedNotes(): ReviewItem[] {
        return Array.from(this.reviewItems.values());
    }

    /**
     * Gets all notes that are currently due for review
     *
     * @returns Array of ReviewItem objects that should be reviewed now
     *
     * This method:
     * 1. Checks for daily reset (new day = reset counters)
     * 2. Identifies notes due for review based on current time
     * 3. Applies daily limits for new cards
     * 4. Sorts results by priority (shorter intervals first)
     *
     * New cards are only included if they don't exceed the daily limit.
     * Existing cards are always included if they're due, regardless of limits.
     */
    getDueNotes(): ReviewItem[] {
        this.checkDailyReset();

        const now = Date.now();
        const maxNewPerDay = this.plugin.settings.newCardsPerDay;

        console.log(`Daily limit check: ${this.newCardsReviewedToday}/${maxNewPerDay} new cards reviewed today`);

        const dueItems: ReviewItem[] = [];
        let newCardsInQueue = 0;// Count new cards we're adding to this queue

        for (const item of this.reviewItems.values()) {
            if (item.isNew) {
                // For new cards, check if we haven't exceeded the daily limit
                if (maxNewPerDay === -1 || this.newCardsReviewedToday + newCardsInQueue < maxNewPerDay) {
                    dueItems.push(item);
                    newCardsInQueue++;
                    console.log(`New card queued. Total new in queue: ${newCardsInQueue}, Already reviewed today: ${this.newCardsReviewedToday}`);
                } else {
                    console.log(`Skipping new card due to daily limit: ${this.newCardsReviewedToday + newCardsInQueue}/${maxNewPerDay}`);
                }
            } else {
                // For existing cards, check if they're due based on scheduled time
                if (item.nextReviewDate <= now) {
                    dueItems.push(item);
                }
            }
        }

        // Sort by priority: shorter intervals first, then by review date
        return dueItems.sort((a, b) => {
            if (a.interval !== b.interval) {
                return a.interval - b.interval;
            }
            return a.nextReviewDate - b.nextReviewDate;
        });
    }

    /**
     * Updates a note's review data after the user rates their recall
     *
     * @param path - Path of the note that was reviewed
     * @param rating - User's rating of how well they remembered the content
     *
     * This method implements the core SM-2 algorithm logic:
     * 1. Converts the rating to a numeric quality (0-5 scale)
     * 2. Applies the SM-2 algorithm to calculate new parameters
     * 3. Updates the note's scheduling data
     * 4. Handles special cases (like "again" ratings)
     * 5. Increments the daily counter for new cards
     * 6. Saves the changes immediately
     *
     * Rating meanings:
     * - "again": Complete failure, restart learning
     * - "hard": Difficult but remembered, reduce future intervals
     * - "good": Normal recall, standard interval increase
     * - "easy": Perfect recall, boost future intervals
     */
    async updateNoteReview(path: string, rating: 'again' | 'hard' | 'good' | 'easy'): Promise<void> {
        const item = this.reviewItems.get(path);
        if (!item) return;

        // Track if this was a new card before we modify it
        const wasNewCard = item.isNew;

        // Convert user-friendly ratings to SM-2 quality values
        const qualityMap = {
            'again': 0,  // Complete failure
            'hard': 2,   // Difficult but recalled
            'good': 3,   // Normal recall with effort
            'easy': 5    // Perfect recall
        };

        const quality = qualityMap[rating];


        // Apply the SM-2 algorithm to get new scheduling parameters
        const result = this.calculateSM2(
            quality,
            item.repetitions,
            item.easeFactor,
            item.interval
        );

        // Update the item with new values
        const now = Date.now();
        item.easeFactor = result.easeFactor;
        item.repetitions = result.repetitions;
        item.interval = result.interval;
        item.lastReviewDate = now;
        item.nextReviewDate = now + (result.interval * 24 * 60 * 60 * 1000);// Convert days to milliseconds
        item.isNew = false;// No longer a new card after first review

        // Increment daily counter only if this was a new card
        if (wasNewCard) {
            this.checkDailyReset();
            this.newCardsReviewedToday++;
            console.log(`New card reviewed! Count now: ${this.newCardsReviewedToday}/${this.plugin.settings.newCardsPerDay}`);
        }

        // Special handling for "again" rating - schedule for immediate re-review
        if (rating === 'again') {
            item.repetitions = 0;
            item.interval = 0.0104; // ~15 minutos
            item.nextReviewDate = now + (15 * 60 * 1000);
        }

        // Save changes immediately to prevent data loss
        try {
            await this.saveData();
            console.log(`Successfully updated review for: ${path}`);
        } catch (error) {
            console.error(`Failed to save review update for ${path}:`, error);
            throw error;
        }
    }

    /**
     * Gets information about the daily new card limit
     *
     * @returns Object containing current usage, limit, and remaining slots
     *
     * This information is used by the UI to:
     * - Show progress towards daily limits
     * - Warn users when approaching limits
     * - Explain why certain new cards aren't available
     */
    getDailyLimitInfo(): { used: number; limit: number; remaining: number } {
        this.checkDailyReset();
        const limit = this.plugin.settings.newCardsPerDay;
        const remaining = limit === -1 ? -1 : Math.max(0, limit - this.newCardsReviewedToday);

        return {
            used: this.newCardsReviewedToday,  // CAMBIO: reviewed en lugar de added
            limit: limit,
            remaining: remaining
        };
    }

    /**
     * Implementation of the SM-2 (SuperMemo 2) spaced repetition algorithm
     *
     * @param quality - Rating quality on 0-5 scale (0=total failure, 5=perfect recall)
     * @param repetitions - Number of consecutive successful reviews
     * @param easeFactor - Current ease factor (how much intervals increase)
     * @param interval - Current interval in days
     * @returns New scheduling parameters calculated by the algorithm
     *
     * The SM-2 algorithm works as follows:
     * 1. If quality < 3: Reset to beginning (interval=1, repetitions=0)
     * 2. Calculate new ease factor based on quality rating
     * 3. Determine new interval based on repetition number
     * 4. Apply quality-based modifiers to the interval
     * 5. Ensure interval stays within reasonable bounds (1-365 days)
     *
     * The algorithm adapts to user performance:
     * - Easy cards get longer intervals
     * - Hard cards get shorter intervals
     * - Failed cards restart the learning process
     */
    private calculateSM2(
        quality: number,
        repetitions: number,
        easeFactor: number,
        interval: number
    ): { interval: number; repetitions: number; easeFactor: number } {

        // If quality is poor (< 3), restart the learning process
        if (quality < 3) {
            return {
                interval: 1,
                repetitions: 0,
                easeFactor: easeFactor // Keep the same ease factor
            };
        }

        // Calculate new ease factor using SM-2 formula
        // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        let newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

        // Ensure ease factor doesn't go below minimum threshold
        if (newEaseFactor < 1.3) {
            newEaseFactor = 1.3;
        }

        // Increment successful repetition count
        const newRepetitions = repetitions + 1;

        // Calculate new interval based on SM-2 rules
        let newInterval: number;

        if (newRepetitions === 1) {
            // First successful repetition: 1 day
            newInterval = 1;
        } else if (newRepetitions === 2) {
            // Second successful repetition: 6 days
            newInterval = 6;
        } else {
            // Subsequent repetitions: multiply previous interval by ease factor
            newInterval = interval * newEaseFactor;
        }

        // Apply quality-based modifiers
        if (quality === 5) {
            // Easy rating: boost interval by 30%
            newInterval *= 1.3;
        } else if (quality === 2) {
            // Hard rating: reduce interval by 40%
            newInterval *= 0.6;
        }

        // Enforce reasonable bounds
        if (newInterval < 1) {
            newInterval = 1;
        }
        if (newInterval > 365) {
            newInterval = 365; // Cap at one year
        }

        return {
            interval: Math.round(newInterval * 100) / 100, // Round to 2 decimal places
            repetitions: newRepetitions,
            easeFactor: Math.round(newEaseFactor * 100) / 100 // Round to 2 decimal places
        };
    }

    /**
     * Generates statistics about the current state of tracked notes
     *
     * @returns Object containing counts of different note categories
     *
     * Categories:
     * - total: All tracked notes
     * - due: Notes that should be reviewed right now
     * - new: Notes that have never been reviewed
     * - learning: Notes in the initial learning phase (failed recently or low repetitions)
     * - review: Notes in the long-term review phase (established successful pattern)
     *
     * These statistics are displayed in the settings tab and help users
     * understand their learning progress.
     */
    getStatistics(): {
        total: number;
        due: number;
        new: number;
        learning: number;
        review: number;
    } {
        const now = Date.now();
        let due = 0;
        let newCards = 0;
        let learning = 0;
        let review = 0;

        for (const item of this.reviewItems.values()) {
            // Categorize notes based on their current state
            if (item.isNew) {
                newCards++;
            } else if (item.repetitions === 0 || item.interval < 1) {
                learning++; // Failed recently or very short intervals
            } else {
                review++; // Established in long-term memory
            }

            // Count notes that are currently due for review
            if (item.nextReviewDate <= now) {
                due++;
            }
        }

        return {
            total: this.reviewItems.size,
            due,
            new: newCards,
            learning,
            review
        };
    }

    /**
     * Removes tracking data for notes that no longer exist in the vault
     *
     * @returns Number of notes that were cleaned up
     *
     * This maintenance function:
     * 1. Checks each tracked note to see if its file still exists
     * 2. Removes tracking data for deleted files
     * 3. Saves the updated data if any changes were made
     *
     * This prevents the data file from growing indefinitely with stale entries
     * and ensures the statistics remain accurate.
     */
    async cleanupDeletedNotes(): Promise<number> {
        let cleaned = 0;
        const adapter = this.plugin.app.vault.adapter;

        // Collect paths to delete to avoid modifying the Map during iteration
        const pathsToDelete: string[] = [];

        for (const [path, _] of this.reviewItems) {
            try {
                const exists = await adapter.exists(path);
                if (!exists) {
                    pathsToDelete.push(path);
                }
            } catch (error) {
                console.error(`Error checking existence of ${path}:`, error);
                // If we can't verify existence, assume it's gone
                pathsToDelete.push(path);
            }
        }

        // Remove all the non-existent paths
        for (const path of pathsToDelete) {
            this.reviewItems.delete(path);
            cleaned++;
        }

        // Save changes if any items were removed
        if (cleaned > 0) {
            try {
                await this.saveData();
                console.log(`Cleaned up ${cleaned} deleted notes`);
            } catch (error) {
                console.error('Error saving after cleanup:', error);
                throw error;
            }
        }

        return cleaned;
    }


}