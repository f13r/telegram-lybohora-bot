import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const DATA_FILE = path.join(DATA_DIR, 'data.json');

/**
 * Subscriber info with name
 */
export interface Subscriber {
    chatId: number;
    name: string;
}

/**
 * Data structure for persistent storage
 */
interface StorageData {
    subscribers: Subscriber[];
    lastState: string | null;
    group: string | null;
}

/**
 * Default empty data
 */
const DEFAULT_DATA: StorageData = {
    subscribers: [],
    lastState: null,
    group: null,
};

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
    console.log(`[Storage] DATA_DIR: ${DATA_DIR}, DATA_FILE: ${DATA_FILE}`);
    if (!fs.existsSync(DATA_DIR)) {
        console.log(`[Storage] Creating directory: ${DATA_DIR}`);
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Load all data from storage
 */
function loadData(): StorageData {
    try {
        ensureDataDir();
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            
            // Migration: convert old format (number[]) to new format (Subscriber[])
            if (parsed.subscribers && parsed.subscribers.length > 0) {
                if (typeof parsed.subscribers[0] === 'number') {
                    console.log('[Storage] Migrating old subscribers format...');
                    parsed.subscribers = parsed.subscribers.map((chatId: number) => ({
                        chatId,
                        name: 'Unknown',
                    }));
                }
            }
            
            return { ...DEFAULT_DATA, ...parsed };
        }
    } catch (err) {
        console.error('Error loading data:', err);
    }
    return { ...DEFAULT_DATA };
}

/**
 * Save all data to storage
 */
function saveData(data: StorageData): void {
    try {
        ensureDataDir();
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[Storage] Saved data to ${DATA_FILE}: ${data.subscribers.length} subscribers`);
    } catch (err) {
        console.error('[Storage] Error saving data:', err);
    }
}

// --- Cached data for performance ---
let cachedData: StorageData | null = null;

function getData(): StorageData {
    if (!cachedData) {
        cachedData = loadData();
        console.log(`Loaded data: ${cachedData.subscribers.length} subscribers, group: ${cachedData.group}`);
    }
    return cachedData;
}

function updateData(updates: Partial<StorageData>): void {
    cachedData = { ...getData(), ...updates };
    saveData(cachedData);
}

// --- Public API ---

/**
 * Load subscribers from persistent storage
 * Returns a Map of chatId -> Subscriber
 */
export function loadSubscribers(): Map<number, Subscriber> {
    const data = getData();
    return new Map(data.subscribers.map(s => [s.chatId, s]));
}

/**
 * Save subscribers to persistent storage
 */
export function saveSubscribers(subscribers: Map<number, Subscriber>): void {
    updateData({ subscribers: [...subscribers.values()] });
}

/**
 * Load last state from persistent storage
 */
export function loadLastState(): string | null {
    return getData().lastState;
}

/**
 * Save last state to persistent storage
 */
export function saveLastState(state: string): void {
    updateData({ lastState: state });
}

/**
 * Load group from persistent storage
 */
export function loadGroup(): string | null {
    return getData().group;
}

/**
 * Save group to persistent storage
 */
export function saveGroup(group: string): void {
    updateData({ group });
}
