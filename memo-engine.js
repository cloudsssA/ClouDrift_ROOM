// server/memo-engine.js —— 统一上下文窗口引擎 + 对话备忘录维护引擎（一人一库物理隔离 + 满值批量抛弃 + 独立总结模型）
const MAX_CONTEXT_ROUNDS_CAP = 200;

const DEFAULT_MEMO_PROMPT = `角色: "对话备忘录维护引擎"
核心任务: "基于输入的时间锚点、现有备忘录与最新对话上下文，以绝对客观、第三人称视角，更新并生成结构化备忘录。"
处理逻辑与规则:
  1_条目更新逻辑:
- 状态变更:
        已解决/已完成/已过时: 在后面用括号标注（下次更新备忘录会删除该项），并在下次更新时删除对应条目。
        信息变更/状态更新: 使用最新事实完全覆盖旧条目。
        未完成待办/未到期计划: 完整保留，不得随意简化或遗漏。
        新增信息: 归纳提炼后作为新编号条目追加。
        无有效新信息: 完整继承现有备忘录中未过期的内容。
- 事实依据: 仅记录明确提及或直接推导的客观事实，严禁任何主观猜测、评价、情感修饰或虚构。
  2_时间标准化规范:
- 条目内部时间: 涉及相对时间（如"明天"、"三天后"、"下周一"）时，必须以{current_time}为基准计算并统一转换为"MM月DD日"绝对日期格式。
- 末尾更新时间: 备忘录最后一行必须输出"更新时间：YYYY年MM月DD日 HH:mm"，取值为{current_time}。
  3_排序优先级（按重要性降序）:
1. {{char}}与{{user}}当前/预期临时状态或情绪
2. 重要约定与特殊事件
3. 未完成的约定与待办事项
4. 独属于{{char}}和{{user}}的小秘密，例如{{char}}对{{user}}某行为的偏好或{{user}}对{{char}}的某特殊昵称，以及其他不太日常的甜蜜回忆，例如给对方的备注等
5. 近期与长期计划/日程安排
6. 短期与长期偏好变化
7. {{user}}的新技能或提到的喜好、爱好、喜爱的事物，人设卡中不包含的{{user}}的生活小细节习惯等，例如明确表示喜欢的角色/爱看的电影类型/已看过的电影等
8. {{char}}提到自己喜爱的事物或偏好或其他细节，例如喜欢的颜色/MBTI等等
  4_语言与句式规范:
- 采用第三人称极简句式，剔除冗余修饰词。
- 条目采用"编号. 内容"的单层列表格式。
- 备忘录总字数请严格控制在 {max_output_chars} 字以内，若超长请优先精简低优先级旧条目。
输出约束:
- 严禁输出任何开场白、解释、注释、Markdown代码块标记或思考过程，只直接输出编号列表和末尾更新时间。
- 严禁将<memories>的内容也加入到备忘录里，备忘录不是记忆。`;

const initializedDbs = new WeakSet();
const updatingChars = new Set();

function formatMemoTime(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ensureMemoTable(memDb) {
    if (!memDb || initializedDbs.has(memDb)) return;
    memDb.exec(`
        CREATE TABLE IF NOT EXISTS character_memo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL DEFAULT '',
            turns_since_update INTEGER NOT NULL DEFAULT 0,
            last_event_id INTEGER NOT NULL DEFAULT 0,
            window_start_id INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT ''
        )
    `);
    const existing = memDb.prepare('SELECT id FROM character_memo ORDER BY id DESC LIMIT 1').get();
    if (!existing) {
        memDb.prepare(
            "INSERT INTO character_memo (content, turns_since_update, last_event_id, window_start_id, updated_at) VALUES ('', 0, 0, 0, '')"
        ).run();
    }
    initializedDbs.add(memDb);
}

function cleanMemoOutput(raw) {
    let text = String(raw || '');
    text = text.replace(/<(thinking|think)>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<\/?(thinking|think)>/gi, '');
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '');
    text = text.replace(/^输出\s*[:：]\s*\n?/i, '');
    return text.trim();
}

