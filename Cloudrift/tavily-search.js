// server/tavily-search.js —— Tavily 实时联网搜索工具引擎 + OpenAI Function Calling 循环 + 全部精细触发开关后端接口
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

const TAVILY_TOOL_DEF = {
    type: 'function',
    function: {
        name: 'tavily_search',
        description: '使用 Tavily 实时联网搜索最新资讯、新闻、天气、影视游戏作品、百科知识或用户提到的具体事物。仅在需要外部实时或不确定事实时调用。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '精准凝练的搜索关键词（中文或英文）'
                }
            },
            required: ['query']
        }
    }
};

function getToolsConfig(ctx) {
    const { getSetting, getBoolSetting } = ctx;
    const rawMax = parseInt(getSetting('tavilyMaxResults', '5'), 10);
    const depth = getSetting('tavilySearchDepth', 'basic') === 'advanced' ? 'advanced' : 'basic';
    return {
        notifyOnSlack: getBoolSetting('notifyOnSlack', true),
        notifyOnMusicSkip: getBoolSetting('notifyOnMusicSkip', true),
        notifyOnHighlightPeek: getBoolSetting('notifyOnHighlightPeek', true),
        tavilyEnabled: getBoolSetting('tavilyEnabled', false),
        tavilyApiKey: getSetting('tavilyApiKey', '').trim(),
        tavilyMaxResults: isNaN(rawMax) ? 5 : Math.max(1, Math.min(8, rawMax)),
        tavilySearchDepth: depth
    };
}

function isSearchReady(ctx) {
    const cfg = getToolsConfig(ctx);
    return Boolean(cfg.tavilyEnabled && cfg.tavilyApiKey);
}

async function callTavilySearch(query, { apiKey, maxResults = 5, searchDepth = 'basic' }) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) throw new Error('搜索关键词不能为空');
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) throw new Error('尚未填写 Tavily API Key（tvly-...）');

    const resp = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
            api_key: cleanKey,
            query: cleanQuery,
            search_depth: searchDepth === 'advanced' ? 'advanced' : 'basic',
            max_results: Math.max(1, Math.min(8, parseInt(maxResults, 10) || 5)),
            include_answer: true
        })
    });

    const rawText = await resp.text();
    if (!resp.ok) {
        let detail = rawText.slice(0, 200);
        try {
            const parsed = JSON.parse(rawText);
            detail = parsed?.detail?.error || parsed?.detail || parsed?.message || detail;
        } catch {}
        throw new Error(`Tavily 返回 ${resp.status}：${detail}`);
    }

    const data = JSON.parse(rawText);
    const results = Array.isArray(data.results) ? data.results : [];
    const lines = [];
    if (data.answer) {
        lines.push(`【快速摘要】${String(data.answer).trim()}`);
    }
    results.forEach((r, idx) => {
        const title = String(r.title || '无标题').trim();
        const snippet = String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 260);
        lines.push(`[${idx + 1}] ${title}：${snippet}`);
    });

    const formatted = lines.length
        ? lines.join('\n').slice(0, 2000)
        : `未搜索到关于“${cleanQuery}”的明显结果。`;

    return {
        query: cleanQuery,
        answer: data.answer || '',
        results,
        formatted
    };
}

