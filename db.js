// db.js —— 模块化多库存储：核心房间库 + data/library/books.db + data/music/playlist.db
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const libraryDir = path.join(dataDir, 'library');
const musicDir = path.join(dataDir, 'music');

for (const dir of [dataDir, libraryDir, musicDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 兼容极早期根目录的 data.db
const coreDbPath = path.join(dataDir, 'study_room.db');
const legacyDbPath = path.join(__dirname, 'data.db');
if (fs.existsSync(legacyDbPath) && !fs.existsSync(coreDbPath)) {
    try {
        fs.renameSync(legacyDbPath, coreDbPath);
        console.log('📦 已自动将旧 data.db 迁移至 data/study_room.db');
    } catch (e) {}
}

const booksDbPath = path.join(libraryDir, 'books.db');
const musicDbPath = path.join(musicDir, 'playlist.db');

const coreDb = new Database(coreDbPath);
const booksDb = new Database(booksDbPath);
const musicDb = new Database(musicDbPath);

// 1. 核心房间库（设置 / 角色卡 / 聊天 / 记忆 / 便利贴 / 相框 / 专注记录）
coreDb.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    char_key TEXT DEFAULT 'default',
    author TEXT DEFAULT 'ai',
    content TEXT NOT NULL,
    note_color TEXT DEFAULT '#fef08a',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_data TEXT NOT NULL,
    caption TEXT DEFAULT '',
    visible_to_ai INTEGER DEFAULT 0,
    ai_memo TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS character_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    char_name TEXT NOT NULL,
    persona TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    ink_color TEXT DEFAULT '#1c1917',
    note_color TEXT DEFAULT '#fef08a',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    char_key TEXT DEFAULT 'default',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    char_key TEXT DEFAULT 'default',
    event_type TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pending_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 平滑补列（核心库）
const coreAlters = [
    "ALTER TABLE character_cards ADD COLUMN avatar TEXT DEFAULT ''",
    "ALTER TABLE chat_messages ADD COLUMN char_key TEXT DEFAULT 'default'",
    "ALTER TABLE memory_events ADD COLUMN char_key TEXT DEFAULT 'default'",
    "ALTER TABLE notes ADD COLUMN char_key TEXT DEFAULT 'default'",
    "ALTER TABLE notes ADD COLUMN author TEXT DEFAULT 'ai'",
    "ALTER TABLE widgets ADD COLUMN visible_to_ai INTEGER DEFAULT 0",
    "ALTER TABLE widgets ADD COLUMN ai_memo TEXT DEFAULT ''"
];
for (const sql of coreAlters) {
    try { coreDb.exec(sql); } catch (e) {}
}

// 2. 独立书架库（data/library/books.db）
booksDb.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    saved_to_shelf INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER,
    char_key TEXT DEFAULT 'default',
    text_content TEXT NOT NULL,
    user_note TEXT DEFAULT '',
    is_shared INTEGER DEFAULT 1,
    ai_comment TEXT,
    ink_color TEXT DEFAULT '#1c1917',
    status TEXT DEFAULT 'unlocked',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
  );
`);
try { booksDb.exec("ALTER TABLE books ADD COLUMN saved_to_shelf INTEGER DEFAULT 1"); } catch (e) {}

// 3. 独立歌单库（data/music/playlist.db）
musicDb.exec(`
  CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    is_builtin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 4. 自动无损迁移：若旧 study_room.db 里有 books / highlights / playlist，自动搬家至独立库
function tableExists(database, tableName) {
    return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

try {
    const newBookCnt = booksDb.prepare('SELECT COUNT(*) as cnt FROM books').get().cnt;
    if (newBookCnt === 0 && tableExists(coreDb, 'books')) {
        const oldBooks = coreDb.prepare('SELECT * FROM books ORDER BY id ASC').all();
        if (oldBooks.length) {
            const insBook = booksDb.prepare('INSERT INTO books (id, title, content, saved_to_shelf, created_at) VALUES (?, ?, ?, 1, ?)');
            for (const b of oldBooks) insBook.run(b.id, b.title, b.content, b.created_at || new Date().toISOString());
            console.log(`📚 已无损迁移 ${oldBooks.length} 本旧书至 data/library/books.db`);
        }
    }
    const newHlCnt = booksDb.prepare('SELECT COUNT(*) as cnt FROM highlights').get().cnt;
    if (newHlCnt === 0 && tableExists(coreDb, 'highlights')) {
        const oldHls = coreDb.prepare('SELECT * FROM highlights ORDER BY id ASC').all();
        if (oldHls.length) {
            const insHl = booksDb.prepare(
                'INSERT INTO highlights (id, book_id, char_key, text_content, user_note, is_shared, ai_comment, ink_color, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            for (const h of oldHls) {
                insHl.run(
                    h.id, h.book_id, h.char_key || 'default', h.text_content, h.user_note || '',
                    h.is_shared === 0 ? 0 : 1, h.ai_comment || '', h.ink_color || '#1c1917',
                    h.status || 'unlocked', h.created_at || new Date().toISOString()
                );
            }
            console.log(`✒️ 已无损迁移 ${oldHls.length} 条旧批注至 data/library/books.db`);
        }
    }
    const newSongCnt = musicDb.prepare('SELECT COUNT(*) as cnt FROM playlist').get().cnt;
    if (newSongCnt === 0 && tableExists(coreDb, 'playlist')) {
        const oldSongs = coreDb.prepare('SELECT * FROM playlist ORDER BY id ASC').all();
        if (oldSongs.length) {
            const insSong = musicDb.prepare('INSERT INTO playlist (id, title, url, is_builtin) VALUES (?, ?, ?, ?)');
            for (const s of oldSongs) insSong.run(s.id, s.title, s.url, s.is_builtin ? 1 : 0);
            console.log(`💿 已无损迁移 ${oldSongs.length} 首旧歌单至 data/music/playlist.db`);
        }
    }
} catch (e) {
    console.warn('⚠️ 独立库数据迁移跳过:', e.message);
}

// 初始化默认角色分区 key
try {
    const curNameRow = coreDb.prepare("SELECT value FROM settings WHERE key = 'charName'").get();
    const curKeyRow = coreDb.prepare("SELECT value FROM settings WHERE key = 'activeCharKey'").get();
    const fallbackKey = (curKeyRow && curKeyRow.value) || (curNameRow && curNameRow.value ? `custom_${curNameRow.value}` : 'custom_连线搭子');
    if (!curKeyRow) {
        coreDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('activeCharKey', ?)").run(fallbackKey);
    }
    coreDb.prepare("UPDATE chat_messages SET char_key = ? WHERE char_key IS NULL OR char_key = 'default'").run(fallbackKey);
    coreDb.prepare("UPDATE memory_events SET char_key = ? WHERE char_key IS NULL OR char_key = 'default'").run(fallbackKey);
    coreDb.prepare("UPDATE notes SET char_key = ? WHERE char_key IS NULL OR char_key = 'default'").run(fallbackKey);
} catch (e) {}

console.log(`🚀 数据库群就绪:\n  - 核心库: ${coreDbPath}\n  - 书架库: ${booksDbPath}\n  - 歌单库: ${musicDbPath}`);

coreDb.exec(`
  CREATE TABLE IF NOT EXISTS theater_works (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, char_key TEXT NOT NULL, char_name TEXT NOT NULL,
    created INTEGER NOT NULL, books TEXT NOT NULL, summary TEXT NOT NULL, starred INTEGER DEFAULT 0,
    filename TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS theater_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS theater_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS theater_books (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS theater_users (char_key TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
`);

module.exports = { db: coreDb, coreDb, booksDb, musicDb };