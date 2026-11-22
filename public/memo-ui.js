// public/memo-ui.js —— 嵌入「🧠 记忆」弹窗的统一上下文窗口 & 动态备忘录维护引擎控制台
(function () {
    const MAX_ROUNDS_CAP = 200;
    let memoData = null;
    let currentTab = 'list'; // 'list' | 'memo'

    function injectStyles() {
        if (document.getElementById('memoUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'memoUiStyles';
        style.textContent = `
            .memo-tab-bar {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
                background: #141312;
                border: 1px solid #33302d;
                border-radius: 12px;
                padding: 4px;
                margin-bottom: 12px;
            }
            .memo-tab-btn {
                border: none;
                background: transparent;
                color: #a8a29e;
                padding: 7px 10px;
                border-radius: 9px;
                font-size: 12.5px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.18s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .memo-tab-btn:hover { color: #f5f5f4; background: rgba(255, 255, 255, 0.05); }
            .memo-tab-btn.active {
                background: var(--accent, #d97706);
                color: var(--text-on-accent, #ffffff);
                font-weight: 600;
            }
            .memo-pane { display: none; }
            .memo-pane.active { display: block; }

            .memo-status-strip {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 12px;
                padding: 9px 12px;
                margin-bottom: 11px;
                font-size: 12px;
                color: #d6d3d1;
            }
            .memo-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                background: rgba(255, 255, 255, 0.08);
                color: #a8a29e;
            }
            .memo-badge.on {
                background: rgba(74, 222, 128, 0.16);
                color: #86efac;
                border: 1px solid rgba(74, 222, 128, 0.35);
            }
            .memo-editor-area {
                width: 100%;
                min-height: 175px;
                max-height: 300px;
                background: #141312;
                border: 1px solid #3f3b37;
                color: #fef3c7;
                border-radius: 12px;
                padding: 11px 12px;
                font-size: 12.5px;
                line-height: 1.65;
                resize: vertical;
                outline: none;
                font-family: inherit;
                margin-bottom: 9px;
            }
            .memo-editor-area:focus { border-color: var(--accent, #d97706); }
            .memo-act-row {
                display: flex;
                gap: 7px;
                flex-wrap: wrap;
                margin-bottom: 14px;
            }
            .memo-cfg-card {
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 14px;
                padding: 12px 13px;
                display: flex;
                flex-direction: column;
                gap: 9px;
            }
            .memo-num-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            @media (max-width: 560px) {
                .memo-num-grid { grid-template-columns: 1fr; }
            }
            .memo-field label {
                display: block;
                font-size: 11.5px;
                color: #a8a29e;
                margin-bottom: 4px;
            }
            .memo-field .memo-hint {
                display: block;
                font-size: 10.5px;
                color: #78716c;
                margin-top: 3px;
            }
            .memo-field input, .memo-field textarea {
                width: 100%;
                background: #121110;
                border: 1px solid #3f3b37;
                color: #f5f5f4;
                padding: 7px 9px;
                border-radius: 9px;
                font-size: 12px;
                outline: none;
            }
            .memo-field input:focus, .memo-field textarea:focus { border-color: var(--accent, #d97706); }
            .memo-details {
                background: #141312;
                border: 1px solid #33302d;
                border-radius: 10px;
                padding: 8px 10px;
            }
            .memo-details summary {
                cursor: pointer;
                font-size: 12px;
                color: #fde68a;
                user-select: none;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    // 清理旧脚本可能注入的「📖 压缩归档为手账」冗余按钮，统一收口到动态备忘录引擎
    function pruneLegacyArchiveButtons() {
        const modal = document.getElementById('memoryManagerModal');
        if (!modal) return;
        modal.querySelectorAll('button').forEach(btn => {
            if (btn.closest('#memMemoPane') || btn.closest('#memoTabBar')) return;
            const txt = (btn.textContent || '').trim();
            if (txt.includes('压缩归档') || txt.includes('归档为手账')) {
                btn.style.display = 'none';
            }
        });
    }

    function mountTabsIntoMemoryModal() {
        const modal = document.getElementById('memoryManagerModal');
        if (!modal || document.getElementById('memoTabBar')) return;
        const box = modal.querySelector('.modal-box');
        const heading = box?.querySelector('h3');
        if (!box || !heading) return;

        const origPane = document.createElement('div');
        origPane.id = 'memOriginalPane';
        origPane.className = 'memo-pane active';
        const siblings = [];
        let cur = heading.nextSibling;
        while (cur) {
            siblings.push(cur);
            cur = cur.nextSibling;
        }
        for (const s of siblings) origPane.appendChild(s);

        const tabBar = document.createElement('div');
        tabBar.id = 'memoTabBar';
        tabBar.className = 'memo-tab-bar';
        tabBar.innerHTML = `
            <button type="button" class="memo-tab-btn active" id="memoTabListBtn" onclick="window.MemoUI.switchTab('list')">📋 对话记忆清单</button>
            <button type="button" class="memo-tab-btn" id="memoTabEngineBtn" onclick="window.MemoUI.switchTab('memo')">📝 动态备忘录引擎</button>
        `;

        const memoPane = document.createElement('div');
        memoPane.id = 'memMemoPane';
        memoPane.className = 'memo-pane';
        memoPane.innerHTML = `
            <div class="memo-status-strip">
                <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                    <span id="memoCharBadge" style="font-weight:600;color:#fef3c7;">当前角色</span>
                    <span class="memo-badge" id="memoStatusBadge">未开启</span>
                    <span id="memoProgressTxt" style="font-size:11.5px;color:#a8a29e;">本周期：0 / 80 轮</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span id="memoWindowBadge" style="font-size:11px;color:#a8a29e;"></span>
                    <button type="button" class="mini-btn" style="padding:2px 7px;font-size:10.5px;" onclick="window.MemoUI.resetWindow()" title="重置上下文抛弃水位线">重置水位</button>
                </div>
            </div>

            <textarea class="memo-editor-area" id="memoContentEditor" placeholder="当前角色还没有生成备忘录～&#10;开启下方「对话备忘录维护引擎」后每满设定轮数会自动提炼，也可以直接点「⚡ 立即提炼更新」或在此手动编写保存！"></textarea>

            <div class="memo-act-row">
                <button type="button" class="btn btn-primary" id="memoUpdateNowBtn" style="flex:1.2;padding:8px 12px;font-size:12.5px;" onclick="window.MemoUI.updateNow()">⚡ 立即提炼更新</button>
                <button type="button" class="btn btn-secondary" style="flex:0.9;padding:8px 12px;font-size:12.5px;" onclick="window.MemoUI.saveManual()">💾 保存手改</button>
                <button type="button" class="btn btn-secondary" style="padding:8px 11px;font-size:12px;color:#fca5a5;" onclick="window.MemoUI.clearMemo()">🗑️ 清空</button>
            </div>
            <div class="status-msg" id="memoActionStatus" style="margin:-6px 0 10px;"></div>

            <div class="memo-cfg-card">
                <label class="switch-row" style="padding:2px 0;">
                    <span>📝 启用对话备忘录维护引擎<small>全站统一生效：小手机、便利贴、划线批注、切歌审批与专注提醒自动共享同一份备忘录</small></span>
                    <input type="checkbox" id="cfgMemoEnabled">
                </label>

                <label class="switch-row" style="padding:4px 0 8px;border-bottom:1px dashed #33302d;">
                    <span>✂️ 启用上下文满值批量抛弃<small>活跃对话满最大轮数时，一次性按设定抛弃最旧 N 轮（稳住前缀缓存、防长上下文抖动）</small></span>
                    <input type="checkbox" id="cfgMemoBatchEvict">
                </label>

                <div class="memo-num-grid">
                    <div class="memo-field">
                        <label>全站上下文最大保留轮数（0~${MAX_ROUNDS_CAP} 轮）</label>
                        <input type="number" id="cfgMemoMaxRounds" min="0" max="${MAX_ROUNDS_CAP}" value="40" oninput="window.MemoUI.clampDropInput()">
                        <span class="memo-hint" id="cfgMemoRoundsHint">约 80 条对话 · 全站所有 AI 请求共用此上限</span>
                    </div>
                    <div class="memo-field">
                        <label>满值时抛弃轮数（≤ 最大轮数）</label>
                        <input type="number" id="cfgMemoDropRounds" min="1" max="${MAX_ROUNDS_CAP}" value="10" oninput="window.MemoUI.clampDropInput()">
                        <span class="memo-hint">仅在开启「满值批量抛弃」时触发</span>
                    </div>
                    <div class="memo-field">
                        <label>每多少轮自动更新备忘录（默认 80）</label>
                        <input type="number" id="cfgMemoEveryRounds" min="1" max="300" value="80">
                    </div>
                    <div class="memo-field">
                        <label>单次总结最多喂入字数</label>
                        <input type="number" id="cfgMemoMaxFeedChars" min="500" max="30000" step="500" value="6000">
                    </div>
                    <div class="memo-field">
                        <label>备忘录总结字数上限</label>
                        <input type="number" id="cfgMemoMaxOutChars" min="120" max="4000" step="100" value="800">
                    </div>
                    <div class="memo-field">
                        <label>独立备忘录模型（留空用当前聊天模型）</label>
                        <input id="cfgMemoModel" placeholder="留空复用主模型（如 gemini-2.5-flash）">
                    </div>
                </div>

                <details class="memo-details">
                    <summary>🔧 独立 API 中转地址 / 密钥（可选，留空复用主聊天 API）</summary>
                    <div class="memo-num-grid" style="margin-top:8px;">
                        <div class="memo-field">
                            <label>独立 Base URL</label>
                            <input id="cfgMemoBaseUrl" placeholder="留空复用主设置地址">
                        </div>
                        <div class="memo-field">
                            <label>独立 API Key</label>
                            <input id="cfgMemoApiKey" type="password" placeholder="留空复用主设置密钥">
                        </div>
                    </div>
                </details>

                <details class="memo-details">
                    <summary>📜 编辑备忘录维护引擎 Prompt（支持 {{char}} / {{user}} / {current_time} / {max_output_chars}）</summary>
                    <div style="margin-top:8px;">
                        <div style="display:flex;justify-content:flex-end;margin-bottom:5px;">
                            <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;" onclick="window.MemoUI.resetPrompt()">🔄 恢复出厂 Prompt</button>
                        </div>
                        <div class="memo-field">
                            <textarea id="cfgMemoPrompt" style="min-height:160px;line-height:1.55;"></textarea>
                        </div>
                    </div>
                </details>

                <button type="button" class="btn btn-primary" style="width:100%;padding:9px;" onclick="window.MemoUI.saveConfig()">💾 保存统一上下文与备忘录配置</button>
                <div class="status-msg" id="memoCfgStatus"></div>
            </div>
        `;

        heading.insertAdjacentElement('afterend', memoPane);
        heading.insertAdjacentElement('afterend', origPane);
        heading.insertAdjacentElement('afterend', tabBar);
        pruneLegacyArchiveButtons();
    }

    function switchTab(tab) {
        currentTab = tab === 'memo' ? 'memo' : 'list';
        document.getElementById('memoTabListBtn')?.classList.toggle('active', currentTab === 'list');
        document.getElementById('memoTabEngineBtn')?.classList.toggle('active', currentTab === 'memo');
        document.getElementById('memOriginalPane')?.classList.toggle('active', currentTab === 'list');
        document.getElementById('memMemoPane')?.classList.toggle('active', currentTab === 'memo');
        pruneLegacyArchiveButtons();
        if (currentTab === 'memo') {
            loadMemoState();
        } else if (window.MemoryUI?.refresh) {
            // 切回记忆清单时立即同步最新水位线与生效高亮
            window.MemoryUI.refresh();
        }
    }

    function clampDropInput() {
        const maxEl = document.getElementById('cfgMemoMaxRounds');
        const dropEl = document.getElementById('cfgMemoDropRounds');
        const hintEl = document.getElementById('cfgMemoRoundsHint');
        if (!maxEl || !dropEl) return;

        const rawMax = parseInt(maxEl.value, 10);
        const maxV = isNaN(rawMax) ? 40 : Math.max(0, Math.min(MAX_ROUNDS_CAP, rawMax));
        const dropCap = Math.max(1, maxV || 1);
        dropEl.max = String(dropCap);

        const curDrop = parseInt(dropEl.value, 10);
        if (!isNaN(curDrop) && curDrop > dropCap) {
            dropEl.value = String(dropCap);
        }
        if (hintEl) {
            hintEl.innerText = maxV <= 0
                ? '0 轮 = 无历史上下文（仅单轮对话）'
                : `约 ${maxV * 2} 条对话 · 全站所有 AI 请求共用此上限`;
        }
    }

    function renderMemoData() {
        if (!memoData) return;
        const { charName, mainModel, config: c, state: s, windowInfo: w } = memoData;

        const charBadge = document.getElementById('memoCharBadge');
        if (charBadge) charBadge.innerText = `👤 ${charName} · 独立备忘录`;

        const statusBadge = document.getElementById('memoStatusBadge');
        if (statusBadge) {
            statusBadge.classList.toggle('on', Boolean(c.memoEnabled));
            statusBadge.innerText = s.isUpdating ? '⏳ 后台更新中...' : (c.memoEnabled ? '🟢 自动维护中' : '⚪ 未开启');
        }

        const prog = document.getElementById('memoProgressTxt');
        if (prog) prog.innerText = `本周期：${s.turnsSinceUpdate} / ${c.updateEveryRounds} 轮`;

        const winBadge = document.getElementById('memoWindowBadge');
        if (winBadge) {
            const activeRounds = w ? w.activeRounds : Math.ceil((s.activeMsgCount || 0) / 2);
            winBadge.innerText = c.batchEvictEnabled
                ? `活跃 ${activeRounds}/${c.maxContextRounds} 轮 (水位#${s.windowStartId})`
                : `标准滑窗 ${activeRounds}/${c.maxContextRounds} 轮`;
        }

        const editor = document.getElementById('memoContentEditor');
        if (editor && document.activeElement !== editor) {
            editor.value = s.content || '';
        }

        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v ?? ''); };

        setChk('cfgMemoEnabled', c.memoEnabled);
        setChk('cfgMemoBatchEvict', c.batchEvictEnabled);
        setVal('cfgMemoMaxRounds', c.maxContextRounds);
        setVal('cfgMemoDropRounds', c.dropRounds);
        setVal('cfgMemoEveryRounds', c.updateEveryRounds);
        setVal('cfgMemoMaxFeedChars', c.maxFeedChars);
        setVal('cfgMemoMaxOutChars', c.maxOutputChars);
        setVal('cfgMemoModel', c.memoModel || '');
        const mInp = document.getElementById('cfgMemoModel');
        if (mInp) mInp.placeholder = `留空复用主模型（当前：${mainModel || '默认'}）`;
        setVal('cfgMemoBaseUrl', c.memoBaseURL || '');
        setVal('cfgMemoApiKey', c.memoApiKey || '');
        setVal('cfgMemoPrompt', c.memoPrompt || memoData.defaultPrompt || '');
        clampDropInput();
    }

    async function loadMemoState() {
        try {
            const res = await fetch(`${API_BASE}/api/memo/state`);
            const data = await res.json();
            if (res.ok && data.success) {
                memoData = data;
                renderMemoData();
            }
        } catch {}
    }

    async function syncListView() {
        if (window.MemoryUI?.refresh) {
            await window.MemoryUI.refresh();
        }
    }

    async function saveConfig() {
        clampDropInput();
        const st = document.getElementById('memoCfgStatus');
        const rawMax = parseInt(document.getElementById('cfgMemoMaxRounds')?.value, 10);
        const maxR = isNaN(rawMax) ? 40 : Math.max(0, Math.min(MAX_ROUNDS_CAP, rawMax));
        const dropR = Math.max(1, Math.min(Math.max(1, maxR || 1), parseInt(document.getElementById('cfgMemoDropRounds')?.value, 10) || 10));

        const payload = {
            memoEnabled: Boolean(document.getElementById('cfgMemoEnabled')?.checked),
            batchEvictEnabled: Boolean(document.getElementById('cfgMemoBatchEvict')?.checked),
            maxContextRounds: maxR,
            dropRounds: dropR,
            updateEveryRounds: parseInt(document.getElementById('cfgMemoEveryRounds')?.value, 10) || 80,
            maxFeedChars: parseInt(document.getElementById('cfgMemoMaxFeedChars')?.value, 10) || 6000,
            maxOutputChars: parseInt(document.getElementById('cfgMemoMaxOutChars')?.value, 10) || 800,
            memoModel: document.getElementById('cfgMemoModel')?.value.trim() || '',
            memoBaseURL: document.getElementById('cfgMemoBaseUrl')?.value.trim() || '',
            memoApiKey: document.getElementById('cfgMemoApiKey')?.value.trim() || '',
            memoPrompt: document.getElementById('cfgMemoPrompt')?.value.trim() || ''
        };

        try {
            const res = await fetch(`${API_BASE}/api/memo/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            if (st) { st.style.color = '#4ade80'; st.innerText = `✅ 已保存！全站上下文统一生效：上限 ${maxR} 轮（约 ${maxR * 2} 条）`; }
            await loadMemoState();
            syncListView();
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        }
    }

    async function updateNow() {
        const btn = document.getElementById('memoUpdateNowBtn');
        const st = document.getElementById('memoActionStatus');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ 正在客观提炼更新...'; }
        if (st) { st.style.color = '#fbbf24'; st.innerText = '🧠 备忘录引擎正在读取最新对话并按时间与优先级重排...'; }

        await saveConfig();

        try {
            const res = await fetch(`${API_BASE}/api/memo/update-now`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            await loadMemoState();
            syncListView();
            if (st) {
                st.style.color = '#4ade80';
                st.innerText = `✅ 更新完成！模型 ${data.usedModel} 消化了 ${data.fedCount} 条对话（${data.fedChars} 字）`;
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '⚡ 立即提炼更新'; }
        }
    }

    async function saveManual() {
        const st = document.getElementById('memoActionStatus');
        const content = document.getElementById('memoContentEditor')?.value || '';
        try {
            const res = await fetch(`${API_BASE}/api/memo/manual-save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            if (st) { st.style.color = '#4ade80'; st.innerText = '✅ 手动修改的备忘录已保存到当前角色独立库！'; }
            await loadMemoState();
            syncListView();
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        }
    }

    async function clearMemo() {
        if (!confirm('确定要清空当前角色的动态备忘录吗？（不会删除原始聊天记录）')) return;
        const st = document.getElementById('memoActionStatus');
        await fetch(`${API_BASE}/api/memo/clear`, { method: 'POST' });
        const editor = document.getElementById('memoContentEditor');
        if (editor) editor.value = '';
        if (st) { st.style.color = '#fbbf24'; st.innerText = '🗑️ 已清空当前角色备忘录'; }
        await loadMemoState();
        syncListView();
    }

    async function resetWindow() {
        if (!confirm('重置水位线后，上下文窗口将重新从头纳入历史记录计算，确定吗？')) return;
        await fetch(`${API_BASE}/api/memo/reset-window`, { method: 'POST' });
        await loadMemoState();
        syncListView();
    }

    function resetPrompt() {
        if (!memoData?.defaultPrompt) return;
        const el = document.getElementById('cfgMemoPrompt');
        if (el) el.value = memoData.defaultPrompt;
        const st = document.getElementById('memoCfgStatus');
        if (st) { st.style.color = '#fde68a'; st.innerText = '🔄 已还原出厂备忘录 Prompt，别忘了点下方「保存配置」哦～'; }
    }

    function hookMemoryOpen() {
        if (window.MemoryUI && typeof window.MemoryUI.open === 'function') {
            const orig = window.MemoryUI.open;
            window.MemoryUI.open = async function () {
                mountTabsIntoMemoryModal();
                pruneLegacyArchiveButtons();
                const ret = await orig.apply(this, arguments);
                loadMemoState();
                return ret;
            };
        }
    }

    window.MemoUI = {
        switchTab,
        clampDropInput,
        saveConfig,
        updateNow,
        saveManual,
        clearMemo,
        resetWindow,
        resetPrompt,
        reload: loadMemoState
    };

    injectStyles();
    mountTabsIntoMemoryModal();
    hookMemoryOpen();
})();