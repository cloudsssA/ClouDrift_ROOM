// public/pet/pet-engine.js —— 像素桌宠大脑（6只萌宠 + 高空抛食弹跳 + 侧边防裁切气泡 + 抛球次数清零 + 全局状态同步）
(function () {
    const STORE_KEY = 'study_room_pet_v2';

    function getPetSize() {
        return window.innerWidth <= 768 ? 62 : 76;
    }

    function loadState() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            return {
                petId: raw.petId || localStorage.getItem('study_room_pet_choice_v1') || 'cat',
                mode: raw.mode || 'roam', // 'roam' | 'stay' | 'side'
                side: raw.side || 'right', // 'left' | 'right'
                syncToAI: raw.syncToAI !== false,
                hunger: typeof raw.hunger === 'number' ? raw.hunger : 85,
                mood: typeof raw.mood === 'number' ? raw.mood : 90,
                catches: raw.catches || 0,
                nicks: raw.nicks || {},
                posX: typeof raw.posX === 'number' ? raw.posX : null,
                posY: typeof raw.posY === 'number' ? raw.posY : null,
                lastEvent: raw.lastEvent || '',
                lastEventTs: raw.lastEventTs || 0
            };
        } catch {
            return { petId: 'cat', mode: 'roam', side: 'right', syncToAI: true, hunger: 85, mood: 90, catches: 0, nicks: {}, posX: null, posY: null, lastEvent: '', lastEventTs: 0 };
        }
    }

    const cfg = loadState();
    function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); }

    let actorEl, canvasEl, bubbleEl, topBtnEl, panelEl;
    let posX = cfg.posX ?? Math.max(80, window.innerWidth - 180);
    let posY = cfg.posY ?? Math.max(100, window.innerHeight - 130);
    let targetX = posX, targetY = posY;
    let facingLeft = false;
    let actionState = 'idle'; // 'walk' | 'idle' | 'sit' | 'sleep' | 'happy' | 'rage'
    let animTick = 0, isRoomFocusing = false, lockUntil = 0, rageUntil = 0, bubbleTimer = null;

    let clickStamps = [];
    let ptrDown = false, dragging = false, dragOffX = 0, dragOffY = 0, startClientX = 0, startClientY = 0;
    let activeProp = null;

    function getPet() {
        if (!window.PetSprites || cfg.petId === 'off') return null;
        return window.PetSprites.PETS[cfg.petId] || window.PetSprites.PETS.cat;
    }
    function getNick(pet = getPet()) {
        if (!pet) return '';
        return (cfg.nicks[pet.id] || '').trim() || pet.defaultNick || pet.name;
    }
    function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function recordPetEvent(text) {
        cfg.lastEvent = text;
        cfg.lastEventTs = Date.now();
        saveState();
        updatePanelUI();
    }

    function spawnFx(symbol, offsetX = 0) {
        if (!actorEl || cfg.petId === 'off') return;
        const fx = document.createElement('span');
        fx.className = 'pet-fx';
        fx.innerText = symbol;
        if (offsetX) fx.style.marginLeft = `${offsetX}px`;
        actorEl.appendChild(fx);
        setTimeout(() => fx.remove(), 1200);
    }

    function updateEdgeClasses() {
        if (!actorEl) return;
        const size = getPetSize();
        const isSideLeft = cfg.mode === 'side' && cfg.side === 'left' && !dragging && !activeProp;
        const isSideRight = cfg.mode === 'side' && cfg.side === 'right' && !dragging && !activeProp;
        const centerX = posX + size / 2;
        const nearLeft = !isSideRight && (isSideLeft || posX < 115) && centerX <= window.innerWidth / 2;
        const nearRight = !isSideLeft && !nearLeft && (isSideRight || (posX + size > window.innerWidth - 115));

        actorEl.classList.toggle('near-top', posY < 105);
        actorEl.classList.toggle('near-left', nearLeft);
        actorEl.classList.toggle('near-right', nearRight);
        actorEl.classList.toggle('side-left', isSideLeft);
        actorEl.classList.toggle('side-right', isSideRight);
        actorEl.classList.toggle('facing-left', !isSideLeft && !isSideRight && facingLeft);
    }

    function say(text, duration = 3400) {
        if (!bubbleEl || !text || cfg.petId === 'off') return;
        updateEdgeClasses();
        bubbleEl.innerText = text;
        bubbleEl.classList.add('show');
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), duration);
    }

    function applyPos() {
        if (!actorEl) return;
        const size = getPetSize();
        const maxX = Math.max(10, window.innerWidth - size - 6);
        const maxY = Math.max(60, window.innerHeight - size - 8);
        if (cfg.mode === 'side') {
            posX = cfg.side === 'left' ? -8 : window.innerWidth - size + 8;
            posY = clamp(posY, 72, maxY - 12);
        } else {
            posX = clamp(posX, 6, maxX);
            posY = clamp(posY, 62, maxY);
        }
        actorEl.style.left = `${posX}px`;
        actorEl.style.top = `${posY}px`;
        updateEdgeClasses();
    }

    function drawCurrentFrame() {
        const pet = getPet();
        if (!pet || !canvasEl) return;
        let frame = 'idle';
        if (Date.now() < rageUntil) frame = 'rage';
        else if (Date.now() < lockUntil && actionState === 'happy') frame = 'happy';
        else if (actionState === 'walk') frame = animTick ? 'walk' : 'idle';
        else if (actionState === 'sleep') frame = pet.isFish ? (animTick ? 'idle' : 'walk') : 'sleep';
        else if (actionState === 'sit') frame = 'sit';
        window.PetSprites.drawFrame(canvasEl, pet.id, frame);
    }

    function triggerHappy(line, fx = '❤️', count = 2) {
        const pet = getPet();
        if (!pet || !actorEl) return;
        rageUntil = 0;
        actorEl.classList.remove('raging');
        lockUntil = Date.now() + 1700;
        actionState = 'happy';
        drawCurrentFrame();
        actorEl.classList.remove('bouncing');
        void actorEl.offsetWidth;
        actorEl.classList.add('bouncing');
        setTimeout(() => actorEl && actorEl.classList.remove('bouncing'), 820);
        for (let i = 0; i < count; i++) {
            setTimeout(() => spawnFx(fx, (Math.random() - 0.5) * 32), i * 130);
        }
        if (line) say(line);
    }

    function triggerRage() {
        const pet = getPet();
        if (!pet || !actorEl) return;
        rageUntil = Date.now() + 4200;
        lockUntil = rageUntil;
        actionState = 'rage';
        cfg.mood = clamp(cfg.mood - 6, 15, 100);
        actorEl.classList.add('raging');
        drawCurrentFrame();

        const fxIcon = pet.isFish ? '😵' : (pet.id === 'dog' ? '💫' : '💢');
        spawnFx(fxIcon, -10);
        setTimeout(() => spawnFx(fxIcon, 12), 200);
        say(pick(pet.rageLines), 4200);

        const descMap = {
            cat: '刚被用户连戳破防，弓背炸毛哈气了',
            dog: '刚被用户疯狂连戳得原地冒星星晕乎乎',
            pig: '刚被用户狂戳破防，气成了红脸粉色河豚',
            fish: '刚被用户疯狂连戳，直接翻白肚皮装死抗议',
            hamster: '刚被用户狂捏腮帮子气到极限充气，存粮差点洒一地',
            bird: '刚被用户连戳得全身羽毛炸开，气成了愤怒小毛球'
        };
        recordPetEvent(descMap[pet.id] || '刚被用户狂戳破防了');

        setTimeout(() => {
            if (actorEl && Date.now() >= rageUntil) {
                actorEl.classList.remove('raging');
                actionState = 'sit';
                drawCurrentFrame();
            }
        }, 4300);
    }

    function handlePetClick() {
        const pet = getPet();
        if (!pet) return;
        const now = Date.now();
        clickStamps = clickStamps.filter(ts => now - ts < 6000);
        clickStamps.push(now);

        if (clickStamps.length >= 6) {
            clickStamps = [];
            triggerRage();
        } else if (clickStamps.length >= 3) {
            const fx = pet.isFish ? '🫧' : (pet.isBird ? '🪶' : '❓');
            triggerHappy(pick(pet.tickleLines), fx, 1);
            cfg.mood = clamp(cfg.mood + 1, 0, 100);
            saveState();
            updatePanelUI();
        } else {
            const fxMap = { fish: '🫧', pig: '💖', hamster: '🌻', bird: '🎵' };
            const fx = fxMap[pet.id] || '❤️';
            cfg.mood = clamp(cfg.mood + 3, 0, 100);
            triggerHappy(pick(pet.petLines), fx, 2);
            recordPetEvent('刚被用户摸头撒娇了');
        }
    }

    function resetCatches() {
        if (!confirm('确定要将累计抛接球次数清零吗？')) return;
        cfg.catches = 0;
        if (cfg.lastEvent && cfg.lastEvent.includes('接球')) {
            cfg.lastEvent = '';
            cfg.lastEventTs = 0;
        }
        saveState();
        updatePanelUI();
        say('接球记录清零啦，重新来比过！', 2600);
    }

    // 🎯 高空抛食 & 任意点击抛球模式
    let pendingDropType = null;
    let aimBannerEl = null;

    function clearProp() {
        if (activeProp?.el) activeProp.el.remove();
        activeProp = null;
    }

    function cancelAimMode() {
        pendingDropType = null;
        document.body.style.cursor = '';
        if (aimBannerEl) { aimBannerEl.remove(); aimBannerEl = null; }
    }

    function enterAimMode(type) {
        const pet = getPet();
        if (!pet) return;
        cancelAimMode();
        if (panelEl) panelEl.classList.remove('open');

        setTimeout(() => {
            pendingDropType = type;
            document.body.style.cursor = 'crosshair';
            aimBannerEl = document.createElement('div');
            aimBannerEl.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:255;background:rgba(24,23,22,0.92);color:#fde68a;border:1px solid var(--accent,#d97706);padding:6px 16px;border-radius:999px;font-size:12.5px;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.45);max-width:calc(100vw - 24px);text-align:center;';
            aimBannerEl.innerText = type === 'snack'
                ? `🎯 点击屏幕高处抛下${pet.snackName}（右键或 Esc 取消）`
                : `🎯 点击屏幕任意位置抛出${pet.ballEmoji}（右键或 Esc 取消）`;
            document.body.appendChild(aimBannerEl);
        }, 60);
    }

    function spawnSnackAt(x, y, isDeluxe = false) {
        const pet = getPet();
        if (!pet) return;
        clearProp();
        const el = document.createElement('div');
        el.className = 'pet-prop';
        el.innerText = isDeluxe ? '🍱' : pet.snackEmoji;
        const floorY = window.innerHeight - 52;
        const safeX = clamp(x - 15, 24, window.innerWidth - 52);
        const fromSky = isDeluxe || y > floorY - 85;
        const startY = fromSky ? 48 : clamp(y - 15, 48, floorY - 85);
        const tossVx = fromSky ? (Math.random() - 0.5) * 1.6 : (Math.random() - 0.5) * 3.0;
        const tossVy = fromSky ? 1.2 : -4.2;

        el.style.left = `${safeX}px`;
        el.style.top = `${startY}px`;
        document.getElementById('petStage')?.appendChild(el);

        activeProp = {
            type: 'snack', isDeluxe, el,
            x: safeX, y: startY,
            vx: tossVx, vy: tossVy,
            landY: floorY,
            rot: 0,
            bounces: 0,
            chaseReadyAt: Date.now() + 260
        };
        say(isDeluxe ? '哇！！空投豪华专注大餐✨' : `天降${pet.snackName}！接驾！！`, 2600);
        spawnFx('✨');
        rageUntil = 0;
        actorEl?.classList.remove('raging');
    }

    function spawnBallAt(x, y) {
        const pet = getPet();
        if (!pet) return;
        clearProp();
        const el = document.createElement('div');
        el.className = 'pet-prop is-ball';
        el.innerText = pet.ballEmoji;
        const startX = clamp(x - 15, 24, window.innerWidth - 52);
        const startY = clamp(y - 15, 72, window.innerHeight - 54);
        el.style.left = `${startX}px`;
        el.style.top = `${startY}px`;
        document.getElementById('petStage')?.appendChild(el);

        const dxFromPet = startX - posX;
        const angle = (dxFromPet >= 0 ? -0.45 : Math.PI + 0.45) + (Math.random() - 0.5) * 0.9;
        activeProp = {
            type: 'ball', el,
            x: startX, y: startY,
            vx: Math.cos(angle) * 5.8,
            vy: Math.sin(angle) * 5.2 - 1.5,
            life: 320
        };
        say(`接球小游戏开始！冲呀${pet.ballEmoji}`, 2400);
        rageUntil = 0;
        actorEl?.classList.remove('raging');
    }

    function dropSnack(isDeluxe = false) {
        if (isDeluxe) {
            const x = clamp(120 + Math.random() * (window.innerWidth - 240), 80, window.innerWidth - 100);
            const y = 52;
            spawnSnackAt(x, y, true);
        } else {
            enterAimMode('snack');
        }
    }

    function throwBall() {
        enterAimMode('ball');
    }

    document.addEventListener('pointerdown', (e) => {
        if (!pendingDropType) return;
        if (e.button === 2) { cancelAimMode(); return; }
        e.preventDefault();
        e.stopPropagation();
        const mode = pendingDropType;
        cancelAimMode();
        if (mode === 'snack') spawnSnackAt(e.clientX, e.clientY, false);
        else spawnBallAt(e.clientX, e.clientY);
    }, true);
    document.addEventListener('contextmenu', (e) => {
        if (pendingDropType) { e.preventDefault(); cancelAimMode(); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && pendingDropType) cancelAimMode();
    });

    function pickNewRoamTarget() {
        const size = getPetSize();
        const maxX = Math.max(120, window.innerWidth - size - 20);
        const maxY = Math.max(140, window.innerHeight - size - 20);
        if (cfg.mode === 'side') {
            targetY = clamp(85 + Math.random() * (maxY - 95), 80, maxY - 12);
        } else {
            targetX = clamp(24 + Math.random() * (maxX - 24), 20, maxX);
            targetY = clamp(82 + Math.random() * (maxY - 82), 78, maxY);
        }
    }

    function updatePanelUI() {
        const pet = getPet();
        if (topBtnEl) {
            topBtnEl.innerHTML = pet ? `${pet.emoji} <span>${getNick(pet)}</span>` : `🐾 <span>桌宠</span>`;
        }
        if (!panelEl) return;

        const nickInput = document.getElementById('petNickInput');
        if (nickInput && document.activeElement !== nickInput) {
            nickInput.value = pet ? getNick(pet) : '';
            nickInput.disabled = !pet;
        }
        const hBar = document.getElementById('petHungerFill'), mBar = document.getElementById('petMoodFill');
        const hTxt = document.getElementById('petHungerTxt'), mTxt = document.getElementById('petMoodTxt');
        if (hBar) hBar.style.width = `${cfg.hunger}%`;
        if (mBar) mBar.style.width = `${cfg.mood}%`;
        if (hTxt) hTxt.innerText = `${Math.round(cfg.hunger)}%`;
        if (mTxt) mTxt.innerText = `${Math.round(cfg.mood)}%`;

        panelEl.querySelectorAll('[data-pet]').forEach(b => b.classList.toggle('active', b.dataset.pet === cfg.petId));
        panelEl.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === cfg.mode));

        const syncChk = document.getElementById('petSyncToAIChk');
        if (syncChk) syncChk.checked = cfg.syncToAI;

        const feedBtn = document.getElementById('petFeedBtn'), ballBtn = document.getElementById('petBallBtn');
        if (feedBtn && pet) feedBtn.innerText = `${pet.snackEmoji} 喂${pet.snackName}`;
        if (ballBtn && pet) ballBtn.innerText = `${pet.ballEmoji} 抛球玩`;

        const catchTxt = document.getElementById('petCatchStatText');
        if (catchTxt) catchTxt.innerText = `${pet ? pet.ballEmoji : '🎾'} 累计抛接球：${cfg.catches} 次`;

        const logEl = document.getElementById('petLogHint');
        if (logEl) {
            logEl.innerText = !pet
                ? '桌宠已收起，点击上方小动物即可召唤出来陪伴自习～'
                : (cfg.lastEvent ? `📝 最近动态：${cfg.lastEvent}` : `💡 提示：直接拖我到屏幕任意角落，连续狂戳 6 下有隐藏彩蛋哦！`);
        }
    }

    function applyPetVisuals() {
        const pet = getPet();
        if (!actorEl) return;
        if (!pet) {
            actorEl.classList.add('hidden');
            clearProp();
        } else {
            actorEl.classList.remove('hidden');
            actorEl.classList.toggle('is-fish', Boolean(pet.isFish));
            applyPos();
            drawCurrentFrame();
        }
        updatePanelUI();
    }

    function selectPet(petId) {
        cfg.petId = petId;
        actionState = isRoomFocusing ? 'sleep' : 'idle';
        clickStamps = [];
        rageUntil = 0;
        actorEl?.classList.remove('raging');
        saveState();
        applyPetVisuals();
        if (petId !== 'off') {
            const pet = getPet();
            const fx = pet.isFish ? '🫧' : (pet.isBird ? '🎵' : '✨');
            triggerHappy(`报到！我是${getNick(pet)}${pet.emoji}`, fx, 2);
            recordPetEvent(`切换成了${pet.name}「${getNick(pet)}」`);
        }
    }

    function selectMode(mode) {
        cfg.mode = mode;
        if (mode === 'side') {
            cfg.side = posX < window.innerWidth / 2 ? 'left' : 'right';
        }
        saveState();
        applyPos();
        updatePanelUI();
        const modeTips = {
            roam: '出发！满屏自由探险去啦🌍',
            stay: '好嘞，我就乖乖坐在这儿不动📌',
            side: '挂在屏幕边沿偷看你做事🐧'
        };
        say(modeTips[mode] || '', 2600);
    }

    function mountDOM() {
        if (!window.PetSprites) return;

        const stage = document.createElement('div');
        stage.className = 'pet-stage';
        stage.id = 'petStage';

        actorEl = document.createElement('div');
        actorEl.className = 'pet-actor';
        actorEl.title = '单击摸摸头 · 连戳6下有彩蛋 · 按住可满屏拖拽';

        bubbleEl = document.createElement('div');
        bubbleEl.className = 'pet-bubble';

        canvasEl = document.createElement('canvas');
        canvasEl.className = 'pet-canvas';
        canvasEl.width = 64;
        canvasEl.height = 64;

        actorEl.appendChild(bubbleEl);
        actorEl.appendChild(canvasEl);
        stage.appendChild(actorEl);
        document.body.appendChild(stage);

        const topLeft = document.querySelector('.top-bar-left');
        const btnWrap = document.createElement('div');
        btnWrap.className = 'pet-top-wrap';
        topBtnEl = document.createElement('button');
        topBtnEl.type = 'button';
        topBtnEl.className = 'pet-top-btn';
        topBtnEl.title = '打开像素桌宠控制面板';
        btnWrap.appendChild(topBtnEl);
        if (topLeft) topLeft.appendChild(btnWrap);
        else document.body.appendChild(btnWrap);

        panelEl = document.createElement('div');
        panelEl.className = 'pet-control-panel';
        panelEl.innerHTML = `
            <div class="pet-panel-head">
                <span>🐾 像素桌宠控制台</span>
                <button type="button" class="pet-panel-close" id="petPanelClose">✕</button>
            </div>
            <div class="pet-nick-row">
                <input class="pet-nick-input" id="petNickInput" maxlength="10" placeholder="给小家伙起个名字...">
            </div>
            <div class="pet-stats-bars">
                <div class="pet-bar-item">
                    <div class="pet-bar-label"><span>🍖 饱腹</span><span id="petHungerTxt">85%</span></div>
                    <div class="pet-bar-track"><div class="pet-bar-fill" id="petHungerFill" style="width:85%;background:#fb923c;"></div></div>
                </div>
                <div class="pet-bar-item">
                    <div class="pet-bar-label"><span>💖 心情</span><span id="petMoodTxt">90%</span></div>
                    <div class="pet-bar-track"><div class="pet-bar-fill" id="petMoodFill" style="width:90%;background:#f472b6;"></div></div>
                </div>
            </div>
            <div>
                <div class="pet-section-label">选择小伙伴</div>
                <div class="pet-pill-grid">
                    <button type="button" class="pet-pill-btn" data-pet="cat">🐱 猫</button>
                    <button type="button" class="pet-pill-btn" data-pet="dog">🐶 狗</button>
                    <button type="button" class="pet-pill-btn" data-pet="pig">🐷 猪</button>
                    <button type="button" class="pet-pill-btn" data-pet="fish">🐟 鱼</button>
                    <button type="button" class="pet-pill-btn" data-pet="hamster">🐹 仓鼠</button>
                    <button type="button" class="pet-pill-btn" data-pet="bird">🐦 小鸟</button>
                    <button type="button" class="pet-pill-btn" data-pet="off">💤 收起</button>
                </div>
            </div>
            <div>
                <div class="pet-section-label">行动模式（随时可直接手拖定位）</div>
                <div class="pet-pill-grid">
                    <button type="button" class="pet-pill-btn" data-mode="roam">🌍 满屏逛</button>
                    <button type="button" class="pet-pill-btn" data-mode="stay">📌 原地呆</button>
                    <button type="button" class="pet-pill-btn" data-mode="side">🐧 挂侧边</button>
                </div>
            </div>
            <div class="pet-game-row">
                <button type="button" class="pet-action-btn" id="petFeedBtn">🍖 投喂零食</button>
                <button type="button" class="pet-action-btn" id="petBallBtn">🧶 抛球玩</button>
            </div>
            <div class="pet-catch-row">
                <span id="petCatchStatText">🎾 累计抛接球：0 次</span>
                <button type="button" class="pet-reset-btn" id="petResetCatchBtn">清零</button>
            </div>
            <label class="pet-sync-row">
                <span>👁️ 让连线角色能感知桌宠状态</span>
                <input type="checkbox" id="petSyncToAIChk" checked>
            </label>
            <div class="pet-log-hint" id="petLogHint"></div>
        `;
        document.body.appendChild(panelEl);

        topBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            panelEl.classList.toggle('open');
            updatePanelUI();
        });
        document.getElementById('petPanelClose').addEventListener('click', () => panelEl.classList.remove('open'));
        document.addEventListener('click', (e) => {
            if (!panelEl.contains(e.target) && !topBtnEl.contains(e.target)) panelEl.classList.remove('open');
        });

        panelEl.querySelectorAll('[data-pet]').forEach(btn => btn.addEventListener('click', () => selectPet(btn.dataset.pet)));
        panelEl.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => selectMode(btn.dataset.mode)));
        document.getElementById('petFeedBtn').addEventListener('click', () => dropSnack(false));
        document.getElementById('petBallBtn').addEventListener('click', () => throwBall());
        document.getElementById('petResetCatchBtn').addEventListener('click', () => resetCatches());
        document.getElementById('petSyncToAIChk').addEventListener('change', (e) => {
            cfg.syncToAI = e.target.checked;
            saveState();
        });
        document.getElementById('petNickInput').addEventListener('input', (e) => {
            const pet = getPet();
            if (!pet) return;
            cfg.nicks[pet.id] = e.target.value.trim();
            saveState();
            if (topBtnEl) topBtnEl.innerHTML = `${pet.emoji} <span>${getNick(pet)}</span>`;
        });

        actorEl.addEventListener('pointerdown', (e) => {
            ptrDown = true;
            dragging = false;
            startClientX = e.clientX;
            startClientY = e.clientY;
            dragOffX = e.clientX - posX;
            dragOffY = e.clientY - posY;
            actorEl.setPointerCapture(e.pointerId);
        });
        actorEl.addEventListener('pointermove', (e) => {
            if (!ptrDown) return;
            const dist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
            if (!dragging && dist > 6) {
                dragging = true;
                actorEl.classList.add('dragging');
                const pet = getPet();
                if (pet) say(pick(pet.dragLines), 2200);
            }
            if (dragging) {
                const size = getPetSize();
                posX = clamp(e.clientX - dragOffX, 4, window.innerWidth - size - 4);
                posY = clamp(e.clientY - dragOffY, 58, window.innerHeight - size - 4);
                actorEl.style.left = `${posX}px`;
                actorEl.style.top = `${posY}px`;
                updateEdgeClasses();
            }
        });
        actorEl.addEventListener('pointerup', () => {
            if (!ptrDown) return;
            ptrDown = false;
            actorEl.classList.remove('dragging');
            if (dragging) {
                dragging = false;
                if (cfg.mode === 'side') {
                    cfg.side = posX < window.innerWidth / 2 ? 'left' : 'right';
                }
                cfg.posX = posX;
                cfg.posY = posY;
                targetX = posX;
                targetY = posY;
                saveState();
                applyPos();
            } else {
                handlePetClick();
            }
        });

        window.addEventListener('resize', () => applyPos());
        applyPetVisuals();
        pickNewRoamTarget();
    }

    function startLoops() {
        setInterval(() => {
            animTick = (animTick + 1) % 2;
            drawCurrentFrame();
        }, 280);

        function tick() {
            const pet = getPet();
            if (pet && actorEl && !dragging) {
                if (activeProp) {
                    if (activeProp.type === 'snack') {
                        if (activeProp.y < activeProp.landY || Math.abs(activeProp.vy) > 0.6) {
                            activeProp.vy += 0.36;
                            activeProp.x = clamp(activeProp.x + activeProp.vx, 20, window.innerWidth - 50);
                            activeProp.y += activeProp.vy;
                            activeProp.rot = (activeProp.rot || 0) + activeProp.vx * 3.2;
                            if (activeProp.y >= activeProp.landY) {
                                activeProp.y = activeProp.landY;
                                if (Math.abs(activeProp.vy) > 2.2 && (activeProp.bounces || 0) < 2) {
                                    activeProp.vy = -activeProp.vy * 0.44;
                                    activeProp.vx *= 0.65;
                                    activeProp.bounces = (activeProp.bounces || 0) + 1;
                                } else {
                                    activeProp.vy = 0;
                                    activeProp.vx = 0;
                                    activeProp.rot = 0;
                                }
                            }
                            activeProp.el.style.transform = `rotate(${Math.round(activeProp.rot || 0)}deg)`;
                        }
                    } else if (activeProp.type === 'ball') {
                        activeProp.x += activeProp.vx;
                        activeProp.y += activeProp.vy;
                        activeProp.vx *= 0.992;
                        activeProp.vy *= 0.992;
                        activeProp.life--;
                        if (activeProp.x < 18 || activeProp.x > window.innerWidth - 46) activeProp.vx *= -1;
                        if (activeProp.y < 64 || activeProp.y > window.innerHeight - 46) activeProp.vy *= -1;
                        activeProp.x = clamp(activeProp.x, 18, window.innerWidth - 46);
                        activeProp.y = clamp(activeProp.y, 64, window.innerHeight - 46);
                        if (activeProp.life <= 0) clearProp();
                    }
                    if (activeProp) {
                        activeProp.el.style.left = `${activeProp.x}px`;
                        activeProp.el.style.top = `${activeProp.y}px`;

                        const readyToChase = !activeProp.chaseReadyAt || Date.now() >= activeProp.chaseReadyAt;
                        if (readyToChase) {
                            const dx = (activeProp.x - 22) - posX;
                            const dy = (activeProp.y - 26) - posY;
                            const d = Math.hypot(dx, dy);
                            if (d < 34) {
                                const wasSnack = activeProp.type === 'snack';
                                const wasDeluxe = Boolean(activeProp.isDeluxe);
                                clearProp();
                                if (wasSnack) {
                                    cfg.hunger = clamp(cfg.hunger + (wasDeluxe ? 35 : 22), 0, 100);
                                    cfg.mood = clamp(cfg.mood + 10, 0, 100);
                                    triggerHappy(pick(pet.eatLines), '✨', 3);
                                    recordPetEvent(`刚美滋滋吃掉了用户投喂的${wasDeluxe ? '豪华专注大餐' : pet.snackName}`);
                                } else {
                                    cfg.catches += 1;
                                    cfg.mood = clamp(cfg.mood + 14, 0, 100);
                                    cfg.hunger = clamp(cfg.hunger - 3, 10, 100);
                                    triggerHappy(pick(pet.playLines), '🎉', 3);
                                    recordPetEvent(`刚在桌面上追着接住了${pet.ballEmoji}（累计接球${cfg.catches}次）`);
                                }
                                saveState();
                                updatePanelUI();
                                if (cfg.mode === 'side') applyPos();
                            } else {
                                const chaseSpd = pet.speed * 3.4;
                                posX += (dx / d) * chaseSpd;
                                posY += (dy / d) * chaseSpd;
                                facingLeft = dx < 0;
                                actionState = 'walk';
                                actorEl.style.left = `${posX}px`;
                                actorEl.style.top = `${posY}px`;
                                updateEdgeClasses();
                            }
                        }
                    }
                } else if (Date.now() >= lockUntil && Date.now() >= rageUntil) {
                    if (cfg.mode === 'roam' && (actionState === 'walk' || pet.isFish)) {
                        const dx = targetX - posX, dy = targetY - posY, d = Math.hypot(dx, dy);
                        if (d < 10) {
                            actionState = Math.random() < 0.55 ? 'sit' : 'idle';
                        } else {
                            const spd = pet.isFish && isRoomFocusing ? pet.speed * 0.45 : pet.speed;
                            posX += (dx / d) * spd;
                            // 小鸟飞行时带一点点轻盈上下波浪感
                            const flutter = pet.isBird ? Math.sin(Date.now() / 110) * 0.55 : 0;
                            posY += (dy / d) * spd + flutter;
                            facingLeft = dx < 0;
                            applyPos();
                        }
                    } else if (cfg.mode === 'side' && actionState === 'walk') {
                        const dy = targetY - posY;
                        if (Math.abs(dy) < 6) {
                            actionState = 'sit';
                        } else {
                            posY += Math.sign(dy) * (pet.speed * 0.65);
                            applyPos();
                        }
                    }
                }
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);

        setInterval(() => {
            const pet = getPet();
            if (!pet || dragging || activeProp || Date.now() < lockUntil || Date.now() < rageUntil) return;

            if (pet.isFish && Math.random() < 0.65) spawnFx('🫧', (Math.random() - 0.5) * 16);
            if (pet.isBird && actionState !== 'sleep' && Math.random() < 0.35) spawnFx('🎵', (Math.random() - 0.5) * 18);

            if (isRoomFocusing) {
                actionState = pet.isFish ? 'walk' : 'sleep';
                if (!pet.isFish && Math.random() < 0.42) spawnFx(Math.random() < 0.5 ? '💤' : '📖');
                return;
            }

            const r = Math.random();
            if (cfg.mode === 'stay') {
                actionState = r < 0.42 ? 'sit' : (r < 0.78 ? 'idle' : 'sleep');
                if (actionState === 'sleep' && !pet.isFish) spawnFx('💤');
            } else {
                if (r < 0.54) {
                    actionState = 'walk';
                    pickNewRoamTarget();
                } else if (r < 0.82) {
                    actionState = 'sit';
                } else {
                    actionState = 'sleep';
                    if (!pet.isFish) spawnFx('💤');
                }
            }
        }, 4000);

        setInterval(() => {
            if (!getPet()) return;
            cfg.hunger = clamp(cfg.hunger - 1, 20, 100);
            saveState();
            updatePanelUI();
        }, 240000);
    }

    function hookStudyRoomEvents() {
        const timerLabel = document.getElementById('timerStatusLabel');
        if (timerLabel) {
            let lastTxt = timerLabel.innerText || '';
            new MutationObserver(() => {
                const txt = timerLabel.innerText || '';
                if (txt === lastTxt) return;
                lastTxt = txt;
                const pet = getPet();
                if (!pet) return;

                if (txt.includes('专心连线中') || txt.includes('沉浸专注中')) {
                    isRoomFocusing = true;
                    actionState = pet.isFish ? 'walk' : 'sleep';
                    say(pick(pet.focusLines), 3400);
                    spawnFx(pet.isFish ? '🫧' : '📖');
                } else if (txt.includes('PAUSED')) {
                    isRoomFocusing = false;
                    actionState = 'sit';
                    say('休息一下喝口水吧☕', 3000);
                } else if (txt.includes('COMPLETED')) {
                    isRoomFocusing = false;
                    triggerHappy(pick(pet.completeLines), '🎉', 3);
                    setTimeout(() => dropSnack(true), 900);
                } else if (txt.includes('已中断') || txt.includes('TIMEOUT')) {
                    isRoomFocusing = false;
                    actionState = 'sit';
                    say('没关系，歇会儿再战～', 3000);
                    spawnFx('☁️');
                }
            }).observe(timerLabel, { childList: true, characterData: true, subtree: true });
        }

        const noteContent = document.getElementById('noteContent');
        if (noteContent) {
            new MutationObserver(() => {
                const txt = noteContent.innerText || '';
                if (txt.includes('发现你切屏离开')) {
                    const pet = getPet();
                    if (pet) {
                        triggerHappy(pick(pet.slackLines), '❗', 2);
                        recordPetEvent('刚才也抓到用户切屏摸鱼了');
                    }
                }
            }).observe(noteContent, { childList: true, characterData: true, subtree: true });
        }
    }

    window.StudyPet = {
        select: selectPet,
        say,
        feed: () => dropSnack(false),
        playBall: throwBall,
        resetCatches,
        getContextSummary() {
            const pet = getPet();
            if (!pet || !cfg.syncToAI) return '';
            const modeText = cfg.mode === 'side' ? `挂在屏幕${cfg.side === 'left' ? '左' : '右'}侧` : (cfg.mode === 'stay' ? '乖乖待在桌面上' : '在屏幕里到处闲逛');
            const stateMap = { sleep: '正在打瞌睡', sit: '乖巧坐着发呆', walk: pet.isBird ? '扑棱着翅膀轻飞' : '溜达中', rage: '正气鼓鼓炸毛/破防', happy: '开心蹦跳中', idle: '发呆中' };
            const recent = (cfg.lastEvent && Date.now() - cfg.lastEventTs < 15 * 60 * 1000) ? `；${cfg.lastEvent}` : '';
            return `电子桌宠：养了一只叫「${getNick(pet)}」的${pet.name}，正${modeText}（${stateMap[actionState] || '陪伴中'}，饱腹${Math.round(cfg.hunger)}%${recent}）`;
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        mountDOM();
        startLoops();
        hookStudyRoomEvents();
    });
})();