const { randomUUID } = require('node:crypto');
const presets = require('./presets');
const ownerSQL = "CASE WHEN json_valid(payload) THEN json_extract(payload,'$.charKey') END";

function binding(ctx) {
    const key = 'mcpOwner_' + ctx.getActiveCharKey();
    let value = ctx.getSetting(key);
    if (!value) { value = randomUUID(); ctx.saveSetting(key, value); }
    return value;
}

function guard(ctx, req, res, supplied) {
    if (supplied && supplied === binding(ctx)) return true;
    res.status(409).json({jsonrpc:'2.0',id:req.body?.id ?? null,error:{code:-32003,message:'连接未绑定当前角色。请在房间选中对应身份，从设置重新复制该身份的 MCP 配置。'}});
    return false;
}

function enqueue(ctx, idleMinutes) {
    const key = ctx.getActiveCharKey();
    const pending = ctx.db.prepare("SELECT id FROM pending_events WHERE status='waiting' AND event_type='proactive_chat' AND "+ownerSQL+"=?").get(key);
    if (pending) return pending.id;
    const prompt = presets.getPrompt('proactiveChat',{char:ctx.getSetting('charName','连线搭子'),user:ctx.getSetting('userName','我'),idleMinutes});
    return ctx.db.prepare('INSERT INTO pending_events(event_type,payload) VALUES (?,?)').run('proactive_chat',JSON.stringify({charKey:key,prompt,replyTool:'send_study_chat',instruction:'使用自己的角色人设，回复时带上此事件的 eventId。'})).lastInsertRowid;
}

function startScheduler(ctx) {
    let clock;
    const timer=setInterval(() => {
        try {
            if (ctx.getSetting('mode')!=='mcp' || ctx.getBoolSetting('soloMode',false) || !ctx.getBoolSetting('proactiveEnabled',false)) { clock=null; return; }
            const key=ctx.getActiveCharKey();
            const last=ctx.vault.hasMemoryDb(key) ? ctx.vault.getMemoryDb(key).prepare('SELECT max(id) AS id FROM chat_messages').get().id : 0;
            const min=Math.max(1,Number(ctx.getSetting('proactiveMin'))||20);
            const max=Math.max(min,Number(ctx.getSetting('proactiveMax'))||45);
            const signature=JSON.stringify([key,last,min,max]);
            if (clock?.signature!==signature) {
                const delay=min+Math.random()*(max-min);
                clock={signature,start:Date.now(),due:Date.now()+delay*60000};
            }
            if (Date.now()>=clock.due) {
                enqueue(ctx,Math.max(1,Math.round((Date.now()-clock.start)/60000)));
                clock=null;
            }
        } catch(err) { console.error('ClouDrift MCP 主动消息',err.message); }
    },10000);
    timer.unref();
}
module.exports={binding,guard,ownerSQL,enqueue,startScheduler};
