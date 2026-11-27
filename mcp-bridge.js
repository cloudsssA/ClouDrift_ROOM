// server/mcp-bridge.js —— 零依赖标准 MCP Server（支持 Streamable HTTP /mcp + Legacy SSE /mcp/sse + 实时前端推送 + 跨端记忆投影）
const crypto = require('crypto');
const { booksDb, musicDb } = require('./db');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
    name: 'ClouDrift',
    version: '1.0.0'
};

const TOOL_DEFINITIONS = [
    {
        name: 'get_study_room_status',
        description: '获取线上陪伴自习室的实时状态，包括当前连线角色、书目、近期待办清单、近期分享划线、相框画面记忆、今日摸鱼次数与待处理事件数。',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'get_character_memo_and_memory',
        description: '读取指定或当前连线角色的「动态备忘录」与「近期自习室互动记忆投影」，用于在外部框架（如 AstrBot/小手机）中实现跨端记忆同步，而不污染双方原始数据库。',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: '返回最近多少条自习室互动记忆（默认 12，最大 40）',
                    minimum: 1,
                    maximum: 40
                }
            },
            additionalProperties: false
        }
    },
    {
        name: 'get_pending_events',
        description: '在 MCP 寄生模式下，拉取自习室中等待外部 AI 处理的挂起事件（如聊天消息、切歌审批、划线批注、摸鱼抓包、专注结算）。',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'send_study_chat',
        description: '向自习室内置的「小手机通讯」抽屉发送一条来自角色的消息，并自动同步记入当前角色的独立记忆库。',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '要发送的回复正文（支持用 $ 分段）' },
                eventId: { type: 'integer', description: '可选：若在回应某条 pending_events 的 chat_message，传入其 eventId 将自动标为已处理' }
            },
            required: ['content'],
            additionalProperties: false
        }
    },
    {
        name: 'post_sticky_note',
        description: '在自习室右侧的书桌便利贴墙上贴一张来自角色的小纸条（适合日常留言、提醒休息或摸鱼抓包）。',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '便利贴正文（建议 45 字以内，简洁有手写感）' },
                eventId: { type: 'integer', description: '可选：若在回应某条挂起事件，传入其 eventId 标为已处理' }
            },
            required: ['content'],
            additionalProperties: false
        }
    },
    {
        name: 'reply_study_highlight',
        description: '为对方在共享书页里划出并分享的句子写下页边批注。',
        inputSchema: {
            type: 'object',
            properties: {
                highlightId: { type: 'integer', description: '划线 ID（来自 get_pending_events）' },
                comment: { type: 'string', description: '页边批注内容（建议 45 字以内）' },
                eventId: { type: 'integer', description: '可选：对应的 pending_events ID' }
            },
            required: ['highlightId', 'comment'],
            additionalProperties: false
        }
    },
    {
        name: 'resolve_music_request',
        description: '审批对方在留声机里发起的切歌申请（同意或驳回）。同意后自习室前端会自动切歌播放。',
        inputSchema: {
            type: 'object',
            properties: {
                eventId: { type: 'integer', description: '可选：挂起的 music_request 事件 ID' },
                approved: { type: 'boolean', description: 'true=同意切歌，false=驳回切歌' },
                reason: { type: 'string', description: '符合人设的同意或驳回理由' },
                targetSong: { type: 'string', description: '可选：目标歌曲名' }
            },
            required: ['approved', 'reason'],
            additionalProperties: false
        }
    },
    {
        name: 'trigger_room_action',
        description: '隔空操作自习室彩蛋：互动屏幕上的像素桌宠（happy 摸头蹦跳 / feed 高空投喂零食 / ball 丢弹力球 / rage 戳炸毛），或主动为对方在留声机切歌。',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['pet', 'play'], description: 'pet=互动桌宠，play=主动切歌' },
                action: { type: 'string', enum: ['happy', 'feed', 'ball', 'rage'], description: '当 type=pet 时必填' },
                songName: { type: 'string', description: '当 type=play 时必填，歌曲名关键词' }
            },
            required: ['type'],
            additionalProperties: false
        }
    }
];

