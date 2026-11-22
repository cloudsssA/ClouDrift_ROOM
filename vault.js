// vault.js —— 三大独立仓库大管家（data/characters/ + data/users/ + data/memory/<一人一库>.db + 老数据自动无损搬家）
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const CHARS_DIR = path.join(DATA_DIR, 'characters');
const USERS_DIR = path.join(DATA_DIR, 'users');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');

for (const dir of [DATA_DIR, CHARS_DIR, USERS_DIR, MEMORY_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. 🪪 角色卡独立仓库：data/characters/characters.db
const charactersDb = new Database(path.join(CHARS_DIR, 'characters.db'));
charactersDb.exec(`
    CREATE TABLE IF NOT EXISTS character_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        char_name TEXT NOT NULL,
        persona TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        ink_color TEXT DEFAULT '#1c1917',
        note_color TEXT DEFAULT '#fef08a',
        voice_enabled INTEGER DEFAULT 0,
        voice_id TEXT DEFAULT '',
        voice_speed REAL DEFAULT 1.0,
        voice_prompt TEXT DEFAULT '',
        preset_profile TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);
for (const sql of [
    "ALTER TABLE character_cards ADD COLUMN voice_enabled INTEGER DEFAULT 0",
    "ALTER TABLE character_cards ADD COLUMN voice_id TEXT DEFAULT ''",
    "ALTER TABLE character_cards ADD COLUMN voice_speed REAL DEFAULT 1.0",
    "ALTER TABLE character_cards ADD COLUMN voice_prompt TEXT DEFAULT ''",
    "ALTER TABLE character_cards ADD COLUMN preset_profile TEXT DEFAULT ''",
    "ALTER TABLE character_cards ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
]) {
    try { charactersDb.exec(sql); } catch {}
}

// 2. 👤 用户人设卡独立仓库：data/users/users.db
const usersDb = new Database(path.join(USERS_DIR, 'users.db'));
usersDb.exec(`
    CREATE TABLE IF NOT EXISTS user_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        use_quick_relation INTEGER DEFAULT 0,
        user_relation TEXT DEFAULT '',
        char_call_user TEXT DEFAULT '',
        user_persona TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// 3. 🧠 一人一库物理记忆隔离池：data/memory/<char_key>.db
const memoryDbPool = new Map();

function sanitizeCharKey(charKey) {
    const raw = String(charKey || 'default').trim();
    const safe = raw.replace(/[\\/:*?"<>|.\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    return safe || 'default';
}

function getMemoryDbPath(charKey) {
    return path.join(MEMORY_DIR, `${sanitizeCharKey(charKey)}.db`);
}

function getMemoryDbFilename(charKey) {
    return `${sanitizeCharKey(charKey)}.db`;
}

function hasMemoryDb(charKey) {
    const safe = sanitizeCharKey(charKey);
    return memoryDbPool.has(safe) || fs.existsSync(getMemoryDbPath(safe));
}

function initMemorySchema(memDb) {
    memDb.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            char_key TEXT DEFAULT '',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS memory_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            char_key TEXT DEFAULT '',
            event_type TEXT DEFAULT 'chat',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            char_key TEXT DEFAULT '',
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            note_color TEXT DEFAULT '#fef08a',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function getMemoryDb(charKey) {
    const safe = sanitizeCharKey(charKey);
    if (memoryDbPool.has(safe)) return memoryDbPool.get(safe);

    const filePath = getMemoryDbPath(safe);
    const memDb = new Database(filePath);
    initMemorySchema(memDb);
    memoryDbPool.set(safe, memDb);
    return memDb;
}

function getMemoryCount(charKey) {
    if (!hasMemoryDb(charKey)) return 0;
    const row = getMemoryDb(charKey).prepare('SELECT COUNT(*) as cnt FROM memory_events').get();
    return row ? row.cnt : 0;
}

function deleteMemoryDb(charKey) {
    const safe = sanitizeCharKey(charKey);
    if (memoryDbPool.has(safe)) {
        try { memoryDbPool.get(safe).close(); } catch {}
        memoryDbPool.delete(safe);
    }
    const base = getMemoryDbPath(safe);
    for (const suffix of ['', '-wal', '-shm']) {
        const target = `${base}${suffix}`;
        if (fs.existsSync(target)) {
            try { fs.unlinkSync(target); } catch {}
        }
    }
}

// 4. 🚚 老数据全自动无损搬家（从 study_room.db 一次性迁移，保留老表作只读备份）
function tableExists(sqliteDb, tableName) {
    const row = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return Boolean(row);
}

function migrateFromCoreDb(coreDb) {
    if (!coreDb) return;
    const flag = coreDb.prepare("SELECT value FROM settings WHERE key = 'vault_migrated_v1'").get();
    if (flag && flag.value === 'true') return;

    console.log('🚚 检测到旧版单库数据，开始向 characters / users / memory 一人一库自动无损搬家...');
    let migratedChars = 0;
    let migratedChats = 0;
    let migratedMems = 0;
    let migratedNotes = 0;

    // (1) 迁移角色卡（严格保留原 id，确保 card_1 依然认亲 card_1！）
    if (tableExists(coreDb, 'character_cards')) {
        const oldCards = coreDb.prepare('SELECT * FROM character_cards ORDER BY id ASC').all();
        const insertChar = charactersDb.prepare(`
            INSERT OR IGNORE INTO character_cards
            (id, char_name, persona, avatar, ink_color, note_color, voice_enabled, voice_id, voice_speed, voice_prompt, preset_profile)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const runTx = charactersDb.transaction((rows) => {
            for (const c of rows) {
                insertChar.run(
                    c.id,
                    c.char_name || '未命名角色',
                    c.persona || '',
                    c.avatar || '',
                    c.ink_color || '#1c1917',
                    c.note_color || '#fef08a',
                    c.voice_enabled ? 1 : 0,
                    c.voice_id || '',
                    parseFloat(c.voice_speed) || 1.0,
                    c.voice_prompt || '',
                    ''
                );
                migratedChars++;
            }
        });
        runTx(oldCards);
    }

    // 读取默认归属 key（兜底没有 char_key 的极早期记录）
    const activeRow = coreDb.prepare("SELECT value FROM settings WHERE key = 'activeCharKey'").get();
    const fallbackNameRow = coreDb.prepare("SELECT value FROM settings WHERE key = 'charName'").get();
    const fallbackKey = (activeRow && activeRow.value.trim())
        || `custom_${(fallbackNameRow && fallbackNameRow.value.trim()) || '连线搭子'}`;

    // (2) 迁移聊天记录 -> data/memory/<char_key>.db
    if (tableExists(coreDb, 'chat_messages')) {
        const oldChats = coreDb.prepare('SELECT * FROM chat_messages ORDER BY id ASC').all();
        const grouped = new Map();
        for (const row of oldChats) {
            const k = (row.char_key && String(row.char_key).trim()) || fallbackKey;
            if (!grouped.has(k)) grouped.set(k, []);
            grouped.get(k).push(row);
        }
        for (const [k, rows] of grouped.entries()) {
            const mDb = getMemoryDb(k);
            const ins = mDb.prepare('INSERT OR IGNORE INTO chat_messages (id, char_key, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
            mDb.transaction((list) => {
                for (const r of list) {
                    ins.run(r.id, k, r.role || 'user', r.content || '', r.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19));
                    migratedChats++;
                }
            })(rows);
        }
    }

    // (3) 迁移连续记忆流 -> data/memory/<char_key>.db
    if (tableExists(coreDb, 'memory_events')) {
        const oldMems = coreDb.prepare('SELECT * FROM memory_events ORDER BY id ASC').all();
        const grouped = new Map();
        for (const row of oldMems) {
            const k = (row.char_key && String(row.char_key).trim()) || fallbackKey;
            if (!grouped.has(k)) grouped.set(k, []);
            grouped.get(k).push(row);
        }
        for (const [k, rows] of grouped.entries()) {
            const mDb = getMemoryDb(k);
            const ins = mDb.prepare('INSERT OR IGNORE INTO memory_events (id, char_key, event_type, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            mDb.transaction((list) => {
                for (const r of list) {
                    ins.run(r.id, k, r.event_type || 'chat', r.role || 'user', r.content || '', r.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19));
                    migratedMems++;
                }
            })(rows);
        }
    }

    // (4) 迁移书桌便利贴 -> data/memory/<char_key>.db
    if (tableExists(coreDb, 'notes')) {
        const oldNotes = coreDb.prepare('SELECT * FROM notes ORDER BY id ASC').all();
        const grouped = new Map();
        for (const row of oldNotes) {
            const k = (row.char_key && String(row.char_key).trim()) || fallbackKey;
            if (!grouped.has(k)) grouped.set(k, []);
            grouped.get(k).push(row);
        }
        for (const [k, rows] of grouped.entries()) {
            const mDb = getMemoryDb(k);
            const ins = mDb.prepare('INSERT OR IGNORE INTO notes (id, char_key, author, content, note_color, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            mDb.transaction((list) => {
                for (const r of list) {
                    ins.run(r.id, k, r.author || 'ai', r.content || '', r.note_color || '#fef08a', r.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19));
                    migratedNotes++;
                }
            })(rows);
        }
    }

    // (5) 如果你之前已经写好了自己的用户设定，自动存成第 1 张用户人设卡！
    const existingUsers = usersDb.prepare('SELECT COUNT(*) as cnt FROM user_cards').get()?.cnt || 0;
    if (existingUsers === 0) {
        const readS = (k, fb = '') => coreDb.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || fb;
        const uName = readS('userName', '').trim();
        const uPersona = readS('userPersona', '').trim();
        const uAvatar = readS('userAvatar', '').trim();
        const uRel = readS('userRelation', '').trim();
        const uCall = readS('charCallUser', '').trim();
        const uUseQuick = readS('useQuickRelation', 'false') === 'true' ? 1 : 0;
        if ((uName && uName !== '我') || uPersona || uAvatar || uRel || uCall) {
            const info = usersDb.prepare(`
                INSERT INTO user_cards (user_name, avatar, use_quick_relation, user_relation, char_call_user, user_persona)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(uName || '我', uAvatar, uUseQuick, uRel, uCall, uPersona);
            coreDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('activeUserId', ?)").run(String(info.lastInsertRowid));
        }
    }

    coreDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vault_migrated_v1', 'true')").run();
    console.log(`✅ 分库搬家大功告成！角色卡:${migratedChars}张 | 聊天:${migratedChats}条 | 记忆:${migratedMems}条 | 便签:${migratedNotes}张`);
}

console.log(`🏛️ 独立分库引擎已就位: characters/ | users/ | memory/(一人一库)`);

module.exports = {
    CHARS_DIR,
    USERS_DIR,
    MEMORY_DIR,
    charactersDb,
    usersDb,
    sanitizeCharKey,
    getMemoryDbPath,
    getMemoryDbFilename,
    hasMemoryDb,
    getMemoryDb,
    getMemoryCount,
    deleteMemoryDb,
    migrateFromCoreDb
};