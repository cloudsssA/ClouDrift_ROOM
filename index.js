require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { coreDb: db, booksDb, musicDb } = require('./db');
const tts = require('./tts');
tts.initVoiceSchema(db);
const presets = require('./presets');
const vault = require('./vault');
vault.migrateFromCoreDb(db);
const path = require('path');

const compression = require('compression');
const mediaStore = require('./media-store');
mediaStore.migrateExistingBase64({ db, vault });

const app = express();
app.use(cors());

// 全站开启 Gzip 压缩（自动放过 SSE 流式推送，绝不卡顿）
app.use(compression({
    filter: (req, res) => {
        if (req.headers['accept'] === 'text/event-stream') return false;
        return compression.filter(req, res);
    }
}));

app.use(express.json({ limit: '25mb' }));

// 上传的图片/音频走 30 天浏览器强缓存（因为带内容哈希，换图自动换链接，旧图 0ms 秒开！）
app.use('/uploads', express.static(mediaStore.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));
const { registerHomeRoutes } = require('./home-routes');
const homeApi = registerHomeRoutes(app, {
    dataDir: path.join(__dirname, 'data'),
    mediaStore
});
const DEFAULT_INK_COLOR = '#1c1917';

function saveSetting(key, value) {
    if (value !== undefined && value !== null) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    }
}
function getSetting(key, fallback = '') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
}
function getBoolSetting(key, fallback = true) {
    const raw = getSetting(key, '');
    if (raw === '') return fallback;
    return raw === 'true';
}

function getActiveCharKey() {
    const saved = getSetting('activeCharKey', '').trim();
    if (saved) return saved;
    const name = getSetting('charName', '连线搭子').trim() || '连线搭子';
    return `custom_${name}`;
}

function hasNonAscii(str) {
    return /[^\x00-\x7F]/.test(String(str || ''));
}

function normalizeBaseURL(rawUrl) {
    let url = (rawUrl && rawUrl.trim()) || getSetting('baseURL') || process.env.BASE_URL || 'https://api.deepseek.com/v1';
    return url.replace(/\/+$/, '');
}

function resolveApiKey(overrideKey) {
    const cleanOverride = overrideKey ? overrideKey.trim() : '';
    const dbKey = getSetting('apiKey', '').trim();
    const envKey = (process.env.API_KEY || '').trim();

    const candidate = cleanOverride || dbKey || (!hasNonAscii(envKey) ? envKey : '');
    if (!candidate) {
        throw new Error('尚未填入有效的 API Key！请点右上角「⚙️ 设置」填入真实 sk-... 密钥并保存。');
    }
    if (hasNonAscii(candidate)) {
        throw new Error('API Key 不能包含中文或全角字符（你刚才可能填到了占位文字），请重新粘贴纯英文 sk-... 密钥！');
    }
    return candidate;
}

const apiEngine = require('./api-client').createApiEngine({
    db, getSetting, saveSetting, getBoolSetting, cleanAIOutput
});
function createAIClient(overrideKey, overrideBaseURL) {
    return apiEngine.createAIClient(overrideKey, overrideBaseURL);
}

function getModelName(overrideModel) {
    return (overrideModel && overrideModel.trim()) || getSetting('modelName') || process.env.MODEL_NAME || 'deepseek-chat';
}

function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeCharVoiceOverride(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (trimmed === tts.DEFAULT_VOICE_PROMPT.trim()) return '';
    return trimmed;
}

// --- 🧠 提取隐式 <memo>...</memo> 内容（多模态画面记忆回填） ---
function extractMemoTag(rawText) {
    const s = String(rawText || '');
    const m = s.match(/<memo>([\s\S]*?)<\/memo>/i);
    if (m && m[1]) return m[1].trim();
    const unclosed = s.match(/<memo>([\s\S]*)$/i);
    if (unclosed && unclosed[1]) return unclosed[1].trim();
    return '';
}

// --- 🧹 思维链 + <memo> + 哨兵 + 误复读前缀清洗器 ---
function cleanAIOutput(rawText, charName = '') {
    let text = String(rawText || '');
    const regexRules = [
        { find: /<(thinking|think)>[\s\S]*?<\/\1>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?<\/(thinking|think)>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?(?=\[finire\])/gi, replace: '' },
        { find: /<\/?(thinking|think)>\s*/gi, replace: '' },
        { find: /<memo>[\s\S]*?<\/memo>/gi, replace: '' },
        { find: /<memo>[\s\S]*$/gi, replace: '' },
        { find: /<\/?memo>\s*/gi, replace: '' },
        { find: /<\/?voice>\s*/gi, replace: '' },
        { find: /\[(incipere|finire)\]\s*/gi, replace: '' }
    ];
    for (const rule of regexRules) {
        text = text.replace(rule.find, rule.replace);
    }
    text = text.trim();

    text = text.replace(/^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '');
    const activeName = charName || getSetting('charName', '');
    if (activeName) {
        const speakerRe = new RegExp(`^${escapeRegExp(activeName)}\\s*[：:]\\s*`);
        text = text.replace(speakerRe, '');
    }
    text = text.replace(/^[（(](?:通讯消息|便利贴|书桌便利贴|回贴|页边批注[^）)]*|动作·[^）)]*)[）)]\s*/g, '');
    text = text.replace(/[（(](?:页边批注|便利贴|回贴|书桌便利贴)[）)]\s*/g, '');
    return text.trim();
}

