// public/memory-ui.js —— 顶部独立「🧠 记忆」全局上下文可视化勾选管理器 + 真实水位线联动 + 相框 <memo> 透视
(function () {
    let memData = {
        activeCharKey: '',
        charName: 'TA',
        memoryFile: '',
        maxContextRounds: 40,
        contextLimit: 80,
        windowInfo: null,
        totalCount: 0,
        items: [],
        widgets: []
    };
    let activeFilter = 'ALL';
    let selectedIds = new Set();

    const TYPE_META = {
        chat: { label: '💬 通讯', cls: 't-chat', group: 'chat' },
        highlight: { label: '✒️ 划线', cls: 't-hl', group: 'highlight' },
        highlight_peek: { label: '🔓 偷看批注', cls: 't-hl', group: 'highlight' },
        note_user: { label: '📌 你的便签', cls: 't-note', group: 'note' },
        note_exchange: { label: '📌 便签互动', cls: 't-note', group: 'note' },
        note_summon: { label: '✨ 戳TA便签', cls: 't-note', group: 'note' },
        music: { label: '💿 切歌审批', cls: 't-music', group: 'music' },
        widget_show: { label: '🖼️ 看相框', cls: 't-widget', group: 'widget' },
        slack: { label: '👀 摸鱼抓包', cls: 't-focus', group: 'focus' },
        focus_decision: { label: '⏱️ 专注结算', cls: 't-focus', group: 'focus' },
        archive: { label: '📖 历史手账', cls: 't-other', group: 'other' }
    };

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtTime(raw) {
        if (!raw) return '';
        const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') || String(raw).includes('+') ? '' : 'Z'));
        if (isNaN(d.getTime())) return String(raw).slice(5, 16);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}-${dd} ${hh}:${mi}`;
    }

    function getTypeInfo(evType) {
        return TYPE_META[evType] || { label: `🧩 ${evType || '互动'}`, cls: 't-other', group: 'other' };
    }

    function injectStyles() {
        if (document.getElementById('memoryUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'memoryUiStyles';
        style.textContent = `
            #memoryManagerModal .modal-box {
                max-width: 740px;
                width: 94%;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                padding: 20px 22px 16px;
            }
            #memoryManagerModal .modal-box { box-sizing:border-box; max-height:min(90vh, 100%); overflow:auto; }
            #memoryManagerModal .memo-pane { min-width:0; min-height:0; overflow:auto; }
            #memoryManagerModal .mem-summary-strip > * { min-width:0; max-width:100%; box-sizing:border-box; }
            #memoryManagerModal .mem-summary-strip code { display:block; overflow-wrap:anywhere; white-space:normal; word-break:break-all; }
            @media(max-width:600px) {
                #memoryManagerModal .modal-box { padding:14px; max-height:90dvh; }
                #memoryManagerModal .mem-list-scroll { min-height:100px; }
                #memoryManagerModal .mem-footer-actions button { max-width:100%; white-space:normal; }
            }
            .mem-summary-strip {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 11px;
                padding: 10px 13px;
                margin-bottom: 10px;
                font-size: 12px;
                color: #d6d3d1;
                line-height: 1.55;
            }
            .mem-summary-strip code {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 11px;
                color: #86efac;
                background: rgba(74, 222, 128, 0.12);
                padding: 2px 7px;
                border-radius: 6px;
            }
            .mem-summary-pills {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 4px;
            }
            .mem-stat-chip {
                font-size: 11px;
                padding: 1px 8px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid #33302d;
                color: #d6d3d1;
            }
            .mem-stat-chip.live {
                background: rgba(74, 222, 128, 0.13);
                border-color: rgba(74, 222, 128, 0.35);
                color: #86efac;
            }
            .mem-stat-chip.warn {
                background: rgba(251, 191, 36, 0.15);
                border-color: rgba(251, 191, 36, 0.4);
                color: #fde68a;
            }
            .mem-widget-box {
                background: rgba(56, 189, 248, 0.07);
                border: 1px solid rgba(56, 189, 248, 0.25);
                border-radius: 11px;
                padding: 9px 12px;
                margin-bottom: 10px;
                font-size: 11.5px;
                color: #e0f2fe;
            }
            .mem-widget-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 6px;
            }
            .mem-widget-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                padding: 5px 8px;
                border-radius: 7px;
                background: rgba(0, 0, 0, 0.24);
                margin-top: 5px;
            }
            .mem-filter-row, .mem-quick-row {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                margin-bottom: 8px;
            }
            .mem-pill {
                background: #292524;
                border: 1px solid #44403c;
                color: #d6d3d1;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 11.5px;
                cursor: pointer;
                transition: all 0.16s;
            }
            .mem-pill:hover { border-color: var(--accent, #d97706); color: #fef3c7; }
            .mem-pill.active {
                background: var(--accent, #d97706);
                border-color: var(--accent, #d97706);
                color: var(--text-on-accent, #fff);
                font-weight: 600;
            }
            .mem-list-scroll {
                flex: 1;
                min-height: 200px;
                max-height: 44vh;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 7px;
                padding-right: 4px;
                margin-bottom: 12px;
            }
            .mem-item-card {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 11px;
                padding: 10px 12px;
                cursor: pointer;
                transition: all 0.16s;
            }
            .mem-item-card.is-out-window {
                opacity: 0.62;
                border-style: dashed;
            }
            .mem-item-card:hover { opacity: 1; border-color: #57534e; background: #1e1c1a; }
            .mem-item-card.checked {
                opacity: 1;
                border-color: rgba(239, 68, 68, 0.65);
                background: rgba(220, 38, 38, 0.10);
            }
            .mem-item-card input[type="checkbox"] {
                width: 16px;
                height: 16px;
                margin-top: 2px;
                accent-color: #ef4444;
                cursor: pointer;
                flex-shrink: 0;
            }
            .mem-item-body { flex: 1; min-width: 0; }
            .mem-item-top {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                margin-bottom: 5px;
                font-size: 11px;
            }
            .mem-tag {
                padding: 1px 7px;
                border-radius: 999px;
                font-weight: 500;
                font-size: 10.5px;
            }
            .mem-tag.role-user { background: rgba(10, 132, 255, 0.22); color: #93c5fd; }
            .mem-tag.role-ai { background: rgba(217, 119, 6, 0.22); color: #fde68a; }
            .mem-tag.t-chat { background: rgba(255,255,255,0.09); color: #e7e5e4; }
            .mem-tag.t-hl { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
            .mem-tag.t-note { background: rgba(250, 204, 21, 0.18); color: #fef08a; }
            .mem-tag.t-music { background: rgba(236, 72, 153, 0.2); color: #fbcfe8; }
            .mem-tag.t-widget { background: rgba(56, 189, 248, 0.2); color: #bae6fd; }
            .mem-tag.t-focus { background: rgba(249, 115, 22, 0.2); color: #fed7aa; }
            .mem-tag.t-other { background: rgba(255,255,255,0.08); color: #a8a29e; }
            .mem-tag.in-ctx { background: rgba(74, 222, 128, 0.16); color: #86efac; border: 1px solid rgba(74, 222, 128, 0.3); }
            .mem-tag.out-ctx { background: rgba(120, 113, 108, 0.16); color: #a8a29e; }
            .mem-time { color: #78716c; margin-left: auto; font-variant-numeric: tabular-nums; }
            .mem-content {
                font-size: 12.5px;
                color: #f5f5f4;
                line-height: 1.52;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .mem-footer-bar {
                border-top: 1px solid #33302d;
                padding-top: 11px;
                display: flex;
                flex-direction: column;
                gap: 9px;
            }
            .mem-footer-actions {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
        `;
        document.head.appendChild(style);
    }

    function mountTopBarButton() {
        if (document.getElementById('openMemoryMgrBtn')) return;
        const barRight = document.querySelector('.top-bar-right');
        if (!barRight) return;
        const btn = document.createElement('button');
        btn.id = 'openMemoryMgrBtn';
        btn.className = 'icon-btn ai-only';
        btn.innerText = '🧠 记忆';
        btn.title = '查看与勾选管理当前角色的全局互动记忆与动态备忘录引擎';
        btn.onclick = () => openMemoryManagerModal();

        const configBtn = Array.from(barRight.children).find(el => el.textContent.includes('配置'));
        if (configBtn) barRight.insertBefore(btn, configBtn);
        else barRight.appendChild(btn);
    }

    function mountModalDom() {
        if (document.getElementById('memoryManagerModal')) return;
        const wrap = document.createElement('div');
        wrap.id = 'memoryManagerModal';
        wrap.className = 'modal-backdrop';
        wrap.onclick = (e) => { if (e.target === wrap) closeModal('memoryManagerModal'); };
        wrap.innerHTML = `
            <div class="modal-box">
                <h3 style="margin-bottom:10px;">
                    <span>🧠 当前角色记忆</span>
                    <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('memoryManagerModal')">✕</span>
                </h3>

                <div class="mem-summary-strip" id="memSummaryStrip">
                    <span>正在加载当前角色记忆库...</span>
                </div>

                <!-- 🖼️ 相框 <memo> 实时透视区 -->
                <div class="mem-widget-box" id="memWidgetMemoBox" style="display:none;"></div>

                <!-- 分类筛选 -->
                <div class="mem-filter-row" id="memFilterRow">
                    <button type="button" class="mem-pill active" data-filter="ALL" onclick="window.MemoryUI.setFilter('ALL')">全部</button>
                    <button type="button" class="mem-pill" data-filter="chat" onclick="window.MemoryUI.setFilter('chat')">💬 通讯</button>
                    <button type="button" class="mem-pill" data-filter="highlight" onclick="window.MemoryUI.setFilter('highlight')">✒️ 划线</button>
                    <button type="button" class="mem-pill" data-filter="note" onclick="window.MemoryUI.setFilter('note')">📌 便利贴</button>
                    <button type="button" class="mem-pill" data-filter="music" onclick="window.MemoryUI.setFilter('music')">💿 切歌</button>
                    <button type="button" class="mem-pill" data-filter="widget" onclick="window.MemoryUI.setFilter('widget')">🖼️ 相框</button>
                    <button type="button" class="mem-pill" data-filter="focus" onclick="window.MemoryUI.setFilter('focus')">⏱️ 专注/摸鱼</button>
                </div>

                <!-- 快捷批量勾选 -->
                <div class="mem-quick-row">
                    <span style="font-size:11.5px;color:#a8a29e;">快捷勾选：</span>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.selectRecent(1)">最新 1 条</button>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.selectRecent(2)">最新 2 条</button>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.selectRecent(5)">最新 5 条</button>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.selectRecent(10)">最新 10 条</button>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.selectAllVisible()">全选当前</button>
                    <button type="button" class="mini-btn" onclick="window.MemoryUI.clearSelection()">清空勾选</button>
                </div>

                <!-- 上下文记忆勾选列表 -->
                <div class="mem-list-scroll" id="memItemsList"></div>

                <!-- 底部操作栏 -->
                <div class="mem-footer-bar">
                    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d6d3d1;cursor:pointer;">
                        <input type="checkbox" id="memSyncDeleteChat" checked style="width:15px;height:15px;accent-color:var(--accent);">
                        <span>删除勾选的「💬 通讯」记忆时，同步删除聊天框里对应的气泡</span>
                    </label>
                    <div class="mem-footer-actions">
                        <button type="button" class="btn-danger-ghost" onclick="window.MemoryUI.wipeAllFromModal()">🧹 一键彻底清空该角色</button>
                        <button type="button" class="btn btn-danger" id="memDeleteSelectedBtn" style="padding:8px 18px;font-size:13px;" disabled onclick="window.MemoryUI.deleteSelected()">🗑️ 删除已勾选 (0)</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);
    }

    function getFilteredItems() {
        const list = memData.items || [];
        if (activeFilter === 'ALL') return list;
        return list.filter(it => getTypeInfo(it.event_type).group === activeFilter);
    }

    function updateDeleteButtonUI() {
        const btn = document.getElementById('memDeleteSelectedBtn');
        if (!btn) return;
        const cnt = selectedIds.size;
        btn.disabled = cnt === 0;
        btn.innerText = `🗑️ 删除已勾选 (${cnt} 条)`;
        btn.style.opacity = cnt === 0 ? '0.45' : '1';
    }

    function renderWidgetMemoStrip() {
        const box = document.getElementById('memWidgetMemoBox');
        if (!box) return;
        const activeWidgets = (memData.widgets || []).filter(w => w.ai_memo || w.visible_to_ai);
        if (!activeWidgets.length) {
            box.style.display = 'none';
            return;
        }
        box.style.display = 'block';
        box.innerHTML = `
            <div class="mem-widget-head">
                <span>🖼️ <strong>桌面相框画面记忆（&lt;memo&gt; 全局缓存）</strong> · 公开时实时注入房间状态</span>
                <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;border-color:rgba(248,113,113,0.45);color:#fca5a5;" onclick="window.MemoryUI.clearWidgetMemos()">🧹 全部撕掉缓存</button>
            </div>
            ${activeWidgets.map(w => `
                <div class="mem-widget-item">
                    <div style="min-width:0;flex:1;">
                        <span style="color:${w.visible_to_ai ? '#4ade80' : '#a8a29e'};font-weight:600;">${w.visible_to_ai ? '👁️ TA可见' : '🙈 仅自己看'}</span>
                        ${w.caption ? ` · 备注「${esc(w.caption)}」` : ''}
                        <div style="color:#bae6fd;margin-top:2px;word-break:break-word;">${w.ai_memo ? `记忆：${esc(w.ai_memo)}` : '（尚无识图缓存，开启公开时将新识图）'}</div>
                    </div>
                    <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;flex-shrink:0;" onclick="window.MemoryUI.clearWidgetMemos(${w.id})">撕掉此缓存</button>
                </div>
            `).join('')}
        `;
    }

    function renderSummaryStrip() {
        const summary = document.getElementById('memSummaryStrip');
        if (!summary) return;

        const w = memData.windowInfo || {
            mode: 'sliding',
            maxContextRounds: memData.maxContextRounds || 40,
            maxContextMsgs: memData.contextLimit || 80,
            dropRounds: 10,
            windowStartId: 0,
            activeCount: 0,
            activeRounds: 0,
            willEvictNextTurn: false,
            memoEnabled: false,
            hasMemoContent: false
        };

        const modeText = w.mode === 'batch_evict'
            ? `✂️ 批量抛弃 · 水位 #${w.windowStartId}（满值抛 ${w.dropRounds} 轮）`
            : `🪟 标准滑窗`;

        const activeText = w.maxContextRounds <= 0
            ? `⚪ 无历史模式（0 轮）`
            : `🟢 正在喂给模型：${w.activeCount} 条（约 ${w.activeRounds} / ${w.maxContextRounds} 轮）`;

        const memoChip = w.memoEnabled
            ? (w.hasMemoContent ? `<span class="mem-stat-chip live">📝 备忘录已注入</span>` : `<span class="mem-stat-chip">📝 备忘录已开（待生成）</span>`)
            : `<span class="mem-stat-chip">📝 备忘录未启用</span>`;

        const evictWarnChip = w.willEvictNextTurn
            ? `<span class="mem-stat-chip warn">⚡ 已达上限，下轮触发抛弃</span>`
            : '';

        summary.innerHTML = `
            <div style="flex:1 1 240px;min-width:0;overflow-wrap:anywhere;">
                <div>当前角色：<strong>${esc(memData.charName)}</strong> · 库中共存 <strong>${memData.totalCount}</strong> 条记忆</div>
                <div class="mem-summary-pills">
                    <span class="mem-stat-chip live">${activeText}</span>
                    <span class="mem-stat-chip">${modeText}</span>
                    ${memoChip}
                    ${evictWarnChip}
                </div>
            </div>
            <code>data/memory/${esc(memData.memoryFile || 'default.db')}</code>
        `;
    }

    function renderItemsList() {
        renderSummaryStrip();

        document.querySelectorAll('#memFilterRow .mem-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === activeFilter);
        });

        renderWidgetMemoStrip();

        const box = document.getElementById('memItemsList');
        if (!box) return;

        const filtered = getFilteredItems();

        if (!filtered.length) {
            box.innerHTML = `<div style="text-align:center;color:#78716c;font-size:12.5px;padding:36px 0;">✨ 当前分类下没有任何上下文记忆，干净得像一张白纸～</div>`;
            updateDeleteButtonUI();
            return;
        }

        const uName = (typeof appConfig !== 'undefined' && appConfig.userName) || '我';
        const cName = memData.charName || 'TA';

        box.innerHTML = filtered.map(item => {
            const checked = selectedIds.has(item.id);
            const tInfo = getTypeInfo(item.event_type);
            const isUser = item.role !== 'assistant';
            const inCtx = Boolean(item.in_window);
            const outLabel = item.window_reason === 'evicted' ? '⚪ 已抛弃滑出' : '⚪ 已滑出窗口';

            return `
                <div class="mem-item-card ${inCtx ? '' : 'is-out-window'} ${checked ? 'checked' : ''}" onclick="window.MemoryUI.toggleItem(${item.id})">
                    <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();window.MemoryUI.toggleItem(${item.id})">
                    <div class="mem-item-body">
                        <div class="mem-item-top">
                            <span class="mem-tag ${isUser ? 'role-user' : 'role-ai'}">${isUser ? `👤 ${esc(uName)}` : `🪪 ${esc(cName)}`}</span>
                            <span class="mem-tag ${tInfo.cls}">${esc(tInfo.label)}</span>
                            <span class="mem-tag ${inCtx ? 'in-ctx' : 'out-ctx'}">${inCtx ? '🟢 生效中' : outLabel}</span>
                            <span class="mem-time">#${item.id} · ${esc(fmtTime(item.created_at))}</span>
                        </div>
                        <div class="mem-content">${esc(item.content)}</div>
                    </div>
                </div>
            `;
        }).join('');

        updateDeleteButtonUI();
    }

    async function refreshMemoryList() {
        const box = document.getElementById('memItemsList');
        if (box) box.innerHTML = `<div style="text-align:center;color:#78716c;font-size:12px;padding:30px 0;">⏳ 正在读取独立记忆库...</div>`;
        try {
            const res = await fetch(`${API_BASE}/api/memory/list`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '读取失败');
            memData = data;
            const validSet = new Set((data.items || []).map(x => x.id));
            selectedIds = new Set(Array.from(selectedIds).filter(id => validSet.has(id)));
            renderItemsList();
        } catch (e) {
            if (box) box.innerHTML = `<div style="text-align:center;color:#f87171;font-size:12px;padding:24px 0;">❌ 读取记忆失败：${esc(e.message)}</div>`;
        }
    }

    async function openMemoryManagerModal() {
        if (typeof appConfig !== 'undefined' && appConfig.soloMode) return;
        activeFilter = 'ALL';
        selectedIds.clear();
        document.getElementById('memoryManagerModal')?.classList.add('open');
        await refreshMemoryList();
    }

    function setFilter(f) {
        activeFilter = f;
        renderItemsList();
    }

    function toggleItem(id) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        renderItemsList();
    }

    function selectRecent(n) {
        selectedIds.clear();
        const filtered = getFilteredItems();
        for (const it of filtered.slice(0, n)) selectedIds.add(it.id);
        renderItemsList();
    }

    function selectAllVisible() {
        for (const it of getFilteredItems()) selectedIds.add(it.id);
        renderItemsList();
    }

    function clearSelection() {
        selectedIds.clear();
        renderItemsList();
    }

    async function deleteSelected() {
        const ids = Array.from(selectedIds);
        if (!ids.length) return;
        const syncChat = Boolean(document.getElementById('memSyncDeleteChat')?.checked);

        const byId = new Map((memData.items || []).map(x => [x.id, x]));
        const typeCounts = new Map();
        for (const id of ids) {
            const it = byId.get(id);
            const label = getTypeInfo(it?.event_type).label;
            typeCounts.set(label, (typeCounts.get(label) || 0) + 1);
        }
        const detailLines = Array.from(typeCounts.entries()).map(([k, v]) => `· ${k}：${v} 条`).join('\n');
        const msg = `确认删除已勾选的 ${ids.length} 条上下文记忆吗？\n\n${detailLines}\n\n${syncChat ? '（勾选的通讯记忆将同步删除对应聊天气泡）' : '（仅删脑内记忆，保留聊天框气泡）'}`;
        if (!confirm(msg)) return;

        try {
            const res = await fetch(`${API_BASE}/api/memory/delete-selected`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, syncChat })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '删除失败');

            selectedIds.clear();
            await refreshMemoryList();
            if (typeof loadChatHistory === 'function') await loadChatHistory();
            if (typeof showCommBanner === 'function') {
                showCommBanner(
                    '🧠 已精准清理所选记忆',
                    `已删除 ${data.deletedMemory || 0} 条上下文记忆${data.deletedChat ? `，并同步清理 ${data.deletedChat} 条对应气泡` : ''}～`,
                    false
                );
            }
        } catch (e) {
            alert('删除失败：' + e.message);
        }
    }

    async function clearWidgetMemos(widgetId = null) {
        const tip = widgetId
            ? '确定撕掉这张相框的 <memo> 画面记忆缓存并设为“仅自己看”吗？下次再公开给 TA 看将重新识图。'
            : '确定清空所有相框的 <memo> 画面记忆缓存并全部设为“仅自己看”吗？';
        if (!confirm(tip)) return;
        try {
            const res = await fetch(`${API_BASE}/api/widgets/clear-memos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(widgetId ? { widgetId } : {})
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '清理失败');
            await refreshMemoryList();
            if (typeof loadWidgets === 'function') await loadWidgets();
            if (typeof showCommBanner === 'function') {
                showCommBanner('🖼️ 相框记忆缓存已撕掉', '下次点击「给 TA 看」将触发全新识图反应～', false);
            }
        } catch (e) {
            alert('清理失败：' + e.message);
        }
    }

    async function wipeAllFromModal() {
        if (typeof window.clearAllMemory === 'function') {
            await window.clearAllMemory();
            await refreshMemoryList();
            if (window.MemoUI?.reload) window.MemoUI.reload();
        }
    }

    window.MemoryUI = {
        open: openMemoryManagerModal,
        refresh: refreshMemoryList,
        setFilter,
        toggleItem,
        selectRecent,
        selectAllVisible,
        clearSelection,
        deleteSelected,
        clearWidgetMemos,
        wipeAllFromModal
    };

    injectStyles();
    mountTopBarButton();
    mountModalDom();
})();