// public/desk-stack.js —— 6卡叠放桌面小组件（第1卡默认天气：全球实况+梦境自定 + 精品水吧 + 丝滑SAN值 + 御神签 + DDL + 状态）+ 🌌 深度专注
(function () {
    const OLD_STORE_KEY = 'study_room_desk_stack_v1';
    const STACK_STORE_KEY = 'study_room_desk_stack_v2';
    const ZEN_STORE_KEY = 'study_room_zen_prefs_v1';

    const MOODS = [
        { id: 'reading', label: '📖 沉浸阅读' },
        { id: 'coding', label: '💻 爆肝输出' },
        { id: 'memorize', label: '🧠 刷题背书' },
        { id: 'chill', label: '☕ 轻松摸鱼' }
    ];

    const CYBER_WEATHERS = [
        { icon: '🌧️', label: '雨打窗棂' },
        { icon: '❄️', label: '冬夜飘雪' },
        { icon: '☀️', label: '晴空微风' },
        { icon: '🌇', label: '橘子落日' },
        { icon: '🌙', label: '深夜静谧' },
        { icon: '⛈️', label: '雷雨交加' }
    ];

    const DRINK_CATS = [
        {
            id: 'coffee', icon: '☕', name: '咖啡', color: '#92400e',
            temps: ['冰', '热'], defaultTemp: '冰',
            flavors: ['美式', '卡布奇诺', '摩卡', '自定义'],
            placeholder: '如：生椰拿铁 / 澳白'
        },
        {
            id: 'milktea', icon: '🧋', name: '奶茶', color: '#a855f7',
            temps: ['冰', '热'], defaultTemp: '冰',
            flavors: ['芋泥波波', '珍珠奶茶', '自定义'],
            placeholder: '如：霸王茶姬 / 抹茶奶绿'
        },
        {
            id: 'tea', icon: '🍵', name: '茶饮', color: '#22c55e',
            temps: ['热', '冰'], defaultTemp: '热',
            flavors: ['绿茶', '红茶', '乌龙茶', '普洱茶', '自定义'],
            placeholder: '如：茉莉花茶 / 鸭屎香'
        },
        {
            id: 'soda', icon: '🥤', name: '碳酸', color: '#dc2626',
            temps: ['冰', '热'], defaultTemp: '冰',
            flavors: ['可乐', '雪碧', '芬达', '自定义'],
            placeholder: '如：元气森林 / 姜汁可乐'
        },
        {
            id: 'cocoa', icon: '🍫', name: '可可', color: '#b45309',
            temps: ['热', '冰'], defaultTemp: '热',
            flavors: ['经典可可', '海盐可可', '热牛奶', '自定义'],
            placeholder: '如：棉花糖可可 / 燕麦奶'
        },
        {
            id: 'water', icon: '🫗', name: '纯水', color: '#38bdf8',
            temps: ['温', '冰'], defaultTemp: '温',
            flavors: ['白开水', '气泡水', '柠檬水', '自定义'],
            placeholder: '如：电解质水 / 蜂蜜水'
        }
    ];

    const FORTUNES = [
        { level: '大吉', tag: '云开见月', yi: '推进核心事项、果断落笔', ji: '瞻前顾后' },
        { level: '大吉', tag: '水到渠成', yi: '专注深耕、梳理长期规划', ji: '妄自菲薄' },
        { level: '大吉', tag: '清风徐来', yi: '攻克难点、整理思绪', ji: '急于求成' },
        { level: '上吉', tag: '笃行致远', yi: '按部就班、稳步收尾', ji: '半途而废' },
        { level: '上吉', tag: '静水流深', yi: '独处沉淀、专注当下', ji: '思虑过重' },
        { level: '上吉', tag: '心镜明澈', yi: '复盘得失、厘清主次', ji: '人云亦云' },
        { level: '中吉', tag: '循序渐进', yi: '拆分目标、先易后难', ji: '贪多嚼不烂' },
        { level: '中吉', tag: '守拙藏锋', yi: '夯实基础、查漏补缺', ji: '浮躁冒进' },
        { level: '中吉', tag: '松弛有度', yi: '定时歇息、补充水分', ji: '久坐透支' },
        { level: '中吉', tag: '微光聚火', yi: '完成手头小事、积少成多', ji: '空想拖延' },
        { level: '小吉', tag: '细水长流', yi: '放缓节奏、保持耐心', ji: '自我苛责' },
        { level: '小吉', tag: '柳暗花明', yi: '换个视角、轻装前行', ji: '固执钻牛角尖' },
        { level: '平', tag: '波澜不惊', yi: '维持日常节律、平稳推进', ji: '情绪内耗' },
        { level: '平', tag: '蓄势待发', yi: '养精蓄锐、留白放空', ji: '盲目比较' },
        { level: '末吉', tag: '戒急用忍', yi: '屏蔽杂音、守住专注力', ji: '分心多线并行' },
        { level: '慎行', tag: '张弛之道', yi: '适时止损、早休养神', ji: '熬夜硬撑' }
    ];

    // 🌦️ 天气卡排第 1 块，打开默认看窗外天气！
    const CARD_DEFS = [
        { key: 'weather', title: '🌦️ 窗外天气' },
        { key: 'drink', title: '☕ 桌角精品水吧' },
        { key: 'san', title: '🔋 副本与 SAN 值' },
        { key: 'fortune', title: '🎲 每日电子御神签' },
        { key: 'ddl', title: '⏳ 倒计时目标' },
        { key: 'mood', title: '✨ 此刻桌面状态' }
    ];

    function getTodayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function normalizeDrinkCatId(rawId) {
        const legacyMap = { americano: 'coffee', boba: 'milktea', cola: 'soda' };
        const mapped = legacyMap[rawId] || rawId;
        return DRINK_CATS.some(c => c.id === mapped) ? mapped : 'coffee';
    }

    function loadStackState() {
        try {
            const v2Raw = localStorage.getItem(STACK_STORE_KEY);
            const raw = JSON.parse(v2Raw || localStorage.getItem(OLD_STORE_KEY) || '{}');
            const drinkCat = normalizeDrinkCatId(raw.drinkCat || raw.drinkId || 'coffee');
            const catObj = DRINK_CATS.find(c => c.id === drinkCat) || DRINK_CATS[0];
            return {
                // 首次升级至 v2 时强制默认落在第 1 块天气卡片！
                activeIdx: v2Raw && typeof raw.activeIdx === 'number' ? raw.activeIdx : 0,
                weather: {
                    mode: raw.weather?.mode === 'custom' ? 'custom' : 'live',
                    cityQuery: raw.weather?.cityQuery || '东京',
                    liveCity: raw.weather?.liveCity || '',
                    liveTemp: raw.weather?.liveTemp ?? null,
                    liveFeels: raw.weather?.liveFeels ?? null,
                    liveHumidity: raw.weather?.liveHumidity ?? null,
                    liveDesc: raw.weather?.liveDesc || '',
                    liveIcon: raw.weather?.liveIcon || '⛅',
                    updatedAt: raw.weather?.updatedAt || 0,
                    customCity: raw.weather?.customCity || '希望之峰',
                    customIcon: raw.weather?.customIcon || '🌧️',
                    customDesc: raw.weather?.customDesc || '雨打窗棂',
                    customTemp: typeof raw.weather?.customTemp === 'number' ? raw.weather.customTemp : 14
                },
                mood: raw.mood || '沉浸阅读',
                drinkCat,
                drinkTemp: raw.drinkTemp || catObj.defaultTemp,
                drinkFlavor: raw.drinkFlavor || catObj.flavors[0],
                drinkCustomMap: (raw.drinkCustomMap && typeof raw.drinkCustomMap === 'object') ? raw.drinkCustomMap : {},
                drinkLevel: typeof raw.drinkLevel === 'number' ? raw.drinkLevel : 100,
                drinkRefills: raw.drinkRefills || 0,
                quest: raw.quest || '打磨作品集',
                san: typeof raw.san === 'number' ? raw.san : 78,
                fortuneDate: raw.fortuneDate || '',
                fortuneIdx: typeof raw.fortuneIdx === 'number' ? raw.fortuneIdx : -1,
                ddlTitle: raw.ddlTitle || '目标冲刺日',
                ddlDate: raw.ddlDate || ''
            };
        } catch {
            return {
                activeIdx: 0,
                weather: {
                    mode: 'live', cityQuery: '东京', liveCity: '', liveTemp: null, liveFeels: null,
                    liveHumidity: null, liveDesc: '', liveIcon: '⛅', updatedAt: 0,
                    customCity: '希望之峰', customIcon: '🌧️', customDesc: '雨打窗棂', customTemp: 14
                },
                mood: '沉浸阅读', drinkCat: 'coffee', drinkTemp: '冰', drinkFlavor: '美式', drinkCustomMap: {},
                drinkLevel: 100, drinkRefills: 0, quest: '打磨作品集', san: 78,
                fortuneDate: '', fortuneIdx: -1, ddlTitle: '目标冲刺日', ddlDate: ''
            };
        }
    }

    function loadZenState() {
        try {
            const raw = JSON.parse(localStorage.getItem(ZEN_STORE_KEY) || '{}');
            return { autoZen: Boolean(raw.autoZen), hideWidgetInZen: Boolean(raw.hideWidgetInZen) };
        } catch {
            return { autoZen: false, hideWidgetInZen: false };
        }
    }

    let state = loadStackState();
    let zenPrefs = loadZenState();
    let isZenMode = false;
    let weatherFetching = false;
    let weatherError = '';

    function saveStackState() { try { localStorage.setItem(STACK_STORE_KEY, JSON.stringify(state)); } catch {} }
    function saveZenPrefs() { try { localStorage.setItem(ZEN_STORE_KEY, JSON.stringify(zenPrefs)); } catch {} }

    function esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function mapWmoWeather(code, isDay = 1) {
        const c = Number(code);
        if (c === 0) return isDay ? { icon: '☀️', desc: '晴朗' } : { icon: '🌙', desc: '晴夜' };
        if (c === 1 || c === 2) return isDay ? { icon: '⛅', desc: '多云' } : { icon: '☁️', desc: '少云微凉' };
        if (c === 3) return { icon: '☁️', desc: '阴天' };
        if (c === 45 || c === 48) return { icon: '🌫️', desc: '轻雾' };
        if (c >= 51 && c <= 57) return { icon: '🌦️', desc: '毛毛雨' };
        if (c === 61 || c === 80) return { icon: '🌧️', desc: '小雨' };
        if (c === 63 || c === 81) return { icon: '🌧️', desc: '中雨' };
        if (c === 65 || c === 82) return { icon: '⛈️', desc: '大雨' };
        if (c >= 66 && c <= 67) return { icon: '🌨️', desc: '冻雨' };
        if (c >= 71 && c <= 77) return { icon: '❄️', desc: '降雪' };
        if (c >= 85 && c <= 86) return { icon: '🌨️', desc: '阵雪' };
        if (c >= 95) return { icon: '⛈️', desc: '雷阵雨' };
        return { icon: '⛅', desc: '微风多云' };
    }

    async function fetchLiveWeather(cityInput = null, force = false) {
        const query = String(cityInput !== null ? cityInput : (state.weather.cityQuery || '北京')).trim();
        if (!query) return;

        // 30 分钟内非强制刷新复用缓存
        if (!force && state.weather.liveTemp !== null && state.weather.cityQuery === query && Date.now() - (state.weather.updatedAt || 0) < 30 * 60 * 1000) {
            return;
        }

        state.weather.cityQuery = query;
        weatherFetching = true;
        weatherError = '';
        saveStackState();
        renderStackCard();

        try {
            // 优先 Open-Meteo 全球免 Key 实况接口（支持中英文城市名）
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=zh&format=json`);
            if (!geoRes.ok) throw new Error('地理定位服务暂不可用');
            const geo = await geoRes.json();
            const loc = geo?.results?.[0];
            if (!loc) throw new Error(`未找到城市「${query}」`);

            const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code&timezone=auto`;
            const fcRes = await fetch(fcUrl);
            if (!fcRes.ok) throw new Error('实况气象拉取失败');
            const fc = await fcRes.json();
            const cur = fc?.current;
            if (!cur) throw new Error('未返回实况温度');

            const mapped = mapWmoWeather(cur.weather_code, cur.is_day);
            state.weather.liveCity = loc.name || query;
            state.weather.liveTemp = Math.round(cur.temperature_2m);
            state.weather.liveFeels = Math.round(cur.apparent_temperature ?? cur.temperature_2m);
            state.weather.liveHumidity = Math.round(cur.relative_humidity_2m ?? 50);
            state.weather.liveIcon = mapped.icon;
            state.weather.liveDesc = mapped.desc;
            state.weather.updatedAt = Date.now();
            weatherError = '';
        } catch (err1) {
            // 自动降级备胎：wttr.in
            try {
                const wRes = await fetch(`https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`);
                if (!wRes.ok) throw err1;
                const wData = await wRes.json();
                const cc = wData?.current_condition?.[0];
                if (!cc) throw err1;
                const descZh = cc.lang_zh?.[0]?.value || cc.weatherDesc?.[0]?.value || '多云';
                const icon = /雨/.test(descZh) ? '🌧️' : (/雪/.test(descZh) ? '❄️' : (/晴/.test(descZh) ? '☀️' : (/雾|霾/.test(descZh) ? '🌫️' : '⛅')));
                state.weather.liveCity = query;
                state.weather.liveTemp = Math.round(Number(cc.temp_C) || 0);
                state.weather.liveFeels = Math.round(Number(cc.FeelsLikeC) || state.weather.liveTemp);
                state.weather.liveHumidity = Math.round(Number(cc.humidity) || 50);
                state.weather.liveIcon = icon;
                state.weather.liveDesc = descZh;
                state.weather.updatedAt = Date.now();
                weatherError = '';
            } catch (err2) {
                weatherError = err1.message || '网络波动，可切「✨ 自定」手写窗外天气～';
            }
        } finally {
            weatherFetching = false;
            saveStackState();
            renderStackCard();
        }
    }

    function getCurrentDrinkCat() { return DRINK_CATS.find(c => c.id === state.drinkCat) || DRINK_CATS[0]; }

    function getCurrentDrinkDisplayName() {
        const cat = getCurrentDrinkCat();
        const isCustom = state.drinkFlavor === '自定义';
        const baseName = isCustom
            ? (String(state.drinkCustomMap[cat.id] || '').trim() || `特调${cat.name}`)
            : (state.drinkFlavor || cat.flavors[0]);
        const temp = state.drinkTemp || cat.defaultTemp;
        if (/^[冰热温冷]/.test(baseName)) return baseName;
        return `${temp}${baseName}`;
    }

    function getSanDescriptor(val) {
        if (val >= 85) return { label: '满血狂肝🔥', color: '#4ade80' };
        if (val >= 60) return { label: '状态在线✨', color: '#38bdf8' };
        if (val >= 35) return { label: '勉强维持人形🫠', color: '#fbbf24' };
        return { label: '灵魂已离线👻', color: '#f87171' };
    }

    function calcDdlDays(dateStr) {
        if (!dateStr) return null;
        const today = new Date(getTodayStr() + 'T00:00:00');
        const target = new Date(dateStr + 'T00:00:00');
        if (isNaN(target.getTime())) return null;
        return Math.round((target.getTime() - today.getTime()) / (24 * 3600 * 1000));
    }

    function injectStyles() {
        if (document.getElementById('deskStackStyles')) return;
        const style = document.createElement('style');
        style.id = 'deskStackStyles';
        style.textContent = `
            .desk-stack-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 8px; }
            .desk-stack-title { font-size: 12px; font-weight: 600; color: var(--text-on-card); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .desk-stack-nav { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
            .desk-stack-arrow {
                width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--card-border);
                background: var(--card-subtle); color: var(--text-on-card); font-size: 12px; line-height: 1;
                cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s;
            }
            .desk-stack-arrow:hover { border-color: var(--accent); background: var(--card-subtle-hover); }
            .desk-stack-dots { display: inline-flex; gap: 3px; align-items: center; padding: 0 2px; }
            .desk-stack-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--card-border); cursor: pointer; transition: all 0.2s; }
            .desk-stack-dot.active { width: 11px; border-radius: 999px; background: var(--accent); }
            .desk-stack-body { animation: dstackFade 0.2s ease-out; }
            @keyframes dstackFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

            /* 🌦️ 窗外天气卡 */
            .ds-w-mode-row { display: flex; gap: 5px; margin-bottom: 7px; align-items: center; }
            .ds-w-tab {
                flex: 1; padding: 3.5px 6px; border-radius: 8px; font-size: 11px; text-align: center;
                background: var(--card-subtle); border: 1px solid var(--card-border); color: var(--text-muted-on-card);
                cursor: pointer; transition: all 0.16s;
            }
            .ds-w-tab.active {
                background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); font-weight: 600;
            }
            .ds-w-search-row { display: flex; gap: 5px; margin-bottom: 7px; }
            .ds-w-search-row .ds-input { margin-bottom: 0; flex: 1; min-width: 0; }
            .ds-w-hero {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                background: var(--card-subtle); border: 1px solid var(--card-border);
                border-radius: 12px; padding: 8px 11px;
            }
            .ds-w-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
            .ds-w-icon { font-size: 27px; line-height: 1; flex-shrink: 0; }
            .ds-w-temp { font-size: 21px; font-weight: 800; color: var(--text-on-card); line-height: 1.1; font-variant-numeric: tabular-nums; }
            .ds-w-sub { font-size: 11px; color: var(--text-muted-on-card); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ds-w-vibe-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 6px; }
            .ds-w-vibe-btn {
                padding: 4px 3px; border-radius: 8px; font-size: 10.5px; text-align: center;
                background: var(--card-subtle); border: 1px solid var(--card-border); color: var(--text-on-card);
                cursor: pointer; white-space: nowrap; transition: all 0.15s;
            }
            .ds-w-vibe-btn.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); font-weight: 600; }
            .ds-w-custom-top { display: grid; grid-template-columns: 1.45fr 0.75fr; gap: 5px; margin-bottom: 6px; }
            .ds-w-custom-top .ds-input { margin-bottom: 0; }

            /* 精品定制水吧 */
            .ds-drink-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 7px; }
            .ds-drink-pill {
                background: var(--card-subtle); border: 1px solid var(--card-border); color: var(--text-on-card);
                padding: 4.5px 4px; border-radius: 9px; font-size: 11px; cursor: pointer; text-align: center;
                white-space: nowrap; transition: all 0.16s;
            }
            .ds-drink-pill:hover { background: var(--card-subtle-hover); }
            .ds-drink-pill.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); font-weight: 600; }

            .ds-sub-bar {
                display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
                background: var(--card-input-bg); border: 1px solid var(--card-border);
                border-radius: 10px; padding: 5px 6px; margin-bottom: 7px;
            }
            .ds-temp-btn {
                padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
                border: 1px solid rgba(56, 189, 248, 0.45); background: rgba(56, 189, 248, 0.16); color: #bae6fd;
                cursor: pointer; white-space: nowrap; transition: all 0.15s;
            }
            .ds-temp-btn.warm { border-color: rgba(251, 146, 60, 0.5); background: rgba(251, 146, 60, 0.18); color: #fed7aa; }
            .ds-flav-chip {
                padding: 2px 6.5px; border-radius: 999px; font-size: 10.5px;
                background: var(--card-subtle); border: 1px solid transparent; color: var(--text-muted-on-card);
                cursor: pointer; white-space: nowrap; transition: all 0.14s;
            }
            .ds-flav-chip:hover { color: var(--text-on-card); background: var(--card-subtle-hover); }
            .ds-flav-chip.active { background: rgba(217, 119, 6, 0.24); border-color: var(--accent); color: var(--text-on-card); font-weight: 600; }

            .ds-drink-meter { display: flex; align-items: center; gap: 6px; }
            .ds-bar-track { flex: 1; height: 8px; border-radius: 999px; background: var(--card-input-bg); overflow: hidden; border: 1px solid var(--card-border); }
            .ds-bar-fill { height: 100%; border-radius: 999px; transition: width 0.28s cubic-bezier(0.22, 1, 0.36, 1), background 0.25s; }
            .ds-mini-act {
                background: var(--card-subtle); border: 1px solid var(--card-border); color: var(--text-on-card);
                padding: 3px 8px; border-radius: 999px; font-size: 10.5px; cursor: pointer; white-space: nowrap; transition: all 0.16s;
            }
            .ds-mini-act:hover { border-color: var(--accent); background: var(--card-subtle-hover); }

            .ds-input {
                width: 100%; background: var(--card-input-bg); border: 1px solid var(--card-border);
                color: var(--text-on-card); padding: 5px 8px; border-radius: 8px; font-size: 11px; outline: none; margin-bottom: 6px;
            }
            .ds-input:focus { border-color: var(--accent); }
            .ds-san-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px; }
            .ds-san-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }

            .ds-fortune-draw-btn {
                width: 100%; padding: 13px 10px; border-radius: 12px; border: 1px dashed var(--accent);
                background: var(--card-subtle); color: var(--text-on-card); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.2s;
            }
            .ds-fortune-draw-btn:hover { background: var(--accent); color: var(--text-on-accent); border-style: solid; }
            .ds-fortune-box { background: var(--card-subtle); border: 1px solid var(--card-border); border-radius: 11px; padding: 8px 10px; font-size: 11.5px; line-height: 1.5; }
            .ds-fortune-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
            .ds-fortune-lv { font-size: 14px; font-weight: 800; color: var(--accent); }

            .ds-ddl-row { display: grid; grid-template-columns: 1.25fr 1fr; gap: 6px; margin-bottom: 7px; }
            .ds-ddl-row .ds-input { margin-bottom: 0; padding: 5px 7px; font-size: 11px; }
            .ds-ddl-banner { display: flex; justify-content: space-between; align-items: baseline; background: var(--card-subtle); border: 1px solid var(--card-border); border-radius: 10px; padding: 6px 10px; font-size: 11.5px; }
            .ds-ddl-num { font-size: 18px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }

            /* 🌌 深度专注极简模式 */
            body.zen-focus-mode .top-bar,
            body.zen-focus-mode .left-desk-column,
            body.zen-focus-mode .right-panel,
            body.zen-focus-mode .desk-stat-card,
            body.zen-focus-mode .desk-mood-card,
            body.zen-focus-mode .desk-todo-card,
            body.zen-focus-mode .book-widget,
            body.zen-focus-mode .duration-pills { display: none !important; }
            body.zen-focus-mode .workspace { grid-template-columns: 1fr !important; align-items: center; justify-items: center; }
            body.zen-focus-mode .focus-dashboard { min-height: calc(100vh - 36px); justify-content: center; padding-bottom: 0; }
            body.zen-focus-mode.zen-hide-widget #vproWidgetStage,
            body.zen-focus-mode.zen-hide-widget #iosWidget { display: none !important; }

            .zen-floating-hud {
                position: fixed; top: 14px; left: 50%; transform: translateX(-50%) translateY(-10px);
                z-index: 165; display: none; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center;
                padding: 5px 10px; border-radius: 999px; background: rgba(20, 19, 22, 0.52);
                backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.14);
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35); opacity: 0.48;
                transition: opacity 0.25s ease, background 0.25s ease, transform 0.25s ease; max-width: calc(100vw - 24px);
            }
            body.zen-focus-mode .zen-floating-hud { display: inline-flex; transform: translateX(-50%) translateY(0); }
            .zen-floating-hud:hover, .zen-floating-hud:focus-within { opacity: 1; background: rgba(20, 19, 22, 0.86); }
            @media (max-width: 768px) { .zen-floating-hud { opacity: 0.85; } }
            .zen-hud-btn {
                background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.16);
                color: #f5f5f4; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; cursor: pointer; white-space: nowrap; transition: all 0.16s;
            }
            .zen-hud-btn:hover { background: rgba(255, 255, 255, 0.2); border-color: var(--accent); }
            .zen-hud-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); font-weight: 600; }
            .zen-hud-chk { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #d6d3d1; padding: 0 4px; cursor: pointer; white-space: nowrap; }
            .zen-hud-chk input { width: 13px; height: 13px; accent-color: var(--accent); cursor: pointer; }
        `;
        document.head.appendChild(style);
    }

    function renderCurrentCardInner() {
        const key = CARD_DEFS[state.activeIdx % CARD_DEFS.length].key;

        if (key === 'weather') {
            const w = state.weather;
            const isLive = w.mode !== 'custom';
            const tabsHtml = `
                <div class="ds-w-mode-row">
                    <button type="button" class="ds-w-tab ${isLive ? 'active' : ''}" onclick="window.DeskStack.setWeatherMode('live')">🌍 实况城市</button>
                    <button type="button" class="ds-w-tab ${!isLive ? 'active' : ''}" onclick="window.DeskStack.setWeatherMode('custom')">✨ 梦境自定</button>
                </div>
            `;

            if (isLive) {
                const heroHtml = weatherFetching
                    ? `<div class="ds-w-hero"><div class="ds-w-left"><span class="ds-w-icon">🛰️</span><div><div class="ds-w-sub" style="margin:0;">正在连线「${esc(w.cityQuery)}」气象台...</div></div></div></div>`
                    : (w.liveTemp !== null
                        ? `<div class="ds-w-hero">
                            <div class="ds-w-left">
                                <span class="ds-w-icon">${esc(w.liveIcon)}</span>
                                <div style="min-width:0;">
                                    <div class="ds-w-temp">${w.liveTemp}°C <span style="font-size:12px;font-weight:500;">${esc(w.liveDesc)}</span></div>
                                    <div class="ds-w-sub">${esc(w.liveCity || w.cityQuery)} · 体感 ${w.liveFeels}° · 湿 ${w.liveHumidity}%</div>
                                </div>
                            </div>
                            <button type="button" class="ds-mini-act" style="padding:3px 7px;" onclick="window.DeskStack.refreshWeather()" title="重新获取实时天气">🔄</button>
                        </div>`
                        : `<div class="ds-w-hero"><div class="ds-w-sub" style="margin:0;">输入任意城市名（如 东京 / 北京 / 伦敦）点 🔍 查看实况～</div></div>`);

                return `
                    ${tabsHtml}
                    <div class="ds-w-search-row">
                        <input class="ds-input" id="dsWeatherCityInput" maxlength="20" value="${esc(w.cityQuery)}" placeholder="输入城市名（如 东京 / 伦敦）" onkeydown="if(event.key==='Enter') window.DeskStack.searchCityWeather()">
                        <button type="button" class="ds-mini-act" style="border-radius:8px;padding:0 10px;" onclick="window.DeskStack.searchCityWeather()">🔍</button>
                    </div>
                    ${heroHtml}
                    ${weatherError ? `<div style="font-size:10.5px;color:#fca5a5;margin-top:4px;">⚠️ ${esc(weatherError)}</div>` : ''}
                `;
            }

            // ✨ 梦境/赛博自定模式（填任意地名 + 氛围 + 温度！）
            return `
                ${tabsHtml}
                <div class="ds-w-custom-top">
                    <input class="ds-input" maxlength="16" value="${esc(w.customCity)}" placeholder="地名（如 希望之峰 / 横滨）" oninput="window.DeskStack.setCustomWeatherCity(this.value)">
                    <input class="ds-input" type="number" min="-30" max="50" value="${w.customTemp}" title="自定义温度 (°C)" oninput="window.DeskStack.setCustomWeatherTemp(this.value)">
                </div>
                <div class="ds-w-vibe-grid">
                    ${CYBER_WEATHERS.map(cw => `
                        <button type="button" class="ds-w-vibe-btn ${w.customDesc === cw.label ? 'active' : ''}" onclick="window.DeskStack.pickCustomWeather('${cw.icon}','${cw.label}')">${cw.icon} ${cw.label}</button>
                    `).join('')}
                </div>
                <div id="dsCustomWeatherPreview" style="font-size:11px;color:var(--text-muted-on-card);text-align:center;">
                    ${esc(w.customIcon)} 窗外正处于「${esc(w.customCity || '未知坐标')} · ${esc(w.customDesc)} ${w.customTemp}°C」
                </div>
            `;
        }

        if (key === 'drink') {
            const cat = getCurrentDrinkCat();
            const isWarm = state.drinkTemp === '热' || state.drinkTemp === '温';
            const tempLabel = isWarm ? `🔥 ${state.drinkTemp}` : `🧊 ${state.drinkTemp}`;
            const isCustom = state.drinkFlavor === '自定义';
            const customVal = state.drinkCustomMap[cat.id] || '';
            const isEmpty = state.drinkLevel <= 0;
            const curLabel = getCurrentDrinkDisplayName();

            return `
                <div class="ds-drink-grid">
                    ${DRINK_CATS.map(d => `
                        <button type="button" class="ds-drink-pill ${d.id === state.drinkCat ? 'active' : ''}" onclick="window.DeskStack.pickDrinkCat('${d.id}')">
                            ${d.icon} ${d.name}
                        </button>
                    `).join('')}
                </div>
                <div class="ds-sub-bar">
                    <button type="button" class="ds-temp-btn ${isWarm ? 'warm' : ''}" onclick="window.DeskStack.toggleDrinkTemp()" title="点击切换冷/热">${tempLabel}</button>
                    ${cat.flavors.map(fl => `
                        <button type="button" class="ds-flav-chip ${state.drinkFlavor === fl ? 'active' : ''}" onclick="window.DeskStack.pickDrinkFlavor('${esc(fl)}')">${fl === '自定义' ? '✏️自定义' : esc(fl)}</button>
                    `).join('')}
                </div>
                ${isCustom ? `<input class="ds-input" id="dsCustomDrinkInput" maxlength="16" value="${esc(customVal)}" placeholder="${esc(cat.placeholder)}" oninput="window.DeskStack.setCustomDrink(this.value)">` : ''}
                <div class="ds-drink-meter">
                    <span id="dsCurrentDrinkLabel" style="font-size:11px;font-weight:600;color:var(--text-on-card);max-width:74px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(curLabel)}">${esc(curLabel)}</span>
                    <div class="ds-bar-track" title="剩余 ${state.drinkLevel}%">
                        <div class="ds-bar-fill" style="width:${state.drinkLevel}%;background:${cat.color};"></div>
                    </div>
                    <button type="button" class="ds-mini-act" onclick="window.DeskStack.sipOrRefill()">
                        ${isEmpty ? '✨ 续杯' : `${cat.icon} 喝一口`}
                    </button>
                </div>
            `;
        }

        if (key === 'san') {
            const info = getSanDescriptor(state.san);
            return `
                <input class="ds-input" id="dsQuestInput" maxlength="24" value="${esc(state.quest)}" placeholder="此刻正在肝什么副本？" oninput="window.DeskStack.setQuest(this.value)">
                <div class="ds-san-head">
                    <span style="color:var(--text-muted-on-card);">SAN 值：<strong id="dsSanLabel" style="color:${info.color};">${info.label}</strong></span>
                    <span id="dsSanNum" style="font-weight:700;color:${info.color};font-variant-numeric:tabular-nums;">${state.san}%</span>
                </div>
                <input type="range" class="ds-san-slider" min="0" max="100" step="1" value="${state.san}" oninput="window.DeskStack.setSan(this.value)">
            `;
        }

        if (key === 'fortune') {
            const today = getTodayStr();
            const drawn = state.fortuneDate === today && state.fortuneIdx >= 0 && FORTUNES[state.fortuneIdx];
            if (!drawn) {
                return `<button type="button" class="ds-fortune-draw-btn" onclick="window.DeskStack.drawFortune()">🎋 点击摇一签今日自习运势</button>`;
            }
            const f = FORTUNES[state.fortuneIdx];
            return `
                <div class="ds-fortune-box">
                    <div class="ds-fortune-top">
                        <span><span class="ds-fortune-lv">${esc(f.level)}</span> · ${esc(f.tag)}</span>
                        <button type="button" class="ds-mini-act" style="padding:1px 7px;font-size:10.5px;" onclick="window.DeskStack.drawFortune()">重摇</button>
                    </div>
                    <div style="opacity:0.9;">✅ 宜：${esc(f.yi)}</div>
                    <div style="opacity:0.76;">🚫 忌：${esc(f.ji)}</div>
                </div>
            `;
        }

        if (key === 'ddl') {
            const diff = calcDdlDays(state.ddlDate);
            let statusHtml = `<span style="opacity:0.75;">选个日期开启倒计时</span>`;
            if (diff !== null) {
                if (diff > 0) statusHtml = `<span>距离目标还有</span><span><span class="ds-ddl-num">${diff}</span> 天</span>`;
                else if (diff === 0) statusHtml = `<span>就是今天！！</span><span class="ds-ddl-num" style="font-size:15px;">冲鸭🔥</span>`;
                else statusHtml = `<span>已过去</span><span><span class="ds-ddl-num">${Math.abs(diff)}</span> 天</span>`;
            }
            return `
                <div class="ds-ddl-row">
                    <input class="ds-input" maxlength="16" value="${esc(state.ddlTitle)}" placeholder="目标名（如答辩）" oninput="window.DeskStack.setDdlTitle(this.value)">
                    <input class="ds-input" type="date" value="${esc(state.ddlDate)}" onchange="window.DeskStack.setDdlDate(this.value)">
                </div>
                <div class="ds-ddl-banner">${statusHtml}</div>
            `;
        }

        return `
            <div class="desk-mood-chips">
                ${MOODS.map(m => {
                    const plain = m.label.replace(/^[^\s]+\s*/, '');
                    return `<button type="button" class="desk-mood-chip ${state.mood === plain ? 'active' : ''}" onclick="window.DeskStack.setMood('${esc(plain)}')">${m.label}</button>`;
                }).join('')}
            </div>
        `;
    }

    function renderStackCard() {
        const card = document.querySelector('.desk-mood-card');
        if (!card) return;
        const idx = ((state.activeIdx % CARD_DEFS.length) + CARD_DEFS.length) % CARD_DEFS.length;
        state.activeIdx = idx;
        const def = CARD_DEFS[idx];

        card.innerHTML = `
            <div class="desk-stack-head">
                <span class="desk-stack-title">${def.title}</span>
                <div class="desk-stack-nav">
                    <button type="button" class="desk-stack-arrow" onclick="window.DeskStack.shiftCard(-1)" title="上一张卡片">‹</button>
                    <div class="desk-stack-dots">
                        ${CARD_DEFS.map((c, i) => `<span class="desk-stack-dot ${i === idx ? 'active' : ''}" onclick="window.DeskStack.jumpCard(${i})" title="${c.title}"></span>`).join('')}
                    </div>
                    <button type="button" class="desk-stack-arrow" onclick="window.DeskStack.shiftCard(1)" title="下一张卡片">›</button>
                </div>
            </div>
            <div class="desk-stack-body">${renderCurrentCardInner()}</div>
        `;

        if (!card.dataset.stackSwipeBound) {
            card.dataset.stackSwipeBound = '1';
            let sx = 0, sy = 0;
            card.addEventListener('touchstart', (e) => {
                if (e.target.closest('input, button') || e.touches.length !== 1) return;
                sx = e.touches[0].clientX; sy = e.touches[0].clientY;
            }, { passive: true });
            card.addEventListener('touchend', (e) => {
                if (!sx || e.changedTouches.length !== 1) return;
                const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
                sx = 0; sy = 0;
                if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3) shiftCard(dx < 0 ? 1 : -1);
            }, { passive: true });
        }
    }

    // 天气交互
    function setWeatherMode(mode) {
        state.weather.mode = mode === 'custom' ? 'custom' : 'live';
        saveStackState();
        renderStackCard();
        if (state.weather.mode === 'live' && state.weather.liveTemp === null) {
            fetchLiveWeather(state.weather.cityQuery, false);
        }
    }
    function searchCityWeather() {
        const inp = document.getElementById('dsWeatherCityInput');
        const q = (inp?.value || state.weather.cityQuery || '').trim();
        if (q) fetchLiveWeather(q, true);
    }
    function refreshWeather() { fetchLiveWeather(state.weather.cityQuery, true); }
    function updateCustomWeatherPreview() {
        const el = document.getElementById('dsCustomWeatherPreview');
        if (!el) return;
        const w = state.weather;
        el.innerText = `${w.customIcon} 窗外正处于「${w.customCity || '未知坐标'} · ${w.customDesc} ${w.customTemp}°C」`;
    }
    function setCustomWeatherCity(val) { state.weather.customCity = String(val || '').slice(0, 16); saveStackState(); updateCustomWeatherPreview(); }
    function setCustomWeatherTemp(val) {
        const n = parseInt(val, 10);
        if (!isNaN(n)) state.weather.customTemp = Math.max(-30, Math.min(50, n));
        saveStackState();
        updateCustomWeatherPreview();
    }
    function pickCustomWeather(icon, label) {
        state.weather.customIcon = icon;
        state.weather.customDesc = label;
        saveStackState();
        renderStackCard();
    }

    function shiftCard(delta) { state.activeIdx = (state.activeIdx + delta + CARD_DEFS.length) % CARD_DEFS.length; saveStackState(); renderStackCard(); }
    function jumpCard(idx) { state.activeIdx = idx; saveStackState(); renderStackCard(); }

    function pickDrinkCat(catId) {
        const cat = DRINK_CATS.find(c => c.id === catId) || DRINK_CATS[0];
        state.drinkCat = cat.id;
        state.drinkTemp = cat.defaultTemp;
        state.drinkFlavor = cat.flavors[0];
        if (state.drinkLevel <= 0) state.drinkLevel = 100;
        saveStackState();
        renderStackCard();
    }
    function toggleDrinkTemp() {
        const cat = getCurrentDrinkCat();
        const curIdx = cat.temps.indexOf(state.drinkTemp);
        state.drinkTemp = cat.temps[(curIdx + 1) % cat.temps.length];
        saveStackState();
        renderStackCard();
    }
    function pickDrinkFlavor(fl) {
        state.drinkFlavor = fl;
        saveStackState();
        renderStackCard();
        if (fl === '自定义') setTimeout(() => document.getElementById('dsCustomDrinkInput')?.focus(), 30);
    }
    function setCustomDrink(val) {
        state.drinkCustomMap[state.drinkCat] = String(val || '').slice(0, 16);
        saveStackState();
        const lbl = document.getElementById('dsCurrentDrinkLabel');
        if (lbl) { const name = getCurrentDrinkDisplayName(); lbl.innerText = name; lbl.title = name; }
    }
    function sipOrRefill() {
        if (state.drinkLevel <= 0) { state.drinkLevel = 100; state.drinkRefills = (state.drinkRefills || 0) + 1; }
        else { state.drinkLevel = Math.max(0, state.drinkLevel - 20); }
        saveStackState();
        renderStackCard();
    }

    function setQuest(val) { state.quest = String(val || '').slice(0, 24); saveStackState(); }
    function setSan(val) {
        const n = parseInt(val, 10);
        state.san = isNaN(n) ? 50 : Math.max(0, Math.min(100, n));
        saveStackState();
        const info = getSanDescriptor(state.san);
        const lbl = document.getElementById('dsSanLabel');
        const num = document.getElementById('dsSanNum');
        if (lbl) { lbl.innerText = info.label; lbl.style.color = info.color; }
        if (num) { num.innerText = `${state.san}%`; num.style.color = info.color; }
    }
    function drawFortune() {
        state.fortuneDate = getTodayStr();
        let next = Math.floor(Math.random() * FORTUNES.length);
        if (next === state.fortuneIdx && FORTUNES.length > 1) next = (next + 1) % FORTUNES.length;
        state.fortuneIdx = next;
        saveStackState();
        renderStackCard();
    }
    function setDdlTitle(val) { state.ddlTitle = String(val || '').slice(0, 16); saveStackState(); }
    function setDdlDate(val) { state.ddlDate = String(val || ''); saveStackState(); renderStackCard(); }
    function setMood(m) { state.mood = m; saveStackState(); renderStackCard(); }

    function hookDeskSummary() {
        const origGetDeskSummary = window.getDeskSummary;
        window.getDeskSummary = function () {
            const origStr = typeof origGetDeskSummary === 'function' ? origGetDeskSummary() : '';
            const parts = [];

            // 🌦️ 窗外天气优先注入上下文！
            const w = state.weather;
            if (w.mode === 'custom') {
                parts.push(`窗外天气：${w.customCity || '窗外'} ${w.customDesc} ${w.customTemp}°C`);
            } else if (w.liveTemp !== null) {
                parts.push(`窗外天气：${w.liveCity || w.cityQuery} ${w.liveDesc} ${w.liveTemp}°C`);
            }

            const drinkName = getCurrentDrinkDisplayName();
            const sanInfo = getSanDescriptor(state.san);
            parts.push(`桌面补给：${drinkName}(余${state.drinkLevel}%)`);
            if (state.quest && state.quest.trim()) {
                parts.push(`当前副本「${state.quest.trim()}」(SAN值${state.san}%·${sanInfo.label.replace(/[^\u4e00-\u9fa5]/g, '')})`);
            }
            if (state.fortuneDate === getTodayStr() && FORTUNES[state.fortuneIdx]) {
                const f = FORTUNES[state.fortuneIdx];
                parts.push(`今日抽签「${f.level}·${f.tag}」`);
            }
            const ddlDays = calcDdlDays(state.ddlDate);
            if (ddlDays !== null && ddlDays >= 0 && state.ddlTitle.trim()) {
                parts.push(`倒计时「${state.ddlTitle.trim()}」还剩${ddlDays}天`);
            }
            return [parts.join('，'), origStr].filter(Boolean).join('；');
        };
    }

    function applyZenUI() {
        document.body.classList.toggle('zen-focus-mode', isZenMode);
        document.body.classList.toggle('zen-hide-widget', isZenMode && zenPrefs.hideWidgetInZen);
        const wBtn = document.getElementById('zenWidgetToggleBtn');
        if (wBtn) wBtn.innerText = zenPrefs.hideWidgetInZen ? '🖼️ 显示相框' : '🖼️ 隐藏相框';
        const autoChk = document.getElementById('zenAutoChk');
        if (autoChk) autoChk.checked = Boolean(zenPrefs.autoZen);
    }

    function setZenMode(enabled) {
        isZenMode = Boolean(enabled);
        if (isZenMode && typeof collapseReader === 'function') collapseReader();
        applyZenUI();
    }
    function toggleZenMode() { setZenMode(!isZenMode); }
    function toggleZenWidget() { zenPrefs.hideWidgetInZen = !zenPrefs.hideWidgetInZen; saveZenPrefs(); applyZenUI(); }
    function toggleAutoZen(checked) { zenPrefs.autoZen = Boolean(checked); saveZenPrefs(); applyZenUI(); }

    function mountZenUI() {
        const btnGroup = document.querySelector('#focusDashboard .btn-group');
        if (btnGroup && !document.getElementById('zenEnterBtn')) {
            const btn = document.createElement('button');
            btn.id = 'zenEnterBtn';
            btn.type = 'button';
            btn.className = 'btn btn-secondary';
            btn.innerText = '🌌 沉浸';
            btn.title = '进入深度专注极简态（淡出杂项，只留壁纸与时钟）';
            btn.onclick = () => toggleZenMode();
            btnGroup.appendChild(btn);
        }

        if (!document.getElementById('zenFloatingHud')) {
            const hud = document.createElement('div');
            hud.id = 'zenFloatingHud';
            hud.className = 'zen-floating-hud';
            hud.innerHTML = `
                <button type="button" class="zen-hud-btn primary" onclick="window.DeskStack.setZenMode(false)">✨ 退出沉浸</button>
                <button type="button" class="zen-hud-btn" id="zenWidgetToggleBtn" onclick="window.DeskStack.toggleZenWidget()">🖼️ 隐藏相框</button>
                <button type="button" class="zen-hud-btn ai-only" onclick="toggleChatDrawer()">✉️ 通讯</button>
                <label class="zen-hud-chk" title="开启后每次点击开始专注自动进入极简沉浸模式">
                    <input type="checkbox" id="zenAutoChk" onchange="window.DeskStack.toggleAutoZen(this.checked)">
                    <span>专注自动沉浸</span>
                </label>
            `;
            document.body.appendChild(hud);
        }

        if (typeof window.startMainTimerLoop === 'function') {
            const orig = window.startMainTimerLoop;
            window.startMainTimerLoop = function () {
                const ret = orig.apply(this, arguments);
                if (zenPrefs.autoZen) setZenMode(true);
                return ret;
            };
        }
        if (typeof window.completeFocusNaturally === 'function') {
            const orig = window.completeFocusNaturally;
            window.completeFocusNaturally = async function () {
                if (zenPrefs.autoZen && isZenMode) setZenMode(false);
                return orig.apply(this, arguments);
            };
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isZenMode && !document.querySelector('.modal-backdrop.open')) setZenMode(false);
        });
        applyZenUI();
    }

    function bootStackWhenReady() {
        const tryMount = () => {
            if (document.querySelector('.desk-mood-card')) {
                renderStackCard();
                if (state.weather.mode === 'live') {
                    fetchLiveWeather(state.weather.cityQuery, false);
                }
                return true;
            }
            return false;
        };
        if (tryMount()) return;
        const mountEl = document.getElementById('deskWidgetsMount');
        if (mountEl) {
            const obs = new MutationObserver(() => { if (tryMount()) obs.disconnect(); });
            obs.observe(mountEl, { childList: true, subtree: true });
        }
        setTimeout(tryMount, 400);
    }

    window.DeskStack = {
        shiftCard, jumpCard,
        setWeatherMode, searchCityWeather, refreshWeather,
        setCustomWeatherCity, setCustomWeatherTemp, pickCustomWeather,
        pickDrinkCat, toggleDrinkTemp, pickDrinkFlavor, setCustomDrink, sipOrRefill,
        setQuest, setSan, drawFortune, setDdlTitle, setDdlDate, setMood,
        setZenMode, toggleZenMode, toggleZenWidget, toggleAutoZen
    };

    injectStyles();
    hookDeskSummary();
    mountZenUI();
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bootStackWhenReady);
    else bootStackWhenReady();
})();