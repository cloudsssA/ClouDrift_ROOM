// public/home/home-engine.js
// ClouDrift 2D XY Pixel Home — 32px 12×8 宽屏公寓渲染引擎（零黑屏 + 全景大窗 + 痛墙立牌 + 桌面叠放 + 像素小猫）

(function (global) {
    'use strict';

    const TILE = 32;      // 升级 32×32 高精细像素基准格！
    const GRID_W = 12;    // 宽屏公寓 12 列
    const GRID_H = 8;     // 8 行（顶部 y=0..1 为正面墙，y=2..7 为宽敞地板）
    const WALL_ROWS = 2;
    const RIM = 8;

    class CloudHomeEngine {
        constructor(canvas, callbacks = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.callbacks = callbacks;

            this.room = {
                wall_skin: 'wall_cream',
                floor_skin: 'floor_warm_wood',
                window_skin: 'window_clouds_day'
            };
            this.placements = [];
            this.inventoryMap = new Map();

            this.lightingMode = 'auto';
            this.showPet = true;
            this.selectedPlacementId = null;
            this.placingItemId = null;
            this.placingRotation = 0;
            this.movingPlacement = null;
            this.hoverTile = null;

            // 漫步像素小黑猫状态
            this.pet = {
                x: 5.5, y: 5.2,
                tx: 5.5, ty: 5.2,
                facing: 1,
                state: 'idle', // 'idle' | 'walk' | 'sleep'
                timer: 1400,
                lastTick: performance.now()
            };

            // 离屏像素缓冲画布 (400 × 272 逻辑像素，极省内存且清晰度翻倍！)
            this.pixelBuf = document.createElement('canvas');
            this.pixelBuf.width = GRID_W * TILE + RIM * 2;
            this.pixelBuf.height = GRID_H * TILE + RIM * 2;
            this.pctx = this.pixelBuf.getContext('2d');
            this.pctx.imageSmoothingEnabled = false;

            this.cssW = 480;
            this.cssH = 340;
            this.drawX = 0;
            this.drawY = 0;
            this.drawW = 400;
            this.drawH = 272;
            this.pixelScale = 1;

            this._rafId = null;
            this._destroyed = false;
            this._pointerDownPos = null;

            this._bindEvents();
            this.resize(true);
            this._startLoop();
        }

        setData({ room, placements, inventory }) {
            if (room) this.room = room;
            if (Array.isArray(placements)) this.placements = placements;
            if (Array.isArray(inventory)) {
                this.inventoryMap = new Map(inventory.map((i) => [i.item_id, i]));
            }
            this.render(performance.now());
        }

        setLightingMode(mode) { this.lightingMode = mode || 'auto'; }
        setShowPet(flag) { this.showPet = Boolean(flag); }
        setSelectedPlacement(id) { this.selectedPlacementId = id || null; }

        setPlacingItem(itemId, rotation = 0) {
            this.placingItemId = itemId || null;
            this.placingRotation = rotation & 1;
            if (itemId) {
                this.movingPlacement = null;
                this.selectedPlacementId = null;
            }
        }

        setMovingPlacement(placement) {
            this.movingPlacement = placement || null;
            if (placement) {
                this.placingItemId = null;
                this.selectedPlacementId = placement.id;
            }
        }

        clearModes() {
            this.placingItemId = null;
            this.movingPlacement = null;
            this.selectedPlacementId = null;
            this.hoverTile = null;
        }

        getResolvedLighting() {
            if (this.lightingMode !== 'auto') return this.lightingMode;
            const h = new Date().getHours();
            if (h >= 17 && h < 20) return 'sunset';
            if (h >= 20 || h < 6) return 'night';
            return 'day';
        }

        resize(force = false) {
            const parent = this.canvas.parentElement;
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            const w = Math.max(220, Math.round(rect.width));
            const h = Math.max(180, Math.round(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            const targetW = Math.round(w * dpr);
            const targetH = Math.round(h * dpr);
            if (!force && this.canvas.width === targetW && this.canvas.height === targetH) return;

            this.cssW = w;
            this.cssH = h;
            this.canvas.width = targetW;
            this.canvas.height = targetH;
            this.canvas.style.width = `${w}px`;
            this.canvas.style.height = `${h}px`;
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.ctx.imageSmoothingEnabled = false;

            const logW = this.pixelBuf.width;
            const logH = this.pixelBuf.height;
            const scale = Math.min((w - 14) / logW, (h - 14) / logH);
            this.pixelScale = Math.max(0.5, scale);
            this.drawW = Math.floor(logW * this.pixelScale);
            this.drawH = Math.floor(logH * this.pixelScale);
            this.drawX = Math.floor((w - this.drawW) / 2);
            this.drawY = Math.floor((h - this.drawH) / 2);

            this.render(performance.now());
        }

        screenToGrid(sx, sy) {
            const lx = (sx - this.drawX) / this.pixelScale - RIM;
            const ly = (sy - this.drawY) / this.pixelScale - RIM;
            const gx = Math.floor(lx / TILE);
            const gy = Math.floor(ly / TILE);
            if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return null;
            return { x: gx, y: gy };
        }

        canPlaceAt(itemId, gx, gy, ignorePlacementId = null) {
            const cat = global.CloudHomeCatalog;
            const item = cat.getItemDef(itemId, this.inventoryMap);
            if (!item) return { ok: false };

            const { spanX, spanY } = cat.getFootprint(item);
            if (gx < 0 || gy < 0 || gx + spanX > GRID_W || gy + spanY > GRID_H) return { ok: false };

            if (item.layer === 'wall') {
                if (gy >= WALL_ROWS) return { ok: false };
            } else {
                if (gy < WALL_ROWS) return { ok: false };
            }

            // 同层碰撞检查：surface（亚克力立牌/花束）不与 floor 冲突，可以直接放书桌和茶几上！
            const targetLayer = item.layer || 'floor';
            const occupied = new Set();
            for (const p of this.placements) {
                if (p.id === ignorePlacementId || p.layer !== targetLayer) continue;
                const pItem = cat.getItemDef(p.item_id, this.inventoryMap);
                const fp = cat.getFootprint(pItem);
                for (let dx = 0; dx < fp.spanX; dx++) {
                    for (let dy = 0; dy < fp.spanY; dy++) {
                        occupied.add(`${p.grid_x + dx},${p.grid_y + dy}`);
                    }
                }
            }
            for (let dx = 0; dx < spanX; dx++) {
                for (let dy = 0; dy < spanY; dy++) {
                    if (occupied.has(`${gx + dx},${gy + dy}`)) return { ok: false };
                }
            }
            return { ok: true };
        }

        hasSurfaceHostAt(gx, gy) {
            const cat = global.CloudHomeCatalog;
            return this.placements.some((p) => {
                if (p.layer !== 'floor') return false;
                const item = cat.getItemDef(p.item_id, this.inventoryMap);
                if (!item || !item.isSurfaceHost) return false;
                const fp = cat.getFootprint(item);
                return gx >= p.grid_x && gx < p.grid_x + fp.spanX && gy >= p.grid_y && gy < p.grid_y + fp.spanY;
            });
        }

        pickPlacementAt(sx, sy) {
            const cat = global.CloudHomeCatalog;
            const lx = (sx - this.drawX) / this.pixelScale - RIM;
            const ly = (sy - this.drawY) / this.pixelScale - RIM;
            if (lx < 0 || ly < 0 || lx > GRID_W * TILE || ly > GRID_H * TILE) return null;

            const order = { rug: 1, wall: 2, floor: 3, surface: 4 };
            const sortedFront = [...this.placements].sort((a, b) => {
                const la = order[a.layer] || 3, lb = order[b.layer] || 3;
                if (la !== lb) return lb - la;
                return b.grid_y - a.grid_y;
            });

            for (const p of sortedFront) {
                const item = cat.getItemDef(p.item_id, this.inventoryMap);
                const fp = cat.getFootprint(item);
                const x0 = p.grid_x * TILE;
                const x1 = (p.grid_x + fp.spanX) * TILE;
                const y1 = (p.grid_y + fp.spanY) * TILE;
                const lift = (p.layer === 'surface' && this.hasSurfaceHostAt(p.grid_x, p.grid_y)) ? 14 : 0;
                const extraTop = p.layer === 'floor' ? 14 : lift;
                const y0 = p.grid_y * TILE - extraTop;
                if (lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1) return p;
            }
            return null;
        }

        _getCanvasPos(e) {
            const rect = this.canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        _bindEvents() {
            this._onResize = () => this.resize(false);
            window.addEventListener('resize', this._onResize);
            if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
                this._ro = new ResizeObserver(() => this.resize(false));
                this._ro.observe(this.canvas.parentElement);
            }

            this._onPointerMove = (e) => {
                if (e.pointerType === 'touch') return;
                const pos = this._getCanvasPos(e);
                this.hoverTile = this.screenToGrid(pos.x, pos.y);
            };
            this._onPointerLeave = () => { this.hoverTile = null; };
            this._onPointerDown = (e) => { this._pointerDownPos = { x: e.clientX, y: e.clientY }; };
            this._onPointerUp = (e) => {
                if (!this._pointerDownPos) return;
                const dist = Math.hypot(e.clientX - this._pointerDownPos.x, e.clientY - this._pointerDownPos.y);
                this._pointerDownPos = null;
                if (dist > 14) return;

                const pos = this._getCanvasPos(e);
                const tile = this.screenToGrid(pos.x, pos.y);

                if (this.placingItemId) {
                    if (!tile) return;
                    if (this.canPlaceAt(this.placingItemId, tile.x, tile.y).ok && this.callbacks.onTilePlace) {
                        this.callbacks.onTilePlace(this.placingItemId, tile.x, tile.y, this.placingRotation);
                    } else if (this.callbacks.onInvalidTile) {
                        this.callbacks.onInvalidTile(this.placingItemId);
                    }
                    return;
                }

                if (this.movingPlacement) {
                    if (!tile) return;
                    const p = this.movingPlacement;
                    if (this.canPlaceAt(p.item_id, tile.x, tile.y, p.id).ok && this.callbacks.onTileMove) {
                        this.callbacks.onTileMove(p, tile.x, tile.y, p.rotation);
                    } else if (this.callbacks.onInvalidTile) {
                        this.callbacks.onInvalidTile(p.item_id);
                    }
                    return;
                }

                const hit = this.pickPlacementAt(pos.x, pos.y);
                this.selectedPlacementId = hit ? hit.id : null;
                if (this.callbacks.onSelectPlacement) this.callbacks.onSelectPlacement(hit);
            };

            this.canvas.addEventListener('pointermove', this._onPointerMove);
            this.canvas.addEventListener('pointerleave', this._onPointerLeave);
            this.canvas.addEventListener('pointerdown', this._onPointerDown);
            this.canvas.addEventListener('pointerup', this._onPointerUp);
        }

        destroy() {
            this._destroyed = true;
            if (this._rafId) cancelAnimationFrame(this._rafId);
            window.removeEventListener('resize', this._onResize);
            if (this._ro) this._ro.disconnect();
            this.canvas.removeEventListener('pointermove', this._onPointerMove);
            this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
            this.canvas.removeEventListener('pointerdown', this._onPointerDown);
            this.canvas.removeEventListener('pointerup', this._onPointerUp);
        }

        _startLoop() {
            const tick = (ts) => {
                if (this._destroyed) return;
                this._updatePet(ts);
                this.render(ts);
                this._rafId = requestAnimationFrame(tick);
            };
            this._rafId = requestAnimationFrame(tick);
        }

        _updatePet(now) {
            if (!this.showPet) return;
            const dt = Math.min(80, Math.max(0, now - this.pet.lastTick));
            this.pet.lastTick = now;
            this.pet.timer -= dt;

            if (this.pet.state === 'walk') {
                const dx = this.pet.tx - this.pet.x;
                const dy = this.pet.ty - this.pet.y;
                const dist = Math.hypot(dx, dy);
                const speed = 0.0014 * dt;
                if (dist <= speed || dist < 0.05) {
                    this.pet.x = this.pet.tx;
                    this.pet.y = this.pet.ty;
                    // 检查是否走到了地毯或猫爬架附近 -> 快乐打盹！
                    const nearCozy = this.placements.some((p) => {
                        if (p.layer !== 'rug' && p.item_id !== 'cat_tree') return false;
                        return Math.hypot(p.grid_x + 0.5 - this.pet.x, p.grid_y + 0.5 - this.pet.y) < 1.8;
                    });
                    this.pet.state = nearCozy ? 'sleep' : 'idle';
                    this.pet.timer = nearCozy ? 4200 : 1800 + Math.random() * 1800;
                } else {
                    this.pet.x += (dx / dist) * speed;
                    this.pet.y += (dy / dist) * speed;
                    if (Math.abs(dx) > 0.01) this.pet.facing = dx >= 0 ? 1 : -1;
                }
            } else if (this.pet.timer <= 0) {
                // 挑一个地板空位去散步
                const targetX = 0.8 + Math.random() * (GRID_W - 1.6);
                const targetY = WALL_ROWS + 0.6 + Math.random() * (GRID_H - WALL_ROWS - 1.1);
                this.pet.tx = targetX;
                this.pet.ty = targetY;
                this.pet.state = 'walk';
                this.pet.timer = 6000;
            }
        }

        render(now = 0) {
            const ctx = this.ctx;
            const pctx = this.pctx;
            const cat = global.CloudHomeCatalog;
            const lighting = this.getResolvedLighting();
            const isNight = lighting === 'night';
            const isSunset = lighting === 'sunset';

            // 1. 柔和深色舞台背景
            const bgGrad = ctx.createRadialGradient(
                this.cssW / 2, this.cssH / 2, 16,
                this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.72
            );
            if (isNight) {
                bgGrad.addColorStop(0, '#1e2136'); bgGrad.addColorStop(1, '#0e101a');
            } else if (isSunset) {
                bgGrad.addColorStop(0, '#362326'); bgGrad.addColorStop(1, '#161114');
            } else {
                bgGrad.addColorStop(0, '#29231f'); bgGrad.addColorStop(1, '#141210');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, this.cssW, this.cssH);

            // 2. 绘制 32px 精装宽屏像素屋底盘
            const wallSkin = cat.WALL_SKINS[this.room.wall_skin] || cat.WALL_SKINS.wall_cream;
            const floorSkin = cat.FLOOR_SKINS[this.room.floor_skin] || cat.FLOOR_SKINS.floor_warm_wood;
            const winSkinId = this.room.window_skin || 'window_clouds_day';
            this._drawPixelRoomShell(pctx, wallSkin, floorSkin, winSkinId, lighting, now);

            // 编辑态绿色网格高亮
            const activeItemId = this.placingItemId || (this.movingPlacement && this.movingPlacement.item_id);
            if (activeItemId) {
                const ignoreId = this.movingPlacement ? this.movingPlacement.id : null;
                this._drawPixelGridOverlay(pctx, activeItemId, ignoreId);
            }

            // 3. 墙饰 & 痛墙挂画层 (wall)
            for (const p of this.placements.filter((x) => x.layer === 'wall')) {
                this._drawPlacementPixel(pctx, p, now);
            }

            // 4. 地毯层 (rug)
            for (const p of this.placements.filter((x) => x.layer === 'rug')) {
                this._drawPlacementPixel(pctx, p, now);
            }

            // 5. 立体家具 + 桌面摆件 + 像素小猫，按 Y 坐标严格画家排序！
            const renderQueue = [];
            for (const p of this.placements) {
                if (p.layer === 'wall' || p.layer === 'rug') continue;
                const item = cat.getItemDef(p.item_id, this.inventoryMap);
                const fp = cat.getFootprint(item);
                const sortY = (p.grid_y + fp.spanY) + (p.layer === 'surface' ? 0.15 : 0);
                renderQueue.push({ kind: 'placement', sortY, data: p });
            }
            if (this.showPet) {
                renderQueue.push({ kind: 'pet', sortY: this.pet.y + 0.5 });
            }
            renderQueue.sort((a, b) => a.sortY - b.sortY);

            for (const node of renderQueue) {
                if (node.kind === 'pet') this._drawPixelCat(pctx, now);
                else this._drawPlacementPixel(pctx, node.data, now);
            }

            // 6. 鼠标悬停半透明预览
            if (activeItemId && this.hoverTile) {
                const ignoreId = this.movingPlacement ? this.movingPlacement.id : null;
                if (this.canPlaceAt(activeItemId, this.hoverTile.x, this.hoverTile.y, ignoreId).ok) {
                    const rot = this.placingItemId ? this.placingRotation : this.movingPlacement.rotation;
                    const item = cat.getItemDef(activeItemId, this.inventoryMap);
                    pctx.save();
                    pctx.globalAlpha = 0.64;
                    this._drawPlacementPixel(pctx, {
                        id: -1, item_id: activeItemId,
                        grid_x: this.hoverTile.x, grid_y: this.hoverTile.y,
                        rotation: rot, layer: item ? item.layer : 'floor'
                    }, now);
                    pctx.restore();
                }
            }

            // 7. 无损放大上屏
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
            ctx.fillRect(this.drawX + 6, this.drawY + 8, this.drawW, this.drawH);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.pixelBuf, this.drawX, this.drawY, this.drawW, this.drawH);
            ctx.restore();

            // 8. 昼夜环境光罩 & 暖黄灯具光晕
            this._drawAtmosphereAndLights(ctx, lighting, now);
        }

        _drawPixelRoomShell(pctx, wallSkin, floorSkin, winSkinId, lighting, now) {
            const roomW = GRID_W * TILE;
            const roomH = GRID_H * TILE;
            const wallH = WALL_ROWS * TILE;
            const totalW = roomW + RIM * 2;
            const totalH = roomH + RIM * 2;

            // 外墙暗棕像素框
            pctx.fillStyle = '#1f1714'; pctx.fillRect(0, 0, totalW, totalH);
            pctx.fillStyle = '#3b2c25'; pctx.fillRect(2, 2, totalW - 4, totalH - 4);
            pctx.fillStyle = '#1f1714'; pctx.fillRect(RIM - 2, RIM - 2, roomW + 4, roomH + 4);

            // --- 正面墙壁 (384 × 64 px) ---
            pctx.fillStyle = wallSkin.base;
            pctx.fillRect(RIM, RIM, roomW, wallH);

            if (wallSkin.pattern === 'stripes') {
                pctx.fillStyle = wallSkin.accent;
                for (let x = 0; x < roomW; x += 10) pctx.fillRect(RIM + x, RIM, 5, wallH - 20);
            } else if (wallSkin.pattern === 'dots') {
                pctx.fillStyle = wallSkin.accent;
                for (let x = 8; x < roomW; x += 16) {
                    for (let y = 8; y < wallH - 20; y += 12) pctx.fillRect(RIM + x, RIM + y, 2, 2);
                }
            } else if (wallSkin.pattern === 'wood') {
                pctx.fillStyle = wallSkin.accent;
                for (let x = 0; x < roomW; x += 10) pctx.fillRect(RIM + x, RIM, 2, wallH - 20);
            }

            // 护墙板 & 腰线 & 踢脚线
            pctx.fillStyle = wallSkin.wainscot;
            pctx.fillRect(RIM, RIM + wallH - 18, roomW, 16);
            pctx.fillStyle = wallSkin.wainscotDark;
            for (let x = 8; x < roomW; x += 14) pctx.fillRect(RIM + x, RIM + wallH - 17, 2, 15);
            pctx.fillStyle = wallSkin.trim;
            pctx.fillRect(RIM, RIM + wallH - 20, roomW, 2);
            pctx.fillStyle = '#2c1e18';
            pctx.fillRect(RIM, RIM + wallH - 2, roomW, 2);

            // --- 6 格超宽全景景观大窗 (横跨 x = 3..8, 宽 192px 高 46px!) ---
            const wx = RIM + 3 * TILE + 2;
            const wy = RIM + 8;
            const ww = 6 * TILE - 4;
            const wh = 44;
            this._drawPanoramicWindow(pctx, wx, wy, ww, wh, winSkinId, lighting, now);

            // --- 平面 XY 像素地板 (y = 2..7) ---
            for (let gx = 0; gx < GRID_W; gx++) {
                for (let gy = WALL_ROWS; gy < GRID_H; gy++) {
                    const px = RIM + gx * TILE;
                    const py = RIM + gy * TILE;
                    pctx.fillStyle = (gx + gy) % 2 === 0 ? floorSkin.a : floorSkin.b;
                    pctx.fillRect(px, py, TILE, TILE);

                    if (floorSkin.style === 'checker') {
                        pctx.fillStyle = floorSkin.plankLine;
                        pctx.fillRect(px, py + TILE - 1, TILE, 1);
                        pctx.fillRect(px + TILE - 1, py, 1, TILE);
                    } else if (floorSkin.style === 'herringbone') {
                        pctx.fillStyle = floorSkin.plankLine;
                        for (let r = 7; r < TILE; r += 8) pctx.fillRect(px, py + r, TILE, 1);
                        pctx.fillRect(px + ((gy % 2) * 14 + 5), py, 1, 8);
                        pctx.fillRect(px + (((gy + 1) % 2) * 14 + 10), py + 8, 1, 8);
                        pctx.fillRect(px + ((gy % 2) * 14 + 3), py + 16, 1, 8);
                        pctx.fillRect(px + (((gy + 1) % 2) * 14 + 12), py + 24, 1, 8);
                        pctx.fillStyle = floorSkin.highlight;
                        pctx.fillRect(px + 3, py + 2, 6, 1);
                    } else {
                        pctx.fillStyle = floorSkin.plankLine;
                        pctx.fillRect(px, py + 10, TILE, 1);
                        pctx.fillRect(px, py + 21, TILE, 1);
                        pctx.fillRect(px, py + 31, TILE, 1);
                        pctx.fillRect(px + ((gy % 2) ? 8 : 20), py, 1, 10);
                        pctx.fillRect(px + ((gy % 2) ? 22 : 10), py + 11, 1, 10);
                        pctx.fillRect(px + ((gy % 2) ? 14 : 25), py + 22, 1, 9);
                        pctx.fillStyle = floorSkin.highlight;
                        pctx.fillRect(px + 3, py + 2, 8, 1);
                    }
                }
            }

            // 墙脚接触软影
            pctx.fillStyle = 'rgba(18, 11, 8, 0.22)';
            pctx.fillRect(RIM, RIM + wallH, roomW, 5);
            pctx.fillStyle = 'rgba(18, 11, 8, 0.10)';
            pctx.fillRect(RIM, RIM + wallH + 5, roomW, 3);

            // 全景窗洒落地板的天光块
            const beam = (lighting === 'night' || winSkinId === 'window_city_night' || winSkinId === 'window_blinds_moon')
                ? 'rgba(147, 197, 253, 0.09)'
                : (lighting === 'sunset' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(254, 249, 195, 0.15)');
            pctx.fillStyle = beam;
            pctx.fillRect(wx + 4, RIM + wallH + 2, ww - 8, 28);
        }

        _drawPanoramicWindow(pctx, wx, wy, ww, wh, winSkinId, lighting, now) {
            const cat = global.CloudHomeCatalog;

            // 外窗框与窗台板
            pctx.fillStyle = '#241914'; pctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 7);
            pctx.fillStyle = '#5e4537'; pctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
            pctx.fillStyle = '#7d5f4d'; pctx.fillRect(wx - 4, wy + wh + 1, ww + 8, 3);

            // 如果用户往 public/home/sprites/ 放了专属窗景 PNG（如 window_city_night.png），直接高清渲染！
            const extWin = cat.getExternalImage(winSkinId);
            if (extWin) {
                pctx.drawImage(extWin, wx, wy, ww, wh);
            } else if (winSkinId === 'window_city_night') {
                // 🏙️ 赛博紫夜城市天际线（致敬参考图暗紫猫猫公寓！）
                pctx.fillStyle = '#2b254a'; pctx.fillRect(wx, wy, ww, 16);
                pctx.fillStyle = '#3f3569'; pctx.fillRect(wx, wy + 16, ww, 14);
                pctx.fillStyle = '#5a4d82'; pctx.fillRect(wx, wy + 30, ww, wh - 30);
                // 远景建筑剪影
                const backB = [[6, 18, 18], [28, 12, 22], [58, 20, 20], [86, 10, 24], [116, 16, 20], [144, 14, 22], [170, 20, 16]];
                pctx.fillStyle = '#47406b';
                backB.forEach(([bx, bh, bw]) => pctx.fillRect(wx + bx, wy + wh - bh - 12, bw, bh + 12));
                // 近景大楼与闪烁霓虹窗格
                const frontB = [[2, 22, 16], [22, 28, 18], [46, 18, 22], [74, 32, 20], [100, 24, 18], [124, 30, 22], [152, 20, 18], [174, 26, 14]];
                frontB.forEach(([bx, bh, bw], idx) => {
                    pctx.fillStyle = '#27233d';
                    pctx.fillRect(wx + bx, wy + wh - bh, bw, bh);
                    for (let ry = wy + wh - bh + 3; ry < wy + wh - 3; ry += 5) {
                        for (let rx = wx + bx + 3; rx < wx + bx + bw - 3; rx += 5) {
                            if ((rx + ry + idx) % 3 !== 0) {
                                pctx.fillStyle = (rx + idx) % 4 === 0 ? '#f9a8d4' : '#fde68a';
                                pctx.fillRect(rx, ry, 2, 2);
                            }
                        }
                    }
                });
            } else if (winSkinId === 'window_blinds_moon') {
                // 🌙 深夜百叶窗星月夜
                pctx.fillStyle = '#151833'; pctx.fillRect(wx, wy, ww, wh);
                pctx.fillStyle = '#2a244f'; pctx.fillRect(wx, wy + 24, ww, 20);
                pctx.fillStyle = '#3b326b'; pctx.fillRect(wx + 24, wy + 28, 70, 8); pctx.fillRect(wx + 110, wy + 22, 58, 10);
                // 弯月与闪烁星点
                pctx.fillStyle = '#fef08a'; pctx.fillRect(wx + 148, wy + 10, 12, 12);
                pctx.fillStyle = '#151833'; pctx.fillRect(wx + 145, wy + 10, 7, 9);
                const stars = [[18, 16], [42, 12], [78, 18], [116, 14], [134, 22], [172, 18]];
                stars.forEach(([sx, sy], i) => {
                    if (Math.sin(now * 0.003 + i * 1.9) > -0.25) {
                        pctx.fillStyle = '#fef9c3'; pctx.fillRect(wx + sx, wy + sy, 2, 2);
                    }
                });
                // 半拉百叶窗横向条纹
                for (let by = wy + 1; by < wy + 20; by += 4) {
                    pctx.fillStyle = 'rgba(186, 198, 224, 0.34)';
                    pctx.fillRect(wx, by, ww, 2);
                }
            } else if (winSkinId === 'window_stream_day') {
                // 🌿 阳光绿野溪流庭院
                pctx.fillStyle = '#b4dea0'; pctx.fillRect(wx, wy, ww, wh);
                pctx.fillStyle = '#97cc82'; pctx.fillRect(wx, wy + 20, ww, 24);
                // 蜿蜒蓝绿小溪
                pctx.fillStyle = '#7dd3fc';
                pctx.fillRect(wx + 94, wy, 22, 12);
                pctx.fillRect(wx + 82, wy + 12, 26, 14);
                pctx.fillRect(wx + 70, wy + 26, 28, 18);
                pctx.fillStyle = '#bae6fd';
                pctx.fillRect(wx + 88, wy + 16, 8, 2);
                pctx.fillRect(wx + 78, wy + 32, 10, 2);
                // 草丛与小红黄野花
                const flowers = [[24, 28, '#fb7185'], [32, 34, '#facc15'], [54, 24, '#f472b6'], [138, 26, '#fb7185'], [156, 34, '#fde047'], [168, 22, '#ffffff']];
                flowers.forEach(([fx, fy, col]) => {
                    pctx.fillStyle = '#4d8a4b'; pctx.fillRect(wx + fx, wy + fy + 2, 2, 4);
                    pctx.fillStyle = col; pctx.fillRect(wx + fx, wy + fy, 3, 3);
                });
            } else {
                // ☁️ 宫崎骏蓝天蓬松白云（随白天/黄昏/深夜变天色）
                if (lighting === 'night') {
                    pctx.fillStyle = '#121a38'; pctx.fillRect(wx, wy, ww, wh);
                    pctx.fillStyle = '#1e2c59'; pctx.fillRect(wx, wy + 24, ww, 20);
                    [[24, 10], [64, 16], [110, 9], [150, 15], [174, 22]].forEach(([sx, sy], i) => {
                        if (Math.sin(now * 0.003 + i * 2) > -0.2) {
                            pctx.fillStyle = '#fef3c7'; pctx.fillRect(wx + sx, wy + sy, 2, 2);
                        }
                    });
                } else if (lighting === 'sunset') {
                    pctx.fillStyle = '#9a3412'; pctx.fillRect(wx, wy, ww, 14);
                    pctx.fillStyle = '#ea580c'; pctx.fillRect(wx, wy + 14, ww, 15);
                    pctx.fillStyle = '#fdba74'; pctx.fillRect(wx, wy + 29, ww, wh - 29);
                    pctx.fillStyle = '#fef08a'; pctx.fillRect(wx + 86, wy + 20, 16, 12);
                } else {
                    pctx.fillStyle = '#60a5fa'; pctx.fillRect(wx, wy, ww, 22);
                    pctx.fillStyle = '#93c5fd'; pctx.fillRect(wx, wy + 22, ww, wh - 22);
                    const drift = Math.floor((now * 0.005) % (ww - 40));
                    pctx.fillStyle = '#ffffff';
                    pctx.fillRect(wx + 10 + drift, wy + 16, 26, 9); pctx.fillRect(wx + 16 + drift, wy + 12, 14, 5);
                    const d2 = (drift + 95) % (ww - 36);
                    pctx.fillRect(wx + 8 + d2, wy + 24, 22, 8); pctx.fillRect(wx + 12 + d2, wy + 20, 12, 4);
                }
            }

            // 精致三等分竖向落地窗棂
            pctx.fillStyle = '#473327';
            pctx.fillRect(wx + Math.floor(ww / 3), wy, 3, wh);
            pctx.fillRect(wx + Math.floor((ww * 2) / 3), wy, 3, wh);
            pctx.fillRect(wx, wy + wh - 12, ww, 2);
        }

        _drawPixelGridOverlay(pctx, itemId, ignoreId) {
            const item = global.CloudHomeCatalog.getItemDef(itemId, this.inventoryMap);
            if (!item) return;

            for (let gx = 0; gx < GRID_W; gx++) {
                for (let gy = 0; gy < GRID_H; gy++) {
                    if (item.layer === 'wall' && gy >= WALL_ROWS) continue;
                    if (item.layer !== 'wall' && gy < WALL_ROWS) continue;

                    const ok = this.canPlaceAt(itemId, gx, gy, ignoreId).ok;
                    const isHover = this.hoverTile && this.hoverTile.x === gx && this.hoverTile.y === gy;
                    const px = RIM + gx * TILE;
                    const py = RIM + gy * TILE;

                    pctx.fillStyle = ok
                        ? (isHover ? 'rgba(74, 222, 128, 0.45)' : 'rgba(74, 222, 128, 0.16)')
                        : (isHover ? 'rgba(248, 113, 113, 0.45)' : 'rgba(248, 113, 113, 0.08)');
                    pctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
                    pctx.strokeStyle = ok ? 'rgba(134, 239, 172, 0.65)' : 'rgba(248, 113, 113, 0.35)';
                    pctx.lineWidth = 1;
                    pctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
                }
            }
        }

        _drawPlacementPixel(pctx, p, now) {
            const cat = global.CloudHomeCatalog;
            const item = cat.getItemDef(p.item_id, this.inventoryMap);
            if (!item) return;

            const fp = cat.getFootprint(item);
            const boxX = RIM + p.grid_x * TILE;
            const boxY = RIM + p.grid_y * TILE;
            const boxW = fp.spanX * TILE;
            const boxH = fp.spanY * TILE;

            const isSelected = p.id === this.selectedPlacementId;
            const isMoving = this.movingPlacement && p.id === this.movingPlacement.id;

            if (isSelected) {
                pctx.fillStyle = 'rgba(251, 191, 36, 0.26)';
                pctx.fillRect(boxX, boxY, boxW, boxH);
                pctx.strokeStyle = '#fbbf24';
                pctx.lineWidth = 1;
                pctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
            }

            // 🔥 DIY 痛墙挂画 & 亚克力立牌专属渲染器！
            if (item.isDiy) {
                const img = cat.getDiyImage(item.imageUrl, item.pixelated);
                pctx.save();
                if (isMoving) pctx.globalAlpha = 0.42;

                if (item.diyKind === 'poster') {
                    // 痛墙挂画：精致木/金像素画框贴正面墙
                    const fw = 26, fh = 26;
                    const fx = boxX + Math.floor((boxW - fw) / 2);
                    const fy = boxY + Math.floor((boxH - fh) / 2);
                    pctx.fillStyle = 'rgba(0,0,0,0.28)';
                    pctx.fillRect(fx + 2, fy + 2, fw, fh);
                    pctx.fillStyle = '#e5c17b';
                    pctx.fillRect(fx, fy, fw, fh);
                    pctx.fillStyle = '#fffaf0';
                    pctx.fillRect(fx + 2, fy + 2, fw - 4, fh - 4);
                    if (img) {
                        pctx.imageSmoothingEnabled = !item.pixelated;
                        pctx.drawImage(img, fx + 3, fy + 3, fw - 6, fh - 6);
                        pctx.imageSmoothingEnabled = false;
                    }
                } else {
                    // ✨ 透明底亚克力立牌：放书桌/茶几上时自动抬高稳稳站上桌面！
                    const onTable = this.hasSurfaceHostAt(p.grid_x, p.grid_y);
                    const liftY = onTable ? 12 : 0;
                    const baseY = boxY + boxH - 5 - liftY;
                    // 亚克力半透明椭圆底座 + 反光高光
                    pctx.fillStyle = 'rgba(224, 242, 254, 0.55)';
                    pctx.fillRect(boxX + 6, baseY, 20, 4);
                    pctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    pctx.fillRect(boxX + 8, baseY, 16, 1);
                    pctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
                    pctx.strokeRect(boxX + 5.5, baseY - 0.5, 21, 5);

                    if (img) {
                        const maxW = 26, maxH = 30;
                        const r = Math.min(maxW / img.width, maxH / img.height);
                        const dw = Math.max(8, Math.round(img.width * r));
                        const dh = Math.max(8, Math.round(img.height * r));
                        const dx = boxX + Math.floor((boxW - dw) / 2);
                        const dy = baseY - dh + 1;
                        pctx.imageSmoothingEnabled = !item.pixelated;
                        if (p.rotation % 2 === 1) {
                            pctx.translate(dx + dw, dy);
                            pctx.scale(-1, 1);
                            pctx.drawImage(img, 0, 0, dw, dh);
                        } else {
                            pctx.drawImage(img, dx, dy, dw, dh);
                        }
                        pctx.imageSmoothingEnabled = false;
                    }
                }
                pctx.restore();
                return;
            }

            // 普通家具（优先使用 public/home/sprites/ 外部高清像素 PNG，无图则用内置精灵）
            const spInfo = cat.getSpriteAsset(p.item_id);
            if (!spInfo) return;
            const sprite = spInfo.asset;

            let drawW, drawH;
            if (item.layer === 'rug') {
                drawW = boxW - 2;
                drawH = boxH - 4;
            } else if (spInfo.isExternal) {
                // 外部高清 PNG 按宽适配网格，高允许自然向上延伸保留 3/4 俯视立体感！
                const targetW = boxW + 2;
                const scale = Math.min(targetW / sprite.width, (boxH + 22) / sprite.height);
                drawW = Math.round(sprite.width * scale);
                drawH = Math.round(sprite.height * scale);
            } else {
                // 内置像素精灵按 1.35 倍适配 32px 网格
                const baseScale = item.layer === 'surface' ? 1.4 : 1.55;
                drawW = Math.round(sprite.width * baseScale);
                drawH = Math.round(sprite.height * baseScale);
                if (drawW > boxW + 2) {
                    const ratio = (boxW + 2) / drawW;
                    drawW = Math.round(drawW * ratio);
                    drawH = Math.round(drawH * ratio);
                }
            }

            const onTable = (item.layer === 'surface' && this.hasSurfaceHostAt(p.grid_x, p.grid_y));
            const liftY = onTable ? 12 : 0;
            const dx = Math.round(boxX + (boxW - drawW) / 2);
            const dy = item.layer === 'wall'
                ? Math.round(boxY + (boxH - drawH) / 2)
                : Math.round(boxY + boxH - drawH - 2 - liftY);

            pctx.save();
            if (isMoving) pctx.globalAlpha = 0.42;

            if (item.layer === 'floor' || (item.layer === 'surface' && !onTable)) {
                pctx.fillStyle = 'rgba(18, 11, 8, 0.22)';
                pctx.fillRect(dx + 3, boxY + boxH - 4, Math.max(6, drawW - 6), 3);
            }

            if (p.rotation % 2 === 1) {
                pctx.translate(dx + drawW, dy);
                pctx.scale(-1, 1);
                pctx.drawImage(sprite, 0, 0, drawW, drawH);
            } else {
                pctx.drawImage(sprite, dx, dy, drawW, drawH);
            }

            if (!spInfo.isExternal && p.item_id === 'candle_stand' && Math.sin(now * 0.01 + p.id) > 0) {
                pctx.fillStyle = '#fef08a';
                pctx.fillRect(dx + Math.floor(drawW / 2), dy, 2, 2);
            }
            pctx.restore();
        }

        _drawPixelCat(pctx, now) {
            const cx = Math.round(RIM + this.pet.x * TILE);
            const cy = Math.round(RIM + this.pet.y * TILE);
            const bob = this.pet.state === 'walk' ? Math.round(Math.abs(Math.sin(now * 0.014)) * 2) : 0;

            pctx.save();
            // 脚下软影
            pctx.fillStyle = 'rgba(0,0,0,0.24)';
            pctx.fillRect(cx - 7, cy + 3, 14, 3);

            pctx.translate(cx, cy - bob);
            if (this.pet.facing < 0) pctx.scale(-1, 1);

            if (this.pet.state === 'sleep') {
                // 团成一小球的打盹黑猫
                pctx.fillStyle = '#18141c';
                pctx.fillRect(-7, -3, 14, 7);
                pctx.fillRect(-5, -5, 10, 2);
                // 小耳朵与尾巴
                pctx.fillRect(-6, -7, 2, 2);
                pctx.fillRect(-2, -7, 2, 2);
                pctx.fillStyle = '#f472b6';
                pctx.fillRect(-5, -6, 1, 1);
                // 呼吸 zZz 像素点
                const zOff = Math.floor((now * 0.004) % 6);
                pctx.fillStyle = '#e2e8f0';
                pctx.fillRect(5, -9 - zOff, 3, 1);
                pctx.fillRect(6, -8 - zOff, 1, 1);
                pctx.fillRect(5, -7 - zOff, 3, 1);
            } else {
                // 灵动小黑猫（会摇尾巴！）
                const tailWig = Math.sin(now * 0.008) > 0 ? 1 : 0;
                pctx.fillStyle = '#18141c';
                // 身体与小腿
                pctx.fillRect(-6, -4, 11, 7);
                pctx.fillRect(-5, 3, 2, 2);
                pctx.fillRect(2, 3, 2, 2);
                // 尾巴
                pctx.fillRect(-8, -6 + tailWig, 2, 4);
                pctx.fillRect(-9, -8 + tailWig, 2, 2);
                // 猫头与双耳
                pctx.fillRect(1, -10, 8, 7);
                pctx.fillRect(1, -12, 2, 2);
                pctx.fillRect(7, -12, 2, 2);
                // 亮晶晶金色小眼睛
                pctx.fillStyle = '#fde047';
                pctx.fillRect(3, -7, 2, 2);
                pctx.fillRect(7, -7, 2, 2);
                // 粉色小鼻尖
                pctx.fillStyle = '#f9a8d4';
                pctx.fillRect(5, -5, 2, 1);
            }
            pctx.restore();
        }

        _drawAtmosphereAndLights(ctx, lighting, now) {
            const cat = global.CloudHomeCatalog;
            if (lighting === 'night') {
                ctx.fillStyle = 'rgba(10, 14, 34, 0.36)';
                ctx.fillRect(this.drawX, this.drawY, this.drawW, this.drawH);
            } else if (lighting === 'sunset') {
                ctx.fillStyle = 'rgba(190, 78, 24, 0.14)';
                ctx.fillRect(this.drawX, this.drawY, this.drawW, this.drawH);
            }

            if (lighting === 'night' || lighting === 'sunset') {
                ctx.save();
                ctx.beginPath();
                ctx.rect(this.drawX, this.drawY, this.drawW, this.drawH);
                ctx.clip();
                ctx.globalCompositeOperation = 'lighter';

                for (const p of this.placements) {
                    const item = cat.getItemDef(p.item_id, this.inventoryMap);
                    if (!item || !item.emitsLight) continue;
                    const lx = RIM + (p.grid_x + 0.5) * TILE;
                    const ly = RIM + (p.grid_y + (item.lightOffsetY ?? 0.3)) * TILE;
                    const cx = this.drawX + lx * this.pixelScale;
                    const cy = this.drawY + ly * this.pixelScale;
                    const pulse = 1 + 0.04 * Math.sin(now * 0.005 + p.id);
                    const rad = (item.lightRadius || 84) * this.pixelScale * pulse;

                    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
                    const peak = lighting === 'night' ? 0.54 : 0.28;
                    grad.addColorStop(0, `rgba(254, 240, 138, ${peak})`);
                    grad.addColorStop(0.45, `rgba(245, 158, 11, ${(peak * 0.4).toFixed(2)})`);
                    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
        }
    }

    global.CloudHomeEngine = CloudHomeEngine;
})(window);