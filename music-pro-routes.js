// music-pro-routes.js —— 本地音频自由上传入库 + 60秒音乐片段多模态直通分享 & <memo> 听觉记忆回填 + 硬盘落盘瘦身
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MUSIC_FILES_DIR = path.join(__dirname, 'data', 'music', 'files');
if (!fs.existsSync(MUSIC_FILES_DIR)) fs.mkdirSync(MUSIC_FILES_DIR, { recursive: true });

const ALLOWED_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm']);
const migratedDbs = new WeakSet();

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

function fmtSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

function stripMetaKeepVoice(rawText) {
    let text = String(rawText || '');
    const rules = [
        { find: /<(thinking|think)>[\s\S]*?<\/\1>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?<\/(thinking|think)>/gi, replace: '' },
        { find: /<(thinking|think)>[\s\S]*?(?=\[finire\])/gi, replace: '' },
        { find: /<\/?(thinking|think)>\s*/gi, replace: '' },
        { find: /<memo>[\s\S]*?<\/memo>/gi, replace: '' },
        { find: /<memo>[\s\S]*$/gi, replace: '' },
        { find: /<\/?memo>\s*/gi, replace: '' },
        { find: /<pet\s*:\s*[^<>]*>/gi, replace: '' },
        { find: /<play\s*:\s*[^<>]*>/gi, replace: '' },
        { find: /\[(incipere|finire)\]\s*/gi, replace: '' }
    ];
    for (const r of rules) text = text.replace(r.find, r.replace);
    return text.trim();
}

function parseReplySegments(rawText, { charName, splitByDollar, voiceEnabled, cleanAIOutput }) {
    const stripped = stripMetaKeepVoice(rawText);
    const segments = [];
    const pushText = (chunk) => {
        if (!chunk || !chunk.trim()) return;
        const parts = splitByDollar
            ? chunk.split(/(?<!\\)\$(?!\d+(?:\.\d+)?\s*(?:美元|美金|USD|刀))/g)
            : [chunk];
        for (const p of parts) {
            const cleaned = cleanAIOutput(p.replace(/\\\$/g, '$'), charName);
            if (cleaned) segments.push({ kind: 'text', text: cleaned });
        }
    };

    if (!voiceEnabled) {
        pushText(stripped.replace(/<\/?voice>/gi, ''));
    } else {
        const voiceRe = /<voice>([\s\S]*?)<\/voice>/gi;
        let lastIdx = 0;
        let m;
        while ((m = voiceRe.exec(stripped)) !== null) {
            if (m.index > lastIdx) pushText(stripped.slice(lastIdx, m.index));
            const vt = cleanAIOutput(m[1] || '', charName);
            if (vt) segments.push({ kind: 'voice', text: vt });
            lastIdx = voiceRe.lastIndex;
        }
        if (lastIdx < stripped.length) pushText(stripped.slice(lastIdx));
    }

    if (!segments.length) {
        const fb = cleanAIOutput(rawText, charName);
        if (fb) segments.push({ kind: 'text', text: fb });
    }
    return segments;
}

