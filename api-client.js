// server/api-client.js —— 独立 LLM API 引擎（全兼容 OpenAI 中转站 + 采样参数 + Gemini BLOCK_NONE 自动兜底 + 待办双端同步）
const OpenAI = require('openai');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const GEMINI_BLOCK_NONE_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
];

function hasNonAscii(str) {
    return /[^\x00-\x7F]/.test(String(str || ''));
}

// 智能清洗 Base URL：支持只填域名(自动补/v1)、带 /v1、误粘贴 /chat/completions 或 /models 等全格式！
function normalizeBaseURL(rawUrl, fallbackUrl = 'https://api.deepseek.com/v1') {
    let url = String(rawUrl || '').trim() || String(fallbackUrl || 'https://api.deepseek.com/v1').trim();
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/chat\/completions$/i, '');
    url = url.replace(/\/completions$/i, '');
    url = url.replace(/\/models$/i, '');
    url = url.replace(/\/+$/, '');

    try {
        const u = new URL(url);
        // 仅填纯域名（如 https://api.xxx.com）时自动补 /v1；若已有自定义路径（如 /v1beta/openai）则原样保留！
        if (!u.pathname || u.pathname === '/') {
            url = `${url}/v1`;
        }
    } catch {}
    return url;
}

function createApiEngine({ db, getSetting, saveSetting, getBoolSetting, cleanAIOutput }) {
    function getLlmParams() {
        const parseNum = (k, def, min, max) => {
            const raw = getSetting(k, '');
            if (raw === '') return def;
            const n = parseFloat(raw);
            if (isNaN(n)) return def;
            return Math.max(min, Math.min(max, n));
        };
        const rawMax = parseInt(getSetting('llmMaxTokens', '0'), 10);
        return {
            temperature: parseNum('llmTemperature', 0.7, 0, 2),
            topP: parseNum('llmTopP', 1.0, 0.05, 1),
            maxTokens: isNaN(rawMax) ? 0 : Math.max(0, Math.min(65536, rawMax)),
            presencePenalty: parseNum('llmPresencePenalty', 0, -2, 2),
            frequencyPenalty: parseNum('llmFrequencyPenalty', 0, -2, 2),
            blockNone: getBoolSetting('llmBlockNone', false)
        };
    }

    function saveLlmParams(body = {}) {
        const setClamped = (key, val, min, max) => {
            if (val === undefined || val === null || val === '') return;
            const n = parseFloat(val);
            if (!isNaN(n)) saveSetting(key, Math.max(min, Math.min(max, n)));
        };
        setClamped('llmTemperature', body.temperature, 0, 2);
        setClamped('llmTopP', body.topP, 0.05, 1);
        if (body.maxTokens !== undefined) {
            const m = parseInt(body.maxTokens, 10);
            saveSetting('llmMaxTokens', isNaN(m) ? 0 : Math.max(0, Math.min(65536, m)));
        }
        setClamped('llmPresencePenalty', body.presencePenalty, -2, 2);
        setClamped('llmFrequencyPenalty', body.frequencyPenalty, -2, 2);
        if (body.blockNone !== undefined) {
            saveSetting('llmBlockNone', body.blockNone ? 'true' : 'false');
        }
        return getLlmParams();
    }

    function resolveApiKey(overrideKey) {
        const cleanOverride = overrideKey ? String(overrideKey).trim() : '';
        const dbKey = getSetting('apiKey', '').trim();
        const envKey = (process.env.API_KEY || '').trim();
        const candidate = cleanOverride || dbKey || (!hasNonAscii(envKey) ? envKey : '');
        if (!candidate) {
            throw new Error('尚未填入有效的 API Key！请点右上角「⚙️ 设置」填入真实 sk-... 密钥并保存。');
        }
        if (hasNonAscii(candidate)) {
            throw new Error('API Key 不能包含中文或全角字符，请重新粘贴纯英文密钥！');
        }
        return candidate;
    }

    function resolveBaseURL(overrideBaseURL) {
        const raw = (overrideBaseURL && String(overrideBaseURL).trim())
            || getSetting('baseURL')
            || process.env.BASE_URL
            || 'https://api.deepseek.com/v1';
        return normalizeBaseURL(raw);
    }

    // 返回带参数自动注入 + BLOCK_NONE 容错降级 + 中转站友好请求头的 OpenAI 客户端
    function createAIClient(overrideKey, overrideBaseURL) {
        const apiKey = resolveApiKey(overrideKey);
        const baseURL = resolveBaseURL(overrideBaseURL);
        const client = new OpenAI({
            apiKey,
            baseURL,
            timeout: 120000,
            maxRetries: 1,
            defaultHeaders: {
                'User-Agent': BROWSER_UA,
                'Accept': 'application/json'
            }
        });

        const origCreate = client.chat.completions.create.bind(client.chat.completions);
        client.chat.completions.create = async function (params, options) {
            const llmCfg = getLlmParams();
            const merged = { ...params };

            if (merged.temperature === undefined) merged.temperature = llmCfg.temperature;
            if (merged.top_p === undefined && llmCfg.topP < 0.999) merged.top_p = llmCfg.topP;
            if (merged.max_tokens === undefined && llmCfg.maxTokens > 0) merged.max_tokens = llmCfg.maxTokens;
            if (merged.presence_penalty === undefined && Math.abs(llmCfg.presencePenalty) > 0.001) {
                merged.presence_penalty = llmCfg.presencePenalty;
            }
            if (merged.frequency_penalty === undefined && Math.abs(llmCfg.frequencyPenalty) > 0.001) {
                merged.frequency_penalty = llmCfg.frequencyPenalty;
            }

            let addedBlockNone = false;
            if (llmCfg.blockNone && !merged.safety_settings) {
                merged.safety_settings = GEMINI_BLOCK_NONE_SETTINGS;
                addedBlockNone = true;
            }

            try {
                return await origCreate(merged, options);
            } catch (err) {
                const errText = String(err?.error?.message || err?.message || '');
                const status = err?.status || err?.statusCode || 0;

                // 若严格校验字段的上游（如 DeepSeek / 官方 OpenAI）拒绝 safety_settings 或惩罚系数，自动剥离无感重试！
                if (status === 400 || status === 422 || /safety_settings|unknown|unrecognized|extra_forbidden|not supported|invalid/i.test(errText)) {
                    const retryBody = { ...merged };
                    let changed = false;
                    if (addedBlockNone && retryBody.safety_settings) {
                        delete retryBody.safety_settings;
                        changed = true;
                    }
                    if (/penalty|top_p/i.test(errText)) {
                        delete retryBody.presence_penalty;
                        delete retryBody.frequency_penalty;
                        delete retryBody.top_p;
                        changed = true;
                    }
                    if (changed) {
                        console.warn(`⚠️ 上游接口不接受扩展参数 (${errText.slice(0, 80)})，已自动剥离并重试`);
                        return await origCreate(retryBody, options);
                    }
                }
                throw err;
            }
        };

        return client;
    }

    // 多候选路径 + 全响应格式解析：专治各类 OneAPI / NewAPI / Gemini / Claude 中转站拉取模型失败！
    async function fetchModelsRobust(overrideKey, overrideBaseURL) {
        const apiKey = resolveApiKey(overrideKey);
        const rawInput = (overrideBaseURL && String(overrideBaseURL).trim())
            || getSetting('baseURL')
            || process.env.BASE_URL
            || 'https://api.deepseek.com/v1';
        const cleanRaw = rawInput.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
        const norm = normalizeBaseURL(rawInput);
        const withoutV1 = norm.replace(/\/v1$/i, '');

        const candidates = Array.from(new Set([
            `${norm}/models`,
            `${cleanRaw}/models`,
            `${withoutV1}/v1/models`,
            `${withoutV1}/models`
        ]));

        let lastErr = '无法连接到上游地址';
        for (const endpoint of candidates) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 18000);
                const resp = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'x-api-key': apiKey,
                        'Accept': 'application/json',
                        'User-Agent': BROWSER_UA
                    },
                    signal: controller.signal
                });
                clearTimeout(timer);

                const text = await resp.text();
                const trimmed = text.trim();

                if (!resp.ok) {
                    let detail = trimmed.slice(0, 180);
                    try {
                        const parsed = JSON.parse(trimmed);
                        detail = parsed?.error?.message || parsed?.message || detail;
                    } catch {}
                    lastErr = `HTTP ${resp.status} (${endpoint})：${detail}`;
                    continue;
                }

                if (trimmed.startsWith('<')) {
                    lastErr = `上游 ${endpoint} 返回了网页 HTML 而非 JSON（请检查地址是否缺少 /v1 或被中转站防火墙拦截）`;
                    continue;
                }

                const json = JSON.parse(trimmed);
                const rawList = Array.isArray(json)
                    ? json
                    : (Array.isArray(json.data)
                        ? json.data
                        : (Array.isArray(json.models)
                            ? json.models
                            : (Array.isArray(json.data?.models) ? json.data.models : [])));

                const models = rawList
                    .map(item => {
                        if (typeof item === 'string') return item;
                        return item?.id || item?.name?.replace(/^models\//, '') || '';
                    })
                    .filter(Boolean)
                    .sort();

                if (models.length > 0) {
                    return { models, endpoint, normalizedBaseURL: norm };
                }
                lastErr = `接口 ${endpoint} 返回成功但模型列表为空`;
            } catch (e) {
                lastErr = `${endpoint} 连接异常：${e.name === 'AbortError' ? '请求超时(18s)' : e.message}`;
            }
        }
        throw new Error(lastErr);
    }

    function registerRoutes(app) {
        // 1. 读写 LLM 采样参数 & BLOCK_NONE
        app.get('/api/llm/settings', (req, res) => {
            res.json({ success: true, ...getLlmParams() });
        });

        app.post('/api/llm/settings', (req, res) => {
            const updated = saveLlmParams(req.body || {});
            res.json({ success: true, ...updated });
        });

        // 2. 强兼容拉取模型列表（专治各种中转站）
        app.post('/api/llm/models', async (req, res) => {
            try {
                const result = await fetchModelsRobust(req.body?.apiKey, req.body?.baseURL);
                res.json({ success: true, ...result });
            } catch (error) {
                res.status(400).json({ success: false, message: error.message });
            }
        });

        // 3. 强兼容测试连接（放宽 max_tokens 适配思考模型 + 清晰诊断报错）
        app.post('/api/llm/test', async (req, res) => {
            const start = Date.now();
            try {
                const client = createAIClient(req.body?.apiKey, req.body?.baseURL);
                const model = (req.body?.modelName && String(req.body.modelName).trim())
                    || getSetting('modelName')
                    || process.env.MODEL_NAME
                    || 'deepseek-chat';
                const resp = await client.chat.completions.create({
                    model,
                    messages: [{ role: 'user', content: '请只回复“连线成功”四个字。' }],
                    max_tokens: 256
                });
                const latency = Date.now() - start;
                const rawReply = resp.choices?.[0]?.message?.content
                    || resp.choices?.[0]?.message?.reasoning_content
                    || '';
                const reply = (typeof cleanAIOutput === 'function' ? cleanAIOutput(rawReply) : rawReply.trim()) || 'OK';
                res.json({ success: true, latency, model, reply: reply.slice(0, 40) });
            } catch (error) {
                const detail = error?.error?.message || error?.message || '连接失败';
                res.status(400).json({ success: false, message: detail });
            }
        });

        // 4. 📋 近期待办清单跨设备同步（PC <-> 手机实时一致）
        app.get('/api/desk/todos', (req, res) => {
            const raw = getSetting('deskTodosSyncJson', '').trim();
            if (!raw) return res.json({ success: true, payload: null });
            try {
                res.json({ success: true, payload: JSON.parse(raw) });
            } catch {
                res.json({ success: true, payload: null });
            }
        });

        app.post('/api/desk/todos', (req, res) => {
            const { key, raw, updatedAt } = req.body || {};
            if (!key || typeof raw !== 'string') {
                return res.status(400).json({ success: false, message: '无效的待办同步数据' });
            }
            const payload = { key: String(key), raw, updatedAt: Number(updatedAt) || Date.now() };
            saveSetting('deskTodosSyncJson', JSON.stringify(payload));
            res.json({ success: true, payload });
        });

        console.log('🔌 独立 API 引擎已挂载: 中转站强兼容 | 采样参数 | BLOCK_NONE | 待办跨端同步');
    }

    return {
        normalizeBaseURL,
        getLlmParams,
        saveLlmParams,
        resolveApiKey,
        resolveBaseURL,
        createAIClient,
        fetchModelsRobust,
        registerRoutes
    };
}

module.exports = {
    normalizeBaseURL,
    createApiEngine
};