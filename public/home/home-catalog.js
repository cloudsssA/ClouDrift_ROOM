// public/home/home-catalog.js
// ClouDrift 2D XY Pixel Home — 32px 贴图热覆盖管理器、全景窗景/墙地皮肤与内置像素兜底库

(function (global) {
    'use strict';

    const WINDOW_SKINS = {
        window_clouds_day: {
            id: 'window_clouds_day',
            name: '晴空蓬松白云窗',
            price: 0,
            desc: '宫崎骏式蓝天蓬松白云，经典治愈'
        },
        window_stream_day: {
            id: 'window_stream_day',
            name: '阳光绿野溪流窗',
            price: 120,
            desc: '窗外是小溪流淌与野花草地，满屏生机'
        },
        window_blinds_moon: {
            id: 'window_blinds_moon',
            name: '深夜百叶窗星月夜',
            price: 150,
            desc: '半拉百叶窗配弯月星夜与暗紫云层'
        },
        window_city_night: {
            id: 'window_city_night',
            name: '赛博紫夜城市落地窗',
            price: 180,
            desc: '摩天大楼霓虹天际线，暗紫/哥特房绝杀'
        }
    };

    const WALL_SKINS = {
        wall_cream: {
            id: 'wall_cream', name: '奶油燕麦墙', price: 0,
            base: '#f1e7d5', accent: '#e6d8c0', wainscot: '#dfd0b8', wainscotDark: '#cab79a', trim: '#bca482', pattern: 'dots'
        },
        wall_warm_wood: {
            id: 'wall_warm_wood', name: '日系原木护墙板', price: 120,
            base: '#c9935f', accent: '#b37d4a', wainscot: '#a36e3f', wainscotDark: '#87572d', trim: '#6e4421', pattern: 'wood'
        },
        wall_gothic_crimson: {
            id: 'wall_gothic_crimson', name: '暗红丝绒哥特壁纸', price: 180,
            base: '#611c27', accent: '#4c131d', wainscot: '#2f1c19', wainscotDark: '#211310', trim: '#cba152', pattern: 'stripes'
        },
        wall_cyber_lavender: {
            id: 'wall_cyber_lavender', name: '暗紫雾霭公寓墙', price: 170,
            base: '#3d364d', accent: '#312b3f', wainscot: '#272233', wainscotDark: '#1c1826', trim: '#6e5f8a', pattern: 'stripes'
        }
    };

    const FLOOR_SKINS = {
        floor_warm_wood: {
            id: 'floor_warm_wood', name: '浅橡木拼花地板', price: 0,
            a: '#d9b586', b: '#d0a978', plankLine: '#b48a5b', highlight: '#e7caa0', style: 'planks'
        },
        floor_dark_walnut: {
            id: 'floor_dark_walnut', name: '深胡桃木人字拼', price: 160,
            a: '#5f3e2a', b: '#523422', plankLine: '#382114', highlight: '#734e37', style: 'herringbone'
        },
        floor_cream_checker: {
            id: 'floor_cream_checker', name: '奶油棋盘格砖', price: 140,
            a: '#f3ebdc', b: '#dac4a5', plankLine: '#bfa889', highlight: '#fcf8f0', style: 'checker'
        },
        floor_slate_purple: {
            id: 'floor_slate_purple', name: '暗紫灰木纹地板', price: 160,
            a: '#484354', b: '#413c4c', plankLine: '#2d2936', highlight: '#5a5469', style: 'planks'
        }
    };

    // ---------- 外部 PNG 贴图热加载器（自动接管 public/home/sprites/*.png！） ----------
    const spriteCache = new Map();
    const externalSprites = new Map(); // id -> { url, img, loaded }
    const diyImageCache = new Map();   // url -> { img, loaded, pixelCanvas }
    const thumbCache = new Map();
    let onAssetLoadedCb = null;

    function setAssetLoadedCallback(cb) {
        onAssetLoadedCb = cb;
    }

    function registerExternalSprites(spriteMap = {}) {
        Object.entries(spriteMap).forEach(([id, url]) => {
            const cur = externalSprites.get(id);
            if (cur && cur.url === url) return;
            const img = new Image();
            const entry = { url, img, loaded: false };
            externalSprites.set(id, entry);
            img.onload = () => {
                entry.loaded = true;
                thumbCache.delete(id);
                if (onAssetLoadedCb) onAssetLoadedCb(id);
            };
            img.src = url;
        });
    }

    function getExternalImage(id) {
        const entry = externalSprites.get(id);
        return (entry && entry.loaded) ? entry.img : null;
    }

    function getDiyImage(url, pixelated = false) {
        if (!url) return null;
        let entry = diyImageCache.get(url);
        if (!entry) {
            const img = new Image();
            entry = { img, loaded: false, pixelCanvas: null };
            diyImageCache.set(url, entry);
            img.onload = () => {
                entry.loaded = true;
                // 预生成复古 28px 像素化版本，一键变身真像素痛画！
                const pc = document.createElement('canvas');
                const maxSide = 28;
                const ratio = Math.min(maxSide / img.width, maxSide / img.height);
                pc.width = Math.max(8, Math.round(img.width * ratio));
                pc.height = Math.max(8, Math.round(img.height * ratio));
                const pctx = pc.getContext('2d');
                pctx.imageSmoothingEnabled = false;
                pctx.drawImage(img, 0, 0, pc.width, pc.height);
                entry.pixelCanvas = pc;
                if (onAssetLoadedCb) onAssetLoadedCb(url);
            };
            img.src = url;
        }
        if (!entry.loaded) return null;
        return pixelated ? (entry.pixelCanvas || entry.img) : entry.img;
    }

    function compilePixelSprite(cacheKey, palette, rows) {
        if (spriteCache.has(cacheKey)) return spriteCache.get(cacheKey);
        const h = rows.length;
        const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        for (let y = 0; y < h; y++) {
            const row = rows[y];
            for (let x = 0; x < row.length; x++) {
                const ch = row[x];
                if (ch === '.' || ch === ' ') continue;
                const col = palette[ch];
                if (!col) continue;
                ctx.fillStyle = col;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        spriteCache.set(cacheKey, c);
        return c;
    }

    // ---------- 家具图鉴（有外部 PNG 时自动优先用 PNG，没放图时无缝用内置像素精灵兜底） ----------
    const ITEMS = {
        curtain_sheer: {
            id: 'curtain_sheer', name: '微风白纱窗帘', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 80,
            desc: '挂在墙面或窗边的柔光白纱窗帘',
            palette: { O: '#4a3525', R: '#9c734e', W: '#fffaf0', S: '#ebe0ce', G: '#d8b272' },
            pixels: ['ORRRRRRRRRRRRRRO', '.OWWWSS..SSWWWO.', '.OWWSWW..WWSWWO.', '.OWWWSS..SSWWWO.', '.OWWSWW..WWSWWO.', '.OWWWSS..SSWWWO.', '.OGGGGG..GGGGGO.', '..OWWSS..SSWWO..', '.OWWSSW..WSSWWO.', '.OWWSWW..WWSWWO.', '.OWWWSS..SSWWWO.', '.OWWSWW..WWSWWO.', '.OWWWSS..SSWWWO.', '.OSSSSO..OSSSSO.', '..OOOO....OOOO..']
        },
        shelf_wall_books: {
            id: 'shelf_wall_books', name: '壁挂迷你书架', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 90,
            desc: '塞满精装外文书与垂吊绿植的壁架',
            palette: { O: '#362319', W: '#b68050', D: '#8c5c34', R: '#c03946', B: '#356a75', Y: '#e3bd64', P: '#d4744e', G: '#4d9b58', L: '#75c47b' },
            pixels: ['................', '..OO.OO..OO.....', '.ORROBB.OYYO.LL.', '.ORROBB.OYYOGGLG', '.ORROBB.OYYO.GG.', '.ORROBB.OYYOOPPO', '.ORROBB.OYYOOPPO', 'OWWWWWWWWWWWWWWO', 'ODDDDDDDDDDDDDDO', '.OOD........DOO.', '..O..........G..', '.............LG.', '..............G.', '................']
        },
        tapestry_star: {
            id: 'tapestry_star', name: '星月织锦挂毯', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 110,
            desc: '深蓝描金星月挂毯，深夜氛围感拉满',
            palette: { O: '#231b2e', G: '#e7c163', N: '#1e2a54', B: '#2e3f7a', Y: '#fff3b8' },
            pixels: ['OGGGGGGGGGGGGGGO', '.ONNNNNNNNNNNNO.', '.ONBBBBBBBBBBNO.', '.ONB.Y..GG..BNO.', '.ONB...GGB..BNO.', '.ONB..GGB...BNO.', '.ONB..GGB.Y.BNO.', '.ONB...GG...BNO.', '.ONB.Y....Y.BNO.', '.ONBBBBBBBBBBNO.', '.ONGGGGGGGGGGNO.', '..ONNNNNNNNNNO..', '...OG.OG.OG.O...', '...O..O..O..O...']
        },
        rug_persian: {
            id: 'rug_persian', name: '酒红复古波斯地毯', category: 'rug', layer: 'rug', width: 2, depth: 2, price: 130,
            desc: '暗红金边流苏波斯绒毯，复古书房灵魂',
            palette: { O: '#3a1016', R: '#8a1f2d', D: '#651420', G: '#e2bc67', C: '#b83242', F: '#ede0c8' },
            pixels: ['..OOOOOOOOOOOOOOOOOOOOOOOOOOOO..', 'FFOGGGGGGGGGGGGGGGGGGGGGGGGGGOFF', '..OGRRRRRRRRRRRRRRRRRRRRRRRRGO..', 'FFOGRDDDDDDDDDDDDDDDDDDDDDDRGOFF', '..OGRDGGGGGGGGGGGGGGGGGGGGDRGO..', 'FFOGRDGCCCCCCCCCCCCCCCCCCGDRGOFF', '..OGRDGC......GG......CGDRGO....'.slice(0, 32), 'FFOGRDGC.....GGGG.....CGDRGOFF..'.slice(0, 32), '..OGRDGC....GCCCCG....CGDRGO....'.slice(0, 32), 'FFOGRDGC...GCRRRRCG...CGDRGOFF..'.slice(0, 32), '..OGRDGC...GCRGGCRG...CGDRGO....'.slice(0, 32), 'FFOGRDGC...GCRGGCRG...CGDRGOFF..'.slice(0, 32), '..OGRDGC...GCRRRRCG...CGDRGO....'.slice(0, 32), 'FFOGRDGC....GCCCCG....CGDRGOFF..'.slice(0, 32), '..OGRDGC.....GGGG.....CGDRGO....'.slice(0, 32), 'FFOGRDGCCCCCCCCCCCCCCCCCCGDRGOFF', '..OGRDGGGGGGGGGGGGGGGGGGGGDRGO..', 'FFOGRDDDDDDDDDDDDDDDDDDDDDDRGOFF', '..OGRRRRRRRRRRRRRRRRRRRRRRRRGO..', 'FFOGGGGGGGGGGGGGGGGGGGGGGGGGGOFF', '..OOOOOOOOOOOOOOOOOOOOOOOOOOOO..']
        },
        rug_cloud: {
            id: 'rug_cloud', name: '软绵绵云朵地毯', category: 'rug', layer: 'rug', width: 2, depth: 2, price: 110,
            desc: '像踩在刚烤好的舒芙蕾上的纯白绒毯',
            palette: { O: '#b5a795', W: '#fffdf9', C: '#f5ede0', S: '#e5dac8' },
            pixels: ['..........OOOOOO................', '........OOWWWWWWO....OOOOO......', '.......OWWWWWWWWWO..OWWWWWO.....', '....OOOWWWWWWWWWWWOWWWWWWWWO....', '..OOWWWWWWWWWWWWWWWWWWWWWWWWO...', '.OWWWWWWWWWWWWWWWWWWWWWWWWWWWOO.', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OWCWWWWWWWWWWWWWWWWWWWWWWWWWWCWO', 'OWCCWWWWWWWWWWWWWWWWWWWWWWWWCCWO', 'OSCCCWWWWWWWWWWWWWWWWWWWWWWCCCSO', '.OSCCCCWWWWWWWWWWWWWWWWWWCCCCSO.', '.OOSCCCCCCWWWWWWWWWWWWCCCCCCSOO.', '...OOSCCCCCCCCCCCCCCCCCCCCSOO...', '....OOSSSSSSSSSSSSSSSSSSSSOO....', '......OOOOO..OOOOOO..OOOOO......']
        },
        desk_walnut: {
            id: 'desk_walnut', name: '胡桃木古典书桌', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 160,
            isSurfaceHost: true, desc: '宽大沉稳书桌，桌面可叠放立牌或玫瑰',
            palette: { O: '#291911', W: '#9c6844', M: '#7a4e31', D: '#593620', G: '#e3be68', P: '#faf3e3', S: '#dfd4bc', T: '#c84b31' },
            pixels: ['.....OOOOOOO...........OOO......', '....OPPPOPPP..........OWWW......', '...OPPPSOPPSO.........OTTT......', '.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMO', 'ODDDDDDDDDDDDDDDDDDDDDDDDDDDDDDO', 'ODMMDOOOOOOOOOOOOOOOODMMMMMMMDDO', 'ODMMDO...............ODMMGGMMDDO', 'ODMMDO...............ODMMMMMMDDO', 'ODMMDO...............ODDDDDDDDDO', 'ODMMDO...............ODMMMMMMDDO', 'ODMMDO...............ODMMGGMMDDO', 'ODMMDO...............ODMMMMMMDDO', 'ODMMDO...............ODDDDDDDDDO', 'OODDOO...............OODDDDDDOO.']
        },
        desk_cream: {
            id: 'desk_cream', name: '奶油风学习书桌', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 140,
            isSurfaceHost: true, desc: '奶白色圆角书桌，桌面可叠放亚克力立牌',
            palette: { O: '#54463b', W: '#fffaf2', C: '#ebe1d1', L: '#d6b286', D: '#b89265', P: '#f5b8c6', K: '#e091a5', Y: '#fde047' },
            pixels: ['.....OOOOOOO...........OOO......', '....OPPPPPPP..........OYYYO.....', '....OPKKKKKP..........OYYYO.....', '.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCO', 'OOCWCCWCCWCCCCCCCCCCCCWCCWCCWCOO', '..OLDO................OCCCCCCOO.', '..OLDO................OCWGGWCOO.', '..OLDO................OCCCCCCOO.', '..OLDO................OCCCCCCOO.', '..OLDO................OCWGGWCOO.', '..OLDO................OCCCCCCOO.', '..OLDO................OODDDDOO..', '..OOOO..................OOOO....']
        },
        bookshelf_tall: {
            id: 'bookshelf_tall', name: '胡桃木落地书墙', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 220,
            desc: '顶天立地的精装典藏书柜，知识浓度爆表',
            palette: { O: '#261710', W: '#94613f', M: '#72472b', D: '#4d2d1a', R: '#b83240', B: '#2f6670', Y: '#e0b85c', V: '#5a4a7a', G: '#478c52', C: '#f2e8d5' },
            pixels: ['.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.', 'OWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWO', 'OMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMO', 'OMODDDDDDDDDDDDDDDDDDDDDDDDDDOMO', 'OMODRRBBYYVVRRCGGRRBBYYVVCCDDOMO', 'OMODRRBBYYVVRRCGGRRBBYYVVCCDDOMO', 'OMODRRBBYYVVRRCGGRRBBYYVVCCDDOMO', 'OMODRRBBYYVVRRCGGRRBBYYVVCCDDOMO', 'OMOMMMMMMMMMMMMMMMMMMMMMMMMMMOMO', 'OMODDDDDDDDDDDDDDDDDDDDDDDDDDOMO', 'OMODGGVVRRBBYYCCGGVVRRBBYYDDDOMO', 'OMODGGVVRRBBYYCCGGVVRRBBYYDDDOMO', 'OMODGGVVRRBBYYCCGGVVRRBBYYDDDOMO', 'OMODGGVVRRBBYYCCGGVVRRBBYYDDDOMO', 'OMOMMMMMMMMMMMMMMMMMMMMMMMMMMOMO', 'OMODDDDDDDDDDDDDDDDDDDDDDDDDDOMO', 'OMODYYCCBBVVRRGGYYCCBBVVRRDDDOMO', 'OMODYYCCBBVVRRGGYYCCBBVVRRDDDOMO', 'OMODYYCCBBVVRRGGYYCCBBVVRRDDDOMO', 'OMODYYCCBBVVRRGGYYCCBBVVRRDDDOMO', 'OMOMMMMMMMMMMMMMMMMMMMMMMMMMMOMO', 'OMODDDDDDDDDDDDDDDDDDDDDDDDDDOMO', 'OMODMMMMMMMMMMMMMMMMMMMMMMMMDOMO', 'OMODMMGGGGMM..MM..MMGGGGMM..DOMO', 'OMODMMMMMMMMMMMMMMMMMMMMMMMMDOMO', 'OMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMO', 'OODDDDOOOOOOOOOOOOOOOOOOOODDDDOO']
        },
        sofa_velvet: {
            id: 'sofa_velvet', name: '暗红丝绒单人沙发', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 170,
            desc: '深红丝绒配金丝靠枕，窝着看书绝配',
            palette: { O: '#291216', R: '#a62639', M: '#821a2a', D: '#5c101b', G: '#ecc56a', Y: '#c99c42', W: '#5c3a24' },
            pixels: ['....OOOOOOOOOOOO....', '...ORRRRRRRRRRRRO...', '..ORRRMRRRRRRMRRRO..', '..ORRRRRRRRRRRRRRO..', '.OORMMRRRRRRRRMMROO.', 'ORRORRRRRGGRRRRRORRO', 'ORRORRRGGYYGGRRRORRO', 'OMRORRRGYYYYGRRRORMO', 'OMROORRGGYYGGRROORMO', 'OMROORRRRRRRRRROORMO', 'OMROORRRRRRRRRROORMO', 'ODROOMMMMMMMMMMOORDO', 'ODDOMMMMMMMMMMMMODDO', 'ODDDDDDDDDDDDDDDDDDO', '.OODDDDDDDDDDDDDDOO.', '..OWO..........OWO..', '..OOO..........OOO..']
        },
        sofa_cloud: {
            id: 'sofa_cloud', name: '奶油云朵懒人沙发', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 150,
            desc: '一坐进去就不想起来学习的软糯沙发',
            palette: { O: '#7d6e5e', W: '#fffdf8', C: '#f2e8da', S: '#dfd2bf', P: '#f9c5c9', K: '#e69ea6', L: '#b89268' },
            pixels: ['....OOOOOOOOOOOO....', '...OWWWWWWWWWWWWO...', '..OWWWWWWWWWWWWWWO..', '.OOWWWWWWWWWWWWWWO..', 'OWWOOWWWPPPPPWWWOOWO', 'OWWOOWWPPKKKPPWWOOWO', 'OWCOOWWPPKKKPPWWOOWO', 'OCCOOWWWPPPPPWWWOCCO', 'OCCOOWWWWWWWWWWWOCSO', 'OCSOOCCCCCCCCCCCOCSO', 'OSSOCCCCCCCCCCCCOSSO', 'OSSSSSSSSSSSSSSSSSSO', '.OOSSSSSSSSSSSSSSOO.', '..OLO..........OLO..', '..OOO..........OOO..']
        },
        tea_cart: {
            id: 'tea_cart', name: '鎏金英式红茶推车', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 150,
            isSurfaceHost: true, desc: '摆着骨瓷茶壶与司康饼的精致推车',
            palette: { O: '#362717', G: '#ecc86e', D: '#bc943d', W: '#ffffff', C: '#e8dfd1', T: '#b54c2a', B: '#e0a96d' },
            pixels: ['.....OOO..........', '....OWWWO.........', '...OWWWGWO...OO...', '....OWWWO...OTTO..', 'OO..OOOOO..OWWWOO.', '.OGGGGGGGGGGGGGGO.', '..OCCCCCCCCCCCCO..', '..OG..........GO..', '..OG...BBBB...GO..', '..OG..OBBBBO..GO..', '..OGGGGGGGGGGGGO..', '..ODDDDDDDDDDDDO..', '..OG..........GO..', '.OOOG........GOOO.', '.O.O..........O.O.', '..OO..........OO..']
        },
        coffee_bar: {
            id: 'coffee_bar', name: '手冲咖啡角', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 160,
            isSurfaceHost: true, desc: '浓缩咖啡机配冰美式续命杯',
            palette: { O: '#2a1d15', S: '#e2e8f0', M: '#94a3b8', K: '#334155', W: '#c4915e', D: '#94663a', B: '#5c3119', I: '#f8fafc', R: '#ef4444' },
            pixels: ['..OOOOOOO.....I...', '.OSSSSSSSO...OII..', '.OSKKKKKSO...OIBO.', '.OSKRRKKSO...OBBO.', '.OSSSSSSSO...OBBO.', '.OMMKKKMMO...OOOO.', 'OOOOOOOOOOOOOOOOOO', 'OWWWWWWWWWWWWWWWWO', 'ODDDDDDDDDDDDDDDDO', 'ODWWWWWODWWWWWDDDO', 'ODWWSWWODWWSWWDDDO', 'ODWWWWWODWWWWWDDDO', 'ODDDDDDDDDDDDDDDDO', 'ODWWWWWODWWWWWDDDO', 'ODDDDDDDDDDDDDDDDO', '.OO............OO.']
        },
        vinyl_cabinet: {
            id: 'vinyl_cabinet', name: '复古黑胶唱片柜', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 190,
            isSurfaceHost: true, desc: '缓缓旋转的老式黑胶唱机与唱片收纳柜',
            palette: { O: '#261811', W: '#a86e44', D: '#7a4b29', K: '#18181b', G: '#3f3f46', A: '#f59e0b', R: '#dc2626', B: '#3b82f6', Y: '#facc15' },
            pixels: ['....OOOOOOOOOO....', '...OKKGGGGGGKKO...', '..OKGKKKAAKKKGKO..', '..OKGKKKAAKKKGKO..', '...OKKGGGGGGKKO...', '.OOOOOOOOOOOOOOOO.', 'OWWWWWWWWWWWWWWWWO', 'ODDDDDDDDDDDDDDDDO', 'OD.RRBBYY.ODWWWDDO', 'OD.RRBBYY.ODWWWDDO', 'OD.RRBBYY.ODWWWDDO', 'OD.RRBBYY.ODWWWDDO', 'ODDDDDDDDDDDDDDDDO', '.OD............DO.', '.OO............OO.']
        },
        lamp_floor: {
            id: 'lamp_floor', name: '百褶暖光落地灯', category: 'lighting', layer: 'floor', width: 1, depth: 1, price: 120,
            emitsLight: true, lightOffsetY: 0.25, lightRadius: 96, desc: '入夜自动点亮温柔百褶暖光晕',
            palette: { O: '#3b2818', L: '#fff6d6', Y: '#f7d996', S: '#dfc07e', G: '#d4ab54', D: '#9c7830' },
            pixels: ['....OOOOOO....', '...OLLLLLLO...', '..OLLYLLYLLO..', '..OLLYLLYLLO..', '.OLLYSLYSLYLO.', '.OSSSSSSSSSSO.', '..OOOOOOOOOO..', '......OG......', '......OG......', '......OG......', '......OG......', '......OG......', '......OG......', '......OG......', '......OG......', '.....OGGO.....', '...OOGGGGOO...', '..ODDDDDDDDO..', '..OOOOOOOOOO..']
        },
        candle_stand: {
            id: 'candle_stand', name: '银质香薰烛台', category: 'lighting', layer: 'floor', width: 1, depth: 1, price: 95,
            emitsLight: true, lightOffsetY: 0.2, lightRadius: 78, desc: '摇曳微光配淡淡雪松木香',
            palette: { O: '#2d3138', F: '#fb923c', Y: '#fef08a', W: '#fffbeb', C: '#e5e0d0', S: '#e2e8f0', M: '#94a3b8' },
            pixels: ['......FF......', '.....FYYF.....', '......FF......', '.....OWWO.....', '.....OWCO.....', '.....OWCO.....', '....OSSSSO....', '.....OMMO.....', '......OS......', '......OS......', '......OS......', '.....OSSO.....', '...OOSSSSOO...', '..OMMMMMMMMO..', '..OOOOOOOOOO..']
        },
        cat_tree: {
            id: 'cat_tree', name: '双层毛绒猫爬架', category: 'pet', layer: 'floor', width: 1, depth: 1, price: 140,
            desc: '专供像素小猫登高望远和晒太阳打盹',
            palette: { O: '#4d3a2c', W: '#f7eee0', S: '#e0d0b8', R: '#c9965e', D: '#9c6e3c', K: '#3b2b20', P: '#f472b6' },
            pixels: ['..OOOOOOOOOO......', '.OWWWWWWWWWWO.....', '.OSSSSSSSSSSO.....', '.....ORDO...O.....', '.....ORDO...P.....', '.....ORDO..OOO....', '....OORDO.OWWWO...', '....ORDO..OSSSO...', '.OOOOOOOOOO..ORD..', '.OWWWWWWWWO..ORD..', '.OWWKKKKWWO..ORD..', '.OWWKKKKWWO..ORD..', '.OWWKKKKWWO..ORD..', 'OOOOOOOOOOOOOOOOOO', 'OWWWWWWWWWWWWWWWWO', 'OSSSSSSSSSSSSSSSSO', '.OOOOOOOOOOOOOOOO.']
        },
        plant_monstera: {
            id: 'plant_monstera', name: '大叶龟背竹盆栽', category: 'decor', layer: 'floor', width: 1, depth: 1, price: 75,
            desc: '绿意盎然的大叶龟背竹',
            palette: { O: '#263822', L: '#65c466', G: '#3f9648', D: '#286b33', P: '#d4744e', C: '#a85030', B: '#4a2e1e' },
            pixels: ['....OOO..OOO....', '..OOLGLOOLGLO...', '.OLGGLGOOGGGLO..', '.OGG.GGOOG.GGO..', '..OGGGO..OGGO...', '...OOGD..DGO....', '..OOLGD..DGLO...', '.OLGGD.OO.GGLO..', '..OOGD.OO.DGO...', '....OOOBBOOO....', '...OPPPPPPPPO...', '...OCCCCCCCCO...', '....OPPPPPPO....', '....OPCCCCPO....', '.....OCCCCO.....', '.....OOOOOO.....']
        },
        table_round: {
            id: 'table_round', name: '复古胡桃木小圆茶几', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 95,
            isSurfaceHost: true, desc: '茶几面可叠放立牌、花束等表层摆件',
            palette: { O: '#2b1a12', W: '#9c6742', M: '#784c2e', D: '#54331d', R: '#e11d48', G: '#4d9b58', V: '#e0f2fe', B: '#3b82f6' },
            pixels: ['......ORR.......', '......OG........', '.....OVBVO......', '.....OVVVO......', '..OOOOOOOOOOOO..', '.OWWWWWWWWWWWWO.', 'OWWWWWWWWWWWWWWO', 'OMMMMMMMMMMMMMMO', '.ODDDDDDDDDDDDO.', '..OO..ODDO..OO..', '......ODDO......', '......ODDO......', '.....OODDOO.....', '....ODDDDDDO....', '....OOOOOOOO....']
        },
        mirror_full: {
            id: 'mirror_full', name: '波浪边框全身镜', category: 'decor', layer: 'floor', width: 1, depth: 1, price: 115,
            desc: '奶金波浪边框全身镜，氛围感打卡点',
            palette: { O: '#5e462d', F: '#f3d5a5', D: '#cfa76b', G: '#dbeafe', B: '#bfdbfe', W: '#ffffff' },
            pixels: ['....OOOOOO....', '...OFFFFFFO...', '..OFGGGGGGFO..', '..OFGWWGGGFO..', '.OOFWWGGGGFOO.', '.OFGGBBGGGGFO.', '..OFGGBBGGFO..', '..OFGGGBBGFO..', '.OOFGGGGGGFOO.', '.OFGGWWGGGGFO.', '..OFWWBGGGFO..', '..OFGBBGGGFO..', '.OOFGGGGGGFOO.', '.OFDDDDDDDDFO.', '..OOOOOOOOOO..', '...OD....DO...', '...OO....OO...']
        },
        gift_rose_bouquet: {
            id: 'gift_rose_bouquet', name: '像素红玫瑰花束', category: 'decor', layer: 'surface', width: 1, depth: 1, price: 65,
            desc: '可直接叠放在书桌/茶几上的红玫瑰',
            palette: { O: '#361a1d', R: '#e11d48', D: '#9f1239', G: '#4d9b58', P: '#ecd3b0', C: '#cba97e', K: '#f43f5e' },
            pixels: ['...OO..OO...', '..ORROORRO..', '.ORDRORRDRO.', '..ORROORRO..', '..OGGOGGGO..', '...OPPPPO...', '...OPKKPO...', '....OPCO....', '....OCCO....', '.....OO.....']
        }
    };

    /**
     * 统一获取任意物品（普通家具 + 自定义 DIY 痛墙/立牌）的定义
     */
    function getItemDef(itemId, invMap) {
        if (ITEMS[itemId]) return ITEMS[itemId];
        if (String(itemId).startsWith('diy_')) {
            const isStandee = itemId.startsWith('diy_standee_');
            const isPixelated = itemId.endsWith('_px');
            const inv = invMap && (invMap instanceof Map ? invMap.get(itemId) : invMap[itemId]);
            return {
                id: itemId,
                name: (inv && inv.custom_title) || (isStandee ? '自推亚克力立牌' : '痛墙挂画'),
                category: 'diy',
                layer: isStandee ? 'surface' : 'wall',
                width: 1,
                depth: 1,
                isDiy: true,
                diyKind: isStandee ? 'standee' : 'poster',
                pixelated: isPixelated,
                imageUrl: inv ? inv.custom_image_url : '',
                desc: isStandee ? '可摆在书桌/茶几或地板上的自定义立牌' : '可贴在正面墙上的自定义痛墙挂画'
            };
        }
        return null;
    }

    function getFootprint(item) {
        return { spanX: item?.width || 1, spanY: item?.depth || 1 };
    }

    function getSpriteAsset(itemId) {
        // 1. 优先返回 public/home/sprites/<itemId>.png 外部高清像素贴图！
        const ext = getExternalImage(itemId);
        if (ext) return { asset: ext, isExternal: true };
        // 2. 否则回退到内置像素精灵
        const item = ITEMS[itemId];
        if (!item || !item.pixels) return null;
        return { asset: compilePixelSprite(itemId, item.palette, item.pixels), isExternal: false };
    }

    function getAllCatalogItems() {
        const list = [];
        Object.values(ITEMS).forEach((item) => list.push(item));
        Object.values(WINDOW_SKINS).forEach((s) => list.push({ ...s, category: 'skin', layer: 'skin', isSkin: true, skinType: 'window' }));
        Object.values(WALL_SKINS).forEach((s) => list.push({ ...s, category: 'skin', layer: 'skin', isSkin: true, skinType: 'wall', desc: '小窝正面像素壁纸' }));
        Object.values(FLOOR_SKINS).forEach((s) => list.push({ ...s, category: 'skin', layer: 'skin', isSkin: true, skinType: 'floor', desc: '小窝平面像素地板' }));
        return list;
    }

    function getItemThumbDataUrl(itemId, invItem) {
        // DIY 自定义周边直接返回原图（浏览器直接渲染超清晰）
        if (invItem && invItem.source === 'diy' && invItem.custom_image_url) {
            return invItem.custom_image_url;
        }
        // 如果已放入外部 PNG 贴图，直接拿 PNG 当缩略图！
        const ext = getExternalImage(itemId);
        if (ext) return ext.src;

        if (thumbCache.has(itemId)) return thumbCache.get(itemId);

        const c = document.createElement('canvas');
        c.width = 96;
        c.height = 96;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        if (WINDOW_SKINS[itemId]) {
            ctx.fillStyle = '#2b2019';
            ctx.fillRect(6, 18, 84, 60);
            if (itemId === 'window_city_night') {
                ctx.fillStyle = '#2d2552'; ctx.fillRect(10, 22, 76, 52);
                ctx.fillStyle = '#5b4b8a'; ctx.fillRect(14, 38, 16, 36); ctx.fillRect(36, 30, 18, 44); ctx.fillRect(60, 42, 20, 32);
                ctx.fillStyle = '#f9a8d4'; ctx.fillRect(18, 44, 4, 4); ctx.fillRect(42, 38, 4, 4); ctx.fillRect(66, 50, 4, 4);
                ctx.fillStyle = '#fde68a'; ctx.fillRect(46, 52, 4, 4); ctx.fillRect(22, 56, 4, 4);
            } else if (itemId === 'window_blinds_moon') {
                ctx.fillStyle = '#191d3b'; ctx.fillRect(10, 22, 76, 52);
                ctx.fillStyle = '#362d5e'; ctx.fillRect(10, 52, 76, 22);
                ctx.fillStyle = '#fef08a'; ctx.fillRect(62, 30, 10, 10);
                ctx.fillStyle = '#191d3b'; ctx.fillRect(59, 30, 6, 8);
                ctx.fillStyle = 'rgba(203, 213, 225, 0.35)';
                for (let y = 24; y < 44; y += 5) ctx.fillRect(10, y, 76, 2);
            } else if (itemId === 'window_stream_day') {
                ctx.fillStyle = '#a7d996'; ctx.fillRect(10, 22, 76, 52);
                ctx.fillStyle = '#7dd3fc'; ctx.fillRect(42, 22, 16, 22); ctx.fillRect(34, 44, 18, 30);
                ctx.fillStyle = '#fb7185'; ctx.fillRect(20, 52, 4, 4); ctx.fillStyle = '#facc15'; ctx.fillRect(66, 42, 4, 4);
            } else {
                ctx.fillStyle = '#60a5fa'; ctx.fillRect(10, 22, 76, 52);
                ctx.fillStyle = '#ffffff'; ctx.fillRect(20, 42, 26, 12); ctx.fillRect(52, 34, 24, 14);
            }
            ctx.fillStyle = '#4a3425'; ctx.fillRect(47, 22, 3, 52); ctx.fillRect(10, 47, 76, 3);
            const url = c.toDataURL('image/png');
            thumbCache.set(itemId, url);
            return url;
        }

        if (WALL_SKINS[itemId]) {
            const s = WALL_SKINS[itemId];
            ctx.fillStyle = s.base; ctx.fillRect(10, 12, 76, 72);
            if (s.pattern === 'stripes') {
                ctx.fillStyle = s.accent;
                for (let x = 14; x < 84; x += 12) ctx.fillRect(x, 12, 6, 46);
            } else if (s.pattern === 'wood') {
                ctx.fillStyle = s.accent;
                for (let x = 16; x < 84; x += 8) ctx.fillRect(x, 12, 2, 46);
            }
            ctx.fillStyle = s.wainscot; ctx.fillRect(10, 56, 76, 28);
            ctx.fillStyle = s.trim; ctx.fillRect(10, 52, 76, 4);
            ctx.strokeStyle = '#2a1e18'; ctx.lineWidth = 4; ctx.strokeRect(10, 12, 76, 72);
            const url = c.toDataURL('image/png');
            thumbCache.set(itemId, url);
            return url;
        }

        if (FLOOR_SKINS[itemId]) {
            const s = FLOOR_SKINS[itemId];
            for (let r = 0; r < 4; r++) {
                for (let col = 0; col < 4; col++) {
                    const x = 8 + col * 20, y = 8 + r * 20;
                    ctx.fillStyle = (r + col) % 2 === 0 ? s.a : s.b;
                    ctx.fillRect(x, y, 20, 20);
                    ctx.fillStyle = s.plankLine;
                    ctx.fillRect(x, y + 18, 20, 2);
                }
            }
            ctx.strokeStyle = '#2a1e18'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, 80, 80);
            const url = c.toDataURL('image/png');
            thumbCache.set(itemId, url);
            return url;
        }

        const spInfo = getSpriteAsset(itemId);
        if (!spInfo) return '';
        const sp = spInfo.asset;
        const scale = Math.max(1, Math.floor(Math.min(76 / sp.width, 76 / sp.height)));
        const dw = sp.width * scale, dh = sp.height * scale;
        ctx.drawImage(sp, Math.floor((96 - dw) / 2), Math.floor((96 - dh) / 2), dw, dh);
        const url = c.toDataURL('image/png');
        thumbCache.set(itemId, url);
        return url;
    }

    global.CloudHomeCatalog = {
        WINDOW_SKINS,
        WALL_SKINS,
        FLOOR_SKINS,
        ITEMS,
        setAssetLoadedCallback,
        registerExternalSprites,
        getExternalImage,
        getDiyImage,
        getItemDef,
        getSpriteAsset,
        getFootprint,
        getAllCatalogItems,
        getItemThumbDataUrl
    };
})(window);