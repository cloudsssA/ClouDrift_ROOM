// public/weather-fx.js —— 同步天气 Canvas 粒子动效层（3 档浓度 + 关 · 零死循环防卡顿版）
(function () {
    const FX_LEVEL_KEY = 'study_room_weather_fx_level_v1';
    const STACK_STORE_KEY = 'study_room_desk_stack_v2';

    const LEVELS = [
        { lv: 0, label: '关', mult: 0 },
        { lv: 1, label: '轻', mult: 0.45 },
        { lv: 2, label: '中', mult: 0.95 },
        { lv: 3, label: '浓', mult: 1.6 }
    ];

    let fxLevel = parseInt(localStorage.getItem(FX_LEVEL_KEY) || '1', 10);
    if (isNaN(fxLevel) || fxLevel < 0 || fxLevel > 3) fxLevel = 1;

    let canvas = null;
    let ctx = null;
    let width = 0;
    let height = 0;
    let particles = [];
    let currentKind = 'clear';
    let rafId = null;
    let lightningAlpha = 0;
    let nextLightningAt = Date.now() + 9000;
    let isUpdatingBtn = false;
    let obsDebounceTimer = null;

    function detectWeatherKind() {
        try {
            const raw = JSON.parse(localStorage.getItem(STACK_STORE_KEY) || '{}');
            const w = raw.weather || {};
            const desc = w.mode === 'custom'
                ? `${w.customIcon || ''} ${w.customDesc || ''}`
                : `${w.liveIcon || ''} ${w.liveDesc || ''}`;
            if (/雷|⛈/.test(desc)) return 'storm';
            if (/雨|🌧|🌦/.test(desc)) return 'rain';
            if (/雪|❄|🌨/.test(desc)) return 'snow';
            if (/落日|晚霞|🌇/.test(desc)) return 'sunset';
            if (/夜|静谧|🌙/.test(desc)) return 'night';
            if (/雾|霾|阴|云|🌫|☁/.test(desc)) return 'fog';
            if (/晴|微风|☀/.test(desc)) return 'sunny';
        } catch {}
        const hr = new Date().getHours();
        return (hr >= 20 || hr < 6) ? 'night' : 'sunny';
    }

    function createCanvas() {
        if (document.getElementById('weatherFxCanvas')) return;
        canvas = document.createElement('canvas');
        canvas.id = 'weatherFxCanvas';
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2;';
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        if (!canvas || !ctx) return;
        const nextW = window.innerWidth;
        const nextH = window.innerHeight;
        // 手机上下滑时 Safari 地址栏伸缩只会微调高度，直接忽略，彻底治好粒子乱闪重置！
        const widthChanged = Math.abs(nextW - width) > 10;
        if (!widthChanged && width > 0 && Math.abs(nextH - height) < 160) return;

        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        width = nextW;
        height = nextH;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (particles.length === 0 || widthChanged) {
            rebuildParticles();
        }
    }

    function spawnParticle(kind, randomY = true) {
        const x = Math.random() * width;
        const y = randomY ? Math.random() * height : -20;

        if (kind === 'rain' || kind === 'storm') {
            const fast = kind === 'storm';
            return {
                x, y,
                len: (fast ? 18 : 13) + Math.random() * 14,
                vx: fast ? -2.6 - Math.random() * 1.2 : -1.1 - Math.random() * 0.7,
                vy: (fast ? 11.5 : 8.2) + Math.random() * 4.5,
                alpha: 0.16 + Math.random() * 0.24,
                w: 0.9 + Math.random() * 0.55
            };
        }
        if (kind === 'snow') {
            return {
                x, y,
                r: 1.5 + Math.random() * 3.0,
                vy: 0.65 + Math.random() * 1.1,
                phase: Math.random() * Math.PI * 2,
                sway: 0.35 + Math.random() * 0.7,
                alpha: 0.28 + Math.random() * 0.44
            };
        }
        if (kind === 'sunset') {
            return {
                x, y: randomY ? Math.random() * height : height + 16,
                r: 2.2 + Math.random() * 4.2,
                vx: 0.22 + Math.random() * 0.4,
                vy: -0.35 - Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2,
                alpha: 0.14 + Math.random() * 0.24,
                hue: Math.random() < 0.5 ? '251, 146, 60' : '251, 113, 133'
            };
        }
        if (kind === 'night') {
            return {
                x, y: Math.random() * height,
                r: 1.1 + Math.random() * 2.0,
                vx: (Math.random() - 0.5) * 0.26,
                vy: -0.15 - Math.random() * 0.24,
                phase: Math.random() * Math.PI * 2,
                speed: 0.015 + Math.random() * 0.024,
                alpha: 0.25 + Math.random() * 0.48
            };
        }
        if (kind === 'fog') {
            return {
                x, y: Math.random() * height,
                r: 42 + Math.random() * 68,
                vx: 0.16 + Math.random() * 0.28,
                vy: (Math.random() - 0.5) * 0.06,
                alpha: 0.025 + Math.random() * 0.035
            };
        }
        return {
            x, y: Math.random() * height,
            r: 1.8 + Math.random() * 3.6,
            vx: (Math.random() - 0.5) * 0.28,
            vy: -0.22 - Math.random() * 0.3,
            phase: Math.random() * Math.PI * 2,
            alpha: 0.16 + Math.random() * 0.25
        };
    }

    function rebuildParticles() {
        particles = [];
        if (fxLevel <= 0 || !width || !height) return;
        const mult = LEVELS[fxLevel]?.mult || 0;
        const mobileFactor = width <= 768 ? 0.62 : 1.0;

        const baseMap = {
            rain: 60,
            storm: 82,
            snow: 50,
            sunny: 30,
            sunset: 32,
            night: 38,
            fog: 10
        };
        const count = Math.max(4, Math.round((baseMap[currentKind] || 32) * mult * mobileFactor));
        for (let i = 0; i < count; i++) {
            particles.push(spawnParticle(currentKind, true));
        }
    }

    function frame() {
        if (!ctx || !canvas) return;
        if (document.hidden || fxLevel <= 0) {
            ctx.clearRect(0, 0, width, height);
            rafId = null;
            return;
        }

        ctx.clearRect(0, 0, width, height);
        const now = Date.now();

        if (currentKind === 'storm') {
            if (now >= nextLightningAt) {
                lightningAlpha = 0.13 + Math.random() * 0.11;
                nextLightningAt = now + 7000 + Math.random() * 14000;
            }
            if (lightningAlpha > 0.005) {
                ctx.fillStyle = `rgba(224, 242, 254, ${lightningAlpha.toFixed(3)})`;
                ctx.fillRect(0, 0, width, height);
                lightningAlpha *= 0.86;
            }
        }

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            if (currentKind === 'rain' || currentKind === 'storm') {
                p.x += p.vx;
                p.y += p.vy;
                ctx.beginPath();
                ctx.strokeStyle = `rgba(219, 234, 254, ${p.alpha})`;
                ctx.lineWidth = p.w;
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + p.vx * 1.5, p.y + p.len);
                ctx.stroke();

                if (p.y > height + 20 || p.x < -30) {
                    particles[i] = spawnParticle(currentKind, false);
                    particles[i].x = Math.random() * (width + 100);
                }
            } else if (currentKind === 'snow') {
                p.phase += 0.018;
                p.x += Math.sin(p.phase) * p.sway;
                p.y += p.vy;
                ctx.beginPath();
                ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();

                if (p.y > height + 12) particles[i] = spawnParticle('snow', false);
            } else if (currentKind === 'sunset') {
                p.phase += 0.02;
                p.x += p.vx + Math.sin(p.phase) * 0.25;
                p.y += p.vy;
                const a = p.alpha * (0.7 + 0.3 * Math.sin(p.phase));
                ctx.beginPath();
                ctx.fillStyle = `rgba(${p.hue}, ${a.toFixed(3)})`;
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();

                if (p.y < -20 || p.x > width + 20) {
                    particles[i] = spawnParticle('sunset', false);
                    particles[i].x = Math.random() * width;
                }
            } else if (currentKind === 'night') {
                p.phase += p.speed;
                p.x += p.vx;
                p.y += p.vy;
                const glow = p.alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase)));
                ctx.beginPath();
                ctx.fillStyle = `rgba(254, 243, 199, ${glow.toFixed(3)})`;
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();

                if (p.y < -15) p.y = height + 12;
                if (p.x < -15) p.x = width + 12;
                if (p.x > width + 15) p.x = -12;
            } else if (currentKind === 'fog') {
                p.x += p.vx;
                p.y += p.vy;
                // 柔和径向渐变薄雾，边缘自然消融，告别硬边大光斑！
                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
                grad.addColorStop(0, `rgba(226, 232, 240, ${(p.alpha * 1.2).toFixed(3)})`);
                grad.addColorStop(0.5, `rgba(226, 232, 240, ${(p.alpha * 0.45).toFixed(3)})`);
                grad.addColorStop(1, 'rgba(226, 232, 240, 0)');
                ctx.beginPath();
                ctx.fillStyle = grad;
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
                if (p.x - p.r > width) p.x = -p.r;
            
            } else {
                p.phase += 0.022;
                p.x += p.vx + Math.sin(p.phase) * 0.2;
                p.y += p.vy;
                const a = p.alpha * (0.55 + 0.45 * Math.sin(p.phase));
                ctx.beginPath();
                ctx.fillStyle = `rgba(253, 230, 138, ${a.toFixed(3)})`;
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
                if (p.y < -15) p.y = height + 12;
            }
        }

        rafId = requestAnimationFrame(frame);
    }

    function ensureLoop() {
        if (fxLevel <= 0) {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
            if (ctx) ctx.clearRect(0, 0, width, height);
            return;
        }
        if (!rafId && !document.hidden) {
            rafId = requestAnimationFrame(frame);
        }
    }

    function syncWeatherKind(forceRebuild = false) {
        const next = detectWeatherKind();
        if (next !== currentKind || forceRebuild) {
            currentKind = next;
            rebuildParticles();
        }
        ensureLoop();
    }

    function cycleLevel() {
        fxLevel = (fxLevel + 1) % LEVELS.length;
        try { localStorage.setItem(FX_LEVEL_KEY, String(fxLevel)); } catch {}
        rebuildParticles();
        ensureLoop();
        injectWeatherFxButton();
    }

    // 关键修复：对比文本是否变化 + 防重入锁，彻底根除 MutationObserver 无限循环卡顿！
    function injectWeatherFxButton() {
        const modeRow = document.querySelector('.desk-mood-card .ds-w-mode-row');
        if (!modeRow) return;

        const info = LEVELS[fxLevel] || LEVELS[1];
        const targetLabel = fxLevel === 0 ? '✨ 关' : `✨ ${info.label}`;
        const targetOpacity = fxLevel === 0 ? '0.62' : '1';

        isUpdatingBtn = true;
        try {
            let btn = document.getElementById('weatherFxLevelBtn');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'weatherFxLevelBtn';
                btn.type = 'button';
                btn.className = 'ds-mini-act';
                btn.style.cssText = 'border-radius:8px;padding:3.5px 7px;flex-shrink:0;';
                btn.title = '切换天气动效浓度：轻 / 中 / 浓 / 关';
                btn.onclick = () => cycleLevel();
                modeRow.appendChild(btn);
            }
            if (btn.textContent !== targetLabel) btn.textContent = targetLabel;
            if (btn.style.opacity !== targetOpacity) btn.style.opacity = targetOpacity;
        } finally {
            setTimeout(() => { isUpdatingBtn = false; }, 0);
        }
    }

    function scheduleSyncFromDom() {
        if (isUpdatingBtn) return;
        clearTimeout(obsDebounceTimer);
        obsDebounceTimer = setTimeout(() => {
            injectWeatherFxButton();
            syncWeatherKind(false);
        }, 60);
    }

    function watchWeatherCard() {
        const attach = () => {
            injectWeatherFxButton();
            const card = document.querySelector('.desk-mood-card');
            if (card && !card.dataset.wfxObs) {
                card.dataset.wfxObs = '1';
                // 只监听直接子节点变化（卡片重渲染），绝不监听深层文本变更
                new MutationObserver(() => scheduleSyncFromDom()).observe(card, { childList: true });
            }
        };
        attach();
        const mount = document.getElementById('deskWidgetsMount');
        if (mount) {
            new MutationObserver(() => {
                if (!document.getElementById('weatherFxLevelBtn')) attach();
            }).observe(mount, { childList: true });
        }
        setInterval(() => syncWeatherKind(false), 2500);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) ensureLoop();
        });
    }

    window.WeatherFX = {
        cycleLevel,
        setLevel(lv) {
            fxLevel = Math.max(0, Math.min(3, parseInt(lv, 10) || 0));
            try { localStorage.setItem(FX_LEVEL_KEY, String(fxLevel)); } catch {}
            rebuildParticles();
            ensureLoop();
            injectWeatherFxButton();
        },
        sync: () => syncWeatherKind(true)
    };

    createCanvas();
    syncWeatherKind(true);
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', watchWeatherCard);
    } else {
        watchWeatherCard();
    }
})();