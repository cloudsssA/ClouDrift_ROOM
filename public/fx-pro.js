// public/fx-pro.js —— 角色跨次元联动(<pet>/<play>)双端实时真同步 + 便签撕碎粒子 + 小手机信号/呼吸光晕
(function () {
    const getApiBase = () => (typeof API_BASE !== 'undefined' ? API_BASE : '');

    function injectStyles() {
        if (document.getElementById('fxProStyles')) return;
        const style = document.createElement('style');
        style.id = 'fxProStyles';
        style.textContent = `
            .fx-paper-shard {
                position: fixed;
                pointer-events: none;
                z-index: 310;
                border-radius: 2px;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
                will-change: transform, opacity;
            }
            .fx-phone-status {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: calc(10.5px * var(--chat-scale, 1));
                color: #a8a29e;
                background: rgba(255, 255, 255, 0.07);
                border: 1px solid rgba(255, 255, 255, 0.11);
                padding: 2px 7px;
                border-radius: 999px;
                white-space: nowrap;
                user-select: none;
                transition: all 0.22s;
            }
            .fx-phone-status.busy {
                color: #93c5fd;
                border-color: rgba(56, 189, 248, 0.45);
                background: rgba(56, 189, 248, 0.14);
            }
            .fx-phone-status.offline {
                color: #fca5a5;
                border-color: rgba(239, 68, 68, 0.55);
                background: rgba(220, 38, 38, 0.22);
                animation: fxPhoneShake 0.32s ease-in-out 2;
            }
            @keyframes fxPhoneShake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-3px); }
                75% { transform: translateX(3px); }
            }
            #commDrawer.fx-listening-glow {
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.72), 0 0 0 1.8px rgba(56, 189, 248, 0.55), 0 0 28px rgba(56, 189, 248, 0.28) !important;
                animation: fxBreathRim 1.8s ease-in-out infinite;
            }
            @keyframes fxBreathRim {
                0%, 100% { box-shadow: 0 24px 64px rgba(0, 0, 0, 0.72), 0 0 0 1.5px rgba(56, 189, 248, 0.42), 0 0 18px rgba(56, 189, 248, 0.18); }
                50% { box-shadow: 0 24px 64px rgba(0, 0, 0, 0.72), 0 0 0 2.2px rgba(217, 119, 6, 0.65), 0 0 34px rgba(217, 119, 6, 0.34); }
            }
        `;
        document.head.appendChild(style);
    }

    function burstPaperShards(noteEl) {
        if (!noteEl) return;
        const rect = noteEl.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        const baseColor = getComputedStyle(noteEl).backgroundColor || '#fef08a';
        for (let i = 0; i < 22; i++) {
            const shard = document.createElement('div');
            shard.className = 'fx-paper-shard';
            shard.style.width = `${6 + Math.random() * 10}px`;
            shard.style.height = `${5 + Math.random() * 9}px`;
            shard.style.left = `${rect.left + Math.random() * rect.width}px`;
            shard.style.top = `${rect.top + Math.random() * rect.height}px`;
            shard.style.background = baseColor;
            shard.style.filter = `brightness(${(0.86 + Math.random() * 0.24).toFixed(2)})`;
            document.body.appendChild(shard);

            const dx = (Math.random() - 0.5) * 140;
            const dy = -25 - Math.random() * 65;
            const fallY = 95 + Math.random() * 110;
            const rot = (Math.random() - 0.5) * 540;
            shard.animate([
                { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
                { transform: `translate(${dx * 0.55}px, ${dy}px) rotate(${rot * 0.45}deg) scale(1.05)`, opacity: 0.95, offset: 0.32 },
                { transform: `translate(${dx}px, ${fallY}px) rotate(${rot}deg) scale(0.45)`, opacity: 0 }
            ], {
                duration: 580 + Math.random() * 340,
                easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
                fill: 'forwards'
            }).onfinish = () => shard.remove();
        }
    }

    function hookNoteTearParticles() {
        if (typeof window.tearCurrentNote !== 'function') return;
        const orig = window.tearCurrentNote;
        window.tearCurrentNote = async function () {
            const noteEl = document.getElementById('stickyNote');
            if (noteEl && noteEl.classList.contains('show')) burstPaperShards(noteEl);
            return orig.apply(this, arguments);
        };
    }

    let phoneStatusEl = null;
    let batteryLevel = 92;

    function mountPhoneStatusHud() {
        const actions = document.querySelector('#commDrawer .im-actions');
        if (!actions || document.getElementById('fxPhoneStatus')) return;
        phoneStatusEl = document.createElement('span');
        phoneStatusEl.id = 'fxPhoneStatus';
        phoneStatusEl.className = 'fx-phone-status';
        phoneStatusEl.title = '小手机连线信号状态';
        phoneStatusEl.innerText = `📶 5G · 🔋${batteryLevel}%`;
        actions.insertBefore(phoneStatusEl, actions.firstChild);

        if (navigator.getBattery) {
            navigator.getBattery().then(bat => {
                const syncBat = () => {
                    batteryLevel = Math.round((bat.level || 0.9) * 100);
                    if (phoneStatusEl && !phoneStatusEl.classList.contains('busy') && !phoneStatusEl.classList.contains('offline')) {
                        phoneStatusEl.innerText = `📶 5G · ${bat.charging ? '⚡' : '🔋'}${batteryLevel}%`;
                    }
                };
                syncBat();
                bat.addEventListener('levelchange', syncBat);
                bat.addEventListener('chargingchange', syncBat);
            }).catch(() => {});
        }
    }

    function setPhoneSignal(mode) {
        const drawer = document.getElementById('commDrawer');
        if (drawer) drawer.classList.toggle('fx-listening-glow', mode === 'busy');
        if (!phoneStatusEl) return;
        phoneStatusEl.classList.remove('busy', 'offline');
        if (mode === 'busy') {
            phoneStatusEl.classList.add('busy');
            phoneStatusEl.innerText = '📡 连线中';
        } else if (mode === 'offline') {
            phoneStatusEl.classList.add('offline');
            phoneStatusEl.innerText = '📵 无信号';
        } else {
            phoneStatusEl.innerText = `📶 5G · 🔋${batteryLevel}%`;
        }
    }

    // 🎭 角色跨次元联动执行器（<pet> 逗桌宠 + <play> 主动切歌 · 双端同步，系统小字已由后端持久存库！）
    let lastSeenActionId = 0;
    let actionPollerReady = false;
    const executedActionIds = new Set();

    function executePetActionByAI(action, overrideCharName = '', isFromRemoteSync = false) {
        const charName = overrideCharName || (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';
        if (window.StudyPet && typeof window.StudyPet.aiInteract === 'function') {
            window.StudyPet.aiInteract(action, charName, isFromRemoteSync);
        }
        if (isFromRemoteSync && typeof showCommBanner === 'function') {
            const tipMap = {
                feed: '悄悄给你的桌宠空投了一份小零食！',
                ball: '隔空陪你的桌宠丢起了弹力球！',
                rage: '隔空戳了戳桌宠，小家伙炸毛抗议了！',
                happy: '隔空摸了摸桌宠，小家伙原地蹦跶起来了！'
            };
            showCommBanner(`🐾 ${charName} 逗了逗你的桌宠`, tipMap[action] || tipMap.happy, false);
        }
    }

    function executePlaySongByAI(query, overrideCharName = '', isFromRemoteSync = false) {
        if (!query || typeof playlist === 'undefined' || !playlist.length) return;
        const q = String(query).toLowerCase().trim();
        let idx = playlist.findIndex(s => String(s.title || '').toLowerCase() === q);
        if (idx === -1) idx = playlist.findIndex(s => String(s.title || '').toLowerCase().includes(q));
        if (idx === -1) idx = playlist.findIndex(s => q.includes(String(s.title || '').toLowerCase().slice(0, 4)));
        if (idx === -1) return;

        const targetSong = playlist[idx];
        const charName = overrideCharName || (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';

        currentSongIndex = idx;
        if (typeof updateMusicUI === 'function') updateMusicUI();

        const toast = document.getElementById('musicToast');
        if (toast) toast.innerText = `🎵 ${charName} 悄悄为你点了《${targetSong.title}》`;

        if (typeof audioPlayer !== 'undefined') {
            audioPlayer.play().then(() => {
                document.getElementById('vinylDisc')?.classList.add('playing');
                const pb = document.getElementById('playPauseBtn');
                if (pb) pb.innerText = '⏸ 暂停';
                if (typeof showCommBanner === 'function') {
                    showCommBanner(`💿 ${charName} 为你点了一首歌`, `正在播放：《${targetSong.title}》`, false);
                }
            }).catch(() => {
                if (typeof showCommBanner === 'function') {
                    showCommBanner(
                        `💿 ${charName} 已为你切好歌`,
                        isFromRemoteSync ? `已同步切至《${targetSong.title}》，轻点留声机播放即可收听～` : `已切至《${targetSong.title}》`,
                        false
                    );
                }
            });
        }
    }

    function runActionList(actions, charName = '', isFromRemoteSync = false) {
        if (!Array.isArray(actions) || !actions.length) return;
        for (const act of actions) {
            if (act.type === 'pet') executePetActionByAI(act.action, charName, isFromRemoteSync);
            else if (act.type === 'play') executePlaySongByAI(act.query, charName, isFromRemoteSync);
        }
    }

    async function initRoomActionPoller() {
        try {
            const res = await fetch(`${getApiBase()}/api/room/actions?init=1`);
            if (res.ok) {
                const data = await res.json();
                lastSeenActionId = Math.max(lastSeenActionId, Number(data?.latestId) || 0);
            }
        } catch {}
        actionPollerReady = true;
    }

    async function pollRoomActions() {
        if (!actionPollerReady || document.hidden) return;
        try {
            const res = await fetch(`${getApiBase()}/api/room/actions?since=${lastSeenActionId}`);
            if (!res.ok) return;
            const data = await res.json();
            if (!data?.success) return;
            if (typeof data.latestId === 'number' && data.latestId > lastSeenActionId) {
                lastSeenActionId = data.latestId;
            }
            const events = Array.isArray(data.events) ? data.events : [];
            let hasRemote = false;
            for (const ev of events) {
                if (!ev || executedActionIds.has(ev.id)) continue;
                executedActionIds.add(ev.id);
                hasRemote = true;
                runActionList(ev.actions, ev.charName || '', true);
            }
            // 同步刷新另一端聊天记录，确保新消息 + 永久系统小字立刻呈现！
            if (hasRemote && typeof window.loadChatHistory === 'function') {
                window.loadChatHistory();
            }
        } catch {}
    }

    function hookChatNetworkAndActions() {
        const origFetch = window.fetch;
        window.fetch = async function (input, init) {
            const urlStr = typeof input === 'string' ? input : (input?.url || '');
            const isChatCall = /\/api\/chat\/(pro|reroll)\b/.test(urlStr) || /\/api\/music-pro\/share-clip\b/.test(urlStr);

            if (isChatCall) setPhoneSignal('busy');

            try {
                const res = await origFetch.apply(this, arguments);
                if (isChatCall) {
                    if (!res.ok) {
                        setPhoneSignal('offline');
                    } else {
                        setPhoneSignal('ok');
                        try {
                            const cloned = await res.clone().json();
                            if (Array.isArray(cloned?.roomActions) && cloned.roomActions.length > 0) {
                                const evId = Number(cloned.actionEventId) || 0;
                                if (evId > 0) {
                                    executedActionIds.add(evId);
                                    lastSeenActionId = Math.max(lastSeenActionId, evId);
                                }
                                setTimeout(() => runActionList(cloned.roomActions, '', false), 450);
                            }
                        } catch {}
                    }
                }
                return res;
            } catch (err) {
                if (isChatCall) setPhoneSignal('offline');
                throw err;
            }
        };
    }

    injectStyles();
    hookNoteTearParticles();
    mountPhoneStatusHud();
    hookChatNetworkAndActions();

    initRoomActionPoller();
    setInterval(pollRoomActions, 3500);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) pollRoomActions();
    });
    window.addEventListener('focus', () => pollRoomActions());
})();