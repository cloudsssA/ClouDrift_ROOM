// public/home/home-ui.js
// ClouDrift 2D XY Pixel Home — 宽屏精装公寓交互面板 + 左二右二单行极简顶栏

(function (global) {
    'use strict';

    const STATE = {
        isOpen: false,
        charKey: 'default',
        charName: 'TA',
        wallet: { coins: 500, total_earned: 500 },
        room: null,
        inventory: [],
        placements: [],
        activeTab: 'bag',      // 'bag' | 'shop' | 'skins' | 'diy'
        shopCategory: 'all',
        lightingMode: 'auto',
        showPet: true,
        placingItemId: null,
        placingRotation: 0,
        movingPlacement: null,
        selectedPlacement: null,
        engine: null,
        toastTimer: null,
        prevBodyOverflow: '',
        diyDraftDataUrl: ''
    };

    const LIGHTING_CYCLE = [
        { key: 'auto', label: '🕒 自动天色' },
        { key: 'day', label: '☀️ 白天' },
        { key: 'sunset', label: '🌇 黄昏' },
        { key: 'night', label: '🌙 深夜' }
    ];

    function getApiBase() {
        return typeof API_BASE !== 'undefined' ? API_BASE : '';
    }

    function getCurrentCharInfo() {
        const cfg = typeof appConfig !== 'undefined' ? appConfig : {};
        const key = (cfg.activeCharKey || '').trim() || `custom_${(cfg.charName || 'default').trim()}`;
        const name = (cfg.charName || 'TA').trim();
        return { charKey: key, charName: name };
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 保留 PNG 透明通道的轻量图片压缩器（透明底亚克力立牌绝不黑底！）
     */
    function compressDiyImage(file, maxSide = 320, preserveAlpha = true) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
                    const w = Math.max(16, Math.round(img.width * ratio));
                    const h = Math.max(16, Math.round(img.height * ratio));
                    const c = document.createElement('canvas');
                    c.width = w;
                    c.height = h;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const isPng = preserveAlpha || /png|webp/i.test(file.type);
                    resolve(isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
                };
                img.onerror = () => reject(new Error('图片读取失败'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    function injectStyles() {
        let style = document.getElementById('cloudHomeStyles');
        if (style) {
            // 始终挪到 <head> 最末尾，确保高优先级压制其它插件的窄屏样式
            document.head.appendChild(style);
            return;
        }
        style = document.createElement('style');
        style.id = 'cloudHomeStyles';
        style.textContent = `

            /* === 家园主弹窗 === */
            .ch-backdrop {
                position: fixed; inset: 0; z-index: 220;
                background: rgba(10, 9, 8, 0.84); backdrop-filter: blur(10px);
                display: none; align-items: center; justify-content: center;
                padding: 16px; overscroll-behavior: contain;
            }
            .ch-backdrop.open { display: flex; }

            .ch-shell {
                width: min(1140px, 100%); height: min(760px, 92vh);
                background: #1a1816; border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 22px; box-shadow: 0 28px 80px rgba(0, 0, 0, 0.72);
                display: flex; flex-direction: column; overflow: hidden;
                color: #f5f5f4; position: relative;
            }

            .ch-header {
                display: flex; align-items: center; justify-content: space-between;
                gap: 8px; padding: 10px 14px;
                background: rgba(30, 28, 26, 0.96);
                border-bottom: 1px solid rgba(255, 255, 255, 0.09);
                flex-shrink: 0; flex-wrap: wrap;
            }
            .ch-header-left, .ch-header-right {
                display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
            }
            .ch-room-title-btn {
                background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.12);
                color: #fef3c7; font-size: 13.5px; font-weight: 600;
                padding: 5px 11px; border-radius: 999px; cursor: pointer;
                display: inline-flex; align-items: center; gap: 5px;
            }
            .ch-room-title-btn:hover { border-color: #fbbf24; }
            .ch-char-badge {
                font-size: 11px; color: #d6d3d1; padding: 4px 9px;
                border-radius: 999px; background: rgba(255, 255, 255, 0.06);
            }
            .ch-coin-pill {
                font-size: 12.5px; font-weight: 700; color: #fef08a;
                background: rgba(217, 119, 6, 0.22); border: 1px solid rgba(251, 191, 36, 0.45);
                padding: 4px 10px; border-radius: 999px; font-variant-numeric: tabular-nums;
            }
            .ch-btn {
                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
                color: #f5f5f4; padding: 5px 10px; border-radius: 999px;
                font-size: 12px; cursor: pointer; transition: all 0.16s; white-space: nowrap;
            }
            .ch-btn:hover { background: rgba(255, 255, 255, 0.16); }
            .ch-btn.primary { background: #d97706; border-color: #f59e0b; color: #fff; font-weight: 600; }
            .ch-btn.danger { color: #fca5a5; border-color: rgba(239, 68, 68, 0.38); }
            .ch-btn.active { border-color: #fbbf24; color: #fef08a; background: rgba(217, 119, 6, 0.22); }

            .ch-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
            .ch-stage {
                flex: 1.45; position: relative; min-width: 0; min-height: 0;
                background: #141312; overflow: hidden;
                user-select: none; -webkit-user-select: none; touch-action: none;
            }
            .ch-canvas {
                display: block; width: 100%; height: 100%;
                cursor: pointer; image-rendering: pixelated; touch-action: none;
            }

            .ch-mode-banner {
                position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
                background: rgba(22, 20, 18, 0.93); border: 1px solid rgba(74, 222, 128, 0.55);
                color: #dcfce7; padding: 6px 12px; border-radius: 999px;
                font-size: 11.5px; display: none; align-items: center; gap: 7px;
                z-index: 10; max-width: calc(100% - 20px);
                box-shadow: 0 10px 26px rgba(0, 0, 0, 0.48); white-space: nowrap;
            }
            .ch-mode-banner.show { display: inline-flex; }

            .ch-action-bar {
                position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
                background: rgba(24, 22, 20, 0.94); border: 1px solid rgba(251, 191, 36, 0.45);
                padding: 6px 10px; border-radius: 999px; display: none; align-items: center;
                gap: 6px; z-index: 12; box-shadow: 0 14px 36px rgba(0, 0, 0, 0.62);
                max-width: calc(100% - 18px); flex-wrap: wrap; justify-content: center;
            }
            .ch-action-bar.show { display: inline-flex; }
            .ch-action-name { font-size: 12px; font-weight: 600; color: #fef3c7; padding: 0 5px; }

            .ch-toast {
                position: absolute; top: 50px; left: 50%; transform: translate(-50%, -8px);
                background: rgba(28, 25, 23, 0.94); border: 1px solid rgba(255, 255, 255, 0.16);
                color: #fef3c7; padding: 6px 14px; border-radius: 999px;
                font-size: 12px; opacity: 0; pointer-events: none; transition: all 0.22s ease;
                z-index: 20; white-space: nowrap; max-width: calc(100% - 24px);
                overflow: hidden; text-overflow: ellipsis;
            }
            .ch-toast.show { opacity: 1; transform: translate(-50%, 0); }

            .ch-dock {
                width: 356px; flex-shrink: 0; background: #201e1c;
                border-left: 1px solid rgba(255, 255, 255, 0.09);
                display: flex; flex-direction: column; min-height: 0;
            }
            .ch-tabs {
                display: grid; grid-template-columns: repeat(4, 1fr);
                gap: 5px; padding: 9px 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;
            }
            .ch-tab-btn {
                background: rgba(255, 255, 255, 0.05); border: 1px solid transparent;
                color: #a8a29e; padding: 7px 4px; border-radius: 10px;
                font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.16s;
                white-space: nowrap;
            }
            .ch-tab-btn.active {
                background: rgba(217, 119, 6, 0.24); border-color: rgba(251, 191, 36, 0.55); color: #fef3c7;
            }

            .ch-filter-row {
                display: flex; gap: 5px; padding: 8px 10px 2px;
                overflow-x: auto; flex-shrink: 0;
            }
            .ch-filter-pill {
                background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
                color: #d6d3d1; padding: 4px 9px; border-radius: 999px;
                font-size: 11px; cursor: pointer; white-space: nowrap;
            }
            .ch-filter-pill.active { background: #d97706; border-color: #f59e0b; color: #fff; }

            .ch-list {
                flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
                padding: 10px 10px 18px;
                display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px; align-content: start;
            }
            .ch-card {
                background: #171513; border: 1px solid rgba(255, 255, 255, 0.10);
                border-radius: 13px; padding: 8px; display: flex; flex-direction: column;
                gap: 5px; cursor: pointer; transition: all 0.16s; position: relative;
            }
            .ch-card:hover { border-color: rgba(251, 191, 36, 0.55); transform: translateY(-1px); }
            .ch-card.selected { border-color: #4ade80; box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.22); }
            .ch-card.equipped { border-color: #fbbf24; background: rgba(217, 119, 6, 0.12); }
            .ch-card.disabled { opacity: 0.52; }
            .ch-thumb-box {
                width: 100%; height: 70px; border-radius: 9px;
                background: radial-gradient(circle at 50% 60%, rgba(255,255,255,0.07), rgba(0,0,0,0.25));
                display: flex; align-items: center; justify-content: center; overflow: hidden;
            }
            .ch-thumb-box img { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; }
            .ch-thumb-box img.diy-smooth { image-rendering: auto; border-radius: 5px; }
            .ch-card-name {
                font-size: 12px; font-weight: 600; color: #f5f5f4;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .ch-card-sub {
                font-size: 10.5px; color: #a8a29e; line-height: 1.35;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden; min-height: 28px;
            }
            .ch-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-top: auto; }
            .ch-price-tag { font-size: 11.5px; font-weight: 700; color: #fde047; }
            .ch-mini-badge {
                font-size: 10px; padding: 2px 6px; border-radius: 999px;
                background: rgba(255, 255, 255, 0.09); color: #e7e5e4; white-space: nowrap;
            }
            .ch-mini-badge.green { background: rgba(34, 197, 94, 0.22); color: #86efac; }
            .ch-mini-badge.gold { background: rgba(245, 158, 11, 0.25); color: #fde68a; }
            .ch-empty-box { grid-column: 1 / -1; text-align: center; padding: 24px 12px; color: #a8a29e; font-size: 12.5px; line-height: 1.7; }
            .ch-section-label { grid-column: 1 / -1; font-size: 11.5px; font-weight: 600; color: #fbbf24; padding: 4px 2px 0; }

            .ch-diy-box {
                grid-column: 1 / -1; background: #161412;
                border: 1px dashed rgba(251, 191, 36, 0.38); border-radius: 14px;
                padding: 12px; display: flex; flex-direction: column; gap: 9px;
            }
            .ch-diy-preview {
                width: 100%; height: 92px; border-radius: 10px;
                background: repeating-conic-gradient(#262422 0% 25%, #1d1b19 0% 50%) 50% / 14px 14px;
                display: flex; align-items: center; justify-content: center;
                color: #a8a29e; font-size: 12px; cursor: pointer; overflow: hidden;
                border: 1px solid rgba(255,255,255,0.09);
            }
            .ch-diy-preview img { max-width: 100%; max-height: 86px; object-fit: contain; }
            .ch-diy-input {
                width: 100%; background: #22201e; border: 1px solid rgba(255,255,255,0.14);
                color: #f5f5f4; padding: 7px 10px; border-radius: 8px; font-size: 12.5px; outline: none;
            }
            .ch-diy-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
            .ch-diy-del {
                position: absolute; top: 5px; right: 5px;
                background: rgba(24,22,20,0.84); border: 1px solid rgba(239,68,68,0.45);
                color: #fca5a5; border-radius: 999px; font-size: 10px;
                padding: 1px 6px; cursor: pointer;
            }

            @media (max-width: 820px) {
                .ch-backdrop { padding: 0; }
                .ch-shell { width: 100%; height: 100%; border-radius: 0; border: none; }
                .ch-header { padding: 7px 9px; gap: 5px; }
                .ch-char-badge { display: none; }
                .ch-room-title-btn { font-size: 12px; padding: 4px 8px; }
                .ch-coin-pill { font-size: 11px; padding: 4px 8px; }
                .ch-btn { font-size: 11px; padding: 4px 7px; }
                .ch-body { flex-direction: column; }
                .ch-stage { flex: 1.05; min-height: 230px; }
                .ch-dock {
                    width: 100%; height: 47%; min-height: 230px;
                    border-left: none; border-top: 1px solid rgba(255, 255, 255, 0.12);
                }
                .ch-list { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 8px 9px 18px; }
                .ch-thumb-box { height: 54px; }
                .ch-thumb-box img { width: 50px; height: 50px; }
                .ch-card-sub { display: none; }
            }
        `;
        document.head.appendChild(style);
    }

  

    function ensureModalDOM() {
        if (document.getElementById('cloudHomeBackdrop')) return;
        const wrap = document.createElement('div');
        wrap.id = 'cloudHomeBackdrop';
        wrap.className = 'ch-backdrop';
        wrap.innerHTML = `
            <div class="ch-shell" onclick="event.stopPropagation()">
                <div class="ch-header">
                    <div class="ch-header-left">
                        <button class="ch-room-title-btn" id="chRoomNameBtn" title="点击给小窝改名">🏡 <span id="chRoomNameText">共享小窝</span> ✎</button>
                        <span class="ch-char-badge" id="chCharBadge">宽屏像素公寓</span>
                    </div>
                    <div class="ch-header-right">
                        <span class="ch-coin-pill" id="chCoinText" title="专注 1 分钟 = 2 币，完整 25 分钟额外暴击 +20 币！">🪙 500</span>
                        <button class="ch-btn active" id="chPetBtn" title="开关屋内漫步像素小猫">🐱 小猫</button>
                        <button class="ch-btn" id="chLightBtn" title="切换白天/黄昏/深夜开灯效果">🕒 自动天色</button>
                        <button class="ch-btn danger" id="chClearBtn" title="全部收回背包">🧹 清空</button>
                        <button class="ch-btn" id="chCloseBtn">✕ 关闭</button>
                    </div>
                </div>
                <div class="ch-body">
                    <div class="ch-stage">
                        <canvas class="ch-canvas" id="chCanvas"></canvas>
                        <div class="ch-mode-banner" id="chModeBanner">
                            <span id="chModeBannerText">点亮起的绿格子摆放</span>
                            <button class="ch-btn" id="chRotatePlacingBtn" style="padding:2px 8px;font-size:11px;">🪞 镜像</button>
                            <button class="ch-btn danger" id="chCancelModeBtn" style="padding:2px 8px;font-size:11px;">取消</button>
                        </div>
                        <div class="ch-toast" id="chToast"></div>
                        <div class="ch-action-bar" id="chActionBar">
                            <span class="ch-action-name" id="chSelectedName">家具</span>
                            <button class="ch-btn" id="chActRotate">🪞 镜像</button>
                            <button class="ch-btn" id="chActMove">✋ 移动</button>
                            <button class="ch-btn danger" id="chActRemove">📦 收纳</button>
                            <button class="ch-btn" id="chActDone">✕</button>
                        </div>
                    </div>
                    <div class="ch-dock">
                        <div class="ch-tabs">
                            <button class="ch-tab-btn active" data-tab="bag">🎒 背包</button>
                            <button class="ch-tab-btn" data-tab="shop">🛍️ 商城</button>
                            <button class="ch-tab-btn" data-tab="skins">🪟 装潢</button>
                            <button class="ch-tab-btn" data-tab="diy">🖼️ 痛墙</button>
                        </div>
                        <div class="ch-filter-row" id="chFilterRow" style="display:none;"></div>
                        <div class="ch-list" id="chList"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        wrap.addEventListener('click', () => close());
        document.getElementById('chCloseBtn').addEventListener('click', () => close());
        document.getElementById('chRoomNameBtn').addEventListener('click', renameRoom);
        document.getElementById('chLightBtn').addEventListener('click', cycleLighting);
        document.getElementById('chClearBtn').addEventListener('click', clearRoomPlacements);
        document.getElementById('chPetBtn').addEventListener('click', () => {
            STATE.showPet = !STATE.showPet;
            document.getElementById('chPetBtn').classList.toggle('active', STATE.showPet);
            if (STATE.engine) STATE.engine.setShowPet(STATE.showPet);
        });
        document.getElementById('chCancelModeBtn').addEventListener('click', () => { exitEditMode(); renderDock(); });
        document.getElementById('chRotatePlacingBtn').addEventListener('click', () => {
            STATE.placingRotation = (STATE.placingRotation + 1) & 1;
            if (STATE.engine) STATE.engine.setPlacingItem(STATE.placingItemId, STATE.placingRotation);
            showToast('🪞 已水平镜像翻转～');
        });

        document.getElementById('chActRotate').addEventListener('click', flipSelectedPlacement);
        document.getElementById('chActMove').addEventListener('click', startMovingSelected);
        document.getElementById('chActRemove').addEventListener('click', removeSelectedPlacement);
        document.getElementById('chActDone').addEventListener('click', () => {
            STATE.selectedPlacement = null;
            if (STATE.engine) STATE.engine.setSelectedPlacement(null);
            updateActionBar();
        });

        wrap.querySelectorAll('.ch-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                STATE.activeTab = btn.dataset.tab;
                wrap.querySelectorAll('.ch-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
                renderDock();
            });
        });

        global.CloudHomeCatalog.setAssetLoadedCallback(() => {
            if (STATE.isOpen) {
                renderDock();
                if (STATE.engine) STATE.engine.render(performance.now());
            }
        });

        const canvas = document.getElementById('chCanvas');
        STATE.engine = new global.CloudHomeEngine(canvas, {
            onTilePlace: handleTilePlace,
            onTileMove: handleTileMove,
            onSelectPlacement: (placement) => {
                STATE.selectedPlacement = placement || null;
                updateActionBar();
            },
            onInvalidTile: (itemId) => {
                const invMap = new Map(STATE.inventory.map((i) => [i.item_id, i]));
                const item = global.CloudHomeCatalog.getItemDef(itemId, invMap);
                if (item && item.layer === 'wall') showToast('🧱 墙饰/痛墙挂画请点上方亮绿色的墙壁区域哦～');
                else showToast('⚠️ 请点下方亮绿色的地板空位（立牌/玫瑰可直接叠在书桌上）！');
            }
        });
    }

    function showToast(msg) {
        const el = document.getElementById('chToast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(STATE.toastTimer);
        STATE.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    function exitEditMode() {
        STATE.placingItemId = null;
        STATE.movingPlacement = null;
        if (STATE.engine) {
            STATE.engine.setPlacingItem(null);
            STATE.engine.setMovingPlacement(null);
        }
        updateModeBanner();
    }

    function startPlacing(itemId) {
        STATE.placingItemId = itemId;
        STATE.placingRotation = 0;
        STATE.movingPlacement = null;
        STATE.selectedPlacement = null;
        if (STATE.engine) STATE.engine.setPlacingItem(itemId, 0);
        updateModeBanner();
        updateActionBar();
    }

    function updateModeBanner() {
        const bar = document.getElementById('chModeBanner');
        const txt = document.getElementById('chModeBannerText');
        const rotBtn = document.getElementById('chRotatePlacingBtn');
        if (!bar) return;
        const invMap = new Map(STATE.inventory.map((i) => [i.item_id, i]));

        if (STATE.placingItemId) {
            const item = global.CloudHomeCatalog.getItemDef(STATE.placingItemId, invMap);
            txt.textContent = `点绿格放置【${item ? item.name : STATE.placingItemId}】`;
            rotBtn.style.display = (item && item.layer !== 'rug' && item.diyKind !== 'poster') ? 'inline-block' : 'none';
            bar.classList.add('show');
        } else if (STATE.movingPlacement) {
            const item = global.CloudHomeCatalog.getItemDef(STATE.movingPlacement.item_id, invMap);
            txt.textContent = `点绿格移动【${item ? item.name : '家具'}】`;
            rotBtn.style.display = 'none';
            bar.classList.add('show');
        } else {
            bar.classList.remove('show');
        }
    }

    function updateActionBar() {
        const bar = document.getElementById('chActionBar');
        const nameEl = document.getElementById('chSelectedName');
        const rotBtn = document.getElementById('chActRotate');
        if (!bar) return;
        if (!STATE.selectedPlacement || STATE.placingItemId || STATE.movingPlacement) {
            bar.classList.remove('show');
            return;
        }
        const invMap = new Map(STATE.inventory.map((i) => [i.item_id, i]));
        const item = global.CloudHomeCatalog.getItemDef(STATE.selectedPlacement.item_id, invMap);
        nameEl.textContent = item ? item.name : STATE.selectedPlacement.item_id;
        rotBtn.style.display = (item && item.layer !== 'rug' && item.diyKind !== 'poster') ? 'inline-block' : 'none';
        bar.classList.add('show');
    }

    function updateHeaderUI() {
        const coinsEl = document.getElementById('chCoinText');
        const nameEl = document.getElementById('chRoomNameText');
        const charEl = document.getElementById('chCharBadge');
        if (coinsEl) coinsEl.textContent = `🪙 ${STATE.wallet?.coins ?? 0}`;
        if (nameEl) nameEl.textContent = STATE.room?.room_name || `${STATE.charName} 的小窝`;
        if (charEl) charEl.textContent = `12×8 宽屏公寓 · ${STATE.charName}`;
    }

    function syncEngine() {
        if (!STATE.engine) return;
        STATE.engine.setData({ room: STATE.room, placements: STATE.placements, inventory: STATE.inventory });
    }

    async function refresh() {
        const info = getCurrentCharInfo();
        STATE.charKey = info.charKey;
        STATE.charName = info.charName;

        const resp = await fetch(`${getApiBase()}/api/home/state?char_key=${encodeURIComponent(STATE.charKey)}`);
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            showToast(`⚠️ 加载小窝失败：${data.error || resp.status}`);
            return;
        }

        STATE.wallet = data.wallet;
        STATE.room = data.room;
        STATE.inventory = data.inventory || [];
        STATE.placements = data.placements || [];

        if (data.sprites) {
            global.CloudHomeCatalog.registerExternalSprites(data.sprites);
        }

        if (STATE.selectedPlacement) {
            STATE.selectedPlacement = STATE.placements.find((p) => p.id === STATE.selectedPlacement.id) || null;
        }

        updateHeaderUI();
        syncEngine();
        updateActionBar();
        renderDock();
    }

    async function buyItem(itemId) {
        const resp = await fetch(`${getApiBase()}/api/home/shop/buy`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, qty: 1 })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`💸 ${data.error || '购买失败'}`); return false; }
        STATE.wallet = data.wallet;
        STATE.inventory = data.inventory || [];
        updateHeaderUI(); syncEngine(); renderDock();
        const item = global.CloudHomeCatalog.getAllCatalogItems().find((i) => i.id === itemId);
        showToast(`🎉 买到【${item ? item.name : itemId}】啦！`);
        return true;
    }

    async function applySkin(skinType, skinId) {
        const body = { char_key: STATE.charKey };
        if (skinType === 'wall') body.wall_skin = skinId;
        else if (skinType === 'floor') body.floor_skin = skinId;
        else body.window_skin = skinId;

        const resp = await fetch(`${getApiBase()}/api/home/room`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '换装失败'}`); return; }
        STATE.room = data.room;
        syncEngine(); renderDock();
        showToast('✨ 房间风景/装潢已换好！');
    }

    async function handleTilePlace(itemId, gx, gy, rot) {
        const invMap = new Map(STATE.inventory.map((i) => [i.item_id, i]));
        const item = global.CloudHomeCatalog.getItemDef(itemId, invMap);
        const resp = await fetch(`${getApiBase()}/api/home/placements`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                char_key: STATE.charKey, item_id: itemId,
                grid_x: gx, grid_y: gy, rotation: rot & 1,
                layer: item ? item.layer : 'floor'
            })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '摆放失败'}`); return; }
        STATE.placements = data.placements || [];
        syncEngine();

        const inv = invMap.get(itemId);
        const placedCnt = STATE.placements.filter((p) => p.item_id === itemId).length;
        if (!inv || placedCnt >= inv.owned_count) exitEditMode();
        renderDock();
        showToast(`🏡 已摆好【${item ? item.name : itemId}】！`);
    }

    async function handleTileMove(placement, gx, gy, rot) {
        const resp = await fetch(`${getApiBase()}/api/home/placements/${placement.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grid_x: gx, grid_y: gy, rotation: rot & 1 })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '移动失败'}`); return; }
        STATE.placements = data.placements || [];
        STATE.selectedPlacement = data.placement;
        exitEditMode();
        if (STATE.engine) STATE.engine.setSelectedPlacement(data.placement.id);
        syncEngine(); updateActionBar();
        showToast('✋ 位置已调整好啦～');
    }

    async function flipSelectedPlacement() {
        const p = STATE.selectedPlacement;
        if (!p) return;
        const resp = await fetch(`${getApiBase()}/api/home/placements/${p.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rotation: (p.rotation + 1) & 1 })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '翻转失败'}`); return; }
        STATE.placements = data.placements || [];
        STATE.selectedPlacement = data.placement;
        syncEngine(); updateActionBar();
    }

    function startMovingSelected() {
        if (!STATE.selectedPlacement) return;
        STATE.movingPlacement = STATE.selectedPlacement;
        if (STATE.engine) STATE.engine.setMovingPlacement(STATE.selectedPlacement);
        updateModeBanner(); updateActionBar();
    }

    async function removeSelectedPlacement() {
        const p = STATE.selectedPlacement;
        if (!p) return;
        const resp = await fetch(`${getApiBase()}/api/home/placements/${p.id}`, { method: 'DELETE' });
        const data = await resp.json();
        if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '收纳失败'}`); return; }
        STATE.placements = data.placements || [];
        STATE.selectedPlacement = null;
        if (STATE.engine) STATE.engine.setSelectedPlacement(null);
        syncEngine(); updateActionBar(); renderDock();
        showToast('📦 已收纳回背包～');
    }

    async function clearRoomPlacements() {
        if (!STATE.placements.length) { showToast('小窝现在已经空荡荡啦～'); return; }
        if (!confirm(`要把【${STATE.room?.room_name || '当前小窝'}】里摆出的 ${STATE.placements.length} 件物品全部收回背包吗？`)) return;
        const resp = await fetch(`${getApiBase()}/api/home/placements/clear`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ char_key: STATE.charKey })
        });
        const data = await resp.json();
        if (resp.ok && data.ok) {
            STATE.placements = []; STATE.selectedPlacement = null;
            exitEditMode(); syncEngine(); updateActionBar(); renderDock();
            showToast('🧹 已全部收回背包！');
        }
    }

    async function renameRoom() {
        const cur = STATE.room?.room_name || '共享小窝';
        const next = prompt('给这间像素公寓起个名字吧（最多 30 字）：', cur);
        if (!next || !next.trim() || next.trim() === cur) return;
        const resp = await fetch(`${getApiBase()}/api/home/room`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ char_key: STATE.charKey, room_name: next.trim() })
        });
        const data = await resp.json();
        if (resp.ok && data.ok) { STATE.room = data.room; updateHeaderUI(); showToast(`✨ 已改名为「${STATE.room.room_name}」`); }
    }

    function cycleLighting() {
        const idx = LIGHTING_CYCLE.findIndex((x) => x.key === STATE.lightingMode);
        const next = LIGHTING_CYCLE[(idx + 1) % LIGHTING_CYCLE.length];
        STATE.lightingMode = next.key;
        document.getElementById('chLightBtn').textContent = next.label;
        if (STATE.engine) STATE.engine.setLightingMode(next.key);
    }

    function renderDock() {
        const filterRow = document.getElementById('chFilterRow');
        const listEl = document.getElementById('chList');
        if (!listEl) return;

        const cat = global.CloudHomeCatalog;
        const invMap = new Map(STATE.inventory.map((i) => [i.item_id, i]));
        const placedCountMap = new Map();
        STATE.placements.forEach((p) => placedCountMap.set(p.item_id, (placedCountMap.get(p.item_id) || 0) + 1));

        if (STATE.activeTab === 'bag') {
            filterRow.style.display = 'none';
            const placeable = STATE.inventory.filter((i) => cat.ITEMS[i.item_id] || i.source === 'diy');
            if (!placeable.length) {
                listEl.innerHTML = `
                    <div class="ch-empty-box">
                        🎒 背包里还没有家具或痛墙周边呢！<br>
                        你手上有 <strong>${STATE.wallet?.coins ?? 0} 云朵币</strong>，快去商城扫货，或去「🖼️ 痛墙」上传自推立牌吧～<br><br>
                        <button class="ch-btn primary" id="chGoShopBtn">🛍️ 去逛商城</button>
                    </div>
                `;
                document.getElementById('chGoShopBtn')?.addEventListener('click', () => switchTab('shop'));
                return;
            }

            listEl.innerHTML = placeable.map((inv) => {
                const item = cat.getItemDef(inv.item_id, invMap);
                if (!item) return '';
                const placed = placedCountMap.get(inv.item_id) || 0;
                const remain = Math.max(0, inv.owned_count - placed);
                const isPlacing = STATE.placingItemId === inv.item_id;
                const thumb = cat.getItemThumbDataUrl(inv.item_id, inv);
                return `
                    <div class="ch-card ${isPlacing ? 'selected' : ''} ${remain === 0 ? 'disabled' : ''}" data-bag-id="${esc(inv.item_id)}">
                        <div class="ch-thumb-box"><img class="${item.isDiy && !item.pixelated ? 'diy-smooth' : ''}" src="${thumb}" alt="${esc(item.name)}"></div>
                        <div class="ch-card-name">${esc(item.name)}</div>
                        <div class="ch-card-sub">${esc(item.desc)}</div>
                        <div class="ch-card-foot">
                            <span class="ch-mini-badge ${remain > 0 ? 'green' : ''}">剩 ${remain}/${inv.owned_count}</span>
                            <span class="ch-mini-badge">${isPlacing ? '摆放中' : (remain > 0 ? '点此摆放' : '已摆完')}</span>
                        </div>
                    </div>
                `;
            }).join('');

            listEl.querySelectorAll('[data-bag-id]').forEach((card) => {
                card.addEventListener('click', () => {
                    const id = card.dataset.bagId;
                    const inv = invMap.get(id);
                    const placed = placedCountMap.get(id) || 0;
                    if (!inv || inv.owned_count - placed <= 0) {
                        showToast('这件物品全摆出来啦～');
                        return;
                    }
                    if (STATE.placingItemId === id) exitEditMode();
                    else startPlacing(id);
                    renderDock();
                });
            });
            return;
        }

        if (STATE.activeTab === 'shop') {
            const filters = [
                { id: 'all', label: '全部' },
                { id: 'furniture', label: '🪑 家具' },
                { id: 'lighting', label: '🕯️ 灯具' },
                { id: 'wall', label: '🖼️ 墙饰' },
                { id: 'rug', label: '🧶 地毯' },
                { id: 'decor', label: '🌿 摆件/宠' },
                { id: 'skin', label: '🪟 窗与墙地' }
            ];
            filterRow.style.display = 'flex';
            filterRow.innerHTML = filters.map((f) =>
                `<button class="ch-filter-pill ${STATE.shopCategory === f.id ? 'active' : ''}" data-cat="${f.id}">${f.label}</button>`
            ).join('');
            filterRow.querySelectorAll('[data-cat]').forEach((b) => {
                b.addEventListener('click', () => { STATE.shopCategory = b.dataset.cat; renderDock(); });
            });

            const items = cat.getAllCatalogItems().filter((it) => {
                if (it.shopHidden || it.price <= 0) return false;
                if (STATE.shopCategory === 'all') return true;
                if (STATE.shopCategory === 'decor') return it.category === 'decor' || it.category === 'pet';
                return it.category === STATE.shopCategory;
            });

            listEl.innerHTML = items.map((item) => {
                const inv = invMap.get(item.id);
                const owned = inv ? inv.owned_count : 0;
                const isOwnedSkin = item.isSkin && owned > 0;
                const thumb = cat.getItemThumbDataUrl(item.id);
                return `
                    <div class="ch-card ${isOwnedSkin ? 'equipped' : ''}" data-buy-id="${esc(item.id)}">
                        <div class="ch-thumb-box"><img src="${thumb}" alt="${esc(item.name)}"></div>
                        <div class="ch-card-name">${esc(item.name)}</div>
                        <div class="ch-card-sub">${esc(item.desc)}</div>
                        <div class="ch-card-foot">
                            <span class="ch-price-tag">${isOwnedSkin ? '已拥有' : `🪙 ${item.price}`}</span>
                            <span class="ch-mini-badge ${owned > 0 ? 'gold' : ''}">${isOwnedSkin ? '去换装' : (owned > 0 ? `有 ${owned}` : '购买')}</span>
                        </div>
                    </div>
                `;
            }).join('');

            listEl.querySelectorAll('[data-buy-id]').forEach((card) => {
                card.addEventListener('click', async () => {
                    const id = card.dataset.buyId;
                    const item = cat.getAllCatalogItems().find((i) => i.id === id);
                    if (!item) return;
                    const inv = invMap.get(id);
                    if (item.isSkin && inv && inv.owned_count > 0) { switchTab('skins'); return; }
                    await buyItem(id);
                });
            });
            return;
        }

        if (STATE.activeTab === 'skins') {
            filterRow.style.display = 'none';
            const renderSkinCards = (skins, skinType) => skins.map((s) => {
                const owned = s.price === 0 || (invMap.get(s.id)?.owned_count || 0) > 0;
                const equipped = skinType === 'wall'
                    ? STATE.room?.wall_skin === s.id
                    : (skinType === 'floor' ? STATE.room?.floor_skin === s.id : (STATE.room?.window_skin || 'window_clouds_day') === s.id);
                const thumb = cat.getItemThumbDataUrl(s.id);
                return `
                    <div class="ch-card ${equipped ? 'equipped' : ''}" data-skin-id="${esc(s.id)}" data-skin-type="${skinType}">
                        <div class="ch-thumb-box"><img src="${thumb}" alt="${esc(s.name)}"></div>
                        <div class="ch-card-name">${esc(s.name)}</div>
                        <div class="ch-card-foot">
                            <span class="ch-price-tag">${owned ? (equipped ? '使用中' : '已拥有') : `🪙 ${s.price}`}</span>
                            <span class="ch-mini-badge ${equipped ? 'gold' : (owned ? 'green' : '')}">${equipped ? '当前' : (owned ? '换上' : '购买')}</span>
                        </div>
                    </div>
                `;
            }).join('');

            listEl.innerHTML = `
                <div class="ch-section-label">🪟 全景景观大窗（横跨半面墙！）</div>
                ${renderSkinCards(Object.values(cat.WINDOW_SKINS), 'window')}
                <div class="ch-section-label" style="margin-top:6px;">🧱 正面像素壁纸</div>
                ${renderSkinCards(Object.values(cat.WALL_SKINS), 'wall')}
                <div class="ch-section-label" style="margin-top:6px;">🪵 平面像素地板</div>
                ${renderSkinCards(Object.values(cat.FLOOR_SKINS), 'floor')}
            `;

            listEl.querySelectorAll('[data-skin-id]').forEach((card) => {
                card.addEventListener('click', async () => {
                    const skinId = card.dataset.skinId;
                    const skinType = card.dataset.skinType;
                    const dict = skinType === 'wall' ? cat.WALL_SKINS : (skinType === 'floor' ? cat.FLOOR_SKINS : cat.WINDOW_SKINS);
                    const skinObj = dict[skinId];
                    const owned = skinObj.price === 0 || (invMap.get(skinId)?.owned_count || 0) > 0;
                    if (!owned) {
                        const ok = await buyItem(skinId);
                        if (ok) await applySkin(skinType, skinId);
                    } else {
                        await applySkin(skinType, skinId);
                    }
                });
            });
            return;
        }

        filterRow.style.display = 'none';
        const diyItems = STATE.inventory.filter((i) => i.source === 'diy');
        listEl.innerHTML = `
            <div class="ch-diy-box">
                <div style="font-size:12.5px;font-weight:600;color:#fef3c7;">✨ 免费制作痛墙挂画 / 透明底亚克力立牌</div>
                <input type="file" id="chDiyFileInput" accept="image/*" style="display:none;">
                <div class="ch-diy-preview" id="chDiyPreviewBox">
                    ${STATE.diyDraftDataUrl ? `<img src="${STATE.diyDraftDataUrl}" alt="预览">` : '📂 点击选一张自推美图 / 透明底立牌 PNG'}
                </div>
                <input class="ch-diy-input" id="chDiyTitleInput" placeholder="起个名字，如：大少爷拍立得 / 限定立牌">
                <div class="ch-diy-row">
                    <label><input type="radio" name="chDiyKind" value="poster" checked> 🖼️ 痛墙挂画(贴墙)</label>
                    <label><input type="radio" name="chDiyKind" value="standee"> ✨ 亚克力立牌(可放桌上!)</label>
                </div>
                <label class="ch-diy-row" style="color:#d6d3d1;cursor:pointer;">
                    <input type="checkbox" id="chDiyPixelChk"> 👾 开启复古像素滤镜（完美融入像素画风）
                </label>
                <button class="ch-btn primary" id="chDiyCreateBtn" style="width:100%;padding:7px;">🎁 存入背包并立刻摆放</button>
            </div>
            <div class="ch-section-label" style="margin-top:4px;">💖 我的痛墙周边仓库 (${diyItems.length})</div>
            ${diyItems.length ? diyItems.map((inv) => {
                const isStandee = inv.item_id.startsWith('diy_standee_');
                const placed = placedCountMap.get(inv.item_id) || 0;
                const remain = Math.max(0, inv.owned_count - placed);
                const isPlacing = STATE.placingItemId === inv.item_id;
                return `
                    <div class="ch-card ${isPlacing ? 'selected' : ''}" data-diy-place="${esc(inv.item_id)}">
                        <button class="ch-diy-del" data-diy-del="${esc(inv.item_id)}" title="删除">✕</button>
                        <div class="ch-thumb-box"><img class="diy-smooth" src="${esc(inv.custom_image_url)}" alt="${esc(inv.custom_title)}"></div>
                        <div class="ch-card-name">${esc(inv.custom_title || '自推周边')}</div>
                        <div class="ch-card-foot">
                            <span class="ch-mini-badge">${isStandee ? '✨立牌' : '🖼️挂画'}</span>
                            <span class="ch-mini-badge ${remain > 0 ? 'green' : ''}">${isPlacing ? '摆放中' : (remain > 0 ? '摆放' : '已摆')}</span>
                        </div>
                    </div>
                `;
            }).join('') : `<div class="ch-empty-box" style="padding:14px;">还没有上传痛墙周边，快选一张自推美图试试吧！</div>`}
        `;

        const fileInput = document.getElementById('chDiyFileInput');
        document.getElementById('chDiyPreviewBox')?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                STATE.diyDraftDataUrl = await compressDiyImage(file, 320, true);
                document.getElementById('chDiyPreviewBox').innerHTML = `<img src="${STATE.diyDraftDataUrl}" alt="预览">`;
            } catch (err) {
                showToast(`⚠️ ${err.message}`);
            }
            e.target.value = '';
        });

        document.getElementById('chDiyCreateBtn')?.addEventListener('click', async () => {
            if (!STATE.diyDraftDataUrl) { showToast('先点虚线框选一张图片哦～'); return; }
            const kind = document.querySelector('input[name="chDiyKind"]:checked')?.value || 'poster';
            const title = (document.getElementById('chDiyTitleInput')?.value || '').trim();
            const pixelated = Boolean(document.getElementById('chDiyPixelChk')?.checked);

            const resp = await fetch(`${getApiBase()}/api/home/diy`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, title, pixelated, image_data: STATE.diyDraftDataUrl })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) { showToast(`⚠️ ${data.error || '制作失败'}`); return; }

            STATE.diyDraftDataUrl = '';
            STATE.inventory = data.inventory || [];
            syncEngine();
            if (data.item?.item_id) startPlacing(data.item.item_id);
            renderDock();
            showToast(kind === 'standee' ? '✨ 亚克力立牌做好啦！直接点书桌或地板落位吧～' : '🖼️ 痛墙挂画做好啦！点上方亮绿色墙壁挂上吧～');
        });

        listEl.querySelectorAll('[data-diy-place]').forEach((card) => {
            card.addEventListener('click', () => {
                const id = card.dataset.diyPlace;
                const placed = placedCountMap.get(id) || 0;
                const inv = invMap.get(id);
                if (!inv || inv.owned_count - placed <= 0) { showToast('这件周边已经摆在屋里啦～'); return; }
                if (STATE.placingItemId === id) exitEditMode();
                else startPlacing(id);
                renderDock();
            });
        });

        listEl.querySelectorAll('[data-diy-del]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.diyDel;
                if (!confirm('确定要删除这件自定义痛墙/立牌周边吗？')) return;
                const resp = await fetch(`${getApiBase()}/api/home/diy/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (resp.ok) {
                    if (STATE.placingItemId === id) exitEditMode();
                    await refresh();
                    showToast('🗑️ 已移除该自定义周边');
                }
            });
        });
    }

    function switchTab(tab) {
        STATE.activeTab = tab;
        document.querySelectorAll('.ch-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        renderDock();
    }

    async function open() {
        injectStyles();
        ensureModalDOM();
        STATE.isOpen = true;
        STATE.prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.getElementById('cloudHomeBackdrop').classList.add('open');
        await refresh();
        if (STATE.engine) requestAnimationFrame(() => STATE.engine.resize(true));
    }

    function close() {
        const el = document.getElementById('cloudHomeBackdrop');
        if (el) el.classList.remove('open');
        document.body.style.overflow = STATE.prevBodyOverflow || '';
        STATE.isOpen = false;
        exitEditMode();
        STATE.selectedPlacement = null;
        if (STATE.engine) STATE.engine.setSelectedPlacement(null);
        updateActionBar();
    }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
else injectStyles();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && STATE.isOpen) {
            if (STATE.placingItemId || STATE.movingPlacement) { exitEditMode(); renderDock(); }
            else close();
        }
    });

    global.CloudHome = { open, close, refresh, getState: () => ({ ...STATE }) };
})(window);