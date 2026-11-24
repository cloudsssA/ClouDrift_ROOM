// home-routes.js
// ClouDrift 2D XY Pixel Home — Backend Module (32px Wide Apartment + Panoramic Windows + DIY + Hot-Swap Sprites)

const fs = require('fs');
const path = require('path');

const GRID_W = 12;
const GRID_H = 8;
const STARTER_COINS = 500;
const DEFAULT_WALL_SKIN = 'wall_cream';
const DEFAULT_FLOOR_SKIN = 'floor_warm_wood';
const DEFAULT_WINDOW_SKIN = 'window_clouds_day';

function openHomeDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');
    return db;
  } catch (err) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath);
      db.exec('PRAGMA journal_mode = WAL;');
      return db;
    } catch (_) {
      throw new Error(`[Home] 无法加载 SQLite 驱动: ${err.message}`);
    }
  }
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const res = fn();
    db.exec('COMMIT');
    return res;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

const HOME_CATALOG = {
  // === 全景景观大窗皮肤 ===
  window_clouds_day: {
    id: 'window_clouds_day',
    name: '晴空蓬松白云窗',
    category: 'window_skin',
    layer: 'skin',
    price: 0,
    isSkin: true,
    skinType: 'window',
    desc: '经典蓝天蓬松白云大窗，默认免费款'
  },
  window_stream_day: {
    id: 'window_stream_day',
    name: '阳光绿野溪流窗',
    category: 'window_skin',
    layer: 'skin',
    price: 120,
    isSkin: true,
    skinType: 'window',
    desc: '窗外是小溪流淌与野花草地，治愈满分'
  },
  window_blinds_moon: {
    id: 'window_blinds_moon',
    name: '深夜百叶窗星月夜',
    category: 'window_skin',
    layer: 'skin',
    price: 150,
    isSkin: true,
    skinType: 'window',
    desc: '半拉百叶窗透出弯月与紫色夜云，微醺氛围'
  },
  window_city_night: {
    id: 'window_city_night',
    name: '赛博紫夜城市落地窗',
    category: 'window_skin',
    layer: 'skin',
    price: 180,
    isSkin: true,
    skinType: 'window',
    desc: '繁华都市霓虹天际线全景落地窗，高冷暗房绝杀'
  },

  // === 墙纸皮肤 ===
  wall_cream: {
    id: 'wall_cream',
    name: '奶油燕麦墙',
    category: 'wall_skin',
    layer: 'skin',
    price: 0,
    isSkin: true,
    skinType: 'wall',
    desc: '温柔百搭的奶油白墙面，默认免费款'
  },
  wall_warm_wood: {
    id: 'wall_warm_wood',
    name: '日系原木护墙板',
    category: 'wall_skin',
    layer: 'skin',
    price: 120,
    isSkin: true,
    skinType: 'wall',
    desc: '带着松木暖意的日系竖条护墙板'
  },
  wall_gothic_crimson: {
    id: 'wall_gothic_crimson',
    name: '暗红丝绒哥特壁纸',
    category: 'wall_skin',
    layer: 'skin',
    price: 180,
    isSkin: true,
    skinType: 'wall',
    desc: '深酒红暗纹墙纸，复古书房标配'
  },
  wall_cyber_lavender: {
    id: 'wall_cyber_lavender',
    name: '暗紫雾霭公寓墙',
    category: 'wall_skin',
    layer: 'skin',
    price: 170,
    isSkin: true,
    skinType: 'wall',
    desc: '低饱和灰紫像素墙面，配赛博窗景一绝'
  },

  // === 地板皮肤 ===
  floor_warm_wood: {
    id: 'floor_warm_wood',
    name: '浅橡木拼花地板',
    category: 'floor_skin',
    layer: 'skin',
    price: 0,
    isSkin: true,
    skinType: 'floor',
    desc: '清爽耐看的浅木纹地板，默认免费款'
  },
  floor_dark_walnut: {
    id: 'floor_dark_walnut',
    name: '深胡桃木人字拼',
    category: 'floor_skin',
    layer: 'skin',
    price: 160,
    isSkin: true,
    skinType: 'floor',
    desc: '沉稳低调的深胡桃木地板，贵气十足'
  },
  floor_cream_checker: {
    id: 'floor_cream_checker',
    name: '奶油棋盘格砖',
    category: 'floor_skin',
    layer: 'skin',
    price: 140,
    isSkin: true,
    skinType: 'floor',
    desc: '甜美复古的奶白焦糖棋盘格地砖'
  },
  floor_slate_purple: {
    id: 'floor_slate_purple',
    name: '暗紫灰木纹地板',
    category: 'floor_skin',
    layer: 'skin',
    price: 160,
    isSkin: true,
    skinType: 'floor',
    desc: '冷调灰紫木地板，深夜猫猫公寓专属'
  },

  // === 墙面层 (wall) ===
  curtain_sheer: { id: 'curtain_sheer', name: '微风白纱窗帘', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 80, desc: '挂在墙面或窗边的柔光白纱窗帘' },
  shelf_wall_books: { id: 'shelf_wall_books', name: '壁挂迷你书架', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 90, desc: '塞满精装外文书与垂吊绿植的壁架' },
  tapestry_star: { id: 'tapestry_star', name: '星月织锦挂毯', category: 'wall', layer: 'wall', width: 1, depth: 1, price: 110, desc: '深蓝描金星月挂毯，深夜氛围感拉满' },

  // === 地毯层 (rug) ===
  rug_persian: { id: 'rug_persian', name: '酒红复古波斯地毯', category: 'rug', layer: 'rug', width: 2, depth: 2, price: 130, desc: '暗红金边流苏波斯绒毯，复古书房灵魂' },
  rug_cloud: { id: 'rug_cloud', name: '软绵绵云朵地毯', category: 'rug', layer: 'rug', width: 2, depth: 2, price: 110, desc: '像踩在刚烤好的舒芙蕾上的纯白绒毯' },

  // === 立体家具层 (floor) ===
  desk_walnut: { id: 'desk_walnut', name: '胡桃木古典书桌', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 160, desc: '宽大沉稳的书桌，桌面可叠放立牌与花束' },
  desk_cream: { id: 'desk_cream', name: '奶油风学习书桌', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 140, desc: '奶白色圆角书桌，桌面可叠放摆件' },
  bookshelf_tall: { id: 'bookshelf_tall', name: '胡桃木落地书墙', category: 'furniture', layer: 'floor', width: 2, depth: 1, price: 220, desc: '顶天立地的精装典藏书柜，知识浓度爆表' },
  sofa_velvet: { id: 'sofa_velvet', name: '暗红丝绒单人沙发', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 170, desc: '深红丝绒配金丝靠枕，窝着看书绝配' },
  sofa_cloud: { id: 'sofa_cloud', name: '奶油云朵懒人沙发', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 150, desc: '一坐进去就不想起来学习的软糯沙发' },
  tea_cart: { id: 'tea_cart', name: '鎏金英式红茶推车', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 150, desc: '摆着骨瓷茶壶与司康饼的精致推车' },
  coffee_bar: { id: 'coffee_bar', name: '手冲咖啡角', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 160, desc: '浓缩咖啡机配冰美式续命杯' },
  vinyl_cabinet: { id: 'vinyl_cabinet', name: '复古黑胶唱片柜', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 190, desc: '缓缓旋转的老式黑胶唱机与唱片柜' },
  lamp_floor: { id: 'lamp_floor', name: '百褶暖光落地灯', category: 'lighting', layer: 'floor', width: 1, depth: 1, price: 120, emitsLight: true, desc: '入夜自动点亮温柔暖黄光晕' },
  candle_stand: { id: 'candle_stand', name: '银质香薰烛台', category: 'lighting', layer: 'floor', width: 1, depth: 1, price: 95, emitsLight: true, desc: '摇曳微光配淡淡雪松木香' },
  cat_tree: { id: 'cat_tree', name: '双层毛绒猫爬架', category: 'pet', layer: 'floor', width: 1, depth: 1, price: 140, desc: '专供像素小猫登高望远和晒太阳打盹' },
  plant_monstera: { id: 'plant_monstera', name: '大叶龟背竹盆栽', category: 'decor', layer: 'floor', width: 1, depth: 1, price: 75, desc: '绿意盎然的大叶龟背竹' },
  table_round: { id: 'table_round', name: '复古胡桃木小圆茶几', category: 'furniture', layer: 'floor', width: 1, depth: 1, price: 95, desc: '配沙发刚好，茶几面可叠放立牌或花束' },
  mirror_full: { id: 'mirror_full', name: '波浪边框全身镜', category: 'decor', layer: 'floor', width: 1, depth: 1, price: 115, desc: '奶金波浪边框全身镜，氛围感打卡点' },

  // === 桌面/表层摆件 (surface) ===
  gift_rose_bouquet: { id: 'gift_rose_bouquet', name: '像素红玫瑰花束', category: 'decor', layer: 'surface', width: 1, depth: 1, price: 65, desc: '可直接摆在书桌/茶几桌面上的像素红玫瑰' }
};

