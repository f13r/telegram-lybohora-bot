import dayjs from 'dayjs';

export type Range = { 
    start: dayjs.Dayjs; 
    end: dayjs.Dayjs; 
};

export type ScheduleData = {
    today: string;
    tomorrow: string;
};

export type ElectricityStatusResult = {
    isOn: boolean;
    minutesUntilChange: number | null;
    isTomorrow: boolean;
    tomorrowFirstOutage: string | null;
    hasTomorrowSchedule: boolean;
};

export type ScheduleMessageResult = {
    fullMessage: string;      // Message with timestamp (for display)
    scheduleContent: string;  // Schedule only (for comparison)
};

export const TZ = 'Europe/Kyiv';
