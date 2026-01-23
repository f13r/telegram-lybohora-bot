import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { getElectricityStatus, formatDuration, parseOutageTimes, formatGroupEmoji, calculateTotalHours, parseGroupFromApi } from './src/utils.js';
import { TZ } from './src/types.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

// Mock time for testing
function mockNow(time: string, addDays: number = 0) {
    const [hour, minute] = time.split(':').map(Number);
    return dayjs().tz(TZ).add(addDays, 'day').hour(hour).minute(minute).second(0).millisecond(0);
}

// ==================
// TEST CASES - Same Day
// ==================
type TestCase = {
    description: string;
    todayGroupText: string;
    tomorrowGroupText?: string;
    tests: Array<{
        time: string;
        expectedIsOn: boolean;
        expectedMinutes: number | null;
        expectedIsTomorrow?: boolean;
    }>;
};

const sameDayTestCases: TestCase[] = [
    {
        description: 'Multiple outages throughout the day',
        todayGroupText: "Група 1.2. Електроенергії немає з 05:30 до 12:30, з 16:00 до 21:00, з 23:00 до 24:00.",
        tests: [
            { time: '04:00', expectedIsOn: true, expectedMinutes: 90 },
            { time: '06:00', expectedIsOn: false, expectedMinutes: 390 },
            { time: '13:00', expectedIsOn: true, expectedMinutes: 180 },
            { time: '16:30', expectedIsOn: false, expectedMinutes: 270 },
            { time: '22:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '23:30', expectedIsOn: false, expectedMinutes: 30 },
        ],
    },
    {
        description: 'Outages ending before midnight',
        todayGroupText: "Група 1.2. Електроенергії немає з 02:00 до 05:30, з 09:00 до 16:00, з 19:30 до 23:00.",
        tests: [
            { time: '01:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '03:00', expectedIsOn: false, expectedMinutes: 150 },
            { time: '08:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '12:00', expectedIsOn: false, expectedMinutes: 240 },
            { time: '17:00', expectedIsOn: true, expectedMinutes: 150 },
            { time: '20:00', expectedIsOn: false, expectedMinutes: 180 },
            { time: '23:30', expectedIsOn: true, expectedMinutes: null },
        ],
    },
    {
        description: 'Outage starting at midnight',
        todayGroupText: "Група 1.2. Електроенергії немає з 00:00 до 02:00, з 05:00 до 09:00, з 12:30 до 19:00.",
        tests: [
            { time: '01:00', expectedIsOn: false, expectedMinutes: 60 },
            { time: '03:00', expectedIsOn: true, expectedMinutes: 120 },
            { time: '06:00', expectedIsOn: false, expectedMinutes: 180 },
            { time: '10:00', expectedIsOn: true, expectedMinutes: 150 },
            { time: '13:00', expectedIsOn: false, expectedMinutes: 360 },
            { time: '20:00', expectedIsOn: true, expectedMinutes: null },
        ],
    },
    {
        description: 'Four outages including end of day',
        todayGroupText: "Група 1.2. Електроенергії немає з 02:00 до 05:30, з 09:00 до 12:30, з 16:00 до 21:00, з 23:00 до 24:00.",
        tests: [
            { time: '01:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '03:00', expectedIsOn: false, expectedMinutes: 150 },
            { time: '10:00', expectedIsOn: false, expectedMinutes: 150 },
            { time: '14:00', expectedIsOn: true, expectedMinutes: 120 },
            { time: '17:00', expectedIsOn: false, expectedMinutes: 240 },
            { time: '22:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '23:30', expectedIsOn: false, expectedMinutes: 30 },
        ],
    },
    {
        description: 'Complex schedule with midnight outage',
        todayGroupText: "Група 1.2. Електроенергії немає з 00:00 до 03:30, з 07:30 до 14:30, з 17:30 до 20:30, з 23:00 до 24:00.",
        tests: [
            { time: '02:00', expectedIsOn: false, expectedMinutes: 90 },
            { time: '05:00', expectedIsOn: true, expectedMinutes: 150 },
            { time: '08:00', expectedIsOn: false, expectedMinutes: 390 },
            { time: '15:00', expectedIsOn: true, expectedMinutes: 150 },
            { time: '18:00', expectedIsOn: false, expectedMinutes: 150 },
            { time: '22:00', expectedIsOn: true, expectedMinutes: 60 },
            { time: '23:30', expectedIsOn: false, expectedMinutes: 30 },
        ],
    },
    {
        description: 'Three outages ending at 22:30',
        todayGroupText: "Група 1.2. Електроенергії немає з 00:00 до 02:00, з 06:00 до 12:30, з 16:00 до 22:30.",
        tests: [
            { time: '01:00', expectedIsOn: false, expectedMinutes: 60 },
            { time: '03:00', expectedIsOn: true, expectedMinutes: 180 },
            { time: '07:00', expectedIsOn: false, expectedMinutes: 330 },
            { time: '13:00', expectedIsOn: true, expectedMinutes: 180 },
            { time: '17:00', expectedIsOn: false, expectedMinutes: 330 },
            { time: '23:00', expectedIsOn: true, expectedMinutes: null },
        ],
    },
];

// ==================
// TEST CASES - Cross Day (with tomorrow's schedule)
// ==================
const crossDayTestCases: TestCase[] = [
    {
        description: 'Power ON at end of day, tomorrow has outage at 05:00',
        todayGroupText: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 16:00 до 20:00.",
        tomorrowGroupText: "Група 1.2. Електроенергії немає з 05:00 до 09:00, з 13:00 до 17:00.",
        tests: [
            { time: '21:00', expectedIsOn: true, expectedMinutes: 480, expectedIsTomorrow: true }, // 8 hours until 05:00 tomorrow
            { time: '22:00', expectedIsOn: true, expectedMinutes: 420, expectedIsTomorrow: true }, // 7 hours until 05:00 tomorrow
            { time: '23:00', expectedIsOn: true, expectedMinutes: 360, expectedIsTomorrow: true }, // 6 hours until 05:00 tomorrow
        ],
    },
    {
        description: 'Power OFF until midnight, tomorrow starts with outage 00:00-02:00',
        todayGroupText: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 22:00 до 24:00.",
        tomorrowGroupText: "Група 1.2. Електроенергії немає з 00:00 до 02:00, з 06:00 до 10:00.",
        tests: [
            { time: '22:30', expectedIsOn: false, expectedMinutes: 210, expectedIsTomorrow: true }, // 3.5 hours until 02:00 tomorrow
            { time: '23:00', expectedIsOn: false, expectedMinutes: 180, expectedIsTomorrow: true }, // 3 hours until 02:00 tomorrow
            { time: '23:30', expectedIsOn: false, expectedMinutes: 150, expectedIsTomorrow: true }, // 2.5 hours until 02:00 tomorrow
        ],
    },
    {
        description: 'Power OFF until midnight, tomorrow does NOT start with outage',
        todayGroupText: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 22:00 до 24:00.",
        tomorrowGroupText: "Група 1.2. Електроенергії немає з 06:00 до 10:00, з 14:00 до 18:00.",
        tests: [
            { time: '22:30', expectedIsOn: false, expectedMinutes: 90, expectedIsTomorrow: false }, // 1.5 hours until midnight (power returns)
            { time: '23:00', expectedIsOn: false, expectedMinutes: 60, expectedIsTomorrow: false }, // 1 hour until midnight
            { time: '23:30', expectedIsOn: false, expectedMinutes: 30, expectedIsTomorrow: false }, // 30 min until midnight
        ],
    },
    {
        description: 'No tomorrow schedule available',
        todayGroupText: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 16:00 до 20:00.",
        tomorrowGroupText: undefined,
        tests: [
            { time: '21:00', expectedIsOn: true, expectedMinutes: null, expectedIsTomorrow: false },
            { time: '23:00', expectedIsOn: true, expectedMinutes: null, expectedIsTomorrow: false },
        ],
    },
];

// ==================
// RUN TESTS
// ==================
console.log('=== SAME DAY TESTS ===\n');

let passCount = 0;
let failCount = 0;

sameDayTestCases.forEach((tc, idx) => {
    console.log(`Case ${idx + 1}: ${tc.description}`);
    tc.tests.forEach((t, tidx) => {
        const now = mockNow(t.time);
        const status = getElectricityStatus(tc.todayGroupText, tc.tomorrowGroupText, now);

        const isOnPass = status.isOn === t.expectedIsOn;
        const minutesPass = status.minutesUntilChange === t.expectedMinutes;
        const pass = isOnPass && minutesPass;

        if (pass) {
            passCount++;
            console.log(`  ${idx + 1}.${tidx + 1} | ${t.time} | ${t.expectedIsOn ? 'ON' : 'OFF'}/${t.expectedMinutes} | PASS ✅`);
        } else {
            failCount++;
            console.log(`  ${idx + 1}.${tidx + 1} | ${t.time} | Expected: ${t.expectedIsOn ? 'ON' : 'OFF'}/${t.expectedMinutes} | Actual: ${status.isOn ? 'ON' : 'OFF'}/${status.minutesUntilChange} | FAIL ❌`);
        }
    });
    console.log('');
});

console.log('\n=== CROSS DAY TESTS ===\n');

crossDayTestCases.forEach((tc, idx) => {
    console.log(`Case ${idx + 1}: ${tc.description}`);
    tc.tests.forEach((t, tidx) => {
        const now = mockNow(t.time);
        const status = getElectricityStatus(tc.todayGroupText, tc.tomorrowGroupText, now);

        const isOnPass = status.isOn === t.expectedIsOn;
        const minutesPass = status.minutesUntilChange === t.expectedMinutes;
        const isTomorrowPass = t.expectedIsTomorrow === undefined || status.isTomorrow === t.expectedIsTomorrow;
        const pass = isOnPass && minutesPass && isTomorrowPass;

        if (pass) {
            passCount++;
            console.log(`  ${idx + 1}.${tidx + 1} | ${t.time} | ${t.expectedIsOn ? 'ON' : 'OFF'}/${t.expectedMinutes}/${t.expectedIsTomorrow ? 'tomorrow' : 'today'} | PASS ✅`);
        } else {
            failCount++;
            console.log(`  ${idx + 1}.${tidx + 1} | ${t.time} | Expected: ${t.expectedIsOn ? 'ON' : 'OFF'}/${t.expectedMinutes}/${t.expectedIsTomorrow ? 'tomorrow' : 'today'} | Actual: ${status.isOn ? 'ON' : 'OFF'}/${status.minutesUntilChange}/${status.isTomorrow ? 'tomorrow' : 'today'} | FAIL ❌`);
        }
    });
    console.log('');
});

console.log('=== SUMMARY ===');
console.log(`Total: ${passCount + failCount} | Passed: ${passCount} ✅ | Failed: ${failCount} ❌`);

// Test formatDuration
console.log('\n=== FORMAT DURATION TESTS ===');
const durationTests = [
    { minutes: 30, expected: '30 хв' },
    { minutes: 60, expected: '1 год 0 хв' },
    { minutes: 90, expected: '1 год 30 хв' },
    { minutes: 150, expected: '2 год 30 хв' },
    { minutes: 480, expected: '8 год 0 хв' },
];

durationTests.forEach(({ minutes, expected }) => {
    const result = formatDuration(minutes);
    const pass = result === expected;
    if (pass) {
        passCount++;
        console.log(`formatDuration(${minutes}) = "${result}" | PASS ✅`);
    } else {
        failCount++;
        console.log(`formatDuration(${minutes}) = "${result}" | Expected: "${expected}" | FAIL ❌`);
    }
});

// ==================
// TEST - Schedule Content Comparison (no false notifications)
// ==================
console.log('\n=== SCHEDULE CONTENT COMPARISON TESTS ===');

// Helper function to build schedule content (same logic as in index.ts)
function buildScheduleContent(todayGroupText: string, tomorrowGroupText: string | null, group: string = '1.2'): string {
    let content = '';

    const todayTimes = parseOutageTimes(todayGroupText);
    if (todayTimes.length > 0) {
        todayTimes.forEach(t => {
            content += `⏱️ ${t}\n`;
        });
    } else {
        if (todayGroupText.includes('Електроенергія є')) {
            content += '✅ Електроенергія є весь день\n';
        } else {
            content += `*${group}*: дані недоступні\n`;
        }
    }

    if (tomorrowGroupText) {
        const tomorrowTimes = parseOutageTimes(tomorrowGroupText);
        if (tomorrowTimes.length > 0) {
            content += '\n📅 Завтра:\n';
            tomorrowTimes.forEach(t => {
                content += `⏱️ ${t}\n`;
            });
        } else if (tomorrowGroupText.includes('Електроенергія є')) {
            content += '\n📅 Завтра: ✅ Електроенергія є весь день\n';
        }
    }

    const emojiGroup = formatGroupEmoji(group);
    content += `\n${emojiGroup}`;

    return content;
}

type ScheduleComparisonTest = {
    description: string;
    todayGroupText1: string;
    tomorrowGroupText1: string | null;
    todayGroupText2: string;
    tomorrowGroupText2: string | null;
    shouldBeEqual: boolean;
};

const scheduleComparisonTests: ScheduleComparisonTest[] = [
    {
        description: 'Same schedule, different API calls should be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 00:00 до 01:30.",
        tomorrowGroupText1: null,
        todayGroupText2: "Група 1.2. Електроенергії немає з 00:00 до 01:30.",
        tomorrowGroupText2: null,
        shouldBeEqual: true,
    },
    {
        description: 'Same schedule with tomorrow, should be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 16:00 до 20:00.",
        tomorrowGroupText1: "Група 1.2. Електроенергії немає з 05:00 до 09:00.",
        todayGroupText2: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 16:00 до 20:00.",
        tomorrowGroupText2: "Група 1.2. Електроенергії немає з 05:00 до 09:00.",
        shouldBeEqual: true,
    },
    {
        description: 'Different today schedule, should NOT be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 00:00 до 01:30.",
        tomorrowGroupText1: null,
        todayGroupText2: "Група 1.2. Електроенергії немає з 00:00 до 02:00.",
        tomorrowGroupText2: null,
        shouldBeEqual: false,
    },
    {
        description: 'Tomorrow schedule added, should NOT be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText1: null,
        todayGroupText2: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText2: "Група 1.2. Електроенергії немає з 05:00 до 09:00.",
        shouldBeEqual: false,
    },
    {
        description: 'Tomorrow schedule removed, should NOT be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText1: "Група 1.2. Електроенергії немає з 05:00 до 09:00.",
        todayGroupText2: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText2: null,
        shouldBeEqual: false,
    },
    {
        description: 'Tomorrow schedule changed, should NOT be equal',
        todayGroupText1: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText1: "Група 1.2. Електроенергії немає з 05:00 до 09:00.",
        todayGroupText2: "Група 1.2. Електроенергії немає з 08:00 до 12:00.",
        tomorrowGroupText2: "Група 1.2. Електроенергії немає з 06:00 до 10:00.",
        shouldBeEqual: false,
    },
    {
        description: 'Electricity available all day, should be equal',
        todayGroupText1: "Група 1.2. Електроенергія є протягом всього дня.",
        tomorrowGroupText1: null,
        todayGroupText2: "Група 1.2. Електроенергія є протягом всього дня.",
        tomorrowGroupText2: null,
        shouldBeEqual: true,
    },
];

scheduleComparisonTests.forEach((test, idx) => {
    const content1 = buildScheduleContent(test.todayGroupText1, test.tomorrowGroupText1);
    const content2 = buildScheduleContent(test.todayGroupText2, test.tomorrowGroupText2);

    const areEqual = content1 === content2;
    const pass = areEqual === test.shouldBeEqual;

    if (pass) {
        passCount++;
        console.log(`${idx + 1}. ${test.description} | PASS ✅`);
    } else {
        failCount++;
        console.log(`${idx + 1}. ${test.description} | FAIL ❌`);
        console.log(`   Content 1: ${JSON.stringify(content1)}`);
        console.log(`   Content 2: ${JSON.stringify(content2)}`);
        console.log(`   Expected equal: ${test.shouldBeEqual}, Actual equal: ${areEqual}`);
    }
});

// Test parseOutageTimes consistency
console.log('\n=== PARSE OUTAGE TIMES CONSISTENCY TESTS ===');

const parseOutageTimesTests = [
    {
        input: "Група 1.2. Електроенергії немає з 00:00 до 01:30.",
        expected: ["00:00 до 01:30"],
    },
    {
        input: "Група 1.2. Електроенергії немає з 08:00 до 12:00, з 16:00 до 20:00.",
        expected: ["08:00 до 12:00", "16:00 до 20:00"],
    },
    {
        input: "Група 1.2. Електроенергії немає з 00:00 до 02:00, з 06:00 до 12:30, з 16:00 до 22:30.",
        expected: ["00:00 до 02:00", "06:00 до 12:30", "16:00 до 22:30"],
    },
    {
        input: "Група 1.2. Електроенергія є протягом всього дня.",
        expected: [],
    },
];

parseOutageTimesTests.forEach((test, idx) => {
    const result = parseOutageTimes(test.input);
    const pass = JSON.stringify(result) === JSON.stringify(test.expected);

    if (pass) {
        passCount++;
        console.log(`${idx + 1}. parseOutageTimes | PASS ✅`);
    } else {
        failCount++;
        console.log(`${idx + 1}. parseOutageTimes | FAIL ❌`);
        console.log(`   Input: ${test.input}`);
        console.log(`   Expected: ${JSON.stringify(test.expected)}`);
        console.log(`   Actual: ${JSON.stringify(result)}`);
    }
});

// Test calculateTotalHours
console.log('\n=== CALCULATE TOTAL HOURS TESTS ===');

const calculateTotalHoursTests = [
    {
        description: 'Single outage - whole hours',
        input: ['08:00 до 10:00'],
        expected: 2,
    },
    {
        description: 'Single outage - with minutes',
        input: ['08:30 до 10:30'],
        expected: 2,
    },
    {
        description: 'Single outage - half hour',
        input: ['08:00 до 08:30'],
        expected: 0.5,
    },
    {
        description: 'Multiple outages - whole hours',
        input: ['08:00 до 10:00', '14:00 до 18:00'],
        expected: 6,
    },
    {
        description: 'Multiple outages - with minutes (example from user)',
        input: ['00:00 до 04:00', '07:30 до 11:00', '14:30 до 18:00', '21:30 до 24:00'],
        expected: 13.5,
    },
    {
        description: 'Outage ending at 24:00',
        input: ['22:00 до 24:00'],
        expected: 2,
    },
    {
        description: 'Outage starting at 00:00',
        input: ['00:00 до 02:00'],
        expected: 2,
    },
    {
        description: 'Outage spanning midnight (23:00 to 01:00)',
        input: ['23:00 до 01:00'],
        expected: 2,
    },
    {
        description: 'Multiple outages with various durations',
        input: ['00:00 до 02:00', '05:30 до 09:15', '12:00 до 14:30'],
        expected: 2 + 3.75 + 2.5, // 8.25
    },
    {
        description: 'Empty array',
        input: [],
        expected: 0,
    },
    {
        description: 'Complex schedule - all day outages',
        input: ['00:00 до 06:00', '12:00 до 18:00', '22:00 до 24:00'],
        expected: 6 + 6 + 2, // 14
    },
];

calculateTotalHoursTests.forEach((test, idx) => {
    const result = calculateTotalHours(test.input);
    const pass = Math.abs(result - test.expected) < 0.01; // Allow small floating point differences

    if (pass) {
        passCount++;
        console.log(`${idx + 1}. ${test.description} | ${test.input.join(', ')} = ${result} год | PASS ✅`);
    } else {
        failCount++;
        console.log(`${idx + 1}. ${test.description} | FAIL ❌`);
        console.log(`   Input: [${test.input.join(', ')}]`);
        console.log(`   Expected: ${test.expected} год`);
        console.log(`   Actual: ${result} год`);
    }
});

// Test parseGroupFromApi
console.log('\n=== PARSE GROUP FROM API TESTS ===');

const parseGroupFromApiTests = [
    {
        description: 'String format "12" should convert to "1.2"',
        input: '12',
        expected: '1.2',
    },
    {
        description: 'String format "1.2" should remain "1.2"',
        input: '1.2',
        expected: '1.2',
    },
    {
        description: 'Number format 12 should convert to "1.2"',
        input: 12,
        expected: '1.2',
    },
    {
        description: 'Number format 34 should convert to "3.4"',
        input: 34,
        expected: '3.4',
    },
    {
        description: 'String "23" should convert to "2.3"',
        input: '23',
        expected: '2.3',
    },
    {
        description: 'String "1.5" should remain "1.5"',
        input: '1.5',
        expected: '1.5',
    },
    {
        description: 'String "2.1" should remain "2.1"',
        input: '2.1',
        expected: '2.1',
    },
    {
        description: 'Single digit "1" should return null',
        input: '1',
        expected: null,
    },
    {
        description: 'Empty string should return null',
        input: '',
        expected: null,
    },
    {
        description: 'null should return null',
        input: null,
        expected: null,
    },
    {
        description: 'undefined should return null',
        input: undefined,
        expected: null,
    },
    {
        description: 'Number 0 should return null (single digit)',
        input: 0,
        expected: null,
    },
    {
        description: 'Number 5 should return null (single digit)',
        input: 5,
        expected: null,
    },
    {
        description: 'String "123" should convert to "1.2" (takes first 2 digits)',
        input: '123',
        expected: '1.2',
    },
];

parseGroupFromApiTests.forEach((test, idx) => {
    const result = parseGroupFromApi(test.input as any);
    const pass = result === test.expected;

    if (pass) {
        passCount++;
        console.log(`${idx + 1}. ${test.description} | Input: ${JSON.stringify(test.input)} → ${result} | PASS ✅`);
    } else {
        failCount++;
        console.log(`${idx + 1}. ${test.description} | FAIL ❌`);
        console.log(`   Input: ${JSON.stringify(test.input)}`);
        console.log(`   Expected: ${test.expected}`);
        console.log(`   Actual: ${result}`);
    }
});

console.log('\n=== FINAL SUMMARY ===');
console.log(`Total: ${passCount + failCount} | Passed: ${passCount} ✅ | Failed: ${failCount} ❌`);

if (failCount > 0) {
    process.exit(1);
}
