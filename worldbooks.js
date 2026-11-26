const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

module.exports = function registerWorldbooks(app, db) {
    const dir = path.join(__dirname, 'data', 'worldbooks');
    fs.mkdirSync(dir, { recursive: true });
    const file = id => path.join(dir, id + '.json');
    const books = new Map();
    function save(book) {
        const tmp = file(book.id) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(book, null, 2));
        fs.renameSync(tmp, file(book.id));
        books.set(book.id, book);
    }
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
        const book = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        books.set(book.id, book);
    }
    const migrated = 'worldbooks_import_v1';
    if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get(migrated)) {
        for (const old of db.prepare('SELECT * FROM theater_books').all()) {
            const id = String(old.id);
            if (!books.has(id)) save({ id, name:old.name, global:!old.scope, roles:old.scope ? [old.scope] : [],
                entries:[{ name:old.name, mode:'always', keys:[], content:old.content }], version:1 });
        }
        db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(migrated, '1');
    }
    const list = () => [...books.values()];
    const forRole = key => list().filter(b => b.global || b.roles.includes(key));
    function match(selected, text, recent = []) {
        const output = [];
        for (const book of selected.filter(b => b.enabled !== false)) {
            let scan = [text, ...recent.slice(0, book.depth ?? 5)].join('\n').toLowerCase();
            const seen = new Set();
            const rounds = book.recursive ? 1 + (book.layers ?? 2) : 1;
            for (let round = 0; round < rounds; round++) {
                const hits = book.entries.slice().sort((a,b)=>(a.order??100)-(b.order??100)).filter(e => !seen.has(e) && (e.mode === 'always' ||
                    (e.mode === 'keyword' && e.keys.some(k => scan.includes(k.toLowerCase())))));
                if (!hits.length) break;
                for (const e of hits) {
                    seen.add(e);
                    output.push('【世界书 · ' + book.name + ' / ' + e.name + '】\n' + e.content);
                }
                scan = hits.map(e => e.content).join('\n').toLowerCase();
            }
        }
        return output.join('\n');
    }
    app.get('/api/worldbooks', (_, res) => res.json(list()));
    app.post('/api/worldbooks', (req,res) => {
        const {id,name,entries,version,global} = req.body;
        const old = books.get(id);
        if (id && (!old || version !== old.version)) return res.status(409).send('世界书已变更，请重新打开');
        if (!name?.trim() || !Array.isArray(entries) || !entries.length || entries.some(e => !e.content?.trim() ||
            !['always','keyword','off'].includes(e.mode) || !Array.isArray(e.keys) || e.keys.some(k => typeof k !== 'string' || !k.trim()) ||
            (e.mode === 'keyword' && !e.keys.length))) return res.status(400).send('请填写书名、条目正文与触发关键词');
        const depth = req.body.depth ?? old?.depth ?? 5, layers = req.body.layers ?? old?.layers ?? 2;
        if (!Number.isInteger(depth) || depth < 0 || depth > 100 || !Number.isInteger(layers) || layers < 0 || layers > 8) return res.status(400).send('扫描深度为 0–100，递归层数为 0–8');
        const book = { enabled:req.body.enabled ?? old?.enabled ?? true, recursive:req.body.recursive ?? old?.recursive ?? false, depth, layers, id:old?.id || randomUUID(), name:name.trim(), global:global === true, roles:old?.roles || [],
            entries:entries.map(e => ({order:Math.max(0,Math.min(9999, Number.isFinite(Number(e.order)) ? Number(e.order) : 100)),name:String(e.name || '设定'),content:e.content.trim(),mode:e.mode,keys:e.keys.map(k => k.trim())})), version:(old?.version || 0)+1 };
        save(book); res.json(book);
    });
    app.put('/api/worldbooks/:id/binding', (req,res) => {
        const book = books.get(req.params.id), key = req.body.key;
        if (!book || typeof key !== 'string' || !key) return res.status(400).send('角色或书籍不存在');
        const roles = new Set(book.roles);
        if (req.body.enabled) roles.add(key); else roles.delete(key);
        save({...book, roles:[...roles], version:book.version+1}); res.sendStatus(204);
    });
    app.delete('/api/worldbooks/:id', (req,res) => {
        const b = books.get(req.params.id);
        if (b && Number(req.query.version) !== b.version) return res.status(409).send('世界书已变更，请重新打开');
        if (b) { fs.unlinkSync(file(b.id)); books.delete(b.id); }
        res.sendStatus(204);
    });
    return { forRole, match };
};
