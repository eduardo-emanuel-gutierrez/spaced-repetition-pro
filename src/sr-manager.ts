import { TFile, Notice } from 'obsidian';
import SpacedRepetitionPlugin from '../main';

export interface ReviewItem {
    path: string;
    interval: number;
    easeFactor: number;
    repetitions: number;
    nextReviewDate: number;
    lastReviewDate?: number;
    isNew: boolean;
}

interface StorageData {
    version: number;
    items: ReviewItem[];
    lastResetDate?: string;
    newCardsReviewedToday?: number;
}

export class SpacedRepetitionManager {
    private plugin: SpacedRepetitionPlugin;
    private reviewItems: Map<string, ReviewItem> = new Map();
    private dataFilePath: string;
    private lastResetDate: string='';
    private newCardsReviewedToday: number = 0;

    constructor(plugin: SpacedRepetitionPlugin) {
        this.plugin = plugin;
        this.dataFilePath = this.plugin.settings.dataLocation || 'spaced-repetition-data.json';
    }

    private initializeDailyData() {
        const today = new Date().toDateString();
        this.lastResetDate = today;
        this.newCardsReviewedToday = 0;
    }

    private checkDailyReset() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.lastResetDate = today;
            this.newCardsReviewedToday = 0;
        }
    }

    async loadData(): Promise<void> {
        try {
            const adapter = this.plugin.app.vault.adapter;

            if (await adapter.exists(this.dataFilePath)) {
                const content = await adapter.read(this.dataFilePath);

                if (content && content.trim()) {
                    const data: StorageData = JSON.parse(content);

                    this.reviewItems.clear();
                    for (const item of data.items || []) {
                        this.reviewItems.set(item.path, item);
                    }

                    this.lastResetDate = data.lastResetDate || '';
                    this.newCardsReviewedToday = data.newCardsReviewedToday || 0;

                    this.checkDailyReset();

                    new Notice(`Loaded ${this.reviewItems.size} review items`);
                } else {
                    this.reviewItems.clear();
                    this.initializeDailyData();
                    await this.saveData();
                }
            } else {
                this.reviewItems.clear();
                this.initializeDailyData();
                await this.saveData();
                new Notice('Created new spaced repetition data file');
            }
        } catch (error) {
            console.error('Error loading spaced repetition data:', error);
            this.reviewItems.clear();
            this.initializeDailyData();
            try {
                await this.saveData();
            } catch (saveError) {
                console.error('Error creating data file:', saveError);
            }
        }
    }

    async saveData(): Promise<void> {
        try {
            const data: StorageData = {
                version: 1,
                items: Array.from(this.reviewItems.values()),
                lastResetDate: this.lastResetDate,
                newCardsReviewedToday: this.newCardsReviewedToday
            };

            const jsonContent = JSON.stringify(data, null, 2);
            const adapter = this.plugin.app.vault.adapter;

            await adapter.write(this.dataFilePath, jsonContent);
        } catch (error) {
            console.error('Error saving spaced repetition data:', error);
            throw error;
        }
    }

    isNoteTracked(file: TFile): boolean {
        return this.reviewItems.has(file.path);
    }

    async trackNote(file: TFile): Promise<void> {
        if (this.reviewItems.has(file.path)) {
            return;
        }

        const now = Date.now();
        const newItem: ReviewItem = {
            path: file.path,
            interval: 1,
            easeFactor: 2.5,
            repetitions: 0,
            nextReviewDate: now,
            isNew: true
        };

        this.reviewItems.set(file.path, newItem);

        try {
            await this.saveData();
        } catch (error) {
            this.reviewItems.delete(file.path);
            console.error(`Failed to track note ${file.path}:`, error);
            throw error;
        }
    }

    untrackNote(file: TFile): boolean {
        const wasTracked = this.reviewItems.delete(file.path);

        if (wasTracked) {
            this.saveData().catch((error) => {
                console.error(`Failed to save after untracking ${file.path}:`, error);
            });
        }

        return wasTracked;
    }

    getTrackedNotes(): ReviewItem[] {
        return Array.from(this.reviewItems.values());
    }

    getDueNotes(): ReviewItem[] {
        this.checkDailyReset();

        const now = Date.now();
        const maxNewPerDay = this.plugin.settings.newCardsPerDay;

        const dueItems: ReviewItem[] = [];
        let newCardsInQueue = 0;

        for (const item of this.reviewItems.values()) {
            if (item.isNew) {
                if (maxNewPerDay === -1 || this.newCardsReviewedToday + newCardsInQueue < maxNewPerDay) {
                    dueItems.push(item);
                    newCardsInQueue++;
                }
            } else {
                if (item.nextReviewDate <= now) {
                    dueItems.push(item);
                }
            }
        }

        return dueItems.sort((a, b) => {
            if (a.interval !== b.interval) {
                return a.interval - b.interval;
            }
            return a.nextReviewDate - b.nextReviewDate;
        });
    }

    async updateNoteReview(path: string, rating: 'again' | 'hard' | 'good' | 'easy'): Promise<void> {
        const item = this.reviewItems.get(path);
        if (!item) return;

        const wasNewCard = item.isNew;

        const qualityMap = {
            'again': 0,
            'hard': 2,
            'good': 3,
            'easy': 5
        };

        const quality = qualityMap[rating];

        const result = this.calculateSM2(
            quality,
            item.repetitions,
            item.easeFactor,
            item.interval
        );

        const now = Date.now();
        item.easeFactor = result.easeFactor;
        item.repetitions = result.repetitions;
        item.interval = result.interval;
        item.lastReviewDate = now;
        item.nextReviewDate = now + (result.interval * 24 * 60 * 60 * 1000);
        item.isNew = false;

        if (wasNewCard) {
            this.checkDailyReset();
            this.newCardsReviewedToday++;
        }

        if (rating === 'again') {
            item.repetitions = 0;
            item.interval = 0.0104;
            item.nextReviewDate = now + (15 * 60 * 1000);
        }

        try {
            await this.saveData();
        } catch (error) {
            console.error(`Failed to save review update for ${path}:`, error);
            throw error;
        }
    }

    getDailyLimitInfo(): { used: number; limit: number; remaining: number } {
        this.checkDailyReset();
        const limit = this.plugin.settings.newCardsPerDay;
        const remaining = limit === -1 ? -1 : Math.max(0, limit - this.newCardsReviewedToday);

        return {
            used: this.newCardsReviewedToday,
            limit: limit,
            remaining: remaining
        };
    }

    private calculateSM2(
        quality: number,
        repetitions: number,
        easeFactor: number,
        interval: number
    ): { interval: number; repetitions: number; easeFactor: number } {

        if (quality < 3) {
            return {
                interval: 1,
                repetitions: 0,
                easeFactor: easeFactor
            };
        }

        let newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

        if (newEaseFactor < 1.3) {
            newEaseFactor = 1.3;
        }

        const newRepetitions = repetitions + 1;

        let newInterval: number;

        if (newRepetitions === 1) {
            newInterval = 1;
        } else if (newRepetitions === 2) {
            newInterval = 6;
        } else {
            newInterval = interval * newEaseFactor;
        }

        if (quality === 5) {
            newInterval *= 1.3;
        } else if (quality === 2) {
            newInterval *= 0.6;
        }

        if (newInterval < 1) {
            newInterval = 1;
        }
        if (newInterval > 365) {
            newInterval = 365;
        }

        return {
            interval: Math.round(newInterval * 100) / 100,
            repetitions: newRepetitions,
            easeFactor: Math.round(newEaseFactor * 100) / 100
        };
    }

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
            if (item.isNew) {
                newCards++;
            } else if (item.repetitions === 0 || item.interval < 1) {
                learning++;
            } else {
                review++;
            }

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

    async cleanupDeletedNotes(): Promise<number> {
        let cleaned = 0;
        const adapter = this.plugin.app.vault.adapter;

        const pathsToDelete: string[] = [];

        for (const [path, _] of this.reviewItems) {
            try {
                const exists = await adapter.exists(path);
                if (!exists) {
                    pathsToDelete.push(path);
                }
            } catch (error) {
                console.error(`Error checking existence of ${path}:`, error);
                pathsToDelete.push(path);
            }
        }

        for (const path of pathsToDelete) {
            this.reviewItems.delete(path);
            cleaned++;
        }

        if (cleaned > 0) {
            try {
                await this.saveData();
            } catch (error) {
                console.error('Error saving after cleanup:', error);
                throw error;
            }
        }

        return cleaned;
    }
}
