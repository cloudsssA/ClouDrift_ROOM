// media-store.js — 零依赖双端媒体落盘大管家（自动去重 + 兼容 iOS/安卓流式音频 + 老数据自动瘦身）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav'
};

const EXT_TO_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav'
};

/**
 * 把 data:image/... 或 data:audio/... 落盘成 /uploads/前缀_哈希.后缀
 * 已经是 /uploads/ 或 http 链接或空字符串，原样返回！
 */
function persistMedia(value, prefix = 'm') {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('data:')) return value;

    const match = trimmed.match(/^data:([^;,]+)(?:;[^;,]*)*;base64,([\s\S]+)$/i);
    if (!match) return value;

    const mime = match[1].toLowerCase().trim();
    const base64Body = match[2];
    const ext = MIME_TO_EXT[mime] || (mime.startsWith('audio/') ? 'mp3' : 'jpg');

    const buffer = Buffer.from(base64Body, 'base64');
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const filename = `${prefix}_${hash}.${ext}`;
    const fullPath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, buffer);
    }
    return `/uploads/${filename}`;
}

/**
 * 给大模型识图用的反查工具：把 /uploads/xxx.jpg 临时读回 Base64 给 AI 看
 */
function toDataUrlForAI(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('/uploads/')) return value;

    const safeName = path.basename(trimmed);
    const fullPath = path.join(UPLOAD_DIR, safeName);
    if (!fs.existsSync(fullPath)) return value;

    const ext = path.extname(safeName).slice(1).toLowerCase();
    const mime = EXT_TO_MIME[ext] || 'application/octet-stream';
    const base64 = fs.readFileSync(fullPath).toString('base64');
    return `data:${mime};base64,${base64}`;
}

/**
 * 给单条历史聊天记录做懒加载瘦身（如果以前存了巨型 Base64，读取时顺手落盘并写回 SQLite）
 */
function slimChatRowIfNeeded(memDb, row) {
    if (!row || typeof row.content !== 'string' || !row.content.includes('"data:')) return row;
    try {
        const parsed = JSON.parse(row.content);
        if (!parsed || !parsed.__mm) return row;
        let changed = false;
        if (parsed.imageData && parsed.imageData.startsWith('data:')) {
            parsed.imageData = persistMedia(parsed.imageData, 'chat_img');
            changed = true;
        }
        if (parsed.audioData && parsed.audioData.startsWith('data:')) {
            parsed.audioData = persistMedia(parsed.audioData, parsed.isVoiceMsg ? 'tts' : 'chat_aud');
            changed = true;
        }
        if (changed) {
            const slimContent = JSON.stringify(parsed);
            memDb.prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(slimContent, row.id);
            return { ...row, content: slimContent };
        }
    } catch {}
    return row;
}

/**
 * 后端启动时自动迁移壁纸、头像、相框、角色卡里的老 Base64
 */
function migrateExistingBase64({ db, vault }) {
    let count = 0;
    for (const key of ['bgImage', 'charAvatar', 'userAvatar']) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row && row.value && row.value.startsWith('data:')) {
            const url = persistMedia(row.value, key);
            db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(url, key);
            count++;
        }
    }
    try {
        const widgets = db.prepare("SELECT id, image_data FROM widgets WHERE image_data LIKE 'data:%'").all();
        for (const w of widgets) {
            db.prepare('UPDATE widgets SET image_data = ? WHERE id = ?').run(persistMedia(w.image_data, 'widget'), w.id);
            count++;
        }
    } catch {}
    try {
        const chars = vault.charactersDb.prepare("SELECT id, avatar FROM character_cards WHERE avatar LIKE 'data:%'").all();
        for (const c of chars) {
            vault.charactersDb.prepare('UPDATE character_cards SET avatar = ? WHERE id = ?').run(persistMedia(c.avatar, 'char'), c.id);
            count++;
        }
        const users = vault.usersDb.prepare("SELECT id, avatar FROM user_cards WHERE avatar LIKE 'data:%'").all();
        for (const u of users) {
            vault.usersDb.prepare('UPDATE user_cards SET avatar = ? WHERE id = ?').run(persistMedia(u.avatar, 'user'), u.id);
            count++;
        }
    } catch {}
    if (count > 0) {
        console.log(`⚡ 媒体抽脂完成：已自动将 ${count} 个旧 Base64 转为秒加载静态链接！`);
    }
}

module.exports = { UPLOAD_DIR, persistMedia, toDataUrlForAI, slimChatRowIfNeeded, migrateExistingBase64 };