import { Telegraf, Context, Markup } from 'telegraf';
import axios from 'axios';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { ScheduleData, ScheduleMessageResult } from './types.js';
import {
    formatGroupEmoji,
    extractGroupText,
    extractInfoText,
    getElectricityStatus,
    formatElectricityStatus,
    parseOutageTimes,
    formatInfoTimestamp,
} from './utils.js';
import { loadSubscribers, saveSubscribers, loadLastState, saveLastState, loadGroup, saveGroup } from './storage.js';

dotenv.config();

// --- Configuration ---
const SCHEDULE_API_URL = 'https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic';
const POWER_API_URL = 'https://power-api.loe.lviv.ua/api/pw_accounts?pagination=false&city.id=1558&street.id=19009';
const BUILDING_NAME = '50';
const DEFAULT_GROUP = '1.2';

const POWER_API_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://poweron.loe.lviv.ua',
    'Referer': 'https://poweron.loe.lviv.ua/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not defined');
}

// --- Persistent state ---
const subscribers = loadSubscribers();
let lastState: string | null = loadLastState();
let GROUP: string = loadGroup() || DEFAULT_GROUP;

const bot = new Telegraf<Context>(BOT_TOKEN);

// --- Group API Functions ---

/**
 * Fetch group from power API
 * Returns group in format "X.Y" (e.g., "1.2") or null if failed
 */
async function fetchGroupFromApi(): Promise<string | null> {
    try {
        const { data } = await axios.get<any>(POWER_API_URL, {
            timeout: 10_000,
            headers: POWER_API_HEADERS,
        });

        const accounts = data?.['hydra:member'] ?? [];
        const account = accounts.find((a: any) => a.buildingName === BUILDING_NAME);
        
        if (!account?.chergGpv) {
            console.error(`Building ${BUILDING_NAME} not found in API response`);
            return null;
        }

        // Convert "12" to "1.2"
        const gpv = account.chergGpv;
        const group = `${gpv[0]}.${gpv[1]}`;
        console.log(`Fetched group from API: ${group}`);
        return group;
    } catch (err) {
        console.error('Error fetching group from API:', err);
        return null;
    }
}

/**
 * Check and update group, notify subscribers if changed
 */
async function checkAndUpdateGroup(): Promise<void> {
    try {
        const newGroup = await fetchGroupFromApi();
        
        if (newGroup && newGroup !== GROUP) {
            const oldGroup = GROUP;
            GROUP = newGroup;
            saveGroup(newGroup);
            
            console.log(`Group changed: ${oldGroup} -> ${newGroup}`);
            
            // Notify subscribers about group change and send new schedule
            const changeMessage = 
                `⚠️ *Увага! Зміна групи*\n\n` +
                `Вашу групу було змінено:\n` +
                `${formatGroupEmoji(oldGroup)} ➡️ ${formatGroupEmoji(newGroup)}\n\n` +
                `📋 Новий графік:\n`;
            
            try {
                const { fullMessage } = await buildScheduleMessage();
                const fullNotification = changeMessage + fullMessage;
                
                for (const chatId of subscribers) {
                    try {
                        await bot.telegram.sendMessage(chatId, fullNotification, { parse_mode: 'Markdown' });
                    } catch (err: any) {
                        if (err.response?.error_code === 403 || err.response?.error_code === 400) {
                            console.log(`Removing inactive subscriber: ${chatId}`);
                            subscribers.delete(chatId);
                            saveSubscribers(subscribers);
                        }
                    }
                }
                console.log('Group change notification sent');
            } catch (err) {
                console.error('Error sending group change notification:', err);
            }
        }
    } catch (err) {
        console.error('Error checking group:', err);
    }
}

// --- Dynamic keyboards based on subscription status ---

function getReplyKeyboard(chatId: number) {
    const isSubscribed = subscribers.has(chatId);
    return Markup.keyboard([
        ['📊 Статус', '📋 Графік'],
        ['🏠 Моя група', isSubscribed ? '🔕 Відписатись' : '🔔 Підписатись'],
    ]).resize();
}

function getInlineMenu(chatId: number) {
    const isSubscribed = subscribers.has(chatId);
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статус', 'status')],
        [Markup.button.callback('📋 Графік', 'check')],
        [Markup.button.callback('🏠 Моя група', 'mygroup')],
        [isSubscribed 
            ? Markup.button.callback('🔕 Відписатись', 'unsubscribe')
            : Markup.button.callback('🔔 Підписатись', 'subscribe')
        ],
    ]);
}

// --- API Functions ---

/**
 * Fetch schedule data from API
 * Returns both today and tomorrow schedules
 */
