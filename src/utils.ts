import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import * as cheerio from 'cheerio';
import { Range, ElectricityStatusResult, TZ } from './types.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

/**
 * Convert a digit string to emoji representation
 * e.g., "1.2" -> "1️⃣.2️⃣"
 */
export function numberToEmoji(numberStr: string): string {
    const map: Record<string, string> = {
        '0': '0️⃣',
        '1': '1️⃣',
        '2': '2️⃣',
        '3': '3️⃣',
        '4': '4️⃣',
        '5': '5️⃣',
        '6': '6️⃣',
        '7': '7️⃣',
        '8': '8️⃣',
        '9': '9️⃣',
    };

    return numberStr
        .split('')
        .map(ch => map[ch] ?? ch)
        .join('');
}

/**
 * Format group number as emoji
 * e.g., "1.2" -> "1️⃣.2️⃣"
 */
export function formatGroupEmoji(group: string): string {
    return group.split('.').map(numberToEmoji).join('.');
}

/**
 * Parse group from API response
 * Handles both "12" (converts to "1.2") and "1.2" formats
 * @param chergGpv - Group value from API (can be string "12", "1.2", or number)
 * @returns Parsed group string in "X.Y" format, or null if invalid
 */
export function parseGroupFromApi(chergGpv: string | number | null | undefined): string | null {
    if (!chergGpv) {
        return null;
    }

    const gpv = String(chergGpv);
    
    if (gpv.includes('.')) {
        // Already in "1.2" format
        return gpv;
    } else if (gpv.length >= 2) {
        // Convert "12" to "1.2"
        return `${gpv[0]}.${gpv[1]}`;
    } else {
        // Invalid format (single digit or empty)
        return null;
    }
}

/**
 * Format minutes as human-readable duration
 * e.g., 150 -> "2 год 30 хв"
 */
export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) {
        return `${h} год ${m} хв`;
    }
    return `${m} хв`;
}

/**
 * Parse time ranges from group text
 * e.g., "Група 1.2. Електроенергії немає з 05:30 до 12:30, з 16:00 до 21:00."
 * Returns array of { start, end } dayjs objects for the given baseDate
 */
export function parseTimeRanges(groupText: string, baseDate?: dayjs.Dayjs): Range[] {
    const base = baseDate || dayjs().tz(TZ);
    const ranges: Range[] = [];
    const regex = /з (\d{2}:\d{2}) до (\d{2}:\d{2})/g;
    let match;

    while ((match = regex.exec(groupText)) !== null) {
        const [_, startStr, endStr] = match;
        let start = base.hour(+startStr.split(':')[0]).minute(+startStr.split(':')[1]).second(0).millisecond(0);
        let end = base.hour(+endStr.split(':')[0]).minute(+endStr.split(':')[1]).second(0).millisecond(0);
        
        // Handle 24:00 as next day 00:00
        if (endStr === '24:00') {
            end = base.add(1, 'day').hour(0).minute(0).second(0).millisecond(0);
        }
        
        // If end is before start, it means it crosses midnight
        if (end.isBefore(start)) {
            end = end.add(1, 'day');
        }
        
        ranges.push({ start, end });
    }

    return ranges.sort((a, b) => a.start.valueOf() - b.start.valueOf());
}

/**
 * Extract first outage start time as string (HH:MM)
 */
export function getFirstOutageTime(groupText: string): string | null {
    const match = groupText.match(/з (\d{2}:\d{2}) до/);
    return match ? match[1] : null;
}

/**
 * Extract group text from HTML for a specific group
 */
export function extractGroupText(html: string, group: string): string | null {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    let groupText: string | null = null;

    $('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.startsWith(`Група ${group}.`)) {
            groupText = text;
        }
    });

    return groupText;
}

/**
 * Extract info text (timestamp) from HTML
 */
export function extractInfoText(html: string): string | null {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    let infoText: string | null = null;

    $('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.startsWith('Інформація станом на')) {
            infoText = text;
        }
    });

    return infoText;
}

/**
 * Get electricity status with cross-day support
 * 
 * @param todayGroupText - Today's schedule text for the group
 * @param tomorrowGroupText - Tomorrow's schedule text (optional)
 * @param now - Current time (optional, defaults to now)
 * @returns ElectricityStatusResult with status info
 */