function formatLocalTimestamp(dateInput = new Date()) {
    const d = dateInput instanceof Date
        ? dateInput
        : new Date(String(dateInput).replace(' ', 'T') + (String(dateInput).includes('Z') || String(dateInput).includes('+') ? '' : 'Z'));
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    const mm = String(validDate.getMonth() + 1).padStart(2, '0');
    const dd = String(validDate.getDate()).padStart(2, '0');
    const hh = String(validDate.getHours()).padStart(2, '0');
    const mi = String(validDate.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
}

function renderTemplateVars(tpl, charName, userName) {
    return String(tpl || '')
        .replace(/\{\{\s*char\s*\}\}/gi, () => charName)
        .replace(/\{\{\s*user\s*\}\}/gi, () => userName);
}

// --- 🧠 一人一库物理记忆流 + 铁桶级清空守卫 ---
const memoryEpochMap = new Map();

function getMemoryEpoch(charKey = getActiveCharKey()) {
    return memoryEpochMap.get(charKey) || 0;
}

function bumpMemoryEpoch(charKey = getActiveCharKey()) {
    const next = getMemoryEpoch(charKey) + 1;
    memoryEpochMap.set(charKey, next);
    return next;
}

function getResetWatermark(prefix, charKey = getActiveCharKey()) {
    const raw = parseInt(getSetting(`${prefix}_${charKey}`, '0'), 10);
    return isNaN(raw) ? 0 : raw;
}

// --- 📝 统一上下文窗口 & 动态备忘录引擎（全站唯一真源） ---
const memoEngine = require('./memo-engine')(app, {
    vault,
    getSetting, saveSetting, getBoolSetting, getActiveCharKey,
    createAIClient, getModelName, formatLocalTimestamp,
    renderTemplateVars, cleanAIOutput
});

function wipeCharacterMemory(charKey, { clearChat = true, clearNotes = true, hideWidgets = true } = {}) {
    bumpMemoryEpoch(charKey);

    // 自增 ID 水位线截断该角色清空前的划线与摸鱼计数（不破坏 sessions 复盘历史）
    const maxHighlightId = booksDb.prepare('SELECT COALESCE(MAX(id), 0) as maxId FROM highlights').get()?.maxId || 0;
    const maxSessionId = db.prepare('SELECT COALESCE(MAX(id), 0) as maxId FROM sessions').get()?.maxId || 0;
    saveSetting(`memoryResetHlId_${charKey}`, maxHighlightId);
    saveSetting(`memoryResetSessId_${charKey}`, maxSessionId);

    let memDel = 0;
    let chatDel = 0;
    let notesDel = 0;
    if (vault.hasMemoryDb(charKey)) {
        const memDb = vault.getMemoryDb(charKey);
        memDel = memDb.prepare('DELETE FROM memory_events').run().changes;
        if (clearChat) {
            chatDel = memDb.prepare('DELETE FROM chat_messages').run().changes;
        }
        if (clearNotes) {
            notesDel = memDb.prepare('DELETE FROM notes').run().changes;
        }
        // 同步清空动态备忘录正文、计数与水位线，杜绝前世记忆残留
        memoEngine.resetCharMemo(charKey);
    }
    if (hideWidgets) {
        // 同步隐藏相框并彻底清空 ai_memo，下次翻开“给TA看”将触发全新初见识图！
        db.prepare("UPDATE widgets SET visible_to_ai = 0, ai_memo = ''").run();
    }
    try {
        db.prepare("DELETE FROM pending_events WHERE status = 'waiting'").run();
    } catch {}

    console.log(`🧹 已彻底洗白独立库 [${vault.getMemoryDbFilename(charKey)}] | 记忆:${memDel}条, 聊天:${chatDel}条, 便签:${notesDel}条, 备忘录与相框<memo>已置空`);
    return {
        activeCharKey: charKey,
        memoryFile: vault.getMemoryDbFilename(charKey),
        memoryCount: 0,
        memDel,
        chatDel,
        notesDel,
        clearedChat: clearChat,
        clearedNotes: clearNotes,
        hidWidgets: hideWidgets
    };
}

function getMaxContextRounds() {
    return memoEngine.getConfig().maxContextRounds;
}

// 兼容旧读路径（换算为条数，不再单独维护旧设置）
function getContextLimit() {
    return getMaxContextRounds() * 2;
}

function getMemoryCount(charKey = getActiveCharKey()) {
    return vault.getMemoryCount(charKey);
}

function pushMemory(eventType, role, content, charKey = getActiveCharKey(), expectedEpoch = null) {
    if (expectedEpoch !== null && getMemoryEpoch(charKey) !== expectedEpoch) {
        console.log(`🛡️ 拦截过期异步记忆回写 [${charKey}] (${eventType})，因记忆已被重置`);
        return false;
    }
    const clean = String(content || '').trim();
    if (!clean) return false;
    vault.getMemoryDb(charKey)
        .prepare('INSERT INTO memory_events (char_key, event_type, role, content) VALUES (?, ?, ?, ?)')
        .run(charKey, eventType, role, clean);

    // 便利贴、划线批注、切歌审批、专注提醒等全站互动完成一轮时，同步计入备忘录自动维护周期
    if (role === 'assistant') {
        memoEngine.onTurnCompleted(charKey);
    }
    return true;
}

function getUnifiedMemoryMessages(charKey = getActiveCharKey(), options = {}) {
    return memoEngine.getEffectiveHistory(charKey, options);
}

// --- 🎭 核心 Prompt 组装（全量热读取 presets.js + 方案 A 角色语音覆写 + 全站统一注入动态备忘录） ---
function getPersonasBlock(charKey = getActiveCharKey()) {
    const charName = getSetting('charName', '连线搭子');
    const persona = getSetting('persona', '你是一个嘴硬心软、有点傲娇但暗地里很在意对方的线上自习室陪伴者。');
    const userName = getSetting('userName', '我');
    const userPersona = getSetting('userPersona', '');
    const useQuickRelation = getSetting('useQuickRelation', 'false') === 'true';
    const userRelation = getSetting('userRelation', '').trim();
    const charCallUser = getSetting('charCallUser', '').trim();

    const renderedPreset = presets.getPrompt('systemPreset', { char: charName, user: userName });
    const renderedPersona = renderTemplateVars(persona, charName, userName);
    const renderedUserPersona = renderTemplateVars(userPersona, charName, userName).trim();
    const renderedRelation = renderTemplateVars(userRelation, charName, userName).trim();
    const renderedCallUser = renderTemplateVars(charCallUser, charName, userName).trim();

    const userLines = [`用户名字：${userName}`];
    if (useQuickRelation && renderedRelation) {
        userLines.push(`${userName}和${charName}的关系是：${renderedRelation}`);
    }
    if (useQuickRelation && renderedCallUser) {
        userLines.push(`${charName}习惯性称呼${userName}为：${renderedCallUser}`);
    }
    if (renderedUserPersona) {
        userLines.push(`用户设定补充：${renderedUserPersona}`);
    }

    const voiceEnabled = getBoolSetting('voiceEnabled', false);
    const charVoiceOverride = sanitizeCharVoiceOverride(getSetting('voicePrompt', ''));
    const renderedVoicePrompt = charVoiceOverride
        ? renderTemplateVars(charVoiceOverride, charName, userName)
        : presets.getPrompt('voicePrompt', { char: charName, user: userName });
    const voiceSection = voiceEnabled ? `\n\n${renderedVoicePrompt}` : '';
    const memoSection = memoEngine.getMemoPromptBlock(charKey);

    return {
        charName,
        userName,
        promptText: `${renderedPreset}${voiceSection}

【角色卡 · ${charName}】
${renderedPersona}

【用户设定 · ${userName}】
${userLines.join('\n')}

【线上陪伴自习室互动规则】
1. 你们目前不在同一个物理房间，而是通过「线上陪伴自习室」跨屏连线：能看到彼此同步的专注倒计时、共享留声机歌单、共同阅读的书页划线，以及通过自习室的「通讯」和书桌便利贴互动。请保持自然真实的线上陪伴感，不要假装伸手拍对方肩膀或坐在实体旁边。
2. 对话历史按时间顺序呈现，请自然承接上下文，并**精准回应最后一条刚刚发生的最新消息/动作**。
3. 直接用真人自然口吻回复正文，绝对不要在开头或句中输出时间戳（如 [11-21 14:20]）、角色名冒号前缀，也不要输出“（便利贴）”“（页边批注）”之类的系统标签。${memoSection}`
    };
}

// --- 📡 实时自习室状态（按 charKey + 清空水位线严格隔离，绝不走私前世记忆！）---
function getRoomContextSummary(extra = {}) {
    const charKey = extra.charKey || getActiveCharKey();
    const resetHlId = getResetWatermark('memoryResetHlId', charKey);
    const resetSessId = getResetWatermark('memoryResetSessId', charKey);

    const now = new Date();
    const hour = now.getHours();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    let timeVibe = `当前时间 ${timeStr}`;
    if (hour >= 0 && hour < 5) timeVibe += '（凌晨熬夜中，注意提醒作息）';
    else if (hour >= 23) timeVibe += '（夜深了）';

    const latestBook = booksDb.prepare('SELECT title FROM books ORDER BY id DESC LIMIT 1').get();

    const recentHighlights = booksDb.prepare(
        'SELECT text_content FROM highlights WHERE is_shared = 1 AND char_key = ? AND id > ? ORDER BY id DESC LIMIT 3'
    ).all(charKey, resetHlId);

    const todaySlacks = db.prepare(
        "SELECT COUNT(*) as cnt FROM sessions WHERE type = 'slack' AND date(created_at, 'localtime') = date('now', 'localtime') AND id > ?"
    ).get(resetSessId);

    let activeWidget = null;
    if (extra.activeWidgetId !== undefined) {
        if (extra.activeWidgetId) {
            activeWidget = db.prepare('SELECT caption, visible_to_ai, ai_memo FROM widgets WHERE id = ?').get(extra.activeWidgetId);
        }
    } else {
        activeWidget = db.prepare('SELECT caption, visible_to_ai, ai_memo FROM widgets WHERE visible_to_ai = 1 ORDER BY id DESC LIMIT 1').get();
    }
    let widgetMemoLine = '';
    if (activeWidget && activeWidget.visible_to_ai) {
        const memoDesc = (activeWidget.ai_memo || '').trim();
        const capDesc = (activeWidget.caption || '').trim();
        if (memoDesc || capDesc) {
            widgetMemoLine = `\n- 当前书桌相框照片（对方已对你公开）：${memoDesc ? `画面记忆「${memoDesc}」` : ''}${memoDesc && capDesc ? '；' : ''}${capDesc ? `照片备注「${capDesc}」` : ''}`;
        }
    }

    const bookInfo = latestBook ? `《${latestBook.title}》` : '暂未打开特定书目';
    const moodClues = recentHighlights.length > 0
        ? recentHighlights.map(h => `“${h.text_content.slice(0, 40)}”`).join('；')
        : '暂无近期分享的划线';

    let extraInfo = '';
    if (extra.focusState === 'running' || (extra.focusState === undefined && extra.isFocusing === true)) {
        extraInfo += `\n- 线上专注倒计时：【正在倒计时进行中】原定 ${extra.totalMinutes || 25} 分钟，已坚持 ${extra.elapsedMinutes || 0} 分钟，还剩 ${extra.remainingMinutes || 0} 分钟`;
    } else if (extra.focusState === 'paused') {
        extraInfo += `\n- 线上专注倒计时：【暂停休息中】原定 ${extra.totalMinutes || 25} 分钟，已坚持 ${extra.elapsedMinutes || 0} 分钟，还剩 ${extra.remainingMinutes || 0} 分钟`;
    } else if (extra.focusState === 'idle' || extra.isFocusing === false) {
        extraInfo += `\n- 线上专注倒计时：【未开启 / 空闲待机中】（重要：现在根本没有在倒计时！请绝对不要说“倒计时还剩着”“快撑住”之类的台词）`;
    }
    if (extra.currentSong) extraInfo += `\n- 同步留声机正在放：《${extra.currentSong}》`;
    if (extra.deskSummary) extraInfo += `\n- ${extra.deskSummary}`;
    extraInfo += widgetMemoLine;

    const homeSummary = homeApi.getRoomSummaryText(charKey);
    if (homeSummary) extraInfo += `\n- ${homeSummary}`;

    return `【线上自习室实时状态】
- 时间：${timeVibe}
- 同步阅读书目：${bookInfo}
- 最近对方分享给你的划线：${moodClues}
- 今日切屏摸鱼次数：${todaySlacks ? todaySlacks.cnt : 0} 次${extraInfo}`;
}

function buildOrderedMessages(systemAndRoomPrompt, historyMessages, currentUserMessage) {
    return [
        { role: 'system', content: systemAndRoomPrompt },
        ...historyMessages,
        { role: 'user', content: currentUserMessage }
    ];
}

// --- ✒️ 公共方法：为已分享的划线生成 TA 的页边批注 ---
async function generateHighlightAIComment({ highlightId, bookId, bookTitleFallback = '', textContent, userNote, isFocusing, charKey }) {
    const reqEpoch = getMemoryEpoch(charKey);
    const openai = createAIClient();
    const { promptText, userName, charName } = getPersonasBlock(charKey);
    const history = getUnifiedMemoryMessages(charKey);
    const nowTs = formatLocalTimestamp();
    const book = bookId ? booksDb.prepare('SELECT title FROM books WHERE id = ?').get(bookId) : null;
    const rawTitle = (book && book.title) || String(bookTitleFallback || '').trim() || '未命名读物';

    const cleanNote = String(userNote || '').trim();
    const systemPrompt = `${promptText}\n\n${presets.getPrompt('highlightComment', { char: charName, user: userName, bookTitle: rawTitle })}`;

    const userPrompt = `[${nowTs}] ${userName}（书页划线分享）：
- 当前文章/书籍标题：${rawTitle}
- 划出的原文句子：“${textContent}”${cleanNote ? `\n- ${userName} 写的批注：“${cleanNote}”` : ''}`;

    const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
    const response = await openai.chat.completions.create({ model: getModelName(), messages });

    const aiComment = cleanAIOutput(response.choices[0].message.content, charName);
    booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ?').run(aiComment, highlightId);

    const memUser = cleanNote
        ? `（书页划线并附批注）在《${rawTitle}》分享了句子：“${textContent}”，并写了批注：“${cleanNote}”`
        : `（书页划线分享）在《${rawTitle}》分享了句子：“${textContent}”`;
    const lockTag = isFocusing ? '（页边批注·尚未解锁）' : '';

    pushMemory('highlight', 'user', memUser, charKey, reqEpoch);
    pushMemory('highlight', 'assistant', `${lockTag}${aiComment}`, charKey, reqEpoch);
    return aiComment;
}

function maskHighlightsForClient(rows) {
    return rows.map(item => ({
        ...item,
        user_note: item.user_note || '',
        is_shared: item.is_shared === 0 ? 0 : 1,
        ai_comment: (item.is_shared !== 0 && item.status === 'locked')
            ? '🔒 专注结束后显影（点击「请求偷看」可向 TA 申请提前解锁）'
            : (item.ai_comment || '')
    }));
}

// --- 接口 1：配置读写 ---
app.get('/api/config', (req, res) => {
    const savedKey = getSetting('apiKey', '').trim();
    const envKey = (process.env.API_KEY || '').trim();
    const validKey = (!hasNonAscii(savedKey) && savedKey) || (!hasNonAscii(envKey) && envKey) || '';
    const activeCharKey = getActiveCharKey();
    const allPresets = presets.getAllCurrent();
    const charVoiceOverride = sanitizeCharVoiceOverride(getSetting('voicePrompt', ''));

    res.json({
        mode: getSetting('mode', 'standalone'),
        soloMode: getBoolSetting('soloMode', false),
        notifyOnFocusDecision: getBoolSetting('notifyOnFocusDecision', true),
        notifyOnPauseTimeout: getBoolSetting('notifyOnPauseTimeout', true),
        notifyOnFocusComplete: getBoolSetting('notifyOnFocusComplete', true),
        apiKey: validKey,
        baseURL: getSetting('baseURL') || process.env.BASE_URL || 'https://api.deepseek.com/v1',
        modelName: getSetting('modelName') || process.env.MODEL_NAME || 'deepseek-chat',
        systemPreset: allPresets.systemPreset,
        defaultSystemPreset: presets.FACTORY_DEFAULTS.systemPreset,
        activeCharKey,
        memoryFile: vault.getMemoryDbFilename(activeCharKey),
        presetProfile: getSetting('presetProfile', ''),
        charName: getSetting('charName', '连线搭子'),
        persona: getSetting('persona', '你是一个嘴硬心软、有点傲娇但暗地里很在意对方的线上自习室陪伴者。'),
        charAvatar: getSetting('charAvatar', ''),
        activeUserId: getSetting('activeUserId', ''),
        userName: getSetting('userName', '我'),
        useQuickRelation: getBoolSetting('useQuickRelation', false),
        userRelation: getSetting('userRelation', ''),
        charCallUser: getSetting('charCallUser', ''),
        userPersona: getSetting('userPersona', ''),
        userAvatar: getSetting('userAvatar', ''),
        inkColor: getSetting('inkColor', DEFAULT_INK_COLOR),
        noteColor: getSetting('noteColor', '#fef08a'),
        pageBgColor: getSetting('pageBgColor', '#1a1918'),
        cardBgColor: getSetting('cardBgColor', '#2a2826'),
        accentColor: getSetting('accentColor', '#d97706'),
        timerColor: getSetting('timerColor', '#fef3c7'),
        bgImage: getSetting('bgImage', ''),
        bgImageMobile: getSetting('bgImageMobile', ''),
        timerNoShadow: getBoolSetting('timerNoShadow', false),
        activeBookId: getSetting('activeBookId', ''),
        activeSongId: getSetting('activeSongId', ''),
        bgMode: getSetting('bgMode', 'cover'),
        bgBlur: parseFloat(getSetting('bgBlur', '0')) || 0,
        bgDim: parseFloat(getSetting('bgDim', '0.32')) || 0,
        ttsBaseURL: getSetting('ttsBaseURL', tts.DEFAULT_TTS_BASE_URL),
        ttsApiKey: getSetting('ttsApiKey', ''),
        ttsGroupId: getSetting('ttsGroupId', ''),
        ttsModel: getSetting('ttsModel', tts.DEFAULT_TTS_MODEL),
        voiceEnabled: getBoolSetting('voiceEnabled', false),
        voiceId: getSetting('voiceId', tts.DEFAULT_VOICE_ID),
        voiceSpeed: parseFloat(getSetting('voiceSpeed', '1.0')) || 1.0,
        voicePrompt: charVoiceOverride,
        defaultVoicePrompt: allPresets.voicePrompt,
        factoryVoicePrompt: tts.DEFAULT_VOICE_PROMPT,
        maxContextRounds: getMaxContextRounds(),
        contextLimit: getContextLimit(),
        memoryCount: getMemoryCount(activeCharKey)
    });
});

app.post('/api/config', (req, res) => {
    if (req.body.apiKey && hasNonAscii(req.body.apiKey.trim())) {
        return res.status(400).json({ success: false, message: 'API Key 不能包含中文字符，请填写真实 sk-... 密钥' });
    }
    // 已移除旧 contextLimit，避免「⚙️ 设置」表单保存时覆盖统一的 memoMaxContextRounds
    const allowedKeys = [
        'mode', 'soloMode', 'notifyOnFocusDecision', 'notifyOnPauseTimeout', 'notifyOnFocusComplete',
        'apiKey', 'baseURL', 'modelName', 'systemPreset', 'activeCharKey', 'presetProfile',
        'charName', 'persona', 'charAvatar',
        'activeUserId', 'userName', 'useQuickRelation', 'userRelation', 'charCallUser', 'userPersona', 'userAvatar',
        'inkColor', 'noteColor', 'pageBgColor', 'cardBgColor', 'accentColor', 'timerColor',
        'bgImage', 'bgImageMobile', 'bgMode', 'bgBlur', 'bgDim', 'timerNoShadow','activeBookId', 'activeSongId',
        'ttsBaseURL', 'ttsApiKey', 'ttsGroupId', 'ttsModel', 'voiceEnabled', 'voiceId', 'voiceSpeed', 'voicePrompt'
    ];
    const boolKeys = new Set(['useQuickRelation', 'soloMode', 'notifyOnFocusDecision', 'notifyOnPauseTimeout', 'notifyOnFocusComplete', 'voiceEnabled', 'timerNoShadow']);
    for (const key of allowedKeys) {
        if (req.body[key] !== undefined) {
            if (boolKeys.has(key)) {
                saveSetting(key, req.body[key] ? 'true' : 'false');
            } else if (key === 'voicePrompt') {
                saveSetting(key, sanitizeCharVoiceOverride(req.body[key]));
            } else if (['bgImage', 'bgImageMobile', 'charAvatar', 'userAvatar'].includes(key)) {
                saveSetting(key, mediaStore.persistMedia(req.body[key], key));
            } else {
                saveSetting(key, req.body[key]);
            }
        }
    }
    if (req.body.maxContextRounds !== undefined) {
        memoEngine.saveConfig({ maxContextRounds: req.body.maxContextRounds });
    }
    if (typeof req.body.systemPreset === 'string') {
        presets.updateCurrent({ systemPreset: req.body.systemPreset });
    }

    // 切换角色卡时，若该卡绑定了专属预设套装，自动联动切换预设圣殿！
    let appliedProfileName = '';
    if (req.body.applyPresetProfile && typeof req.body.presetProfile === 'string' && req.body.presetProfile.trim()) {
        try {
            const applied = presets.applyProfile(req.body.presetProfile.trim());
            saveSetting('systemPreset', applied.systemPreset);
            appliedProfileName = req.body.presetProfile.trim();
        } catch (err) {
            console.warn(`⚠️ 角色绑定的预设套装「${req.body.presetProfile}」已不存在，已跳过自动切换`);
        }
    }

    if (req.body.charName && !req.body.activeCharKey) {
        const curKey = getSetting('activeCharKey', '');
        if (!curKey.startsWith('card_')) {
            saveSetting('activeCharKey', `custom_${req.body.charName.trim()}`);
        }
    }
    if (req.body.inkColor) {
        booksDb.prepare('UPDATE highlights SET ink_color = ?').run(req.body.inkColor);
    }
    const activeCharKey = getActiveCharKey();
    if (req.body.noteColor && vault.hasMemoryDb(activeCharKey)) {
        vault.getMemoryDb(activeCharKey).prepare('UPDATE notes SET note_color = ?').run(req.body.noteColor);
    }
    res.json({
        success: true,
        message: '配置已保存',
        activeCharKey,
        memoryFile: vault.getMemoryDbFilename(activeCharKey),
        appliedProfileName,
        maxContextRounds: getMaxContextRounds(),
        contextLimit: getContextLimit(),
        memoryCount: getMemoryCount(activeCharKey)
    });
});

// --- 接口：当前角色独立库记忆统计 & 彻底清空 ---
app.get('/api/memory/stats', (req, res) => {
    const activeCharKey = getActiveCharKey();
    const snap = memoEngine.getWindowSnapshot(activeCharKey);
    res.json({
        success: true,
        activeCharKey,
        memoryFile: vault.getMemoryDbFilename(activeCharKey),
        charName: getSetting('charName', '连线搭子'),
        maxContextRounds: snap.config.maxContextRounds,
        contextLimit: snap.config.maxContextMsgs,
        windowInfo: snap.windowInfo,
        memoryCount: getMemoryCount(activeCharKey)
    });
});

app.delete('/api/memory', (req, res) => {
    const activeCharKey = getActiveCharKey();
    const clearChat = req.query.clearChat !== 'false';
    const clearNotes = req.query.clearNotes !== 'false';
    const hideWidgets = req.query.hideWidgets !== 'false';
    const report = wipeCharacterMemory(activeCharKey, { clearChat, clearNotes, hideWidgets });
    res.json({ success: true, ...report });
});

// --- 接口：拉取上游可用模型列表 & 测试连接 ---
app.post('/api/models', async (req, res) => {
    try {
        const apiKey = resolveApiKey(req.body?.apiKey);
        const baseURL = normalizeBaseURL(req.body?.baseURL);

        async function tryFetchModels(endpoint) {
            const resp = await fetch(endpoint, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            const text = await resp.text();
            if (!resp.ok) {
                let detail = text.slice(0, 180);
                try {
                    const parsed = JSON.parse(text);
                    detail = parsed?.error?.message || parsed?.message || detail;
                } catch {}
                return { ok: false, status: resp.status, detail };
            }
            const json = JSON.parse(text);
            const arr = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
            const models = arr.map(item => (typeof item === 'string' ? item : item.id)).filter(Boolean).sort();
            return { ok: true, models };
        }

        let result = await tryFetchModels(`${baseURL}/models`);
        if (!result.ok && result.status === 404 && !baseURL.endsWith('/v1')) {
            result = await tryFetchModels(`${baseURL}/v1/models`);
        }
        if (!result.ok) {
            return res.status(502).json({ success: false, message: `上游返回 ${result.status}：${result.detail}` });
        }
        res.json({ success: true, models: result.models });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/test-connection', async (req, res) => {
    const start = Date.now();
    try {
        const openai = createAIClient(req.body?.apiKey, req.body?.baseURL);
        const model = getModelName(req.body?.modelName);
        const resp = await openai.chat.completions.create({
            model,
            messages: [{ role: 'user', content: '你好，请只回复“连线成功”四个字。' }],
            max_tokens: 40
        });
        const latency = Date.now() - start;
        const reply = cleanAIOutput(resp.choices?.[0]?.message?.content || '') || 'OK';
        res.json({ success: true, latency, model, reply });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- 接口 2：🪪 独立角色卡仓库（data/characters/characters.db）---
app.get('/api/characters', (req, res) => {
    const rows = vault.charactersDb.prepare('SELECT * FROM character_cards ORDER BY id DESC').all();
    const withStats = rows.map(c => {
        const ck = `card_${c.id}`;
        return {
            ...c,
            voice_prompt: sanitizeCharVoiceOverride(c.voice_prompt),
            preset_profile: c.preset_profile || '',
            char_key: ck,
            memory_file: vault.getMemoryDbFilename(ck),
            memory_count: getMemoryCount(ck)
        };
    });
    res.json({ success: true, data: withStats });
});

app.post('/api/characters', (req, res) => {
    const {
        char_name, persona, avatar = '', ink_color = DEFAULT_INK_COLOR, note_color = '#fef08a',
        voice_enabled = 0, voice_id = tts.DEFAULT_VOICE_ID, voice_speed = 1.0, voice_prompt = '',
        preset_profile = ''
    } = req.body;
    if (!char_name || !persona) {
        return res.status(400).json({ success: false, message: '角色名和人设不能为空' });
    }
    const vEnabled = voice_enabled ? 1 : 0;
    const vSpeed = Math.max(0.5, Math.min(2.0, parseFloat(voice_speed) || 1.0));
    const cleanVoicePrompt = sanitizeCharVoiceOverride(voice_prompt);
    const cleanPresetProfile = String(preset_profile || '').trim();
    const savedAvatar = mediaStore.persistMedia(avatar, 'char');
    const info = vault.charactersDb.prepare(
        'INSERT INTO character_cards (char_name, persona, avatar, ink_color, note_color, voice_enabled, voice_id, voice_speed, voice_prompt, preset_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(char_name, persona, savedAvatar, ink_color, note_color, vEnabled, voice_id, vSpeed, cleanVoicePrompt, cleanPresetProfile);
    const charKey = `card_${info.lastInsertRowid}`;
    res.json({
        success: true,
        card: {
            id: info.lastInsertRowid, char_key: charKey, memory_file: vault.getMemoryDbFilename(charKey),
            char_name, persona, avatar: savedAvatar, ink_color, note_color,
            voice_enabled: vEnabled, voice_id, voice_speed: vSpeed, voice_prompt: cleanVoicePrompt,
            preset_profile: cleanPresetProfile, memory_count: 0
        }
    });
});

app.put('/api/characters/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = vault.charactersDb.prepare('SELECT * FROM character_cards WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, message: '未找到该角色卡' });

    const char_name = String(req.body.char_name ?? existing.char_name).trim();
    const persona = String(req.body.persona ?? existing.persona).trim();
    if (!char_name || !persona) return res.status(400).json({ success: false, message: '角色名和人设不能为空' });

    const avatar = req.body.avatar !== undefined ? mediaStore.persistMedia(req.body.avatar, 'char') : existing.avatar;
    const ink_color = req.body.ink_color ?? existing.ink_color;
    const note_color = req.body.note_color ?? existing.note_color;
    const voice_enabled = req.body.voice_enabled !== undefined ? (req.body.voice_enabled ? 1 : 0) : existing.voice_enabled;
    const voice_id = req.body.voice_id !== undefined ? String(req.body.voice_id).trim() : existing.voice_id;
    const voice_speed = req.body.voice_speed !== undefined ? Math.max(0.5, Math.min(2.0, parseFloat(req.body.voice_speed) || 1.0)) : existing.voice_speed;
    const voice_prompt = req.body.voice_prompt !== undefined ? sanitizeCharVoiceOverride(req.body.voice_prompt) : sanitizeCharVoiceOverride(existing.voice_prompt);
    const preset_profile = req.body.preset_profile !== undefined ? String(req.body.preset_profile || '').trim() : (existing.preset_profile || '');

    vault.charactersDb.prepare(`
        UPDATE character_cards
        SET char_name = ?, persona = ?, avatar = ?, ink_color = ?, note_color = ?,
            voice_enabled = ?, voice_id = ?, voice_speed = ?, voice_prompt = ?, preset_profile = ?
        WHERE id = ?
    `).run(char_name, persona, avatar, ink_color, note_color, voice_enabled, voice_id, voice_speed, voice_prompt, preset_profile, id);

    const ck = `card_${id}`;
    res.json({
        success: true,
        card: {
            id, char_key: ck, memory_file: vault.getMemoryDbFilename(ck),
            char_name, persona, avatar, ink_color, note_color,
            voice_enabled, voice_id, voice_speed, voice_prompt, preset_profile,
            memory_count: getMemoryCount(ck)
        }
    });
});

app.delete('/api/characters/:id', (req, res) => {
    const charKey = `card_${req.params.id}`;
    bumpMemoryEpoch(charKey);
    vault.charactersDb.prepare('DELETE FROM character_cards WHERE id = ?').run(req.params.id);
    // 物理删除该角色的独立记忆文件 data/memory/card_<id>.db！
    vault.deleteMemoryDb(charKey);
    res.json({ success: true });
});

// --- 接口 2.5：👤 独立用户人设卡仓库（data/users/users.db）---
app.get('/api/users', (req, res) => {
    const rows = vault.usersDb.prepare('SELECT * FROM user_cards ORDER BY id DESC').all();
    res.json({ success: true, data: rows });
});

app.post('/api/users', (req, res) => {
    const {
        user_name = '', avatar = '', use_quick_relation = 0,
        user_relation = '', char_call_user = '', user_persona = ''
    } = req.body || {};
    const cleanName = String(user_name).trim();
    if (!cleanName) return res.status(400).json({ success: false, message: '用户名字不能为空哦～' });

    const useQuick = use_quick_relation ? 1 : 0;
    const savedAvatar = mediaStore.persistMedia(avatar, 'user');
    const info = vault.usersDb.prepare(`
        INSERT INTO user_cards (user_name, avatar, use_quick_relation, user_relation, char_call_user, user_persona)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(cleanName, savedAvatar, useQuick, String(user_relation).trim(), String(char_call_user).trim(), String(user_persona).trim());

    res.json({
        success: true,
        card: {
            id: info.lastInsertRowid,
            user_name: cleanName,
            avatar: savedAvatar,
            use_quick_relation: useQuick,
            user_relation: String(user_relation).trim(),
            char_call_user: String(char_call_user).trim(),
            user_persona: String(user_persona).trim()
        }
    });
});

app.put('/api/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = vault.usersDb.prepare('SELECT * FROM user_cards WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, message: '未找到该用户人设卡' });

    const cleanName = String(req.body?.user_name ?? existing.user_name).trim();
    if (!cleanName) return res.status(400).json({ success: false, message: '用户名字不能为空哦～' });

    const avatar = req.body?.avatar !== undefined
        ? mediaStore.persistMedia(req.body.avatar, 'user')
        : existing.avatar;
    const useQuick = req.body?.use_quick_relation !== undefined ? (req.body.use_quick_relation ? 1 : 0) : existing.use_quick_relation;
    const user_relation = req.body?.user_relation !== undefined ? String(req.body.user_relation).trim() : existing.user_relation;
    const char_call_user = req.body?.char_call_user !== undefined ? String(req.body.char_call_user).trim() : existing.char_call_user;
    const user_persona = req.body?.user_persona !== undefined ? String(req.body.user_persona).trim() : existing.user_persona;

    vault.usersDb.prepare(`
        UPDATE user_cards
        SET user_name = ?, avatar = ?, use_quick_relation = ?, user_relation = ?, char_call_user = ?, user_persona = ?
        WHERE id = ?
    `).run(cleanName, avatar, useQuick, user_relation, char_call_user, user_persona, id);

    res.json({
        success: true,
        card: { id, user_name: cleanName, avatar, use_quick_relation: useQuick, user_relation, char_call_user, user_persona }
    });
});

app.delete('/api/users/:id', (req, res) => {
    vault.usersDb.prepare('DELETE FROM user_cards WHERE id = ?').run(req.params.id);
    if (getSetting('activeUserId', '') === String(req.params.id)) {
        saveSetting('activeUserId', '');
    }
    res.json({ success: true });
});

// --- 接口：🔊 语音合成试听测试 ---
app.post('/api/tts/test', async (req, res) => {
    try {
        const sampleText = String(req.body?.text || '（轻轻叹气）连线测试成功，快专心看书吧。');
        const result = await tts.synthesizeSpeech({
            text: sampleText,
            baseURL: req.body?.ttsBaseURL || getSetting('ttsBaseURL', tts.DEFAULT_TTS_BASE_URL),
            apiKey: req.body?.ttsApiKey || getSetting('ttsApiKey', ''),
            groupId: req.body?.ttsGroupId ?? getSetting('ttsGroupId', ''),
            model: req.body?.ttsModel || getSetting('ttsModel', tts.DEFAULT_TTS_MODEL),
            voiceId: req.body?.voiceId || getSetting('voiceId', tts.DEFAULT_VOICE_ID),
            speed: req.body?.voiceSpeed || getSetting('voiceSpeed', '1.0')
        });
        res.json({ success: true, audioData: result.audioData, spokenText: result.spokenText });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- 接口：放弃 / 动摇后继续 / 暂停耗尽 / 完整通关 ---
let lastFocusCompleteAt = 0; // 🛡️ 防手机+电脑双端同时到点触发两次通关结算！

app.post('/api/focus/decision', async (req, res) => {
    const {
        decision = 'abandon', elapsedMinutes = 0, remainingMinutes = 25, totalMinutes = 25,
        currentSong = '', deskSummary = '', activeWidgetId = null
    } = req.body;
    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);

    // 15 秒内若已有另一台设备刚结算过一轮 complete，直接安静放行，绝不重复发币/发两条消息！
    if (decision === 'complete') {
        const now = Date.now();
        if (now - lastFocusCompleteAt < 15000) {
            return res.json({ success: true, skipped: true, duplicate: true });
        }
        lastFocusCompleteAt = now;
    }

    let coinReceipt = null;
    if (decision === 'abandon' || decision === 'pause_timeout') {
        db.prepare("INSERT INTO sessions (type, duration) VALUES ('abandon', ?)").run(elapsedMinutes * 60);
    } else if (decision === 'complete') {
        db.prepare("INSERT INTO sessions (type, duration) VALUES ('complete', ?)").run(totalMinutes * 60);
        coinReceipt = homeApi.awardFocusCoins(totalMinutes);
    }

    if (getBoolSetting('soloMode', false)) return res.json({ success: true, skipped: true, homeCoins: coinReceipt });
    if (decision === 'complete' && !getBoolSetting('notifyOnFocusComplete', true)) {
        return res.json({ success: true, skipped: true, homeCoins: coinReceipt });
    }
    if ((decision === 'abandon' || decision === 'continue') && !getBoolSetting('notifyOnFocusDecision', true)) {
        return res.json({ success: true, skipped: true });
    }
    if (decision === 'pause_timeout' && !getBoolSetting('notifyOnPauseTimeout', true)) {
        return res.json({ success: true, skipped: true });
    }

    const mode = getSetting('mode', 'standalone');
    if (mode === 'mcp') {
        db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
            .run('focus_decision', JSON.stringify({ decision, elapsedMinutes, remainingMinutes, totalMinutes }));
        return res.json({ success: true, pending: true });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({
            charKey,
            focusState: decision === 'continue' ? 'running' : 'idle',
            isFocusing: decision === 'continue',
            totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
        });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        let eventPrompt = '';
        let memoryUserLine = '';
        if (decision === 'pause_timeout') {
            eventPrompt = `[${nowTs}] ${userName}（动作·专注超时放弃）：在 45 分钟内累计暂停耗尽了 10 分钟额度，原定 ${totalMinutes} 分钟番茄钟已自动判定放弃（已坚持 ${elapsedMinutes} 分钟）。请通过「通讯」发一条简短消息回应对方。`;
            memoryUserLine = `（动作·专注超时放弃）在45分钟内耗尽10分钟暂停额度，原定${totalMinutes}分钟番茄钟自动判定放弃（已坚持${elapsedMinutes}分钟）`;
        } else if (decision === 'abandon') {
            eventPrompt = `[${nowTs}] ${userName}（动作·确认放弃专注）：提前结束了原定 ${totalMinutes} 分钟的番茄钟（本次坚持了 ${elapsedMinutes} 分钟，还剩 ${remainingMinutes} 分钟）。请通过「通讯」发一条简短消息回应对方。`;
            memoryUserLine = `（动作·确认放弃专注）提前放弃了原定${totalMinutes}分钟的专注（坚持了${elapsedMinutes}分钟，还剩${remainingMinutes}分钟）`;
        } else if (decision === 'complete') {
            eventPrompt = `[${nowTs}] ${userName}（动作·完成一轮专注）：完整坚持完了整整 ${totalMinutes} 分钟的番茄钟，请通过「通讯」发一条简短消息回应对方。`;
            memoryUserLine = `（动作·完成一轮专注）完整完成了${totalMinutes}分钟的专注番茄钟，书页批注已显影`;
        } else {
            eventPrompt = `[${nowTs}] ${userName}（动作·动摇后继续专注）：刚才点开放弃确认框动摇了一下，但最后还是点了【继续专注】留了下来（原定 ${totalMinutes} 分钟，已坚持 ${elapsedMinutes} 分钟，还剩 ${remainingMinutes} 分钟）。请通过「通讯」发一条简短消息回应对方。`;
            memoryUserLine = `（动作·动摇后继续专注）打开放弃确认框后最终选择继续坚持专注（原定${totalMinutes}分钟，已坚持${elapsedMinutes}分钟）`;
        }

        const messages = buildOrderedMessages(`${promptText}\n\n${roomContext}`, history, eventPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });

        const replyText = cleanAIOutput(response.choices[0].message.content, charName);
        const splitEnabled = getBoolSetting('chatSplitEnabled', true);
        const rawPieces = splitEnabled
            ? replyText.split(/\s*\$\s*|\r?\n+/).map(s => s.trim()).filter(Boolean)
            : [replyText];
        const finalPieces = rawPieces.length ? rawPieces : [replyText];

        const chatMsgs = [];
        if (getMemoryEpoch(charKey) === reqEpoch) {
            const insertChat = vault.getMemoryDb(charKey)
                .prepare('INSERT INTO chat_messages (char_key, role, content) VALUES (?, ?, ?)');
            for (const piece of finalPieces) {
                const chatInfo = insertChat.run(charKey, 'assistant', piece);
                chatMsgs.push({
                    id: chatInfo.lastInsertRowid,
                    role: 'assistant',
                    content: piece,
                    charLen: piece.length
                });
            }
            pushMemory('focus_decision', 'user', memoryUserLine, charKey, reqEpoch);
            pushMemory('focus_decision', 'assistant', finalPieces.join('\n'), charKey, reqEpoch);
        }

        res.json({
            success: true,
            decision,
            reply: finalPieces.join('\n'),
            chatMsg: chatMsgs[0] || { id: null, role: 'assistant', content: replyText },
            chatMsgs,
            homeCoins: coinReceipt,
            memoryCount: getMemoryCount(charKey)
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- 接口 3：✉️ 通讯双向气泡聊天（一人一库 data/memory/<charKey>.db）---
app.get('/api/chat', (req, res) => {
    const charKey = getActiveCharKey();
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 150);
    let data = [];
    if (vault.hasMemoryDb(charKey)) {
        const memDb = vault.getMemoryDb(charKey);
        // 正确姿势：先倒序取最新的 limit 条，再按 id 正序排回聊天时间线！
        const rawRows = memDb
            .prepare('SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
            .all(limit);
        data = rawRows.map(row => mediaStore.slimChatRowIfNeeded(memDb, row));
    }
    res.json({ success: true, activeCharKey: charKey, memoryFile: vault.getMemoryDbFilename(charKey), data });
});

app.delete('/api/chat', (req, res) => {
    const charKey = getActiveCharKey();
    if (req.query.syncMemory === 'true') {
        const report = wipeCharacterMemory(charKey, { clearChat: true, clearNotes: true, hideWidgets: true });
        return res.json({ success: true, ...report });
    }
    if (vault.hasMemoryDb(charKey)) {
        vault.getMemoryDb(charKey).prepare('DELETE FROM chat_messages').run();
    }
    res.json({ success: true, activeCharKey: charKey, memoryCount: getMemoryCount(charKey) });
});

app.post('/api/chat', async (req, res) => {
    const {
        content = '', imageData = '', audioData = '', audioFormat = 'webm',
        activeWidgetId = null, focusState = 'idle', isFocusing = false,
        totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 25,
        currentSong = '', deskSummary = ''
    } = req.body;

    const text = String(content).trim();
    if (!text && !imageData && !audioData) {
        return res.status(400).json({ success: false, message: '消息、图片或语音不能全为空' });
    }

    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);
    const memDb = vault.getMemoryDb(charKey);
    const savedUserImageUrl = imageData ? mediaStore.persistMedia(imageData, 'chat_img') : '';
    const savedUserAudioUrl = audioData ? mediaStore.persistMedia(audioData, 'chat_aud') : '';
    const storedUserContent = (savedUserImageUrl || savedUserAudioUrl)
        ? JSON.stringify({ __mm: 1, text, imageData: savedUserImageUrl, audioData: savedUserAudioUrl })
        : text;

    const userInfo = memDb.prepare('INSERT INTO chat_messages (char_key, role, content) VALUES (?, ?, ?)').run(charKey, 'user', storedUserContent);
    const userMsg = { id: userInfo.lastInsertRowid, role: 'user', content: storedUserContent };

    const memorySummaryParts = [];
    if (imageData) memorySummaryParts.push('[发送了一张图片]');
    if (audioData) memorySummaryParts.push('[发送了一段语音]');
    if (text) memorySummaryParts.push(text);
    const memorySummaryLine = `（通讯消息）${memorySummaryParts.join(' ')}`;

    const mode = getSetting('mode', 'standalone');
    if (mode === 'mcp') {
        db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
            .run('chat_message', JSON.stringify({ messageId: userMsg.id, charKey, content: text, hasImage: Boolean(imageData), hasAudio: Boolean(audioData) }));
        pushMemory('chat', 'user', memorySummaryLine, charKey, reqEpoch);
        return res.json({
            success: true, pending: true, userMsg,
            replyMsg: { role: 'assistant', content: '（已发往外部 MCP 框架，等待对方回复…）' }
        });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({
            charKey,
            focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
        });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        let currentUserContent;
        const hasDirectMedia = Boolean(imageData || audioData);
        if (!hasDirectMedia) {
            currentUserContent = `[${nowTs}] ${userName}（通讯消息）：${text}`;
        } else {
            const parts = [];
            const headerHint = text
                ? `[${nowTs}] ${userName}（通讯消息）：${text}`
                : `[${nowTs}] ${userName}（通讯消息）：（给你发来了一条${imageData ? '图片' : ''}${imageData && audioData ? '和' : ''}${audioData ? '语音' : ''}消息，请直接自然回应）`;
            parts.push({ type: 'text', text: headerHint });
            if (imageData) parts.push({ type: 'image_url', image_url: { url: imageData } });
            if (audioData) {
                const base64Only = audioData.includes(',') ? audioData.split(',')[1] : audioData;
                const cleanFmt = String(audioFormat || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
                parts.push({ type: 'input_audio', input_audio: { data: base64Only, format: cleanFmt } });
            }
            parts.push({
                type: 'text',
                text: '（系统隐式指令：请在你的自然回复最后，附带一行 <memo>极简客观概括你刚看到的图片或听到的语音内容，不超过35字</memo>，系统会自动剥离它作为你的记忆，不要向用户提及此标签）'
            });
            currentUserContent = parts;
        }

        const messages = buildOrderedMessages(`${promptText}\n\n${roomContext}`, history, currentUserContent);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });

        const rawReply = response.choices[0].message.content;
        const extractedMemo = hasDirectMedia ? extractMemoTag(rawReply) : '';
        const rawVoiceChunk = getBoolSetting('voiceEnabled', false) ? tts.extractVoiceText(rawReply) : '';
        const replyText = cleanAIOutput(rawReply, charName);

        let replyAudioData = '';
        let ttsWarning = '';
        if (rawVoiceChunk && getSetting('ttsApiKey', '').trim()) {
            try {
                const synth = await tts.synthesizeSpeech({
                    text: rawVoiceChunk,
                    baseURL: getSetting('ttsBaseURL', tts.DEFAULT_TTS_BASE_URL),
                    apiKey: getSetting('ttsApiKey', ''),
                    groupId: getSetting('ttsGroupId', ''),
                    model: getSetting('ttsModel', tts.DEFAULT_TTS_MODEL),
                    voiceId: getSetting('voiceId', tts.DEFAULT_VOICE_ID),
                    speed: getSetting('voiceSpeed', '1.0')
                });
                replyAudioData = synth.audioData || '';
            } catch (ttsErr) {
                console.warn('⚠️ 角色语音合成失败，已自动降级为纯文字:', ttsErr.message);
                ttsWarning = ttsErr.message;
            }
        }

        const savedReplyAudioUrl = replyAudioData ? mediaStore.persistMedia(replyAudioData, 'tts') : '';
        const storedAssistantContent = savedReplyAudioUrl
            ? JSON.stringify({ __mm: 1, text: replyText, audioData: savedReplyAudioUrl, isVoiceMsg: true })
            : replyText;

        const isStaleAfterReset = getMemoryEpoch(charKey) !== reqEpoch;
        let aiMsgId = null;
        if (!isStaleAfterReset) {
            const aiInfo = vault.getMemoryDb(charKey)
                .prepare('INSERT INTO chat_messages (char_key, role, content) VALUES (?, ?, ?)')
                .run(charKey, 'assistant', storedAssistantContent);
            aiMsgId = aiInfo.lastInsertRowid;

            const enrichedUserMemory = extractedMemo
                ? `${memorySummaryLine}（附记忆画面/语音：${extractedMemo}）`
                : memorySummaryLine;
            pushMemory('chat', 'user', enrichedUserMemory, charKey, reqEpoch);
            pushMemory('chat', 'assistant', replyText, charKey, reqEpoch);
        }

        res.json({
            success: true, userMsg,
            staleDiscarded: isStaleAfterReset,
            replyMsg: { id: aiMsgId, role: 'assistant', content: storedAssistantContent },
            ttsWarning,
            memoryCount: getMemoryCount(charKey)
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- 接口 4：切歌审批博弈 ---
app.post('/api/music/request', async (req, res) => {
    const {
        currentSong = '雨声白噪音', targetSong = '下一首曲目',
        focusState, isFocusing, totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 20,
        switchCountToday = 1, deskSummary = '', activeWidgetId = null
    } = req.body;
    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);

    if (getBoolSetting('soloMode', false)) {
        return res.json({ success: true, approved: true, reason: '单人专注模式 · 自由切歌' });
    }

    const mode = getSetting('mode', 'standalone');
    if (mode === 'mcp') {
        const payload = JSON.stringify({ currentSong, targetSong, elapsedMinutes, remainingMinutes, switchCountToday, charKey });
        const info = db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)').run('music_request', payload);
        pushMemory('music', 'user', `（动作·切歌申请）申请从《${currentSong}》切到《${targetSong}》（今日第${switchCountToday}次）`, charKey, reqEpoch);
        return res.json({ success: true, pending: true, eventId: info.lastInsertRowid });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const noteColor = getSetting('noteColor', '#fef08a');
        const roomContext = getRoomContextSummary({
            charKey,
            focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
        });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('musicApproval', { char: charName, user: userName })}`;
        const userPrompt = `[${nowTs}] ${userName}（动作·切歌申请）：当前同步播放《${currentSong}》，申请切到《${targetSong}》（今日第 ${switchCountToday} 次申请）。请只返回纯 JSON 对象。`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });

        const cleanedText = cleanAIOutput(response.choices[0].message.content, charName);
        let decision = { approved: false, reason: "先把手头这段看完再切歌，专心点。" };
        try {
            const match = cleanedText.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                decision = { approved: Boolean(parsed.approved), reason: cleanAIOutput(parsed.reason || decision.reason, charName) };
            }
        } catch {}

        let newNote = null;
        if (getMemoryEpoch(charKey) === reqEpoch) {
            pushMemory('music', 'user', `（动作·切歌申请）申请把留声机从《${currentSong}》切到《${targetSong}》（今日第${switchCountToday}次）`, charKey, reqEpoch);
            pushMemory('music', 'assistant', decision.reason, charKey, reqEpoch);
        }

        res.json({ success: true, approved: decision.approved, reason: decision.reason, note: newNote, memoryCount: getMemoryCount(charKey) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- 接口 5：4模式划线系统（使用 booksDb 独立库）---
app.get('/api/highlights', (req, res) => {
    const { book_id } = req.query;
    const rows = book_id
        ? booksDb.prepare("SELECT * FROM highlights WHERE book_id = ? OR book_id IS NULL ORDER BY id DESC").all(book_id)
        : booksDb.prepare("SELECT * FROM highlights ORDER BY id DESC").all();
    res.json({ success: true, data: maskHighlightsForClient(rows) });
});

app.post('/api/highlights', async (req, res) => {
    try {
        const {
            text_content, book_id = null, book_title = '', user_note = '',
            share_with_ai = false, isFocusing = false
        } = req.body;

        const cleanQuote = String(text_content || '').trim();
        const cleanUserNote = String(user_note || '').trim();
        if (!cleanQuote) return res.status(400).json({ success: false, message: '划线内容不能为空' });

        const inkColor = getSetting('inkColor', DEFAULT_INK_COLOR);
        const mode = getSetting('mode', 'standalone');
        const charKey = getActiveCharKey();
        const isSolo = getBoolSetting('soloMode', false);
        const isShared = (!isSolo && share_with_ai) ? 1 : 0;
        const initialStatus = (isShared && isFocusing) ? 'locked' : 'unlocked';

        const info = booksDb.prepare(
            'INSERT INTO highlights (book_id, char_key, text_content, user_note, is_shared, ai_comment, ink_color, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(book_id, charKey, cleanQuote, cleanUserNote, isShared, '', inkColor, initialStatus);
        const highlightId = info.lastInsertRowid;

        if (!isShared) {
            return res.json({
                success: true, id: highlightId, is_shared: 0, status: 'unlocked',
                message: cleanUserNote ? '已记下你的私人批注' : '已高亮收藏句子'
            });
        }

        if (mode === 'mcp') {
            db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
                .run('highlight_reply', JSON.stringify({ highlightId, book_id, book_title, text_content: cleanQuote, user_note: cleanUserNote, charKey }));
            pushMemory('highlight', 'user', `（书页划线分享）“${cleanQuote}”${cleanUserNote ? `（附批注：${cleanUserNote}）` : ''}`, charKey);
            return res.json({ success: true, id: highlightId, is_shared: 1, status: initialStatus, pending: true });
        }

        if (isFocusing) {
            res.json({ success: true, id: highlightId, is_shared: 1, status: 'locked', message: '已分享并锁入保险箱，专注结束后显影' });
            generateHighlightAIComment({
                highlightId, bookId: book_id, bookTitleFallback: book_title, textContent: cleanQuote, userNote: cleanUserNote, isFocusing: true, charKey
            }).catch(e => {
                booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ?').run(`⚠️ 批注未生成：${e.message}`, highlightId);
            });
            return;
        }

        try {
            const aiComment = await generateHighlightAIComment({
                highlightId, bookId: book_id, bookTitleFallback: book_title, textContent: cleanQuote, userNote: cleanUserNote, isFocusing: false, charKey
            });
            res.json({ success: true, id: highlightId, is_shared: 1, status: 'unlocked', ai_comment: aiComment, message: 'TA 已写下页边批注' });
        } catch (e) {
            booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ?').run(`⚠️ 批注未生成：${e.message}`, highlightId);
            res.status(400).json({ success: false, message: e.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/highlights/:id/share', async (req, res) => {
    try {
        if (getBoolSetting('soloMode', false)) {
            return res.status(400).json({ success: false, message: '单人专注模式下无法分享给角色哦～' });
        }
        const highlightId = req.params.id;
        const row = booksDb.prepare('SELECT * FROM highlights WHERE id = ?').get(highlightId);
        if (!row) return res.status(404).json({ success: false, message: '未找到该条划线' });

        const { user_note, book_title = '', isFocusing = false } = req.body || {};
        const finalUserNote = user_note !== undefined ? String(user_note).trim() : (row.user_note || '');
        const nextStatus = isFocusing ? 'locked' : 'unlocked';
        const charKey = getActiveCharKey();

        booksDb.prepare('UPDATE highlights SET user_note = ?, is_shared = 1, status = ?, char_key = ? WHERE id = ?')
            .run(finalUserNote, nextStatus, charKey, highlightId);

        if (isFocusing) {
            res.json({ success: true, id: highlightId, status: 'locked', message: '已分享给 TA，专注结束后显影' });
            generateHighlightAIComment({
                highlightId, bookId: row.book_id, bookTitleFallback: book_title, textContent: row.text_content, userNote: finalUserNote, isFocusing: true, charKey
            }).catch(e => {
                booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ?').run(`⚠️ 批注未生成：${e.message}`, highlightId);
            });
            return;
        }

        const aiComment = await generateHighlightAIComment({
            highlightId, bookId: row.book_id, bookTitleFallback: book_title, textContent: row.text_content, userNote: finalUserNote, isFocusing: false, charKey
        });
        res.json({ success: true, id: highlightId, status: 'unlocked', ai_comment: aiComment });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.patch('/api/highlights/:id/note', (req, res) => {
    const userNote = String(req.body?.user_note || '').trim();
    booksDb.prepare('UPDATE highlights SET user_note = ? WHERE id = ?').run(userNote, req.params.id);
    res.json({ success: true, user_note: userNote });
});

app.post('/api/highlights/unlock', async (req, res) => {
    const { isFocusing = false, remainingMinutes = 0, force = false, book_id = null, deskSummary = '', activeWidgetId = null } = req.body || {};
    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);

    const lockedRows = booksDb.prepare("SELECT * FROM highlights WHERE status = 'locked' AND is_shared = 1").all();
    const fetchList = () => {
        const rows = book_id
            ? booksDb.prepare("SELECT * FROM highlights WHERE book_id = ? OR book_id IS NULL ORDER BY id DESC").all(book_id)
            : booksDb.prepare("SELECT * FROM highlights ORDER BY id DESC").all();
        return maskHighlightsForClient(rows);
    };

    if (!lockedRows.length) {
        return res.json({ success: true, approved: true, reason: '目前没有锁住的批注哦～', data: fetchList() });
    }

    if (force || !isFocusing || getBoolSetting('soloMode', false)) {
        booksDb.prepare("UPDATE highlights SET status = 'unlocked' WHERE status = 'locked'").run();
        if (vault.hasMemoryDb(charKey)) {
            vault.getMemoryDb(charKey).prepare("UPDATE memory_events SET content = REPLACE(content, '（页边批注·尚未解锁）', '') WHERE event_type = 'highlight'").run();
        }
        return res.json({ success: true, approved: true, reason: '所有页边批注已显影！', data: fetchList() });
    }

    const mode = getSetting('mode', 'standalone');
    if (mode === 'mcp') {
        return res.json({ success: true, approved: false, reason: 'MCP 模式下专注期暂不支持自动放行偷看～', data: fetchList() });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({ charKey, focusState: 'running', isFocusing: true, remainingMinutes, deskSummary, activeWidgetId });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('highlightPeek', { char: charName, user: userName, remainingMinutes, lockedCount: lockedRows.length })}`;
        const userPrompt = `[${nowTs}] ${userName}（行为·请求偷看锁住的批注）：专注倒计时还剩 ${remainingMinutes} 分钟，我想提前偷看你刚才写给我的 ${lockedRows.length} 条页边批注，行不行嘛？请只返回纯 JSON 对象。`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });

        const cleanedText = cleanAIOutput(response.choices[0].message.content, charName);
        let decision = { approved: false, reason: '倒计时还没结束呢，老实看完这轮再解锁。' };
        try {
            const match = cleanedText.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                decision = { approved: Boolean(parsed.approved), reason: cleanAIOutput(parsed.reason || decision.reason, charName) };
            }
        } catch {}

        pushMemory('highlight_peek', 'user', `（动作·请求提前偷看批注）专注还剩${remainingMinutes}分钟时申请提前解锁${lockedRows.length}条批注`, charKey, reqEpoch);
        pushMemory('highlight_peek', 'assistant', decision.reason, charKey, reqEpoch);

        if (decision.approved) {
            booksDb.prepare("UPDATE highlights SET status = 'unlocked' WHERE status = 'locked'").run();
            if (vault.hasMemoryDb(charKey)) {
                vault.getMemoryDb(charKey).prepare("UPDATE memory_events SET content = REPLACE(content, '（页边批注·尚未解锁）', '') WHERE event_type = 'highlight'").run();
            }
        }

        res.json({ success: true, approved: decision.approved, reason: decision.reason, data: fetchList() });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.delete('/api/highlights/:id', (req, res) => {
    const info = booksDb.prepare('DELETE FROM highlights WHERE id = ?').run(req.params.id);
    res.json({ success: true, deleted: info.changes });
});

// --- 接口 6：📌 双向书桌便利贴（随角色一人一库隔离！）---
app.get('/api/notes', (req, res) => {
    const charKey = getActiveCharKey();
    const data = vault.hasMemoryDb(charKey)
        ? vault.getMemoryDb(charKey).prepare('SELECT * FROM notes ORDER BY id DESC').all()
        : [];
    res.json({ success: true, data });
});

app.post('/api/notes/user', async (req, res) => {
    const {
        content = '', askReply = true, focusState = 'idle', isFocusing = false,
        totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 0, currentSong = '', deskSummary = '', activeWidgetId = null
    } = req.body || {};
    const cleanText = String(content).trim();
    if (!cleanText) return res.status(400).json({ success: false, message: '便利贴内容不能为空哦～' });

    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);
    const noteColor = getSetting('noteColor', '#fef08a');
    const memDb = vault.getMemoryDb(charKey);
    const userInfo = memDb.prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'user', cleanText, noteColor);
    const userNoteObj = { id: userInfo.lastInsertRowid, author: 'user', content: cleanText, note_color: noteColor };

    if (!askReply || getBoolSetting('soloMode', false) || getSetting('mode', 'standalone') === 'mcp') {
        if (askReply && !getBoolSetting('soloMode', false)) {
            pushMemory('note_user', 'user', `（在书桌贴了便利贴）${cleanText}`, charKey, reqEpoch);
        }
        return res.json({ success: true, userNote: userNoteObj, aiNote: null });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({
            charKey,
            focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
        });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('noteReply', { char: charName, user: userName })}`;
        const userPrompt = `[${nowTs}] ${userName}（在书桌贴了便利贴）：“${cleanText}”`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });
        const aiText = cleanAIOutput(response.choices[0].message.content, charName);

        let aiNoteObj = null;
        if (getMemoryEpoch(charKey) === reqEpoch) {
            const aiInfo = vault.getMemoryDb(charKey).prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'ai', aiText, noteColor);
            aiNoteObj = { id: aiInfo.lastInsertRowid, author: 'ai', content: aiText, note_color: noteColor };
            pushMemory('note_exchange', 'user', `（在书桌贴了便利贴）${cleanText}`, charKey, reqEpoch);
            pushMemory('note_exchange', 'assistant', aiText, charKey, reqEpoch);
        }

        res.json({ success: true, userNote: userNoteObj, aiNote: aiNoteObj, memoryCount: getMemoryCount(charKey) });
    } catch (error) {
        res.json({ success: true, userNote: userNoteObj, aiNote: null, warning: error.message });
    }
});

app.post('/api/notes/:id/share', async (req, res) => {
    if (getBoolSetting('soloMode', false)) return res.status(400).json({ success: false, message: '单人专注模式下无法递给 TA 哦～' });
    const charKey = getActiveCharKey();
    if (!vault.hasMemoryDb(charKey)) return res.status(404).json({ success: false, message: '未找到该便签' });
    const row = vault.getMemoryDb(charKey).prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: '未找到该便签' });

    const { focusState = 'idle', isFocusing = false, totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 0, currentSong = '', deskSummary = '', activeWidgetId = null } = req.body || {};
    const reqEpoch = getMemoryEpoch(charKey);
    const noteColor = getSetting('noteColor', '#fef08a');

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({ charKey, focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('noteReply', { char: charName, user: userName })}`;
        const userPrompt = `[${nowTs}] ${userName}（把桌上的便利贴递给你看）：“${row.content}”`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });
        const aiText = cleanAIOutput(response.choices[0].message.content, charName);

        let aiNote = null;
        if (getMemoryEpoch(charKey) === reqEpoch) {
            const aiInfo = vault.getMemoryDb(charKey).prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'ai', aiText, noteColor);
            aiNote = { id: aiInfo.lastInsertRowid, author: 'ai', content: aiText, note_color: noteColor };
            pushMemory('note_exchange', 'user', `（递来书桌便利贴）${row.content}`, charKey, reqEpoch);
            pushMemory('note_exchange', 'assistant', aiText, charKey, reqEpoch);
        }

        res.json({ success: true, aiNote });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/notes/summon', async (req, res) => {
    if (getBoolSetting('soloMode', false)) return res.status(400).json({ success: false, message: '当前处于单人专注模式哦～' });
    const {
        focusState = 'idle', isFocusing = false, totalMinutes = 25, elapsedMinutes = 0,
        remainingMinutes = 0, currentSong = '', deskSummary = '', activeWidgetId = null
    } = req.body || {};
    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);
    if (getSetting('mode', 'standalone') === 'mcp') return res.status(400).json({ success: false, message: 'MCP 模式下暂不支持主动召唤便利贴' });

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const roomContext = getRoomContextSummary({
            charKey,
            focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
        });
        const noteColor = getSetting('noteColor', '#fef08a');
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('noteSummon', { char: charName, user: userName })}`;
        const userPrompt = `[${nowTs}] （系统触发：${userName} 偷偷戳了戳你，顺便瞄了一眼书桌便签墙，想看看你现在心情如何、会写什么新纸条）`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });
        const aiText = cleanAIOutput(response.choices[0].message.content, charName);

        let noteObj = null;
        if (getMemoryEpoch(charKey) === reqEpoch) {
            const info = vault.getMemoryDb(charKey).prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'ai', aiText, noteColor);
            noteObj = { id: info.lastInsertRowid, author: 'ai', content: aiText, note_color: noteColor };
            pushMemory('note_summon', 'user', `（偷偷戳了戳你，想看看你现在心情如何并讨一张新便利贴）`, charKey, reqEpoch);
            pushMemory('note_summon', 'assistant', aiText, charKey, reqEpoch);
        }

        res.json({ success: true, note: noteObj, memoryCount: getMemoryCount(charKey) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/notes/slack', async (req, res) => {
    const { awayDuration = 90, deskSummary = '', activeWidgetId = null } = req.body;
    const charKey = getActiveCharKey();
    const reqEpoch = getMemoryEpoch(charKey);
    db.prepare("INSERT INTO sessions (type, duration) VALUES ('slack', ?)").run(awayDuration);

    if (getBoolSetting('soloMode', false)) return res.json({ success: true, skipped: true });

    const mode = getSetting('mode', 'standalone');
    if (mode === 'mcp') {
        const info = db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
            .run('slack_alert', JSON.stringify({ awayDuration, charKey }));
        pushMemory('slack', 'user', `（切屏摸鱼）专注期间切出网页摸鱼了 ${awayDuration} 秒`, charKey, reqEpoch);
        return res.json({ success: true, pending: true, eventId: info.lastInsertRowid });
    }

    try {
        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const noteColor = getSetting('noteColor', '#fef08a');
        const roomContext = getRoomContextSummary({ charKey, focusState: 'running', isFocusing: true, deskSummary, activeWidgetId });
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const systemPrompt = `${promptText}\n\n${roomContext}\n\n${presets.getPrompt('noteSlack', { char: charName, user: userName })}`;
        const userPrompt = `[${nowTs}] ${userName}（切屏摸鱼）：刚刚在专注时切出线上自习室网页离开了 ${awayDuration} 秒才回来。`;

        const messages = buildOrderedMessages(systemPrompt, history, userPrompt);
        const response = await openai.chat.completions.create({ model: getModelName(), messages });
        const noteContent = cleanAIOutput(response.choices[0].message.content, charName);

        let noteObj = null;
        if (getMemoryEpoch(charKey) === reqEpoch) {
            const info = vault.getMemoryDb(charKey).prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'ai', noteContent, noteColor);
            noteObj = { id: info.lastInsertRowid, author: 'ai', content: noteContent, note_color: noteColor };
            pushMemory('slack', 'user', `（切屏摸鱼）专注期间切出网页摸鱼了 ${awayDuration} 秒才回来`, charKey, reqEpoch);
            pushMemory('slack', 'assistant', noteContent, charKey, reqEpoch);
        }

        res.json({ success: true, note: noteObj, memoryCount: getMemoryCount(charKey) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.delete('/api/notes/:id', (req, res) => {
    const charKey = getActiveCharKey();
    if (vault.hasMemoryDb(charKey)) {
        vault.getMemoryDb(charKey).prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true });
});

// --- 接口 7：📚 独立书架库（data/library/books.db）---
app.get('/api/books', (req, res) => {
    const rows = booksDb.prepare(`
        SELECT b.id, b.title, LENGTH(b.content) as char_count, b.saved_to_shelf, b.created_at,
               (SELECT COUNT(*) FROM highlights h WHERE h.book_id = b.id) as highlight_count
        FROM books b
        WHERE b.saved_to_shelf = 1
        ORDER BY b.id DESC
    `).all();
    res.json({ success: true, data: rows });
});

app.get('/api/books/latest', (req, res) => {
    const book = booksDb.prepare('SELECT * FROM books ORDER BY id DESC LIMIT 1').get();
    res.json({ success: true, book: book || null });
});

app.get('/api/books/:id', (req, res) => {
    const book = booksDb.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ success: false, message: '未找到该书籍' });
    res.json({ success: true, book });
});

app.post('/api/books', (req, res) => {
    const { title = '未命名读物', content = '', save_to_shelf = true } = req.body;
    const saved = save_to_shelf ? 1 : 0;
    const info = booksDb.prepare('INSERT INTO books (title, content, saved_to_shelf) VALUES (?, ?, ?)').run(title, content, saved);
    res.json({ success: true, book: { id: info.lastInsertRowid, title, content, saved_to_shelf: saved } });
});

app.patch('/api/books/:id/shelf', (req, res) => {
    const saved = req.body?.saved_to_shelf ? 1 : 0;
    booksDb.prepare('UPDATE books SET saved_to_shelf = ? WHERE id = ?').run(saved, req.params.id);
    res.json({ success: true, saved_to_shelf: saved });
});

app.delete('/api/books/:id', (req, res) => {
    booksDb.prepare('DELETE FROM highlights WHERE book_id = ?').run(req.params.id);
    const info = booksDb.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
    res.json({ success: true, deleted: info.changes });
});

// --- 接口 8：💿 独立歌单库（data/music/playlist.db）---
app.get('/api/playlist', (req, res) => {
    res.json({ success: true, data: musicDb.prepare('SELECT * FROM playlist ORDER BY id ASC').all() });
});

app.post('/api/playlist', (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    const rawTitle = String(req.body?.title || '').trim();
    if (!rawUrl) return res.status(400).json({ success: false, message: '请粘贴网易云链接、歌曲 ID 或音频直链哦～' });

    let finalTitle = rawTitle;
    if (!finalTitle) {
        const titleMatch = rawUrl.match(/《([^》]+)》/);
        finalTitle = titleMatch ? titleMatch[1].trim() : '未命名曲目';
    }

    let finalUrl = rawUrl;
    const urlMatch = rawUrl.match(/https?:\/\/[^\s)）]+/i);
    const candidate = urlMatch ? urlMatch[0] : rawUrl;
    const neteaseMatch = candidate.match(/(?:music\.163\.com\/[^\s]*?[?&]id=|song\/)(\d+)/i) || candidate.match(/^(\d{4,15})$/);
    if (neteaseMatch) {
        finalUrl = `https://music.163.com/song/media/outer/url?id=${neteaseMatch[1]}.mp3`;
    } else if (urlMatch) {
        finalUrl = urlMatch[0];
    }

    const info = musicDb.prepare('INSERT INTO playlist (title, url, is_builtin) VALUES (?, ?, 0)').run(finalTitle, finalUrl);
    res.json({ success: true, song: { id: info.lastInsertRowid, title: finalTitle, url: finalUrl, is_builtin: 0 } });
});

app.delete('/api/playlist/:id', (req, res) => {
    const info = musicDb.prepare('DELETE FROM playlist WHERE id = ?').run(req.params.id);
    res.json({ success: true, deleted: info.changes });
});

// --- 接口 9：🖼️ 桌面图片小组件（单次视觉直通 + <memo> 记忆回填）---
app.get('/api/widgets', (req, res) => {
    const rows = db.prepare('SELECT * FROM widgets ORDER BY id DESC').all();
    res.json({ success: true, data: rows });
});
app.post('/api/widgets', (req, res) => {
    const { image_data, caption = '', visible_to_ai = 0 } = req.body;
    if (!image_data) return res.status(400).json({ success: false, message: '图片不能为空' });
    const savedUrl = mediaStore.persistMedia(image_data, 'widget');
    const vis = visible_to_ai ? 1 : 0;
    const info = db.prepare('INSERT INTO widgets (image_data, caption, visible_to_ai, ai_memo) VALUES (?, ?, ?, ?)').run(savedUrl, caption, vis, '');
    res.json({ success: true, widget: { id: info.lastInsertRowid, image_data: savedUrl, caption, visible_to_ai: vis, ai_memo: '' } });
});

app.patch('/api/widgets/:id/visibility', (req, res) => {
    const vis = req.body?.visible_to_ai ? 1 : 0;
    db.prepare('UPDATE widgets SET visible_to_ai = ? WHERE id = ?').run(vis, req.params.id);
    res.json({ success: true, visible_to_ai: vis });
});

app.post('/api/widgets/:id/observe', async (req, res) => {
    try {
        const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
        if (!widget) return res.status(404).json({ success: false, message: '未找到该相框图片' });

        db.prepare('UPDATE widgets SET visible_to_ai = 1 WHERE id = ?').run(widget.id);
        if (getBoolSetting('soloMode', false) || getSetting('mode', 'standalone') === 'mcp') {
            return res.json({ success: true, skipped: true, ai_memo: widget.ai_memo || '' });
        }

        const forceRefresh = Boolean(req.body?.force);
        if (widget.ai_memo && !forceRefresh) {
            return res.json({ success: true, cached: true, ai_memo: widget.ai_memo, reaction: '' });
        }

        const openai = createAIClient();
        const charKey = getActiveCharKey();
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const reqEpoch = getMemoryEpoch(charKey);
        const nowTs = formatLocalTimestamp();
        const capText = (widget.caption || '').trim();

        const systemPrompt = `${promptText}\n\n${presets.getPrompt('widgetObserve', { char: charName, user: userName })}`;

        const userParts = [
            {
                type: 'text',
                text: `[${nowTs}] ${userName}（把一张新图放进了桌面相框并勾选让你看）${capText ? `，照片角标备注写着：“${capText}”` : '（没有写角标备注）'}。`
            },
            {
                type: 'image_url',
                image_url: { url: mediaStore.toDataUrlForAI(widget.image_data) }
            }
        ];

        let rawReply = '';
        try {
            const resp = await openai.chat.completions.create({
                model: getModelName(),
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userParts }
                ]
            });
            rawReply = resp.choices?.[0]?.message?.content || '';
        } catch (visionErr) {
            const fallbackMemo = capText ? `（纯文本模型无法看图）对方摆了备注为「${capText}」的照片` : '对方摆了一张相框照片';
            db.prepare('UPDATE widgets SET ai_memo = ? WHERE id = ?').run(fallbackMemo, widget.id);
            return res.json({ success: true, fallback: true, ai_memo: fallbackMemo, reaction: '', warning: '当前模型暂不支持识图，已仅同步文字备注' });
        }

        const extractedMemo = extractMemoTag(rawReply) || (capText ? `备注为「${capText}」的桌面照片` : '对方分享的桌面照片');
        const cleanReaction = cleanAIOutput(rawReply, charName);

        db.prepare('UPDATE widgets SET ai_memo = ?, visible_to_ai = 1 WHERE id = ?').run(extractedMemo, widget.id);

        if (cleanReaction) {
            pushMemory('widget_show', 'user', `（把桌面相框图公开给你看：${extractedMemo}${capText ? `，备注「${capText}」` : ''}）`, charKey, reqEpoch);
            pushMemory('widget_show', 'assistant', cleanReaction, charKey, reqEpoch);
        }

        console.log(`👁️ 桌面相框单次识图完成 (#${widget.id}) | <memo>: ${extractedMemo}`);
        res.json({ success: true, cached: false, ai_memo: extractedMemo, reaction: cleanReaction });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.delete('/api/widgets/:id', (req, res) => {
    db.prepare('DELETE FROM widgets WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});
// --- 🐾 像素桌宠双端云同步（共用 settings 表，手机/电脑自动同步） ---
app.get('/api/pet/state', (req, res) => {
    try {
        const raw = getSetting('petStateJson', '');
        res.json({ success: true, data: raw ? JSON.parse(raw) : null });
    } catch {
        res.json({ success: true, data: null });
    }
});

app.post('/api/pet/state', (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        saveSetting('petStateJson', JSON.stringify(body));
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

// --- 🌦️ 桌面叠放卡片（天气城市 / 梦境天气 / 水吧 / SAN值 / DDL）双端云同步 ---
app.get('/api/desk/state', (req, res) => {
    try {
        const raw = getSetting('deskStackJson', '');
        res.json({ success: true, data: raw ? JSON.parse(raw) : null });
    } catch {
        res.json({ success: true, data: null });
    }
});

app.post('/api/desk/state', (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        saveSetting('deskStackJson', JSON.stringify(body));
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

app.get('/api/desk/stats', (req, res) => {
    try { const raw = getSetting('deskStatsJson', ''); res.json({ success: true, data: raw ? JSON.parse(raw) : null }); }
    catch { res.json({ success: true, data: null }); }
});

app.post('/api/desk/stats', (req, res) => {
    try { saveSetting('deskStatsJson', JSON.stringify(req.body || {})); res.json({ success: true }); }
    catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

// --- ⏱️ 番茄钟状态双端云同步（手机/电脑实时同步开始、暂停、重置） ---
app.get('/api/timer/state', (req, res) => {
    try {
        const raw = getSetting('timerStateJson', '');
        res.json({ success: true, data: raw ? JSON.parse(raw) : null });
    } catch {
        res.json({ success: true, data: null });
    }
});

app.post('/api/timer/state', (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        saveSetting('timerStateJson', JSON.stringify(body));
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

// --- 接口 10：MCP 外部框架桥接 ---
app.get('/api/mcp/context', (req, res) => {
    const charKey = getActiveCharKey();
    const hasMem = vault.hasMemoryDb(charKey);
    const memDb = hasMem ? vault.getMemoryDb(charKey) : null;
    res.json({
        success: true,
        activeCharKey: charKey,
        memoryFile: vault.getMemoryDbFilename(charKey),
        contextText: getRoomContextSummary({ charKey }),
        pendingEvents: db.prepare("SELECT * FROM pending_events WHERE status = 'waiting' ORDER BY id ASC").all(),
        recentNotes: memDb ? memDb.prepare("SELECT * FROM notes ORDER BY id DESC LIMIT 5").all() : [],
        recentChat: memDb ? memDb.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 10").all().reverse() : [],
        recentMemory: getUnifiedMemoryMessages(charKey, { mutateWindow: false })
    });
});

app.post('/api/mcp/resolve-music', (req, res) => {
    const { eventId, approved, reason, targetSong = '未知曲目' } = req.body;
    const charKey = getActiveCharKey();
    const noteColor = getSetting('noteColor', '#fef08a');
    const cleanReason = cleanAIOutput(reason || '');
    const resultObj = { approved: Boolean(approved), reason: cleanReason };
    if (eventId) {
        db.prepare("UPDATE pending_events SET status = 'resolved', result = ? WHERE id = ?").run(JSON.stringify(resultObj), eventId);
    }
    pushMemory('music', 'assistant', resultObj.reason, charKey);
    res.json({ success: true, ...resultObj });
});

app.post('/api/mcp/reply-highlight', (req, res) => {
    const { highlightId, comment } = req.body;
    const charKey = getActiveCharKey();
    const cleanComment = cleanAIOutput(comment || '');
    booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ?').run(cleanComment, highlightId);
    pushMemory('highlight', 'assistant', `（页边批注·尚未解锁）${cleanComment}`, charKey);
    res.json({ success: true });
});

app.post('/api/mcp/post-note', (req, res) => {
    const { content } = req.body;
    const charKey = getActiveCharKey();
    const noteColor = getSetting('noteColor', '#fef08a');
    const cleanContent = cleanAIOutput(content || '');
    const info = vault.getMemoryDb(charKey).prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)').run(charKey, 'ai', cleanContent, noteColor);
    pushMemory('slack', 'assistant', cleanContent, charKey);
    res.json({ success: true, id: info.lastInsertRowid });
});

app.post('/api/mcp/reply-chat', (req, res) => {
    const { content } = req.body;
    const charKey = getActiveCharKey();
    const cleanContent = cleanAIOutput(content || '');
    const info = vault.getMemoryDb(charKey).prepare('INSERT INTO chat_messages (char_key, role, content) VALUES (?, ?, ?)').run(charKey, 'assistant', cleanContent);
    pushMemory('chat', 'assistant', cleanContent, charKey);
    res.json({ success: true, id: info.lastInsertRowid });
});

// --- 接口 11：📚 预设圣殿（data/presets/ 热读取、单条/全量一键恢复默认、套装存档）---
app.get('/api/presets', (req, res) => {
    res.json({
        success: true,
        meta: presets.PRESET_META,
        defaults: presets.FACTORY_DEFAULTS,
        current: presets.getAllCurrent(),
        profiles: presets.listProfiles()
    });
});

app.post('/api/presets/current', (req, res) => {
    const updated = presets.updateCurrent(req.body || {});
    if (req.body?.systemPreset !== undefined) saveSetting('systemPreset', req.body.systemPreset);
    res.json({ success: true, current: updated });
});

app.post('/api/presets/reset', (req, res) => {
    const key = req.body?.key || 'ALL';
    const current = presets.resetPrompt(key);
    if (key === 'ALL' || key === 'systemPreset') saveSetting('systemPreset', current.systemPreset);
    res.json({ success: true, key, current });
});

app.post('/api/presets/profiles', (req, res) => {
    try {
        const savedName = presets.saveProfile(req.body?.name, req.body?.data || null);
        res.json({ success: true, name: savedName, profiles: presets.listProfiles() });
    } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

app.post('/api/presets/profiles/apply', (req, res) => {
    try {
        const current = presets.applyProfile(req.body?.name);
        saveSetting('systemPreset', current.systemPreset);
        res.json({ success: true, current });
    } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

app.delete('/api/presets/profiles/:name', (req, res) => {
    presets.deleteProfile(req.params.name);
    res.json({ success: true, profiles: presets.listProfiles() });
});

require('./chat-pro-routes')(app, {
    db, tts, presets, vault, memoEngine, mediaStore,
    getSetting, saveSetting, getBoolSetting, getActiveCharKey,
    createAIClient, getModelName, getPersonasBlock, getRoomContextSummary,
    getUnifiedMemoryMessages, buildOrderedMessages, cleanAIOutput,
    extractMemoTag, formatLocalTimestamp, getMemoryEpoch, getMemoryCount
});

require('./music-pro-routes')(app, {
    db, musicDb, tts, presets, vault, memoEngine, mediaStore,
    getSetting, getBoolSetting, getActiveCharKey,
    createAIClient, getModelName, getPersonasBlock, getRoomContextSummary,
    getUnifiedMemoryMessages, buildOrderedMessages, cleanAIOutput,
    extractMemoTag, formatLocalTimestamp, getMemoryEpoch, getMemoryCount
});
apiEngine.registerRoutes(app);
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 线上陪伴读书室完全体后端已就位: http://localhost:${PORT} (已开放局域网/云端访问)`);
});