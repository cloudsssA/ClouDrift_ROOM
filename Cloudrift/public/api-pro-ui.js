// public/api-pro-ui.js —— 独立 API 高级参数面板(温度/Top-P/MaxTokens/惩罚/BLOCK_NONE) + 强兼容中转站模型拉取 + 近期待办清单跨端同步
(function () {
    let llmParams = {
        temperature: 0.7,
        topP: 1.0,
        maxTokens: 0,
        presencePenalty: 0,
        frequencyPenalty: 0,
        blockNone: false
    };

    let internalSyncWrite = false;
    let todoSyncTimer = null;

    // 1. 往「⚙️ 设置」的 API 区块下方注入采样参数 + BLOCK_NONE 开关
    function injectApiParamsSection() {
        const modal = document.getElementById('settingsModal');
        if (!modal || document.getElementById('llmParamsSection')) return;

        const apiAnchor = document.getElementById('apiTestStatus')?.closest('.form-group');
        const box = document.createElement('div');
        box.id = 'llmParamsSection';
        box.className = 'settings-section-box';
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
                <span style="font-size:13px;color:#fef3c7;font-weight:500;">🎛️ 模型采样参数 & 安全策略</span>
                <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;" onclick="window.ApiProUI.resetDefaults()">恢复默认</button>
            </div>

            <div class="color-grid">
                <div class="form-group" style="margin-bottom:8px;">
                    <label>Temperature（温度 · 越高越有创意）：<strong id="llmTempVal" style="color:#fde68a;">0.70</strong></label>
                    <input type="range" id="cfgLlmTemp" min="0" max="2" step="0.05" value="0.7" oninput="document.getElementById('llmTempVal').innerText = Number(this.value).toFixed(2)">
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                    <label>Top-P（核采样）：<strong id="llmTopPVal" style="color:#fde68a;">1.00</strong></label>
                    <input type="range" id="cfgLlmTopP" min="0.1" max="1" step="0.05" value="1.0" oninput="document.getElementById('llmTopPVal').innerText = Number(this.value).toFixed(2)">
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                    <label>Presence Penalty（话题发散）：<strong id="llmPresVal" style="color:#fde68a;">0.00</strong></label>
                    <input type="range" id="cfgLlmPres" min="-2" max="2" step="0.1" value="0" oninput="document.getElementById('llmPresVal').innerText = Number(this.value).toFixed(2)">
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                    <label>Frequency Penalty（去复读）：<strong id="llmFreqVal" style="color:#fde68a;">0.00</strong></label>
                    <input type="range" id="cfgLlmFreq" min="-2" max="2" step="0.1" value="0" oninput="document.getElementById('llmFreqVal').innerText = Number(this.value).toFixed(2)">
                </div>
            </div>

            <div class="form-group" style="margin-bottom:8px;">
                <label>Max Tokens（单轮最大输出，填 0 表示不限制/跟随模型默认）</label>
                <input type="number" id="cfgLlmMaxTokens" min="0" max="65536" step="128" value="0" placeholder="0 = 自动不限制">
            </div>

            <label class="switch-row" style="padding:6px 0 0;border-top:1px dashed #33302d;">
                <span>🔓 发送 BLOCK_NONE 安全阈值（Gemini / 中转站推荐）<small>请求时附带全项 BLOCK_NONE 防误拦截；若当前上游不支持该字段将自动剥离重试，绝不报错</small></span>
                <input type="checkbox" id="cfgLlmBlockNone">
            </label>
        `;

        if (apiAnchor && apiAnchor.parentNode) {
            apiAnchor.parentNode.insertBefore(box, apiAnchor.nextSibling);
        }
    }

    function fillParamsForm() {
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
        const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.innerText = t; };
        setVal('cfgLlmTemp', llmParams.temperature);
        setTxt('llmTempVal', Number(llmParams.temperature).toFixed(2));
        setVal('cfgLlmTopP', llmParams.topP);
        setTxt('llmTopPVal', Number(llmParams.topP).toFixed(2));
        setVal('cfgLlmPres', llmParams.presencePenalty);
        setTxt('llmPresVal', Number(llmParams.presencePenalty).toFixed(2));
        setVal('cfgLlmFreq', llmParams.frequencyPenalty);
        setTxt('llmFreqVal', Number(llmParams.frequencyPenalty).toFixed(2));
        setVal('cfgLlmMaxTokens', llmParams.maxTokens || 0);
        const bn = document.getElementById('cfgLlmBlockNone');
        if (bn) bn.checked = Boolean(llmParams.blockNone);
    }

    function resetDefaults() {
        llmParams = { temperature: 0.7, topP: 1.0, maxTokens: 0, presencePenalty: 0, frequencyPenalty: 0, blockNone: false };
        fillParamsForm();
    }

    async function loadLlmParams() {
        try {
            const res = await fetch(`${API_BASE}/api/llm/settings`);
            const data = await res.json();
            if (res.ok && data.success) {
                llmParams = { ...llmParams, ...data };
            }
        } catch {}
    }

    async function saveLlmParamsFromForm() {
        const payload = {
            temperature: parseFloat(document.getElementById('cfgLlmTemp')?.value) ?? 0.7,
            topP: parseFloat(document.getElementById('cfgLlmTopP')?.value) ?? 1.0,
            presencePenalty: parseFloat(document.getElementById('cfgLlmPres')?.value) ?? 0,
            frequencyPenalty: parseFloat(document.getElementById('cfgLlmFreq')?.value) ?? 0,
            maxTokens: parseInt(document.getElementById('cfgLlmMaxTokens')?.value, 10) || 0,
            blockNone: Boolean(document.getElementById('cfgLlmBlockNone')?.checked)
        };
        llmParams = { ...llmParams, ...payload };
        try {
            await fetch(`${API_BASE}/api/llm/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch {}
    }

    // 2. 全面接管「🔄 拉取模型」与「⚡ 测连接」走中转站强兼容接口！
    function hookApiTestAndModels() {
        window.fetchUpstreamModels = async function () {
            const btn = document.getElementById('fetchModelsBtn');
            const status = document.getElementById('apiTestStatus');
            if (btn) btn.disabled = true;
            if (status) { status.style.color = '#fbbf24'; status.innerText = '🔄 正在兼容多路径拉取中转站模型列表...'; }

            try {
                const res = await fetch(`${API_BASE}/api/llm/models`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: document.getElementById('cfgApiKey')?.value || '',
                        baseURL: document.getElementById('cfgBaseUrl')?.value || ''
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);

                // 同步自动修正过的规范 Base URL（如自动补上了 /v1）
                const baseInp = document.getElementById('cfgBaseUrl');
                if (baseInp && data.normalizedBaseURL && !baseInp.value.includes('/v1') && data.endpoint?.includes('/v1/models')) {
                    baseInp.value = data.normalizedBaseURL;
                }

                if (typeof fetchedModelsList !== 'undefined') {
                    fetchedModelsList.length = 0;
                    fetchedModelsList.push(...(data.models || []));
                }
                if (typeof renderModelDropdown === 'function') renderModelDropdown();
                document.getElementById('modelDropdownMenu')?.classList.add('open');

                if (status) {
                    status.style.color = '#4ade80';
                    status.innerText = `✅ 已拉取 ${data.models.length} 个模型！点下拉列表直接选用`;
                }
            } catch (e) {
                if (status) { status.style.color = '#f87171'; status.innerText = `❌ ${e.message}`; }
            } finally {
                if (btn) btn.disabled = false;
            }
        };

        window.testApiConnection = async function () {
            const btn = document.getElementById('testConnBtn');
            const status = document.getElementById('apiTestStatus');
            if (btn) btn.disabled = true;
            if (status) { status.style.color = '#fbbf24'; status.innerText = '⚡ 正在发送握手信号（已带采样与 BLOCK_NONE 设置）...'; }
            await saveLlmParamsFromForm();

            try {
                const res = await fetch(`${API_BASE}/api/llm/test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: document.getElementById('cfgApiKey')?.value || '',
                        baseURL: document.getElementById('cfgBaseUrl')?.value || '',
                        modelName: document.getElementById('cfgModelName')?.value || ''
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
                if (status) {
                    status.style.color = '#4ade80';
                    status.innerText = `✅ 连接畅通！${data.model} 耗时 ${data.latency}ms（“${data.reply}”）`;
                }
            } catch (e) {
                if (status) { status.style.color = '#f87171'; status.innerText = `❌ ${e.message}`; }
            } finally {
                if (btn) btn.disabled = false;
            }
        };

        if (typeof window.openSettingsModal === 'function') {
            const orig = window.openSettingsModal;
            window.openSettingsModal = function () {
                orig.apply(this, arguments);
                fillParamsForm();
            };
        }
        if (typeof window.saveSettingsPanel === 'function') {
            const orig = window.saveSettingsPanel;
            window.saveSettingsPanel = async function () {
                await saveLlmParamsFromForm();
                return orig.apply(this, arguments);
            };
        }
    }

    // 3. 📋 近期待办清单自动改名 + 跨设备 SQLite 实时同步（PC <-> 手机无缝共享！）
    function isTodoStorageKey(k, valStr) {
        if (!k || k.includes('desk_stack') || k.includes('pause') || k.includes('timer') || k.includes('visual') || k.includes('chat_drawer')) {
            return false;
        }
        if (/todo/i.test(k)) return true;
        if (/desk_widget/i.test(k)) return true;
        if (typeof valStr === 'string' && valStr.startsWith('[')) {
            try {
                const arr = JSON.parse(valStr);
                if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object' && 'done' in arr[0]) {
                    return true;
                }
            } catch {}
        }
        return false;
    }

    function pushTodoToServer(key, raw) {
        clearTimeout(todoSyncTimer);
        todoSyncTimer = setTimeout(() => {
            fetch(`${API_BASE}/api/desk/todos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, raw, updatedAt: Date.now() })
            }).catch(() => {});
        }, 250);
    }

    function initTodoRenameAndCrossDeviceSync() {
        // 自动把标题「自习待办清单」温和改为「近期待办清单」
        const renameTitle = () => {
            document.querySelectorAll('.desk-todo-card .desk-card-title').forEach(el => {
                for (const node of el.childNodes) {
                    if (node.nodeType === 3 && node.nodeValue.includes('自习待办清单')) {
                        node.nodeValue = node.nodeValue.replace('自习待办清单', '近期待办清单');
                    }
                }
                el.querySelectorAll('span').forEach(sp => {
                    if (sp.innerText.includes('自习待办清单')) {
                        sp.innerText = sp.innerText.replace('自习待办清单', '近期待办清单');
                    }
                });
            });
        };
        renameTitle();
        const mountEl = document.getElementById('deskWidgetsMount');
        if (mountEl) {
            new MutationObserver(renameTitle).observe(mountEl, { childList: true, subtree: true });
        }

        // 拦截本地待办变更 -> 自动推给后端 SQLite
        const origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
            const ret = origSetItem.apply(this, arguments);
            if (this === window.localStorage && !internalSyncWrite && isTodoStorageKey(k, v)) {
                pushTodoToServer(k, String(v));
            }
            return ret;
        };

        // 启动时拉取服务端最新待办，自动与本地对齐！
        fetch(`${API_BASE}/api/desk/todos`)
            .then(r => r.json())
            .then(data => {
                const remote = data?.payload;
                if (remote && remote.key && typeof remote.raw === 'string') {
                    const localRaw = localStorage.getItem(remote.key);
                    if (localRaw !== remote.raw) {
                        internalSyncWrite = true;
                        localStorage.setItem(remote.key, remote.raw);
                        internalSyncWrite = false;
                        // 尝试无缝刷新待办组件，若无对外刷新方法则温和重绘一次（防循环锁）
                        if (window.DeskWidgets && typeof window.DeskWidgets.render === 'function') {
                            window.DeskWidgets.render();
                            renameTitle();
                        } else if (!sessionStorage.getItem('study_todo_reloaded_v1')) {
                            sessionStorage.setItem('study_todo_reloaded_v1', '1');
                            location.reload();
                        }
                    } else {
                        sessionStorage.removeItem('study_todo_reloaded_v1');
                    }
                } else {
                    // 服务端尚无记录时，如果本机已有待办则主动上传作为种子！
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        const v = localStorage.getItem(k);
                        if (isTodoStorageKey(k, v)) {
                            pushTodoToServer(k, v);
                            break;
                        }
                    }
                }
            })
            .catch(() => {});
    }

    window.ApiProUI = { resetDefaults };

    injectApiParamsSection();
    hookApiTestAndModels();
    loadLlmParams();
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initTodoRenameAndCrossDeviceSync);
    } else {
        initTodoRenameAndCrossDeviceSync();
    }
})();