export function getElectricityStatus(
    todayGroupText: string,
    tomorrowGroupText?: string | null,
    now?: dayjs.Dayjs
): ElectricityStatusResult {
    now = now || dayjs().tz(TZ);
    const todayBase = now.startOf('day');
    const tomorrowBase = todayBase.add(1, 'day');

    // Parse today's ranges
    const todayRanges = parseTimeRanges(todayGroupText, todayBase);
    
    // Parse tomorrow's ranges if available
    const tomorrowRanges = tomorrowGroupText 
        ? parseTimeRanges(tomorrowGroupText, tomorrowBase)
        : [];

    let isOn = true;
    let minutesUntilChange: number | null = null;
    let isTomorrow = false;
    let tomorrowFirstOutage: string | null = null;
    const hasTomorrowSchedule = !!tomorrowGroupText && tomorrowRanges.length > 0;

    // Get tomorrow's first outage time for display
    if (tomorrowGroupText) {
        tomorrowFirstOutage = getFirstOutageTime(tomorrowGroupText);
    }

    // Check today's ranges
    for (let i = 0; i < todayRanges.length; i++) {
        const r = todayRanges[i];
        
        if (now.isBetween(r.start, r.end, null, '[)')) {
            // Currently in an outage
            isOn = false;
            
            // Check if this outage extends to end of day (24:00)
            const isLastOutageOfDay = i === todayRanges.length - 1;
            const extendsToMidnight = r.end.hour() === 0 && r.end.date() !== now.date();
            
            if (isLastOutageOfDay && extendsToMidnight && tomorrowRanges.length > 0) {
                // Check if tomorrow starts with an outage at 00:00
                const tomorrowFirst = tomorrowRanges[0];
                const tomorrowStartsWithOutage = tomorrowFirst.start.hour() === 0 && tomorrowFirst.start.minute() === 0;
                
                if (tomorrowStartsWithOutage) {
                    // Power won't come back until tomorrow's first outage ends
                    minutesUntilChange = tomorrowFirst.end.diff(now, 'minute');
                    isTomorrow = true;
                } else {
                    // Power comes back at midnight
                    minutesUntilChange = r.end.diff(now, 'minute');
                }
            } else {
                minutesUntilChange = r.end.diff(now, 'minute');
            }
            break;
        } else if (now.isBefore(r.start)) {
            // Power is on, next outage is upcoming
            isOn = true;
            minutesUntilChange = r.start.diff(now, 'minute');
            break;
        }
    }

    // If we're past all today's outages
    if (minutesUntilChange === null) {
        isOn = true;
        
        // Check tomorrow's schedule for next outage
        if (tomorrowRanges.length > 0) {
            const tomorrowFirst = tomorrowRanges[0];
            minutesUntilChange = tomorrowFirst.start.diff(now, 'minute');
            isTomorrow = true;
        }
    }

    return {
        isOn,
        minutesUntilChange,
        isTomorrow,
        tomorrowFirstOutage,
        hasTomorrowSchedule,
    };
}

/**
 * Format electricity status as a user-friendly message
 */
export function formatElectricityStatus(status: ElectricityStatusResult): string {
    const statusIcon = status.isOn ? '🟢' : '🔴';
    const statusText = status.isOn ? 'Зараз світло є' : 'Зараз світла немає';
    
    let message = `${statusIcon} *${statusText}*`;
    
    if (status.minutesUntilChange !== null && status.minutesUntilChange > 0) {
        const actionText = status.isOn ? 'вимкнення' : 'увімкнення';
        message += `\n⏳ До ${actionText}: *${formatDuration(status.minutesUntilChange)}*`;
        
        if (status.isTomorrow) {
            message += ' _(завтра)_';
        }
    }
    
    // Show tomorrow's schedule info
    if (status.hasTomorrowSchedule) {
        if (status.tomorrowFirstOutage && !status.isTomorrow) {
            message += `\n\n📅 Завтра перше відключення: *${status.tomorrowFirstOutage}*`;
        }
    } else {
        message += '\n\n📅 Графік на завтра недоступний';
    }
    
    return message;
}

/**
 * Parse outage times from group text and format them
 * Returns array of time strings like "05:30 до 12:30"
 */
export function parseOutageTimes(groupText: string): string[] {
    const timesMatch = groupText.match(/немає з (.*)/);
    if (!timesMatch) return [];

    const timesStr = timesMatch[1];
    return timesStr
        .split(',')
        .map(t => t.replace(/з\s*/, '').replace(/\.$/, '').trim())
        .filter(t => t.length > 0);
}

/**
 * Calculate total hours from outage time strings
 * Input: ["08:00 до 10:00", "14:30 до 18:00"]
 * Returns: total hours as number (e.g., 6.5)
 */
export function calculateTotalHours(outageTimes: string[]): number {
    let totalMinutes = 0;
    
    for (const timeRange of outageTimes) {
        const match = timeRange.match(/(\d{2}):(\d{2})\s+до\s+(\d{2}):(\d{2})/);
        if (!match) continue;
        
        const [, startHour, startMin, endHour, endMin] = match;
        const start = parseInt(startHour) * 60 + parseInt(startMin);
        let end = parseInt(endHour) * 60 + parseInt(endMin);
        
        // Handle 24:00 as next day 00:00 (1440 minutes)
        if (endHour === '24' && endMin === '00') {
            end = 24 * 60; // 1440 minutes
        }
        
        // Handle wrap-around (e.g., 23:00 до 01:00)
        if (end < start) {
            end += 24 * 60;
        }
        
        totalMinutes += (end - start);
    }
    
    return totalMinutes / 60;
}

/**
 * Format info timestamp for display
 */
export function formatInfoTimestamp(infoText: string | null): string {
    if (!infoText) return '';

    const infoMatch = infoText.match(/Інформація станом на (\d{2}:\d{2}) (\d{2}\.\d{2}\.\d{4})/);
    if (!infoMatch) return '';

    const [_, time, dateStr] = infoMatch;
    const today = new Date();
    const [day, month, year] = dateStr.split('.').map(Number);
    const infoDate = new Date(year, month - 1, day);

    const isToday =
        today.getDate() === infoDate.getDate() &&
        today.getMonth() === infoDate.getMonth() &&
        today.getFullYear() === infoDate.getFullYear();

    if (isToday) {
        return `📅 Стан на ${time}\n\n`;
    } else {
        return `📅 Стан на ${time} ${dateStr}\n\n`;
    }
}
