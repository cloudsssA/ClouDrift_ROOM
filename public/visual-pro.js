// public/visual-pro.js —— 修复小手机底部留白/左上角头像裁切/日期可读性 + 全链路高清裁剪(壁纸2.5K/头像512/相框1800) + 大号时钟 & 多形态相框
(function () {
    const VISUAL_STORE_KEY = 'study_room_visual_prefs_v1';

    const DEFAULT_PREFS = {
        clockFont: 'default',       // default | ios-serif | rounded | editorial | italic-serif | pixel
        clockEffect: 'classic',     // classic | liquid-glass | tinted-glass | neon | outline | emboss
        clockMode: 'timer',         // timer | clock
        widgetShape: 'landscape',   // landscape | square | polaroid | badge
        widgetWidth: 268,           // 165 ~ 360px
        photoFrames: {}             // { [widgetId]: { x: 0, y: 0, scale: 1 } }
    };

    let prefs = loadLocalPrefs();
    let framingMode = false;
    let toolsOpen = false;
    let justSwipedOrFramedAt = 0;

    // 壁纸裁剪器状态
    let wpImg = null;
    let wpAspect = window.innerWidth / Math.max(1, window.innerHeight);
    let wpBaseScale = 1;
    let wpZoom = 1;
    let wpOffX = 0;
    let wpOffY = 0;
    let wpDragging = false;
    let wpLastX = 0;
    let wpLastY = 0;
    let wpRawOriginal = '';

    function loadLocalPrefs() {
        try {
            const raw = JSON.parse(localStorage.getItem(VISUAL_STORE_KEY) || '{}');
            return {
                ...DEFAULT_PREFS,
                ...raw,
                photoFrames: (raw && typeof raw.photoFrames === 'object' && raw.photoFrames) ? raw.photoFrames : {}
            };
        } catch {
            return { ...DEFAULT_PREFS, photoFrames: {} };
        }
    }

    function persistPrefs(syncServer = true) {
        try { localStorage.setItem(VISUAL_STORE_KEY, JSON.stringify(prefs)); } catch {}
        if (!syncServer || typeof API_BASE === 'undefined') return;
        fetch(`${API_BASE}/api/visual/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefs })
        }).catch(() => {});
    }

    async function loadServerPrefs() {
        if (typeof API_BASE === 'undefined') return;
        try {
            const res = await fetch(`${API_BASE}/api/visual/settings`);
            if (!res.ok) return;
            const data = await res.json();
            if (data?.success && data.prefs && Object.keys(data.prefs).length > 0) {
                prefs = {
                    ...DEFAULT_PREFS,
                    ...data.prefs,
                    photoFrames: { ...(prefs.photoFrames || {}), ...(data.prefs.photoFrames || {}) }
                };
                try { localStorage.setItem(VISUAL_STORE_KEY, JSON.stringify(prefs)); } catch {}
                applyClockVisuals();
                renderClockDisplay();
                applyWidgetContainerStyle();
                applyCurrentPhotoFrame();
            }
        } catch {}
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function injectWebFonts() {
        if (document.getElementById('visualProFonts')) return;
        const link = document.createElement('link');
        link.id = 'visualProFonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.loli.net/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,800&family=Fredoka:wght@600;700&family=Silkscreen:wght@400;700&display=swap';
        document.head.appendChild(link);
    }

    function injectStyles() {
        if (document.getElementById('visualProStyles')) return;
        const style = document.createElement('style');
        style.id = 'visualProStyles';
        style.textContent = `
            /* ========== 0. 修复左上角小头像只露一角 & 留声机标题竖排 ========== */
            .mini-avatar-dot {
                flex-shrink: 0 !important;
                position: relative;
            }
            .mini-avatar-dot img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                object-position: center !important;
                display: block !important;
                border-radius: 50%;
            }
            .vinyl-top-bar { flex-wrap: wrap !important; row-gap: 5px !important; }
            .vinyl-top-bar > span { white-space: nowrap !important; flex-shrink: 0 !important; }
            .vinyl-top-bar > div { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }

            /* ========== 1. 聊天框四角缩放真·上锁 + 修复底部空白溢出 Bug ========== */
            #commDrawer:not(.adjust-mode) .chat-resize-handle {
                display: none !important;
                pointer-events: none !important;
            }
            #commDrawer > #chatProFloatHint.chat-float-hint {
                position: absolute !important;
                top: 56px;
                left: 50%;
                transform: translateX(-50%) translateY(-6px);
                z-index: 40 !important;
                background: rgba(20, 19, 22, 0.88);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(254, 243, 199, 0.25);
                color: #fde68a;
                font-size: 11px;
                padding: 4px 12px;
                border-radius: 999px;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transition: all 0.22s ease;
                box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
            }
            #commDrawer > #chatProFloatHint.chat-float-hint.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            #commDrawer .im-input-bar {
                flex-shrink: 0 !important;
            }

            /* ========== 2. 手机端顶栏对称重排 ========== */
            @media (max-width: 768px) {
                .top-bar { flex-direction: column !important; align-items: stretch !important; gap: 7px !important; width: 100%; }
                .top-bar-left { width: 100% !important; justify-content: space-between !important; flex-wrap: nowrap !important; gap: 7px !important; }
                .top-bar-left .mode-pill {
                    flex: 1; min-width: 0; justify-content: center;
                    padding: 6.5px 10px !important; font-size: 11.5px !important; border-radius: 13px !important;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .top-bar-left .pet-top-wrap { flex-shrink: 0; }
                .top-bar-left .pet-top-btn { padding: 6.5px 11px !important; font-size: 11.5px !important; border-radius: 13px !important; }
                .top-bar-right {
                    width: 100% !important; display: grid !important;
                    grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 6px !important;
                }
                body.solo-mode .top-bar-right { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                .top-bar-right .icon-btn {
                    width: 100% !important; padding: 7px 6px !important; border-radius: 12px !important;
                    font-size: 11.5px !important; display: inline-flex !important;
                    align-items: center; justify-content: center; gap: 4px; white-space: nowrap;
                }
            }

            /* ========== 3. 大号主角时钟 + 6 套字体 + 6 种特效 ========== */
            #timerDisplay {
                font-size: clamp(78px, 9.6vw, 134px) !important;
                line-height: 1.0 !important;
                cursor: pointer; user-select: none; -webkit-user-select: none;
                touch-action: manipulation;
                transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), color 0.25s;
            }
            #timerDisplay.clock-pop { transform: scale(0.95); }
            @media (max-width: 768px) {
                #timerDisplay { font-size: clamp(72px, 20.5vw, 102px) !important; }
            }
            .vpro-clock-sub {
                font-size: 11.5px;
                color: var(--text-on-card, #f5f5f4) !important;
                background: var(--card-bg-rgba);
                border: 1px solid var(--card-border);
                backdrop-filter: blur(12px);
                padding: 3.5px 12px;
                border-radius: 999px;
                margin-top: 4px;
                display: none;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                user-select: none;
                font-variant-numeric: tabular-nums;
                font-weight: 500;
            }
            .vpro-clock-sub.show { display: inline-flex; }

            #timerDisplay.font-default { font-family: "DIN Alternate", "SF Pro Display", "Bahnschrift", "Segoe UI", ui-rounded, sans-serif; font-weight: 700; letter-spacing: 3px; }
            #timerDisplay.font-ios-serif { font-family: "Playfair Display", "Bodoni Moda", "New York", "Didot", "Bodoni MT", "Times New Roman", Georgia, serif !important; font-weight: 900 !important; letter-spacing: 1px !important; font-feature-settings: "lnum" 1, "tnum" 1; }
            #timerDisplay.font-rounded { font-family: "Fredoka", "SF Pro Rounded", ui-rounded, "PingFang SC", sans-serif !important; font-weight: 700 !important; letter-spacing: 2px !important; }
            #timerDisplay.font-editorial { font-family: "Bodoni Moda", "Didot", "Baskerville", "Playfair Display", Georgia, serif !important; font-weight: 400 !important; letter-spacing: 6px !important; }
            #timerDisplay.font-italic-serif { font-family: "Playfair Display", "Didot", Georgia, serif !important; font-style: italic !important; font-weight: 800 !important; letter-spacing: 2px !important; padding-right: 8px; }
            #timerDisplay.font-pixel { font-family: "Silkscreen", "Courier New", ui-monospace, monospace !important; font-weight: 700 !important; letter-spacing: 1px !important; font-size: clamp(56px, 7.2vw, 96px) !important; }
            @media (max-width: 768px) { #timerDisplay.font-pixel { font-size: clamp(48px, 14.5vw, 70px) !important; } }

            #timerDisplay.fx-liquid-glass {
                color: transparent !important;
                background: linear-gradient(155deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.34) 36%, rgba(255,255,255,0.14) 54%, rgba(255,255,255,0.62) 84%, rgba(255,255,255,0.92) 100%) !important;
                -webkit-background-clip: text !important; background-clip: text !important;
                -webkit-text-stroke: 1.45px rgba(255,255,255,0.65); text-shadow: none !important;
                filter: drop-shadow(0 1px 0 rgba(255,255,255,0.42)) drop-shadow(0 10px 22px rgba(0,0,0,0.44)) drop-shadow(0 0 18px rgba(255,255,255,0.22));
            }
            #timerDisplay.fx-tinted-glass {
                color: transparent !important;
                background: linear-gradient(160deg, rgba(255,255,255,0.92) 0%, var(--timer-color) 42%, rgba(255,255,255,0.28) 62%, var(--timer-color) 100%) !important;
                -webkit-background-clip: text !important; background-clip: text !important;
                -webkit-text-stroke: 1.25px rgba(255,255,255,0.52); text-shadow: none !important;
                filter: drop-shadow(0 2px 10px rgba(0,0,0,0.45)) drop-shadow(0 0 16px rgba(255,255,255,0.22));
            }
            #timerDisplay.fx-neon { color: var(--timer-color) !important; -webkit-text-stroke: 0.6px rgba(255,255,255,0.65); text-shadow: 0 0 10px var(--timer-color), 0 0 26px var(--timer-color), 0 6px 24px rgba(0,0,0,0.55) !important; }
            #timerDisplay.fx-outline { color: rgba(255,255,255,0.08) !important; -webkit-text-stroke: 2.2px var(--timer-color); text-shadow: 0 6px 22px rgba(0,0,0,0.42) !important; }
            #timerDisplay.fx-emboss { color: var(--timer-color) !important; -webkit-text-stroke: 0.8px rgba(0,0,0,0.35); text-shadow: 0 2px 0 rgba(0,0,0,0.55), 0 4px 0 rgba(0,0,0,0.35), 0 12px 26px rgba(0,0,0,0.62) !important; }

            .vpro-chip-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
            .vpro-chip {
                background: #292524; border: 1px solid #44403c; color: #e7e5e4;
                padding: 7px 6px; border-radius: 9px; font-size: 11.5px; cursor: pointer;
                text-align: center; transition: all 0.16s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .vpro-chip:hover { border-color: var(--accent, #d97706); color: #fef3c7; }
            .vpro-chip.active { background: rgba(217, 119, 6, 0.26); border-color: var(--accent, #d97706); color: #fef3c7; font-weight: 600; }

            /* ========== 4. 桌面相框外置舞台 ========== */
            .vpro-widget-stage {
                margin-top: clamp(10px, 1.5vh, 16px);
                display: flex; flex-direction: column; align-items: center;
                max-width: 100%; position: relative; flex-shrink: 1;
            }
            .vpro-frame-wrap {
                position: relative; display: inline-flex; align-items: center; justify-content: center; max-width: 100%;
            }
            #iosWidget.vpro-widget {
                margin-top: 0 !important;
                width: min(var(--vpro-w, 268px), calc(100vw - 32px)) !important;
                max-width: calc(100vw - 32px) !important;
                height: auto !important;
                aspect-ratio: var(--vpro-ratio, 16 / 10);
                transition: width 0.22s ease, border-radius 0.22s ease, transform 0.25s ease, border-color 0.25s ease;
                touch-action: pan-y;
            }
            #iosWidget.vpro-shape-landscape { --vpro-ratio: 16 / 10; border-radius: 22px; }
            #iosWidget.vpro-shape-square { --vpro-ratio: 1 / 1; border-radius: 22px; }
            #iosWidget.vpro-shape-badge {
                --vpro-ratio: 1 / 1; border-radius: 50% !important;
                box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42), inset 0 2px 10px rgba(255, 255, 255, 0.35), inset 0 -4px 12px rgba(0, 0, 0, 0.35) !important;
            }
            #iosWidget.vpro-shape-polaroid {
                --vpro-ratio: 3 / 3.85; border-radius: 8px !important;
                background: #faf6ee !important; padding: 10px 10px 38px 10px !important;
                box-shadow: 0 16px 38px rgba(0, 0, 0, 0.44) !important;
                border: 1px solid rgba(255, 255, 255, 0.85) !important;
            }
            #iosWidget.vpro-shape-polaroid #widgetContentArea { border-radius: 3px; overflow: hidden; position: relative; background: #1a1918; }
            #iosWidget.vpro-shape-polaroid .widget-caption-bar { display: none !important; }
            .vpro-polaroid-chin {
                display: none; position: absolute; left: 12px; right: 12px; bottom: 8px; height: 22px;
                align-items: center; justify-content: space-between; gap: 6px; color: #3f3a34;
                font-family: "Kaiti", "STKaiti", "Playfair Display", Georgia, serif; font-size: 12.5px; font-weight: 600; pointer-events: none;
            }
            #iosWidget.vpro-shape-polaroid .vpro-polaroid-chin { display: flex; }
            #iosWidget.vpro-shape-polaroid .vpro-polaroid-chin .widget-dot { background: rgba(63, 58, 52, 0.25); }
            #iosWidget.vpro-shape-polaroid .vpro-polaroid-chin .widget-dot.active { background: #3f3a34; }
            #iosWidget.vpro-shape-badge .widget-caption-bar { padding: 16px 20% 10px; justify-content: center; flex-direction: column; align-items: center; gap: 4px; }

            .vpro-widget-stage .widget-overlay-top {
                position: static !important;
                display: none !important;
                opacity: 1 !important;
                margin-top: 8px;
                flex-wrap: wrap;
                justify-content: center;
                align-items: center;
                gap: 5px;
                padding: 4px 8px;
                border-radius: 999px;
                background: rgba(20, 19, 22, 0.82);
                backdrop-filter: blur(14px);
                border: 1px solid rgba(255, 255, 255, 0.16);
                box-shadow: 0 10px 24px rgba(0, 0, 0, 0.36);
                max-width: calc(100vw - 24px);
                animation: vproBarPop 0.18s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .vpro-widget-stage.tools-open:not(.framing-active) .widget-overlay-top { display: flex !important; }
            @keyframes vproBarPop { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
            .vpro-widget-stage .widget-overlay-top > div { display: flex; gap: 5px; margin-left: 0 !important; flex-wrap: wrap; justify-content: center; }

            .vpro-framing-bar {
                margin-top: 8px; width: min(296px, calc(100vw - 28px));
                background: rgba(20, 19, 22, 0.92); backdrop-filter: blur(14px);
                border: 1px solid rgba(254, 243, 199, 0.28); border-radius: 999px;
                padding: 6px 10px; display: none; align-items: center; gap: 7px;
                color: #f5f5f4; font-size: 11.5px; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
            }
            .vpro-widget-stage.framing-active .vpro-framing-bar { display: flex; }
            .vpro-framing-bar input[type="range"] { flex: 1; min-width: 72px; accent-color: var(--accent, #d97706); cursor: pointer; }
            .vpro-framing-btn { background: rgba(255, 255, 255, 0.12); border: none; color: #fff; padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; white-space: nowrap; }
            .vpro-framing-btn.done { background: var(--accent, #d97706); font-weight: 600; }

            #iosWidget #widgetContentArea { overflow: hidden; position: relative; }
            #iosWidget #widgetContentArea img { will-change: transform; transition: transform 0.2s ease; user-select: none; -webkit-user-drag: none; }
            #iosWidget:hover:not(.framing-mode) #widgetContentArea img { transform: var(--vpro-img-tf, translate(0%, 0%) scale(1)) !important; }
            #iosWidget.framing-mode { cursor: grab !important; touch-action: none !important; box-shadow: 0 0 0 2.5px var(--accent, #d97706), 0 18px 42px rgba(0, 0, 0, 0.55) !important; }
            #iosWidget.framing-mode:active { cursor: grabbing !important; }
            #iosWidget.framing-mode #widgetContentArea img { transition: none !important; }

            .vpro-nav-arrow {
                position: absolute; top: 50%; transform: translateY(-50%); z-index: 8;
                width: 26px; height: 26px; border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.24); background: rgba(20, 19, 22, 0.78);
                backdrop-filter: blur(8px); color: #fff; font-size: 15px; line-height: 1;
                display: none; align-items: center; justify-content: center; cursor: pointer;
                opacity: 0; transition: opacity 0.2s, transform 0.15s;
            }
            .vpro-nav-arrow:hover { border-color: var(--accent, #d97706); transform: translateY(-50%) scale(1.08); }
            .vpro-nav-arrow.prev { left: -12px; }
            .vpro-nav-arrow.next { right: -12px; }
            .vpro-widget-stage.has-multi:hover:not(.framing-active) .vpro-nav-arrow,
            .vpro-widget-stage.has-multi.tools-open:not(.framing-active) .vpro-nav-arrow { display: flex; opacity: 1; }

            @keyframes vproSlideNext { from { opacity: 0.45; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
            @keyframes vproSlidePrev { from { opacity: 0.45; transform: translateX(-18px); } to { opacity: 1; transform: translateX(0); } }
            #widgetContentArea.anim-next { animation: vproSlideNext 0.22s ease-out; }
            #widgetContentArea.anim-prev { animation: vproSlidePrev 0.22s ease-out; }

            .wp-crop-stage {
                position: relative; width: 100%; max-width: 440px; margin: 0 auto 12px;
                border-radius: 14px; overflow: hidden; background: #111;
                border: 1.5px solid rgba(254, 243, 199, 0.35); cursor: grab;
                user-select: none; touch-action: none; display: flex; align-items: center; justify-content: center;
            }
            .wp-crop-stage:active { cursor: grabbing; }
            .wp-crop-stage canvas { display: block; max-width: 100%; height: auto; }
            .wp-crop-grid-overlay {
                position: absolute; inset: 0; pointer-events: none;
                background-image: linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px);
                background-size: 33.33% 33.33%; box-shadow: inset 0 0 0 1px rgba(254, 243, 199, 0.4);
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // 模块 0：全链路高清画质升级（相框 1800px + 头像 512px Retina + 壁纸 2560px！）
    // =========================================================================
    function upgradeGlobalImageSharpness() {
        // 1. 升级全局图片压缩器：同时检查长宽两边的最大边、高质量重采样，告别相框/聊天图发糊！
// 1. 升级全局图片压缩器：兼容手机大图防闪退 + 保住 GIF 动图 + 高清锐利
        window.compressImageToBase64 = function (file, maxDim = 1800, quality = 0.90) {
            if (!file) return Promise.resolve('');
            if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) {
                return new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(r.result);
                    r.onerror = reject;
                    r.readAsDataURL(file);
                });
            }
            const targetMax = Math.max(1280, maxDim === 800 ? 1600 : (maxDim === 960 ? 1440 : maxDim));
            const targetQ = Math.min(0.92, Math.max(0.84, quality));
            return new Promise((resolve, reject) => {
                const objectUrl = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    try {
                        let w = img.width, h = img.height;
                        const longest = Math.max(w, h);
                        if (longest > targetMax) {
                            const ratio = targetMax / longest;
                            w = Math.round(w * ratio);
                            h = Math.round(h * ratio);
                        }
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const ctx = c.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, w, h);
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, w, h);
                        URL.revokeObjectURL(objectUrl);
                        resolve(c.toDataURL('image/jpeg', targetQ));
                    } catch (err) {
                        URL.revokeObjectURL(objectUrl);
                        reject(err);
                    }
                };
                img.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    const r = new FileReader();
                    r.onload = () => resolve(r.result);
                    r.onerror = reject;
                    r.readAsDataURL(file);
                };
                img.src = objectUrl;
            });
        };

        // 2. 升级头像裁剪导出：直接从原图 cropImg 重绘到 512×512 高清画布（告别 240px 糊头像！）
        window.confirmAvatarCrop = function () {
            let data = '';
            if (typeof cropImg !== 'undefined' && cropImg) {
                const outSize = 512;
                const scaleToOut = outSize / 240;
                const c = document.createElement('canvas');
                c.width = outSize;
                c.height = outSize;
                const ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                const w = cropImg.width * cropBaseScale * cropZoom * scaleToOut;
                const h = cropImg.height * cropBaseScale * cropZoom * scaleToOut;
                ctx.drawImage(
                    cropImg,
                    (outSize - w) / 2 + cropOffsetX * scaleToOut,
                    (outSize - h) / 2 + cropOffsetY * scaleToOut,
                    w,
                    h
                );
                data = c.toDataURL('image/jpeg', 0.95);
            } else {
                const fallbackCanvas = document.getElementById('cropCanvas');
                if (fallbackCanvas) data = fallbackCanvas.toDataURL('image/jpeg', 0.95);
            }

            if (data) {
                if (typeof cropTarget !== 'undefined' && cropTarget === 'char') {
                    draftCharAvatar = data;
                    document.getElementById('charAvatarPreview').innerHTML = renderAvatarHtml(data, 'TA');
                } else {
                    draftUserAvatar = data;
                    document.getElementById('userAvatarPreview').innerHTML = renderAvatarHtml(data, '我');
                }
            }
            if (typeof closeModal === 'function') closeModal('avatarCropModal');
        };
    }

    // =========================================================================
    // 模块 1：聊天框四角缩放硬上锁 + 清除调节模式刷屏胶囊
    // =========================================================================
    function patchChatDrawerLockAndToast() {
        const drawer = document.getElementById('commDrawer');
        if (!drawer) return;

        let hintEl = document.getElementById('chatProFloatHint');
        if (!hintEl) {
            hintEl = document.createElement('div');
            hintEl.id = 'chatProFloatHint';
            hintEl.className = 'chat-float-hint';
            drawer.appendChild(hintEl);
        }
        let hintTimer = null;
        function showChatFloatHint(txt) {
            hintEl.innerText = txt;
            hintEl.classList.add('show');
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => hintEl.classList.remove('show'), 2200);
        }

        drawer.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.chat-resize-handle') && !drawer.classList.contains('adjust-mode')) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, true);

        const msgList = document.getElementById('imMessagesList');
        if (msgList) {
            new MutationObserver((muts) => {
                for (const m of muts) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === 1 && node.classList?.contains('chat-sys-pill')) {
                            const txt = (node.innerText || '').trim();
                            if (txt.includes('四角缩放') || txt.includes('四角调节') || txt.includes('已锁定聊天框尺寸')) {
                                node.remove();
                                showChatFloatHint(txt);
                            }
                        }
                    }
                }
            }).observe(msgList, { childList: true });
        }
    }

    // =========================================================================
    // 模块 2：中央大号时钟字体 / 液态玻璃特效 / 双击切换日常时钟与倒计时
    // =========================================================================
    const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    function formatNowClock() {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        return { hm: `${hh}:${mm}`, dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_CN[now.getDay()]}` };
    }

    function formatCountdownText() {
        const sec = typeof remainingSeconds === 'number' ? Math.max(0, remainingSeconds) : 1500;
        return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }

    function renderClockDisplay() {
        const el = document.getElementById('timerDisplay');
        const sub = document.getElementById('vproClockSub');
        if (!el) return;

        const timerStr = formatCountdownText();
        const mini = document.getElementById('readerMiniTimer');
        if (mini) {
            const icon = (typeof isFocusing !== 'undefined' && isFocusing) ? '⏱️' : ((typeof isPaused !== 'undefined' && isPaused) ? '⏸️' : '🕒');
            mini.innerText = `${icon} ${timerStr}`;
        }

        if (prefs.clockMode === 'clock') {
            const nowObj = formatNowClock();
            el.innerText = nowObj.hm;
            if (sub) {
                sub.classList.add('show');
                if (typeof sessionActive !== 'undefined' && sessionActive) {
                    const stIcon = isFocusing ? '⏱️ 专注进行中' : '⏸️ 专注已暂停';
                    sub.innerText = `${stIcon} ${timerStr} · 双击切回倒计时`;
                } else {
                    sub.innerText = `🕒 ${nowObj.dateLabel} · 双击切回倒计时`;
                }
            }
        } else {
            el.innerText = timerStr;
            if (sub) sub.classList.remove('show');
        }
    }

    function toggleClockMode() {
        prefs.clockMode = prefs.clockMode === 'clock' ? 'timer' : 'clock';
        const el = document.getElementById('timerDisplay');
        if (el) {
            el.classList.add('clock-pop');
            setTimeout(() => el.classList.remove('clock-pop'), 180);
        }
        renderClockDisplay();
        persistPrefs(true);
    }

    function initClockDoubleClickAndTicker() {
        const el = document.getElementById('timerDisplay');
        if (!el || el.dataset.vproClockBound) return;
        el.dataset.vproClockBound = '1';
        el.title = '双击切换【番茄倒计时 / 日常实时时钟】';

        if (!document.getElementById('vproClockSub')) {
            const sub = document.createElement('div');
            sub.id = 'vproClockSub';
            sub.className = 'vpro-clock-sub';
            sub.title = '点击或双击大数字切回番茄倒计时';
            sub.onclick = () => toggleClockMode();
            el.insertAdjacentElement('afterend', sub);
        }

        el.addEventListener('dblclick', (e) => { e.preventDefault(); toggleClockMode(); });

        let lastTapTs = 0;
        el.addEventListener('touchend', (e) => {
            if (e.changedTouches.length !== 1) return;
            const now = Date.now();
            if (now - lastTapTs > 0 && now - lastTapTs < 320) {
                e.preventDefault();
                lastTapTs = 0;
                toggleClockMode();
            } else {
                lastTapTs = now;
            }
        }, { passive: false });

        window.updateTimerUI = function () { renderClockDisplay(); };
        setInterval(() => { if (prefs.clockMode === 'clock') renderClockDisplay(); }, 1000);
        renderClockDisplay();
    }

    function applyClockVisuals() {
        const el = document.getElementById('timerDisplay');
        if (!el) return;
        const fontClasses = ['font-default', 'font-ios-serif', 'font-rounded', 'font-editorial', 'font-italic-serif', 'font-pixel'];
        const fxClasses = ['fx-classic', 'fx-liquid-glass', 'fx-tinted-glass', 'fx-neon', 'fx-outline', 'fx-emboss'];
        el.classList.remove(...fontClasses, ...fxClasses);
        el.classList.add(`font-${prefs.clockFont || 'default'}`);
        el.classList.add(`fx-${prefs.clockEffect || 'classic'}`);

        document.querySelectorAll('[data-clock-font]').forEach(b => b.classList.toggle('active', b.dataset.clockFont === prefs.clockFont));
        document.querySelectorAll('[data-clock-fx]').forEach(b => b.classList.toggle('active', b.dataset.clockFx === prefs.clockEffect));
    }

    function setClockFont(fontKey) { prefs.clockFont = fontKey; applyClockVisuals(); persistPrefs(true); }
    function setClockEffect(fxKey) { prefs.clockEffect = fxKey; applyClockVisuals(); persistPrefs(true); }

    function injectClockAndWallpaperSettingsUI() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;

        const bgInput = document.getElementById('bgImageFileInput');
        if (bgInput && bgInput.parentNode && !document.getElementById('cropCurrentBgBtn')) {
            const cropBtn = document.createElement('button');
            cropBtn.id = 'cropCurrentBgBtn';
            cropBtn.type = 'button';
            cropBtn.className = 'mini-btn';
            cropBtn.innerText = '✂️ 裁剪';
            cropBtn.title = '自由缩放拖动裁剪房间壁纸（高清 2.5K 导出）';
            cropBtn.onclick = () => openWallpaperCropperWithCurrent();
            const clearBtn = bgInput.parentNode.querySelector('button[onclick*="clearRoomBgImage"]');
            if (clearBtn) bgInput.parentNode.insertBefore(cropBtn, clearBtn);
            else bgInput.parentNode.appendChild(cropBtn);
        }

        if (!document.getElementById('clockStyleSettingsBox')) {
            const colorGrid = document.getElementById('cfgTimerColor')?.closest('.color-grid');
            const colorHeader = colorGrid?.previousElementSibling;
            const box = document.createElement('div');
            box.id = 'clockStyleSettingsBox';
            box.className = 'settings-section-box';
            box.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                    <span style="font-size:13px;color:#fef3c7;font-weight:500;">🕰️ 中心时钟字体 & 液态玻璃特效</span>
                    <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;" onclick="window.VisualPro.toggleClockMode()">🔄 切换倒计时/日常时钟</button>
                </div>
                <div style="font-size:11px;color:#a8a29e;margin-bottom:5px;">字体形态（主屏双击大数字也可随时切换时钟模式）</div>
                <div class="vpro-chip-grid">
                    <button type="button" class="vpro-chip" data-clock-font="default" onclick="window.VisualPro.setClockFont('default')">现代利落</button>
                    <button type="button" class="vpro-chip" data-clock-font="ios-serif" style="font-family:'Playfair Display','Didot',Georgia,serif;font-weight:900;" onclick="window.VisualPro.setClockFont('ios-serif')">18:18 衬线</button>
                    <button type="button" class="vpro-chip" data-clock-font="rounded" style="font-family:'Fredoka',ui-rounded,sans-serif;" onclick="window.VisualPro.setClockFont('rounded')">圆润软萌</button>
                    <button type="button" class="vpro-chip" data-clock-font="editorial" style="font-family:'Bodoni Moda',Georgia,serif;letter-spacing:2px;" onclick="window.VisualPro.setClockFont('editorial')">杂志细体</button>
                    <button type="button" class="vpro-chip" data-clock-font="italic-serif" style="font-family:'Playfair Display',Georgia,serif;font-style:italic;" onclick="window.VisualPro.setClockFont('italic-serif')">优雅斜体</button>
                    <button type="button" class="vpro-chip" data-clock-font="pixel" style="font-family:'Silkscreen',monospace;font-size:10.5px;" onclick="window.VisualPro.setClockFont('pixel')">PIXEL 像素</button>
                </div>
                <div style="font-size:11px;color:#a8a29e;margin-bottom:5px;">视觉质感</div>
                <div class="vpro-chip-grid" style="margin-bottom:2px;">
                    <button type="button" class="vpro-chip" data-clock-fx="classic" onclick="window.VisualPro.setClockEffect('classic')">经典纯色</button>
                    <button type="button" class="vpro-chip" data-clock-fx="liquid-glass" onclick="window.VisualPro.setClockEffect('liquid-glass')">💧 液态玻璃</button>
                    <button type="button" class="vpro-chip" data-clock-fx="tinted-glass" onclick="window.VisualPro.setClockEffect('tinted-glass')">🔮 染色琉璃</button>
                    <button type="button" class="vpro-chip" data-clock-fx="neon" onclick="window.VisualPro.setClockEffect('neon')">✨ 霓虹辉光</button>
                    <button type="button" class="vpro-chip" data-clock-fx="outline" onclick="window.VisualPro.setClockEffect('outline')">✒️ 空心描边</button>
                    <button type="button" class="vpro-chip" data-clock-fx="emboss" onclick="window.VisualPro.setClockEffect('emboss')">🎬 立体浮雕</button>
                </div>
            `;
            if (colorHeader && colorHeader.parentNode) colorHeader.parentNode.insertBefore(box, colorHeader);
            applyClockVisuals();
        }
    }

    // =========================================================================
    // 模块 3：真·2.5K 高清房间壁纸自由裁剪台
    // =========================================================================
    function mountWallpaperCropModal() {
        if (document.getElementById('wallpaperCropModal')) return;
        const modal = document.createElement('div');
        modal.id = 'wallpaperCropModal';
        modal.className = 'modal-backdrop';
        modal.style.zIndex = '285';
        modal.onclick = (e) => { if (e.target === modal) closeModal('wallpaperCropModal'); };
        modal.innerHTML = `
            <div class="modal-box" style="max-width:490px;">
                <h3>
                    <span>✂️ 房间壁纸高清裁剪台</span>
                    <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('wallpaperCropModal')">✕</span>
                </h3>
                <div class="vpro-chip-grid" style="grid-template-columns:repeat(4,1fr);">
                    <button type="button" class="vpro-chip active" data-wp-ar="screen" onclick="window.VisualPro.setWpAspect('screen')">当前屏幕</button>
                    <button type="button" class="vpro-chip" data-wp-ar="16:9" onclick="window.VisualPro.setWpAspect('16:9')">横屏 16:9</button>
                    <button type="button" class="vpro-chip" data-wp-ar="9:19" onclick="window.VisualPro.setWpAspect('9:19')">手机竖屏</button>
                    <button type="button" class="vpro-chip" data-wp-ar="1:1" onclick="window.VisualPro.setWpAspect('1:1')">方形 1:1</button>
                </div>
                <div class="wp-crop-stage" id="wpCropStage">
                    <canvas id="wpCropCanvas" width="360" height="240"></canvas>
                    <div class="wp-crop-grid-overlay"></div>
                </div>
                <div class="form-group" style="margin-bottom:12px;">
                    <label>拖动图片调整构图 · 缩放比例：<span id="wpZoomLabel">1.00x</span></label>
                    <input type="range" id="wpZoomSlider" min="1" max="3" step="0.02" value="1" oninput="window.VisualPro.onWpZoom(this.value)">
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary" style="flex:1;" onclick="window.VisualPro.useOriginalWallpaper()">跳过，用原图</button>
                    <button type="button" class="btn btn-primary" style="flex:1.2;" onclick="window.VisualPro.confirmWallpaperCrop()">✅ 确认高清裁剪</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const stage = document.getElementById('wpCropStage');
        stage.addEventListener('pointerdown', (e) => {
            if (!wpImg) return;
            wpDragging = true; wpLastX = e.clientX; wpLastY = e.clientY;
            try { stage.setPointerCapture(e.pointerId); } catch {}
        });
        stage.addEventListener('pointermove', (e) => {
            if (!wpDragging || !wpImg) return;
            wpOffX += (e.clientX - wpLastX); wpOffY += (e.clientY - wpLastY);
            wpLastX = e.clientX; wpLastY = e.clientY;
            drawWpCropCanvas();
        });
        const stopDrag = () => { wpDragging = false; };
        stage.addEventListener('pointerup', stopDrag);
        stage.addEventListener('pointercancel', stopDrag);
        stage.addEventListener('wheel', (e) => {
            if (!wpImg) return;
            e.preventDefault();
            const next = Math.max(1, Math.min(3, wpZoom + (e.deltaY < 0 ? 0.1 : -0.1)));
            const slider = document.getElementById('wpZoomSlider');
            if (slider) slider.value = String(next);
            onWpZoom(next);
        }, { passive: false });
    }

    function setWpAspect(mode) {
        document.querySelectorAll('[data-wp-ar]').forEach(b => b.classList.toggle('active', b.dataset.wpAr === mode));
        if (mode === '16:9') wpAspect = 16 / 9;
        else if (mode === '9:19') wpAspect = 9 / 19.5;
        else if (mode === '1:1') wpAspect = 1;
        else wpAspect = Math.max(0.42, Math.min(2.2, window.innerWidth / Math.max(1, window.innerHeight)));

        const canvas = document.getElementById('wpCropCanvas');
        if (!canvas) return;
        const maxStageW = Math.min(410, window.innerWidth - 68);
        const maxStageH = Math.min(340, Math.round(window.innerHeight * 0.44));
        let cw = maxStageW, ch = Math.round(cw / wpAspect);
        if (ch > maxStageH) { ch = maxStageH; cw = Math.round(ch * wpAspect); }
        canvas.width = Math.max(140, cw);
        canvas.height = Math.max(140, ch);
        if (wpImg) {
            wpBaseScale = Math.max(canvas.width / wpImg.width, canvas.height / wpImg.height);
            wpZoom = 1; wpOffX = 0; wpOffY = 0;
            const slider = document.getElementById('wpZoomSlider');
            if (slider) slider.value = '1';
            const lbl = document.getElementById('wpZoomLabel');
            if (lbl) lbl.innerText = '1.00x';
            drawWpCropCanvas();
        }
    }

    function drawWpCropCanvas() {
        const canvas = document.getElementById('wpCropCanvas');
        if (!canvas || !wpImg) return;
        const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const drawW = wpImg.width * wpBaseScale * wpZoom;
        const drawH = wpImg.height * wpBaseScale * wpZoom;
        const maxOffX = Math.max(0, (drawW - cw) / 2);
        const maxOffY = Math.max(0, (drawH - ch) / 2);
        wpOffX = Math.max(-maxOffX, Math.min(maxOffX, wpOffX));
        wpOffY = Math.max(-maxOffY, Math.min(maxOffY, wpOffY));
        ctx.drawImage(wpImg, (cw - drawW) / 2 + wpOffX, (ch - drawH) / 2 + wpOffY, drawW, drawH);
    }

    function onWpZoom(v) {
        wpZoom = Math.max(1, Math.min(3, parseFloat(v) || 1));
        const lbl = document.getElementById('wpZoomLabel');
        if (lbl) lbl.innerText = `${wpZoom.toFixed(2)}x`;
        drawWpCropCanvas();
    }

    function openWallpaperCropperFromDataUrl(dataUrl) {
        wpRawOriginal = dataUrl;
        const img = new Image();
        img.onload = () => {
            wpImg = img;
            document.getElementById('wallpaperCropModal')?.classList.add('open');
            setWpAspect('screen');
        };
        img.src = dataUrl;
    }

    function openWallpaperCropperWithCurrent() {
        const cur = (typeof draftBgImage !== 'undefined' && draftBgImage) || (typeof appConfig !== 'undefined' && appConfig.bgImage) || '';
        if (!cur) {
            const tip = document.getElementById('bgStatusTip');
            if (tip) tip.innerText = '⚠️ 请先点「📂 选底图」上传一张壁纸哦～';
            return;
        }
        openWallpaperCropperFromDataUrl(cur);
    }

    function useOriginalWallpaper() {
        if (wpImg && wpRawOriginal) {
            // 仅在超大图时温和限制长边至 2560px，保持高清锐利且秒存数据库
            const longest = Math.max(wpImg.width, wpImg.height);
            if (longest > 2560) {
                const ratio = 2560 / longest;
                const c = document.createElement('canvas');
                c.width = Math.round(wpImg.width * ratio);
                c.height = Math.round(wpImg.height * ratio);
                const ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(wpImg, 0, 0, c.width, c.height);
                draftBgImage = c.toDataURL('image/jpeg', 0.94);
            } else {
                draftBgImage = wpRawOriginal;
            }
            if (typeof livePreviewWallpaper === 'function') livePreviewWallpaper();
            const tip = document.getElementById('bgStatusTip');
            if (tip) tip.innerText = '✅ 已载入高清原图壁纸预览，点底部「保存所有设置」永久生效';
        }
        closeModal('wallpaperCropModal');
    }

    function confirmWallpaperCrop() {
        const previewCanvas = document.getElementById('wpCropCanvas');
        if (!previewCanvas || !wpImg) { closeModal('wallpaperCropModal'); return; }

        // 修复核心分辨率公式：1 / (wpBaseScale * wpZoom) 才是原图像素到预览画布像素的真实倍率！
        const cw = previewCanvas.width;
        const ch = previewCanvas.height;
        const nativePixelsPerCanvasPx = 1 / Math.max(0.0001, wpBaseScale * wpZoom);
        const maxLongEdge = 2560;
        const outScale = Math.min(maxLongEdge / Math.max(cw, ch), nativePixelsPerCanvasPx);
        const outW = Math.max(cw, Math.round(cw * outScale));
        const outH = Math.max(ch, Math.round(ch * outScale));

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const drawW = wpImg.width * wpBaseScale * wpZoom * outScale;
        const drawH = wpImg.height * wpBaseScale * wpZoom * outScale;
        ctx.drawImage(
            wpImg,
            (outW - drawW) / 2 + wpOffX * outScale,
            (outH - drawH) / 2 + wpOffY * outScale,
            drawW,
            drawH
        );

        draftBgImage = outCanvas.toDataURL('image/jpeg', 0.94);
        if (typeof livePreviewWallpaper === 'function') livePreviewWallpaper();
        const tip = document.getElementById('bgStatusTip');
        if (tip) tip.innerText = `✅ 高清壁纸裁剪完成 (${outW}×${outH})，点底部「保存所有设置」永久生效！`;
        closeModal('wallpaperCropModal');
    }

    function hookWallpaperUpload() {
        window.handleBgImageUpload = async function (event) {
            const file = event.target.files?.[0];
            if (!file) return;
            const tip = document.getElementById('bgStatusTip');
            if (tip) tip.innerText = '⏳ 正在无损读取原图加载裁剪台...';
            try {
                // 直接无损读原图进裁剪台，绝不提前降分辨率！
                const rawUrl = await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = (e) => resolve(e.target.result);
                    r.onerror = reject;
                    r.readAsDataURL(file);
                });
                openWallpaperCropperFromDataUrl(rawUrl);
            } catch (e) {
                if (tip) tip.innerText = '❌ 壁纸读取失败：' + e.message;
            }
            event.target.value = '';
        };
    }

    // =========================================================================
    // 模块 4：桌面相框外置舞台（默认隐藏底座，点击相框开关显隐！）
    // =========================================================================
    function getCurrentWidgetItem() {
        if (typeof widgetPhotos === 'undefined' || !widgetPhotos.length) return null;
        return widgetPhotos[currentWidgetIdx % widgetPhotos.length];
    }

    function setToolsOpen(open) {
        toolsOpen = Boolean(open);
        document.getElementById('vproWidgetStage')?.classList.toggle('tools-open', toolsOpen);
    }

    function getPhotoFrame(id) {
        const f = prefs.photoFrames?.[String(id)];
        return {
            x: typeof f?.x === 'number' ? f.x : 0,
            y: typeof f?.y === 'number' ? f.y : 0,
            scale: typeof f?.scale === 'number' ? Math.max(1, Math.min(3, f.scale)) : 1
        };
    }

    function setPhotoFrame(id, frame, save = false) {
        if (!id) return;
        const s = Math.max(1, Math.min(3, Number(frame.scale) || 1));
        const maxPan = Math.min(48, Math.max(12, (s - 1) * 50 + 18));
        const x = Math.max(-maxPan, Math.min(maxPan, Number(frame.x) || 0));
        const y = Math.max(-maxPan, Math.min(maxPan, Number(frame.y) || 0));
        prefs.photoFrames[String(id)] = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), scale: Number(s.toFixed(3)) };
        applyCurrentPhotoFrame();
        if (save) persistPrefs(true);
    }

    function applyWidgetContainerStyle() {
        const wEl = document.getElementById('iosWidget');
        if (!wEl) return;
        wEl.classList.add('vpro-widget');
        wEl.classList.remove('vpro-shape-landscape', 'vpro-shape-square', 'vpro-shape-polaroid', 'vpro-shape-badge');
        wEl.classList.add(`vpro-shape-${prefs.widgetShape || 'landscape'}`);
        const w = Math.max(165, Math.min(360, parseInt(prefs.widgetWidth, 10) || 268));
        wEl.style.setProperty('--vpro-w', `${w}px`);

        document.querySelectorAll('[data-wshape]').forEach(b => b.classList.toggle('active', b.dataset.wshape === prefs.widgetShape));
        const sl = document.getElementById('widgetWidthSlider');
        const lbl = document.getElementById('widgetWidthVal');
        if (sl) sl.value = String(w);
        if (lbl) lbl.innerText = `${w}px`;
    }

    function applyCurrentPhotoFrame() {
        const wEl = document.getElementById('iosWidget');
        const img = document.querySelector('#widgetContentArea img');
        const item = getCurrentWidgetItem();
        if (!wEl || !img || !item) return;
        const f = getPhotoFrame(item.id);
        const tf = `translate(${f.x}%, ${f.y}%) scale(${f.scale})`;
        img.style.transform = tf;
        wEl.style.setProperty('--vpro-img-tf', tf);

        const sl = document.getElementById('vproFrameZoomSlider');
        if (sl && document.activeElement !== sl) sl.value = String(f.scale);
    }

    function syncPolaroidChinAndArrows() {
        const stage = document.getElementById('vproWidgetStage');
        const wEl = document.getElementById('iosWidget');
        if (!wEl) return;
        const hasMulti = typeof widgetPhotos !== 'undefined' && widgetPhotos.length > 1;
        stage?.classList.toggle('has-multi', hasMulti);

        let chin = document.getElementById('vproPolaroidChin');
        if (!chin) {
            chin = document.createElement('div');
            chin.id = 'vproPolaroidChin';
            chin.className = 'vpro-polaroid-chin';
            wEl.appendChild(chin);
        }
        const item = getCurrentWidgetItem();
        if (!item) { chin.innerHTML = ''; return; }
        const dots = hasMulti
            ? `<div class="widget-dots">${widgetPhotos.map((_, i) => `<span class="widget-dot ${i === currentWidgetIdx ? 'active' : ''}"></span>`).join('')}</div>`
            : '';
        const visPrefix = (!appConfig.soloMode && item.visible_to_ai) ? '👁️ ' : '';
        chin.innerHTML = `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${visPrefix}${esc(item.caption || 'My Photo')}</span>${dots}`;
    }

    function switchWidgetByDelta(delta) {
        if (typeof widgetPhotos === 'undefined' || widgetPhotos.length <= 1) return;
        const len = widgetPhotos.length;
        currentWidgetIdx = (currentWidgetIdx + delta + len) % len;
        if (typeof renderWidget === 'function') renderWidget();
        const area = document.getElementById('widgetContentArea');
        if (area) {
            area.classList.remove('anim-next', 'anim-prev');
            void area.offsetWidth;
            area.classList.add(delta > 0 ? 'anim-next' : 'anim-prev');
        }
    }

    function enterFramingMode() {
        const item = getCurrentWidgetItem();
        if (!item) return;
        framingMode = true;
        setToolsOpen(false);
        document.getElementById('iosWidget')?.classList.add('framing-mode');
        document.getElementById('vproWidgetStage')?.classList.add('framing-active');
        applyCurrentPhotoFrame();
        if (typeof showCommBanner === 'function') {
            showCommBanner('✂️ 相框构图调整中', '拖动照片调整位置，捏合/滚轮/拉下方滑块缩放，调好点「✓ 完成」～', false);
        }
    }

    function exitFramingMode() {
        if (!framingMode) return;
        framingMode = false;
        justSwipedOrFramedAt = Date.now();
        document.getElementById('iosWidget')?.classList.remove('framing-mode');
        document.getElementById('vproWidgetStage')?.classList.remove('framing-active');
        persistPrefs(true);
    }

    function resetCurrentPhotoFrame() {
        const item = getCurrentWidgetItem();
        if (!item) return;
        setPhotoFrame(item.id, { x: 0, y: 0, scale: 1 }, true);
    }

    function mountWidgetEnhancements() {
        const wEl = document.getElementById('iosWidget');
        if (!wEl) return;
        wEl.removeAttribute('title');

        let stage = document.getElementById('vproWidgetStage');
        let frameWrap = document.getElementById('vproFrameWrap');
        if (!stage) {
            stage = document.createElement('div');
            stage.id = 'vproWidgetStage';
            stage.className = 'vpro-widget-stage';

            frameWrap = document.createElement('div');
            frameWrap.id = 'vproFrameWrap';
            frameWrap.className = 'vpro-frame-wrap';

            wEl.parentNode.insertBefore(stage, wEl);
            frameWrap.appendChild(wEl);
            stage.appendChild(frameWrap);
        }

        const overlayTop = wEl.querySelector('.widget-overlay-top') || stage.querySelector('.widget-overlay-top');
        if (overlayTop) {
            const rightGroup = overlayTop.querySelector('div');
            if (rightGroup && !document.getElementById('vproShapeBtn')) {
                const frameBtn = document.createElement('button');
                frameBtn.id = 'vproFrameBtn';
                frameBtn.type = 'button';
                frameBtn.className = 'widget-chip-btn';
                frameBtn.innerText = '✂️';
                frameBtn.title = '拖动缩放调整照片构图（手机也可长按相框）';
                frameBtn.onclick = (e) => { e.stopPropagation(); enterFramingMode(); };

                const shapeBtn = document.createElement('button');
                shapeBtn.id = 'vproShapeBtn';
                shapeBtn.type = 'button';
                shapeBtn.className = 'widget-chip-btn';
                shapeBtn.innerText = '📐';
                shapeBtn.title = '切换相框形状与大小';
                shapeBtn.onclick = (e) => { e.stopPropagation(); openWidgetStyleModal(); };

                rightGroup.insertBefore(shapeBtn, rightGroup.firstChild);
                rightGroup.insertBefore(frameBtn, rightGroup.firstChild);
            }
            if (overlayTop.parentNode !== stage) {
                stage.appendChild(overlayTop);
            }
        }

        if (!document.getElementById('vproPrevArrow') && frameWrap) {
            const prev = document.createElement('button');
            prev.id = 'vproPrevArrow';
            prev.type = 'button';
            prev.className = 'vpro-nav-arrow prev';
            prev.innerText = '‹';
            prev.onclick = (e) => { e.stopPropagation(); switchWidgetByDelta(-1); };

            const next = document.createElement('button');
            next.id = 'vproNextArrow';
            next.type = 'button';
            next.className = 'vpro-nav-arrow next';
            next.innerText = '›';
            next.onclick = (e) => { e.stopPropagation(); switchWidgetByDelta(1); };

            frameWrap.appendChild(prev);
            frameWrap.appendChild(next);
        }

        if (!document.getElementById('vproFramingBar')) {
            const bar = document.createElement('div');
            bar.id = 'vproFramingBar';
            bar.className = 'vpro-framing-bar';
            bar.onclick = (e) => e.stopPropagation();
            bar.innerHTML = `
                <span>🔍</span>
                <input type="range" id="vproFrameZoomSlider" min="1" max="3" step="0.02" value="1">
                <button type="button" class="vpro-framing-btn" onclick="window.VisualPro.resetCurrentPhotoFrame()">归位</button>
                <button type="button" class="vpro-framing-btn done" onclick="window.VisualPro.exitFramingMode()">✓ 完成</button>
            `;
            stage.appendChild(bar);

            const sl = document.getElementById('vproFrameZoomSlider');
            sl?.addEventListener('input', (e) => {
                const item = getCurrentWidgetItem();
                if (!item) return;
                const cur = getPhotoFrame(item.id);
                setPhotoFrame(item.id, { ...cur, scale: parseFloat(e.target.value) || 1 }, false);
            });
            sl?.addEventListener('pointerdown', (e) => e.stopPropagation());
        }

        if (!document.getElementById('widgetStyleModal')) {
            const modal = document.createElement('div');
            modal.id = 'widgetStyleModal';
            modal.className = 'modal-backdrop';
            modal.style.zIndex = '275';
            modal.onclick = (e) => { if (e.target === modal) closeModal('widgetStyleModal'); };
            modal.innerHTML = `
                <div class="modal-box" style="max-width:410px;">
                    <h3>
                        <span>📐 相框形状与尺寸</span>
                        <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('widgetStyleModal')">✕</span>
                    </h3>
                    <div style="font-size:12px;color:#a8a29e;margin-bottom:8px;">选择相框形态</div>
                    <div class="vpro-chip-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px;">
                        <button type="button" class="vpro-chip" data-wshape="landscape" onclick="window.VisualPro.setWidgetShape('landscape')">🎞️ 宽幅横框 (16:10)</button>
                        <button type="button" class="vpro-chip" data-wshape="polaroid" onclick="window.VisualPro.setWidgetShape('polaroid')">📸 拍立得白边竖框</button>
                        <button type="button" class="vpro-chip" data-wshape="square" onclick="window.VisualPro.setWidgetShape('square')">🟦 精致正方框 (1:1)</button>
                        <button type="button" class="vpro-chip" data-wshape="badge" onclick="window.VisualPro.setWidgetShape('badge')">⭕ 圆形吧唧框</button>
                    </div>
                    <div class="form-group" style="margin-bottom:12px;">
                        <label>相框宽度（横/竖屏自动防溢出）：<span id="widgetWidthVal">268px</span></label>
                        <input type="range" id="widgetWidthSlider" min="165" max="360" step="4" value="268" oninput="window.VisualPro.setWidgetWidth(this.value, false)" onchange="window.VisualPro.setWidgetWidth(this.value, true)">
                    </div>
                    <div style="display:flex;gap:8px;margin-bottom:14px;">
                        <button type="button" class="mini-btn" style="flex:1;" onclick="window.VisualPro.setWidgetWidth(196, true)">小巧</button>
                        <button type="button" class="mini-btn" style="flex:1;" onclick="window.VisualPro.setWidgetWidth(268, true)">标准</button>
                        <button type="button" class="mini-btn" style="flex:1;" onclick="window.VisualPro.setWidgetWidth(332, true)">大气</button>
                    </div>
                    <button type="button" class="btn btn-primary" style="width:100%;" onclick="closeModal('widgetStyleModal');window.VisualPro.enterFramingMode();">✂️ 去微调当前照片构图</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.addEventListener('click', (e) => {
            if (toolsOpen && !stage.contains(e.target)) setToolsOpen(false);
        });

        bindWidgetGestures(wEl);
    }

    function bindWidgetGestures(wEl) {
        if (wEl.dataset.vproGesturesBound) return;
        wEl.dataset.vproGesturesBound = '1';

        let longPressTimer = null;
        let tStartX = 0, tStartY = 0;
        let panDragging = false, panLastX = 0, panLastY = 0;
        let pinchStartDist = 0, pinchStartScale = 1;

        wEl.addEventListener('touchstart', (e) => {
            const item = getCurrentWidgetItem();
            if (!item) return;

            if (framingMode) {
                if (e.touches.length === 2) {
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    pinchStartDist = Math.hypot(dx, dy);
                    pinchStartScale = getPhotoFrame(item.id).scale;
                    panDragging = false;
                } else if (e.touches.length === 1) {
                    panDragging = true;
                    panLastX = e.touches[0].clientX;
                    panLastY = e.touches[0].clientY;
                }
                return;
            }

            if (e.touches.length === 1) {
                tStartX = e.touches[0].clientX;
                tStartY = e.touches[0].clientY;
                clearTimeout(longPressTimer);
                longPressTimer = setTimeout(() => {
                    if (navigator.vibrate) try { navigator.vibrate(22); } catch {}
                    enterFramingMode();
                }, 460);
            }
        }, { passive: true });

        wEl.addEventListener('touchmove', (e) => {
            const item = getCurrentWidgetItem();
            if (!item) return;

            if (framingMode) {
                e.preventDefault();
                if (e.touches.length === 2 && pinchStartDist > 0) {
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    const dist = Math.hypot(dx, dy);
                    const cur = getPhotoFrame(item.id);
                    setPhotoFrame(item.id, { ...cur, scale: pinchStartScale * (dist / pinchStartDist) }, false);
                } else if (e.touches.length === 1 && panDragging) {
                    const rect = wEl.getBoundingClientRect();
                    const dx = e.touches[0].clientX - panLastX;
                    const dy = e.touches[0].clientY - panLastY;
                    panLastX = e.touches[0].clientX;
                    panLastY = e.touches[0].clientY;
                    const cur = getPhotoFrame(item.id);
                    setPhotoFrame(item.id, {
                        ...cur,
                        x: cur.x + (dx / Math.max(80, rect.width)) * 100,
                        y: cur.y + (dy / Math.max(80, rect.height)) * 100
                    }, false);
                }
                return;
            }

            if (e.touches.length === 1) {
                const dx = e.touches[0].clientX - tStartX;
                const dy = e.touches[0].clientY - tStartY;
                if (Math.hypot(dx, dy) > 12) clearTimeout(longPressTimer);
            }
        }, { passive: false });

        wEl.addEventListener('touchend', (e) => {
            clearTimeout(longPressTimer);
            if (framingMode) {
                panDragging = false;
                pinchStartDist = 0;
                persistPrefs(true);
                return;
            }
            if (e.changedTouches.length === 1 && typeof widgetPhotos !== 'undefined' && widgetPhotos.length > 1) {
                const dx = e.changedTouches[0].clientX - tStartX;
                const dy = e.changedTouches[0].clientY - tStartY;
                if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                    justSwipedOrFramedAt = Date.now();
                    switchWidgetByDelta(dx < 0 ? 1 : -1);
                }
            }
        }, { passive: true });

        wEl.addEventListener('mousedown', (e) => {
            if (!framingMode || e.button !== 0) return;
            e.preventDefault();
            panDragging = true; panLastX = e.clientX; panLastY = e.clientY;
        });
        window.addEventListener('mousemove', (e) => {
            if (!framingMode || !panDragging) return;
            const item = getCurrentWidgetItem();
            if (!item) return;
            const rect = wEl.getBoundingClientRect();
            const dx = e.clientX - panLastX;
            const dy = e.clientY - panLastY;
            panLastX = e.clientX; panLastY = e.clientY;
            const cur = getPhotoFrame(item.id);
            setPhotoFrame(item.id, {
                ...cur,
                x: cur.x + (dx / Math.max(80, rect.width)) * 100,
                y: cur.y + (dy / Math.max(80, rect.height)) * 100
            }, false);
        });
        window.addEventListener('mouseup', () => {
            if (framingMode && panDragging) { panDragging = false; persistPrefs(true); }
        });
        wEl.addEventListener('wheel', (e) => {
            if (!framingMode) return;
            const item = getCurrentWidgetItem();
            if (!item) return;
            e.preventDefault();
            const cur = getPhotoFrame(item.id);
            setPhotoFrame(item.id, { ...cur, scale: cur.scale + (e.deltaY < 0 ? 0.08 : -0.08) }, true);
        }, { passive: false });
    }

    function openWidgetStyleModal() {
        applyWidgetContainerStyle();
        document.getElementById('widgetStyleModal')?.classList.add('open');
    }

    function setWidgetShape(shape) {
        prefs.widgetShape = shape;
        applyWidgetContainerStyle();
        syncPolaroidChinAndArrows();
        applyCurrentPhotoFrame();
        persistPrefs(true);
    }

    function setWidgetWidth(val, save = true) {
        prefs.widgetWidth = Math.max(165, Math.min(360, parseInt(val, 10) || 268));
        applyWidgetContainerStyle();
        if (save) persistPrefs(true);
    }

    function hookWidgetRenderAndCycle() {
        if (typeof window.renderWidget === 'function') {
            const orig = window.renderWidget;
            window.renderWidget = function () {
                const ret = orig.apply(this, arguments);
                const hasPhotos = typeof widgetPhotos !== 'undefined' && widgetPhotos.length > 0;
                const fBtn = document.getElementById('vproFrameBtn');
                if (fBtn) fBtn.style.display = hasPhotos ? 'inline-block' : 'none';
                if (!hasPhotos) setToolsOpen(false);
                applyWidgetContainerStyle();
                syncPolaroidChinAndArrows();
                applyCurrentPhotoFrame();
                return ret;
            };
        }

        window.cycleWidgetPhoto = function () {
            if (framingMode || Date.now() - justSwipedOrFramedAt < 380) return;
            if (typeof widgetPhotos === 'undefined' || !widgetPhotos.length) return;
            setToolsOpen(!toolsOpen);
        };
    }

    window.VisualPro = {
        setClockFont,
        setClockEffect,
        toggleClockMode,
        setWpAspect,
        onWpZoom,
        useOriginalWallpaper,
        confirmWallpaperCrop,
        setWidgetShape,
        setWidgetWidth,
        enterFramingMode,
        exitFramingMode,
        resetCurrentPhotoFrame
    };

    injectWebFonts();
    injectStyles();
    upgradeGlobalImageSharpness();
    patchChatDrawerLockAndToast();
    injectClockAndWallpaperSettingsUI();
    mountWallpaperCropModal();
    hookWallpaperUpload();
    mountWidgetEnhancements();
    hookWidgetRenderAndCycle();
    initClockDoubleClickAndTicker();

    applyClockVisuals();
    applyWidgetContainerStyle();
    loadServerPrefs();
})();