module.exports = function registerMusicProRoutes(app, ctx) {
    const {
        db, musicDb, tts, presets, vault, memoEngine, mediaStore,
        getSetting, getBoolSetting, getActiveCharKey,
        createAIClient, getModelName, getPersonasBlock, getRoomContextSummary,
        getUnifiedMemoryMessages, buildOrderedMessages, cleanAIOutput,
        extractMemoTag, formatLocalTimestamp, getMemoryEpoch, getMemoryCount
    } = ctx;

    const persistMedia = (val, prefix) => (mediaStore ? mediaStore.persistMedia(val, prefix) : val);

    // 1. 静态挂载本地音频目录（支持 Range 断点续传与进度条拖动）
    app.use('/music-files', express.static(MUSIC_FILES_DIR, {
        acceptRanges: true,
        maxAge: '7d'
    }));

    // 2. 📁 上传本地 MP3/WAV/OGG/M4A/FLAC 音频入库（上限 50MB）
    app.post('/api/music-pro/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
        try {
            const buf = req.body;
            if (!Buffer.isBuffer(buf) || buf.length < 128) {
                return res.status(400).json({ success: false, message: '未收到有效的音频文件数据哦～' });
            }

            const rawExt = String(req.query.ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
            const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : 'mp3';
            const rawTitle = String(req.query.title || '').trim();
            const finalTitle = (rawTitle || `本地音乐_${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}`).slice(0, 80);

            const fileName = `track_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
            const fullPath = path.join(MUSIC_FILES_DIR, fileName);
            fs.writeFileSync(fullPath, buf);

            const publicUrl = `/music-files/${fileName}`;
            const info = musicDb.prepare('INSERT INTO playlist (title, url, is_builtin) VALUES (?, ?, 0)').run(finalTitle, publicUrl);

            console.log(`🎵 本地音乐入库成功: 《${finalTitle}》 -> ${publicUrl} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
            res.json({
                success: true,
                song: { id: info.lastInsertRowid, title: finalTitle, url: publicUrl, is_builtin: 0 }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: `音频保存失败：${error.message}` });
        }
    });

    // 3. 🗑️ 删除歌单曲目并同步清理本地物理音频文件
    app.delete('/api/music-pro/track/:id', (req, res) => {
        try {
            const row = musicDb.prepare('SELECT * FROM playlist WHERE id = ?').get(req.params.id);
            if (row && typeof row.url === 'string' && row.url.startsWith('/music-files/')) {
                const baseName = path.basename(row.url);
                const fullPath = path.join(MUSIC_FILES_DIR, baseName);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch {}
                }
            }
            const info = musicDb.prepare('DELETE FROM playlist WHERE id = ?').run(req.params.id);
            res.json({ success: true, deleted: info.changes });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // 4. 🎧 分享本地音乐截取片段给角色（原生多模态音频直通 + 硬盘落盘 + <memo> 听觉记忆回填）
    app.post('/api/music-pro/share-clip', async (req, res) => {
        const {
            trackTitle = '未命名曲目',
            startSec = 0,
            endSec = 15,
            audioData = '',
            audioFormat = 'wav',
            userComment = '',
            activeWidgetId = null,
            focusState = 'idle',
            isFocusing = false,
            totalMinutes = 25,
            elapsedMinutes = 0,
            remainingMinutes = 25,
            currentSong = '',
            deskSummary = ''
        } = req.body || {};

        if (getBoolSetting('soloMode', false)) {
            return res.status(400).json({ success: false, message: '当前处于单人专注模式，切回线上陪伴即可分享给 TA 听哦～' });
        }
        if (!audioData) {
            return res.status(400).json({ success: false, message: '缺少截取后的音频数据' });
        }

        const cleanTitle = String(trackTitle).trim() || '未命名曲目';
        const sSec = Math.max(0, Number(startSec) || 0);
        const eSec = Math.max(sSec + 1, Number(endSec) || sSec + 15);
        const clipDur = Math.min(60, Math.max(1, Math.round(eSec - sSec)));
        const rangeLabel = `${fmtSec(sSec)} ~ ${fmtSec(eSec)}`;
        const cleanComment = String(userComment || '').trim();

        const charKey = getActiveCharKey();
        const reqEpoch = getMemoryEpoch(charKey);
        const turnId = makeTurnId();
        const memDb = vault.getMemoryDb(charKey);
        ensureTurnSchema(memDb);

        // 音乐片段落盘成 /uploads/... 短链，防止 2MB WAV Base64 撑爆聊天库！
        const savedClipUrl = persistMedia(audioData, 'music_clip');
        const storedUserContent = JSON.stringify({
            __mm: 1,
            isMusicClip: true,
            trackTitle: cleanTitle,
            clipRange: rangeLabel,
            clipDuration: clipDur,
            text: cleanComment,
            audioData: savedClipUrl
        });

        const userInfo = memDb.prepare(
            'INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)'
        ).run(charKey, 'user', storedUserContent, turnId);
        const userMsg = { id: userInfo.lastInsertRowid, role: 'user', content: storedUserContent, turn_id: turnId };

        const baseMemorySummary = `（音乐片段分享）分享了手动加入歌单的《${cleanTitle}》片段（${rangeLabel}，约${clipDur}秒）${cleanComment ? `，并说：“${cleanComment}”` : ''}`;

        if (getSetting('mode', 'standalone') === 'mcp') {
            db.prepare('INSERT INTO pending_events (event_type, payload) VALUES (?, ?)')
                .run('music_clip_share', JSON.stringify({ messageId: userMsg.id, charKey, turnId, trackTitle: cleanTitle, clipRange: rangeLabel, userComment: cleanComment }));
            memDb.prepare('INSERT INTO memory_events (char_key, event_type, role, content, turn_id) VALUES (?, ?, ?, ?, ?)')
                .run(charKey, 'chat', 'user', baseMemorySummary, turnId);
            return res.json({
                success: true,
                pending: true,
                turnId,
                userMsg,
                replyMsgs: [{ id: null, role: 'assistant', content: '（已发往外部 MCP 框架，等待对方听完回应…）', kind: 'text', charLen: 20 }]
            });
        }

        try {
            const openai = createAIClient();
            const { promptText, userName, charName } = getPersonasBlock(charKey);
            const splitEnabled = getBoolSetting('chatSplitEnabled', true);
            const voiceEnabled = getBoolSetting('voiceEnabled', false);

            const splitSection = splitEnabled
                ? `\n\n${presets.getPrompt('chatSplitPrompt', { char: charName, user: userName })}`
                : '';
            const roomContext = getRoomContextSummary({
                charKey, focusState, isFocusing, totalMinutes, elapsedMinutes, remainingMinutes,
                currentSong: currentSong || cleanTitle, deskSummary, activeWidgetId
            });
            const history = getUnifiedMemoryMessages(charKey);
            const nowTs = formatLocalTimestamp();

            const base64Only = audioData.includes(',') ? audioData.split(',')[1] : audioData;
            const cleanFmt = String(audioFormat || 'wav').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav';

            const userParts = [
                {
                    type: 'text',
                    text: `[${nowTs}] ${userName}（音乐片段分享）：${userName} 分享了 TA 手动加入歌单、名为《${cleanTitle}》的一段音乐片段（截取自 ${rangeLabel}，时长 ${clipDur} 秒）${cleanComment ? `，并附言说：“${cleanComment}”` : ''}。请认真听一下这段音乐的旋律、节奏、人声或氛围，结合你的人设自然回应对方！`
                },
                {
                    type: 'input_audio',
                    input_audio: { data: base64Only, format: cleanFmt }
                },
                {
                    type: 'text',
                    text: `（系统隐式指令：请在你的自然回复最后，附带一行 <memo>极简客观概括你刚听到的这段《${cleanTitle}》音乐片段的曲风、节奏、人声或情绪氛围，不超过40字</memo>，系统会自动剥离它存入你的听觉记忆，绝对不要向用户提及此标签）`
                }
            ];

            const messages = buildOrderedMessages(`${promptText}${splitSection}\n\n${roomContext}`, history, userParts);
            const response = await openai.chat.completions.create({ model: getModelName(), messages });

            const rawReply = response.choices?.[0]?.message?.content || '';
            const extractedMemo = extractMemoTag(rawReply);
            const segments = parseReplySegments(rawReply, {
                charName,
                splitByDollar: splitEnabled,
                voiceEnabled,
                cleanAIOutput
            });

            const ttsApiKey = getSetting('ttsApiKey', '').trim();
            let voiceCount = 0;
            const ttsWarnings = [];
            const preparedBubbles = [];

            for (const seg of segments) {
                if (seg.kind === 'voice' && voiceEnabled && ttsApiKey && voiceCount < 3) {
                    voiceCount++;
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
                    } catch (e) {
                        ttsWarnings.push(e.message);
                    }
                }
                preparedBubbles.push({ kind: 'text', text: seg.text, content: seg.text });
            }

            const isStale = getMemoryEpoch(charKey) !== reqEpoch;
            const replyMsgs = [];
            if (!isStale) {
                const insChat = memDb.prepare('INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)');
                for (const b of preparedBubbles) {
                    const info = insChat.run(charKey, 'assistant', b.content, turnId);
                    replyMsgs.push({
                        id: info.lastInsertRowid,
                        role: 'assistant',
                        content: b.content,
                        turn_id: turnId,
                        kind: b.kind,
                        charLen: b.text.length
                    });
                }

                const enrichedUserMem = extractedMemo
                    ? `${baseMemorySummary}（附听觉记忆：${extractedMemo}）`
                    : baseMemorySummary;
                const joinedAiMem = segments.map(s => s.text).join('\n');

                const insMem = memDb.prepare('INSERT INTO memory_events (char_key, event_type, role, content, turn_id) VALUES (?, ?, ?, ?, ?)');
                insMem.run(charKey, 'chat', 'user', enrichedUserMem, turnId);
                insMem.run(charKey, 'chat', 'assistant', joinedAiMem, turnId);
                if (memoEngine && typeof memoEngine.onTurnCompleted === 'function') {
                    memoEngine.onTurnCompleted(charKey);
                }
            }

            console.log(`🎧 音乐片段分享完成: 《${cleanTitle}》(${rangeLabel}) | <memo>: ${extractedMemo || '(无)'}`);
            res.json({
                success: true,
                turnId,
                userMsg,
                staleDiscarded: isStale,
                replyMsgs,
                extractedMemo,
                ttsWarning: ttsWarnings.join('；'),
                memoryCount: getMemoryCount(charKey)
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: `${error.message}（提示：分享真实音乐片段需要当前模型支持 input_audio 音频理解，例如 Gemini 系列）`
            });
        }
    });

    console.log('🎵 本地音乐上传 & 60秒波形裁剪分享引擎已挂载: /api/music-pro/upload | /api/music-pro/share-clip');
};