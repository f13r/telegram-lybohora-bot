import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const DATA_FILE = path.join(DATA_DIR, 'data.json');

/**
 * Data structure for persistent storage
 */
interface StorageData {
    subscribers: number[];
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
    if (!fs.existsSync(DATA_DIR)) {
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
            return { ...DEFAULT_DATA, ...JSON.parse(raw) };
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
    } catch (err) {
        console.error('Error saving data:', err);
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
 */
export function loadSubscribers(): Set<number> {
    return new Set(getData().subscribers);
}

/**
 * Save subscribers to persistent storage
 */
export function saveSubscribers(subscribers: Set<number>): void {
    updateData({ subscribers: [...subscribers] });
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
