// chat-pro-routes.js —— 小手机通讯引擎 + Tavily 联网 + 角色跨次元联动(<pet>/<play>)双端广播 + 统一记忆清单 + 视觉配置持久化
const crypto = require('crypto');
const tavily = require('./tavily-search');
const registerMcpBridge = require('./mcp-bridge');
let sharedMusicDb = null;
try { sharedMusicDb = require('./db').musicDb; } catch {}

const migratedDbs = new WeakSet();

const BUILTIN_SONG_TITLES = [
    '雨夜书房白噪音 (Rainy Study)',
    '壁炉柴火噼啪声 (Cozy Fireplace)',
    '深夜咖啡馆低语 (Night Cafe)'
];

const DEFAULT_CHAT_THEME = {
    userBubbleBg: '#0a84ff',
    aiBubbleBg: '#2c2c2e',
    chatBgColor: '#18181a',
    chatBgImage: '',
    chatBgMode: 'cover',
    chatBgBlur: 0,
    chatBgDim: 0.35,
    chatBgScale: 1,
    chatBgX: 0,
    chatBgY: 0
};

function ensureTurnSchema(memDb) {
    if (!memDb || migratedDbs.has(memDb)) return;
    for (const sql of [
        "ALTER TABLE chat_messages ADD COLUMN turn_id TEXT DEFAULT ''",
        "ALTER TABLE memory_events ADD COLUMN turn_id TEXT DEFAULT ''"
    ]) {
        try { memDb.exec(sql); } catch {}
    }
    migratedDbs.add(memDb);
}

function makeTurnId() {
    return `t_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function parseStoredPayload(raw) {
    const s = String(raw || '');
    if (s.startsWith('{') && s.includes('"__mm"')) {
        try {
            const obj = JSON.parse(s);
            if (obj && obj.__mm) return obj;
        } catch {}
    }
    return { text: s, imageData: '', audioData: '' };
}

// 提取角色发出的跨次元隐式指令：<pet:happy|feed|ball|rage> 和 <play:歌名>
function extractRoomActions(rawText) {
    const s = String(rawText || '');
    const actions = [];
    const petMatch = s.match(/<pet\s*:\s*([a-z_]+)\s*>/i);
    if (petMatch && petMatch[1]) {
        const act = petMatch[1].toLowerCase().trim();
        if (['happy', 'jump', 'pat', 'pet', 'love', 'cheer'].includes(act)) {
            actions.push({ type: 'pet', action: 'happy' });
        } else if (['feed', 'snack', 'eat'].includes(act)) {
            actions.push({ type: 'pet', action: 'feed' });
        } else if (['ball', 'play', 'toy'].includes(act)) {
            actions.push({ type: 'pet', action: 'ball' });
        } else if (['rage', 'poke', 'angry', 'mad', 'slap'].includes(act)) {
            actions.push({ type: 'pet', action: 'rage' });
        }
    }
    const playMatch = s.match(/<play\s*:\s*([^<>]+?)\s*>/i);
    if (playMatch && playMatch[1]) {
        const q = playMatch[1].replace(/[《》"'「」]/g, '').trim();
        if (q) actions.push({ type: 'play', query: q });
    }
    return actions;
}

function buildActionNoticeText(act, charName, playlistTitles = []) {
    if (act.type === 'pet') {
        if (act.action === 'feed') return `🍖 ${charName} 悄悄给你的桌宠空投了一份小零食！`;
        if (act.action === 'ball') return `🎾 ${charName} 隔空陪你的桌宠丢起了弹力球！`;
        if (act.action === 'rage') return `💢 ${charName} 隔空戳了戳桌宠，小家伙炸毛抗议了！`;
        return `🐾 ${charName} 隔空摸了摸桌宠，小家伙原地蹦跶起来了！`;
    }
    if (act.type === 'play') {
        const q = String(act.query || '').toLowerCase().trim();
        let matched = playlistTitles.find(t => t.toLowerCase() === q)
            || playlistTitles.find(t => t.toLowerCase().includes(q))
            || playlistTitles.find(t => q.includes(t.toLowerCase().slice(0, 4)))
            || act.query;
        return `💿 ${charName} 主动把留声机切到了《${matched}》`;
    }
    return '';
}

function stripMetaKeepVoice(rawText) {
    let text = String(rawText || '');
    const rules = [
        { find: /<(thinking|think)>[\s\S]*?<\/\1>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?<\/(thinking|think)>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?(?=[finire])/gi, replace: '' },
        { find: /<\/?(thinking|think)>\s*/gi, replace: '' },
        { find: /<memo>[\s\S]*?<\/memo>/gi, replace: '' },
        { find: /<memo>[\s\S]*$/gi, replace: '' },
        { find: /<\/?memo>\s*/gi, replace: '' },
        { find: /<pet\s*:\s*[^<>]*>/gi, replace: '' },
        { find: /<play\s*:\s*[^<>]*>/gi, replace: '' },
        { find: /\[(incipere\vert{}finire)\]\s*/gi, replace: '' }
    ];
    for (const r of rules) text = text.replace(r.find, r.replace);
    return text.trim();
}

function parseReplyIntoSegments(rawText, { charName, splitByDollar = true, voiceEnabled = false, cleanAIOutput }) {
    const stripped = stripMetaKeepVoice(rawText);
    const segments = [];

    const pushTextSegments = (chunk) => {
        if (!chunk || !chunk.trim()) return;
        let parts = [chunk];
        if (splitByDollar) {
            const byDollar = chunk.split(/(?<!\\)\$(?!\d+(?:\.\d+)?\s*(?:美元|美金|USD|刀))/g);
            if (byDollar.length > 1) {
                parts = byDollar;
            } else if (!chunk.includes('```') && /\r?\n\s*\r?\n/.test(chunk)) {
                const byBlankLine = chunk.split(/\r?\n\s*\r?\n+/).map(s => s.trim()).filter(Boolean);
                if (byBlankLine.length > 1 && byBlankLine.length <= 6 && byBlankLine.every(s => s.length <= 160)) {
                    parts = byBlankLine;
                }
            }
        }
        for (const p of parts) {
            const cleaned = cleanAIOutput(p.replace(/\\\$/g, '$'), charName);
            if (cleaned) segments.push({ kind: 'text', text: cleaned });
        }
    };

    if (!voiceEnabled) {
        pushTextSegments(stripped.replace(/<\/?voice>/gi, ''));
    } else {
        const voiceRe = /<voice>([\s\S]*?)<\/voice>/gi;
        let lastIdx = 0;
        let m;
        while ((m = voiceRe.exec(stripped)) !== null) {
            if (m.index > lastIdx) pushTextSegments(stripped.slice(lastIdx, m.index));
            const voiceText = cleanAIOutput(m[1] || '', charName);
            if (voiceText) segments.push({ kind: 'voice', text: voiceText });
            lastIdx = voiceRe.lastIndex;
        }
        if (lastIdx < stripped.length) pushTextSegments(stripped.slice(lastIdx));
    }

    if (segments.length === 0) {
        const fallback = cleanAIOutput(stripped, charName);
        if (fallback) segments.push({ kind: 'text', text: fallback });
    }
    return segments;
}