const VALID_LAYERS = new Set(['rug', 'wall', 'floor', 'surface']);

function nowIso() {
  return new Date().toISOString();
}

function normalizeCharKey(raw) {
  const s = String(raw || 'default').trim();
  return s ? s.slice(0, 120) : 'default';
}

function safeParseJson(str, fallback = {}) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      coins INTEGER NOT NULL DEFAULT ${STARTER_COINS},
      total_earned INTEGER NOT NULL DEFAULT ${STARTER_COINS},
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS home_inventory (
      item_id TEXT PRIMARY KEY,
      owned_count INTEGER NOT NULL DEFAULT 1,
      custom_image_url TEXT DEFAULT '',
      custom_title TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'shop',
      unlocked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS home_rooms (
      char_key TEXT PRIMARY KEY,
      room_name TEXT NOT NULL DEFAULT '共享小窝',
      wall_skin TEXT NOT NULL DEFAULT '${DEFAULT_WALL_SKIN}',
      floor_skin TEXT NOT NULL DEFAULT '${DEFAULT_FLOOR_SKIN}',
      window_skin TEXT NOT NULL DEFAULT '${DEFAULT_WINDOW_SKIN}',
      grid_size INTEGER NOT NULL DEFAULT ${GRID_W},
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS home_placements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      char_key TEXT NOT NULL,
      item_id TEXT NOT NULL,
      grid_x INTEGER NOT NULL,
      grid_y INTEGER NOT NULL,
      rotation INTEGER NOT NULL DEFAULT 0,
      layer TEXT NOT NULL DEFAULT 'floor',
      meta_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_home_placements_char
      ON home_placements (char_key);
  `);

  // 无痛迁移旧库：补充 window_skin 字段
  try {
    db.exec(`ALTER TABLE home_rooms ADD COLUMN window_skin TEXT NOT NULL DEFAULT '${DEFAULT_WINDOW_SKIN}'`);
  } catch (_) {}

  const ts = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO home_wallet (id, coins, total_earned, updated_at)
    VALUES (1, ?, ?, ?)
  `).run(STARTER_COINS, STARTER_COINS, ts);

  const seedSkin = db.prepare(`
    INSERT OR IGNORE INTO home_inventory (item_id, owned_count, custom_image_url, custom_title, source, unlocked_at)
    VALUES (?, 1, '', '', 'default', ?)
  `);
  seedSkin.run(DEFAULT_WALL_SKIN, ts);
  seedSkin.run(DEFAULT_FLOOR_SKIN, ts);
  seedSkin.run(DEFAULT_WINDOW_SKIN, ts);
}

