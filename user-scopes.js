// An empty owner is the global default. A null global card explicitly selects no persona.
module.exports = function createUserScopes(users, rawSetting) {
    users.exec('CREATE TABLE IF NOT EXISTS user_scope (owner TEXT PRIMARY KEY, card_id INTEGER)');
    const fields = {activeUserId:'id', userName:'user_name', userAvatar:'avatar', userPersona:'user_persona',
        useQuickRelation:'use_quick_relation', userRelation:'user_relation', charCallUser:'char_call_user'};
    const pick = users.prepare("SELECT u.* FROM user_scope s LEFT JOIN user_cards u ON u.id=s.card_id WHERE s.owner IN (?, '') ORDER BY length(s.owner) DESC LIMIT 1");
    const bind = users.prepare('INSERT OR REPLACE INTO user_scope(owner,card_id) VALUES (?,?)');
    function value(row, key, fallback) {
        if (!row) return rawSetting(key,fallback);
        if (key === 'useQuickRelation') return String(Boolean(row[fields[key]]));
        return String(row[fields[key]] ?? fallback);
    }
    function resolve(owner) {
        const row = pick.get(owner);
        return Object.fromEntries(Object.keys(fields).map(key => [key,value(row,key,key==='userName'?'我':'')]));
    }
    // Room actions often read one field. Avoid loading the whole legacy profile for each lookup.
    const lookups = Object.fromEntries(Object.entries(fields).map(([key,column]) =>
        [key, users.prepare(`SELECT u.${column} FROM user_scope s LEFT JOIN user_cards u ON u.id=s.card_id
            WHERE s.owner IN (?, '') ORDER BY length(s.owner) DESC LIMIT 1`)]));
    function setting(owner,key,fallback) {
        return value(lookups[key].get(owner),key,fallback);
    }
    function clear(id) {
        const global = users.prepare("SELECT card_id FROM user_scope WHERE owner=''").get();
        if (global ? global.card_id === id : Number(rawSetting('activeUserId')) === id) bind.run('',null);
        users.prepare("DELETE FROM user_scope WHERE card_id=? AND owner<>''").run(id);
    }
    function assign(id, owners) {
        clear(id);
        for (const owner of owners) bind.run(owner,id);
    }
    function owners(id) {
        return users.prepare('SELECT owner FROM user_scope WHERE card_id=? ORDER BY owner').all(id).map(r=>r.owner);
    }
    function context(owner) {
        const u=resolve(owner);
        return {name:u.userName, persona:u.userPersona,
            relation:u.useQuickRelation==='true'?u.userRelation:'', callUser:u.useQuickRelation==='true'?u.charCallUser:''};
    }
    function removeRole(owner) {
        if (owner) users.prepare('DELETE FROM user_scope WHERE owner=?').run(owner);
    }
    return {resolve,setting,assign,clear,removeRole,owners,context,fields};
};