module.exports = function registerMemoEngine(app, ctx) {
    const {
        vault,
        getSetting, saveSetting, getBoolSetting, getActiveCharKey,
        createAIClient, getModelName, formatLocalTimestamp,
        renderTemplateVars, cleanAIOutput
    } = ctx;

    function getConfig() {
        const parseIntClamp = (key, def, min, max) => {
            const raw = parseInt(getSetting(key, String(def)), 10);
            return isNaN(raw) ? def : Math.max(min, Math.min(max, raw));
        };

        // 统一真源：优先读 memoMaxContextRounds；仅在首次迁移且尚未设置时，从旧 contextLimit（按条）折算为轮
        let maxContextRounds;
        const rawRounds = getSetting('memoMaxContextRounds', '').trim();
        if (rawRounds !== '' && !isNaN(parseInt(rawRounds, 10))) {
            maxContextRounds = Math.max(0, Math.min(MAX_CONTEXT_ROUNDS_CAP, parseInt(rawRounds, 10)));
        } else {
            const legacyMsgs = parseInt(getSetting('contextLimit', ''), 10);
            const fallbackRounds = !isNaN(legacyMsgs) ? Math.ceil(legacyMsgs / 2) : 40;
            maxContextRounds = Math.max(0, Math.min(MAX_CONTEXT_ROUNDS_CAP, fallbackRounds));
        }

        const dropCap = Math.max(1, maxContextRounds || 1);
        const dropRounds = Math.min(dropCap, parseIntClamp('memoDropRounds', 10, 1, MAX_CONTEXT_ROUNDS_CAP));

        return {
            memoEnabled: getBoolSetting('memoEnabled', false),
            batchEvictEnabled: getBoolSetting('memoBatchEvictEnabled', false),
            maxContextRounds,
            maxContextMsgs: maxContextRounds * 2,
            maxContextRoundsCap: MAX_CONTEXT_ROUNDS_CAP,
            dropRounds,
            updateEveryRounds: parseIntClamp('memoUpdateEveryRounds', 80, 1, 300),
            maxFeedChars: parseIntClamp('memoMaxFeedChars', 6000, 500, 30000),
            maxOutputChars: parseIntClamp('memoMaxOutputChars', 800, 120, 4000),
            memoModel: getSetting('memoModel', '').trim(),
            memoBaseURL: getSetting('memoBaseURL', '').trim(),
            memoApiKey: getSetting('memoApiKey', '').trim(),
            memoPrompt: getSetting('memoPrompt', '').trim() || DEFAULT_MEMO_PROMPT
        };
    }

    function saveConfig(body = {}) {
        if (body.memoEnabled !== undefined) saveSetting('memoEnabled', body.memoEnabled ? 'true' : 'false');
        if (body.batchEvictEnabled !== undefined) saveSetting('memoBatchEvictEnabled', body.batchEvictEnabled ? 'true' : 'false');

        const cur = getConfig();
        let maxR = cur.maxContextRounds;
        if (body.maxContextRounds !== undefined) {
            const n = parseInt(body.maxContextRounds, 10);
            if (!isNaN(n)) {
                maxR = Math.max(0, Math.min(MAX_CONTEXT_ROUNDS_CAP, n));
                saveSetting('memoMaxContextRounds', maxR);
                // 同步镜像一份换算后的条数，防止任何旧读路径显示错乱
                saveSetting('contextLimit', maxR * 2);
            }
        }
        const dropCap = Math.max(1, maxR || 1);
        if (body.dropRounds !== undefined) {
            const n = parseInt(body.dropRounds, 10);
            if (!isNaN(n)) {
                saveSetting('memoDropRounds', Math.max(1, Math.min(dropCap, n)));
            }
        } else if (cur.dropRounds > dropCap) {
            saveSetting('memoDropRounds', dropCap);
        }

        if (body.updateEveryRounds !== undefined) {
            const n = parseInt(body.updateEveryRounds, 10);
            if (!isNaN(n)) saveSetting('memoUpdateEveryRounds', Math.max(1, Math.min(300, n)));
        }
        if (body.maxFeedChars !== undefined) {
            const n = parseInt(body.maxFeedChars, 10);
            if (!isNaN(n)) saveSetting('memoMaxFeedChars', Math.max(500, Math.min(30000, n)));
        }
        if (body.maxOutputChars !== undefined) {
            const n = parseInt(body.maxOutputChars, 10);
            if (!isNaN(n)) saveSetting('memoMaxOutputChars', Math.max(120, Math.min(4000, n)));
        }
        if (body.memoModel !== undefined) saveSetting('memoModel', String(body.memoModel || '').trim());
        if (body.memoBaseURL !== undefined) saveSetting('memoBaseURL', String(body.memoBaseURL || '').trim());
        if (body.memoApiKey !== undefined) saveSetting('memoApiKey', String(body.memoApiKey || '').trim());
        if (body.memoPrompt !== undefined) {
            const p = String(body.memoPrompt || '').trim();
            saveSetting('memoPrompt', p || DEFAULT_MEMO_PROMPT);
        }
        return getConfig();
    }

    function getCharState(charKey) {
        const memDb = vault.getMemoryDb(charKey);
        ensureMemoTable(memDb);
        const row = memDb.prepare('SELECT * FROM character_memo ORDER BY id DESC LIMIT 1').get();
        const maxMemId = memDb.prepare('SELECT COALESCE(MAX(id), 0) as m FROM memory_events').get()?.m || 0;

        // 若记忆库被清空或删除了最新条目，自动校正水位线防止卡死
        let winId = Number(row?.window_start_id) || 0;
        let lastEvtId = Number(row?.last_event_id) || 0;
        if (winId > maxMemId || lastEvtId > maxMemId) {
            winId = Math.min(winId, maxMemId);
            lastEvtId = Math.min(lastEvtId, maxMemId);
            memDb.prepare('UPDATE character_memo SET window_start_id = ?, last_event_id = ? WHERE id = ?')
                .run(winId, lastEvtId, row.id);
        }

        const activeCount = memDb.prepare('SELECT COUNT(*) as c FROM memory_events WHERE id > ?').get(winId)?.c || 0;
        return {
            rowId: row.id,
            content: String(row.content || ''),
            turnsSinceUpdate: Number(row.turns_since_update) || 0,
            lastEventId: lastEvtId,
            windowStartId: winId,
            updatedAt: String(row.updated_at || ''),
            activeMsgCount: activeCount,
            isUpdating: updatingChars.has(charKey)
        };
    }

    // 清空角色全部记忆时同步重置备忘录与水位线，杜绝前世记忆泄漏
    function resetCharMemo(charKey) {
        if (!vault.hasMemoryDb(charKey)) return;
        const memDb = vault.getMemoryDb(charKey);
        ensureMemoTable(memDb);
        memDb.prepare(
            "UPDATE character_memo SET content = '', turns_since_update = 0, last_event_id = 0, window_start_id = 0, updated_at = ''"
        ).run();
    }

    // 只读快照：100% 真实反映当前窗口模式、水位线与生效 ID 集合（绝不产生写副作用）
    function getWindowSnapshot(charKey) {
        const cfg = getConfig();
        const maxMsgs = cfg.maxContextRounds * 2;
        const hasDb = vault.hasMemoryDb(charKey);
        const st = hasDb
            ? getCharState(charKey)
            : { content: '', turnsSinceUpdate: 0, lastEventId: 0, windowStartId: 0, updatedAt: '', activeMsgCount: 0, isUpdating: false };

        const activeIds = new Set();
        let willEvictNextTurn = false;

        if (hasDb && maxMsgs > 0) {
            const memDb = vault.getMemoryDb(charKey);
            if (cfg.batchEvictEnabled) {
                const rows = memDb.prepare(
                    'SELECT id FROM memory_events WHERE id > ? ORDER BY id ASC'
                ).all(st.windowStartId);
                for (const r of rows) activeIds.add(r.id);
                willEvictNextTurn = rows.length > maxMsgs;
            } else {
                const rows = memDb.prepare(
                    'SELECT id FROM memory_events ORDER BY id DESC LIMIT ?'
                ).all(maxMsgs);
                for (const r of rows) activeIds.add(r.id);
            }
        }

        return {
            config: cfg,
            state: st,
            activeIds,
            windowInfo: {
                mode: cfg.batchEvictEnabled ? 'batch_evict' : 'sliding',
                maxContextRounds: cfg.maxContextRounds,
                maxContextMsgs: maxMsgs,
                dropRounds: cfg.dropRounds,
                windowStartId: st.windowStartId,
                activeCount: activeIds.size,
                activeRounds: Math.ceil(activeIds.size / 2),
                willEvictNextTurn,
                memoEnabled: cfg.memoEnabled,
                hasMemoContent: Boolean(st.content.trim()),
                turnsSinceUpdate: st.turnsSinceUpdate,
                updateEveryRounds: cfg.updateEveryRounds
            }
        };
    }

    // 统一消息标准化（模板变量渲染 + AI输出清洗 + 严格 user/assistant 交替合并）
    function normalizeRowsToMessages(rowsAsc) {
        const charName = getSetting('charName', '连线搭子');
        const userName = getSetting('userName', '我');
        const normalized = [];

        for (const row of rowsAsc) {
            const role = row.role === 'assistant' ? 'assistant' : 'user';
            const rawContent = renderTemplateVars(String(row.content || '').trim(), charName, userName);
            if (!rawContent) continue;

            let formatted = rawContent;
            if (role === 'user') {
                const ts = formatLocalTimestamp(row.created_at);
                formatted = /^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/.test(rawContent)
                    ? rawContent
                    : `[${ts}] ${userName}：${rawContent}`;
            } else {
                formatted = cleanAIOutput(rawContent, charName);
                if (!formatted) continue;
            }

            // 首条不能是 assistant
            if (normalized.length === 0 && role === 'assistant') continue;

            if (normalized.length > 0 && normalized[normalized.length - 1].role === role) {
                normalized[normalized.length - 1].content += `\n${formatted}`;
            } else {
                normalized.push({ role, content: formatted });
            }
        }

        // 末尾不能悬空 user，避免与当前轮 user 消息撞车
        if (normalized.length > 0 && normalized[normalized.length - 1].role === 'user') {
            normalized.pop();
        }
        return normalized;
    }

    // 1. ✂️ 全站唯一上下文历史获取入口（批量抛弃 & 标准滑窗统一按 maxContextRounds 生效）
    function getEffectiveHistory(charKey, { mutateWindow = true } = {}) {
        const cfg = getConfig();
        const maxMsgs = cfg.maxContextRounds * 2;
        if (maxMsgs <= 0 || !vault.hasMemoryDb(charKey)) return [];

        const memDb = vault.getMemoryDb(charKey);
        let rows = [];

        if (cfg.batchEvictEnabled) {
            const st = getCharState(charKey);
            const dropMsgs = Math.max(2, Math.min(cfg.dropRounds, Math.max(1, cfg.maxContextRounds)) * 2);

            rows = memDb.prepare(
                'SELECT id, event_type, role, content, created_at FROM memory_events WHERE id > ? ORDER BY id ASC'
            ).all(st.windowStartId);

            // 超出最大轮数上限 -> 按 dropRounds 整批推进水位线（即便大幅调低上限也能一步到位，不超窗）
            if (mutateWindow && rows.length > maxMsgs) {
                const overflow = rows.length - maxMsgs;
                const batches = Math.ceil(overflow / dropMsgs);
                let cutIdx = Math.min(batches * dropMsgs, rows.length);
                while (cutIdx < rows.length && rows[cutIdx].role === 'assistant') {
                    cutIdx++;
                }
                if (cutIdx > 0 && cutIdx <= rows.length) {
                    const newStartId = rows[cutIdx - 1].id;
                    memDb.prepare('UPDATE character_memo SET window_start_id = ? WHERE id = ?').run(newStartId, st.rowId);
                    rows = rows.slice(cutIdx);
                    console.log(`✂️ [${charKey}] 上下文满 ${cfg.maxContextRounds} 轮，已批量抛弃 ${Math.ceil(cutIdx / 2)} 轮 (新水位线 #${newStartId}，保留 ${rows.length} 条)`);
                }
            }
        } else {
            // 标准滑窗模式：同样严格遵守统一的 maxContextRounds（换算为 maxMsgs 条）
            rows = memDb.prepare(
                'SELECT id, event_type, role, content, created_at FROM memory_events ORDER BY id DESC LIMIT ?'
            ).all(maxMsgs).reverse();
        }

        return normalizeRowsToMessages(rows);
    }

    // 2. 📝 生成注入系统提示词的备忘录区块
    function getMemoPromptBlock(charKey) {
        const cfg = getConfig();
        if (!cfg.memoEnabled || !vault.hasMemoryDb(charKey)) return '';
        const st = getCharState(charKey);
        if (!st.content.trim()) return '';
        return `\n\n【当前对话动态备忘录（客观状态与约定参考，请自然融入回复，不要生硬提及“备忘录”字样）】\n${st.content.trim()}`;
    }

    // 3. 🔄 核心更新逻辑：调用独立模型（或主聊天模型）以绝对客观第三人称维护备忘录
    async function updateMemoNow(charKey, { force = false } = {}) {
        if (updatingChars.has(charKey)) {
            throw new Error('该角色的备忘录正在后台提炼更新中，请稍候几秒～');
        }
        if (!vault.hasMemoryDb(charKey)) {
            throw new Error('当前角色还没有对话记录，先聊几句再来生成备忘录吧～');
        }

        const cfg = getConfig();
        const memDb = vault.getMemoryDb(charKey);
        const st = getCharState(charKey);

        let newRows = memDb.prepare(
            'SELECT id, event_type, role, content, created_at FROM memory_events WHERE id > ? ORDER BY id ASC'
        ).all(st.lastEventId);

        if (newRows.length === 0 && force) {
            const fallbackCount = Math.max(20, Math.min(120, cfg.maxContextRounds * 2 || 60));
            newRows = memDb.prepare(
                'SELECT id, event_type, role, content, created_at FROM memory_events ORDER BY id DESC LIMIT ?'
            ).all(fallbackCount).reverse();
        }

        if (newRows.length === 0) {
            throw new Error('当前还没有可供整理的新对话内容哦～');
        }

        const charName = getSetting('charName', '连线搭子');
        const userName = getSetting('userName', '我');
        const currentTimeStr = formatMemoTime(new Date());

        const formattedLines = newRows.map(r => {
            const who = r.role === 'assistant' ? charName : userName;
            const ts = formatLocalTimestamp(r.created_at);
            return `[${ts}] ${who}：${String(r.content || '').replace(/\s+/g, ' ').trim()}`;
        });

        const picked = [];
        let charCount = 0;
        for (let i = formattedLines.length - 1; i >= 0; i--) {
            const line = formattedLines[i];
            if (picked.length > 0 && charCount + line.length + 1 > cfg.maxFeedChars) break;
            picked.push(line);
            charCount += line.length + 1;
        }
        picked.reverse();
        const dialogueText = picked.join('\n').slice(-cfg.maxFeedChars);

        const compiledPrompt = (cfg.memoPrompt || DEFAULT_MEMO_PROMPT)
            .replace(/\{\{\s*char\s*\}\}/gi, () => charName)
            .replace(/\{\{\s*user\s*\}\}/gi, () => userName)
            .replace(/\{current_time\}/gi, () => currentTimeStr)
            .replace(/\{max_output_chars\}/gi, () => String(cfg.maxOutputChars));

        const userPayload = `当前系统时间: "${currentTimeStr}"\n\n现有备忘录:\n${st.content.trim() || '（暂无现有备忘录，请根据最新对话新建）'}\n\n最新对话（共 ${picked.length} 条，约 ${dialogueText.length} 字）:\n${dialogueText}`;

        const targetModel = cfg.memoModel || getModelName();
        const openai = createAIClient(cfg.memoApiKey || undefined, cfg.memoBaseURL || undefined);

        updatingChars.add(charKey);
        try {
            const resp = await openai.chat.completions.create({
                model: targetModel,
                temperature: 0.2,
                messages: [
                    { role: 'system', content: compiledPrompt },
                    { role: 'user', content: userPayload }
                ]
            });

            let nextMemo = cleanMemoOutput(resp.choices?.[0]?.message?.content || '');
            if (!nextMemo) throw new Error('备忘录模型返回了空内容');

            if (!/更新时间\s*[:：]/.test(nextMemo)) {
                nextMemo = `${nextMemo}\n更新时间：${currentTimeStr}`;
            }

            const newestId = newRows[newRows.length - 1].id;
            memDb.prepare(
                'UPDATE character_memo SET content = ?, turns_since_update = 0, last_event_id = ?, updated_at = ? WHERE id = ?'
            ).run(nextMemo, newestId, currentTimeStr, st.rowId);

            console.log(`📝 [${charKey}] 对话备忘录已更新 | 模型: ${targetModel} | 喂入 ${dialogueText.length} 字 -> 输出 ${nextMemo.length} 字`);
            return {
                content: nextMemo,
                updatedAt: currentTimeStr,
                usedModel: targetModel,
                fedChars: dialogueText.length,
                fedCount: picked.length
            };
        } finally {
            updatingChars.delete(charKey);
        }
    }

    // 4. 每轮互动完成后的静默计数与自动触发（完全异步，绝不阻塞主对话）
    function onTurnCompleted(charKey) {
        const cfg = getConfig();
        if (!cfg.memoEnabled || !vault.hasMemoryDb(charKey)) return;
        const memDb = vault.getMemoryDb(charKey);
        const st = getCharState(charKey);
        const nextTurns = st.turnsSinceUpdate + 1;
        memDb.prepare('UPDATE character_memo SET turns_since_update = ? WHERE id = ?').run(nextTurns, st.rowId);

        if (nextTurns >= cfg.updateEveryRounds && !updatingChars.has(charKey)) {
            console.log(`⏰ [${charKey}] 已满 ${nextTurns}/${cfg.updateEveryRounds} 轮，后台自动触发备忘录维护...`);
            updateMemoNow(charKey, { force: false }).catch(err => {
                console.warn(`⚠️ [${charKey}] 后台自动更新备忘录失败:`, err.message);
            });
        }
    }

    // 5. 注册前端管理接口
    app.get('/api/memo/state', (req, res) => {
        const charKey = getActiveCharKey();
        const snap = getWindowSnapshot(charKey);

        res.json({
            success: true,
            activeCharKey: charKey,
            charName: getSetting('charName', '连线搭子'),
            mainModel: getModelName(),
            config: snap.config,
            defaultPrompt: DEFAULT_MEMO_PROMPT,
            state: snap.state,
            windowInfo: snap.windowInfo
        });
    });

    app.post('/api/memo/config', (req, res) => {
        const updated = saveConfig(req.body || {});
        const charKey = getActiveCharKey();
        res.json({
            success: true,
            config: updated,
            windowInfo: getWindowSnapshot(charKey).windowInfo
        });
    });

    app.post('/api/memo/update-now', async (req, res) => {
        const charKey = getActiveCharKey();
        try {
            const result = await updateMemoNow(charKey, { force: true });
            const snap = getWindowSnapshot(charKey);
            res.json({ success: true, ...result, state: snap.state, windowInfo: snap.windowInfo });
        } catch (err) {
            res.status(400).json({ success: false, message: err.message });
        }
    });

    app.post('/api/memo/manual-save', (req, res) => {
        const charKey = getActiveCharKey();
        const content = String(req.body?.content || '').trim();
        const memDb = vault.getMemoryDb(charKey);
        const st = getCharState(charKey);
        const nowStr = formatMemoTime(new Date());
        memDb.prepare('UPDATE character_memo SET content = ?, updated_at = ? WHERE id = ?')
            .run(content, nowStr, st.rowId);
        const snap = getWindowSnapshot(charKey);
        res.json({ success: true, state: snap.state, windowInfo: snap.windowInfo });
    });

    app.post('/api/memo/clear', (req, res) => {
        const charKey = getActiveCharKey();
        if (vault.hasMemoryDb(charKey)) {
            const memDb = vault.getMemoryDb(charKey);
            const st = getCharState(charKey);
            const maxId = memDb.prepare('SELECT COALESCE(MAX(id), 0) as m FROM memory_events').get()?.m || 0;
            memDb.prepare("UPDATE character_memo SET content = '', turns_since_update = 0, last_event_id = ?, updated_at = '' WHERE id = ?")
                .run(maxId, st.rowId);
        }
        res.json({ success: true, windowInfo: getWindowSnapshot(charKey).windowInfo });
    });

    app.post('/api/memo/reset-window', (req, res) => {
        const charKey = getActiveCharKey();
        if (vault.hasMemoryDb(charKey)) {
            const memDb = vault.getMemoryDb(charKey);
            const st = getCharState(charKey);
            memDb.prepare('UPDATE character_memo SET window_start_id = 0 WHERE id = ?').run(st.rowId);
        }
        const snap = getWindowSnapshot(charKey);
        res.json({ success: true, state: vault.hasMemoryDb(charKey) ? snap.state : null, windowInfo: snap.windowInfo });
    });

    console.log('📝 统一上下文窗口 & 动态备忘录引擎已就位: /api/memo/state | /api/memo/update-now');

    return {
        MAX_CONTEXT_ROUNDS_CAP,
        getConfig,
        saveConfig,
        getCharState,
        getWindowSnapshot,
        getEffectiveHistory,
        getMemoPromptBlock,
        onTurnCompleted,
        updateMemoNow,
        resetCharMemo
    };
};