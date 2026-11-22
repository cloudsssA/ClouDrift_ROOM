// public/chat-pro.js —— 小手机通讯终极版（右下角齿轮小组件 + 全端拖拽 + 四角比例缩放 + 内部等比微缩 + 手机长按调尺寸 + 换肤壁纸 + 右键长按单删）
(function () {
const DRAWER_GEOM_KEY = 'study_room_chat_drawer_geom_v2';
    const BASE_W = 385;
    const BASE_H = 550;
    const MIN_W = 262;
    const MIN_H = 310;
    const MAX_W_CAP = 760;
    const MAX_H_CAP = 700;
    const MIN_ASPECT = 0.52; // 最细长比例（宽/高）
    const MAX_ASPECT = 1.48; // 允许横大于竖多一丢丢的饱满小方盒比例！

    const DEFAULT_THEME = {
        userBubbleBg: '#0a84ff',
        aiBubbleBg: '#2c2c2e',
        chatBgColor: '#18181a',
        chatBgImage: '',
        chatBgMode: 'cover',
        chatBgBlur: 0,
        chatBgDim: 0.35
    };

    let proConfig = {
        chatSplitEnabled: true,
        chatTypingDelay: true,
        chatDebounceEnabled: true,
        chatDebounceSec: 10,
        chatTheme: { ...DEFAULT_THEME }
    };

    let drawerGeom = { w: BASE_W, h: BASE_H, left: null, top: null };
    let adjustMode = false;
    let activeGearTab = 'engine'; // 'engine' | 'skin' | 'size'

    let pendingQueue = [];
    let debounceTimer = null;
    let debounceCountdownInterval = null;
    let debounceDeadline = 0;
    let isRequestInFlight = false;
    let streamSessionId = 0;

    let undoRoundsDraft = 1;
    let ctxTargetMsgId = null;
    let ctxTargetRowEl = null;
    let multiSelectMode = false;
    let selectedBubbleIds = new Set();
    let bubbleLongPressTimer = null;
    let bubbleTouchStart = null;

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function calcLuminance(hex) {
        const c = String(hex || '#2c2c2e').replace('#', '');
        if (c.length !== 6) return 0.2;
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    function upgradeContextSliderMax() {
        const slider = document.getElementById('cfgContextLimit');
        if (slider) {
            slider.max = '160';
            slider.step = '2';
        }
    }

    // 1. 注入全套样式（含窄屏/手机 !important 覆写 + 等比微缩变量 + 四角调节柄 + 齿轮小组件）
    function injectStyles() {
        if (document.getElementById('chatProStyles')) return;
        const style = document.createElement('style');
        style.id = 'chatProStyles';
        style.textContent = `
            /* 彻底接管窄屏与手机端尺寸定位，实现全端可拖拽可缩放 */
            #commDrawer.comm-drawer.pro-floating {
                --chat-scale: 1;
                --chat-user-bubble: #0a84ff;
                --chat-user-text: #ffffff;
                --chat-ai-bubble: #2c2c2e;
                --chat-ai-text: #f2f2f7;
                --chat-bg-color: #18181a;
                width: var(--drawer-w, 385px) !important;
                height: var(--drawer-h, 550px) !important;
                left: var(--drawer-left, auto) !important;
                top: var(--drawer-top, auto) !important;
                right: var(--drawer-right, 16px) !important;
                bottom: var(--drawer-bottom, 16px) !important;
                background: var(--chat-bg-color) !important;
                border-radius: calc(22px * var(--chat-scale)) !important;
            }
            #commDrawer.dragging,
            #commDrawer.resizing {
                transition: none !important;
                user-select: none !important;
                box-shadow: 0 28px 72px rgba(0, 0, 0, 0.82), 0 0 0 1.5px var(--accent, #d97706) !important;
            }
            #commDrawer.adjust-mode {
                box-shadow: 0 24px 66px rgba(0, 0, 0, 0.78), 0 0 0 2px var(--accent, #d97706) !important;
            }
            #commDrawer > *:not(.chat-bg-layer):not(.chat-resize-handle):not(.chat-gear-popover) {
                position: relative;
                z-index: 1;
            }

            /* 独立背景层 */
            .chat-bg-layer {
                position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; display: none;
                border-radius: inherit;
            }
            .chat-bg-layer.active { display: block; }
            .chat-bg-backdrop {
                position: absolute; inset: -26px; width: calc(100% + 52px); height: calc(100% + 52px);
                object-fit: cover; filter: blur(24px) saturate(1.25); transform: scale(1.06); display: none;
            }
            .chat-bg-layer.mode-blur .chat-bg-backdrop { display: block; }
            .chat-bg-main {
                position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover; object-position: center; transition: filter 0.15s ease;
            }
            .chat-bg-layer.mode-blur .chat-bg-main {
                object-fit: contain;
                -webkit-mask-image: radial-gradient(ellipse 88% 86% at 50% 50%, #000 66%, transparent 100%);
                mask-image: radial-gradient(ellipse 88% 86% at 50% 50%, #000 66%, transparent 100%);
            }
            .chat-bg-overlay { position: absolute; inset: 0; background: rgba(15, 14, 13, 0.35); }
            #commDrawer.has-chat-bg .im-header { background: rgba(24, 24, 28, 0.72) !important; backdrop-filter: blur(14px); }
            #commDrawer.has-chat-bg .im-input-bar { background: rgba(24, 24, 28, 0.76) !important; backdrop-filter: blur(14px); }

            /* 顶栏极简瘦身 + 等比微缩 + 拖拽触控不冲突 */
            #commDrawer .im-header {
                cursor: grab;
                user-select: none;
                touch-action: none;
                padding: calc(12px * var(--chat-scale)) calc(14px * var(--chat-scale)) !important;
                gap: 8px;
            }
            #commDrawer.dragging .im-header { cursor: grabbing; }
            #commDrawer .im-contact { gap: calc(9px * var(--chat-scale)); min-width: 0; flex: 1; }
            #commDrawer .im-contact > div:last-child { min-width: 0; }
            #commDrawer .im-avatar {
                width: calc(36px * var(--chat-scale));
                height: calc(36px * var(--chat-scale));
                font-size: calc(14px * var(--chat-scale));
            }
            #commDrawer .im-name {
                font-size: calc(14px * var(--chat-scale));
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            #commDrawer .im-sub {
                font-size: calc(11px * var(--chat-scale));
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            /* 把原顶栏垃圾桶隐去，已收入右下角齿轮小组件 */
            #commDrawer .im-actions button[onclick*="openClearChatModal"] { display: none !important; }
            .chat-adjust-done-btn {
                display: none;
                background: var(--accent, #d97706);
                color: #fff;
                border: none;
                padding: 3px 9px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
            }
            #commDrawer.adjust-mode .chat-adjust-done-btn { display: inline-flex; align-items: center; }

            /* 气泡、头像、字体、语音条随 --chat-scale 等比微缩（最大=1.0即当前大小） */
            #commDrawer .im-messages {
                padding: calc(14px * var(--chat-scale));
                gap: calc(11px * var(--chat-scale));
            }
            #commDrawer .im-bubble-row { gap: calc(7px * var(--chat-scale)); }
            #commDrawer .bubble-avatar {
                width: calc(28px * var(--chat-scale));
                height: calc(28px * var(--chat-scale));
                font-size: calc(11px * var(--chat-scale));
            }
            #commDrawer .im-bubble {
                max-width: 78%;
                padding: calc(9px * var(--chat-scale)) calc(13.5px * var(--chat-scale));
                font-size: calc(14px * var(--chat-scale));
                line-height: 1.48;
            }
            #commDrawer .im-bubble-row.user .im-bubble {
                background: var(--chat-user-bubble) !important;
                color: var(--chat-user-text) !important;
                border-radius: calc(17px * var(--chat-scale)) calc(17px * var(--chat-scale)) 4px calc(17px * var(--chat-scale));
            }
            #commDrawer .im-bubble-row.assistant .im-bubble {
                background: var(--chat-ai-bubble) !important;
                color: var(--chat-ai-text) !important;
                border-radius: calc(17px * var(--chat-scale)) calc(17px * var(--chat-scale)) calc(17px * var(--chat-scale)) 4px;
            }
            #commDrawer .im-bubble-audio { width: min(205px, 100%); max-width: 100%; }
            #commDrawer .voice-msg-card { min-width: calc(150px * var(--chat-scale)); gap: calc(5px * var(--chat-scale)); }
            #commDrawer .voice-play-pill {
                padding: calc(5.5px * var(--chat-scale)) calc(10px * var(--chat-scale));
                font-size: calc(12px * var(--chat-scale));
                gap: calc(6px * var(--chat-scale));
            }
            #commDrawer .voice-trans-btn {
                font-size: calc(10.5px * var(--chat-scale));
                padding: calc(4.5px * var(--chat-scale)) calc(7px * var(--chat-scale));
            }
            #commDrawer .voice-transcript { font-size: calc(12.5px * var(--chat-scale)); }
            #commDrawer.ai-bubble-light .voice-play-pill {
                background: rgba(0, 0, 0, 0.08); border-color: rgba(0, 0, 0, 0.16); color: #1c1917;
            }
            #commDrawer.ai-bubble-light .voice-trans-btn {
                background: rgba(0, 0, 0, 0.08); border-color: rgba(0, 0, 0, 0.16); color: #292524;
            }
            #commDrawer.ai-bubble-light .voice-transcript {
                color: #1c1917; border-top-color: rgba(0, 0, 0, 0.18);
            }

            /* 底部输入栏等比微缩 */
            #commDrawer .im-input-bar {
                padding: calc(9px * var(--chat-scale)) calc(10px * var(--chat-scale));
                gap: calc(5.5px * var(--chat-scale));
            }
            #commDrawer .im-tool-btn {
                width: calc(32px * var(--chat-scale));
                height: calc(32px * var(--chat-scale));
                font-size: calc(14px * var(--chat-scale));
            }
            #commDrawer .im-send-btn {
                width: calc(34px * var(--chat-scale));
                height: calc(34px * var(--chat-scale));
                font-size: calc(15px * var(--chat-scale));
            }
            #commDrawer .im-input {
                padding: calc(7.5px * var(--chat-scale)) calc(12px * var(--chat-scale));
                font-size: calc(13.5px * var(--chat-scale));
            }
            .im-tool-btn.gear-active {
                background: var(--accent, #d97706) !important;
                border-color: var(--accent, #d97706) !important;
                color: #fff !important;
                transform: rotate(35deg);
            }

            /* 四个角拖拽调节手柄 */
            .chat-resize-handle {
                position: absolute;
                width: 22px;
                height: 22px;
                z-index: 35;
                touch-action: none;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .chat-resize-handle::after {
                content: '';
                width: 9px;
                height: 9px;
                border: 2px solid transparent;
                border-radius: 2px;
                transition: border-color 0.18s, transform 0.18s;
            }
            .chat-resize-handle:hover::after {
                border-color: rgba(254, 243, 199, 0.7);
            }
            #commDrawer.adjust-mode .chat-resize-handle {
                width: 30px;
                height: 30px;
            }
            #commDrawer.adjust-mode .chat-resize-handle::after {
                width: 12px;
                height: 12px;
                border-color: var(--accent, #d97706);
                box-shadow: 0 0 10px rgba(217, 119, 6, 0.65);
            }
            .chat-resize-handle.nw { top: 0; left: 0; cursor: nwse-resize; }
            .chat-resize-handle.nw::after { border-right: none; border-bottom: none; border-top-left-radius: 6px; transform: translate(-2px, -2px); }
            .chat-resize-handle.ne { top: 0; right: 0; cursor: nesw-resize; }
            .chat-resize-handle.ne::after { border-left: none; border-bottom: none; border-top-right-radius: 6px; transform: translate(2px, -2px); }
            .chat-resize-handle.sw { bottom: 0; left: 0; cursor: nesw-resize; }
            .chat-resize-handle.sw::after { border-right: none; border-top: none; border-bottom-left-radius: 6px; transform: translate(-2px, 2px); }
            .chat-resize-handle.se { bottom: 0; right: 0; cursor: nwse-resize; }
            .chat-resize-handle.se::after { border-left: none; border-top: none; border-bottom-right-radius: 6px; transform: translate(2px, 2px); }

            /* ⚙️ 右下角悬浮工具小组件 */
            .chat-gear-popover {
                position: absolute;
                right: 10px;
                bottom: calc(52px * var(--chat-scale));
                width: min(292px, calc(100% - 20px));
                max-height: calc(100% - 108px);
                overflow-y: auto;
                z-index: 28;
                background: rgba(26, 25, 29, 0.96);
                backdrop-filter: blur(22px);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 16px;
                padding: 11px;
                box-shadow: 0 18px 46px rgba(0, 0, 0, 0.72);
                display: none;
                flex-direction: column;
                gap: 9px;
                color: #f5f5f4;
                font-size: 12px;
                transform-origin: bottom right;
                animation: gearPop 0.18s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .chat-gear-popover.open { display: flex; }
            @keyframes gearPop {
                from { opacity: 0; transform: translateY(8px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .gear-quick-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
            }
            .gear-tile-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 3px;
                padding: 8px 4px;
                border-radius: 11px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #e7e5e4;
                cursor: pointer;
                font-size: 11px;
                transition: all 0.16s;
            }
            .gear-tile-btn span:first-child { font-size: 15px; line-height: 1; }
            .gear-tile-btn:hover { background: rgba(255, 255, 255, 0.14); border-color: var(--accent, #d97706); color: #fef3c7; }
            .gear-tile-btn.active { background: rgba(217, 119, 6, 0.25); border-color: var(--accent, #d97706); color: #fde68a; }
            .gear-tile-btn.danger:hover { background: rgba(220, 38, 38, 0.22); border-color: #ef4444; color: #fecaca; }
            .gear-tab-bar {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 4px;
                background: rgba(0, 0, 0, 0.28);
                padding: 3px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.07);
            }
            .gear-tab-btn {
                background: transparent;
                border: none;
                color: #a8a29e;
                padding: 5px 4px;
                border-radius: 7px;
                font-size: 11.5px;
                cursor: pointer;
                transition: all 0.16s;
                font-weight: 500;
            }
            .gear-tab-btn.active {
                background: rgba(217, 119, 6, 0.26);
                color: #fef3c7;
            }
            .gear-tab-pane { display: none; flex-direction: column; gap: 8px; }
            .gear-tab-pane.active { display: flex; }

            .chat-pro-row {
                display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;
            }
            .chat-pro-row label {
                display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #e7e5e4; font-size: 12px;
            }
            .chat-pro-row input[type="checkbox"] {
                width: 15px; height: 15px; accent-color: var(--accent, #d97706); cursor: pointer;
            }
            .chat-pro-sec-input {
                width: 48px; padding: 3px 5px; border-radius: 7px; border: 1px solid #44403c;
                background: #161514; color: #fef3c7; font-size: 12px; text-align: center;
            }
            .chat-skin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
            .chat-skin-color-item {
                background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 9px; padding: 5px 6px; display: flex; flex-direction: column; gap: 3px;
                font-size: 10.5px; color: #d6d3d1;
            }
            .chat-skin-color-item input[type="color"] {
                width: 100%; height: 24px; border: none; background: transparent; cursor: pointer; padding: 0;
            }
            .chat-skin-select {
                width: 100%; padding: 6px 8px; border-radius: 8px; background: #141416;
                border: 1px solid #3f3b37; color: #f5f5f4; font-size: 11.5px;
            }
            .chat-skin-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #a8a29e; }
            .chat-skin-sliders input[type="range"] { width: 100%; accent-color: var(--accent, #d97706); }
            .chat-size-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
            .chat-pro-cmd-hint {
                font-size: 11px; color: #a8a29e; background: rgba(255, 255, 255, 0.04);
                border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 6px 8px; line-height: 1.5;
            }
            .chat-pro-cmd-hint code {
                background: rgba(217, 119, 6, 0.22); color: #fde68a; padding: 0 4px; border-radius: 4px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px;
            }

            /* 防抖条 / 多选条 / 队列态 / 右键菜单 / 撤回确认 */
            .chat-debounce-bar, .chat-multi-bar {
                display: none; align-items: center; justify-content: space-between; gap: 6px;
                padding: 6px 10px; font-size: 11px;
            }
            .chat-debounce-bar { background: rgba(217, 119, 6, 0.20); border-top: 1px solid rgba(217, 119, 6, 0.42); color: #fde68a; }
            .chat-multi-bar { background: rgba(220, 38, 38, 0.18); border-top: 1px solid rgba(239, 68, 68, 0.45); color: #fecaca; }
            .chat-debounce-bar.show, .chat-multi-bar.show { display: flex; }
            .chat-debounce-actions { display: flex; gap: 4px; flex-shrink: 0; }
            .chat-debounce-btn {
                background: rgba(255, 255, 255, 0.11); border: 1px solid rgba(255, 255, 255, 0.17);
                color: #fff; padding: 3px 8px; border-radius: 999px; font-size: 11px; cursor: pointer;
            }
            .chat-debounce-btn:hover { background: rgba(255, 255, 255, 0.22); }
            .chat-debounce-btn.primary { background: var(--accent, #d97706); border-color: var(--accent, #d97706); font-weight: 600; }
            .chat-debounce-btn.danger { background: #dc2626; border-color: #ef4444; font-weight: 600; }
            .im-bubble-row.queued .im-bubble { opacity: 0.78; }
            .queued-tag { display: block; font-size: 10px; opacity: 0.75; margin-top: 3px; text-align: right; }
            .im-bubble-row.multi-selectable { cursor: pointer; padding: 3px 5px; border-radius: 12px; }
            .im-bubble-row.multi-selectable:hover { background: rgba(255, 255, 255, 0.06); }
            .im-bubble-row.multi-selected { background: rgba(239, 68, 68, 0.20) !important; box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.55); }
            .bubble-check-dot {
                display: none; width: 17px; height: 17px; border-radius: 50%;
                border: 1.5px solid rgba(255, 255, 255, 0.45); align-items: center; justify-content: center;
                font-size: 10.5px; flex-shrink: 0; align-self: center; color: #fff;
            }
            .im-bubble-row.multi-selectable .bubble-check-dot { display: inline-flex; }
            .im-bubble-row.multi-selected .bubble-check-dot { background: #ef4444; border-color: #ef4444; }
            .chat-sys-pill {
                align-self: center; font-size: calc(11px * var(--chat-scale)); color: #e7e5e4;
                background: rgba(24, 24, 28, 0.72); backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.12); padding: 3px 10px; border-radius: 999px; margin: 2px 0;
            }
            .chat-bubble-ctx-menu {
                position: fixed; z-index: 320; min-width: 168px;
                background: rgba(28, 27, 30, 0.96); backdrop-filter: blur(18px);
                border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 13px; padding: 5px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65); display: none; flex-direction: column; gap: 2px;
            }
            .chat-bubble-ctx-menu.show { display: flex; }
            .chat-ctx-item {
                background: transparent; border: none; color: #f5f5f4; text-align: left;
                padding: 8px 11px; border-radius: 8px; font-size: 12.5px; cursor: pointer; white-space: nowrap;
            }
            .chat-ctx-item:hover { background: rgba(255, 255, 255, 0.12); }
            .chat-ctx-item.danger { color: #fca5a5; }
            .chat-ctx-item.danger:hover { background: rgba(220, 38, 38, 0.25); color: #fff; }
            .undo-round-pills { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
            .undo-preview-box {
                background: #161514; border: 1px solid #33302d; border-radius: 10px; padding: 10px 12px;
                max-height: 210px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
                margin-bottom: 14px; font-size: 12px;
            }
            .undo-preview-item { display: flex; gap: 6px; align-items: baseline; line-height: 1.45; color: #e7e5e4; }
            .undo-role-tag { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; flex-shrink: 0; }
            .undo-role-tag.u { background: rgba(10, 132, 255, 0.22); color: #93c5fd; }
            .undo-role-tag.a { background: rgba(217, 119, 6, 0.22); color: #fde68a; }
        `;
        document.head.appendChild(style);
    }

    // 2. 窗口几何边界计算 + 比例锁 + 内部等比缩放（max = 1.0）
    function getViewportBounds() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = vw <= 480 ? 8 : 12;
        const maxW = Math.max(220, Math.min(MAX_W_CAP, vw - pad * 2));
        const maxH = Math.max(280, Math.min(MAX_H_CAP, vh - pad * 2));
        const minW = Math.min(MIN_W, maxW);
        const minH = Math.min(MIN_H, maxH);
        return { vw, vh, pad, minW, maxW, minH, maxH };
    }

    function constrainSize(rawW, rawH) {
        const { minW, maxW, minH, maxH } = getViewportBounds();
        let w = Math.max(minW, Math.min(maxW, Number(rawW) || BASE_W));
        let h = Math.max(minH, Math.min(maxH, Number(rawH) || BASE_H));

        const ratio = w / h;
        if (ratio > MAX_ASPECT) {
            const tryH = w / MAX_ASPECT;
            if (tryH <= maxH) h = tryH;
            else w = h * MAX_ASPECT;
        } else if (ratio < MIN_ASPECT) {
            const tryW = h * MIN_ASPECT;
            if (tryW <= maxW) w = tryW;
            else h = w / MIN_ASPECT;
        }
        w = Math.round(Math.max(minW, Math.min(maxW, w)));
        h = Math.round(Math.max(minH, Math.min(maxH, h)));
        return { w, h };
    }

    function applyDrawerGeometry(geom = drawerGeom, persist = false) {
        const drawer = document.getElementById('commDrawer');
        if (!drawer) return;
        drawer.classList.add('pro-floating');

        const { vw, vh, pad } = getViewportBounds();
        const { w, h } = constrainSize(geom.w, geom.h);
        let left = geom.left;
        let top = geom.top;

        drawer.style.setProperty('--drawer-w', `${w}px`);
        drawer.style.setProperty('--drawer-h', `${h}px`);

        if (typeof left === 'number' && typeof top === 'number' && !isNaN(left) && !isNaN(top)) {
            left = Math.round(Math.max(pad, Math.min(vw - w - pad, left)));
            top = Math.round(Math.max(pad, Math.min(vh - h - pad, top)));
            drawer.style.setProperty('--drawer-left', `${left}px`);
            drawer.style.setProperty('--drawer-top', `${top}px`);
            drawer.style.setProperty('--drawer-right', 'auto');
            drawer.style.setProperty('--drawer-bottom', 'auto');
        } else {
            left = null;
            top = null;
            drawer.style.setProperty('--drawer-left', 'auto');
            drawer.style.setProperty('--drawer-top', 'auto');
            drawer.style.setProperty('--drawer-right', `${pad}px`);
            drawer.style.setProperty('--drawer-bottom', `${pad}px`);
        }

        // 内部元素随窗口缩小等比微缩，但上限严格锁定 1.0（最大就现在这么大！）
        const rawScale = Math.min(w / BASE_W, h / (BASE_H * 0.94));
        const clampedScale = Math.max(0.80, Math.min(1.0, rawScale));
        drawer.style.setProperty('--chat-scale', clampedScale.toFixed(3));

        drawerGeom = { w, h, left, top };
        const infoEl = document.getElementById('chatSizeLiveInfo');
        if (infoEl) infoEl.innerText = `${w} × ${h}px · 缩放 ${Math.round(clampedScale * 100)}%`;

        if (persist) {
            try { localStorage.setItem(DRAWER_GEOM_KEY, JSON.stringify(drawerGeom)); } catch {}
        }
    }

    function getDefaultSizeForViewport() {
        const { vw, vh, maxW, maxH } = getViewportBounds();
        if (vw <= 780) {
            const fullW = maxW;
            // 窄屏平板/半屏电脑：左右拉满、横略大于竖；竖屏手机：左右拉满、高度占 66% 顺手打字
            const targetH = vw >= 500
                ? Math.min(maxH, Math.round(fullW / 1.18), Math.round(vh * 0.72))
                : Math.min(maxH, Math.round(vh * 0.66));
            return { w: fullW, h: targetH };
        }
        return { w: Math.min(BASE_W, maxW), h: Math.min(BASE_H, Math.round(vh * 0.76)) };
    }

    function restoreDrawerGeometry() {
        const def = getDefaultSizeForViewport();
        let loaded = { w: def.w, h: def.h, left: null, top: null };
        try {
            const raw = localStorage.getItem(DRAWER_GEOM_KEY);
            if (raw) {
                const p = JSON.parse(raw);
                if (p && typeof p.w === 'number' && typeof p.h === 'number') {
                    loaded = { w: p.w, h: p.h, left: p.left ?? null, top: p.top ?? null };
                }
            }
        } catch {}
        applyDrawerGeometry(loaded, false);
    }

    function setQuickSize(preset) {
        const { maxW, maxH } = getViewportBounds();
        if (preset === 'reset') {
            localStorage.removeItem(DRAWER_GEOM_KEY);
            const def = getDefaultSizeForViewport();
            applyDrawerGeometry({ w: def.w, h: def.h, left: null, top: null }, false);
            setAdjustMode(false);
            appendSysPill('📌 聊天框已恢复默认尺寸并归位');
            return;
        }
        const map = {
            mini: { w: 280, h: 380 },
            std: { w: 385, h: 550 },
            wide: { w: maxW, h: Math.min(maxH, Math.round(maxW / 1.18)) }
        };
        const target = map[preset] || map.std;
        applyDrawerGeometry({ ...drawerGeom, w: target.w, h: target.h }, true);
    }

    function setAdjustMode(enabled) {
        adjustMode = Boolean(enabled);
        const drawer = document.getElementById('commDrawer');
        drawer?.classList.toggle('adjust-mode', adjustMode);
        const tile = document.getElementById('gearAdjustTile');
        tile?.classList.toggle('active', adjustMode);
    }

    function toggleAdjustModeFromWidget() {
        const next = !adjustMode;
        setAdjustMode(next);
        if (next) {
            closeGearPopover();
            appendSysPill('📐 四角调节模式已开启：拖动任意发光拐角缩放，拖顶栏挪位置');
        }
    }

    // 3. 绑定全端顶栏拖拽（含手机长按 420ms 呼出四角调节）+ 四角缩放手柄
    function initDragAndResize() {
        const drawer = document.getElementById('commDrawer');
        const header = drawer?.querySelector('.im-header');
        if (!drawer || !header || drawer.dataset.dragResizeBound) return;
        drawer.dataset.dragResizeBound = '1';

        // 3.1 顶栏拖拽 + 双击归位 + 手机长按开启四角调节
        let dragging = false;
        let movedEnough = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;
        let headerHoldTimer = null;

        header.title = '按住拖动移动位置 · 长按开启四角调节 · 双击归位右下角';
        header.addEventListener('dblclick', (e) => {
            if (e.target.closest('button')) return;
            setQuickSize('reset');
        });

        header.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            if (e.target.closest('button')) return;
            const rect = drawer.getBoundingClientRect();
            dragging = true;
            movedEnough = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            clearTimeout(headerHoldTimer);
            headerHoldTimer = setTimeout(() => {
                if (dragging && !movedEnough) {
                    if (navigator.vibrate) try { navigator.vibrate(24); } catch {}
                    setAdjustMode(!adjustMode);
                    appendSysPill(adjustMode ? '📐 已开启四角缩放模式，拖动任意发光拐角即可改大小' : '✅ 已锁定聊天框尺寸');
                }
            }, 420);

            try { header.setPointerCapture(e.pointerId); } catch {}
        });

        header.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!movedEnough && Math.hypot(dx, dy) > 6) {
                movedEnough = true;
                clearTimeout(headerHoldTimer);
                drawer.classList.add('dragging');
            }
            if (!movedEnough) return;
            applyDrawerGeometry({
                w: drawerGeom.w,
                h: drawerGeom.h,
                left: startLeft + dx,
                top: startTop + dy
            }, false);
        });

        const finishHeaderDrag = () => {
            clearTimeout(headerHoldTimer);
            if (!dragging) return;
            dragging = false;
            drawer.classList.remove('dragging');
            if (movedEnough) applyDrawerGeometry(drawerGeom, true);
        };
        header.addEventListener('pointerup', finishHeaderDrag);
        header.addEventListener('pointercancel', finishHeaderDrag);

        // 3.2 四个角自由缩放（严守尺寸与形状长宽比界限！）
        const corners = ['nw', 'ne', 'sw', 'se'];
        for (const corner of corners) {
            const handle = document.createElement('div');
            handle.className = `chat-resize-handle ${corner}`;
            handle.title = '拖动调节聊天框大小与形状';

            let resizing = false;
            let rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0, rStartL = 0, rStartT = 0, rAnchorR = 0, rAnchorB = 0;

            handle.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 && e.pointerType === 'mouse') return;
                e.preventDefault();
                e.stopPropagation();
                const rect = drawer.getBoundingClientRect();
                resizing = true;
                rStartX = e.clientX;
                rStartY = e.clientY;
                rStartW = rect.width;
                rStartH = rect.height;
                rStartL = rect.left;
                rStartT = rect.top;
                rAnchorR = rect.left + rect.width;
                rAnchorB = rect.top + rect.height;
                drawer.classList.add('resizing');
                try { handle.setPointerCapture(e.pointerId); } catch {}
            });

            handle.addEventListener('pointermove', (e) => {
                if (!resizing) return;
                const dx = e.clientX - rStartX;
                const dy = e.clientY - rStartY;
                const rawW = corner.includes('e') ? rStartW + dx : rStartW - dx;
                const rawH = corner.includes('s') ? rStartH + dy : rStartH - dy;
                const { w, h } = constrainSize(rawW, rawH);

                const newLeft = corner.includes('w') ? (rAnchorR - w) : rStartL;
                const newTop = corner.includes('n') ? (rAnchorB - h) : rStartT;
                applyDrawerGeometry({ w, h, left: newLeft, top: newTop }, false);
            });

            const finishResize = () => {
                if (!resizing) return;
                resizing = false;
                drawer.classList.remove('resizing');
                applyDrawerGeometry(drawerGeom, true);
            };
            handle.addEventListener('pointerup', finishResize);
            handle.addEventListener('pointercancel', finishResize);

            drawer.appendChild(handle);
        }

        window.addEventListener('resize', () => applyDrawerGeometry(drawerGeom, false));
        restoreDrawerGeometry();
    }

    // 4. 换肤应用
    function applyChatTheme(theme = proConfig.chatTheme) {
        const drawer = document.getElementById('commDrawer');
        if (!drawer) return;
        const t = { ...DEFAULT_THEME, ...(theme || {}) };
        const userLight = calcLuminance(t.userBubbleBg) > 0.60;
        const aiLight = calcLuminance(t.aiBubbleBg) > 0.58;

        drawer.style.setProperty('--chat-user-bubble', t.userBubbleBg);
        drawer.style.setProperty('--chat-user-text', userLight ? '#1c1917' : '#ffffff');
        drawer.style.setProperty('--chat-ai-bubble', t.aiBubbleBg);
        drawer.style.setProperty('--chat-ai-text', aiLight ? '#1c1917' : '#f2f2f7');
        drawer.style.setProperty('--chat-bg-color', t.chatBgColor);
        drawer.classList.toggle('ai-bubble-light', aiLight);

        const layer = document.getElementById('chatBgLayer');
        const backdrop = document.getElementById('chatBgBackdrop');
        const mainImg = document.getElementById('chatBgMain');
        const overlay = document.getElementById('chatBgOverlay');
        if (!layer || !backdrop || !mainImg || !overlay) return;

        if (!t.chatBgImage) {
            layer.classList.remove('active', 'mode-blur');
            drawer.classList.remove('has-chat-bg');
            backdrop.src = '';
            mainImg.src = '';
            return;
        }
        drawer.classList.add('has-chat-bg');
        layer.classList.add('active');
        layer.classList.toggle('mode-blur', t.chatBgMode === 'blur');
        if (backdrop.src !== t.chatBgImage) backdrop.src = t.chatBgImage;
        if (mainImg.src !== t.chatBgImage) mainImg.src = t.chatBgImage;

        const blurPx = Math.max(0, parseFloat(t.chatBgBlur) || 0);
        mainImg.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
        mainImg.style.transform = (t.chatBgMode === 'cover' && blurPx > 0) ? `scale(${(1 + blurPx * 0.01).toFixed(3)})` : 'none';
        const dim = Math.max(0, Math.min(0.85, parseFloat(t.chatBgDim) || 0));
        overlay.style.background = `rgba(15, 14, 13, ${dim})`;
    }

    // 5. 挂载 UI：背景层 + 顶栏「完成调整」按钮 + 右下角齿轮键 & 悬浮小组件 + 防抖/多选条 + 右键菜单 + 撤回弹窗
    function mountChatProUI() {
        const drawer = document.getElementById('commDrawer');
        if (!drawer || document.getElementById('chatGearPopover')) return;

        // 5.1 独立背景层
        const bgLayer = document.createElement('div');
        bgLayer.id = 'chatBgLayer';
        bgLayer.className = 'chat-bg-layer';
        bgLayer.innerHTML = `
            <img class="chat-bg-backdrop" id="chatBgBackdrop" alt="">
            <img class="chat-bg-main" id="chatBgMain" alt="">
            <div class="chat-bg-overlay" id="chatBgOverlay"></div>
        `;
        drawer.insertBefore(bgLayer, drawer.firstChild);

        // 5.2 顶栏只补充一个“调节模式完成”隐藏按钮（平时不占位，顶栏干净到只有 ✕！）
        const actions = drawer.querySelector('.im-actions');
        if (actions) {
            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className = 'chat-adjust-done-btn';
            doneBtn.innerText = '✓ 完成';
            doneBtn.onclick = () => setAdjustMode(false);
            actions.insertBefore(doneBtn, actions.firstChild);
        }

        // 5.3 右下角蓝色发送键左侧插入 ⚙️ 齿轮按钮
        const inputBar = drawer.querySelector('.im-input-bar');
        const sendBtn = document.getElementById('imSendBtn');
        if (inputBar && sendBtn && !document.getElementById('chatProGearBtn')) {
            const gearBtn = document.createElement('button');
            gearBtn.type = 'button';
            gearBtn.id = 'chatProGearBtn';
            gearBtn.className = 'im-tool-btn';
            gearBtn.innerText = '⚙️';
            gearBtn.title = '展开聊天小组件（重生成 / 撤回 / 换肤 / 引擎 / 调尺寸）';
            gearBtn.onclick = (e) => {
                e.stopPropagation();
                toggleGearPopover();
            };
            inputBar.insertBefore(gearBtn, sendBtn);
        }

        // 5.4 ⚙️ 悬浮工具小组件（收拢全部控制项，彻底无惧窗口缩小！）
        const popover = document.createElement('div');
        popover.id = 'chatGearPopover';
        popover.className = 'chat-gear-popover';
        popover.innerHTML = `
            <div class="gear-quick-grid">
                <button type="button" class="gear-tile-btn" onclick="window.ChatPro.closeGear();window.ChatPro.executeReroll()" title="仅重生成聊天框上一轮 (/reroll)">
                    <span>🔄</span><span>重生成</span>
                </button>
                <button type="button" class="gear-tile-btn" onclick="window.ChatPro.closeGear();window.ChatPro.openUndoConfirmModal(1)" title="仅撤回聊天框对话 (/clear)">
                    <span>↩️</span><span>撤回</span>
                </button>
                <button type="button" class="gear-tile-btn" id="gearAdjustTile" onclick="window.ChatPro.toggleAdjustMode()" title="点亮四角拖动缩放（手机长按顶栏也可开启）">
                    <span>📐</span><span>调大小</span>
                </button>
                <button type="button" class="gear-tile-btn danger" onclick="window.ChatPro.closeGear();openClearChatModal()" title="清空聊天或彻底重置记忆">
                    <span>🗑️</span><span>清空</span>
                </button>
            </div>

            <div class="gear-tab-bar">
                <button type="button" class="gear-tab-btn active" data-gtab="engine" onclick="window.ChatPro.switchGearTab('engine')">⚡ 引擎</button>
                <button type="button" class="gear-tab-btn" data-gtab="skin" onclick="window.ChatPro.switchGearTab('skin')">🎨 换肤</button>
                <button type="button" class="gear-tab-btn" data-gtab="size" onclick="window.ChatPro.switchGearTab('size')">📐 窗口</button>
            </div>

            <!-- 板块 1：小手机引擎 -->
            <div class="gear-tab-pane active" id="gearPane_engine">
                <div class="chat-pro-row">
                    <label><input type="checkbox" id="chkProSplit" checked onchange="window.ChatPro.saveSettings()"> 💬 $ 分段连发 + 独立语音气泡</label>
                </div>
                <div class="chat-pro-row">
                    <label><input type="checkbox" id="chkProDelay" checked onchange="window.ChatPro.saveSettings()"> ⌨️ 模拟真人打字/录音延迟</label>
                </div>
                <div class="chat-pro-row">
                    <label><input type="checkbox" id="chkProDebounce" checked onchange="window.ChatPro.saveSettings()"> ⏳ AstrBot 防抖合并</label>
                    <span style="display:inline-flex;align-items:center;gap:4px;color:#a8a29e;">
                        等 <input type="number" id="inpProDebounceSec" class="chat-pro-sec-input" min="2" max="60" value="10" onchange="window.ChatPro.saveSettings()"> 秒
                    </span>
                </div>
                <div class="chat-pro-cmd-hint">
                    指令：<code>/reroll</code> 重生成 · <code>/clear</code> 或 <code>/clear2</code> 撤回 · 右键/长按气泡可单删或多选！
                </div>
            </div>

            <!-- 板块 2：专属换肤与壁纸 -->
            <div class="gear-tab-pane" id="gearPane_skin">
                <div class="chat-skin-grid">
                    <label class="chat-skin-color-item">
                        <span>我的气泡</span>
                        <input type="color" id="skinUserBubble" value="#0a84ff" oninput="window.ChatPro.liveSkinPreview()" onchange="window.ChatPro.saveSkin()">
                    </label>
                    <label class="chat-skin-color-item">
                        <span>TA 的气泡</span>
                        <input type="color" id="skinAiBubble" value="#2c2c2e" oninput="window.ChatPro.liveSkinPreview()" onchange="window.ChatPro.saveSkin()">
                    </label>
                    <label class="chat-skin-color-item">
                        <span>聊天底色</span>
                        <input type="color" id="skinChatBg" value="#18181a" oninput="window.ChatPro.liveSkinPreview()" onchange="window.ChatPro.saveSkin()">
                    </label>
                </div>
                <div class="chat-pro-row">
                    <span style="color:#d6d3d1;font-size:11.5px;">🖼️ 独立背景图</span>
                    <div style="display:flex;gap:4px;">
                        <input type="file" id="skinChatBgFile" accept="image/*" style="display:none" onchange="window.ChatPro.uploadSkinBg(event)">
                        <button type="button" class="chat-debounce-btn primary" onclick="document.getElementById('skinChatBgFile').click()">📂 选图</button>
                        <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.clearSkinBg()">清除</button>
                        <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.resetSkin()">默认</button>
                    </div>
                </div>
                <select id="skinChatBgMode" class="chat-skin-select" onchange="window.ChatPro.liveSkinPreview();window.ChatPro.saveSkin();">
                    <option value="cover">🖼️ 铺满沉浸（Cover 居中裁剪）</option>
                    <option value="blur">💿 流光不裁图（底层高斯模糊 + 中间原图）</option>
                </select>
                <div class="chat-skin-sliders">
                    <div>
                        <div>模糊：<span id="skinBlurVal">0px</span></div>
                        <input type="range" id="skinChatBgBlur" min="0" max="20" step="1" value="0" oninput="window.ChatPro.liveSkinPreview()" onchange="window.ChatPro.saveSkin()">
                    </div>
                    <div>
                        <div>压暗：<span id="skinDimVal">35%</span></div>
                        <input type="range" id="skinChatBgDim" min="0" max="0.8" step="0.02" value="0.35" oninput="window.ChatPro.liveSkinPreview()" onchange="window.ChatPro.saveSkin()">
                    </div>
                </div>
            </div>

            <!-- 板块 3：窗口大小与手机手势说明 -->
            <div class="gear-tab-pane" id="gearPane_size">
                <div class="chat-pro-row">
                    <span style="color:#d6d3d1;font-size:11.5px;">当前规格</span>
                    <span id="chatSizeLiveInfo" style="color:#fde68a;font-size:11px;font-variant-numeric:tabular-nums;">385 × 550px</span>
                </div>
                <div class="chat-size-presets">
                    <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.setQuickSize('mini')">迷你</button>
                    <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.setQuickSize('std')">标准</button>
                    <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.setQuickSize('wide')">宽大</button>
                    <button type="button" class="chat-debounce-btn primary" onclick="window.ChatPro.setQuickSize('reset')">📌 归位</button>
                </div>
                <div class="chat-pro-cmd-hint">
                    🖐️ <strong>拖动顶栏</strong>可自由移动；<strong>拖四个角</strong>可调大小与微调形状（手机可<strong>长按顶栏</strong>点亮四个发光拐角～）
                </div>
            </div>
        `;
        drawer.appendChild(popover);

        document.addEventListener('click', (e) => {
            const pop = document.getElementById('chatGearPopover');
            const gBtn = document.getElementById('chatProGearBtn');
            if (pop?.classList.contains('open') && !pop.contains(e.target) && !gBtn?.contains(e.target)) {
                closeGearPopover();
            }
        });

        // 5.5 防抖倒计时条 & 多选删除条
        const debBar = document.createElement('div');
        debBar.id = 'chatDebounceBar';
        debBar.className = 'chat-debounce-bar';
        debBar.innerHTML = `
            <span id="chatDebounceText">⏳ 等待补发中…</span>
            <div class="chat-debounce-actions">
                <button type="button" class="chat-debounce-btn primary" onclick="window.ChatPro.flushNow()">⚡ 立即发</button>
                <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.cancelQueue()">撤回</button>
            </div>
        `;
        const multiBar = document.createElement('div');
        multiBar.id = 'chatMultiBar';
        multiBar.className = 'chat-multi-bar';
        multiBar.innerHTML = `
            <span id="chatMultiText">☑️ 已选 0 条</span>
            <div class="chat-debounce-actions">
                <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.confirmBatchDelete(false)">仅删气泡</button>
                <button type="button" class="chat-debounce-btn danger" onclick="window.ChatPro.confirmBatchDelete(true)">删+记忆</button>
                <button type="button" class="chat-debounce-btn" onclick="window.ChatPro.exitMultiSelect()">取消</button>
            </div>
        `;
        if (inputBar?.parentNode) {
            inputBar.parentNode.insertBefore(debBar, inputBar);
            inputBar.parentNode.insertBefore(multiBar, inputBar);
        }

        // 5.6 气泡右键 / 手机长按悬浮菜单
        if (!document.getElementById('chatBubbleCtxMenu')) {
            const menu = document.createElement('div');
            menu.id = 'chatBubbleCtxMenu';
            menu.className = 'chat-bubble-ctx-menu';
            menu.innerHTML = `
                <button type="button" class="chat-ctx-item" onclick="window.ChatPro.ctxCopy()">📋 复制气泡文字</button>
                <button type="button" class="chat-ctx-item" onclick="window.ChatPro.ctxEnterMulti()">☑️ 多选批量删除</button>
                <button type="button" class="chat-ctx-item danger" onclick="window.ChatPro.ctxDeleteOne(false)">🗑️ 仅删这条气泡</button>
                <button type="button" class="chat-ctx-item danger" onclick="window.ChatPro.ctxDeleteOne(true)">🧹 删气泡并同步删记忆</button>
            `;
            document.body.appendChild(menu);
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target)) hideCtxMenu();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    hideCtxMenu();
                    closeGearPopover();
                    setAdjustMode(false);
                    if (multiSelectMode) exitMultiSelect();
                }
            });
        }

        // 5.7 撤回确认弹窗（带实时气泡预览）
        if (!document.getElementById('chatUndoConfirmModal')) {
            const modal = document.createElement('div');
            modal.id = 'chatUndoConfirmModal';
            modal.className = 'modal-backdrop';
            modal.style.zIndex = '280';
            modal.onclick = (e) => { if (e.target === modal) closeModal('chatUndoConfirmModal'); };
            modal.innerHTML = `
                <div class="modal-box" style="max-width:450px;">
                    <h3>
                        <span>↩️ 撤回聊天框对话（带确认预览）</span>
                        <span style="cursor:pointer;color:#a8a29e" onclick="closeModal('chatUndoConfirmModal')">✕</span>
                    </h3>
                    <div style="font-size:12px;color:#a8a29e;margin-bottom:10px;line-height:1.5;">
                        仅撤回<strong>聊天框内</strong>的对话气泡与对应通讯记忆，<strong>绝不会误删</strong>划线、切歌、便签等其他互动记忆！（想删全局其他互动记忆请点顶部「🧠 记忆」）
                    </div>
                    <div class="undo-round-pills">
                        <span style="font-size:12px;color:#d6d3d1;">撤回轮数：</span>
                        <button type="button" class="mini-btn" data-ur="1" onclick="window.ChatPro.previewUndoRounds(1)">1 轮</button>
                        <button type="button" class="mini-btn" data-ur="2" onclick="window.ChatPro.previewUndoRounds(2)">2 轮</button>
                        <button type="button" class="mini-btn" data-ur="3" onclick="window.ChatPro.previewUndoRounds(3)">3 轮</button>
                        <button type="button" class="mini-btn" data-ur="5" onclick="window.ChatPro.previewUndoRounds(5)">5 轮</button>
                        <input type="number" id="undoRoundsInput" class="chat-pro-sec-input" min="1" max="10" value="1" onchange="window.ChatPro.previewUndoRounds(this.value)">
                    </div>
                    <div style="font-size:12px;color:#fde68a;margin-bottom:6px;" id="undoPreviewSummary">正在加载即将撤回的气泡预览...</div>
                    <div class="undo-preview-box" id="undoPreviewList"></div>
                    <div style="display:flex;gap:10px;">
                        <button type="button" class="btn btn-secondary" style="flex:1;" onclick="closeModal('chatUndoConfirmModal')">取消</button>
                        <button type="button" class="btn btn-danger" style="flex:1;" id="confirmUndoExecBtn" onclick="window.ChatPro.confirmUndoNow()">确认撤回</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // 5.8 输入框回车防输入法误触
        const imInput = document.getElementById('imInput');
        if (imInput) {
            imInput.removeAttribute('onkeydown');
            imInput.placeholder = '发消息 / 粘贴截图 / 指令 /reroll ...';
            imInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    window.sendChatMessage();
                }
            });
        }

        bindBubbleInteractions();
    }

    function toggleGearPopover() {
        const pop = document.getElementById('chatGearPopover');
        const btn = document.getElementById('chatProGearBtn');
        if (!pop) return;
        const next = !pop.classList.contains('open');
        pop.classList.toggle('open', next);
        btn?.classList.toggle('gear-active', next);
        if (next) applyDrawerGeometry(drawerGeom, false);
    }

    function closeGearPopover() {
        document.getElementById('chatGearPopover')?.classList.remove('open');
        document.getElementById('chatProGearBtn')?.classList.remove('gear-active');
    }

    function switchGearTab(tab) {
        activeGearTab = tab;
        document.querySelectorAll('.gear-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.gtab === tab));
        document.querySelectorAll('.gear-tab-pane').forEach(p => p.classList.toggle('active', p.id === `gearPane_${tab}`));
    }

    function syncSettingsUI() {
        const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
        setChk('chkProSplit', proConfig.chatSplitEnabled);
        setChk('chkProDelay', proConfig.chatTypingDelay);
        setChk('chkProDebounce', proConfig.chatDebounceEnabled);
        const secEl = document.getElementById('inpProDebounceSec');
        if (secEl) secEl.value = String(proConfig.chatDebounceSec || 10);

        const t = { ...DEFAULT_THEME, ...(proConfig.chatTheme || {}) };
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        setVal('skinUserBubble', t.userBubbleBg);
        setVal('skinAiBubble', t.aiBubbleBg);
        setVal('skinChatBg', t.chatBgColor);
        setVal('skinChatBgMode', t.chatBgMode || 'cover');
        setVal('skinChatBgBlur', String(t.chatBgBlur ?? 0));
        setVal('skinChatBgDim', String(t.chatBgDim ?? 0.35));
        const bLbl = document.getElementById('skinBlurVal');
        if (bLbl) bLbl.innerText = `${t.chatBgBlur ?? 0}px`;
        const dLbl = document.getElementById('skinDimVal');
        if (dLbl) dLbl.innerText = `${Math.round((t.chatBgDim ?? 0.35) * 100)}%`;

        applyChatTheme(t);
    }

    async function loadProSettings() {
        try {
            const res = await fetch(`${API_BASE}/api/chat/pro-settings`);
            const data = await res.json();
            if (res.ok && data.success) {
                proConfig = { ...proConfig, ...data, chatTheme: { ...DEFAULT_THEME, ...(data.chatTheme || {}) } };
                syncSettingsUI();
            }
        } catch {}
    }

    async function saveSettings() {
        const sec = Math.max(2, Math.min(60, parseInt(document.getElementById('inpProDebounceSec')?.value, 10) || 10));
        proConfig.chatSplitEnabled = Boolean(document.getElementById('chkProSplit')?.checked);
        proConfig.chatTypingDelay = Boolean(document.getElementById('chkProDelay')?.checked);
        proConfig.chatDebounceEnabled = Boolean(document.getElementById('chkProDebounce')?.checked);
        proConfig.chatDebounceSec = sec;
        syncSettingsUI();
        try {
            await fetch(`${API_BASE}/api/chat/pro-settings`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatSplitEnabled: proConfig.chatSplitEnabled,
                    chatTypingDelay: proConfig.chatTypingDelay,
                    chatDebounceEnabled: proConfig.chatDebounceEnabled,
                    chatDebounceSec: proConfig.chatDebounceSec
                })
            });
        } catch {}
        if (!proConfig.chatDebounceEnabled && pendingQueue.length > 0 && !isRequestInFlight) flushNow();
    }

    function readSkinFromInputs() {
        return {
            ...proConfig.chatTheme,
            userBubbleBg: document.getElementById('skinUserBubble')?.value || DEFAULT_THEME.userBubbleBg,
            aiBubbleBg: document.getElementById('skinAiBubble')?.value || DEFAULT_THEME.aiBubbleBg,
            chatBgColor: document.getElementById('skinChatBg')?.value || DEFAULT_THEME.chatBgColor,
            chatBgMode: document.getElementById('skinChatBgMode')?.value || 'cover',
            chatBgBlur: parseFloat(document.getElementById('skinChatBgBlur')?.value) || 0,
            chatBgDim: parseFloat(document.getElementById('skinChatBgDim')?.value) || 0
        };
    }

    function liveSkinPreview() {
        proConfig.chatTheme = readSkinFromInputs();
        const bLbl = document.getElementById('skinBlurVal');
        if (bLbl) bLbl.innerText = `${proConfig.chatTheme.chatBgBlur}px`;
        const dLbl = document.getElementById('skinDimVal');
        if (dLbl) dLbl.innerText = `${Math.round(proConfig.chatTheme.chatBgDim * 100)}%`;
        applyChatTheme(proConfig.chatTheme);
    }

    async function saveSkin() {
        proConfig.chatTheme = readSkinFromInputs();
        applyChatTheme(proConfig.chatTheme);
        try {
            await fetch(`${API_BASE}/api/chat/pro-settings`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatTheme: proConfig.chatTheme })
            });
        } catch {}
    }

    async function uploadSkinBg(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const imgData = typeof compressImageToBase64 === 'function'
                ? await compressImageToBase64(file, 1080, 0.84)
                : await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = (e) => resolve(e.target.result);
                    r.onerror = reject;
                    r.readAsDataURL(file);
                });
            proConfig.chatTheme = { ...readSkinFromInputs(), chatBgImage: imgData };
            applyChatTheme(proConfig.chatTheme);
            await saveSkin();
            appendSysPill('🖼️ 聊天框专属背景图已生效～');
        } catch (e) {
            appendSysPill(`⚠️ 背景图加载失败：${e.message}`);
        }
        event.target.value = '';
    }

    async function clearSkinBg() {
        proConfig.chatTheme = { ...readSkinFromInputs(), chatBgImage: '' };
        applyChatTheme(proConfig.chatTheme);
        await saveSkin();
        appendSysPill('🫧 已清除聊天框背景图');
    }

    async function resetSkin() {
        proConfig.chatTheme = { ...DEFAULT_THEME };
        syncSettingsUI();
        await saveSkin();
        appendSysPill('🎨 聊天框配色与背景已恢复默认');
    }

    // 6. 气泡右键 / 手机长按单删 & 多选
    function showCtxMenu(x, y, rowEl) {
        const menu = document.getElementById('chatBubbleCtxMenu');
        if (!menu || !rowEl) return;
        ctxTargetMsgId = rowEl.dataset.msgId ? parseInt(rowEl.dataset.msgId, 10) : null;
        ctxTargetRowEl = rowEl;
        menu.style.left = `${Math.min(window.innerWidth - 185, Math.max(8, x))}px`;
        menu.style.top = `${Math.min(window.innerHeight - 175, Math.max(8, y))}px`;
        menu.classList.add('show');
    }

    function hideCtxMenu() {
        document.getElementById('chatBubbleCtxMenu')?.classList.remove('show');
    }

    function bindBubbleInteractions() {
        const box = document.getElementById('imMessagesList');
        if (!box || box.dataset.ctxBound) return;
        box.dataset.ctxBound = '1';

        box.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.im-bubble-row[data-msg-id]');
            if (!row || multiSelectMode) return;
            e.preventDefault();
            showCtxMenu(e.clientX, e.clientY, row);
        });

        box.addEventListener('touchstart', (e) => {
            const row = e.target.closest('.im-bubble-row[data-msg-id]');
            if (!row || multiSelectMode || e.touches.length !== 1) return;
            const t = e.touches[0];
            bubbleTouchStart = { x: t.clientX, y: t.clientY };
            clearTimeout(bubbleLongPressTimer);
            bubbleLongPressTimer = setTimeout(() => {
                if (navigator.vibrate) try { navigator.vibrate(20); } catch {}
                showCtxMenu(t.clientX, t.clientY, row);
            }, 480);
        }, { passive: true });

        box.addEventListener('touchmove', (e) => {
            if (!bubbleTouchStart || !e.touches.length) return;
            if (Math.hypot(e.touches[0].clientX - bubbleTouchStart.x, e.touches[0].clientY - bubbleTouchStart.y) > 12) {
                clearTimeout(bubbleLongPressTimer);
            }
        }, { passive: true });

        const cancelLP = () => { clearTimeout(bubbleLongPressTimer); bubbleTouchStart = null; };
        box.addEventListener('touchend', cancelLP, { passive: true });
        box.addEventListener('touchcancel', cancelLP, { passive: true });

        box.addEventListener('click', (e) => {
            if (!multiSelectMode) return;
            const row = e.target.closest('.im-bubble-row[data-msg-id]');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            const id = parseInt(row.dataset.msgId, 10);
            if (!id) return;
            if (selectedBubbleIds.has(id)) {
                selectedBubbleIds.delete(id);
                row.classList.remove('multi-selected');
                const dot = row.querySelector('.bubble-check-dot');
                if (dot) dot.innerText = '';
            } else {
                selectedBubbleIds.add(id);
                row.classList.add('multi-selected');
                const dot = row.querySelector('.bubble-check-dot');
                if (dot) dot.innerText = '✓';
            }
            updateMultiBarUI();
        });
    }

    function updateMultiBarUI() {
        const bar = document.getElementById('chatMultiBar');
        const txt = document.getElementById('chatMultiText');
        if (!bar || !txt) return;
        bar.classList.toggle('show', multiSelectMode);
        txt.innerText = `☑️ 已选 ${selectedBubbleIds.size} 条`;
    }

    function enterMultiSelect(initialId = null) {
        multiSelectMode = true;
        selectedBubbleIds.clear();
        document.querySelectorAll('#imMessagesList .im-bubble-row[data-msg-id]').forEach(row => {
            row.classList.add('multi-selectable');
            row.classList.remove('multi-selected');
            let dot = row.querySelector('.bubble-check-dot');
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'bubble-check-dot';
                row.insertBefore(dot, row.firstChild);
            }
            dot.innerText = '';
            if (initialId && String(row.dataset.msgId) === String(initialId)) {
                selectedBubbleIds.add(initialId);
                row.classList.add('multi-selected');
                dot.innerText = '✓';
            }
        });
        updateMultiBarUI();
    }

    function exitMultiSelect() {
        multiSelectMode = false;
        selectedBubbleIds.clear();
        document.querySelectorAll('#imMessagesList .im-bubble-row').forEach(row => {
            row.classList.remove('multi-selectable', 'multi-selected');
        });
        updateMultiBarUI();
    }

    function ctxCopy() {
        hideCtxMenu();
        if (!ctxTargetRowEl) return;
        const txt = ctxTargetRowEl.querySelector('.im-bubble')?.innerText?.trim() || '';
        if (txt) navigator.clipboard?.writeText(txt).then(() => appendSysPill('📋 已复制气泡文字')).catch(() => {});
    }

    function ctxEnterMulti() {
        hideCtxMenu();
        enterMultiSelect(ctxTargetMsgId);
    }

    async function deleteBubblesByIds(ids, syncMemory) {
        if (!ids.length) return;
        const tip = syncMemory
            ? `确认删除选中的 ${ids.length} 条气泡，并同步更新/清理对应的聊天上下文记忆吗？`
            : `确认仅删除选中的 ${ids.length} 条气泡吗？（TA 脑内的连续记忆会保留）`;
        if (!confirm(tip)) return;
        try {
            const res = await fetch(`${API_BASE}/api/chat/delete-bubbles`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, syncMemory })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '删除失败');

            const idSet = new Set(ids.map(String));
            document.querySelectorAll('#imMessagesList .im-bubble-row[data-msg-id]').forEach(el => {
                if (idSet.has(el.dataset.msgId)) el.remove();
            });
            if (typeof chatHistory !== 'undefined') {
                for (let i = chatHistory.length - 1; i >= 0; i--) {
                    if (idSet.has(String(chatHistory[i].id))) chatHistory.splice(i, 1);
                }
            }
            if (multiSelectMode) exitMultiSelect();
            appendSysPill(syncMemory ? `🧹 已删 ${data.deletedBubbles || ids.length} 条气泡（聊天记忆已同步更新）` : `🗑️ 已仅删 ${data.deletedBubbles || ids.length} 条气泡`);
        } catch (e) {
            appendSysPill(`⚠️ 删除失败：${e.message}`);
        }
    }

    async function ctxDeleteOne(syncMemory) {
        hideCtxMenu();
        if (ctxTargetMsgId) await deleteBubblesByIds([ctxTargetMsgId], syncMemory);
    }

    async function confirmBatchDelete(syncMemory) {
        const ids = Array.from(selectedBubbleIds);
        if (!ids.length) { appendSysPill('⚠️ 请先点选至少 1 条要删除的气泡哦～'); return; }
        await deleteBubblesByIds(ids, syncMemory);
    }

    // 7. 撤回确认弹窗
    async function openUndoConfirmModal(defaultRounds = 1) {
        if (appConfig.soloMode) return;
        if (isRequestInFlight) { appendSysPill('⏳ 请等当前回复完成后再撤回哦～'); return; }
        undoRoundsDraft = Math.max(1, Math.min(10, parseInt(defaultRounds, 10) || 1));
        document.getElementById('chatUndoConfirmModal')?.classList.add('open');
        await previewUndoRounds(undoRoundsDraft);
    }

    async function previewUndoRounds(roundsInput) {
        const r = Math.max(1, Math.min(10, parseInt(roundsInput, 10) || 1));
        undoRoundsDraft = r;
        const inp = document.getElementById('undoRoundsInput');
        if (inp) inp.value = String(r);
        document.querySelectorAll('#chatUndoConfirmModal [data-ur]').forEach(btn => {
            const active = Number(btn.dataset.ur) === r;
            btn.style.borderColor = active ? 'var(--accent)' : '';
            btn.style.color = active ? '#fde68a' : '';
        });

        const sumEl = document.getElementById('undoPreviewSummary');
        const listEl = document.getElementById('undoPreviewList');
        const execBtn = document.getElementById('confirmUndoExecBtn');
        if (sumEl) sumEl.innerText = '⏳ 正在预览即将撤回的聊天内容...';

        try {
            const res = await fetch(`${API_BASE}/api/chat/undo-preview?rounds=${r}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '预览失败');
            const previews = data.previews || [];
            if (!previews.length) {
                if (sumEl) sumEl.innerText = '🫧 当前聊天框里没有可撤回的对话记录哦～';
                if (listEl) listEl.innerHTML = `<div style="text-align:center;color:#78716c;padding:12px 0;">空空如也</div>`;
                if (execBtn) execBtn.disabled = true;
                return;
            }
            if (execBtn) execBtn.disabled = false;
            if (sumEl) sumEl.innerText = `⚠️ 即将撤回最后 ${r} 轮聊天（共 ${previews.length} 条气泡 + 对应聊天记忆）：`;
            const uName = appConfig.userName || '我';
            const cName = appConfig.charName || 'TA';
            if (listEl) {
                listEl.innerHTML = previews.map(p => `
                    <div class="undo-preview-item">
                        <span class="undo-role-tag ${p.role === 'user' ? 'u' : 'a'}">${esc(p.role === 'user' ? uName : cName)}</span>
                        <span>${esc(p.preview || '(空)')}</span>
                    </div>
                `).join('');
            }
        } catch (e) {
            if (sumEl) sumEl.innerText = `❌ 预览失败：${e.message}`;
        }
    }

    async function confirmUndoNow() {
        closeModal('chatUndoConfirmModal');
        await executeUndoRounds(undoRoundsDraft);
    }

    // 8. 气泡渲染 & 拟人延迟连发
    function appendSysPill(text) {
        const box = document.getElementById('imMessagesList');
        if (!box) return;
        const pill = document.createElement('div');
        pill.className = 'chat-sys-pill';
        pill.innerText = text;
        box.appendChild(pill);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    }

    function setSubStatus(text) {
        const el = document.getElementById('imSubStatus');
        if (el) el.innerText = text;
    }

    function resetSubStatus() {
        const hint = proConfig.chatDebounceEnabled ? `防抖 ${proConfig.chatDebounceSec}s` : '直发模式';
        setSubStatus(`✉️ 通讯 · ${hint}`);
    }

    window.renderChatMessages = function (list) {
        exitMultiSelect();
        const box = document.getElementById('imMessagesList');
        if (!box) return;
        if (!list || !list.length) {
            box.innerHTML = `<div style="text-align:center;color:#a8a29e;font-size:12px;margin-top:20px;">给正在线上连线的 ${esc(appConfig.charName || 'TA')} 发条消息、图片或语音吧～</div>`;
            return;
        }
        const cAva = renderAvatarHtml(appConfig.charAvatar, appConfig.charName || 'TA');
        const uAva = renderAvatarHtml(appConfig.userAvatar, appConfig.userName || '我');
        box.innerHTML = list.map(m => {
            const idAttr = m.id ? `data-msg-id="${m.id}"` : '';
            return m.role === 'user'
                ? `<div class="im-bubble-row user" ${idAttr}><div class="im-bubble">${window.renderBubbleInnerHtml(m.content)}</div><div class="bubble-avatar">${uAva}</div></div>`
                : `<div class="im-bubble-row assistant" ${idAttr}><div class="bubble-avatar">${cAva}</div><div class="im-bubble">${window.renderBubbleInnerHtml(m.content)}</div></div>`;
        }).join('');
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
    };

    window.appendBubble = function (role, content, isTyping = false, opts = {}) {
        const box = document.getElementById('imMessagesList');
        if (!box) return null;
        if (!box.querySelector('.im-bubble-row') && !box.querySelector('.chat-sys-pill')) box.innerHTML = '';
        const row = document.createElement('div');
        row.className = `im-bubble-row ${role}${opts.queued ? ' queued' : ''}`;
        if (opts.msgId) row.dataset.msgId = String(opts.msgId);
        if (opts.localId) row.dataset.localId = String(opts.localId);

        const ava = role === 'user'
            ? renderAvatarHtml(appConfig.userAvatar, appConfig.userName || '我')
            : renderAvatarHtml(appConfig.charAvatar, appConfig.charName || 'TA');
        const inner = isTyping ? esc(content) : window.renderBubbleInnerHtml(content);
        const queuedTag = opts.queued ? `<span class="queued-tag">⏳ 待打包</span>` : '';

        row.innerHTML = role === 'user'
            ? `<div class="im-bubble">${inner}${queuedTag}</div><div class="bubble-avatar">${ava}</div>`
            : `<div class="bubble-avatar">${ava}</div><div class="im-bubble ${isTyping ? 'im-typing' : ''}">${inner}</div>`;
        box.appendChild(row);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
        return row;
    };

    function calcNaturalDelayMs(msg) {
        const len = Math.max(2, Number(msg.charLen) || String(msg.content || '').length);
        const base = msg.kind === 'voice'
            ? Math.min(2800, Math.max(1000, 850 + len * 60))
            : Math.min(2600, Math.max(680, 560 + len * 52));
        return Math.round(base * (0.88 + Math.random() * 0.24));
    }

    async function deliverReplyBubblesSequentially(replyMsgs, runId) {
        if (!Array.isArray(replyMsgs) || !replyMsgs.length) return;
        for (let i = 0; i < replyMsgs.length; i++) {
            if (runId !== streamSessionId) return;
            const msg = replyMsgs[i];
            if (i > 0 && proConfig.chatTypingDelay) {
                setSubStatus(msg.kind === 'voice' ? '🎙️ 对方正在录制语音...' : '⌨️ 对方正在输入...');
                const typingRow = window.appendBubble('assistant', msg.kind === 'voice' ? '🎙️ • • •' : '• • •', true);
                await sleep(calcNaturalDelayMs(msg));
                typingRow?.remove();
                if (runId !== streamSessionId) return;
            }
            if (typeof chatHistory !== 'undefined') chatHistory.push(msg);
            window.appendBubble('assistant', msg.content, false, { msgId: msg.id });
        }
    }

    // 9. AstrBot 防抖合并队列
    function stopDebounceTimers() {
        clearTimeout(debounceTimer);
        clearInterval(debounceCountdownInterval);
        debounceTimer = null;
        debounceCountdownInterval = null;
        debounceDeadline = 0;
    }

    function updateDebounceBarUI() {
        const bar = document.getElementById('chatDebounceBar');
        const txt = document.getElementById('chatDebounceText');
        if (!bar || !txt) return;
        if (!pendingQueue.length) { bar.classList.remove('show'); return; }
        bar.classList.add('show');
        if (isRequestInFlight) {
            txt.innerText = `⏳ 回复后自动打包发 ${pendingQueue.length} 条新消息…`;
            return;
        }
        const remainSec = Math.max(0, Math.ceil((debounceDeadline - Date.now()) / 1000));
        txt.innerText = `⏳ ${remainSec}s 后打包发送（${pendingQueue.length} 条）`;
    }

    function scheduleDebounceFlush() {
        stopDebounceTimers();
        if (!pendingQueue.length || isRequestInFlight) { updateDebounceBarUI(); return; }
        const waitMs = Math.max(1500, (proConfig.chatDebounceSec || 10) * 1000);
        debounceDeadline = Date.now() + waitMs;
        updateDebounceBarUI();
        debounceCountdownInterval = setInterval(updateDebounceBarUI, 250);
        debounceTimer = setTimeout(() => flushNow(), waitMs);
    }

    function cancelQueue() {
        stopDebounceTimers();
        pendingQueue.forEach(q => q.rowEl?.remove());
        pendingQueue = [];
        updateDebounceBarUI();
        resetSubStatus();
        appendSysPill('🧹 已撤回未发送的待打包消息');
    }

    function abortAllPendingAndStreams() {
        streamSessionId++;
        stopDebounceTimers();
        pendingQueue = [];
        updateDebounceBarUI();
        isRequestInFlight = false;
        exitMultiSelect();
        resetSubStatus();
    }

    async function flushNow() {
        if (isRequestInFlight || !pendingQueue.length) return;
        stopDebounceTimers();
        const batch = pendingQueue.splice(0, pendingQueue.length);
        updateDebounceBarUI();

        for (const item of batch) {
            if (item.rowEl) {
                item.rowEl.classList.remove('queued');
                item.rowEl.querySelector('.queued-tag')?.remove();
            }
        }

        isRequestInFlight = true;
        const myRunId = ++streamSessionId;
        setSubStatus('⌨️ 对方正在输入...');
        const typingRow = window.appendBubble('assistant', '• • •', true);

        try {
            const res = await fetch(`${API_BASE}/api/chat/pro`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: batch.map(b => ({ content: b.text, imageData: b.imageData, audioData: b.audioData, audioFormat: b.audioFormat })),
                    ...getFocusPayload(),
                    currentSong: playlist[currentSongIndex]?.title || '',
                    deskSummary: getDeskSummary()
                })
            });
            const data = await res.json();
            typingRow?.remove();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            if (myRunId !== streamSessionId || data.staleDiscarded) return;

            if (Array.isArray(data.userMsgs)) {
                data.userMsgs.forEach((um, idx) => {
                    if (typeof chatHistory !== 'undefined') chatHistory.push(um);
                    const rowEl = batch[idx]?.rowEl;
                    if (rowEl && um.id) rowEl.dataset.msgId = String(um.id);
                });
            }

            await deliverReplyBubblesSequentially(data.replyMsgs || [], myRunId);
            if (data.ttsWarning && typeof showCommBanner === 'function') {
                showCommBanner('⚠️ 部分语音合成已降级为文字', data.ttsWarning, false);
            }
        } catch (e) {
            typingRow?.remove();
            if (myRunId === streamSessionId) window.appendBubble('assistant', `⚠️ ${e.message}`);
        } finally {
            isRequestInFlight = false;
            resetSubStatus();
            if (pendingQueue.length > 0) {
                if (proConfig.chatDebounceEnabled) scheduleDebounceFlush();
                else flushNow();
            }
        }
    }

    // 10. 聊天框专属 /reroll & /clear(N)
    async function executeReroll() {
        if (appConfig.soloMode) return;
        if (isRequestInFlight) { appendSysPill('⏳ 请等当前回复完成后再 /reroll 哦～'); return; }
        if (pendingQueue.length > 0) { appendSysPill('⚠️ 当前还有未发送的防抖消息，请先点立即发或撤回后再 /reroll'); return; }

        isRequestInFlight = true;
        const myRunId = ++streamSessionId;
        setSubStatus('🔄 正在重生成上一轮回复...');
        const typingRow = window.appendBubble('assistant', '🔄 重新组织语言中 • • •', true);

        try {
            const res = await fetch(`${API_BASE}/api/chat/reroll`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...getFocusPayload(),
                    currentSong: playlist[currentSongIndex]?.title || '',
                    deskSummary: getDeskSummary()
                })
            });
            const data = await res.json();
            typingRow?.remove();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            if (myRunId !== streamSessionId) return;

            const removedSet = new Set((data.removedChatIds || []).map(String));
            if (removedSet.size > 0) {
                document.querySelectorAll('#imMessagesList .im-bubble-row[data-msg-id]').forEach(el => {
                    if (removedSet.has(el.dataset.msgId)) el.remove();
                });
                if (typeof chatHistory !== 'undefined') {
                    for (let i = chatHistory.length - 1; i >= 0; i--) {
                        if (removedSet.has(String(chatHistory[i].id))) chatHistory.splice(i, 1);
                    }
                }
            }

            appendSysPill('🔄 已重生成上一轮聊天回复');
            await deliverReplyBubblesSequentially(data.replyMsgs || [], myRunId);
            if (data.ttsWarning && typeof showCommBanner === 'function') {
                showCommBanner('⚠️ 部分语音合成已降级为文字', data.ttsWarning, false);
            }
        } catch (e) {
            typingRow?.remove();
            appendSysPill(`⚠️ /reroll 失败：${e.message}`);
        } finally {
            isRequestInFlight = false;
            resetSubStatus();
        }
    }

    async function executeUndoRounds(rounds = 1) {
        if (appConfig.soloMode) return;
        if (isRequestInFlight) { appendSysPill('⏳ 请等当前回复完成后再撤回哦～'); return; }
        if (pendingQueue.length > 0) {
            stopDebounceTimers();
            pendingQueue.forEach(q => q.rowEl?.remove());
            pendingQueue = [];
            updateDebounceBarUI();
        }

        try {
            const res = await fetch(`${API_BASE}/api/chat/undo`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rounds })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);

            const removedSet = new Set((data.removedChatIds || []).map(String));
            if (removedSet.size > 0) {
                document.querySelectorAll('#imMessagesList .im-bubble-row[data-msg-id]').forEach(el => {
                    if (removedSet.has(el.dataset.msgId)) el.remove();
                });
                if (typeof chatHistory !== 'undefined') {
                    for (let i = chatHistory.length - 1; i >= 0; i--) {
                        if (removedSet.has(String(chatHistory[i].id))) chatHistory.splice(i, 1);
                    }
                }
                appendSysPill(`↩️ 已撤回最后 ${rounds} 轮（清掉 ${removedSet.size} 条气泡 + ${data.removedMemoryCount || 0} 条聊天记忆）`);
            } else {
                appendSysPill('🫧 已经没有可撤回的对话记录啦～');
            }
        } catch (e) {
            appendSysPill(`⚠️ 撤回失败：${e.message}`);
        }
    }

    // 11. 接管发送入口
    window.sendChatMessage = async function () {
        if (appConfig.soloMode) return;
        const input = document.getElementById('imInput');
        if (!input) return;

        const text = input.value.trim();
        const imgToSend = typeof pendingImageBase64 !== 'undefined' ? pendingImageBase64 : '';
        const audToSend = typeof pendingAudioBase64 !== 'undefined' ? pendingAudioBase64 : '';
        const audFmt = typeof pendingAudioFormat !== 'undefined' ? pendingAudioFormat : 'webm';
        if (!text && !imgToSend && !audToSend) return;

        if (!imgToSend && !audToSend) {
            if (/^\/?reroll$/i.test(text)) {
                input.value = '';
                await executeReroll();
                input.focus();
                return;
            }
            const clearMatch = text.match(/^\/clear(?:\s*(\d+))?$/i);
            if (clearMatch) {
                input.value = '';
                const rounds = Math.max(1, Math.min(10, parseInt(clearMatch[1] || '1', 10) || 1));
                await openUndoConfirmModal(rounds);
                return;
            }
        }

        input.value = '';
        if (typeof clearPendingAttachment === 'function') clearPendingAttachment();

        const localPreviewContent = (imgToSend || audToSend)
            ? JSON.stringify({ __mm: 1, text, imageData: imgToSend, audioData: audToSend })
            : text;

        const needQueue = proConfig.chatDebounceEnabled || isRequestInFlight;
        const rowEl = window.appendBubble('user', localPreviewContent, false, {
            queued: needQueue,
            localId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        });

        pendingQueue.push({ text, imageData: imgToSend, audioData: audToSend, audioFormat: audFmt, rowEl });

        if (proConfig.chatDebounceEnabled) scheduleDebounceFlush();
        else if (!isRequestInFlight) flushNow();
        else updateDebounceBarUI();
        input.focus();
    };

    function hookLifecycle() {
        for (const fnName of ['loadChatHistory', 'clearAllMemory', 'executeClearChat']) {
            if (typeof window[fnName] === 'function') {
                const orig = window[fnName];
                window[fnName] = async function () {
                    abortAllPendingAndStreams();
                    return orig.apply(this, arguments);
                };
            }
        }
    }

    window.ChatPro = {
        closeGear: closeGearPopover,
        switchGearTab,
        toggleAdjustMode: toggleAdjustModeFromWidget,
        setQuickSize,
        saveSettings,
        flushNow,
        cancelQueue,
        executeReroll,
        openUndoConfirmModal,
        previewUndoRounds,
        confirmUndoNow,
        liveSkinPreview,
        saveSkin,
        uploadSkinBg,
        clearSkinBg,
        resetSkin,
        ctxCopy,
        ctxEnterMulti,
        ctxDeleteOne,
        exitMultiSelect,
        confirmBatchDelete
    };

    injectStyles();
    upgradeContextSliderMax();
    mountChatProUI();
    initDragAndResize();
    hookLifecycle();
    loadProSettings().then(() => resetSubStatus());
})();