module.exports = function registerMcpBridge(app, ctx) {
    const {
        db, vault,
        getSetting, saveSetting, getBoolSetting, getActiveCharKey,
        getRoomContextSummary, cleanAIOutput, formatLocalTimestamp, getMemoryCount
    } = ctx;

    const owner = require('./mcp-owner');
    owner.startScheduler(ctx);
    // 实时前端动作队列 & SSE 会话池
    const sseSessions = new Map(); // sessionId -> { res, heartbeat }
    const liveActionQueue = [];    // [{ id, type, action, query, createdAt }]
    let actionSeq = 1;
    let lastResolvedMusic = null;  // { id, approved, reason, targetSong, ts }

    function pushLiveAction(act) {
        const item = { id: actionSeq++, charKey:getActiveCharKey(), ...act, createdAt: Date.now() };
        liveActionQueue.push(item);
        if (liveActionQueue.length > 30) liveActionQueue.shift();
        return item;
    }

    function readCharacterMemoIfExists(charKey) {
        if (!vault.hasMemoryDb(charKey)) return '';
        try {
            const memDb = vault.getMemoryDb(charKey);
            const hasTbl = memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='character_memo'").get();
            if (!hasTbl) return '';
            const row = memDb.prepare('SELECT content, updated_at FROM character_memo ORDER BY id DESC LIMIT 1').get();
            return row && row.content ? String(row.content).trim() : '';
        } catch {
            return '';
        }
    }

    function checkMcpAuth(req, res) {
        const expected = getSetting('mcpToken', '').trim();
        if (!expected) return true;
        const authHeader = String(req.headers.authorization || '').trim();
        const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
        const queryToken = String(req.query?.token || req.headers['x-mcp-token'] || '').trim();
        if (bearer === expected || queryToken === expected) return true;
        res.status(401).json({
            jsonrpc: '2.0',
            id: req.body?.id ?? null,
            error: { code: -32001, message: 'Unauthorized: invalid MCP Bearer token' }
        });
        return false;
    }

    function readTodosText() {
        try {
            const raw = getSetting('deskTodosSyncJson', '').trim();
            if (!raw) return '暂无待办';
            const parsed = JSON.parse(raw);
            const arr = JSON.parse(parsed?.raw || '[]');
            if (!Array.isArray(arr) || !arr.length) return '暂无待办';
            return arr.slice(0, 8).map(t => `${t.done ? '[已完成]' : '[未完成]'} ${t.text || t.title || ''}`).join('；');
        } catch {
            return '暂无待办';
        }
    }

    function readPlaylistNames() {
        const list = ['雨夜书房白噪音 (Rainy Study)', '壁炉柴火噼啪声 (Cozy Fireplace)', '深夜咖啡馆低语 (Night Cafe)'];
        try {
            const rows = musicDb.prepare('SELECT title FROM playlist ORDER BY id ASC').all();
            for (const r of rows) {
                if (r.title && !list.includes(r.title)) list.push(r.title);
            }
        } catch {}
        return list;
    }

    // 执行 MCP 工具调用
    function executeToolCall(name, args = {}) {
        if (getActiveCharKey() !== ctx.roomKey() && !['get_pending_events','send_study_chat','get_study_room_status','get_character_memo_and_memory'].includes(name))
            throw Error('该操作仅对当前共读角色开放');
        const charKey = getActiveCharKey();
        const charName = getSetting('charName', '连线搭子');
        const userName = getSetting('userName', '我');
        const noteColor = getSetting('noteColor', '#fef08a');

        if (args.eventId) {
            const event = db.prepare("SELECT event_type,payload FROM pending_events WHERE id=? AND status='waiting' AND "+owner.ownerSQL+"=?").get(args.eventId,charKey);
            const types = {send_study_chat:['chat_message','proactive_chat','focus_decision','slack_alert'], resolve_music_request:['music_request'], reply_study_highlight:['highlight_reply']};
            if (!event || (types[name] && !types[name].includes(event.event_type))) throw Error('事件已处理或不属于本次角色操作');
            if (name==='reply_study_highlight' && Number(JSON.parse(event.payload).highlightId)!==Number(args.highlightId)) throw Error('划线与事件不匹配');
        }
        if (name === 'get_study_room_status') {
            const pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM pending_events WHERE status = 'waiting' AND "+owner.ownerSQL+"=?").get(charKey)?.cnt || 0;
            if (charKey !== ctx.roomKey()) return {content:[{type:'text',text:`通讯好友：${charName}（${charKey}），待处理事件 ${pendingCount} 条。`}]};
            const summary = getRoomContextSummary({ charKey });
            const text = `${summary}\n- 当前连线角色：${charName}（独立库：${vault.getMemoryDbFilename(charKey)}，共 ${getMemoryCount(charKey)} 条记忆）\n- 近期待办清单：${readTodosText()}\n- 留声机可用歌单：${readPlaylistNames().map(t => `《${t}》`).join('、')}\n- 待处理挂起事件：${pendingCount} 条`;
            return { content: [{ type: 'text', text }] };
        }

        if (name === 'get_character_memo_and_memory') {
            const limit = Math.max(1, Math.min(40, parseInt(args.limit, 10) || 12));
            const memo = readCharacterMemoIfExists(charKey);
            let lines = [];
            if (vault.hasMemoryDb(charKey)) {
                const rows = vault.getMemoryDb(charKey)
                    .prepare('SELECT event_type, role, content, created_at FROM memory_events ORDER BY id DESC LIMIT ?')
                    .all(limit)
                    .reverse();
                lines = rows.map(r => {
                    const who = r.role === 'assistant' ? charName : userName;
                    return `[${formatLocalTimestamp(r.created_at)}][${r.event_type}] ${who}：${String(r.content || '').slice(0, 180)}`;
                });
            }
            const memoBlock = memo
                ? `【当前角色动态备忘录（${charName}）】\n${memo}\n\n`
                : `【当前角色动态备忘录】暂无\n\n`;
            const memBlock = lines.length
                ? `【近期自习室互动投影（最新 ${lines.length} 条）】\n${lines.join('\n')}`
                : '【近期自习室互动投影】暂无记录';
            return { content: [{ type: 'text', text: `用户设定：${JSON.stringify(ctx.userScopes.context(charKey))}\n${memoBlock}${memBlock}` }] };
        }

        if (name === 'get_pending_events') {
            const rows = db.prepare("SELECT * FROM pending_events WHERE status = 'waiting' AND "+owner.ownerSQL+"=? ORDER BY id ASC LIMIT 20").all(charKey);
            const parsed = rows.map(r => {
                let payload = r.payload;
                try { payload = JSON.parse(r.payload); } catch {}
                return { id: r.id, event_type: r.event_type, payload, created_at: r.created_at };
            });
            return {
                content: [{
                    type: 'text',
                    text: parsed.length ? JSON.stringify(parsed, null, 2) : '当前没有待处理的挂起事件。'
                }]
            };
        }

        if (name === 'send_study_chat') {
            const rawText = String(args.content || '').trim();
            if (!rawText) throw new Error('content 不能为空');
            const memDb = vault.getMemoryDb(charKey);
            const parts = rawText.split(/(?<!\\)\$/g).map(p => cleanAIOutput(p.replace(/\\\$/g, '$'), charName)).filter(Boolean);
            const finalParts = parts.length ? parts : [cleanAIOutput(rawText, charName)];
            const turnId = `mcp_${Date.now()}`;
            const ids = [];

            const insChat = memDb.pragma('table_info(chat_messages)').some(c=>c.name==='turn_id') ? memDb.prepare('INSERT INTO chat_messages (char_key, role, content, turn_id) VALUES (?, ?, ?, ?)') : null;
            for (const p of finalParts) {
                try {
                    const info = insChat.run(charKey, 'assistant', p, turnId);
                    ids.push(info.lastInsertRowid);
                } catch {
                    const info = memDb.prepare('INSERT INTO chat_messages (char_key, role, content) VALUES (?, ?, ?)').run(charKey, 'assistant', p);
                    ids.push(info.lastInsertRowid);
                }
            }
            memDb.prepare('INSERT INTO memory_events (char_key, event_type, role, content) VALUES (?, ?, ?, ?)')
                .run(charKey, 'chat', 'assistant', finalParts.join('\n'));

            if (args.eventId) {
                db.prepare("UPDATE pending_events SET status = 'resolved', result = ? WHERE id = ?")
                    .run(JSON.stringify({ messageIds: ids }), args.eventId);
            }
            return { content: [{ type: 'text', text: `已成功发送 ${ids.length} 条消息到自习室小手机（${charName}）。` }] };
        }

        if (name === 'post_sticky_note') {
            const clean = cleanAIOutput(String(args.content || '').trim(), charName);
            if (!clean) throw new Error('便利贴内容不能为空');
            const memDb = vault.getMemoryDb(charKey);
            const info = memDb.prepare('INSERT INTO notes (char_key, author, content, note_color) VALUES (?, ?, ?, ?)')
                .run(charKey, 'ai', clean, noteColor);
            memDb.prepare('INSERT INTO memory_events (char_key, event_type, role, content) VALUES (?, ?, ?, ?)')
                .run(charKey, 'note_exchange', 'assistant', clean);
            if (args.eventId) {
                db.prepare("UPDATE pending_events SET status = 'resolved', result = ? WHERE id = ?")
                    .run(JSON.stringify({ noteId: info.lastInsertRowid }), args.eventId);
            }
            return { content: [{ type: 'text', text: `已在书桌贴上便利贴 (#${info.lastInsertRowid})：「${clean}」` }] };
        }

        if (name === 'reply_study_highlight') {
            const hid = parseInt(args.highlightId, 10);
            const clean = cleanAIOutput(String(args.comment || '').trim(), charName);
            if (!hid || !clean) throw new Error('highlightId 和 comment 均不能为空');
            if (!booksDb.prepare('UPDATE highlights SET ai_comment = ? WHERE id = ? AND char_key=?').run(clean, hid,charKey).changes) throw Error('未找到当前角色的划线');
            vault.getMemoryDb(charKey).prepare('INSERT INTO memory_events (char_key, event_type, role, content) VALUES (?, ?, ?, ?)')
                .run(charKey, 'highlight', 'assistant', clean);
            if (args.eventId) {
                db.prepare("UPDATE pending_events SET status = 'resolved', result = ? WHERE id = ?")
                    .run(JSON.stringify({ highlightId: hid }), args.eventId);
            }
            return { content: [{ type: 'text', text: `已为划线 #${hid} 写下页边批注：「${clean}」` }] };
        }

        if (name === 'resolve_music_request') {
            const approved = Boolean(args.approved);
            const reason = cleanAIOutput(String(args.reason || (approved ? '准了。' : '先专心看书。')), charName);
            const targetSong = String(args.targetSong || '').trim();
            if (args.eventId) {
                db.prepare("UPDATE pending_events SET status = 'resolved', result = ? WHERE id = ?")
                    .run(JSON.stringify({ approved, reason, targetSong }), args.eventId);
            }
            vault.getMemoryDb(charKey).prepare('INSERT INTO memory_events (char_key, event_type, role, content) VALUES (?, ?, ?, ?)')
                .run(charKey, 'music', 'assistant', reason);
            lastResolvedMusic = { charKey, id: actionSeq++, approved, reason, targetSong, ts: Date.now() };
            if (approved && targetSong) {
                pushLiveAction({ type: 'play', query: targetSong, reason });
            }
            return { content: [{ type: 'text', text: `已${approved ? '同意' : '驳回'}切歌申请：「${reason}」` }] };
        }

        if (name === 'trigger_room_action') {
            if (args.type === 'pet') {
                const act = ['happy', 'feed', 'ball', 'rage'].includes(args.action) ? args.action : 'happy';
                pushLiveAction({ type: 'pet', action: act });
                return { content: [{ type: 'text', text: `已向自习室前端发送桌宠互动指令：${act}` }] };
            }
            if (args.type === 'play') {
                const q = String(args.songName || '').trim();
                if (!q) throw new Error('请提供 songName');
                pushLiveAction({ type: 'play', query: q });
                return { content: [{ type: 'text', text: `已向自习室前端发送点歌指令：《${q}》` }] };
            }
            throw new Error('未知的动作类型');
        }

        throw new Error(`未知工具：${name}`);
    }

    // 标准 JSON-RPC 2.0 MCP 消息处理器
    function handleJsonRpc(msg) {
        if (!msg || typeof msg !== 'object') {
            return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
        }

        const { id, method, params } = msg;
        const isNotification = id === undefined;

        if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
            return null;
        }

        if (method === 'initialize') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                        resources: { listChanged: false }
                    },
                    serverInfo: SERVER_INFO
                }
            };
        }

        if (method === 'ping') {
            return { jsonrpc: '2.0', id, result: {} };
        }

        if (method === 'tools/list') {
            return {
                jsonrpc: '2.0',
                id,
                result: { tools: TOOL_DEFINITIONS }
            };
        }

        if (method === 'tools/call') {
            try {
                const toolName = params?.name;
                const toolArgs = params?.arguments || {};
                const result = executeToolCall(toolName, toolArgs);
                return { jsonrpc: '2.0', id, result };
            } catch (err) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: `工具调用失败：${err.message}` }]
                    }
                };
            }
        }

        if (method === 'resources/list') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    resources: [
                        {
                            uri: 'studyroom://status',
                            name: '自习室实时状态',
                            mimeType: 'text/plain',
                            description: '当前专注倒计时、书目、待办、相框与摸鱼实时快照'
                        },
                        {
                            uri: 'studyroom://memo',
                            name: '当前角色动态备忘录与记忆投影',
                            mimeType: 'text/plain',
                            description: '当前连线角色的备忘录与近期互动投影'
                        }
                    ]
                }
            };
        }

        if (method === 'resources/read') {
            const uri = String(params?.uri || '');
            if (uri === 'studyroom://status') {
                const r = executeToolCall('get_study_room_status', {});
                return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'text/plain', text: r.content[0].text }] } };
            }
            if (uri === 'studyroom://memo') {
                const r = executeToolCall('get_character_memo_and_memory', { limit: 15 });
                return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'text/plain', text: r.content[0].text }] } };
            }
            return { jsonrpc: '2.0', id, error: { code: -32002, message: `Resource not found: ${uri}` } };
        }

        if (isNotification) return null;
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` }
        };
    }

    // 1. Streamable HTTP MCP 入口（推荐：AstrBot 新版 / Cherry Studio / 通用客户端）
    app.post('/mcp', (req, res) => {
        if (!checkMcpAuth(req, res)) return;
        return ctx.withBoundOwner(req, res, req.query.owner || req.headers['x-cloudrift-owner'], () => {
            const body = req.body;
            if (Array.isArray(body)) {
                const responses = body.map(item => handleJsonRpc(item)).filter(Boolean);
                if (!responses.length) return res.status(202).end();
                return res.json(responses);
            }
            const reply = handleJsonRpc(body);
            if (!reply) return res.status(202).end();
            res.json(reply);
        });
    });

    app.get('/mcp', (req, res) => {
        if (!checkMcpAuth(req, res)) return;
        res.json({
            ok: true,
            server: SERVER_INFO,
            endpoints: { streamableHttp: '/mcp', sse: '/mcp/sse', messages: '/mcp/messages' },
            toolsCount: TOOL_DEFINITIONS.length
        });
    });

    app.delete('/mcp', (req, res) => res.status(204).end());

    // 2. Legacy SSE MCP 入口（兼容所有支持 SSE 的 AstrBot / Cherry Studio / 客户端）
    app.get('/mcp/sse', (req, res) => {
        if (!checkMcpAuth(req, res)) return;
        return ctx.withBoundOwner(req, res, req.query.owner || req.headers['x-cloudrift-owner'], () => {
            const sessionId = crypto.randomBytes(8).toString('hex');
            const tokenParam = req.query?.token ? `&token=${encodeURIComponent(req.query.token)}` : '';

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();

            res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}${tokenParam}\n\n`);

            const heartbeat = setInterval(() => {
                try { res.write(': ping\n\n'); } catch {}
            }, 25000);

            sseSessions.set(sessionId, { res, heartbeat, owner:owner.binding(ctx) });
            req.on('close', () => {
                clearInterval(heartbeat);
                sseSessions.delete(sessionId);
            });
        });
    });

    app.post('/mcp/messages', (req, res) => {
        if (!checkMcpAuth(req, res)) return;
        const sessionId = String(req.query?.sessionId || '').trim();
        const session = sseSessions.get(sessionId);
        return ctx.withBoundOwner(req, res, session?.owner, () => {
            const reply = handleJsonRpc(req.body);

            if (session && reply) {
                try {
                    session.res.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
                } catch {}
                return res.status(202).json({ accepted: true });
            }
            if (!reply) return res.status(202).end();
            res.json(reply);
        });
    });

    // 3. 前端管理界面配套接口：读写 MCP 鉴权 Token & 实时监听开关 + 前端轮询拉取外部推送！
    app.post('/api/mcp/external-identity', (req,res) => {
        const identity = String(req.body?.identity || '').trim().normalize('NFC');
        if (!identity || identity.length > 160) return res.status(400).json({message:'请填写 1 至 160 字的固定身份标识'});
        const key = 'ext_' + crypto.createHash('sha256').update(identity).digest('hex').slice(0,40);
        db.transaction(() => {
            saveSetting('activeCharKey',key);
            saveSetting('charName',identity);
            saveSetting('contactName_' + key,identity);
            saveSetting('charAvatar','');
            saveSetting('persona','');
            saveSetting('mode','mcp');
        })();
        res.json({success:true,key});
    });
    app.get('/api/mcp/bridge-config', (req, res) => {
        res.json({
            success: true,
            mcpToken: getSetting('mcpToken', '').trim(),
            mcpLiveSync: getBoolSetting('mcpLiveSync', true),
            owner:owner.binding(ctx), ownerName:getSetting('charName','连线搭子'),
            activeSseClients: sseSessions.size,
            tools: TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description }))
        });
    });

    app.post('/api/mcp/bridge-config', (req, res) => {
        if (req.body.mcpToken !== undefined) {
            saveSetting('mcpToken', String(req.body.mcpToken || '').trim());
        }
        if (req.body.mcpLiveSync !== undefined) {
            saveSetting('mcpLiveSync', req.body.mcpLiveSync ? 'true' : 'false');
        }
        res.json({
            success: true,
            mcpToken: getSetting('mcpToken', '').trim(),
            mcpLiveSync: getBoolSetting('mcpLiveSync', true)
        });
    });

    app.get('/api/mcp/live-poll', (req, res) => {
        const charKey = getActiveCharKey();
        const sinceActionId = parseInt(req.query?.sinceActionId, 10) || 0;
        let lastChatId = 0;
        let lastNoteId = 0;

        if (vault.hasMemoryDb(charKey)) {
            const memDb = vault.getMemoryDb(charKey);
            lastChatId = memDb.prepare('SELECT COALESCE(MAX(id), 0) as m FROM chat_messages').get()?.m || 0;
            lastNoteId = memDb.prepare('SELECT COALESCE(MAX(id), 0) as m FROM notes').get()?.m || 0;
        }
        const pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM pending_events WHERE status = 'waiting' AND "+owner.ownerSQL+"=?").get(charKey)?.cnt || 0;
        const newActions = liveActionQueue.filter(a => a.charKey===charKey && a.id > sinceActionId);

        res.json({
            success: true,
            activeCharKey: charKey,
            lastChatId,
            lastNoteId,
            pendingCount,
            latestActionId: actionSeq - 1,
            newActions,
            lastResolvedMusic:lastResolvedMusic?.charKey===charKey ? lastResolvedMusic : null
        });
    });

    console.log(`🔌 标准 MCP Server 已就位: POST /mcp (HTTP) | GET /mcp/sse (SSE) | 共 ${TOOL_DEFINITIONS.length} 项工具`);
};