async function createChatCompletionWithSearch({ openai, model, messages, ctx }) {
    if (!isSearchReady(ctx)) {
        const resp = await openai.chat.completions.create({ model, messages });
        return {
            rawReply: resp.choices?.[0]?.message?.content || '',
            searchedQueries: []
        };
    }

    const cfg = getToolsConfig(ctx);
    const workingMessages = [...messages];
    const searchedQueries = [];

    for (let round = 0; round < 2; round++) {
        let resp;
        try {
            resp = await openai.chat.completions.create({
                model,
                messages: workingMessages,
                tools: [TAVILY_TOOL_DEF],
                tool_choice: 'auto'
            });
        } catch (toolErr) {
            console.warn('⚠️ 当前模型暂不支持 tools 调用，已自动降级为普通对话:', toolErr.message);
            const fallbackResp = await openai.chat.completions.create({ model, messages });
            return {
                rawReply: fallbackResp.choices?.[0]?.message?.content || '',
                searchedQueries: []
            };
        }

        const msg = resp.choices?.[0]?.message;
        const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];

        if (!toolCalls.length) {
            return {
                rawReply: msg?.content || '',
                searchedQueries
            };
        }

        workingMessages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: toolCalls
        });

        for (const tc of toolCalls) {
            const fnName = tc?.function?.name || '';
            let query = '';
            try {
                const args = JSON.parse(tc?.function?.arguments || '{}');
                query = String(args.query || '').trim();
            } catch {
                query = String(tc?.function?.arguments || '').trim();
            }

            let toolOutput = '';
            if (fnName === 'tavily_search' && query) {
                try {
                    const sr = await callTavilySearch(query, {
                        apiKey: cfg.tavilyApiKey,
                        maxResults: cfg.tavilyMaxResults,
                        searchDepth: cfg.tavilySearchDepth
                    });
                    searchedQueries.push(sr.query);
                    toolOutput = sr.formatted;
                    console.log(`🌐 Tavily 联网搜索完成: "${sr.query}" (${sr.results.length} 条结果)`);
                } catch (err) {
                    console.warn(`⚠️ Tavily 搜索失败 ("${query}"):`, err.message);
                    toolOutput = `搜索失败：${err.message}。请据实自然回应，不要编造不确定细节。`;
                }
            } else {
                toolOutput = '未提供有效的搜索关键词。';
            }

            workingMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: toolOutput
            });
        }
    }

    const finalResp = await openai.chat.completions.create({
        model,
        messages: workingMessages
    });
    return {
        rawReply: finalResp.choices?.[0]?.message?.content || '',
        searchedQueries
    };
}

function registerRoutes(app, ctx) {
    const { db, saveSetting } = ctx;

    app.get('/api/tools/settings', (req, res) => {
        res.json({ success: true, ...getToolsConfig(ctx) });
    });

    app.post('/api/tools/settings', (req, res) => {
        if (req.body.notifyOnSlack !== undefined) {
            saveSetting('notifyOnSlack', req.body.notifyOnSlack ? 'true' : 'false');
        }
        if (req.body.notifyOnMusicSkip !== undefined) {
            saveSetting('notifyOnMusicSkip', req.body.notifyOnMusicSkip ? 'true' : 'false');
        }
        if (req.body.notifyOnHighlightPeek !== undefined) {
            saveSetting('notifyOnHighlightPeek', req.body.notifyOnHighlightPeek ? 'true' : 'false');
        }
        if (req.body.tavilyEnabled !== undefined) {
            saveSetting('tavilyEnabled', req.body.tavilyEnabled ? 'true' : 'false');
        }
        if (req.body.tavilyApiKey !== undefined) {
            saveSetting('tavilyApiKey', String(req.body.tavilyApiKey || '').trim());
        }
        if (req.body.tavilyMaxResults !== undefined) {
            const n = Math.max(1, Math.min(8, parseInt(req.body.tavilyMaxResults, 10) || 5));
            saveSetting('tavilyMaxResults', n);
        }
        if (req.body.tavilySearchDepth !== undefined) {
            saveSetting('tavilySearchDepth', req.body.tavilySearchDepth === 'advanced' ? 'advanced' : 'basic');
        }
        res.json({ success: true, ...getToolsConfig(ctx) });
    });

    app.post('/api/tools/tavily-test', async (req, res) => {
        const start = Date.now();
        try {
            const cfg = getToolsConfig(ctx);
            const apiKey = String(req.body?.tavilyApiKey || '').trim() || cfg.tavilyApiKey;
            const query = String(req.body?.query || '今天的日期与最新科技新闻').trim();
            const result = await callTavilySearch(query, {
                apiKey,
                maxResults: req.body?.tavilyMaxResults || cfg.tavilyMaxResults,
                searchDepth: req.body?.tavilySearchDepth || cfg.tavilySearchDepth
            });
            res.json({
                success: true,
                latency: Date.now() - start,
                resultCount: result.results.length,
                sampleTitle: result.results[0]?.title || '',
                answer: result.answer || ''
            });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.post('/api/tools/log-slack', (req, res) => {
        const awayDuration = Math.max(1, parseInt(req.body?.awayDuration, 10) || 60);
        db.prepare("INSERT INTO sessions (type, duration) VALUES ('slack', ?)").run(awayDuration);
        res.json({ success: true, skipped: true });
    });

    console.log('🌐 Tavily 联网搜索 & 全部省Token精细开关路由已就绪');
}

module.exports = {
    getToolsConfig,
    isSearchReady,
    callTavilySearch,
    createChatCompletionWithSearch,
    registerRoutes
};