const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { defaults, DEFAULT_SYSTEM, generate, inspect } = require('./theater-engine');

const readerOrigin = process.env.THEATER_READER_ORIGIN ? new URL(process.env.THEATER_READER_ORIGIN).origin : '';
const worksDir = path.join(__dirname, 'data', 'theater');

module.exports = function registerTheater(app, ctx) {
    const { db, vault, getSetting, getActiveCharKey, getModelName, createAIClient, renderTemplateVars } = ctx;
    const dir = worksDir;
    fs.mkdirSync(dir, { recursive: true });
    const api = express.Router();
    app.use('/api/theater', api);
    const jobs = new Map();
    const MAX_ACTIVE = 3;
    const sql = query => db.prepare(query);
    const presets = require('./presets');
    const settings = () => ({ ...defaults, ...JSON.parse(sql('SELECT value FROM theater_config WHERE id=1').get()?.value || '{}'), system:presets.getPrompt('theaterSystem'), style:presets.getPrompt('theaterStyle') });
    function requireValue(value, message, status = 400) {
        if (!value) throw Object.assign(new Error(message), { status });
        return value;
    }
    function integer(value, low, high) {
        const n = Number(value);
        requireValue(Number.isInteger(n) && n >= low && n <= high, '数字超出可用范围');
        return n;
    }
    function chars() {
        const active = getActiveCharKey();
        const rows = vault.charactersDb.prepare("SELECT 'card_' || id AS key, char_name AS name, persona FROM character_cards ORDER BY id").all();
        const current = rows.find(c => c.key === active);
        const live = { key: active, name: getSetting('charName', '连线搭子'), persona: getSetting('persona', current?.persona || '') };
        if (current) Object.assign(current, live);
        else rows.unshift(live);
        return rows;
    }
    function userFor(key) {
        const link = sql('SELECT user_id FROM theater_users WHERE char_key=?').get(key);
        const card = link && vault.usersDb.prepare('SELECT * FROM user_cards WHERE id=?').get(link.user_id);
        if (card) return { id: card.id, name: card.user_name, persona: card.user_persona, relation: card.use_quick_relation ? [card.user_relation, card.char_call_user].join(' ') : '' };
        return { id: 0, name: getSetting('userName', '我'), persona: getSetting('userPersona'), relation: getSetting('useQuickRelation') === 'true' ? [getSetting('userRelation'), getSetting('charCallUser')].join(' ') : '' };
    }
    const booksFor = ctx.worldbooks.forRole;
    const work = id => requireValue(sql('SELECT * FROM theater_works WHERE id=?').get(id), '作品不存在', 404);
    const read = row => fs.readFileSync(path.join(dir, row.filename), 'utf8');
    function erase(rows) {
        db.transaction(() => {
            for (const row of rows) {
                sql('DELETE FROM theater_works WHERE id=?').run(row.id);
            }
        })();
        for (const row of rows) {
            for (const file of [row.filename, row.id + '.json']) fs.rmSync(path.join(dir, file), { force: true });
        }
    }
    function prune() {
        const extra = sql('SELECT count(*) AS n FROM theater_works').get().n - settings().limit;
        if (extra > 0) erase(sql('SELECT id,filename FROM theater_works WHERE starred=0 ORDER BY created,rowid LIMIT ?').all(extra));
    }
    // A process interruption between the database commit and unlink may leave an orphan.
    for (const file of fs.readdirSync(dir)) {
        if (/^[a-f\d-]{36}\.(html|json)$/.test(file) && !sql('SELECT 1 FROM theater_works WHERE id=?').get(path.parse(file).name)) fs.unlinkSync(path.join(dir, file));
    }
    api.get('/state', (_, res) => {
        const characters = chars().map(c => ({ ...c, user: userFor(c.key), books: booksFor(c.key) }));
        res.json({ characters, active: getActiveCharKey(), readerOrigin, users: vault.usersDb.prepare('SELECT id,user_name FROM user_cards ORDER BY id').all(),
            templates: sql('SELECT * FROM theater_templates ORDER BY id DESC').all(), settings: settings(), model: getModelName(), defaultSystem: DEFAULT_SYSTEM });
    });
    api.put('/settings', (req, res) => {
        const b = req.body, next = { ...settings() };
        for (const key of ['model', 'system', 'style']) next[key] = String(b[key] ?? '').trim();
        for (const key of ['repair', 'history', 'inject']) next[key] = b[key] === true;
        next.count = integer(b.count, 1, 1000);
        next.timeout = integer(b.timeout, 1, 1800);
        next.limit = integer(b.limit, 1, 10000);
        const prompts = {};
        if (b.system !== undefined) prompts.theaterSystem = next.system || DEFAULT_SYSTEM;
        if (b.style !== undefined) prompts.theaterStyle = next.style;
        if (Object.keys(prompts).length) presets.updateCurrent(prompts);
        delete next.system; delete next.style;
        sql('INSERT OR REPLACE INTO theater_config VALUES (1,?)').run(JSON.stringify(next));
        prune();
        res.json(next);
    });
    api.put('/users', (req, res) => {
        const { key, id } = req.body;
        requireValue(chars().some(c => c.key === key), '角色不存在');
        if (id) {
            requireValue(vault.usersDb.prepare('SELECT id FROM user_cards WHERE id=?').get(id), '用户卡不存在');
            sql('INSERT OR REPLACE INTO theater_users VALUES (?,?)').run(key, id);
        } else sql('DELETE FROM theater_users WHERE char_key=?').run(key);
        res.json(userFor(key));
    });
    api.post('/templates', (req, res) => {
        const { id, name, prompt } = req.body;
        requireValue(name?.trim() && prompt?.trim(), '请填写模板名与提示词');
        if (id) requireValue(sql('SELECT id FROM theater_templates WHERE id=?').get(id), '模板已删除', 404);
        let title = name.trim(), suffix = 2;
        while (sql('SELECT id FROM theater_templates WHERE name=? AND id<>?').get(title, id || 0)) title = name.trim() + ' (' + suffix++ + ')';
        if (id) sql('UPDATE theater_templates SET name=?,prompt=? WHERE id=?').run(title, prompt, id);
        else sql('INSERT INTO theater_templates (name,prompt) VALUES (?,?)').run(title, prompt);
        res.json({ name: title });
    });
    api.delete('/templates/:id', (req, res) => { sql('DELETE FROM theater_templates WHERE id=?').run(req.params.id); res.sendStatus(204); });
    api.get('/works', (req, res) => {
        const term = String(req.query.q || '').trim().toLowerCase();
        const rows = sql('SELECT * FROM theater_works ORDER BY created DESC,rowid DESC').all();
        res.json(rows.filter(r => !term || r.title.toLowerCase().includes(term) || inspect(read(r)).text.toLowerCase().includes(term)));
    });
    api.get('/works/:id/html', (req, res) => {
        const row = work(req.params.id);
        res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-presentation');
        res.set('Referrer-Policy', 'no-referrer').type('html').send(read(row));
    });
    api.put('/works/:id/star', (req, res) => {
        work(req.params.id);
        sql('UPDATE theater_works SET starred=? WHERE id=?').run(req.body.starred ? 1 : 0, req.params.id);
        prune();
        res.sendStatus(204);
    });
    api.delete('/works/:id', (req, res) => { erase([work(req.params.id)]); res.sendStatus(204); });

    function chatText(raw) {
        try {
            const mm = JSON.parse(raw);
            if (mm?.__mm) return mm.text || '（媒体消息）';
        } catch {}
        return raw;
    }
    function start(input, prior, res) {
        requireValue([...jobs.values()].filter(job => !job.done).length < MAX_ACTIVE,
            '已有 3 个小剧场正在生成，等一篇完成后再试吧。', 409);
        const char = requireValue(chars().find(c => c.key === input.key), '找不到这张角色卡');
        const prompt = String(input.prompt || '').trim();
        requireValue(prompt, '请填写提示词或选择模板');
        const user = userFor(char.key);
        const cfg = settings();
        const selected = booksFor(char.key).filter(book => (input.books || []).map(String).includes(book.id));
        const parts = ['角色 · ' + char.name + '\n' + char.persona, '用户 · ' + user.name + '\n' + user.persona + '\n' + user.relation];
        let recent = [];
        if (cfg.history && vault.hasMemoryDb(char.key)) {
            const rows = vault.getMemoryDb(char.key).prepare('SELECT role,content FROM chat_messages ORDER BY id DESC LIMIT ?').all(cfg.count);
            recent = rows.slice(0, 100).map(r => chatText(r.content));
            parts.push(rows.reverse().map(r => r.role + '：' + chatText(r.content)).join('\n'));
        }
        parts.push(ctx.worldbooks.match(selected, [prompt, prior].join('\n'), recent));
        const render = s => renderTemplateVars(s, char.name, user.name);
        const label = String(input.label || '').trim() || '临时小剧场';
        const recipe = { key: char.key, books: selected.map(b => b.id), prompt, prior, label };
        const job = { id: randomUUID(), label, startedAt: Date.now(), status: '等待创作', done: false };
        jobs.set(job.id, job);
        res.status(202).json(job);
        setImmediate(async () => {
            try {
                const result = await generate({ client: createAIClient(), model: getModelName(cfg.model),
                    settings: { ...cfg, system: render(cfg.system || DEFAULT_SYSTEM), style: render(cfg.style) },
                    context: render(parts.join('\n\n')), prompt: render(prompt), prior, progress: status => { job.status = status; } });
                const filename = job.id + '.html';
                fs.writeFileSync(path.join(dir, filename), result.html, { flag: 'wx' });
                try {
                    fs.writeFileSync(path.join(dir, job.id + '.json'), JSON.stringify(recipe), { flag: 'wx' });
                    sql('INSERT INTO theater_works VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, result.title || char.name + '的小剧场', char.key, char.name, Date.now(), JSON.stringify(selected.map(b => b.name)), result.text.slice(0, 180), 0, filename);
                } catch (err) {
                    fs.rmSync(path.join(dir, filename), { force: true });
                    fs.rmSync(path.join(dir, job.id + '.json'), { force: true });
                    throw err;
                }
                job.title = result.title || char.name + '的小剧场';
                job.work = job.id;
                job.status = '已收入成品';
                prune();
                if (cfg.inject && result.text && char.key === getActiveCharKey()) {
                    const mem = vault.getMemoryDb(char.key);
                    mem.transaction(() => {
                        mem.prepare("INSERT INTO chat_messages(char_key,role,content) VALUES (?,'user',?)").run(char.key, result.text);
                        mem.prepare("INSERT INTO memory_events(char_key,event_type,role,content) VALUES (?,'chat','user',?)").run(char.key, result.text);
                    })();
                }
            } catch (err) { job.status = (job.work ? '已保存，后续处理失败：' : '生成失败：') + err.message; }
            finally {
                job.finishedAt = Date.now();
                job.done = true;
                setTimeout(() => jobs.delete(job.id), 3600000).unref();
            }
        });
    }
    api.post('/jobs', (req, res) => start(req.body, '', res));
    api.get('/jobs', (_, res) => res.json([...jobs.values()].reverse()));
    api.get('/jobs/:id', (req, res) => res.json(requireValue(jobs.get(req.params.id), '任务已过期', 404)));
    api.post('/works/:id/:action', (req, res) => {
        const row = work(req.params.id);
        const recipe = JSON.parse(fs.readFileSync(path.join(dir, row.id + '.json'), 'utf8'));
        const action = req.params.action;
        requireValue(['retry','continue'].includes(action), '无此操作', 404);
        start(recipe, action === 'continue' ? inspect(read(row)).text : recipe.prior, res);
    });
    api.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
};

// An optional dedicated reader hostname serves documents only. On single-origin
// installations keep scripts interactive while isolating the room's own storage.
module.exports.mountReader = function mountReader(app, db) {
    const host = readerOrigin && new URL(readerOrigin).host;
    app.use((req, res, next) => {
        if (host && req.headers.host === host) {
            const match = /^\/works\/([a-f0-9-]{36})\/?$/.exec(req.path);
            if (!match || !['GET', 'HEAD'].includes(req.method)) return res.sendStatus(404);
            const row = db.prepare('SELECT filename FROM theater_works WHERE id=?').get(match[1]);
            if (!row) return res.sendStatus(404);
            return res.set('Referrer-Policy', 'no-referrer').sendFile(path.join(worksDir, row.filename));
        }
        const origin = req.headers.origin;
        if ((readerOrigin && origin === readerOrigin) ||
            (origin === 'null' && req.headers['sec-fetch-site'] === 'cross-site')) return res.sendStatus(403);
        next();
    });
};
