// Use the actual vault filenames as archive IDs, including older custom identities.
const fs = require('node:fs');

module.exports = function mountContacts(app, vault, getActiveCharKey, getSetting, db, userScopes) {
    db.exec('CREATE TABLE IF NOT EXISTS hidden_contacts (owner TEXT PRIMARY KEY)');
    function hide(key) {
        db.prepare('INSERT OR IGNORE INTO hidden_contacts(owner) VALUES (?)').run(key);
    }
    function visibleKeys() {
        const hidden = new Set(db.prepare('SELECT owner FROM hidden_contacts').all().map(r=>r.owner));
        return keys().filter(k=>!hidden.has(k));
    }
    function preview(key) {
        if (!vault.hasMemoryDb(key)) return '';
        const row = vault.getMemoryDb(key).prepare("SELECT substr(content,1,200) AS head, id FROM chat_messages WHERE role IN ('assistant','user') ORDER BY id DESC LIMIT 1").get();
        if (!row) return '';
        if (row.head.trimStart().startsWith('{')) {
            const media = vault.getMemoryDb(key).prepare("SELECT CASE WHEN json_valid(content) THEN json_extract(content,'$.__mm') END AS mm, CASE WHEN json_valid(content) THEN substr(json_extract(content,'$.text'),1,200) END AS text, CASE WHEN json_valid(content) THEN length(json_extract(content,'$.imageData')) END AS image FROM chat_messages WHERE id=?").get(row.id);
            if (media.mm) return media.text || (media.image?'[图片]':'[语音]');
        }
        return row.head.replace(/\s+/g,' ').trim();
    }
    const fields = {charName:'char_name', persona:'persona', charAvatar:'avatar', voiceId:'voice_id',
        voiceSpeed:'voice_speed', voicePrompt:'voice_prompt', voiceEnabled:'voice_enabled', presetProfile:'preset_profile'};
    function snapshot() {
        return Object.fromEntries(Object.keys(fields).map(k => [k,getSetting(k)]));
    }
    function remember() {
        db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)')
            .run('contactProfile_' + getActiveCharKey(), JSON.stringify(snapshot()));
    }
    function profile(key) {
        if (key === getActiveCharKey()) return {...snapshot(), activeCharKey:key};
        const card = /^card_(\d+)$/.exec(key);
        const row = card && vault.charactersDb.prepare('SELECT * FROM character_cards WHERE id=?').get(card[1]);
        const saved = JSON.parse(getSetting('contactProfile_' + key,'{}'));
        const result = {activeCharKey:key};
        for (const [field,column] of Object.entries(fields))
            result[field] = row ? String(field === 'voiceEnabled' ? Boolean(row[column]) : row[column] ?? '') : saved[field] || '';
        result.charName ||= name(key);
        return result;
    }
    function name(key) {
        if (!key || key === 'default') return '早期角色';
        const card = /^card_(\d+)$/.exec(key);
        if (card) return vault.charactersDb.prepare('SELECT char_name FROM character_cards WHERE id=?').get(card[1])?.char_name || '角色卡 #' + card[1];
        if (key === getActiveCharKey()) return getSetting('charName', 'TA');
        if (key.startsWith('custom_')) return key.slice(7);
        return getSetting('contactName_' + key, '') || (key.startsWith('ext_') ? '外部角色 ' + key.slice(4,12) : key);
    }
    function keys() {
        const files = fs.readdirSync(vault.MEMORY_DIR, {withFileTypes:true})
            .filter(f => f.isFile() && f.name.endsWith('.db')).map(f => f.name.slice(0,-3));
        const cards = vault.charactersDb.prepare('SELECT id FROM character_cards ORDER BY id').all();
        const known = [getActiveCharKey(), ...cards.map(c => 'card_' + c.id),
            ...db.prepare("SELECT substr(key,16) AS id FROM settings WHERE key GLOB 'contactProfile_*' UNION SELECT substr(key,10) FROM settings WHERE key GLOB 'mcpOwner_*' UNION SELECT substr(key,13) FROM settings WHERE key GLOB 'contactName_*'").all().map(r=>r.id)];
        const filenames = new Set(known.map(k=>vault.sanitizeCharKey(k)));
        return [...new Set([...known,...files.filter(k=>!filenames.has(k))])];
    }
    app.get('/api/contacts', (req,res) => {
        res.json(visibleKeys().map(key => {
            const {charName, charAvatar} = profile(key);
            const user = userScopes.resolve(key);
            const card = /^card_(\d+)$/.exec(key);
            const removable = !(card && vault.charactersDb.prepare('SELECT id FROM character_cards WHERE id=?').get(card[1]));
            return {key, name:charName || name(key), avatar:charAvatar, preview:preview(key), removable,
                userName:user.userName, userAvatar:user.userAvatar};
        }));
    });
    app.delete('/api/contacts/:key', (req,res) => {
        const key = req.params.key;
        if (!keys().includes(key)) return res.sendStatus(404);
        const card = /^card_(\d+)$/.exec(key);
        if (card && vault.charactersDb.prepare('SELECT id FROM character_cards WHERE id=?').get(card[1])) return res.sendStatus(409);
        hide(key);
        res.sendStatus(204);
    });
    app.get('/api/contacts/:key/:section', (req,res) => {
        const {key,section} = req.params;
        if (!keys().includes(key) || !['chat','memory'].includes(section)) return res.sendStatus(404);
        if (!vault.hasMemoryDb(key)) return res.json([]);
        const before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(before) || before < 1) return res.sendStatus(400);
        const table = section === 'chat' ? 'chat_messages' : 'memory_events';
        res.json(vault.getMemoryDb(key).prepare('SELECT * FROM '+table+' WHERE id < ? ORDER BY id DESC LIMIT 50').all(before));
    });
    app.get('/api/desk/notes', (req,res) => {
        const data = [];
        for (const key of keys()) {
            if (!vault.hasMemoryDb(key)) continue;
            const ownerName = name(key);
            for (const row of vault.getMemoryDb(key).prepare('SELECT * FROM notes ORDER BY id DESC').all())
                data.push({...row, owner:key, ownerName});
        }
        data.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id-a.id || a.owner.localeCompare(b.owner));
        res.json({data});
    });
    app.delete('/api/desk/notes/:owner/:id', (req,res) => {
        const {owner,id}=req.params;
        if (!keys().includes(owner) || !vault.hasMemoryDb(owner)) return res.sendStatus(404);
        const result=vault.getMemoryDb(owner).prepare('DELETE FROM notes WHERE id=?').run(id);
        res.sendStatus(result.changes ? 204 : 404);
    });
    return {name, keys, profile, remember, hide};
};
