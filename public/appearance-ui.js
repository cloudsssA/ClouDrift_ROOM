// public/appearance-ui.js —— 独立「🎨 桌面美化」弹窗（双壁纸云同步 + 配色/去黑影本机独立 + 冰晶浅底液态玻璃 + 强迫症像素对齐）
(function () {
    'use strict';

    const NO_SHADOW_KEY = 'study_room_timer_no_shadow_v1';
    const LOCAL_COLORS_KEY = 'study_room_local_colors_v1';

    function loadLocalColors() {
        try {
            const raw = JSON.parse(localStorage.getItem(LOCAL_COLORS_KEY) || 'null');
            return raw && typeof raw === 'object' ? raw : null;
        } catch {
            return null;
        }
    }

    function saveLocalColors(obj) {
        try { localStorage.setItem(LOCAL_COLORS_KEY, JSON.stringify(obj)); } catch {}
    }

    function injectStyles() {
        if (document.getElementById('appearanceUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'appearanceUiStyles';
        style.textContent = `
            /* 1. 🧊 浅色纯底自适应：液态玻璃自动升级为「冰晶银透玻璃」（绝不隐身、绝无黑泥！） */
            body.vpro-light-surface #timerDisplay.fx-liquid-glass {
                color: transparent !important;
                background: linear-gradient(
                    155deg,
                    rgba(255, 255, 255, 0.96) 0%,
                    rgba(148, 163, 184, 0.46) 36%,
                    rgba(226, 232, 240, 0.78) 54%,
                    rgba(100, 116, 139, 0.48) 80%,
                    rgba(255, 255, 255, 0.94) 100%
                ) !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-stroke: 1.25px rgba(100, 116, 139, 0.42) !important;
                text-shadow: none !important;
                filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.95)) drop-shadow(0 5px 12px rgba(100, 116, 139, 0.18)) !important;
            }
            body.vpro-light-surface #timerDisplay.fx-tinted-glass {
                color: transparent !important;
                background: linear-gradient(
                    160deg,
                    rgba(255, 255, 255, 0.85) 0%,
                    var(--timer-color) 42%,
                    rgba(255, 255, 255, 0.45) 64%,
                    var(--timer-color) 100%
                ) !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-stroke: 1px rgba(15, 23, 42, 0.16) !important;
                text-shadow: none !important;
                filter: drop-shadow(0 4px 10px rgba(100, 116, 139, 0.16)) !important;
            }

            /* 2. 🫧 去除时钟黑影（本机独立，完好保留液态玻璃与空心描边！） */
            body.vpro-no-clock-shadow #timerDisplay {
                text-shadow: none !important;
                filter: none !important;
            }
            body.vpro-no-clock-shadow #timerDisplay.fx-classic,
            body.vpro-no-clock-shadow #timerDisplay.fx-emboss,
            body.vpro-no-clock-shadow #timerDisplay.fx-neon {
                -webkit-text-stroke: 0 !important;
            }
            body.vpro-no-clock-shadow:not(.vpro-light-surface) #timerDisplay.fx-liquid-glass {
                -webkit-text-stroke: 1.3px rgba(255, 255, 255, 0.68) !important;
            }
            body.vpro-no-clock-shadow.vpro-light-surface #timerDisplay.fx-liquid-glass {
                -webkit-text-stroke: 1.25px rgba(100, 116, 139, 0.46) !important;
            }
            body.vpro-no-clock-shadow #timerDisplay.fx-outline {
                color: transparent !important;
                -webkit-text-stroke: 2px var(--timer-color) !important;
            }

            /* 3. 📱 修复手机端双壁纸卡片出框 */
            .bg-dual-grid {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 10px !important;
                width: 100% !important;
            }
            .bg-slot-card { min-width: 0 !important; overflow: hidden !important; }
            .bg-slot-btns { display: flex !important; gap: 4px !important; width: 100% !important; }
            .bg-slot-btns .mini-btn {
                flex: 1 1 0 !important; min-width: 0 !important; padding: 4px 4px !important;
                font-size: 11px !important; white-space: nowrap !important;
                overflow: hidden !important; text-overflow: ellipsis !important;
            }
            @media (max-width: 540px) {
                .bg-dual-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; }
                .bg-slot-preview { height: 92px !important; }
                .bg-slot-btns .mini-btn { padding: 6px 6px !important; font-size: 12px !important; }
            }

            /* 4. 📐 强迫症像素级对齐（修复手机端 Top-P / GroupId 错位） */
            #settingsModal .color-grid,
            #appearanceModal .color-grid,
            #settingsModal .ap-align-grid,
            #appearanceModal .ap-align-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                align-items: stretch !important;
            }
            #settingsModal .color-grid > .form-group,
            #appearanceModal .color-grid > .form-group,
            #settingsModal .ap-align-grid > div,
            #appearanceModal .ap-align-grid > div {
                display: flex !important; flex-direction: column !important;
                justify-content: space-between !important; min-width: 0 !important;
            }
            #settingsModal .color-grid > .form-group > input,
            #settingsModal .color-grid > .form-group > select,
            #settingsModal .ap-align-grid > div > input,
            #settingsModal .ap-align-grid > div > select,
            #appearanceModal .color-grid > .form-group > input,
            #appearanceModal .color-grid > .form-group > select {
                width: 100% !important; max-width: 100% !important;
                box-sizing: border-box !important; margin-top: auto !important;
            }
            #settingsModal input[type="range"],
            #appearanceModal input[type="range"] {
                height: 24px; margin-top: auto !important;
            }
        `;
        document.head.appendChild(style);
    }

    function updateLightSurfaceClass() {
        const hasWp = document.getElementById('roomBgLayer')?.classList.contains('active');
        const pBg = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim()
            || (typeof appConfig !== 'undefined' && appConfig.pageBgColor)
            || '#1a1918';
        let isLight = false;
        if (typeof getLuminance === 'function') isLight = getLuminance(pBg) > 0.60;
        document.body.classList.toggle('vpro-light-surface', !hasWp && isLight);
    }

    function applyNoShadowState(enabled) {
        const val = Boolean(enabled);
        document.body.classList.toggle('vpro-no-clock-shadow', val);
        const chk = document.getElementById('cfgTimerNoShadow');
        if (chk) chk.checked = val;
        try { localStorage.setItem(NO_SHADOW_KEY, val ? '1' : '0'); } catch {}
    }

    function applyLocalColorsOverride() {
        const localCols = loadLocalColors();
        if (!localCols || typeof appConfig === 'undefined') return;
        Object.assign(appConfig, localCols);
        if (typeof applyThemeColors === 'function') {
            applyThemeColors(appConfig.pageBgColor, appConfig.cardBgColor, appConfig.accentColor, appConfig.timerColor);
        }
        updateLightSurfaceClass();
    }

    function refreshWallpaperTipText() {
        const tip = document.getElementById('bgStatusTip');
        if (!tip) return;
        const hasDesktop = Boolean(typeof draftBgImage !== 'undefined' && draftBgImage);
        const hasMobile = Boolean(typeof draftBgImageMobile !== 'undefined' && draftBgImageMobile);
        if (hasDesktop && hasMobile) tip.innerText = '✅ 已配置电脑横屏 + 手机竖屏双壁纸（云端同步，随画幅自动切换）';
        else if (hasDesktop) tip.innerText = '✅ 已启用电脑横屏壁纸（竖屏未单独设置时自动沿用）';
        else if (hasMobile) tip.innerText = '✅ 已启用手机竖屏壁纸（横屏未单独设置时自动沿用）';
        else tip.innerText = '未设置壁纸（当前显示纯色底色）';
    }

    function tagAllSettingsGrids() {
        const modals = [document.getElementById('settingsModal'), document.getElementById('appearanceModal')];
        for (const modal of modals) {
            if (!modal) continue;
            modal.querySelectorAll('div').forEach((el) => {
                if (el.classList.contains('vpro-chip-grid') || el.classList.contains('bg-dual-grid') || el.classList.contains('ap-align-grid')) return;
                if (window.getComputedStyle(el).display !== 'grid') return;
                const hasFormChild = Array.from(el.children).some((c) => c.classList.contains('form-group') || c.querySelector('input, select'));
                if (hasFormChild) el.classList.add('ap-align-grid');
            });
        }
    }

    function mountAppearanceModal() {
        if (document.getElementById('appearanceModal')) return;

        const dropdown = document.getElementById('topBarDropdown') || document.querySelector('.top-bar-right');
        if (dropdown && !document.getElementById('openAppearanceBtn')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'openAppearanceBtn';
            btn.className = 'icon-btn';
            btn.innerHTML = '🎨 美化';
            btn.onclick = () => openAppearanceModal();
            const homeBtn = document.getElementById('openHomeBtn');
            if (homeBtn && homeBtn.parentNode === dropdown) homeBtn.insertAdjacentElement('afterend', btn);
            else dropdown.insertBefore(btn, dropdown.firstChild);
        }

        const modal = document.createElement('div');
        modal.id = 'appearanceModal';
        modal.className = 'modal-backdrop';
        modal.onclick = (e) => { if (e.target === modal) closeModal('appearanceModal'); };
        modal.innerHTML = `
            <div class="modal-box">
                <h3>
                    <span>🎨 桌面美化（双壁纸同步 · 配色本机独立）</span>
                    <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('appearanceModal')">✕</span>
                </h3>
                <div id="appearanceModalBody"></div>
                <div class="status-msg" id="appearanceSaveStatus"></div>
                <button type="button" class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="window.AppearanceUI.save()">✨ 保存美化设置</button>
            </div>
        `;
        document.body.appendChild(modal);

        const body = document.getElementById('appearanceModalBody');
        const settingsModal = document.getElementById('settingsModal');
        if (!body || !settingsModal) return;

        const wpBox = document.getElementById('bgImageFileInput')?.closest('.settings-section-box');
        if (wpBox) body.appendChild(wpBox);

        const clockBox = document.getElementById('clockStyleSettingsBox');
        if (clockBox) {
            body.appendChild(clockBox);
            if (!document.getElementById('cfgTimerNoShadow')) {
                const row = document.createElement('label');
                row.className = 'switch-row';
                row.style.marginTop = '8px';
                row.style.borderTop = '1px dashed #33302d';
                row.innerHTML = `
                    <span>🫧 去除时钟黑影（本机生效）<small>去掉数字背后浓黑阴影；浅底液态玻璃自动转为冰晶银透质感</small></span>
                    <input type="checkbox" id="cfgTimerNoShadow">
                `;
                clockBox.appendChild(row);
                const chk = document.getElementById('cfgTimerNoShadow');
                chk.checked = localStorage.getItem(NO_SHADOW_KEY) === '1';
                chk.addEventListener('change', () => applyNoShadowState(chk.checked));
            }
        }

        const colorGrid = document.getElementById('cfgTimerColor')?.closest('.color-grid');
        if (colorGrid) {
            const colorHeader = colorGrid.previousElementSibling;
            const colorCard = document.createElement('div');
            colorCard.className = 'settings-section-box';
            if (colorHeader && colorHeader.textContent.includes('配色自定义')) {
                const span = colorHeader.querySelector('span');
                if (span) span.textContent = '🎨 配色自定义（仅本机生效 · 不覆盖另一端）';
                colorCard.appendChild(colorHeader);
            }
            colorCard.appendChild(colorGrid);
            body.appendChild(colorCard);
        }

        const settingsTitle = settingsModal.querySelector('h3 span');
        if (settingsTitle && settingsTitle.textContent.includes('壁纸配色')) {
            settingsTitle.textContent = '⚙️ 系统设置（API · 语音 · 触发开关）';
        }
    }

    function openAppearanceModal() {
        if (typeof appConfig !== 'undefined') {
            if (typeof draftBgImage !== 'undefined') draftBgImage = appConfig.bgImage || '';
            if (typeof draftBgImageMobile !== 'undefined') draftBgImageMobile = appConfig.bgImageMobile || '';

            const localCols = loadLocalColors() || {};
            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            setVal('cfgBgMode', appConfig.bgMode || 'cover');
            setVal('cfgBgBlur', appConfig.bgBlur ?? 0);
            setVal('cfgBgDim', appConfig.bgDim ?? 0.32);

            const blurEl = document.getElementById('bgBlurVal');
            const dimEl = document.getElementById('bgDimVal');
            if (blurEl) blurEl.innerText = `${appConfig.bgBlur ?? 0}px`;
            if (dimEl) dimEl.innerText = `${Math.round((appConfig.bgDim ?? 0.32) * 100)}%`;

            setVal('cfgTimerColor', localCols.timerColor || appConfig.timerColor || '#fef3c7');
            setVal('cfgPageBgColor', localCols.pageBgColor || appConfig.pageBgColor || '#1a1918');
            setVal('cfgCardBgColor', localCols.cardBgColor || appConfig.cardBgColor || '#2a2826');
            setVal('cfgAccentColor', localCols.accentColor || appConfig.accentColor || '#d97706');
            setVal('cfgInkColor', localCols.inkColor || appConfig.inkColor || '#1c1917');
            setVal('cfgNoteColor', localCols.noteColor || appConfig.noteColor || '#fef08a');

            if (typeof updateBgSlotPreviews === 'function') updateBgSlotPreviews();
            refreshWallpaperTipText();
        }

        const st = document.getElementById('appearanceSaveStatus');
        if (st) st.innerText = '';
        applyNoShadowState(localStorage.getItem(NO_SHADOW_KEY) === '1');
        tagAllSettingsGrids();
        document.getElementById('appearanceModal')?.classList.add('open');
    }

    /**
     * 双端横竖壁纸云同步；配色 & 去黑影只保存在本机，互不覆盖！
     */
    async function saveAppearancePanel() {
        const st = document.getElementById('appearanceSaveStatus');
        const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
        try {
            const wpPayload = {
                bgImage: typeof draftBgImage !== 'undefined' ? draftBgImage : (appConfig?.bgImage || ''),
                bgImageMobile: typeof draftBgImageMobile !== 'undefined' ? draftBgImageMobile : (appConfig?.bgImageMobile || ''),
                bgMode: document.getElementById('cfgBgMode')?.value || 'cover',
                bgBlur: parseFloat(document.getElementById('cfgBgBlur')?.value) || 0,
                bgDim: parseFloat(document.getElementById('cfgBgDim')?.value) || 0
            };
            const localColors = {
                timerColor: document.getElementById('cfgTimerColor')?.value || '#fef3c7',
                pageBgColor: document.getElementById('cfgPageBgColor')?.value || '#1a1918',
                cardBgColor: document.getElementById('cfgCardBgColor')?.value || '#2a2826',
                accentColor: document.getElementById('cfgAccentColor')?.value || '#d97706',
                inkColor: document.getElementById('cfgInkColor')?.value || '#1c1917',
                noteColor: document.getElementById('cfgNoteColor')?.value || '#fef08a'
            };

            // 1. 仅把横竖双壁纸同步上云端
            const res = await fetch(`${apiBase}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wpPayload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '保存失败');

            // 2. 配色与去黑影仅保存在本机
            saveLocalColors(localColors);
            applyNoShadowState(Boolean(document.getElementById('cfgTimerNoShadow')?.checked));

            if (typeof closeModal === 'function') closeModal('appearanceModal');
            if (typeof loadConfig === 'function') await loadConfig();
            applyLocalColorsOverride();
            if (typeof loadHighlights === 'function') await loadHighlights();
            if (typeof loadNotes === 'function') await loadNotes();

            if (typeof showCommBanner === 'function') {
                showCommBanner('🎨 美化已保存', '双端横竖壁纸已云同步，配色与时钟黑影已本机生效～', false);
            }
        } catch (err) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${err.message}`; }
        }
    }

    function hookGlobalEvents() {
        if (typeof window.openSettingsModal === 'function') {
            const orig = window.openSettingsModal;
            window.openSettingsModal = function () {
                const ret = orig.apply(this, arguments);
                setTimeout(tagAllSettingsGrids, 20);
                return ret;
            };
        }
        if (typeof window.applyThemeColors === 'function') {
            const orig = window.applyThemeColors;
            window.applyThemeColors = function () {
                const ret = orig.apply(this, arguments);
                updateLightSurfaceClass();
                return ret;
            };
        }
        if (typeof window.applyWallpaper === 'function') {
            const orig = window.applyWallpaper;
            window.applyWallpaper = function () {
                const ret = orig.apply(this, arguments);
                updateLightSurfaceClass();
                return ret;
            };
        }
        if (typeof window.livePreviewWallpaper === 'function') {
            const orig = window.livePreviewWallpaper;
            window.livePreviewWallpaper = function () {
                const ret = orig.apply(this, arguments);
                refreshWallpaperTipText();
                updateLightSurfaceClass();
                return ret;
            };
        }
        if (typeof window.loadConfig === 'function') {
            const orig = window.loadConfig;
            window.loadConfig = async function () {
                const ret = await orig.apply(this, arguments);
                applyLocalColorsOverride();
                return ret;
            };
        }
        window.addEventListener('resize', updateLightSurfaceClass);
    }

    function boot() {
        injectStyles();
        applyNoShadowState(localStorage.getItem(NO_SHADOW_KEY) === '1');
        mountAppearanceModal();
        hookGlobalEvents();
        tagAllSettingsGrids();
        applyLocalColorsOverride();
    }

    window.AppearanceUI = {
        open: openAppearanceModal,
        save: saveAppearancePanel,
        setNoShadow: applyNoShadowState
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    window.addEventListener('load', () => {
        mountAppearanceModal();
        applyLocalColorsOverride();
        tagAllSettingsGrids();
    });
})();