function collectLastRoundsIds(rowsAsc, roundsCount) {
    const idsToDelete = [];
    const matchedTurnIds = new Set();
    let idx = rowsAsc.length - 1;
    let remaining = Math.max(1, roundsCount);

    while (idx >= 0 && remaining > 0) {
        const cur = rowsAsc[idx];
        const tid = String(cur.turn_id || '').trim();
        if (tid) {
            matchedTurnIds.add(tid);
            while (idx >= 0 && String(rowsAsc[idx].turn_id || '').trim() === tid) {
                idsToDelete.push(rowsAsc[idx].id);
                idx--;
            }
            remaining--;
            continue;
        }

        let popped = false;
        while (idx >= 0 && !rowsAsc[idx].turn_id && rowsAsc[idx].role === 'assistant') {
            idsToDelete.push(rowsAsc[idx].id);
            idx--;
            popped = true;
        }
        while (idx >= 0 && !rowsAsc[idx].turn_id && rowsAsc[idx].role === 'user') {
            idsToDelete.push(rowsAsc[idx].id);
            idx--;
            popped = true;
        }
        if (popped) remaining--;
        else idx--;
    }

    return { idsToDelete, matchedTurnIds };
}

function getAvailablePlaylistTitles() {
    const titles = [...BUILTIN_SONG_TITLES];
    if (sharedMusicDb) {
        try {
            const rows = sharedMusicDb.prepare('SELECT title FROM playlist ORDER BY id ASC').all();
            for (const r of rows) {
                if (r.title && !titles.includes(r.title)) titles.push(r.title);
            }
        } catch {}
    }
    return titles;
}