async function parseSite(): Promise<ScheduleData> {
    const { data } = await axios.get<any>(SCHEDULE_API_URL, {
        timeout: 10_000,
    });

    const menuItems = data?.['hydra:member']?.[0]?.['menuItems'] ?? data?.[0]?.['menuItems'] ?? [];

    // Find Today and Tomorrow by name or order
    const todayItem = menuItems.find((item: any) => item.name === 'Today' || item.orders === 0);
    const tomorrowItem = menuItems.find((item: any) => item.name === 'Tomorrow' || item.orders === 1);

    return {
        today: todayItem?.rawHtml ?? '',
        tomorrow: tomorrowItem?.rawHtml ?? '',
    };
}

/**
 * Build schedule content (without timestamp) for comparison
 */
function buildScheduleContent(todayGroupText: string, tomorrowGroupText: string | null): string {
    let content = '';

    // Add today's outage times
    const todayTimes = parseOutageTimes(todayGroupText);
    if (todayTimes.length > 0) {
        todayTimes.forEach(t => {
            content += `⏱️ ${t}\n`;
        });
    } else {
        // Check if electricity is available all day
        if (todayGroupText.includes('Електроенергія є')) {
            content += '✅ Електроенергія є весь день\n';
        } else {
            content += `*${GROUP}*: дані недоступні\n`;
        }
    }

    // Add tomorrow's schedule if available
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

    // Add group emoji at the bottom
    const emojiGroup = formatGroupEmoji(GROUP);
    content += `\n${emojiGroup}`;

    return content;
}

/**
 * Build message for /check command
 * Returns both full message (with timestamp) and schedule content (for comparison)
 */
async function buildScheduleMessage(): Promise<ScheduleMessageResult> {
    const { today: todayHtml, tomorrow: tomorrowHtml } = await parseSite();

    if (!todayHtml) {
        const errorMsg = '❌ Дані для Групи ' + GROUP + ' не знайдено';
        return { fullMessage: errorMsg, scheduleContent: errorMsg };
    }

    const todayGroupText = extractGroupText(todayHtml, GROUP);
    const tomorrowGroupText = extractGroupText(tomorrowHtml, GROUP);
    const infoText = extractInfoText(todayHtml);

    if (!todayGroupText) {
        const errorMsg = '❌ Дані для Групи ' + GROUP + ' не знайдено';
        return { fullMessage: errorMsg, scheduleContent: errorMsg };
    }

    // Build schedule content (without timestamp) for comparison
    const scheduleContent = buildScheduleContent(todayGroupText, tomorrowGroupText);

    // Build full message with timestamp for display
    const fullMessage = formatInfoTimestamp(infoText) + scheduleContent;

    return { fullMessage, scheduleContent };
}

/**
 * Build status message
 */
async function buildStatusMessage(): Promise<string> {
    const { today: todayHtml, tomorrow: tomorrowHtml } = await parseSite();

    const todayGroupText = extractGroupText(todayHtml, GROUP);
    const tomorrowGroupText = extractGroupText(tomorrowHtml, GROUP);

    if (!todayGroupText) {
        return '❌ Дані для групи не знайдено';
    }

    const status = getElectricityStatus(todayGroupText, tomorrowGroupText);
    return `⚡ *Статус електроенергії*\n\n${formatElectricityStatus(status)}`;
}

// --- Shared Handler Functions ---

async function handleCheckCommand(ctx: Context) {
    try {
        const { fullMessage } = await buildScheduleMessage();
        await ctx.reply(fullMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in check command:', error);
        await ctx.reply('❌ Помилка при перевірці сайту');
    }
}

async function handleStatusCommand(ctx: Context) {
    try {
        const statusMessage = await buildStatusMessage();
        await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('Error in status command:', err);
        await ctx.reply('❌ Помилка при перевірці статусу');
    }
}

function handleSubscribe(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (subscribers.has(chatId)) {
        return ctx.reply('ℹ️ Ви вже підписані на розсилку.');
    }
    subscribers.add(chatId);
    saveSubscribers(subscribers);
    ctx.reply('✅ Ви підписані на розсилку.', getReplyKeyboard(chatId));
}

function handleUnsubscribe(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`Unsubscribe request from chatId: ${chatId}, subscribers: [${[...subscribers].join(', ')}]`);
    
    if (!subscribers.has(chatId)) {
        return ctx.reply('ℹ️ Ви не підписані на розсилку.');
    }
    subscribers.delete(chatId);
    saveSubscribers(subscribers);
    ctx.reply('❌ Ви відписані від розсилки.', getReplyKeyboard(chatId));
}

