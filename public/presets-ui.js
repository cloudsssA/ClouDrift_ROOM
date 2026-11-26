// public/presets-ui.js —— 预设圣殿可视化管理面板 + 清空记忆联动刷新 + 前端小暗雷热修复
(function () {
    let presetsState = {
        meta: [],
        defaults: {},
        current: {},
        profiles: []
    };
    let allExpanded = false;

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 1. 注入预设圣殿专属样式
    function injectStyles() {
        if (document.getElementById('presetsUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'presetsUiStyles';
        style.textContent = `
            #promptConfigModal .modal-box {
                max-width: 720px;
                width: 94%;
                max-height: 90vh;
                padding: 22px 24px 18px;
            }
            .preset-temple-bar {
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 12px;
                padding: 13px;
                margin-bottom: 14px;
            }
            .preset-temple-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 10px;
            }
            .preset-temple-title {
                font-size: 13px;
                color: #fef3c7;
                font-weight: 600;
            }
            .preset-temple-tools {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                align-items: center;
            }
            .preset-save-row {
                display: flex;
                gap: 8px;
                align-items: center;
                margin-bottom: 10px;
                flex-wrap: wrap;
            }
            .preset-save-row input {
                flex: 1;
                min-width: 160px;
                padding: 7px 11px;
                background: #131211;
                border: 1px solid #3f3b37;
                color: #f5f5f4;
                border-radius: 8px;
                font-size: 12.5px;
            }
            .preset-save-row input:focus {
                outline: none;
                border-color: var(--accent, #d97706);
            }
            .preset-profile-list {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .preset-profile-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: #292524;
                border: 1px solid #44403c;
                color: #e7e5e4;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.18s;
            }
            .preset-profile-chip:hover {
                border-color: var(--accent, #d97706);
                color: #fef3c7;
                background: rgba(217, 119, 6, 0.16);
            }
            .preset-profile-chip .p-del {
                color: #78716c;
                font-weight: 700;
                padding: 0 2px;
            }
            .preset-profile-chip .p-del:hover {
                color: #f87171;
            }
            .preset-list-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin: 12px 0 8px;
                flex-wrap: wrap;
            }
            .preset-accordion {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 14px;
            }
            .preset-card {
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 12px;
                overflow: hidden;
                transition: border-color 0.2s;
            }
            .preset-card.open {
                border-color: rgba(217, 119, 6, 0.55);
            }
            .preset-card-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                padding: 10px 13px;
                cursor: pointer;
                user-select: none;
                background: rgba(255, 255, 255, 0.02);
            }
            .preset-card-head:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            .preset-card-meta {
                min-width: 0;
                flex: 1;
            }
            .preset-card-title-row {
                display: flex;
                align-items: center;
                gap: 7px;
                flex-wrap: wrap;
            }
            .preset-card-label {
                font-size: 13px;
                font-weight: 600;
                color: #f5f5f4;
            }
            .preset-card-desc {
                font-size: 11px;
                color: #a8a29e;
                margin-top: 3px;
                line-height: 1.45;
            }
            .preset-badge {
                font-size: 10px;
                padding: 1px 7px;
                border-radius: 999px;
                font-weight: 500;
                background: rgba(255, 255, 255, 0.08);
                color: #a8a29e;
            }
            .preset-badge.modified {
                background: rgba(217, 119, 6, 0.24);
                color: #fde68a;
                border: 1px solid rgba(217, 119, 6, 0.45);
            }
            .preset-card-right {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }
            .preset-chevron {
                font-size: 11px;
                color: #a8a29e;
                transition: transform 0.2s;
                display: inline-block;
            }
            .preset-card.open .preset-chevron {
                transform: rotate(180deg);
                color: #fef3c7;
            }
            .preset-card-body {
                display: none;
                padding: 0 13px 12px;
                border-top: 1px dashed #2e2b28;
            }
            .preset-card.open .preset-card-body {
                display: block;
                padding-top: 10px;
            }
            .preset-card-body textarea {
                width: 100%;
                min-height: 112px;
                padding: 10px 12px;
                background: #121110;
                border: 1px solid #3f3b37;
                border-radius: 9px;
                color: #f5f5f4;
                font-size: 12.5px;
                line-height: 1.6;
                font-family: inherit;
                resize: vertical;
            }
            .preset-card-body textarea:focus {
                outline: none;
                border-color: var(--accent, #d97706);
            }
            .preset-footer-sticky {
                position: sticky;
                bottom: -18px;
                background: linear-gradient(to top, #22201e 82%, rgba(34, 32, 30, 0));
                padding: 12px 0 4px;
                z-index: 5;
            }
            .preset-status-line {
                font-size: 12px;
                min-height: 18px;
                margin-bottom: 8px;
                text-align: center;
                color: #a8a29e;
            }
        `;
        document.head.appendChild(style);
    }

    // 2. 重建「🎛️ 配置」弹窗为完整预设圣殿 + 连续记忆配置面板
    function upgradePromptConfigModalDom() {
        const modal = document.getElementById('promptConfigModal');
        if (!modal) return;
        const box = modal.querySelector('.modal-box');
        if (!box) return;

        box.innerHTML = `
            <h3>
                <span>🎛️ 预设圣殿 & 连续记忆配置</span>
                <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('promptConfigModal')">✕</span>
            </h3>

            <!-- 🧠 连续记忆控制区 -->
            <div class="settings-section-box" style="margin-bottom:12px;">
                <div class="memory-box-header">
                    <span style="font-size:13px;color:#fef3c7;font-weight:500;">🧠 当前角色连续记忆条数</span>
                    <span class="memory-pill-val" id="contextLimitBadge">24 条</span>
                </div>
                <input type="range" class="memory-slider" id="cfgContextLimit" min="0" max="80" step="2" value="24" oninput="updateContextLimitUI(this.value)">
                <div class="memory-meta-row">
                    <span id="memoryCountLabel">按角色独立隔离 · 当前已存 0 条</span>
                    <button class="btn-danger-ghost" type="button" onclick="clearAllMemory()">🧹 彻底清空当前角色记忆</button>
                </div>
            </div>

            <!-- 🗂️ 预设套装仓库 & 导入导出 -->
            <div class="preset-temple-bar">
                <div class="preset-temple-head">
                    <span class="preset-temple-title">📚 预设套装仓库（支持多套一键切换）</span>
                    <div class="preset-temple-tools">
                        <input type="file" id="presetImportInput" accept=".json" style="display:none" onchange="window.PresetsUI.handleImportFile(event)">
                        <button type="button" class="mini-btn" onclick="document.getElementById('presetImportInput').click()">📥 导入JSON</button>
                        <button type="button" class="mini-btn" onclick="window.PresetsUI.exportJson()">📤 导出JSON</button>
                        <button type="button" class="btn-danger-ghost" style="padding:4px 9px;font-size:11.5px;" onclick="window.PresetsUI.resetAllFactory()">🔄 一键出厂重置</button>
                    </div>
                </div>
                <div class="preset-save-row">
                    <input id="presetNewProfileName" placeholder="给当前这组全部预设起个套装名（如：傲娇毒舌版 / 温柔学长版）..." onkeydown="if(event.key==='Enter') window.PresetsUI.saveProfile()">
                    <button type="button" class="mini-btn" style="border-color:var(--accent);color:#fde68a;padding:7px 12px;" onclick="window.PresetsUI.saveProfile()">💾 另存为套装</button>
                </div>
                <div class="preset-profile-list" id="presetProfilesList">
                    <span style="font-size:11.5px;color:#78716c;">暂无已存预设套装～改好下方 Prompt 后可以随时存一套备用！</span>
                </div>
            </div>

            <!-- 📜 10 项热更新 Prompt 折叠编辑器 -->
            <div class="preset-list-header">
                <span style="font-size:12.5px;color:#fef3c7;font-weight:600;">✨ 全部场景 Prompt 热编辑（共 <span id="presetTotalCount">10</span> 项 · 保存即刻热生效）</span>
                <button type="button" class="mini-btn" id="presetToggleExpandBtn" onclick="window.PresetsUI.toggleExpandAll()">📂 全部展开</button>
            </div>
            <div class="preset-accordion" id="presetAccordionList">
                <div style="text-align:center;color:#78716c;font-size:12px;padding:20px 0;">⏳ 正在读取预设圣殿...</div>
            </div>

            <!-- 底部吸底保存栏 -->
            <div class="preset-footer-sticky">
                <div class="preset-status-line" id="presetTempleStatus"></div>
                <button class="btn btn-primary" style="width:100%;" id="presetSaveAllBtn" onclick="savePromptConfigPanel()">💾 保存全部预设与记忆配置</button>
            </div>
        `;
    }

    function setStatus(msg, color = '#a8a29e') {
        const el = document.getElementById('presetTempleStatus');
        if (!el) return;
        el.style.color = color;
        el.innerText = msg;
    }

    function collectEditedPresets() {
        const result = {};
        for (const item of presetsState.meta) {
            const ta = document.getElementById(`preset_ta_${item.key}`);
            if (ta) result[item.key] = ta.value;
        }
        return result;
    }

    function isKeyModified(key, val) {
        const def = String(presetsState.defaults[key] || '').trim();
        return String(val || '').trim() !== def;
    }

    function refreshBadge(key) {
        const ta = document.getElementById(`preset_ta_${key}`);
        const badge = document.getElementById(`preset_badge_${key}`);
        if (!ta || !badge) return;
        const mod = isKeyModified(key, ta.value);
        badge.classList.toggle('modified', mod);
        badge.innerText = mod ? '已修改' : '默认';
    }

    function renderProfiles() {
        const box = document.getElementById('presetProfilesList');
        if (!box) return;
        const list = presetsState.profiles || [];
        if (!list.length) {
            box.innerHTML = `<span style="font-size:11.5px;color:#78716c;">暂无已存预设套装～改好下方 Prompt 后可以随时存一套备用！</span>`;
            return;
        }
        box.innerHTML = list.map(p => `
            <span class="preset-profile-chip" data-profile="${esc(p.name)}" onclick="window.PresetsUI.applyProfile(this.dataset.profile)" title="点击切换到此预设套装">
                <span>📦 ${esc(p.name)}</span>
                <span class="p-del" data-profile="${esc(p.name)}" onclick="event.stopPropagation();window.PresetsUI.deleteProfile(this.dataset.profile)" title="删除该套装">×</span>
            </span>
        `).join('');
    }

    function renderAccordion(preserveOpenKeys = null) {
        const box = document.getElementById('presetAccordionList');
        const countEl = document.getElementById('presetTotalCount');
        if (countEl) countEl.innerText = String(presetsState.meta.length || 0);
        if (!box) return;

        const openSet = preserveOpenKeys || new Set(['systemPreset']);
        box.innerHTML = presetsState.meta.map(item => {
            const val = presetsState.current[item.key] ?? presetsState.defaults[item.key] ?? '';
            const mod = isKeyModified(item.key, val);
            const isOpen = allExpanded || openSet.has(item.key);
            return `
                <div class="preset-card ${isOpen ? 'open' : ''}" id="preset_card_${esc(item.key)}">
                    <div class="preset-card-head" onclick="window.PresetsUI.toggleCard('${esc(item.key)}')">
                        <div class="preset-card-meta">
                            <div class="preset-card-title-row">
                                <span class="preset-card-label">${esc(item.label)}</span>
                                <span class="preset-badge ${mod ? 'modified' : ''}" id="preset_badge_${esc(item.key)}">${mod ? '已修改' : '默认'}</span>
                            </div>
                            <div class="preset-card-desc">${esc(item.desc)}</div>
                        </div>
                        <div class="preset-card-right">
                            <button type="button" class="mini-btn" style="padding:3px 8px;font-size:11px;" onclick="event.stopPropagation();window.PresetsUI.resetOne('${esc(item.key)}')" title="将此项恢复为出厂默认">↩️ 恢复默认</button>
                            <span class="preset-chevron">▼</span>
                        </div>
                    </div>
                    <div class="preset-card-body">
                        <textarea id="preset_ta_${esc(item.key)}" oninput="window.PresetsUI.onEdit('${esc(item.key)}')">${esc(val)}</textarea>
                    </div>
                </div>
            `;
        }).join('');
    }

    function getOpenCardKeys() {
        const openKeys = new Set();
        document.querySelectorAll('.preset-card.open').forEach(el => {
            const k = el.id.replace(/^preset_card_/, '');
            if (k) openKeys.add(k);
        });
        return openKeys;
    }

    async function fetchPresetsFromServer() {
        const res = await fetch(`${API_BASE}/api/presets`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '读取预设失败');
        presetsState = {
            meta: data.meta || [],
            defaults: data.defaults || {},
            current: data.current || {},
            profiles: data.profiles || []
        };
    }

    function toggleCard(key) {
        const card = document.getElementById(`preset_card_${key}`);
        if (card) card.classList.toggle('open');
    }

    function toggleExpandAll() {
        allExpanded = !allExpanded;
        document.querySelectorAll('.preset-card').forEach(c => c.classList.toggle('open', allExpanded));
        const btn = document.getElementById('presetToggleExpandBtn');
        if (btn) btn.innerText = allExpanded ? '📁 全部收起' : '📂 全部展开';
    }

    async function resetOne(key) {
        const metaItem = presetsState.meta.find(m => m.key === key);
        const title = metaItem ? metaItem.label : key;
        if (!confirm(`确定将【${title}】恢复为出厂默认吗？`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/presets/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '恢复失败');
            presetsState.current = data.current || presetsState.current;
            const ta = document.getElementById(`preset_ta_${key}`);
            if (ta) ta.value = presetsState.current[key] || '';
            refreshBadge(key);
            if (key === 'systemPreset' || key === 'voicePrompt') {
                if (typeof loadConfig === 'function') await loadConfig();
            }
            setStatus(`✅ 【${title}】已恢复出厂默认并热生效！`, '#4ade80');
        } catch (e) {
            setStatus(`❌ 恢复失败：${e.message}`, '#f87171');
        }
    }

    async function resetAllFactory() {
        if (!confirm(`确定要将全部 ${presetsState.meta.length} 项 Prompt 一键恢复为出厂默认吗？\n（已保存的预设套装不会被删除）`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/presets/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'ALL' })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '重置失败');
            presetsState.current = data.current || {};
            renderAccordion(getOpenCardKeys());
            if (typeof loadConfig === 'function') await loadConfig();
            setStatus(`✅ 全部 ${presetsState.meta.length} 项预设已恢复出厂默认并热生效！`, '#4ade80');
        } catch (e) {
            setStatus(`❌ 重置失败：${e.message}`, '#f87171');
        }
    }

    async function saveProfile() {
        const inp = document.getElementById('presetNewProfileName');
        const name = (inp?.value || '').trim();
        if (!name) {
            setStatus('⚠️ 请先输入一个预设套装名称哦～', '#fbbf24');
            inp?.focus();
            return;
        }
        try {
            const edited = collectEditedPresets();
            const res = await fetch(`${API_BASE}/api/presets/profiles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data: edited })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '保存套装失败');
            presetsState.profiles = data.profiles || [];
            if (inp) inp.value = '';
            renderProfiles();
            setStatus(`✅ 预设套装【${data.name}】已存入 data/presets/profiles/！`, '#4ade80');
        } catch (e) {
            setStatus(`❌ ${e.message}`, '#f87171');
        }
    }

    async function applyProfile(name) {
        if (!name) return;
        if (!confirm(`确定切换并应用预设套装【${name}】吗？当前编辑框内容将被替换为该套装。`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/presets/profiles/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '切换失败');
            presetsState.current = data.current || {};
            renderAccordion(getOpenCardKeys());
            if (typeof loadConfig === 'function') await loadConfig();
            setStatus(`✨ 已切换到预设套装【${name}】并立即热生效！`, '#4ade80');
        } catch (e) {
            setStatus(`❌ ${e.message}`, '#f87171');
        }
    }

    async function deleteProfile(name) {
        if (!name) return;
        if (!confirm(`确定删除预设套装【${name}】吗？此操作不可撤销。`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/presets/profiles/${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '删除失败');
            presetsState.profiles = data.profiles || [];
            renderProfiles();
            setStatus(`🗑️ 已删除预设套装【${name}】`, '#fbbf24');
        } catch (e) {
            setStatus(`❌ ${e.message}`, '#f87171');
        }
    }

    function exportJson() {
        const payload = collectEditedPresets();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateTag = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `study-room-presets-${dateTag}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(`📤 已导出当前 ${presetsState.meta.length} 项预设 JSON 文件！`, '#4ade80');
    }

    function handleImportFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!parsed || typeof parsed !== 'object') throw new Error('JSON 格式不正确');
                let importedCount = 0;
                for (const item of presetsState.meta) {
                    if (typeof parsed[item.key] === 'string') {
                        const ta = document.getElementById(`preset_ta_${item.key}`);
                        if (ta) {
                            ta.value = parsed[item.key];
                            refreshBadge(item.key);
                            importedCount++;
                        }
                    }
                }
                if (importedCount === 0) throw new Error('未在文件中找到可识别的预设字段');
                setStatus(`📥 已载入 ${importedCount} 项预设到编辑框！点下方「保存全部预设」即可生效～`, '#fbbf24');
            } catch (err) {
                setStatus(`❌ 导入失败：${err.message}`, '#f87171');
            }
        };
        reader.readAsText(file, 'utf-8');
        event.target.value = '';
    }

    // 3. 接管「🎛️ 配置」弹窗的打开与保存
    window.openPromptConfigModal = async function () {
        const lim = (typeof appConfig !== 'undefined' && appConfig.contextLimit !== undefined) ? appConfig.contextLimit : 24;
        const slider = document.getElementById('cfgContextLimit');
        if (slider) slider.value = lim;
        if (typeof updateContextLimitUI === 'function') updateContextLimitUI(lim);
        setStatus('');
        document.getElementById('promptConfigModal')?.classList.add('open');

        try {
            const [, memSt] = await Promise.all([
                fetchPresetsFromServer(),
                fetch(`${API_BASE}/api/memory/stats`).then(r => r.json()).catch(() => null)
            ]);
            renderProfiles();
            renderAccordion();
            if (memSt && memSt.success) {
                if (typeof appConfig !== 'undefined') appConfig.memoryCount = memSt.memoryCount;
                const lbl = document.getElementById('memoryCountLabel');
                if (lbl) lbl.innerText = `【${memSt.charName || appConfig.charName}】独立记忆 · 已存 ${memSt.memoryCount} 条`;
            }
        } catch (e) {
            setStatus(`❌ 读取预设圣殿失败：${e.message}`, '#f87171');
        }
    };

    window.savePromptConfigPanel = async function () {
        const btn = document.getElementById('presetSaveAllBtn');
        if (btn) { btn.disabled = true; btn.innerText = '💾 保存中...'; }
        try {
            const edited = Object.fromEntries(Object.entries(collectEditedPresets())
                .filter(([key, value]) => value !== (presetsState.current[key] ?? '')));
            const contextLimit = parseInt(document.getElementById('cfgContextLimit')?.value, 10) || 0;

            const [pRes, cRes] = await Promise.all([
                fetch(`${API_BASE}/api/presets/current`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(edited)
                }),
                fetch(`${API_BASE}/api/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contextLimit })
                })
            ]);

            const pData = await pRes.json();
            const cData = await cRes.json();
            if (!pRes.ok || !pData.success) throw new Error(pData.message || '保存预设失败');
            if (!cRes.ok || !cData.success) throw new Error(cData.message || '保存记忆配置失败');

            presetsState.current = pData.current || edited;
            if (typeof loadConfig === 'function') await loadConfig();
            if (typeof closeModal === 'function') closeModal('promptConfigModal');
            if (typeof showCommBanner === 'function') {
                showCommBanner('🎛️ 预设圣殿已热生效', `全部 ${presetsState.meta.length} 项 Prompt 与上下文条数（${contextLimit} 条）已保存～`, false);
            }
        } catch (e) {
            setStatus(`❌ 保存失败：${e.message}`, '#f87171');
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '💾 保存全部预设与记忆配置'; }
        }
    };

    // 4. 接管清空记忆与通讯重置（同步清便签墙 + 相框公开状态 + 播报真实清理条数）
    window.clearAllMemory = async function () {
        const name = (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';
        if (!confirm(`确定要彻底清空【${name}】的专属记忆、通讯记录与书桌便利贴吗？\n（其他角色卡不受影响；桌面相框将暂设为“仅自己看”防穿帮，但保留识图缓存）`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/memory?clearChat=true&clearNotes=true&hideWidgets=true`, { method: 'DELETE' });
            const data = await res.json();
            if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
            if (typeof renderChatMessages === 'function') renderChatMessages([]);
            if (typeof appConfig !== 'undefined') appConfig.memoryCount = 0;
            const lbl = document.getElementById('memoryCountLabel');
            if (lbl) lbl.innerText = `【${name}】独立记忆 · 已存 0 条`;
            if (typeof loadNotes === 'function') await loadNotes();
            if (typeof loadWidgets === 'function') await loadWidgets();
            if (typeof showCommBanner === 'function') {
                showCommBanner(
                    '🧹 记忆已彻底归零',
                    `【${name}】已清理 ${data.memDel || 0} 条记忆、${data.chatDel || 0} 条聊天、${data.notesDel || 0} 张便签，旧划线与摸鱼已隔离，相框已暂切“仅自己看”～`,
                    false
                );
            }
        } catch (e) {
            setStatus(`❌ 清空失败：${e.message}`, '#f87171');
        }
    };

    window.executeClearChat = async function (syncAll) {
        if (typeof closeModal === 'function') closeModal('clearChatModal');
        const name = (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';
        try {
            const res = await fetch(`${API_BASE}/api/chat?syncMemory=${syncAll ? 'true' : 'false'}`, { method: 'DELETE' });
            const data = await res.json();
            if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
            if (typeof renderChatMessages === 'function') renderChatMessages([]);
            if (syncAll) {
                if (typeof appConfig !== 'undefined') appConfig.memoryCount = 0;
                const lbl = document.getElementById('memoryCountLabel');
                if (lbl) lbl.innerText = `【${name}】独立记忆 · 已存 0 条`;
                if (typeof loadNotes === 'function') await loadNotes();
                if (typeof loadWidgets === 'function') await loadWidgets();
            }
            if (typeof showCommBanner === 'function') {
                showCommBanner(
                    syncAll ? '🧹 已彻底重置' : '🫧 已清空气泡',
                    syncAll
                        ? `【${name}】的 ${data.memDel || 0} 条记忆、通讯气泡与书桌便签已归零，相框已暂切“仅自己看”～`
                        : `通讯气泡已清空，【${name}】仍记得之前的互动哦～`,
                    false
                );
            }
        } catch (e) {
            if (typeof showCommBanner === 'function') showCommBanner('⚠️ 清理失败', e.message, false);
        }
    };

    // 5. 顺手热修复 index.html 里那 3 个隐藏小错名，完全无需手动翻行改 HTML！
    function applyRuntimeHotfixes() {
        // (1) 修复书架临时读物「+ 收入书架」按钮函数名不匹配
        if (typeof window.saveCurrentBookToShelf !== 'function' && typeof window.saveCurrentTempBookToShelf === 'function') {
            window.saveCurrentBookToShelf = window.saveCurrentTempBookToShelf;
        }
        // (2) 修复粘贴新书弹窗「保存到书架」勾选框 ID 错位
        if (typeof window.submitPasteBook === 'function') {
            window.submitPasteBook = async function () {
                const title = document.getElementById('pasteBookTitle')?.value.trim() || '未命名读物';
                const content = document.getElementById('pasteBookContent')?.value.trim() || '';
                if (!content) return;
                const saveChk = document.getElementById('pasteSaveToShelf') || document.getElementById('pasteBookSaveToShelf');
                const saveToShelf = saveChk ? saveChk.checked : true;
                if (typeof saveAndOpenBook === 'function') await saveAndOpenBook(title, content, saveToShelf);
                if (typeof closeModal === 'function') closeModal('pasteBookModal');
            };
        }
        // (3) 修复歌单目录弹窗容器 ID 错位（#playlistCatalogList）
        window.renderPlaylistDirectory = function () {
            const box = document.getElementById('playlistCatalogList')
                || document.getElementById('playlistDirectoryList')
                || document.getElementById('playlistList');
            const hint = document.getElementById('playlistHintText') || document.getElementById('playlistSummaryText');
            if (typeof playlist === 'undefined') return;
            if (hint) {
                hint.innerText = `共 ${playlist.length} 首曲目 · 点击曲目即可点播（自定义曲目存于 data/music/playlist.db）`;
            }
            if (!box) return;
            box.innerHTML = playlist.map((s, idx) => {
                const isCur = idx === currentSongIndex;
                const isBuiltin = String(s.id).startsWith('builtin-');
                return `<div class="catalog-item ${isCur ? 'active' : ''}" onclick="selectSongFromDirectory(${idx})">
                    <div class="catalog-info">
                        <div class="catalog-title">${isCur ? '🎵 ' : ''}${esc(s.title)}</div>
                        <div class="catalog-meta">
                            <span class="catalog-tag ${isCur ? 'cur' : ''}">${isCur ? '正在播放' : (isBuiltin ? '内置白噪音' : '自定义收藏')}</span>
                        </div>
                    </div>
                    ${isBuiltin ? '' : `<button type="button" class="mini-btn" style="padding:3px 7px;color:#fca5a5;border-color:rgba(239,68,68,0.35);" onclick="deleteSongFromPlaylist(${s.id}, event)" title="删除歌曲">🗑️</button>`}
                </div>`;
            }).join('');
        };
    }

    window.PresetsUI = {
        toggleCard,
        toggleExpandAll,
        onEdit: refreshBadge,
        resetOne,
        resetAllFactory,
        saveProfile,
        applyProfile,
        deleteProfile,
        exportJson,
        handleImportFile
    };

    injectStyles();
    upgradePromptConfigModalDom();
    applyRuntimeHotfixes();
})();