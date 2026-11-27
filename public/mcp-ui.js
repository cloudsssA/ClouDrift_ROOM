// public/mcp-ui.js —— 「⚙️ 设置」里的标准 MCP 桥接配置中心（一键复制 AstrBot/Cherry Studio/Stdio 配置 + 自检 + 实时监听外部推送）
(function () {
    let mcpCfg = {
        mcpToken: '',
        mcpLiveSync: true,
        tools: []
    };

    let pollTimer = null;
    let pollInitialized = false;
    let knownCharKey = '';
    let knownChatId = 0;
    let knownNoteId = 0;
    let knownActionId = 0;

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getOriginBase() {
        if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000';
        return window.location.origin;
    }

    function buildEndpoints() {
        const base = getOriginBase();
        const tok = (document.getElementById('cfgMcpToken')?.value ?? mcpCfg.mcpToken ?? '').trim();
        const role = '?owner=' + encodeURIComponent(mcpCfg.owner || '');
        const q = role + (tok ? '&token=' + encodeURIComponent(tok) : '');
        return {
            base,
            token: tok,
            httpUrl: `${base}/mcp${role}`,
            sseUrl: `${base}/mcp/sse${q}`
        };
    }

    function copyText(text, label) {
        const st = document.getElementById('mcpBridgeStatus');
        const ok = () => {
            if (st) { st.style.color = '#4ade80'; st.innerText = `✅ 已复制【${label}】，直接去 AstrBot / 外部客户端粘贴即可！`; }
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(ok).catch(() => {
                fallbackCopy(text); ok();
            });
        } else {
            fallbackCopy(text); ok();
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        ta.remove();
    }

    // 1. 往「⚙️ 设置」弹窗注入 MCP 桥接中心卡片
    function injectMcpSettingsSection() {
        const modal = document.getElementById('settingsModal');
        if (!modal || document.getElementById('mcpBridgeSection')) return;

        const modeAnchor = document.getElementById('cfgMode')?.closest('.form-group');
        const box = document.createElement('div');
        box.id = 'mcpBridgeSection';
        box.className = 'settings-section-box';
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap;">
                <span style="font-size:13px;color:#fef3c7;font-weight:500;">🔌 标准 MCP 桥接中心（AstrBot / Cherry Studio / 外部小手机）</span>
                <button type="button" class="mini-btn" id="mcpSelfTestBtn" onclick="window.McpUI.selfTest()">⚡ 协议自检</button>
            </div>
            <div style="font-size:11.5px;color:#a8a29e;line-height:1.55;margin-bottom:8px;">
                配置固定到当前房间角色。选好已有角色卡，或在下方切换到独立外部身份，再复制该角色的配置。已暴露 <strong style="color:#fde68a;">角色专属 MCP 工具</strong>（读状态 / 读备忘录与记忆投影 / 贴便签 / 发小手机消息 / 批注划线 / 切歌审批 / 隔空逗桌宠点歌），支持 Streamable HTTP、SSE 与本地 Stdio 三协议接入。
            </div>
            <div class="form-group"><label>无本地卡的外部角色</label>
                <input id="externalRoleName" placeholder="固定身份标识，例如 AstrBot / K">
                <button type="button" class="mini-btn" id="useExternalRole">切换到此独立身份</button></div>
            <div class="form-group" style="margin-bottom:8px;">
                <label>MCP 访问令牌 Token（本地可留空；若暴露公网建议填一串密码防蹭连）</label>
                <div class="pwd-wrap">
                    <input id="cfgMcpToken" type="password" placeholder="留空表示免密本地直连" oninput="window.McpUI.refreshUrls()">
                    <button type="button" class="pwd-eye-btn" onclick="togglePwdVisibility('cfgMcpToken', this)" title="显示/隐藏 Token">👁️</button>
                </div>
            </div>
            <div style="background:#141312;border:1px solid #33302d;border-radius:9px;padding:8px 10px;font-size:11.5px;margin-bottom:9px;display:flex;flex-direction:column;gap:5px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <span style="color:#a8a29e;white-space:nowrap;">HTTP 地址：</span>
                    <code id="mcpHttpUrlPreview" style="color:#86efac;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">http://127.0.0.1:3000/mcp</code>
                    <button type="button" class="mini-btn" style="padding:2px 7px;font-size:10.5px;" onclick="window.McpUI.copyEndpoint('http')">复制</button>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <span style="color:#a8a29e;white-space:nowrap;">SSE 地址：</span>
                    <code id="mcpSseUrlPreview" style="color:#93c5fd;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">http://127.0.0.1:3000/mcp/sse</code>
                    <button type="button" class="mini-btn" style="padding:2px 7px;font-size:10.5px;" onclick="window.McpUI.copyEndpoint('sse')">复制</button>
                </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                <button type="button" class="mini-btn" style="flex:1;border-color:rgba(74,222,128,0.4);color:#bbf7d0;" onclick="window.McpUI.copyJsonConfig('http')">📋 复制 AstrBot / HTTP JSON</button>
                <button type="button" class="mini-btn" style="flex:1;border-color:rgba(96,165,250,0.4);color:#bfdbfe;" onclick="window.McpUI.copyJsonConfig('sse')">📋 复制 SSE 配置 JSON</button>
                <button type="button" class="mini-btn" style="flex:1;" onclick="window.McpUI.copyJsonConfig('stdio')">📋 复制 Stdio 配置</button>
            </div>
            <label class="switch-row" style="padding:6px 0 0;border-top:1px dashed #33302d;">
                <span>📡 实时接收外部 MCP 推送<small>开启后外部 AstrBot 发来的消息、便签、切歌与逗桌宠动作会即时在网页显现，无需刷新</small></span>
                <input type="checkbox" id="cfgMcpLiveSync" checked>
            </label>
            <div class="status-msg" id="mcpBridgeStatus"></div>
        `;

        if (modeAnchor && modeAnchor.parentNode) {
            modeAnchor.parentNode.insertBefore(box, modeAnchor.nextSibling);
            box.querySelector('#useExternalRole').onclick = async () => {
                const identity=box.querySelector('#externalRoleName').value.trim();
                if (!identity) return box.querySelector('#externalRoleName').focus();
                if (!confirm('切换房间到外部角色「'+identity+'」并启用 MCP 模式？')) return;
                try {
                    const response=await fetch(API_BASE+'/api/mcp/external-identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity})});
                    if (!response.ok) throw Error('身份切换失败');
                    location.reload();
                } catch(err) { box.querySelector('#mcpBridgeStatus').textContent=err.message; }
            };
        }
    }

    function refreshUrls() {
        const ep = buildEndpoints();
        const hEl = document.getElementById('mcpHttpUrlPreview');
        const sEl = document.getElementById('mcpSseUrlPreview');
        if (hEl) hEl.innerText = ep.httpUrl;
        if (sEl) sEl.innerText = ep.sseUrl;
    }

    function fillMcpForm() {
        const tokInp = document.getElementById('cfgMcpToken');
        const liveChk = document.getElementById('cfgMcpLiveSync');
        const st = document.getElementById('mcpBridgeStatus');
        if (tokInp) tokInp.value = mcpCfg.mcpToken || '';
        if (liveChk) liveChk.checked = mcpCfg.mcpLiveSync !== false;
        if (st) st.innerText = '连接绑定角色：' + (mcpCfg.ownerName || '读取中');
        refreshUrls();
    }

    async function loadMcpConfig() {
        try {
            const res = await fetch(`${API_BASE}/api/mcp/bridge-config`);
            const data = await res.json();
            if (res.ok && data.success) {
                mcpCfg = { ...mcpCfg, ...data };
                syncLivePolling();
            }
        } catch {}
    }

    async function saveMcpConfigFromForm() {
        const payload = {
            mcpToken: document.getElementById('cfgMcpToken')?.value.trim() || '',
            mcpLiveSync: Boolean(document.getElementById('cfgMcpLiveSync')?.checked)
        };
        mcpCfg = { ...mcpCfg, ...payload };
        try {
            await fetch(`${API_BASE}/api/mcp/bridge-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch {}
        syncLivePolling();
    }

    function copyEndpoint(kind) {
        const ep = buildEndpoints();
        if (kind === 'sse') copyText(ep.sseUrl, 'MCP SSE 地址');
        else copyText(ep.httpUrl, 'MCP Streamable HTTP 地址');
    }

    function copyJsonConfig(kind) {
        const ep = buildEndpoints();
        let obj;
        if (kind === 'http') {
            obj = {
                mcpServers: {
                    'study-room': {
                        transport: 'streamable_http',
                        url: ep.httpUrl,
                        ...(ep.token ? { headers: { Authorization: `Bearer ${ep.token}` } } : {})
                    }
                }
            };
            copyText(JSON.stringify(obj, null, 2), 'AstrBot / Streamable HTTP 配置');
        } else if (kind === 'sse') {
            obj = {
                mcpServers: {
                    'study-room': {
                        type: 'sse',
                        url: ep.sseUrl,
                        ...(ep.token ? { headers: { Authorization: `Bearer ${ep.token}` } } : {})
                    }
                }
            };
            copyText(JSON.stringify(obj, null, 2), 'SSE 协议配置 JSON');
        } else {
            obj = {
                mcpServers: {
                    'study-room': {
                        command: 'node',
                        args: ['mcp-stdio.js'],
                        env: {
                            STUDY_ROOM_URL: ep.base, STUDY_ROOM_OWNER:mcpCfg.owner,
                            ...(ep.token ? { STUDY_ROOM_MCP_TOKEN: ep.token } : {})
                        }
                    }
                }
            };
            copyText(JSON.stringify(obj, null, 2), 'Stdio 本地命令行配置');
        }
    }

    async function selfTest() {
        const btn = document.getElementById('mcpSelfTestBtn');
        const st = document.getElementById('mcpBridgeStatus');
        if (btn) btn.disabled = true;
        if (st) { st.style.color = '#fbbf24'; st.innerText = '⚡ 正在发送 MCP JSON-RPC 2.0 握手与工具列表自检...'; }
        await saveMcpConfigFromForm();

        try {
            const ep = buildEndpoints();
            const headers = { 'Content-Type': 'application/json' };
            if (ep.token) headers['Authorization'] = `Bearer ${ep.token}`;

            const res = await fetch(ep.httpUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
            });
            const data = await res.json();
            const tools = data?.result?.tools;
            if (!res.ok || !Array.isArray(tools)) {
                throw new Error(data?.error?.message || `HTTP ${res.status}`);
            }
            if (st) {
                st.style.color = '#4ade80';
                st.innerText = `✅ MCP 协议畅通！已暴露 ${tools.length} 个标准工具：${tools.map(t => t.name).join(', ')}`;
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ 自检失败：${e.message}`; }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 2. 📡 实时监听外部 MCP 客户端推送（让 AstrBot 发的消息/便签/切歌/逗桌宠实时活起来！）
    function executeExternalAction(act) {
        if (!act) return;
        const charName = (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';

        if (act.type === 'pet') {
            const actor = document.querySelector('.pet-actor');
            if (!actor || actor.classList.contains('hidden')) return;
            if (act.action === 'feed' && window.StudyPet?.feed) {
                window.StudyPet.feed();
                setTimeout(() => {
                    document.dispatchEvent(new PointerEvent('pointerdown', {
                        clientX: Math.round(window.innerWidth * 0.5), clientY: 85, button: 0, bubbles: true, cancelable: true
                    }));
                }, 95);
            } else if (act.action === 'ball' && window.StudyPet?.playBall) {
                window.StudyPet.playBall();
                setTimeout(() => {
                    document.dispatchEvent(new PointerEvent('pointerdown', {
                        clientX: Math.round(window.innerWidth * 0.5), clientY: Math.round(window.innerHeight * 0.35), button: 0, bubbles: true, cancelable: true
                    }));
                }, 95);
            } else if (act.action === 'rage') {
                actor.classList.add('raging');
                window.StudyPet?.say?.(`喂！${charName}从外面隔空戳我💢`, 3200);
                setTimeout(() => actor.classList.remove('raging'), 2600);
            } else {
                actor.classList.remove('bouncing');
                void actor.offsetWidth;
                actor.classList.add('bouncing');
                window.StudyPet?.say?.(`${charName}隔空夸我啦✨`, 3200);
                setTimeout(() => actor.classList.remove('bouncing'), 900);
            }
            return;
        }

        if (act.type === 'play' && act.query && typeof playlist !== 'undefined' && playlist.length) {
            const q = String(act.query).toLowerCase();
            let idx = playlist.findIndex(s => String(s.title || '').toLowerCase().includes(q));
            if (idx === -1) idx = playlist.findIndex(s => q.includes(String(s.title || '').toLowerCase().slice(0, 4)));
            if (idx !== -1) {
                currentSongIndex = idx;
                if (typeof updateMusicUI === 'function') updateMusicUI();
                if (typeof audioPlayer !== 'undefined') {
                    audioPlayer.play().then(() => {
                        document.getElementById('vinylDisc')?.classList.add('playing');
                        const pb = document.getElementById('playPauseBtn');
                        if (pb) pb.innerText = '⏸ 暂停';
                    }).catch(() => {});
                }
                const toast = document.getElementById('musicToast');
                if (toast) toast.innerText = `🔌 ${charName} 通过 MCP 切歌：《${playlist[idx].title}》`;
            }
        }
    }

    async function pollOnce() {
        if (document.hidden || !mcpCfg.mcpLiveSync) return;
        try {
            const res = await fetch(`${API_BASE}/api/mcp/live-poll?sinceActionId=${knownActionId}`);
            if (!res.ok) return;
            const d = await res.json();
            if (!d.success) return;

            // 首次初始化或切换角色时仅同步水位线，不误报旧消息
            if (!pollInitialized || d.activeCharKey !== knownCharKey) {
                pollInitialized = true;
                knownCharKey = d.activeCharKey;
                knownChatId = d.lastChatId;
                knownNoteId = d.lastNoteId;
                knownActionId = d.latestActionId;
                return;
            }

            if (chatContact && chatKey() !== d.activeCharKey && document.getElementById('commDrawer').classList.contains('open') && !window.ChatPro.hasPendingChat()) {
                const key = chatKey();
                const last = await fetch(chatURL('?limit=1', key)).then(r=>r.json());
                if (key === chatKey() && (last.data?.[0]?.id || 0) !== (chatHistory.at(-1)?.id || 0)) await loadChatHistory();
            }
            if (chatKey() === d.activeCharKey && d.lastChatId > knownChatId) {
                knownChatId = d.lastChatId;
                const getLocalMax = () => (typeof chatHistory !== 'undefined' && chatHistory.length)
                    ? Math.max(...chatHistory.map(m => Number(m.id) || 0))
                    : 0;
                const prevLocalMax = getLocalMax();
                if (d.lastChatId > prevLocalMax && typeof loadChatHistory === 'function') {
                    await loadChatHistory();
                    const newLocalMax = getLocalMax();
                    const drawerOpen = document.getElementById('commDrawer')?.classList.contains('open');
                    // 只有真正拉到了新消息，且聊天框没打开时，才弹顶栏通知！
                    if (newLocalMax > prevLocalMax && !drawerOpen) {
                        const newest = chatHistory[chatHistory.length - 1];
                        if (newest && newest.role === 'assistant' && typeof showCommBanner === 'function') {
                            showCommBanner(`☁️ ${appConfig.charName || 'TA'} 发来了通讯消息`, '点开小手机看看 TA 说了什么吧～', true);
                        }
                    }
                }
            }

            if (d.lastNoteId > knownNoteId) {
                knownNoteId = d.lastNoteId;
                const localNoteMax = (typeof notesList !== 'undefined' && notesList.length)
                    ? Math.max(0, ...notesList.filter(n => n.owner + '.db' === appConfig.memoryFile).map(n => Number(n.id) || 0))
                    : 0;
                if (d.lastNoteId > localNoteMax && typeof loadNotes === 'function') {
                    await loadNotes();
                    const newestNote = notesList.find(n => n.owner + '.db' === appConfig.memoryFile);
                    if (newestNote && newestNote.author !== 'user' && typeof showCommBanner === 'function') {
                        showCommBanner(`📌 ${appConfig.charName || 'TA'} 贴了张新便利贴`, newestNote.content || '快去书桌看看吧～', false);
                    }
                }
            }

            if (Array.isArray(d.newActions) && d.newActions.length > 0) {
                knownActionId = d.latestActionId;
                for (const act of d.newActions) executeExternalAction(act);
            }
        } catch {}
    }

    function syncLivePolling() {
        clearInterval(pollTimer);
        pollTimer = null;
        if (mcpCfg.mcpLiveSync) {
            pollOnce();
            pollTimer = setInterval(pollOnce, 3000);
        }
    }

    function hookSettingsModal() {
        if (typeof window.openSettingsModal === 'function') {
            const orig = window.openSettingsModal;
            window.openSettingsModal = function () {
                orig.apply(this, arguments);
                loadMcpConfig().then(fillMcpForm);
            };
        }
        if (typeof window.saveSettingsPanel === 'function') {
            const orig = window.saveSettingsPanel;
            window.saveSettingsPanel = async function () {
                await saveMcpConfigFromForm();
                return orig.apply(this, arguments);
            };
        }
    }

    window.McpUI = {
        refreshUrls,
        copyEndpoint,
        copyJsonConfig,
        selfTest
    };

    injectMcpSettingsSection();
    hookSettingsModal();
    loadMcpConfig();
})();