function registerHomeRoutes(app, ctx = {}) {
  const dataDir = ctx.dataDir || path.join(process.cwd(), 'data');
  const dbPath = path.join(dataDir, 'home', 'home.db');
  const spritesDir = path.join(process.cwd(), 'public', 'home', 'sprites');
  fs.mkdirSync(spritesDir, { recursive: true });

  // 安全获取 mediaStore（复用你现有的硬盘落盘引擎）
  let mediaStore = ctx.mediaStore || null;
  if (!mediaStore) {
    try { mediaStore = require('./media-store'); } catch (_) {}
  }

  const db = openHomeDatabase(dbPath);
  initSchema(db);

  function getWallet() {
    return db.prepare('SELECT id, coins, total_earned, updated_at FROM home_wallet WHERE id = 1').get();
  }

  function ensureRoom(charKey) {
    const key = normalizeCharKey(charKey);
    let room = db.prepare('SELECT * FROM home_rooms WHERE char_key = ?').get(key);
    if (!room) {
      const ts = nowIso();
      db.prepare(`
        INSERT INTO home_rooms (char_key, room_name, wall_skin, floor_skin, window_skin, grid_size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(key, '共享小窝', DEFAULT_WALL_SKIN, DEFAULT_FLOOR_SKIN, DEFAULT_WINDOW_SKIN, GRID_W, ts);
      room = db.prepare('SELECT * FROM home_rooms WHERE char_key = ?').get(key);
    }
    if (!room.window_skin) room.window_skin = DEFAULT_WINDOW_SKIN;
    return { ...room, grid_w: GRID_W, grid_h: GRID_H };
  }

  function getInventory() {
    return db.prepare('SELECT * FROM home_inventory ORDER BY unlocked_at DESC').all();
  }

  function getPlacements(charKey) {
    const key = normalizeCharKey(charKey);
    const rows = db.prepare('SELECT * FROM home_placements WHERE char_key = ? ORDER BY id ASC').all(key);
    return rows.map((row) => ({
      ...row,
      meta: safeParseJson(row.meta_json, {})
    }));
  }

  function scanExternalSprites() {
    const map = {};
    try {
      const files = fs.readdirSync(spritesDir);
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!['.png', '.webp', '.gif'].includes(ext)) continue;
        const id = path.basename(f, ext);
        const stat = fs.statSync(path.join(spritesDir, f));
        map[id] = `/home/sprites/${encodeURIComponent(f)}?v=${Math.floor(stat.mtimeMs)}`;
      }
    } catch (_) {}
    return map;
  }

  function awardFocusCoins(minutes) {
    const safeMin = Math.floor(Number(minutes) || 0);
    if (safeMin <= 0) return { awarded: 0, base: 0, bonus: 0, wallet: getWallet() };
    const base = safeMin * 2;
    const bonus = safeMin >= 25 ? 20 : 0;
    const awarded = base + bonus;
    const ts = nowIso();

    const wallet = withTransaction(db, () => {
      db.prepare(`
        UPDATE home_wallet
        SET coins = coins + ?, total_earned = total_earned + ?, updated_at = ?
        WHERE id = 1
      `).run(awarded, awarded, ts);
      return getWallet();
    });
    return { awarded, base, bonus, minutes: safeMin, wallet };
  }

  function getRoomSummaryText(charKey) {
    const key = normalizeCharKey(charKey);
    const room = db.prepare('SELECT * FROM home_rooms WHERE char_key = ?').get(key);
    if (!room) return '';

    const placements = getPlacements(key);
    if (placements.length === 0) return '';

    const invMap = new Map(getInventory().map((i) => [i.item_id, i]));
    const wallName = HOME_CATALOG[room.wall_skin]?.name || room.wall_skin;
    const floorName = HOME_CATALOG[room.floor_skin]?.name || room.floor_skin;
    const winName = HOME_CATALOG[room.window_skin || DEFAULT_WINDOW_SKIN]?.name || '像素大窗';

    const itemCounts = new Map();
    for (const p of placements) {
      const inv = invMap.get(p.item_id);
      let label = HOME_CATALOG[p.item_id]?.name || p.item_id;
      if (inv && inv.source === 'diy') {
        const tag = p.item_id.startsWith('diy_standee_') ? '亚克力立牌' : '痛墙挂画';
        label = `DIY${tag}「${inv.custom_title || '自推周边'}」`;
      }
      itemCounts.set(label, (itemCounts.get(label) || 0) + 1);
    }

    const itemList = Array.from(itemCounts.entries())
      .map(([name, cnt]) => (cnt > 1 ? `${name}×${cnt}` : name))
      .join('、');

    return `【共享像素小窝】「${room.room_name}」（${winName} / ${wallName} / ${floorName}）；屋内摆设：${itemList}（共${placements.length}件）。`;
  }

  function placeGiftItem({
    charKey = 'default',
    itemId = 'gift_rose_bouquet',
    gridX,
    gridY,
    rotation = 0,
    customTitle = '',
    customImageUrl = '',
    source = 'gift'
  } = {}) {
    const key = normalizeCharKey(charKey);
    ensureRoom(key);
    const catalogItem = HOME_CATALOG[itemId];
    const layer = (catalogItem && VALID_LAYERS.has(catalogItem.layer) ? catalogItem.layer : 'surface');
    const ts = nowIso();

    return withTransaction(db, () => {
      const existing = db.prepare('SELECT * FROM home_inventory WHERE item_id = ?').get(itemId);
      if (existing) {
        db.prepare('UPDATE home_inventory SET owned_count = owned_count + 1 WHERE item_id = ?').run(itemId);
      } else {
        db.prepare(`
          INSERT INTO home_inventory (item_id, owned_count, custom_image_url, custom_title, source, unlocked_at)
          VALUES (?, 1, ?, ?, ?, ?)
        `).run(itemId, customImageUrl, customTitle, source, ts);
      }

      let targetX = Number.isInteger(gridX) ? gridX : -1;
      let targetY = Number.isInteger(gridY) ? gridY : -1;
      if (targetX < 0 || targetY < 0) {
        const occupied = new Set(
          db.prepare('SELECT grid_x, grid_y FROM home_placements WHERE char_key = ? AND layer = ?')
            .all(key, layer)
            .map((r) => `${r.grid_x},${r.grid_y}`)
        );
        outer: for (let y = 2; y < GRID_H; y++) {
          for (let x = 1; x < GRID_W - 1; x++) {
            if (!occupied.has(`${x},${y}`)) {
              targetX = x;
              targetY = y;
              break outer;
            }
          }
        }
        if (targetX < 0) { targetX = 2; targetY = 3; }
      }

      const info = db.prepare(`
        INSERT INTO home_placements (char_key, item_id, grid_x, grid_y, rotation, layer, meta_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(key, itemId, targetX, targetY, Number(rotation) & 1, layer, JSON.stringify({ gifted: true }), ts);

      return { placement_id: Number(info.lastInsertRowid), char_key: key, item_id: itemId, grid_x: targetX, grid_y: targetY };
    });
  }

  // ---------- HTTP API 路由 ----------

  // 1. 扫描 public/home/sprites/ 外部 PNG 贴图（零 404 热加载！）
  app.get('/api/home/sprites', (req, res) => {
    res.json({ ok: true, sprites: scanExternalSprites() });
  });

  // 2. 全量状态拉取
  app.get('/api/home/state', (req, res) => {
    try {
      const charKey = normalizeCharKey(req.query.char_key);
      res.json({
        ok: true,
        wallet: getWallet(),
        room: ensureRoom(charKey),
        inventory: getInventory(),
        placements: getPlacements(charKey),
        catalog: HOME_CATALOG,
        sprites: scanExternalSprites()
      });
    } catch (err) {
      console.error('[Home] GET /api/home/state error:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 3. 钱包与专注发币
  app.get('/api/home/wallet', (req, res) => {
    try { res.json({ ok: true, wallet: getWallet() }); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post('/api/home/wallet/award', (req, res) => {
    try {
      const minutes = Number(req.body?.minutes || 0);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
        return res.status(400).json({ ok: false, error: '无效的专注时长（需 1~600 分钟）' });
      }
      res.json({ ok: true, ...awardFocusCoins(minutes) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 4. 商城购买
  app.post('/api/home/shop/buy', (req, res) => {
    try {
      const itemId = String(req.body?.item_id || '').trim();
      const qty = Math.max(1, Math.min(20, Math.floor(Number(req.body?.qty || 1))));
      const item = HOME_CATALOG[itemId];
      if (!item || item.shopHidden) {
        return res.status(404).json({ ok: false, error: '商品不存在或暂未上架' });
      }

      const result = withTransaction(db, () => {
        const existing = db.prepare('SELECT * FROM home_inventory WHERE item_id = ?').get(itemId);
        if (item.isSkin && existing && existing.owned_count > 0) {
          return { error: '这款装潢皮肤已经拥有啦，不用重复买哦', status: 400 };
        }
        const buyQty = item.isSkin ? 1 : qty;
        const totalCost = item.price * buyQty;
        const wallet = getWallet();
        if (wallet.coins < totalCost) {
          return { error: `云朵币不够啦！还差 ${totalCost - wallet.coins} 币，去专注攒一波吧`, status: 400 };
        }
        const ts = nowIso();
        db.prepare('UPDATE home_wallet SET coins = coins - ?, updated_at = ? WHERE id = 1').run(totalCost, ts);
        if (existing) {
          db.prepare('UPDATE home_inventory SET owned_count = owned_count + ? WHERE item_id = ?').run(buyQty, itemId);
        } else {
          db.prepare(`
            INSERT INTO home_inventory (item_id, owned_count, custom_image_url, custom_title, source, unlocked_at)
            VALUES (?, ?, '', '', 'shop', ?)
          `).run(itemId, buyQty, ts);
        }
        return { wallet: getWallet(), inventory: getInventory(), purchased: { item_id: itemId, qty: buyQty, cost: totalCost } };
      });

      if (result.error) return res.status(result.status || 400).json({ ok: false, error: result.error });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. 更新小窝名称 / 壁纸 / 地板 / 窗景
  app.patch('/api/home/room', (req, res) => {
    try {
      const charKey = normalizeCharKey(req.body?.char_key);
      const room = ensureRoom(charKey);

      const nextName = typeof req.body?.room_name === 'string' && req.body.room_name.trim()
        ? req.body.room_name.trim().slice(0, 30)
        : room.room_name;

      const resolveSkin = (fieldKey, skinType, fallback) => {
        if (typeof req.body?.[fieldKey] !== 'string' || !req.body[fieldKey].trim()) return fallback;
        const candidate = req.body[fieldKey].trim();
        const def = HOME_CATALOG[candidate];
        const owned = db.prepare('SELECT owned_count FROM home_inventory WHERE item_id = ?').get(candidate);
        if (!def || def.skinType !== skinType || (!owned && def.price > 0)) {
          throw new Error(`尚未拥有该皮肤: ${candidate}`);
        }
        return candidate;
      };

      const nextWall = resolveSkin('wall_skin', 'wall', room.wall_skin);
      const nextFloor = resolveSkin('floor_skin', 'floor', room.floor_skin);
      const nextWindow = resolveSkin('window_skin', 'window', room.window_skin);

      db.prepare(`
        UPDATE home_rooms
        SET room_name = ?, wall_skin = ?, floor_skin = ?, window_skin = ?, updated_at = ?
        WHERE char_key = ?
      `).run(nextName, nextWall, nextFloor, nextWindow, nowIso(), charKey);

      res.json({ ok: true, room: ensureRoom(charKey) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 6. 放置家具 / DIY 痛墙 / 立牌
  app.post('/api/home/placements', (req, res) => {
    try {
      const charKey = normalizeCharKey(req.body?.char_key);
      const itemId = String(req.body?.item_id || '').trim();
      const gridX = Math.floor(Number(req.body?.grid_x));
      const gridY = Math.floor(Number(req.body?.grid_y));
      const rotation = ((Math.floor(Number(req.body?.rotation || 0)) % 4) + 4) % 4;
      const metaObj = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

      ensureRoom(charKey);
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY) || gridX < 0 || gridX >= GRID_W || gridY < 0 || gridY >= GRID_H) {
        return res.status(400).json({ ok: false, error: '摆放坐标超出小窝网格范围' });
      }

      const inv = db.prepare('SELECT * FROM home_inventory WHERE item_id = ?').get(itemId);
      if (!inv || inv.owned_count <= 0) {
        return res.status(400).json({ ok: false, error: '背包里还没有这件物品哦' });
      }

      const catalogItem = HOME_CATALOG[itemId];
      if (catalogItem && catalogItem.isSkin) {
        return res.status(400).json({ ok: false, error: '窗景/壁纸/地板请直接点击换装' });
      }

      const placedRow = db.prepare('SELECT COUNT(*) AS cnt FROM home_placements WHERE char_key = ? AND item_id = ?').get(charKey, itemId);
      if (Number(placedRow.cnt) >= inv.owned_count) {
        return res.status(400).json({ ok: false, error: '这件物品已经全部摆出来啦' });
      }

      let defaultLayer = 'floor';
      if (catalogItem) defaultLayer = catalogItem.layer;
      else if (itemId.startsWith('diy_poster_')) defaultLayer = 'wall';
      else if (itemId.startsWith('diy_standee_')) defaultLayer = 'surface';

      const rawLayer = req.body?.layer || defaultLayer;
      const layer = VALID_LAYERS.has(rawLayer) ? rawLayer : defaultLayer;
      const ts = nowIso();

      const info = db.prepare(`
        INSERT INTO home_placements (char_key, item_id, grid_x, grid_y, rotation, layer, meta_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(charKey, itemId, gridX, gridY, rotation, layer, JSON.stringify(metaObj), ts);

      const created = db.prepare('SELECT * FROM home_placements WHERE id = ?').get(Number(info.lastInsertRowid));
      res.json({
        ok: true,
        placement: { ...created, meta: safeParseJson(created.meta_json, {}) },
        placements: getPlacements(charKey)
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 7. 移动 / 镜像翻转 / 修改挂画滤镜
  app.patch('/api/home/placements/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM home_placements WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ ok: false, error: '找不到该家具摆放记录' });

      const nextX = req.body?.grid_x !== undefined ? Math.floor(Number(req.body.grid_x)) : existing.grid_x;
      const nextY = req.body?.grid_y !== undefined ? Math.floor(Number(req.body.grid_y)) : existing.grid_y;
      const nextRot = req.body?.rotation !== undefined ? ((Math.floor(Number(req.body.rotation)) % 4) + 4) % 4 : existing.rotation;

      if (!Number.isFinite(nextX) || !Number.isFinite(nextY) || nextX < 0 || nextX >= GRID_W || nextY < 0 || nextY >= GRID_H) {
        return res.status(400).json({ ok: false, error: '目标坐标超出小窝范围' });
      }

      const nextMeta = req.body?.meta && typeof req.body.meta === 'object'
        ? JSON.stringify({ ...safeParseJson(existing.meta_json, {}), ...req.body.meta })
        : existing.meta_json;

      db.prepare(`
        UPDATE home_placements
        SET grid_x = ?, grid_y = ?, rotation = ?, meta_json = ?, updated_at = ?
        WHERE id = ?
      `).run(nextX, nextY, nextRot, nextMeta, nowIso(), id);

      const updated = db.prepare('SELECT * FROM home_placements WHERE id = ?').get(id);
      res.json({
        ok: true,
        placement: { ...updated, meta: safeParseJson(updated.meta_json, {}) },
        placements: getPlacements(existing.char_key)
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 8. 收纳单件 & 一键清空
  app.delete('/api/home/placements/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM home_placements WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ ok: false, error: '找不到该家具摆放记录' });
      db.prepare('DELETE FROM home_placements WHERE id = ?').run(id);
      res.json({ ok: true, removed_id: id, placements: getPlacements(existing.char_key) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/home/placements/clear', (req, res) => {
    try {
      const charKey = normalizeCharKey(req.body?.char_key);
      db.prepare('DELETE FROM home_placements WHERE char_key = ?').run(charKey);
      res.json({ ok: true, char_key: charKey, placements: [] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 9. 🔥 二次元痛墙挂画 / 亚克力立牌 DIY 上传（直接复用 mediaStore 硬盘落盘！）
  app.post('/api/home/diy', (req, res) => {
    try {
      const kind = req.body?.kind === 'standee' ? 'standee' : 'poster';
      const pixelated = Boolean(req.body?.pixelated);
      const title = String(req.body?.title || (kind === 'standee' ? '自推亚克力立牌' : '痛墙挂画'))
        .trim()
        .slice(0, 28);

      let finalUrl = String(req.body?.image_url || '').trim();
      const rawData = String(req.body?.image_data || '').trim();

      if (!finalUrl && rawData) {
        if (mediaStore && typeof mediaStore.persistMedia === 'function') {
          finalUrl = mediaStore.persistMedia(rawData, `home_${kind}`);
        } else {
          finalUrl = rawData;
        }
      }

      if (!finalUrl) {
        return res.status(400).json({ ok: false, error: '请先选择一张图片哦～' });
      }

      // 将像素滤镜标记编码进 itemId 后缀（无须额外加表字段）
      const suffix = pixelated ? '_px' : '';
      const itemId = `diy_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}${suffix}`;

      db.prepare(`
        INSERT INTO home_inventory (item_id, owned_count, custom_image_url, custom_title, source, unlocked_at)
        VALUES (?, 1, ?, ?, 'diy', ?)
      `).run(itemId, finalUrl, title, nowIso());

      res.json({
        ok: true,
        item: db.prepare('SELECT * FROM home_inventory WHERE item_id = ?').get(itemId),
        inventory: getInventory()
      });
    } catch (err) {
      console.error('[Home] POST /api/home/diy error:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 10. 删除自定义 DIY 痛墙/立牌
  app.delete('/api/home/diy/:itemId', (req, res) => {
    try {
      const itemId = String(req.params.itemId || '').trim();
      const row = db.prepare('SELECT * FROM home_inventory WHERE item_id = ? AND source = ?').get(itemId, 'diy');
      if (!row) return res.status(404).json({ ok: false, error: '未找到该 DIY 周边' });

      withTransaction(db, () => {
        db.prepare('DELETE FROM home_placements WHERE item_id = ?').run(itemId);
        db.prepare('DELETE FROM home_inventory WHERE item_id = ?').run(itemId);
      });
      res.json({ ok: true, removed: itemId, inventory: getInventory() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log(`[Home] 🏡 像素家园后端已就绪 (${GRID_W}×${GRID_H}宽屏公寓) | 贴图热加载目录: ${spritesDir}`);

  return {
    db,
    catalog: HOME_CATALOG,
    getWallet,
    awardFocusCoins,
    getRoomSummaryText,
    placeGiftItem
  };
}

module.exports = { registerHomeRoutes, HOME_CATALOG };