module.exports = function registerChatProRoutes(app, ctx) {
    tavily.registerRoutes(app, ctx);
    registerMcpBridge(app, ctx);

    const {
        db, tts, presets, vault, memoEngine, mediaStore,
        getSetting, saveSetting, getBoolSetting, getActiveCharKey,
        createAIClient, getModelName, getPersonasBlock, getRoomContextSummary,
        getUnifiedMemoryMessages, buildOrderedMessages, cleanAIOutput,
        extractMemoTag, formatLocalTimestamp, getMemoryEpoch, getMemoryCount
    } = ctx;

    const persistMedia = (val, prefix) => (mediaStore ? mediaStore.persistMedia(val, prefix) : val);
    const toDataUrlForAI = (val) => (mediaStore ? mediaStore.toDataUrlForAI(val) : val);

    // 📡 跨端角色联动广播总线（<pet> 逗桌宠 & <play> 切歌，确保手机/电脑双端同步触发！）
    let roomActionSeq = 0;
    const recentRoomActions = [];

    function publishRoomActions(charKey, charName, actions) {
        if (!Array.isArray(actions) || !actions.length) return 0;
        const id = ++roomActionSeq;
        recentRoomActions.push({ id, charKey, charName, actions, ts: Date.now() });
        if (recentRoomActions.length > 24) recentRoomActions.shift();
        return id;
    }

    app.get('/api/room/actions', (req, res) => {
        const since = parseInt(req.query?.since, 10);
        const charKey = getActiveCharKey();
        if (req.query?.init === '1' || isNaN(since)) {
            return res.json({ success: true, latestId: roomActionSeq, events: [] });
        }
        const now = Date.now();
        const events = recentRoomActions.filter(
            ev => ev.id > since && ev.charKey === charKey && (now - ev.ts < 300000)
        );
        res.json({ success: true, latestId: roomActionSeq, events });
    });

    function getChatTheme() {
        const raw = getSetting('chatThemeJson_' + getActiveCharKey(), getSetting('chatThemeJson', '')).trim();
        if (!raw) return {...DEFAULT_CHAT_THEME, ...JSON.parse(getSetting('chatBubbleColors','{}'))};
        try {
            const parsed = { ...DEFAULT_CHAT_THEME, ...JSON.parse(raw) };
            if (parsed.chatBgImage && parsed.chatBgImage.startsWith('data:')) {
                parsed.chatBgImage = persistMedia(parsed.chatBgImage, 'chat_bg');
                saveSetting('chatThemeJson_' + getActiveCharKey(), JSON.stringify(parsed));
            }
            return {...parsed, ...JSON.parse(getSetting('chatBubbleColors','{}'))};
        } catch {
            return { ...DEFAULT_CHAT_THEME };
        }
    }

    function saveChatTheme(patch = {}) {
        const cur = getChatTheme();
        const next = {
            userBubbleBg: typeof patch.userBubbleBg === 'string' && patch.userBubbleBg.trim() ? patch.userBubbleBg.trim() : cur.userBubbleBg,
            aiBubbleBg: typeof patch.aiBubbleBg === 'string' && patch.aiBubbleBg.trim() ? patch.aiBubbleBg.trim() : cur.aiBubbleBg,
            chatBgColor: typeof patch.chatBgColor === 'string' && patch.chatBgColor.trim() ? patch.chatBgColor.trim() : cur.chatBgColor,
            chatBgImage: typeof patch.chatBgImage === 'string' ? persistMedia(patch.chatBgImage, 'chat_bg') : cur.chatBgImage,
            chatBgMode: patch.chatBgMode === 'blur' ? 'blur' : (patch.chatBgMode === 'cover' ? 'cover' : cur.chatBgMode),
            chatBgBlur: patch.chatBgBlur !== undefined ? Math.max(0, Math.min(24, parseFloat(patch.chatBgBlur) || 0)) : cur.chatBgBlur,
            chatBgDim: patch.chatBgDim !== undefined ? Math.max(0, Math.min(0.85, parseFloat(patch.chatBgDim) || 0)) : cur.chatBgDim,
            chatBgScale: patch.chatBgScale !== undefined ? Math.max(0.5, Math.min(2.4, parseFloat(patch.chatBgScale) || 1)) : (cur.chatBgScale ?? 1),
            chatBgX: patch.chatBgX !== undefined ? Math.max(-320, Math.min(320, Math.round(Number(patch.chatBgX) || 0))) : (cur.chatBgX ?? 0),
            chatBgY: patch.chatBgY !== undefined ? Math.max(-360, Math.min(360, Math.round(Number(patch.chatBgY) || 0))) : (cur.chatBgY ?? 0)
        };
        saveSetting('chatBubbleColors', JSON.stringify({userBubbleBg:next.userBubbleBg, aiBubbleBg:next.aiBubbleBg}));
        saveSetting('chatThemeJson_' + getActiveCharKey(), JSON.stringify(next));
        return next;
    }

    function getProSettings() {
        const rawSec = parseInt(getSetting('chatDebounceSec', '10'), 10);
        return {
            chatSplitEnabled: getBoolSetting('chatSplitEnabled', true),
            chatTypingDelay: getBoolSetting('chatTypingDelay', true),
            chatDebounceEnabled: getBoolSetting('chatDebounceEnabled', true),
            chatDebounceSec: isNaN(rawSec) ? 10 : Math.max(2, Math.min(60, rawSec)),
            chatTheme: getChatTheme(),
            defaultChatTheme: { ...DEFAULT_CHAT_THEME },
            proactiveEnabled: getBoolSetting('proactiveEnabled', false),
            proactiveMin: Math.max(1, parseInt(getSetting('proactiveMin', '20'), 10) || 20),
            proactiveMax: Math.max(1, parseInt(getSetting('proactiveMax', '45'), 10) || 45)
        };
    }

    function insertMemoryWithTurn(memDb, charKey, turnId, eventType, role, content, expectedEpoch) {
        if (expectedEpoch !== null && getMemoryEpoch(charKey) !== expectedEpoch) return false;
        const clean = String(content || '').trim();
        if (!clean) return false;
        ensureTurnSchema(memDb);
        memDb.prepare(
            'INSERT INTO memory_events (char_key, event_type, role, content, turn_id) VALUES (?, ?, ?, ?, ?)'
        ).run(charKey, eventType, role, clean, turnId || '');
        return true;
    }

    async function runProChatCompletion({ charKey, turnId, reqEpoch, items, roomExtra }) {
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const openai = createAIClient();
        const { promptText, userName, charName } = getPersonasBlock(charKey, items.map(it => it.content || '').join('\n'));
        const proCfg = getProSettings();
        const voiceEnabled = getBoolSetting('voiceEnabled', false);
        const webSearchActive = tavily.isSearchReady(ctx);

        const splitSection = proCfg.chatSplitEnabled
            ? `\n\n${ctx.contactPrompt('chatSplitPrompt', { char: charName, user: userName })}`
            : '';
        const searchSection = webSearchActive
            ? `\n\n${ctx.contactPrompt('webSearchPrompt', { char: charName, user: userName })}`
            : '';

        const playlistTitles = getAvailablePlaylistTitles();
        const actionRule = ctx.contactPrompt('roomActionPrompt', { char: charName, user: userName }).trim();
        const inRoom = charKey === ctx.roomKey();
        const actionSection = inRoom && actionRule
            ? `\n\n${actionRule}\n- 留声机可用歌单：${playlistTitles.map(t => `《${t}》`).join('、')}`
            : '';

        const roomContext = inRoom ? getRoomContextSummary({ charKey, ...roomExtra }) : '当前是与用户的私人通讯。你没有参加这次共读。';
        const history = getUnifiedMemoryMessages(charKey);
        const nowTs = formatLocalTimestamp();

        const texts = [];
        const images = [];
        const audios = [];
        const memorySummaryParts = [];

        for (const it of items) {
            const t = String(it.content || '').trim();
            if (it.imageData) { images.push(it.imageData); memorySummaryParts.push('[发送了一张图片]'); }
            if (it.audioData) { audios.push({ data: it.audioData, format: it.audioFormat || 'webm' }); memorySummaryParts.push('[发送了一段语音]'); }
            if (t) { texts.push(t); memorySummaryParts.push(t); }
        }

        const mergedText = texts.join('\n');
        const hasDirectMedia = images.length > 0 || audios.length > 0;
        const memorySummaryLine = `（通讯消息）${memorySummaryParts.join(' ')}`;

        let currentUserContent;
        if (!hasDirectMedia) {
            const batchHint = items.length > 1 ? `（连续发来 ${items.length} 条通讯消息）` : '（通讯消息）';
            currentUserContent = `[${nowTs}] ${userName}${batchHint}：\n${mergedText}`;
        } else {
            const parts = [];
            const headerHint = mergedText
                ? `[${nowTs}] ${userName}（通讯消息）：\n${mergedText}`
                : `[${nowTs}] ${userName}（通讯消息）：（给你发来了${images.length ? '图片' : ''}${images.length && audios.length ? '和' : ''}${audios.length ? '语音' : ''}消息，请直接自然回应）`;
            parts.push({ type: 'text', text: headerHint });
            for (const img of images) parts.push({ type: 'image_url', image_url: { url: toDataUrlForAI(img) } });
            for (const aud of audios) {
                const fullAudData = toDataUrlForAI(aud.data);
                const base64Only = fullAudData.includes(',') ? fullAudData.split(',')[1] : fullAudData;
                const cleanFmt = String(aud.format || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
                parts.push({ type: 'input_audio', input_audio: { data: base64Only, format: cleanFmt } });
            }
            parts.push({
                type: 'text',
                text: '（系统隐式指令：请在你的自然回复最后，附带一行 <memo>极简客观概括你刚看到的图片或听到的语音内容，不超过35字</memo>，系统会自动剥离它作为你的记忆，不要向用户提及此标签）'
            });
            currentUserContent = parts;
        }

        const messages = buildOrderedMessages(
            `${promptText}${splitSection}${searchSection}${actionSection}\n\n${roomContext}`,
            history,
            currentUserContent
        );
        const { rawReply, searchedQueries } = await tavily.createChatCompletionWithSearch({
            openai,
            model: getModelName(),
            messages,
            ctx
        });

        const extractedMemo = hasDirectMedia ? extractMemoTag(rawReply) : '';
        const roomActions = inRoom ? extractRoomActions(rawReply) : [];
        const segments = parseReplyIntoSegments(rawReply, {
            charName,
            splitByDollar: proCfg.chatSplitEnabled,
            voiceEnabled,
            cleanAIOutput
        });

        const ttsApiKey = getSetting('ttsApiKey', '').trim();
        let voiceSynthCount = 0;
        const ttsWarnings = [];
        const preparedBubbles = [];

        for (const seg of segments) {
            if (seg.kind === 'voice' && voiceEnabled && ttsApiKey && voiceSynthCount < 3) {
                voiceSynthCount++;
                try {
                    const synth = await tts.synthesizeSpeech({
                        text: seg.text,
                        baseURL: getSetting('ttsBaseURL', tts.DEFAULT_TTS_BASE_URL),
                        apiKey: ttsApiKey,
                        groupId: getSetting('ttsGroupId', ''),
                        model: getSetting('ttsModel', tts.DEFAULT_TTS_MODEL),
                        voiceId: getSetting('voiceId', tts.DEFAULT_VOICE_ID),
                        speed: getSetting('voiceSpeed', '1.0')
                    });
                    if (synth.audioData) {
                        const savedVoiceUrl = persistMedia(synth.audioData, 'tts');
                        preparedBubbles.push({
                            kind: 'voice',
                            text: seg.text,
                            content: JSON.stringify({ __mm: 1, text: seg.text, audioData: savedVoiceUrl, isVoiceMsg: true })
                        });
                        continue;
                    }
                } catch (ttsErr) {
                    console.warn('⚠️ 独立语音气泡合成失败，已降级为文字气泡:', ttsErr.message);
                    ttsWarnings.push(ttsErr.message);
                }
            }
            preparedBubbles.push({ kind: 'text', text: seg.text, content: seg.text });
        }

        const isStaleAfterReset = getMemoryEpoch(charKey) !== reqEpoch;
        const replyMsgs = [];
        let actionEventId = 0;

        if (!isStaleAfterReset) {
            const insertChat = memDb.prepare(
                'INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)'
            );
            for (const b of preparedBubbles) {
                const info = insertChat.run(charKey, 'assistant', b.content, turnId);
                replyMsgs.push({
                    id: info.lastInsertRowid,
                    role: 'assistant',
                    content: b.content,
                    turn_id: turnId,
                    kind: b.kind,
                    charLen: b.text.length
                });
            }

            if (roomActions.length > 0) {
                for (const act of roomActions) {
                    const noticeText = buildActionNoticeText(act, charName, playlistTitles);
                    if (!noticeText) continue;
                    const sysInfo = insertChat.run(charKey, 'system', noticeText, turnId);
                    replyMsgs.push({
                        id: sysInfo.lastInsertRowid,
                        role: 'system',
                        content: noticeText,
                        turn_id: turnId,
                        kind: 'sys',
                        charLen: noticeText.length
                    });
                }
                actionEventId = publishRoomActions(charKey, charName, roomActions);
            }

            const enrichedUserMemory = extractedMemo
                ? `${memorySummaryLine}（附记忆画面/语音：${extractedMemo}）`
                : memorySummaryLine;
            const joinedAssistantMemory = segments.map(s => s.text).join('\n');

            insertMemoryWithTurn(memDb, charKey, turnId, 'chat', 'user', enrichedUserMemory, reqEpoch);
            insertMemoryWithTurn(memDb, charKey, turnId, 'chat', 'assistant', joinedAssistantMemory, reqEpoch);
            memoEngine.onTurnCompleted(charKey);
        } else {
            for (const b of preparedBubbles) {
                replyMsgs.push({ id: null, role: 'assistant', content: b.content, turn_id: turnId, kind: b.kind, charLen: b.text.length });
            }
        }

        return {
            staleDiscarded: isStaleAfterReset,
            replyMsgs,
            searchedQueries,
            roomActions,
            actionEventId,
            ttsWarning: ttsWarnings.join('；'),
            memoryCount: getMemoryCount(charKey)
        };
    }

    // --- 接口 A：小手机引擎 & 聊天框换肤配置读写 ---
    app.get('/api/chat/pro-settings', (req, res) => {
        res.json({ success: true, ...getProSettings() });
    });

    app.post('/api/chat/pro-settings', (req, res) => {
        if (req.body.chatSplitEnabled !== undefined) saveSetting('chatSplitEnabled', req.body.chatSplitEnabled ? 'true' : 'false');
        if (req.body.chatTypingDelay !== undefined) saveSetting('chatTypingDelay', req.body.chatTypingDelay ? 'true' : 'false');
        if (req.body.chatDebounceEnabled !== undefined) saveSetting('chatDebounceEnabled', req.body.chatDebounceEnabled ? 'true' : 'false');
        if (req.body.chatDebounceSec !== undefined) {
            const sec = Math.max(2, Math.min(60, parseInt(req.body.chatDebounceSec, 10) || 10));
            saveSetting('chatDebounceSec', sec);
        }
        if (req.body.chatTheme && typeof req.body.chatTheme === 'object') {
            saveChatTheme(req.body.chatTheme);
        }
        if (req.body.proactiveEnabled !== undefined) saveSetting('proactiveEnabled', req.body.proactiveEnabled ? 'true' : 'false');
        if (req.body.proactiveMin !== undefined) saveSetting('proactiveMin', Math.max(1, parseInt(req.body.proactiveMin, 10) || 20));
        if (req.body.proactiveMax !== undefined) saveSetting('proactiveMax', Math.max(1, parseInt(req.body.proactiveMax, 10) || 45));
        res.json({ success: true, ...getProSettings() });
    });

    // --- 接口 B：小手机增强聊天接口 ---
    app.post('/api/chat/pro', async (req, res) => {
        const {
            items: rawItems,
            content = '', imageData = '', audioData = '', audioFormat = 'webm',
            activeWidgetId = null, focusState = 'idle', isFocusing = false,
            totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 25,
            currentSong = '', deskSummary = ''
        } = req.body || {};

        const items = Array.isArray(rawItems) && rawItems.length > 0
            ? rawItems.filter(it => String(it?.content || '').trim() || it?.imageData || it?.audioData)
            : (String(content).trim() || imageData || audioData
                ? [{ content, imageData, audioData, audioFormat }]
                : []);

        if (!items.length) {
            return res.status(400).json({ success: false, message: '消息、图片或语音不能全为空' });
        }

        const charKey = getActiveCharKey();
        const reqEpoch = getMemoryEpoch(charKey);
        const turnId = makeTurnId();
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const insertUserChat = memDb.prepare(
            'INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)'
        );
        const userMsgs = [];
        for (const it of items) {
            const t = String(it.content || '').trim();
            const savedImg = it.imageData ? persistMedia(it.imageData, 'chat_img') : '';
            const savedAud = it.audioData ? persistMedia(it.audioData, 'chat_aud') : '';
            const stored = (savedImg || savedAud)
                ? JSON.stringify({ __mm: 1, text: t, imageData: savedImg, audioData: savedAud })
                : t;
            const info = insertUserChat.run(charKey, 'user', stored, turnId);
            userMsgs.push({ id: info.lastInsertRowid, role: 'user', content: stored, turn_id: turnId });
        }

        const mode = getSetting('mode', 'standalone');
        if (mode === 'mcp') {
            const merged = items.map(i => String(i.content || '').trim()).filter(Boolean).join('\n');
            db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
                .run('chat_message', JSON.stringify({
                    messageId: userMsgs[userMsgs.length - 1]?.id,
                    charKey, turnId, userProfile:ctx.userScopes.context(charKey), content: merged,
                    hasImage: items.some(i => Boolean(i.imageData)),
                    hasAudio: items.some(i => Boolean(i.audioData))
                }));
            insertMemoryWithTurn(memDb, charKey, turnId, 'chat', 'user', `（通讯消息）${merged || '[多媒体消息]'}`, reqEpoch);
            return res.json({
                success: true, pending: true, turnId, userMsgs,
                replyMsgs: [{ id: null, role: 'assistant', content: '（已发往外部 MCP 框架，等待对方回复…）', kind: 'text', charLen: 18 }]
            });
        }

        try {
            const result = await runProChatCompletion({
                charKey, turnId, reqEpoch, items,
                roomExtra: { focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId }
            });
            res.json({ success: true, turnId, userMsgs, ...result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    // --- 接口 C：🔄 /reroll 严格仅重生成聊天框最后一轮回复 ---
    app.post('/api/chat/reroll', async (req, res) => {
        const charKey = getActiveCharKey();
        if (!vault.hasMemoryDb(charKey)) {
            return res.status(400).json({ success: false, message: '当前还没有可重生成的聊天对话哦～' });
        }
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const allChats = memDb.prepare('SELECT id, role, content, turn_id FROM chat_messages ORDER BY id ASC').all();
        if (!allChats.length) {
            return res.status(400).json({ success: false, message: '当前还没有可重生成的聊天对话哦～' });
        }

        const lastRow = allChats[allChats.length - 1];
        let targetTurnId = String(lastRow.turn_id || '').trim();
        let targetUserRows = [];
        let targetAssistantIds = [];

        if (targetTurnId) {
            const turnRows = allChats.filter(r => String(r.turn_id || '').trim() === targetTurnId);
            targetUserRows = turnRows.filter(r => r.role === 'user');
            targetAssistantIds = turnRows.filter(r => r.role === 'assistant' || r.role === 'system').map(r => r.id);
        } else {
            let idx = allChats.length - 1;
            while (idx >= 0 && !allChats[idx].turn_id && (allChats[idx].role === 'assistant' || allChats[idx].role === 'system')) {
                targetAssistantIds.push(allChats[idx].id);
                idx--;
            }
            const revUsers = [];
            while (idx >= 0 && !allChats[idx].turn_id && allChats[idx].role === 'user') {
                revUsers.push(allChats[idx]);
                idx--;
            }
            targetUserRows = revUsers.reverse();
            targetTurnId = makeTurnId();
        }

        if (!targetUserRows.length) {
            return res.status(400).json({ success: false, message: '最后一条消息没有对应的用户发言（可能是系统主动提醒），无法 /reroll 哦～' });
        }

        const items = targetUserRows.map(r => {
            const parsed = parseStoredPayload(r.content);
            const audUrl = parsed.audioData || '';
            const extMatch = audUrl.match(/\.([a-z0-9]+)$/i);
            const inferredFmt = extMatch ? extMatch[1].toLowerCase() : (audUrl.includes('audio/mp4') ? 'm4a' : 'webm');
            return {
                content: parsed.text || '',
                imageData: parsed.imageData || '',
                audioData: audUrl,
                audioFormat: inferredFmt
            };
        });

        if (targetAssistantIds.length) {
            const ph = targetAssistantIds.map(() => '?').join(',');
            memDb.prepare(`DELETE FROM chat_messages WHERE id IN (${ph})`).run(...targetAssistantIds);
        }

        const oldMemDel = targetTurnId
            ? memDb.prepare("DELETE FROM memory_events WHERE turn_id = ? AND event_type = 'chat'").run(targetTurnId).changes
            : 0;
        if (oldMemDel === 0) {
            const chatMems = memDb.prepare("SELECT id, role, turn_id FROM memory_events WHERE event_type = 'chat' ORDER BY id ASC").all();
            const { idsToDelete } = collectLastRoundsIds(chatMems, 1);
            if (idsToDelete.length) {
                const ph = idsToDelete.map(() => '?').join(',');
                memDb.prepare(`DELETE FROM memory_events WHERE id IN (${ph})`).run(...idsToDelete);
            }
        }

        const {
            activeWidgetId = null, focusState = 'idle', isFocusing = false,
            totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 25,
            currentSong = '', deskSummary = ''
        } = req.body || {};

        const reqEpoch = getMemoryEpoch(charKey);
        try {
            const result = await runProChatCompletion({
                charKey, turnId: targetTurnId, reqEpoch, items,
                roomExtra: { focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId }
            });
            res.json({ success: true, turnId: targetTurnId, removedChatIds: targetAssistantIds, ...result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    // --- 接口 D：↩️ 聊天框专属撤回预览 & 执行 ---
    app.get('/api/chat/undo-preview', (req, res) => {
        const rounds = Math.max(1, Math.min(20, parseInt(req.query?.rounds, 10) || 1));
        const charKey = getActiveCharKey();
        if (!vault.hasMemoryDb(charKey)) {
            return res.json({ success: true, rounds, bubbleCount: 0, previews: [] });
        }
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);
        const allChats = memDb.prepare('SELECT id, role, content, turn_id FROM chat_messages ORDER BY id ASC').all();
        const { idsToDelete } = collectLastRoundsIds(allChats, rounds);
        const idSet = new Set(idsToDelete);
        const previews = allChats
            .filter(r => idSet.has(r.id))
            .map(r => {
                const p = parseStoredPayload(r.content);
                const label = p.text || (p.audioData ? '[语音消息]' : (p.imageData ? '[图片消息]' : ''));
                return { id: r.id, role: r.role, preview: label.slice(0, 48) };
            });
        res.json({ success: true, rounds, bubbleCount: previews.length, previews });
    });

    app.post('/api/chat/undo', (req, res) => {
        const rounds = Math.max(1, Math.min(20, parseInt(req.body?.rounds, 10) || 1));
        const charKey = getActiveCharKey();
        if (!vault.hasMemoryDb(charKey)) {
            return res.json({ success: true, roundsRemoved: 0, removedChatIds: [], removedMemoryCount: 0, memoryCount: 0 });
        }

        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const allChats = memDb.prepare('SELECT id, role, content, turn_id FROM chat_messages ORDER BY id ASC').all();
        const { idsToDelete: chatIds, matchedTurnIds } = collectLastRoundsIds(allChats, rounds);

        if (chatIds.length) {
            const ph = chatIds.map(() => '?').join(',');
            memDb.prepare(`DELETE FROM chat_messages WHERE id IN (${ph})`).run(...chatIds);
        }

        let removedMemoryCount = 0;
        if (matchedTurnIds.size > 0) {
            const tids = Array.from(matchedTurnIds);
            const ph = tids.map(() => '?').join(',');
            removedMemoryCount += memDb.prepare(`DELETE FROM memory_events WHERE event_type = 'chat' AND turn_id IN (${ph})`).run(...tids).changes;
        }
        const remainingLegacyRounds = Math.max(0, rounds - matchedTurnIds.size);
        if (remainingLegacyRounds > 0) {
            const chatMems = memDb.prepare("SELECT id, role, turn_id FROM memory_events WHERE event_type = 'chat' ORDER BY id ASC").all();
            const { idsToDelete: memIds } = collectLastRoundsIds(chatMems, remainingLegacyRounds);
            if (memIds.length) {
                const ph = memIds.map(() => '?').join(',');
                removedMemoryCount += memDb.prepare(`DELETE FROM memory_events WHERE id IN (${ph})`).run(...memIds).changes;
            }
        }

        res.json({ success: true, roundsRequested: rounds, removedChatIds: chatIds, removedMemoryCount, memoryCount: getMemoryCount(charKey) });
    });

    // --- 接口 E：🫧 单条/多选气泡精准删除 ---
    app.post('/api/chat/delete-bubbles', (req, res) => {
        const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const ids = rawIds.map(x => parseInt(x, 10)).filter(n => !isNaN(n) && n > 0);
        const syncMemory = req.body?.syncMemory !== false;
        const charKey = getActiveCharKey();

        if (!ids.length || !vault.hasMemoryDb(charKey)) {
            return res.json({ success: true, deletedBubbles: 0, deletedMemory: 0, memoryCount: getMemoryCount(charKey) });
        }

        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const ph = ids.map(() => '?').join(',');
        const targetRows = memDb.prepare(`SELECT id, role, content, turn_id FROM chat_messages WHERE id IN (${ph})`).all(...ids);
        const deletedBubbles = memDb.prepare(`DELETE FROM chat_messages WHERE id IN (${ph})`).run(...ids).changes;

        let deletedMemory = 0;
        if (syncMemory && targetRows.length) {
            const affectedPairs = new Map();
            for (const row of targetRows) {
                const tid = String(row.turn_id || '').trim();
                if (tid) affectedPairs.set(`${tid}::${row.role}`, { turnId: tid, role: row.role });
            }
            for (const { turnId, role } of affectedPairs.values()) {
                const rest = memDb.prepare('SELECT content FROM chat_messages WHERE turn_id = ? AND role = ? ORDER BY id ASC').all(turnId, role);
                if (rest.length === 0) {
                    deletedMemory += memDb.prepare("DELETE FROM memory_events WHERE turn_id = ? AND role = ? AND event_type = 'chat'").run(turnId, role).changes;
                } else {
                    const rebuilt = rest.map(r => {
                        const p = parseStoredPayload(r.content);
                        const parts = [];
                        if (p.imageData) parts.push('[发送了一张图片]');
                        if (p.audioData && role === 'user') parts.push('[发送了一段语音]');
                        if (p.text) parts.push(p.text);
                        return parts.join(' ');
                    }).filter(Boolean).join('\n');
                    if (rebuilt) {
                        const finalMem = role === 'user' ? `（通讯消息）${rebuilt}` : rebuilt;
                        memDb.prepare("UPDATE memory_events SET content = ? WHERE turn_id = ? AND role = ? AND event_type = 'chat'").run(finalMem, turnId, role);
                    }
                }
            }
        }

        res.json({ success: true, deletedBubbles, deletedMemory, memoryCount: getMemoryCount(charKey) });
    });

    // --- 接口 F：🧠 全局上下文记忆可视化清单 ---
    app.get('/api/memory/list', (req, res) => {
        const charKey = getActiveCharKey();
        const snap = memoEngine.getWindowSnapshot(charKey);
        const { windowInfo, activeIds } = snap;

        const minRows = Math.max(240, windowInfo.maxContextMsgs + 80);
        const reqLimit = parseInt(req.query?.limit, 10);
        const maxRows = Math.min(1000, Math.max(minRows, isNaN(reqLimit) ? minRows : reqLimit));

        let items = [];
        if (vault.hasMemoryDb(charKey)) {
            const memDb = vault.getMemoryDb(charKey);
            ensureTurnSchema(memDb);
            const rawItems = memDb.prepare(
                'SELECT id, event_type, role, content, turn_id, created_at FROM memory_events ORDER BY id DESC LIMIT ?'
            ).all(maxRows);

            items = rawItems.map(item => {
                const inWindow = activeIds.has(item.id);
                let windowReason = 'active';
                if (!inWindow) {
                    windowReason = (windowInfo.mode === 'batch_evict' && item.id <= windowInfo.windowStartId)
                        ? 'evicted'
                        : 'slid_out';
                }
                return { ...item, in_window: inWindow, window_reason: windowReason };
            });
        }

        const widgets = db.prepare('SELECT id, caption, visible_to_ai, ai_memo FROM widgets ORDER BY id DESC').all()
            .map(w => ({
                id: w.id,
                caption: w.caption || '',
                visible_to_ai: w.visible_to_ai ? 1 : 0,
                ai_memo: (w.ai_memo || '').trim()
            }));

        res.json({
            success: true,
            activeCharKey: charKey,
            charName: getSetting('charName', '连线搭子'),
            memoryFile: vault.getMemoryDbFilename(charKey),
            maxContextRounds: windowInfo.maxContextRounds,
            contextLimit: windowInfo.maxContextMsgs,
            windowInfo,
            totalCount: getMemoryCount(charKey),
            items,
            widgets
        });
    });

    app.post('/api/memory/delete-selected', (req, res) => {
        const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const ids = rawIds.map(x => parseInt(x, 10)).filter(n => !isNaN(n) && n > 0);
        const syncChat = req.body?.syncChat !== false;
        const charKey = getActiveCharKey();

        if (!ids.length || !vault.hasMemoryDb(charKey)) {
            return res.json({ success: true, deletedMemory: 0, deletedChat: 0, memoryCount: getMemoryCount(charKey) });
        }

        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        const ph = ids.map(() => '?').join(',');
        const targetRows = memDb.prepare(`SELECT id, event_type, role, turn_id FROM memory_events WHERE id IN (${ph})`).all(...ids);
        const deletedMemory = memDb.prepare(`DELETE FROM memory_events WHERE id IN (${ph})`).run(...ids).changes;

        let deletedChat = 0;
        if (syncChat && targetRows.length) {
            const chatPairs = new Map();
            for (const r of targetRows) {
                const tid = String(r.turn_id || '').trim();
                if (r.event_type === 'chat' && tid) chatPairs.set(`${tid}::${r.role}`, { turnId: tid, role: r.role });
            }
            for (const { turnId, role } of chatPairs.values()) {
                deletedChat += memDb.prepare('DELETE FROM chat_messages WHERE turn_id = ? AND role = ?').run(turnId, role).changes;
            }
        }

        res.json({ success: true, deletedMemory, deletedChat, memoryCount: getMemoryCount(charKey) });
    });

    app.post('/api/memory/archive', (req, res) => {
        res.status(410).json({
            success: false,
            message: '旧版手账压缩已下线，请前往「📝 动态备忘录引擎」点击「立即提炼更新」哦～'
        });
    });

    app.post('/api/widgets/clear-memos', (req, res) => {
        const widgetId = req.body?.widgetId ? parseInt(req.body.widgetId, 10) : null;
        if (widgetId) db.prepare("UPDATE widgets SET visible_to_ai = 0, ai_memo = '' WHERE id = ?").run(widgetId);
        else db.prepare("UPDATE widgets SET visible_to_ai = 0, ai_memo = ''").run();
        res.json({ success: true, clearedWidgetId: widgetId || 'ALL' });
    });

    // --- 接口 G：🎨 全局视觉配置持久化 ---
    app.get('/api/visual/settings', (req, res) => {
        const raw = getSetting('visualPrefsJson', '').trim();
        let prefs = {};
        if (raw) { try { prefs = JSON.parse(raw); } catch {} }
        res.json({ success: true, prefs });
    });

    app.post('/api/visual/settings', (req, res) => {
        const raw = getSetting('visualPrefsJson', '').trim();
        let cur = {};
        if (raw) { try { cur = JSON.parse(raw); } catch {} }
        const incoming = (req.body && typeof req.body.prefs === 'object') ? req.body.prefs : {};
        const merged = { ...cur, ...incoming };
        saveSetting('visualPrefsJson', JSON.stringify(merged));
        res.json({ success: true, prefs: merged });
    });

    // --- 接口 H：💌 角色主动发起通讯消息 ---
    app.post('/api/chat/proactive', async (req, res) => {
        if (getSetting('mode')==='mcp' && !getBoolSetting('soloMode',false)) {
            const eventId=require('./mcp-owner').enqueue(ctx,Math.max(1,Number(req.body?.idleMinutes)||1));
            return res.json({success:true,pending:true,eventId});
        }
        if (getBoolSetting('soloMode', false) || getSetting('mode', 'standalone') !== 'standalone') {
            return res.json({ success: true, skipped: true });
        }
        const {
            idleMinutes = 30,
            activeWidgetId = null, focusState = 'idle', isFocusing = false,
            totalMinutes = 25, elapsedMinutes = 0, remainingMinutes = 25,
            currentSong = '', deskSummary = ''
        } = req.body || {};

        const charKey = getActiveCharKey();
        const reqEpoch = getMemoryEpoch(charKey);
        const turnId = makeTurnId();
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        try {
            const openai = createAIClient();
            const { promptText, userName, charName } = getPersonasBlock(charKey);
            const proCfg = getProSettings();
            const voiceEnabled = getBoolSetting('voiceEnabled', false);

            const splitSection = proCfg.chatSplitEnabled
                ? `\n\n${presets.getPrompt('chatSplitPrompt', { char: charName, user: userName })}`
                : '';
            const roomContext = getRoomContextSummary({
                charKey, focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes, currentSong, deskSummary, activeWidgetId
            });
            const history = getUnifiedMemoryMessages(charKey);
            const nowTs = formatLocalTimestamp();

            const triggerPrompt = `[${nowTs}] ${presets.getPrompt('proactiveChat', {
                char: charName, user: userName, idleMinutes
            })}`;

            const messages = buildOrderedMessages(
                `${promptText}${splitSection}\n\n${roomContext}`,
                history,
                triggerPrompt
            );
            const { rawReply } = await tavily.createChatCompletionWithSearch({
                openai, model: getModelName(), messages, ctx
            });

            const segments = parseReplyIntoSegments(rawReply, {
                charName, splitByDollar: proCfg.chatSplitEnabled, voiceEnabled, cleanAIOutput
            });

            const ttsApiKey = getSetting('ttsApiKey', '').trim();
            let voiceSynthCount = 0;
            const preparedBubbles = [];
            for (const seg of segments) {
                if (seg.kind === 'voice' && voiceEnabled && ttsApiKey && voiceSynthCount < 2) {
                    voiceSynthCount++;
                    try {
                        const synth = await tts.synthesizeSpeech({
                            text: seg.text,
                            baseURL: getSetting('ttsBaseURL', tts.DEFAULT_TTS_BASE_URL),
                            apiKey: ttsApiKey,
                            groupId: getSetting('ttsGroupId', ''),
                            model: getSetting('ttsModel', tts.DEFAULT_TTS_MODEL),
                            voiceId: getSetting('voiceId', tts.DEFAULT_VOICE_ID),
                            speed: getSetting('voiceSpeed', '1.0')
                        });
                        if (synth.audioData) {
                            const savedVoiceUrl = persistMedia(synth.audioData, 'tts');
                            preparedBubbles.push({
                                kind: 'voice', text: seg.text,
                                content: JSON.stringify({ __mm: 1, text: seg.text, audioData: savedVoiceUrl, isVoiceMsg: true })
                            });
                            continue;
                        }
                    } catch {}
                }
                preparedBubbles.push({ kind: 'text', text: seg.text, content: seg.text });
            }

            if (getMemoryEpoch(charKey) !== reqEpoch) {
                return res.json({ success: true, staleDiscarded: true, replyMsgs: [] });
            }

            const insertChat = memDb.prepare(
                'INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)'
            );
            const replyMsgs = [];
            for (const b of preparedBubbles) {
                const info = insertChat.run(charKey, 'assistant', b.content, turnId);
                replyMsgs.push({
                    id: info.lastInsertRowid, role: 'assistant', content: b.content,
                    turn_id: turnId, kind: b.kind, charLen: b.text.length,
                    created_at: new Date().toISOString()
                });
            }

            const joinedAssistantMemory = segments.map(s => s.text).join('\n');
            insertMemoryWithTurn(memDb, charKey, turnId, 'chat', 'assistant', `（主动发来通讯）${joinedAssistantMemory}`, reqEpoch);
            memoEngine.onTurnCompleted(charKey);

            res.json({ success: true, turnId, replyMsgs });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    });
    console.log('📱 小手机通讯 & Tavily & 跨次元双端联动 & 统一记忆视图已就位');
};