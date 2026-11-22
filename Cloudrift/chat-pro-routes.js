// server/chat-pro-routes.js —— 小手机通讯引擎 + Tavily 联网 + 角色跨次元联动(<pet>/<play>) + 统一记忆清单 + 视觉配置持久化
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
    chatBgDim: 0.35
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
        if (['happy', 'jump', 'feed', 'ball', 'play', 'rage'].includes(act)) {
            actions.push({ type: 'pet', action: act === 'jump' ? 'happy' : (act === 'play' ? 'ball' : act) });
        }
    }
    const playMatch = s.match(/<play\s*:\s*([^<>]+?)\s*>/i);
    if (playMatch && playMatch[1]) {
        const q = playMatch[1].replace(/[《》"'「」]/g, '').trim();
        if (q) actions.push({ type: 'play', query: q });
    }
    return actions;
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
                // 兼容长上下文忘写 $、改用空行分段的情况，自动拆成独立短气泡！
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
        db, tts, presets, vault, memoEngine,
        getSetting, saveSetting, getBoolSetting, getActiveCharKey,
        createAIClient, getModelName, getPersonasBlock, getRoomContextSummary,
        getUnifiedMemoryMessages, buildOrderedMessages, cleanAIOutput,
        extractMemoTag, formatLocalTimestamp, getMemoryEpoch, getMemoryCount
    } = ctx;

    function getChatTheme() {
        const raw = getSetting('chatThemeJson', '').trim();
        if (!raw) return { ...DEFAULT_CHAT_THEME };
        try {
            return { ...DEFAULT_CHAT_THEME, ...JSON.parse(raw) };
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
            chatBgImage: typeof patch.chatBgImage === 'string' ? patch.chatBgImage : cur.chatBgImage,
            chatBgMode: patch.chatBgMode === 'blur' ? 'blur' : (patch.chatBgMode === 'cover' ? 'cover' : cur.chatBgMode),
            chatBgBlur: patch.chatBgBlur !== undefined ? Math.max(0, Math.min(24, parseFloat(patch.chatBgBlur) || 0)) : cur.chatBgBlur,
            chatBgDim: patch.chatBgDim !== undefined ? Math.max(0, Math.min(0.85, parseFloat(patch.chatBgDim) || 0)) : cur.chatBgDim
        };
        saveSetting('chatThemeJson', JSON.stringify(next));
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
            defaultChatTheme: { ...DEFAULT_CHAT_THEME }
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
        // getPersonasBlock(charKey) 已统一拼接动态备忘录，无需重复注入
        const { promptText, userName, charName } = getPersonasBlock(charKey);
        const proCfg = getProSettings();
        const voiceEnabled = getBoolSetting('voiceEnabled', false);
        const webSearchActive = tavily.isSearchReady(ctx);

        const splitSection = proCfg.chatSplitEnabled
            ? `\n\n${presets.getPrompt('chatSplitPrompt', { char: charName, user: userName })}`
            : '';
        const searchSection = webSearchActive
            ? `\n\n${presets.getPrompt('webSearchPrompt', { char: charName, user: userName })}`
            : '';

        const playlistTitles = getAvailablePlaylistTitles();
        const actionRule = presets.getPrompt('roomActionPrompt', { char: charName, user: userName }).trim();
        const actionSection = actionRule
            ? `\n\n${actionRule}\n- 留声机可用歌单：${playlistTitles.map(t => `《${t}》`).join('、')}`
            : '';

        const roomContext = getRoomContextSummary({ charKey, ...roomExtra });
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
            for (const img of images) parts.push({ type: 'image_url', image_url: { url: img } });
            for (const aud of audios) {
                const base64Only = aud.data.includes(',') ? aud.data.split(',')[1] : aud.data;
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
        const roomActions = extractRoomActions(rawReply);
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
                        preparedBubbles.push({
                            kind: 'voice',
                            text: seg.text,
                            content: JSON.stringify({ __mm: 1, text: seg.text, audioData: synth.audioData, isVoiceMsg: true })
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
            const stored = (it.imageData || it.audioData)
                ? JSON.stringify({ __mm: 1, text: t, imageData: it.imageData || '', audioData: it.audioData || '' })
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
                    charKey, turnId, content: merged,
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
            targetAssistantIds = turnRows.filter(r => r.role === 'assistant').map(r => r.id);
        } else {
            let idx = allChats.length - 1;
            while (idx >= 0 && !allChats[idx].turn_id && allChats[idx].role === 'assistant') {
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
            return {
                content: parsed.text || '',
                imageData: parsed.imageData || '',
                audioData: parsed.audioData || '',
                audioFormat: 'webm'
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

    // --- 接口 F：🧠 全局上下文记忆可视化清单（100% 真实联动水位线与统一轮数配置） ---
    app.get('/api/memory/list', (req, res) => {
        const charKey = getActiveCharKey();
        const snap = memoEngine.getWindowSnapshot(charKey);
        const { windowInfo, activeIds } = snap;

        // 动态拉取条数，确保上限拉到 160~200 轮时也能完整展示所有生效区 + 已滑出历史
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
                return {
                    ...item,
                    in_window: inWindow,
                    window_reason: windowReason
                };
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

    // 已统一由「📝 动态备忘录引擎」(/api/memo/update-now) 接管，下线旧手账压缩入口
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

    console.log('📱 小手机通讯 & Tavily & 跨次元联动 & 统一记忆视图已就位');
};