async function handleMyGroup(ctx: Context) {
    try {
        const newGroup = await fetchGroupFromApi();
        
        if (newGroup) {
            if (newGroup !== GROUP) {
                const oldGroup = GROUP;
                GROUP = newGroup;
                saveGroup(newGroup);
                
                await ctx.reply(
                    `⚠️ *Групу оновлено!*\n\n` +
                    `Було: ${formatGroupEmoji(oldGroup)}\n` +
                    `Стало: ${formatGroupEmoji(newGroup)}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(
                    `🏠 *Ваша група:* ${formatGroupEmoji(GROUP)}\n\n` +
                    `✅ Група актуальна`,
                    { parse_mode: 'Markdown' }
                );
            }
        } else {
            await ctx.reply(
                `🏠 *Ваша група:* ${formatGroupEmoji(GROUP)}\n\n` +
                `⚠️ Не вдалося перевірити актуальність`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (err) {
        console.error('Error in mygroup command:', err);
        await ctx.reply(`🏠 *Ваша група:* ${formatGroupEmoji(GROUP)}`, { parse_mode: 'Markdown' });
    }
}

/**
 * Check site and send notifications to subscribers if state changed
 * Compares only schedule content (without timestamp) to detect real changes
 */
async function checkAndSend() {
    try {
        const { fullMessage, scheduleContent } = await buildScheduleMessage();

        // Compare only schedule content (without timestamp)
        if (scheduleContent !== lastState) {
            console.log('Schedule changed detected!');
            console.log('Previous state:', JSON.stringify(lastState));
            console.log('New state:', JSON.stringify(scheduleContent));
            
            lastState = scheduleContent;
            saveLastState(scheduleContent);
            
            // Send full message (with timestamp) to all subscribers
            for (const chatId of subscribers) {
                try {
                    await bot.telegram.sendMessage(chatId, fullMessage, { parse_mode: 'Markdown' });
                } catch (err: any) {
                    // Handle blocked users or deleted chats
                    if (err.response?.error_code === 403 || err.response?.error_code === 400) {
                        console.log(`Removing inactive subscriber: ${chatId}`);
                        subscribers.delete(chatId);
                        saveSubscribers(subscribers);
                    } else {
                        console.error(`Failed to send to ${chatId}:`, err.message);
                    }
                }
            }
            console.log('Розсилка відправлена:', new Date());
        } else {
            console.log('Змін немає:', new Date());
        }
    } catch (err) {
        console.error('Помилка при перевірці сайту:', err);
    }
}

// --- Bot Commands ---

bot.start((ctx) => {
    ctx.reply('👋 Бот для перевірки електроенергії.\nОберіть дію:', getReplyKeyboard(ctx.chat.id));
});

bot.command('menu', (ctx) => {
    ctx.reply('Оберіть дію:', getInlineMenu(ctx.chat.id));
});

// --- Reply keyboard text handlers ---

bot.hears('📊 Статус', handleStatusCommand);
bot.hears('📋 Графік', handleCheckCommand);
bot.hears('🏠 Моя група', handleMyGroup);
bot.hears('🔔 Підписатись', handleSubscribe);
bot.hears('🔕 Відписатись', handleUnsubscribe);

// --- Command handlers ---

bot.command('check', handleCheckCommand);
bot.command('status', handleStatusCommand);
bot.command('mygroup', handleMyGroup);
bot.command('subscribe', handleSubscribe);
bot.command('unsubscribe', handleUnsubscribe);

// --- Button callback handlers ---

bot.action('check', async (ctx) => {
    await ctx.answerCbQuery();
    await handleCheckCommand(ctx);
});

bot.action('status', async (ctx) => {
    await ctx.answerCbQuery();
    await handleStatusCommand(ctx);
});

bot.action('subscribe', async (ctx) => {
    await ctx.answerCbQuery();
    handleSubscribe(ctx);
});

bot.action('unsubscribe', async (ctx) => {
    await ctx.answerCbQuery();
    handleUnsubscribe(ctx);
});

bot.action('mygroup', async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyGroup(ctx);
});

// --- Cron jobs ---

// Check schedule every 10 minutes
cron.schedule('*/10 * * * *', () => {
    console.log('Перевірка графіку...');
    void checkAndSend();
});

// Check group every 30 minutes
cron.schedule('*/30 * * * *', () => {
    console.log('Перевірка групи...');
    void checkAndUpdateGroup();
});

// --- Graceful shutdown (important for Railway) ---
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --- Bot startup ---
async function startBot() {
    // Always fetch group from API on startup
    const fetchedGroup = await fetchGroupFromApi();
    if (fetchedGroup) {
        GROUP = fetchedGroup;
        saveGroup(GROUP);
    }
    console.log(`Using group: ${GROUP}`);
    
    await bot.launch();
    console.log('🤖 Bot started');
}

startBot();
