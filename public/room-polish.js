// public/room-polish.js —— 番茄钟持久化 + 全部省Token精细触发开关（摸鱼/切歌/偷看） + Tavily 联网搜索 + 书架 Word(.docx) 导入
(function () {
    const TIMER_STORE_KEY = 'study_room_timer_state_v1';
    const MAMMOTH_CDNS = [
        'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
        'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
        'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js'
    ];

    let toolsConfig = {
        notifyOnSlack: true,
        notifyOnMusicSkip: true,
        notifyOnHighlightPeek: true,
        tavilyEnabled: false,
        tavilyApiKey: '',
        tavilyMaxResults: 5,
        tavilySearchDepth: 'basic'
    };

    let activeTargetEndTime = 0;

    // =========================================================================
    // 1. ⏱️ 番茄钟跨刷新持久化 + 后台精准校时 + 手机/电脑双端云同步
    // =========================================================================
    const getApiBase = () => (typeof API_BASE !== 'undefined' ? API_BASE : '');
    let lastTimerSavedAt = 0;
    let isApplyingRemoteTimer = false;

    function syncDurationPillHighlight(mins) {
        const pills = document.querySelectorAll('.dur-pill');
        let matched = false;
        pills.forEach(b => {
            const m = parseInt(b.dataset.mins, 10);
            const isHit = !isNaN(m) && m === mins;
            b.classList.toggle('active', isHit);
            if (isHit) matched = true;
        });
        const customBtn = document.getElementById('customDurBtn');
        if (customBtn) {
            if (!matched) {
                customBtn.innerText = `${mins}m`;
                customBtn.classList.add('active');
            } else {
                customBtn.innerText = '自定义';
            }
        }
    }

    function pushTimerStateToServer(payload) {
        fetch(`${getApiBase()}/api/timer/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    }

    function saveTimerState(override = null, syncCloud = true) {
        if (isApplyingRemoteTimer) return;
        try {
            if (typeof selectedMinutes === 'undefined') return;
            const status = override?.status || (isFocusing ? 'running' : (isPaused ? 'paused' : 'idle'));
            const nowTs = Date.now();
            const payload = {
                status,
                selectedMinutes,
                totalSeconds,
                remainingSeconds,
                targetEndTime: status === 'running'
                    ? (override?.targetEndTime || activeTargetEndTime || (nowTs + remainingSeconds * 1000))
                    : 0,
                pauseStartTime: status === 'paused'
                    ? (override?.pauseStartTime || currentPauseStart || nowTs)
                    : null,
                savedAt: syncCloud ? nowTs : (lastTimerSavedAt || nowTs)
            };
            if (status === 'running') activeTargetEndTime = payload.targetEndTime;
            else activeTargetEndTime = 0;
            if (syncCloud) lastTimerSavedAt = payload.savedAt;
            localStorage.setItem(TIMER_STORE_KEY, JSON.stringify(payload));
            if (syncCloud) pushTimerStateToServer(payload);
        } catch {}
    }

    function applyTimerStateObj(st, isFromRemote = false) {
        if (!st || typeof st.selectedMinutes !== 'number') return;
        isApplyingRemoteTimer = true;
        try {
            selectedMinutes = Math.max(1, Math.min(180, Math.round(st.selectedMinutes)));
            totalSeconds = st.totalSeconds || (selectedMinutes * 60);
            lastTimerSavedAt = Number(st.savedAt) || lastTimerSavedAt;
            syncDurationPillHighlight(selectedMinutes);

            if (st.status === 'running' && st.targetEndTime) {
                const remain = Math.ceil((st.targetEndTime - Date.now()) / 1000);
                if (remain > 0) {
                    // 如果本机已经在跑同一个倒计时，只微调秒数不重复重置
                    if (isFocusing && Math.abs(activeTargetEndTime - st.targetEndTime) < 2000) {
                        remainingSeconds = remain;
                        updateTimerUI();
                        return;
                    }
                    remainingSeconds = remain;
                    activeTargetEndTime = st.targetEndTime;
                    startMainTimerLoop();
                } else {
                    remainingSeconds = 0;
                    sessionActive = true;
                    isFocusing = false;
                    isPaused = false;
                    updateTimerUI();
                    isApplyingRemoteTimer = false;
                    saveTimerState({ status: 'idle' }, true);
                    setTimeout(() => {
                        if (typeof completeFocusNaturally === 'function') completeFocusNaturally();
                    }, 550);
                }
                return;
            }

            if (st.status === 'paused') {
                clearInterval(timerInterval);
                remainingSeconds = Math.max(1, Math.min(totalSeconds, Math.round(st.remainingSeconds || totalSeconds)));
                sessionActive = true;
                isFocusing = false;
                isPaused = true;
                activeTargetEndTime = 0;
                currentPauseStart = st.pauseStartTime || Date.now();

                const availSec = typeof getRemainingPauseSeconds === 'function' ? getRemainingPauseSeconds() : 600;
                document.getElementById('durationPills')?.classList.add('locked');
                document.getElementById('startFocusBtn').innerText = '继续专注';
                document.getElementById('timerStatusLabel').innerText = 'PAUSED · 限时休息中';
                document.getElementById('pauseWarningBar')?.classList.add('show');
                updateTimerUI();
                updatePeekBtnUI();

                if (availSec <= 0) {
                    if (typeof commitCurrentPause === 'function') commitCurrentPause();
                    isApplyingRemoteTimer = false;
                    saveTimerState({ status: 'idle' }, true);
                    setTimeout(() => {
                        if (typeof handleFocusDecision === 'function') handleFocusDecision('pause_timeout');
                    }, 550);
                } else {
                    pauseRemainSeconds = availSec;
                    updatePauseBarUI();
                    clearInterval(pauseInterval);
                    pauseInterval = setInterval(() => {
                        pauseRemainSeconds = getRemainingPauseSeconds();
                        updatePauseBarUI();
                        if (pauseRemainSeconds <= 0) {
                            commitCurrentPause();
                            clearInterval(pauseInterval);
                            saveTimerState({ status: 'idle' }, true);
                            handleFocusDecision('pause_timeout');
                        }
                    }, 1000);
                }
                return;
            }

            // idle 空闲态：如果另一端已放弃或完成，这边同步归位停表！
            clearInterval(timerInterval);
            clearInterval(pauseInterval);
            isFocusing = false;
            isPaused = false;
            sessionActive = false;
            activeTargetEndTime = 0;
            currentPauseStart = null;
            remainingSeconds = totalSeconds;
            document.getElementById('durationPills')?.classList.remove('locked');
            document.getElementById('pauseWarningBar')?.classList.remove('show');
            const startBtn = document.getElementById('startFocusBtn');
            if (startBtn) startBtn.innerText = '开始专注';
            const lbl = document.getElementById('timerStatusLabel');
            if (lbl && isFromRemote) {
                lbl.innerText = (typeof appConfig !== 'undefined' && appConfig.soloMode)
                    ? 'SOLO FOCUS · 纯享单人专注'
                    : 'ONLINE FOCUS · 休闲状态';
            }
            updateTimerUI();
            updatePeekBtnUI();
        } catch (err) {
            console.warn('应用番茄钟状态失败:', err);
        } finally {
            isApplyingRemoteTimer = false;
        }
    }

    async function pullTimerStateFromServer() {
        try {
            const res = await fetch(`${getApiBase()}/api/timer/state`);
            if (!res.ok) return;
            const json = await res.json();
            const remote = json?.data;
            if (!remote || typeof remote !== 'object') {
                if (lastTimerSavedAt > 0) {
                    const localRaw = localStorage.getItem(TIMER_STORE_KEY);
                    if (localRaw) pushTimerStateToServer(JSON.parse(localRaw));
                }
                return;
            }
            const remoteTs = Number(remote.savedAt) || 0;
            if (remoteTs > lastTimerSavedAt) {
                localStorage.setItem(TIMER_STORE_KEY, JSON.stringify(remote));
                applyTimerStateObj(remote, true);
            }
        } catch {}
    }

    function restoreTimerState() {
        try {
            const raw = localStorage.getItem(TIMER_STORE_KEY);
            if (raw) {
                const st = JSON.parse(raw);
                applyTimerStateObj(st, false);
            }
        } catch (err) {
            console.warn('恢复番茄钟状态失败:', err);
        }
        pullTimerStateFromServer();
    }

    function hookTimerFunctions() {
        if (typeof window.setFocusMinutes === 'function') {
            const orig = window.setFocusMinutes;
            window.setFocusMinutes = function () {
                const ret = orig.apply(this, arguments);
                saveTimerState({ status: 'idle' }, true);
                return ret;
            };
        }

        if (typeof window.startMainTimerLoop === 'function') {
            const orig = window.startMainTimerLoop;
            window.startMainTimerLoop = function () {
                const ret = orig.apply(this, arguments);
                if (!isApplyingRemoteTimer) {
                    activeTargetEndTime = Date.now() + remainingSeconds * 1000;
                    saveTimerState({ status: 'running', targetEndTime: activeTargetEndTime }, true);
                }
                return ret;
            };
        }

        if (typeof window.toggleFocus === 'function') {
            const orig = window.toggleFocus;
            window.toggleFocus = function () {
                const ret = orig.apply(this, arguments);
                if (isPaused) {
                    saveTimerState({ status: 'paused', pauseStartTime: currentPauseStart }, true);
                } else if (isFocusing) {
                    activeTargetEndTime = Date.now() + remainingSeconds * 1000;
                    saveTimerState({ status: 'running', targetEndTime: activeTargetEndTime }, true);
                }
                return ret;
            };
        }

        if (typeof window.completeFocusNaturally === 'function') {
            const orig = window.completeFocusNaturally;
            window.completeFocusNaturally = async function () {
                saveTimerState({ status: 'idle' }, true);
                return orig.apply(this, arguments);
            };
        }

        if (typeof window.handleFocusDecision === 'function') {
            const orig = window.handleFocusDecision;
            window.handleFocusDecision = async function (decision) {
                if (decision === 'abandon' || decision === 'pause_timeout' || decision === 'complete') {
                    saveTimerState({ status: 'idle' }, true);
                }
                const ret = await orig.apply(this, arguments);
                if (decision === 'continue' && isFocusing) {
                    activeTargetEndTime = Date.now() + remainingSeconds * 1000;
                    saveTimerState({ status: 'running', targetEndTime: activeTargetEndTime }, true);
                }
                return ret;
            };
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (isFocusing && activeTargetEndTime > 0) {
                    const exactRemain = Math.ceil((activeTargetEndTime - Date.now()) / 1000);
                    if (exactRemain <= 0) {
                        remainingSeconds = 0;
                        updateTimerUI();
                        completeFocusNaturally();
                        return;
                    } else {
                        remainingSeconds = exactRemain;
                        updateTimerUI();
                    }
                }
                pullTimerStateFromServer();
            }
        });

        window.addEventListener('focus', () => pullTimerStateFromServer());
        // 关闭页面只写本地缓存，绝不用旧标签页覆盖云端最新倒计时！
        window.addEventListener('beforeunload', () => saveTimerState(null, false));
    }
    // =========================================================================
    // 2. 🪙 全部精细触发开关（摸鱼 / 切歌 / 偷看批注） + 🌐 Tavily 联网配置
    // =========================================================================
    function syncRoomSwitchHints() {
        if (typeof appConfig === 'undefined') return;
        const toast = document.getElementById('musicToast');
        if (toast && !appConfig.soloMode) {
            const cur = toast.innerText || '';
            if (cur.includes('切歌') || cur.includes('点击唱片')) {
                toast.innerText = toolsConfig.notifyOnMusicSkip !== false
                    ? '点击唱片播放 · 切歌需经 TA 同意'
                    : '点击唱片播放 · 自由切歌模式（0 Token）';
            }
        }
        if (typeof updatePeekBtnUI === 'function') updatePeekBtnUI();
    }

    function injectSettingsUI() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;

        // 2.1 在「🪙 角色消息触发开关」里一次性补齐 3 个精细省 Token 开关
        const pauseChk = document.getElementById('cfgNotifyPauseTimeout');
        const triggerBox = pauseChk?.closest('.settings-section-box');
        if (triggerBox) {
            const extraSwitches = [
                {
                    id: 'cfgNotifyOnSlack',
                    title: '专注切屏摸鱼抓包时通知 TA',
                    desc: '关闭后切屏超过 15 秒仅安静记录统计，不发请求也不贴抓包便签（0 Token）'
                },
                {
                    id: 'cfgNotifyOnMusicSkip',
                    title: '申请切歌时触发 TA 审批博弈',
                    desc: '关闭后点击切歌或歌单点播将直接自由切换，不再向 TA 发审批请求（0 Token）'
                },
                {
                    id: 'cfgNotifyOnHighlightPeek',
                    title: '专注期偷看批注时触发 TA 审批',
                    desc: '关闭后专注途中点解锁将直接显影全部已生成批注，不再向 TA 申请放行（0 Token）'
                }
            ];
            for (const sw of extraSwitches) {
                if (!document.getElementById(sw.id)) {
                    const row = document.createElement('label');
                    row.className = 'switch-row';
                    row.innerHTML = `
                        <span>${sw.title}<small>${sw.desc}</small></span>
                        <input type="checkbox" id="${sw.id}" checked>
                    `;
                    triggerBox.appendChild(row);
                }
            }
        }

        // 2.2 在 API / 语音配置区下方插入「🌐 联网搜索工具（Tavily）」配置区块
        if (!document.getElementById('tavilySettingsSection')) {
            const ttsSection = document.getElementById('ttsSettingsSection');
            const apiAnchor = document.getElementById('apiTestStatus')?.closest('.form-group');
            const anchor = ttsSection || apiAnchor;

            const box = document.createElement('div');
            box.id = 'tavilySettingsSection';
            box.className = 'settings-section-box';
            box.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
                    <span style="font-size:13px;color:#fef3c7;font-weight:500;">🌐 联网搜索工具（Tavily · 支持角色自动搜网）</span>
                    <button class="mini-btn" type="button" id="tavilyTestBtn" onclick="window.RoomPolish.testTavily()">⚡ 试搜测试</button>
                </div>
                <label class="switch-row" style="padding:4px 0 10px;">
                    <span>启用角色联网搜索能力<small>开启后自动注入「预设圣殿 → 联网搜索规则」并挂载 tavily_search 工具；关闭则 0 额外 Token</small></span>
                    <input type="checkbox" id="cfgTavilyEnabled" onchange="window.RoomPolish.syncTavilyToggle()">
                </label>
                <div id="tavilyConfigBody" style="display:none;padding-top:8px;border-top:1px dashed #33302d;">
                    <div class="form-group">
                        <label>Tavily API Key（tvly-... 密钥，加密隐藏）</label>
                        <div class="pwd-wrap">
                            <input id="cfgTavilyApiKey" type="password" placeholder="粘贴 tvly-... 密钥（去 app.tavily.com 免费获取）">
                            <button type="button" class="pwd-eye-btn" onclick="togglePwdVisibility('cfgTavilyApiKey', this)" title="显示/隐藏密钥">👁️</button>
                        </div>
                    </div>
                    <div class="color-grid">
                        <div class="form-group" style="margin-bottom:4px;">
                            <label>搜索深度</label>
                            <select id="cfgTavilyDepth">
                                <option value="basic">⚡ 快速搜索（Basic · 省额度）</option>
                                <option value="advanced">🔎 深度搜索（Advanced · 更详尽）</option>
                            </select>
                        </div>
                        <div class="form-group" style="margin-bottom:4px;">
                            <label>每次最多参考条数（1~8）</label>
                            <input type="number" id="cfgTavilyMaxResults" min="1" max="8" value="5">
                        </div>
                    </div>
                </div>
                <div class="status-msg" id="tavilyTestStatus"></div>
            `;

            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(box, anchor.nextSibling);
            }
        }
    }

    function syncTavilyToggle() {
        const on = Boolean(document.getElementById('cfgTavilyEnabled')?.checked);
        const body = document.getElementById('tavilyConfigBody');
        if (body) body.style.display = on ? 'block' : 'none';
    }

    function fillToolsForm() {
        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v !== false; };
        setChk('cfgNotifyOnSlack', toolsConfig.notifyOnSlack);
        setChk('cfgNotifyOnMusicSkip', toolsConfig.notifyOnMusicSkip);
        setChk('cfgNotifyOnHighlightPeek', toolsConfig.notifyOnHighlightPeek);

        const tvChk = document.getElementById('cfgTavilyEnabled');
        const tvKey = document.getElementById('cfgTavilyApiKey');
        const tvDepth = document.getElementById('cfgTavilyDepth');
        const tvMax = document.getElementById('cfgTavilyMaxResults');
        const st = document.getElementById('tavilyTestStatus');

        if (tvChk) tvChk.checked = Boolean(toolsConfig.tavilyEnabled);
        if (tvKey) tvKey.value = toolsConfig.tavilyApiKey || '';
        if (tvDepth) tvDepth.value = toolsConfig.tavilySearchDepth || 'basic';
        if (tvMax) tvMax.value = String(toolsConfig.tavilyMaxResults || 5);
        if (st) st.innerText = '';
        syncTavilyToggle();
    }

    async function loadToolsConfig() {
        try {
            const res = await fetch(`${API_BASE}/api/tools/settings`);
            const data = await res.json();
            if (res.ok && data.success) {
                toolsConfig = { ...toolsConfig, ...data };
                syncRoomSwitchHints();
            }
        } catch {}
    }

    async function saveToolsConfigFromForm() {
        const payload = {
            notifyOnSlack: Boolean(document.getElementById('cfgNotifyOnSlack')?.checked),
            notifyOnMusicSkip: Boolean(document.getElementById('cfgNotifyOnMusicSkip')?.checked),
            notifyOnHighlightPeek: Boolean(document.getElementById('cfgNotifyOnHighlightPeek')?.checked),
            tavilyEnabled: Boolean(document.getElementById('cfgTavilyEnabled')?.checked),
            tavilyApiKey: document.getElementById('cfgTavilyApiKey')?.value.trim() || '',
            tavilySearchDepth: document.getElementById('cfgTavilyDepth')?.value || 'basic',
            tavilyMaxResults: Math.max(1, Math.min(8, parseInt(document.getElementById('cfgTavilyMaxResults')?.value, 10) || 5))
        };
        toolsConfig = { ...toolsConfig, ...payload };
        syncRoomSwitchHints();
        try {
            await fetch(`${API_BASE}/api/tools/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch {}
    }

    async function testTavily() {
        const btn = document.getElementById('tavilyTestBtn');
        const st = document.getElementById('tavilyTestStatus');
        if (btn) btn.disabled = true;
        if (st) { st.style.color = '#fbbf24'; st.innerText = '🌐 正在通过 Tavily 试搜测试...'; }

        try {
            const res = await fetch(`${API_BASE}/api/tools/tavily-test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tavilyApiKey: document.getElementById('cfgTavilyApiKey')?.value.trim() || toolsConfig.tavilyApiKey,
                    tavilySearchDepth: document.getElementById('cfgTavilyDepth')?.value || 'basic',
                    tavilyMaxResults: parseInt(document.getElementById('cfgTavilyMaxResults')?.value, 10) || 5
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            if (st) {
                st.style.color = '#4ade80';
                st.innerText = `✅ 搜网畅通！耗时 ${data.latency}ms，命中 ${data.resultCount} 条（如：${(data.sampleTitle || 'OK').slice(0, 26)}）`;
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // =========================================================================
    // 3. 拦截摸鱼抓包 / 切歌审批 / 偷看批注审批（关闭即 0 Token 自由放行！）
    // =========================================================================
    function hookSettingsAndTriggers() {
        if (typeof window.openSettingsModal === 'function') {
            const orig = window.openSettingsModal;
            window.openSettingsModal = function () {
                orig.apply(this, arguments);
                fillToolsForm();
            };
        }

        if (typeof window.saveSettingsPanel === 'function') {
            const orig = window.saveSettingsPanel;
            window.saveSettingsPanel = async function () {
                await saveToolsConfigFromForm();
                const ret = await orig.apply(this, arguments);
                syncRoomSwitchHints();
                return ret;
            };
        }

        // (1) 摸鱼抓包开关拦截
        if (typeof window.triggerSlackAlert === 'function') {
            const origSlack = window.triggerSlackAlert;
            window.triggerSlackAlert = async function (awayDuration) {
                if (toolsConfig.notifyOnSlack === false) {
                    try {
                        await fetch(`${API_BASE}/api/tools/log-slack`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ awayDuration })
                        });
                    } catch {}
                    return;
                }
                return origSlack.apply(this, arguments);
            };
        }

        // (2) 切歌审批开关拦截（关闭时 0 Token 自由切歌！）
        if (typeof window.requestSkipSongTo === 'function') {
            const origSkip = window.requestSkipSongTo;
            window.requestSkipSongTo = async function (nextIdx) {
                if (toolsConfig.notifyOnMusicSkip === false && !appConfig.soloMode) {
                    const target = playlist[nextIdx]?.title || '';
                    currentSongIndex = nextIdx;
                    if (typeof updateMusicUI === 'function') updateMusicUI();
                    audioPlayer.play().then(() => {
                        document.getElementById('vinylDisc')?.classList.add('playing');
                        const pb = document.getElementById('playPauseBtn');
                        if (pb) pb.innerText = '⏸ 暂停';
                    }).catch(() => {});
                    const toast = document.getElementById('musicToast');
                    if (toast) toast.innerText = `🎵 已切至《${target}》（自由切歌模式）`;
                    return;
                }
                return origSkip.apply(this, arguments);
            };
        }

        // (3) 专注期偷看批注审批开关拦截（关闭时 0 Token 一键直接显影！）
        if (typeof window.updatePeekBtnUI === 'function') {
            const origPeekUI = window.updatePeekBtnUI;
            window.updatePeekBtnUI = function () {
                origPeekUI.apply(this, arguments);
                const btn = document.getElementById('peekUnlockBtn');
                if (btn && btn.style.display !== 'none' && toolsConfig.notifyOnHighlightPeek === false) {
                    btn.innerText = '🔓 直接显影';
                    btn.title = '已关闭偷看审批，点击直接解锁全部批注（0 Token）';
                }
            };
        }

        if (typeof window.unlockHighlightsOnly === 'function') {
            const origUnlock = window.unlockHighlightsOnly;
            window.unlockHighlightsOnly = async function (force = false, openReaderAfter = false) {
                if (!force && toolsConfig.notifyOnHighlightPeek === false) {
                    const ret = await origUnlock.call(this, true, openReaderAfter);
                    if (typeof showCommBanner === 'function') {
                        showCommBanner('🔓 批注已直接显影', '已关闭偷看审批，0 Token 立刻解锁全部页边批注～', false);
                    }
                    return ret;
                }
                return origUnlock.apply(this, arguments);
            };
        }

        // (4) 联网搜索胶囊提示
        const origFetch = window.fetch;
        window.fetch = async function (input, init) {
            const res = await origFetch.apply(this, arguments);
            try {
                const urlStr = typeof input === 'string' ? input : (input?.url || '');
                if (res.ok && (/\/api\/chat\/pro\b/.test(urlStr) || /\/api\/chat\/reroll\b/.test(urlStr))) {
                    const cloned = await res.clone().json();
                    if (Array.isArray(cloned?.searchedQueries) && cloned.searchedQueries.length > 0) {
                        const box = document.getElementById('imMessagesList');
                        if (box) {
                            const pill = document.createElement('div');
                            pill.className = 'chat-sys-pill';
                            pill.innerText = `🌐 刚刚上网搜了：「${cloned.searchedQueries.join(' / ')}」`;
                            const typingRow = box.querySelector('.im-typing')?.closest('.im-bubble-row');
                            if (typingRow) box.insertBefore(pill, typingRow);
                            else box.appendChild(pill);
                            if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
                        }
                    }
                }
            } catch {}
            return res;
        };
    }

    // =========================================================================
    // 4. 📄 书架支持导入 Word (.docx) 文档（多源 CDN 自动按需加载 Mammoth）
    // =========================================================================
    function ensureMammothLoaded() {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        return new Promise((resolve, reject) => {
            let idx = 0;
            const tryNext = () => {
                if (window.mammoth) return resolve(window.mammoth);
                if (idx >= MAMMOTH_CDNS.length) {
                    return reject(new Error('Word 解析组件加载失败，请检查网络连接后重试'));
                }
                const s = document.createElement('script');
                s.src = MAMMOTH_CDNS[idx++];
                s.async = true;
                s.onload = () => {
                    if (window.mammoth) resolve(window.mammoth);
                    else tryNext();
                };
                s.onerror = () => {
                    s.remove();
                    tryNext();
                };
                document.head.appendChild(s);
            };
            tryNext();
        });
    }

    function enableWordDocxImport() {
        const fileInput = document.getElementById('bookFileInput');
        if (fileInput) {
            fileInput.setAttribute('accept', '.txt,.md,.pdf,.docx');
        }
        // 更新书架弹窗里的导入按钮文案
        document.querySelectorAll('#bookshelfModal button').forEach(btn => {
            if (btn.textContent.includes('导入TXT/PDF')) {
                btn.innerText = '📂 导入TXT/PDF/Word';
            }
        });

        const origImport = window.handleFileImport;
        window.handleFileImport = function (event) {
            const f = event?.target?.files?.[0];
            if (!f) return;

            if (/\.doc$/i.test(f.name)) {
                alert('旧版 .doc 格式暂无法在浏览器直接解析，请先用 Word / WPS 另存为 .docx 格式再导入哦～');
                event.target.value = '';
                return;
            }

            if (!/\.docx$/i.test(f.name)) {
                return origImport ? origImport.apply(this, arguments) : undefined;
            }

            const btn = document.getElementById('importBookBtn');
            const origBtnText = btn ? btn.innerText : '📂 导入';
            const r = new FileReader();
            r.onload = async (e) => {
                try {
                    if (btn) { btn.disabled = true; btn.innerText = '⏳ 解析Word...'; }
                    const mammoth = await ensureMammothLoaded();
                    const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
                    const rawText = String(result?.value || '')
                        .replace(/\r\n/g, '\n')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                    if (!rawText) throw new Error('未能从该 Word 文档提取到文字内容');

                    const cleanName = f.name.replace(/\.docx$/i, '');
                    const saveToShelf = confirm(`已成功解析 Word 文档《${cleanName}》（约 ${rawText.length} 字）！\n\n点【确定】：保存到书架方便下次继续读\n点【取消】：仅本次临时阅读（不占书架）`);
                    if (typeof saveAndOpenBook === 'function') {
                        await saveAndOpenBook(cleanName, rawText.slice(0, 150000), saveToShelf);
                    }
                } catch (err) {
                    alert('Word 文档导入失败：' + err.message);
                } finally {
                    if (btn) { btn.disabled = false; btn.innerText = origBtnText; }
                    event.target.value = '';
                }
            };
            r.readAsArrayBuffer(f);
        };
    }

    window.RoomPolish = {
        syncTavilyToggle,
        testTavily,
        saveTimerState
    };

    injectSettingsUI();
    hookTimerFunctions();
    hookSettingsAndTriggers();
    enableWordDocxImport();
    loadToolsConfig();

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => restoreTimerState());
    } else {
        restoreTimerState();
    }
})();