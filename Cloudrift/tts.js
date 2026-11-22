// tts.js —— 角色语音合成引擎（默认 MiniMax T2A v2，同时兼容 OpenAI 格式自定义地址 + 动作旁白正则清洗）
const DEFAULT_TTS_BASE_URL = 'https://api.minimax.chat/v1/t2a_v2';
const DEFAULT_TTS_MODEL = 'speech-02-hd';
const DEFAULT_VOICE_ID = 'male-qn-jingying';

const DEFAULT_VOICE_PROMPT = `【语音消息规则】
在「通讯」聊天中，你可以根据当下情绪与氛围自主决定是否向{{user}}发语音：
- 普通简短搭话可直接发文字；当你情绪明显波动（如生气、得意、温柔安慰、调侃、认真叮嘱）或觉得开口说更有温度时，把想用语音说的话用 <voice>...</voice> 标签包起来（例如：<voice>磨磨蹭蹭的，还不快把这页看完。</voice>）。
- <voice> 标签里只能写纯粹要说出口的口语台词，严禁包含括号动作、心理描写、旁白或颜文字。
- 如果本轮只想发纯文字，不要使用 <voice> 标签。`;

// 自动给 character_cards 表平滑补上每张角色卡专属的语音列（无需手动改 db.js）
function initVoiceSchema(coreDb) {
    const alters = [
        "ALTER TABLE character_cards ADD COLUMN voice_enabled INTEGER DEFAULT 0",
        "ALTER TABLE character_cards ADD COLUMN voice_id TEXT DEFAULT ''",
        "ALTER TABLE character_cards ADD COLUMN voice_speed REAL DEFAULT 1.0",
        "ALTER TABLE character_cards ADD COLUMN voice_prompt TEXT DEFAULT ''"
    ];
    for (const sql of alters) {
        try { coreDb.exec(sql); } catch (e) {}
    }
}

// 1. 提取回复里的所有 <voice>...</voice> 片段
function extractVoiceText(rawText) {
    const src = String(rawText || '');
    const matches = [];
    const re = /<voice>([\s\S]*?)<\/voice>/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m[1] && m[1].trim()) matches.push(m[1].trim());
    }
    return matches.join('，');
}

// 2. 剥离 <voice> 标签本身（保留文字内容作为气泡转写和纯文本记忆）
function stripVoiceTags(rawText) {
    return String(rawText || '').replace(/<\/?voice>/gi, '').trim();
}

// 3. 发给 TTS 模型前的强力正则清洗：彻底干掉（）/()/*动作*/【旁白】与特殊符号，防止社死念出旁白！
function cleanTextForTTS(rawSpoken) {
    let text = String(rawSpoken || '');
    const rules = [
        /<(thinking|think|memo)>[\s\S]*?<\/\1>/gi, // 兜底去思考/记忆块
        /<[^>]+>/g,                                // 去残余尖括号标签
        /（[^）]*）/g,                              // 去中文括号动作/旁白
        /\([^)]*\)/g,                              // 去英文括号动作/旁白
        /【[^】]*】/g,                              // 去方头括号系统/旁白
        /\[[^\]]*\]/g,                             // 去中括号标签
        /\*[^*]+\*/g,                              // 去星号 *轻笑一声* 动作描写
        /[~～]{2,}/g,                              // 压缩多余波浪号
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu // 去掉 emoji 避免读成乱码
    ];
    for (const r of rules) {
        text = text.replace(r, ' ');
    }
    return text.replace(/\s+/g, ' ').replace(/^[，。、,.!！?？\s]+/, '').trim();
}

// 4. 调用 MiniMax T2A v2（或任意自定义 OpenAI 兼容 TTS 地址）生成音频 DataURL
async function synthesizeSpeech({ text, baseURL, apiKey, groupId, model, voiceId, speed = 1.0 }) {
    const cleanText = cleanTextForTTS(text);
    if (!cleanText) return { audioData: '', spokenText: '' };

    const key = String(apiKey || '').trim();
    if (!key) throw new Error('尚未填写语音 API Key！请先在「⚙️ 设置」里填好语音密钥。');

    const rawUrl = String(baseURL || DEFAULT_TTS_BASE_URL).trim().replace(/\/+$/, '');
    const spd = Math.max(0.5, Math.min(2.0, parseFloat(speed) || 1.0));
    const finalModel = String(model || DEFAULT_TTS_MODEL).trim();
    const finalVoice = String(voiceId || DEFAULT_VOICE_ID).trim();

    const isOpenAICompat = /\/audio\/speech$/i.test(rawUrl);

    if (isOpenAICompat) {
        const resp = await fetch(rawUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: finalModel || 'tts-1',
                input: cleanText,
                voice: finalVoice || 'alloy',
                speed: spd
            })
        });
        if (!resp.ok) {
            const errTxt = (await resp.text()).slice(0, 200);
            throw new Error(`TTS 上游返回 ${resp.status}：${errTxt}`);
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = resp.headers.get('content-type')?.includes('wav') ? 'audio/wav' : 'audio/mpeg';
        return {
            audioData: `data:${mime};base64,${buf.toString('base64')}`,
            spokenText: cleanText
        };
    }

    // 默认 MiniMax T2A v2 协议
    const gid = String(groupId || '').trim();
    const endpoint = gid
        ? `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}GroupId=${encodeURIComponent(gid)}`
        : rawUrl;

    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: finalModel,
            text: cleanText,
            stream: false,
            output_format: 'hex',
            voice_setting: {
                voice_id: finalVoice,
                speed: spd,
                vol: 1.0,
                pitch: 0
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1
            }
        })
    });

    const contentType = resp.headers.get('content-type') || '';
    if (resp.ok && contentType.includes('audio/')) {
        const buf = Buffer.from(await resp.arrayBuffer());
        return { audioData: `data:audio/mp3;base64,${buf.toString('base64')}`, spokenText: cleanText };
    }

    const rawBody = await resp.text();
    if (!resp.ok) {
        throw new Error(`MiniMax 返回 ${resp.status}：${rawBody.slice(0, 220)}`);
    }

    let parsed;
    try { parsed = JSON.parse(rawBody); }
    catch { throw new Error(`语音接口返回非 JSON：${rawBody.slice(0, 160)}`); }

    if (parsed?.base_resp && parsed.base_resp.status_code !== 0) {
        throw new Error(`MiniMax 报错 (${parsed.base_resp.status_code})：${parsed.base_resp.status_msg || '未知错误'}`);
    }

    const audioField = parsed?.data?.audio;
    if (!audioField) {
        throw new Error('语音合成成功但未返回音频数据（请检查 GroupId 与 voice_id 是否匹配）');
    }

    // MiniMax 默认返回 hex 编码音频，也兼容直接返回 http 链接或 base64
    if (/^https?:\/\//i.test(audioField)) {
        return { audioData: audioField, spokenText: cleanText };
    }
    const audioBuf = /^[0-9a-fA-F]+$/.test(audioField)
        ? Buffer.from(audioField, 'hex')
        : Buffer.from(audioField, 'base64');

    return {
        audioData: `data:audio/mp3;base64,${audioBuf.toString('base64')}`,
        spokenText: cleanText
    };
}

module.exports = {
    DEFAULT_TTS_BASE_URL,
    DEFAULT_TTS_MODEL,
    DEFAULT_VOICE_ID,
    DEFAULT_VOICE_PROMPT,
    initVoiceSchema,
    extractVoiceText,
    stripVoiceTags,
    cleanTextForTTS,
    synthesizeSpeech
};