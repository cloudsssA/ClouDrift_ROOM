// public/fx-pro.js —— 角色跨次元联动(<pet>/<play>) + 便签撕碎粒子 + 小手机信号/呼吸光晕 + 记忆滚动归档手账按钮
(function () {
    function injectStyles() {
        if (document.getElementById('fxProStyles')) return;
        const style = document.createElement('style');
        style.id = 'fxProStyles';
        style.textContent = `
            /* 1. 🎊 便签撕碎碎纸屑粒子 */
            .fx-paper-shard {
                position: fixed;
                pointer-events: none;
                z-index: 310;
                border-radius: 2px;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
                will-change: transform, opacity;
            }

            /* 2. 📱 小手机伪系统信号/电量徽章 + 倾听呼吸光晕 */
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

            /* 3. 📖 记忆手术台归档手账按钮 */
            .fx-archive-btn {
                background: rgba(168, 85, 247, 0.18);
                border: 1px solid rgba(192, 132, 252, 0.48);
                color: #e9d5ff;
                padding: 7px 13px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.18s;
                white-space: nowrap;
            }
            .fx-archive-btn:hover:not(:disabled) {
                background: rgba(168, 85, 247, 0.34);
                color: #fff;
            }
            .fx-archive-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // 1. 🎊 撕便利贴碎纸屑粒子动效
    // =========================================================================
    function burstPaperShards(noteEl) {
        if (!noteEl) return;
        const rect = noteEl.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;

        const baseColor = getComputedStyle(noteEl).backgroundColor || '#fef08a';
        const count = 22;
        for (let i = 0; i < count; i++) {
            const shard = document.createElement('div');
            shard.className = 'fx-paper-shard';
            const w = 6 + Math.random() * 10;
            const h = 5 + Math.random() * 9;
            const startX = rect.left + Math.random() * rect.width;
            const startY = rect.top + Math.random() * rect.height;

            shard.style.width = `${w}px`;
            shard.style.height = `${h}px`;
            shard.style.left = `${startX}px`;
            shard.style.top = `${startY}px`;
            shard.style.background = baseColor;
            shard.style.filter = `brightness(${(0.86 + Math.random() * 0.24).toFixed(2)})`;
            document.body.appendChild(shard);

            const dx = (Math.random() - 0.5) * 140;
            const dy = -25 - Math.random() * 65;
            const fallY = 95 + Math.random() * 110;
            const rot = (Math.random() - 0.5) * 540;
            const dur = 580 + Math.random() * 340;

            shard.animate([
                { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
                { transform: `translate(${dx * 0.55}px, ${dy}px) rotate(${rot * 0.45}deg) scale(1.05)`, opacity: 0.95, offset: 0.32 },
                { transform: `translate(${dx}px, ${fallY}px) rotate(${rot}deg) scale(0.45)`, opacity: 0 }
            ], {
                duration: dur,
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
            if (noteEl && noteEl.classList.contains('show')) {
                burstPaperShards(noteEl);
            }
            return orig.apply(this, arguments);
        };
    }

    // =========================================================================
    // 2. 📱 小手机伪系统信号/电量状态条 + 倾听呼吸光晕
    // =========================================================================
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

        // 如果浏览器支持真实电量接口就悄悄同步真实电量！
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

    // =========================================================================
    // 3. 🎭 角色跨次元联动执行器（<pet:...> 隔空逗桌宠 + <play:...> 主动切歌！）
    // =========================================================================
    function appendChatNotice(txt) {
        const box = document.getElementById('imMessagesList');
        if (!box) return;
        const pill = document.createElement('div');
        pill.className = 'chat-sys-pill';
        pill.innerText = txt;
        box.appendChild(pill);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    }

    function executePetActionByAI(action) {
        const actor = document.querySelector('.pet-actor');
        if (!actor || actor.classList.contains('hidden')) return;
        const charName = (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';

        const spawnQuickFx = (sym) => {
            const fx = document.createElement('span');
            fx.className = 'pet-fx';
            fx.innerText = sym;
            actor.appendChild(fx);
            setTimeout(() => fx.remove(), 1200);
        };

        if (action === 'feed' && window.StudyPet?.feed) {
            // 触发原生高空抛食物理特效！
            window.StudyPet.feed();
            setTimeout(() => {
                const x = Math.round(window.innerWidth * (0.35 + Math.random() * 0.3));
                const y = 85;
                document.dispatchEvent(new PointerEvent('pointerdown', {
                    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
                }));
            }, 95);
            appendChatNotice(`🍖 ${charName} 悄悄给你的桌宠空投了一份小零食！`);
            return;
        }

        if (action === 'ball' && window.StudyPet?.playBall) {
            window.StudyPet.playBall();
            setTimeout(() => {
                const x = Math.round(window.innerWidth * (0.3 + Math.random() * 0.4));
                const y = Math.round(window.innerHeight * 0.35);
                document.dispatchEvent(new PointerEvent('pointerdown', {
                    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
                }));
            }, 95);
            appendChatNotice(`🎾 ${charName} 隔空陪你的桌宠丢起了弹力球！`);
            return;
        }

        if (action === 'rage') {
            actor.classList.add('raging');
            spawnQuickFx('💢');
            window.StudyPet?.say?.(`喂！${charName}怎么也隔空戳我💢`, 3200);
            setTimeout(() => actor.classList.remove('raging'), 2600);
            appendChatNotice(`💢 ${charName} 隔空戳了戳桌宠，小家伙炸毛抗议了！`);
            return;
        }

        // happy / jump
        actor.classList.remove('bouncing');
        void actor.offsetWidth;
        actor.classList.add('bouncing');
        spawnQuickFx('❤️');
        setTimeout(() => spawnQuickFx('✨'), 180);
        window.StudyPet?.say?.(`${charName}隔空夸我啦开心✨`, 3200);
        setTimeout(() => actor.classList.remove('bouncing'), 900);
        appendChatNotice(`🐾 ${charName} 隔空摸了摸桌宠，小家伙原地蹦跶起来了！`);
    }

    function executePlaySongByAI(query) {
        if (!query || typeof playlist === 'undefined' || !playlist.length) return;
        const q = String(query).toLowerCase().trim();
        let idx = playlist.findIndex(s => String(s.title || '').toLowerCase() === q);
        if (idx === -1) idx = playlist.findIndex(s => String(s.title || '').toLowerCase().includes(q));
        if (idx === -1) idx = playlist.findIndex(s => q.includes(String(s.title || '').toLowerCase().slice(0, 4)));
        if (idx === -1) return;

        const targetSong = playlist[idx];
        const charName = (typeof appConfig !== 'undefined' && appConfig.charName) || 'TA';

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
        if (toast) toast.innerText = `🎵 ${charName} 悄悄为你点了《${targetSong.title}》`;
        appendChatNotice(`💿 ${charName} 主动把留声机切到了《${targetSong.title}》`);
        if (typeof showCommBanner === 'function') {
            showCommBanner(`💿 ${charName} 为你点了一首歌`, `正在播放：《${targetSong.title}》`, false);
        }
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
                                // 稍等片刻配合气泡弹出节奏执行跨次元动作，画面感拉满！
                                setTimeout(() => {
                                    for (const act of cloned.roomActions) {
                                        if (act.type === 'pet') executePetActionByAI(act.action);
                                        else if (act.type === 'play') executePlaySongByAI(act.query);
                                    }
                                }, 450);
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

    // =========================================================================
    // 4. 📖 记忆手术台一键「滚动压缩归档为手账」
    // =========================================================================
    function getCheckedMemoryIdsFromDom() {
        const ids = [];
        document.querySelectorAll('#memItemsList .mem-item-card.checked .mem-time').forEach(el => {
            const m = String(el.innerText || '').match(/^#(\d+)/);
            if (m && m[1]) ids.push(parseInt(m[1], 10));
        });
        return ids;
    }

    async function runMemoryArchive() {
        const btn = document.getElementById('fxArchiveMemBtn');
        const checkedIds = getCheckedMemoryIdsFromDom();
        const confirmMsg = checkedIds.length > 0
            ? `确定将已勾选的 ${checkedIds.length} 条记忆压缩归档为 1 份「阶段核心手账」吗？\n（既保留所有核心事件与梗，又大幅节省上下文 Token！）`
            : `未勾选具体条目，将自动保留最新 4 条原始对话防断片，并把前面所有历史记忆浓缩为 1 份「阶段核心手账」。\n\n确定开始智能压缩归档吗？`;

        if (!confirm(confirmMsg)) return;

        if (btn) { btn.disabled = true; btn.innerText = '⏳ 正在提炼手账...'; }
        try {
            const res = await fetch(`${API_BASE}/api/memory/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(checkedIds.length > 0 ? { ids: checkedIds } : {})
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);

            if (window.MemoryUI?.refresh) await window.MemoryUI.refresh();
            if (typeof showCommBanner === 'function') {
                showCommBanner(
                    '📖 记忆手账归档完成',
                    `已将 ${data.archivedCount} 条碎片记忆浓缩为高密度核心手账！当前总记忆仅剩 ${data.memoryCount} 条～`,
                    false
                );
            }
        } catch (e) {
            alert(e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '📖 压缩归档为手账'; }
        }
    }

    function mountArchiveButtonInMemoryModal() {
        const actions = document.querySelector('#memoryManagerModal .mem-footer-actions');
        if (!actions || document.getElementById('fxArchiveMemBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'fxArchiveMemBtn';
        btn.type = 'button';
        btn.className = 'fx-archive-btn';
        btn.innerText = '📖 压缩归档为手账';
        btn.title = '把勾选的（或较早的）碎片记忆让 AI 浓缩为 200 字阶段手账，防 OOC 且省 Token';
        btn.onclick = () => runMemoryArchive();

        const delBtn = document.getElementById('memDeleteSelectedBtn');
        if (delBtn) actions.insertBefore(btn, delBtn);
        else actions.appendChild(btn);
    }

    injectStyles();
    hookNoteTearParticles();
    mountPhoneStatusHud();
    hookChatNetworkAndActions();
    mountArchiveButtonInMemoryModal();
})();