(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'batching_idb_pickup_safe_v2',
                                            order: 40,
                                            description: "拾取/存档批处理与安全优化（v2）",
                                            apply: () => {
                                                (function () {
                                                    'use strict';

                                                    var TU = window.TU || {};
                                                    var Renderer = TU.Renderer;
                                                    var SaveSystem = TU.SaveSystem;
                                                    var DroppedItem = TU.DroppedItem;
                                                    var DroppedItemManager = TU.DroppedItemManager;

                                                    var CONFIG = TU.CONFIG || window.CONFIG;
                                                    var Utils = TU.Utils || window.Utils;
                                                    var BLOCK = TU.BLOCK || window.BLOCK;

                                                    // 兼容：BLOCK_LIGHT / BLOCK_COLOR 多为 script 顶层 const（不挂在 window），用 typeof 取更稳
                                                    var BL = null;
                                                    try { BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : (window.BLOCK_LIGHT || TU.BLOCK_LIGHT); } catch (e) { BL = window.BLOCK_LIGHT || TU.BLOCK_LIGHT; }
                                                    var BC = null;
                                                    try { BC = (typeof BLOCK_COLOR !== 'undefined') ? BLOCK_COLOR : (window.BLOCK_COLOR || TU.BLOCK_COLOR); } catch (e2) { BC = window.BLOCK_COLOR || TU.BLOCK_COLOR; }

                                                    // Toast 兼容（同样可能是顶层 const）
                                                    var ToastRef = null;
                                                    try { ToastRef = (typeof Toast !== 'undefined') ? Toast : (TU.Toast || window.Toast); } catch (e3) { ToastRef = TU.Toast || window.Toast; }

                                                    // ───────────────────────── Patch Flags ─────────────────────────
                                                    var FLAGS = window.__TU_PATCH_FLAGS__ = window.__TU_PATCH_FLAGS__ || {};
                                                    try {
                                                        if (FLAGS.disableChunkBatching == null) FLAGS.disableChunkBatching = (localStorage.getItem('TU_DISABLE_CHUNK_BATCHING') === '1');
                                                        if (FLAGS.disableIDBSave == null) FLAGS.disableIDBSave = (localStorage.getItem('TU_DISABLE_IDB_SAVE') === '1');
                                                        if (FLAGS.disablePickupAnim == null) FLAGS.disablePickupAnim = (localStorage.getItem('TU_DISABLE_PICKUP_ANIM') === '1');
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    // ───────────────────────── IndexedDB Save (robust, async, fallback) ─────────────────────────
                                                    var idb = (function () {
                                                        var DB_NAME = 'tu_terraria_ultra_save_db_v1';
                                                        var STORE = 'kv';
                                                        var dbPromise = null;

                                                        function open() {
                                                            if (FLAGS.disableIDBSave) return Promise.resolve(null);
                                                            if (!('indexedDB' in window)) return Promise.resolve(null);
                                                            if (dbPromise) return dbPromise;

                                                            dbPromise = new Promise(function (resolve) {
                                                                try {
                                                                    var req = indexedDB.open(DB_NAME, 1);
                                                                    req.onupgradeneeded = function () {
                                                                        try {
                                                                            var db = req.result;
                                                                            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                    };
                                                                    req.onsuccess = function () { resolve(req.result); };
                                                                    req.onerror = function () { resolve(null); };
                                                                } catch (e) {
                                                                    resolve(null);
                                                                }
                                                            });

                                                            return dbPromise;
                                                        }

                                                        function _tx(db, mode) {
                                                            try { return db.transaction(STORE, mode).objectStore(STORE); } catch (_) { return null; }
                                                        }

                                                        function get(key) {
                                                            return open().then(function (db) {
                                                                if (!db) return null;
                                                                return new Promise(function (resolve) {
                                                                    try {
                                                                        var store = _tx(db, 'readonly');
                                                                        if (!store) return resolve(null);
                                                                        var req = store.get(key);
                                                                        req.onsuccess = function () { resolve(req.result || null); };
                                                                        req.onerror = function () { resolve(null); };
                                                                    } catch (e) {
                                                                        resolve(null);
                                                                    }
                                                                });
                                                            });
                                                        }

                                                        function set(key, value) {
                                                            return open().then(function (db) {
                                                                if (!db) return false;
                                                                return new Promise(function (resolve) {
                                                                    try {
                                                                        var store = _tx(db, 'readwrite');
                                                                        if (!store) return resolve(false);
                                                                        var req = store.put(value, key);
                                                                        req.onsuccess = function () { resolve(true); };
                                                                        req.onerror = function () { resolve(false); };
                                                                    } catch (e) {
                                                                        resolve(false);
                                                                    }
                                                                });
                                                            });
                                                        }

                                                        function del(key) {
                                                            return open().then(function (db) {
                                                                if (!db) return false;
                                                                return new Promise(function (resolve) {
                                                                    try {
                                                                        var store = _tx(db, 'readwrite');
                                                                        if (!store) return resolve(false);
                                                                        var req = store.delete(key);
                                                                        req.onsuccess = function () { resolve(true); };
                                                                        req.onerror = function () { resolve(false); };
                                                                    } catch (e) {
                                                                        resolve(false);
                                                                    }
                                                                });
                                                            });
                                                        }

                                                        return { open: open, get: get, set: set, del: del };
                                                    })();

                                                    function decodeSaveDataLikeLocalStorage(data) {
                                                        try {
                                                            if (!data) return null;
                                                            var obj = data;
                                                            if (typeof obj === 'string') {
                                                                obj = JSON.parse(obj);
                                                            }
                                                            if (!obj || obj.v !== 1) return null;

                                                            // 解码 diffs（支持旧版数组 & 新版 RLE）
                                                            var diff = new Map();
                                                            var diffs = obj.diffs;

                                                            // 旧版：["x_y_id", ...]
                                                            if (Array.isArray(diffs)) {
                                                                for (var i = 0; i < diffs.length; i++) {
                                                                    var s = diffs[i];
                                                                    if (typeof s !== 'string') continue;
                                                                    var parts = s.split('_');
                                                                    if (parts.length !== 3) continue;
                                                                    var x = parseInt(parts[0], 36);
                                                                    var y = parseInt(parts[1], 36);
                                                                    var id = parseInt(parts[2], 36);
                                                                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(id)) continue;
                                                                    diff.set(x + ',' + y, id);
                                                                }
                                                            }
                                                            // 新版：{ fmt:'rle1', w, data:[ 'r<start>_<len>_<id>', ... ] }
                                                            else if (diffs && typeof diffs === 'object' && diffs.fmt === 'rle1' && Array.isArray(diffs.data)) {
                                                                var w = Number.isFinite(diffs.w) ? (diffs.w | 0) : (Number.isFinite(obj.w) ? (obj.w | 0) : (CONFIG && CONFIG.WORLD_WIDTH ? CONFIG.WORLD_WIDTH : 2400));
                                                                for (var j = 0; j < diffs.data.length; j++) {
                                                                    var token = diffs.data[j];
                                                                    if (typeof token !== 'string') continue;
                                                                    var t = token.charAt(0) === 'r' ? token.slice(1) : token;
                                                                    var ps = t.split('_');
                                                                    if (ps.length !== 3) continue;
                                                                    var start = parseInt(ps[0], 36);
                                                                    var len = parseInt(ps[1], 36);
                                                                    var bid = parseInt(ps[2], 36);
                                                                    if (!Number.isFinite(start) || !Number.isFinite(len) || !Number.isFinite(bid)) continue;
                                                                    if (len <= 0) continue;

                                                                    var maxLen = len;
                                                                    // 粗略防护：避免极端 token 导致卡死
                                                                    if (maxLen > 500000) maxLen = 500000;

                                                                    for (var k = 0; k < maxLen; k++) {
                                                                        var idx = start + k;
                                                                        var xx = idx % w;
                                                                        var yy = (idx / w) | 0;
                                                                        diff.set(xx + ',' + yy, bid);
                                                                    }
                                                                }
                                                            }

                                                            obj._diffMap = diff;
                                                            return obj;
                                                        } catch (e) {
                                                            return null;
                                                        }
                                                    }

                                                    if (SaveSystem && !SaveSystem.__idbPatchV2Installed) {
                                                        SaveSystem.__idbPatchV2Installed = true;

                                                        // 1) clear：同时清理 localStorage + IndexedDB
                                                        var _oldClear = SaveSystem.clear;
                                                        SaveSystem.clear = function () {
                                                            try { _oldClear && _oldClear.call(SaveSystem); } catch (_) {
                                                                try { localStorage.removeItem(SaveSystem.KEY); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            try { idb.del(SaveSystem.KEY); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };

                                                        // 2) promptStartIfNeeded：如果 localStorage 没有但 IDB 有，也能提示继续
                                                        var _oldPrompt = SaveSystem.promptStartIfNeeded;
                                                        SaveSystem.promptStartIfNeeded = async function () {
                                                            try {
                                                                var hasLS = false;
                                                                try { hasLS = !!localStorage.getItem(SaveSystem.KEY); } catch (_) { hasLS = false; }

                                                                var hasIDB = false;
                                                                if (!hasLS && !FLAGS.disableIDBSave) {
                                                                    try { hasIDB = !!(await idb.get(SaveSystem.KEY)); } catch (_) { hasIDB = false; }
                                                                }

                                                                if (!hasLS && !hasIDB) return { mode: 'new', save: null };

                                                                var overlay = document.getElementById('save-prompt-overlay');
                                                                var btnC = document.getElementById('save-prompt-continue');
                                                                var btnN = document.getElementById('save-prompt-new');
                                                                var btnX = document.getElementById('save-prompt-close');

                                                                if (!overlay || !btnC || !btnN) return { mode: 'new', save: null };

                                                                return await new Promise(function (resolve) {
                                                                    var resolved = false;

                                                                    var cleanup = function () {
                                                                        overlay.classList.remove('show');
                                                                        overlay.setAttribute('aria-hidden', 'true');
                                                                        btnC.removeEventListener('click', onC);
                                                                        btnN.removeEventListener('click', onN);
                                                                        if (btnX) btnX.removeEventListener('click', onX);
                                                                    };

                                                                    var done = function (mode) {
                                                                        if (resolved) return;
                                                                        resolved = true;
                                                                        cleanup();

                                                                        if (mode !== 'continue') {
                                                                            resolve({ mode: mode, save: null });
                                                                            return;
                                                                        }

                                                                        // 继续：优先 localStorage，失败再读 IDB
                                                                        (async function () {
                                                                            var save = null;
                                                                            try { save = SaveSystem.load ? SaveSystem.load() : null; } catch (_) { save = null; }
                                                                            if (!save && !FLAGS.disableIDBSave) {
                                                                                try {
                                                                                    var raw = await idb.get(SaveSystem.KEY);
                                                                                    save = decodeSaveDataLikeLocalStorage(raw);
                                                                                } catch (_) { save = null; }
                                                                            }
                                                                            resolve({ mode: 'continue', save: save });
                                                                        })();
                                                                    };

                                                                    var onC = function () { done('continue'); };
                                                                    var onN = function () { done('new'); };
                                                                    var onX = function () { done('new'); };

                                                                    overlay.classList.add('show');
                                                                    overlay.setAttribute('aria-hidden', 'false');
                                                                    btnC.addEventListener('click', onC);
                                                                    btnN.addEventListener('click', onN);
                                                                    if (btnX) btnX.addEventListener('click', onX);
                                                                });
                                                            } catch (e) {
                                                                // 兜底：回退到旧实现
                                                                try {
                                                                    return _oldPrompt ? await _oldPrompt.call(SaveSystem) : { mode: 'new', save: null };
                                                                } catch (_) {
                                                                    return { mode: 'new', save: null };
                                                                }
                                                            }
                                                        };

                                                        // 3) save：localStorage 写入 + IDB 备份；localStorage 爆 quota 时自动切到 IDB 不影响继续玩
                                                        if (SaveSystem.prototype && typeof SaveSystem.prototype.save === 'function') {
                                                            var _oldSave = SaveSystem.prototype.save;

                                                            SaveSystem.prototype.save = function (reason) {
                                                                // 尽量复用原逻辑；但为了拿到 payload，这里做一次“轻度复制”以保证 IDB 一定能写到
                                                                if (reason === undefined) reason = 'manual';
                                                                if (this._disabled) return;

                                                                var g = this.game;
                                                                if (!g || !g.world || !g.player) return;

                                                                // diff 太大时：停用自动保存，但允许手动保存（尤其是 IDB）
                                                                if (this.diff && this.diff.size > 50000) {
                                                                    if (reason === 'autosave') {
                                                                        if (!this._autosaveDisabled) {
                                                                            this._autosaveDisabled = true;
                                                                            if (ToastRef && ToastRef.show) ToastRef.show('⚠️ 改动过多：自动保存已停用（可手动保存/清理存档）', 2800);
                                                                        }
                                                                        return;
                                                                    }
                                                                }

                                                                var payload = {
                                                                    v: 1,
                                                                    ts: Date.now(),
                                                                    seed: g.seed || this.seed || Date.now(),
                                                                    timeOfDay: g.timeOfDay || 0.35,
                                                                    player: {
                                                                        x: g.player.x, y: g.player.y,
                                                                        health: g.player.health, mana: g.player.mana,
                                                                        inventory: g.player.inventory,
                                                                        selectedSlot: g.player.selectedSlot
                                                                    },
                                                                    w: g.world.w, h: g.world.h,
                                                                    diffs: SaveSystem._encodeDiff ? SaveSystem._encodeDiff(this.diff, g.world.w) : { fmt: 'rle1', w: g.world.w, data: [] }
                                                                };

                                                                var lsOk = false;
                                                                // localStorage 写入（如果此前已确认 quota 不够，可跳过避免每次 throw）
                                                                if (!this._lsFailed) {
                                                                    try {
                                                                        localStorage.setItem(SaveSystem.KEY, JSON.stringify(payload));
                                                                        lsOk = true;
                                                                    } catch (e) {
                                                                        this._lsFailed = true;
                                                                        lsOk = false;
                                                                    }
                                                                }

                                                                // IDB 备份（异步，不阻塞帧）
                                                                if (!FLAGS.disableIDBSave) {
                                                                    try {
                                                                        idb.set(SaveSystem.KEY, payload).then(function (ok) {
                                                                            if (!ok) return;
                                                                            // 若 localStorage 失败，则提示“已保存(IDB)”，避免用户以为没存上
                                                                            if (!lsOk && ToastRef && ToastRef.show) {
                                                                                if (reason === 'manual') ToastRef.show('💾 已保存（IndexedDB）');
                                                                                if (reason === 'autosave') ToastRef.show('✅ 自动保存（IndexedDB）', 1100);
                                                                            }
                                                                        }).catch(_ => { /* silently ignore */ });
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }

                                                                // Toast：保持原体验（localStorage 成功时才显示，避免重复）
                                                                if (lsOk) {
                                                                    try {
                                                                        if (ToastRef && ToastRef.show) {
                                                                            if (reason === 'manual') ToastRef.show('💾 已保存');
                                                                            if (reason === 'autosave') ToastRef.show('✅ 自动保存', 1100);
                                                                        }
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                } else {
                                                                    // 两种存储都不可用时，才彻底禁用
                                                                    if (FLAGS.disableIDBSave) {
                                                                        this._disabled = true;
                                                                        if (ToastRef && ToastRef.show) ToastRef.show('⚠️ 存档失败：空间不足，已停用自动保存', 2600);
                                                                    }
                                                                }
                                                            };

                                                            // tickAutosave：尊重 _autosaveDisabled
                                                            if (typeof SaveSystem.prototype.tickAutosave === 'function') {
                                                                var _oldTick = SaveSystem.prototype.tickAutosave;
                                                                SaveSystem.prototype.tickAutosave = function (dt) {
                                                                    if (this._autosaveDisabled) return;
                                                                    return _oldTick.call(this, dt);
                                                                };
                                                            }
                                                        }
                                                    }

                                                    // ───────────────────────── Chunk Batching (safe v2) ─────────────────────────
                                                    if (Renderer && CONFIG && Utils && BLOCK && BL && !Renderer.prototype.__chunkBatchSafeV2Installed) {
                                                        Renderer.prototype.__chunkBatchSafeV2Installed = true;
                                                        // 配置
                                                        Renderer.prototype.__cb2_cfg = Renderer.prototype.__cb2_cfg || { tiles: 16, maxHigh: 180, maxLow: 90 };

                                                        function _cb2_key(cx, cy) { return cx + ',' + cy; }

                                                        function _cb2_buildDarkLUT(levels, nightBonus) {
                                                            var lut = new Float32Array(256);
                                                            for (var i = 0; i < 256; i++) {
                                                                var darkness = 1 - (i / levels);
                                                                var totalDark = darkness * 0.6 + nightBonus;
                                                                if (totalDark > 0.88) totalDark = 0.88;
                                                                lut[i] = (totalDark > 0.05) ? totalDark : 0;
                                                            }
                                                            return lut;
                                                        }

                                                        Renderer.prototype.__cb2_ensureCache = function (world) {
                                                            if (!this.__cb2_chunkMap || this.__cb2_chunkWorld !== world) {
                                                                this.__cb2_chunkWorld = world;
                                                                this.__cb2_chunkMap = new Map();
                                                                this.__cb2_chunkFrame = 0;
                                                            }
                                                            if (!this.__cb2_chunkFrame) this.__cb2_chunkFrame = 0;
                                                        };

                                                        Renderer.prototype.invalidateAllChunks = function () {
                                                            if (!this.__cb2_chunkMap) return;
                                                            this.__cb2_chunkMap.forEach(function (e) { e.dirty = true; });
                                                        };

                                                        Renderer.prototype.invalidateTile = function (tx, ty) {
                                                            if (!this.__cb2_chunkMap) return;
                                                            var cfg = this.__cb2_cfg || { tiles: 16 };
                                                            var cts = (cfg.tiles | 0) || 16;
                                                            var cx = (tx / cts) | 0;
                                                            var cy = (ty / cts) | 0;
                                                            var key = _cb2_key(cx, cy);
                                                            var e = this.__cb2_chunkMap.get(key);
                                                            if (e) e.dirty = true;
                                                        };

                                                        Renderer.prototype.__cb2_evictIfNeeded = function () {
                                                            var map = this.__cb2_chunkMap;
                                                            if (!map) return;

                                                            var cfg = this.__cb2_cfg || {};
                                                            var max = (this.lowPower ? (cfg.maxLow || 90) : (cfg.maxHigh || 180)) | 0;
                                                            if (map.size <= max) return;

                                                            // 简单 LRU：移除 lastUsed 最小的若干个
                                                            var arr = Array.from(map.values());
                                                            arr.sort(function (a, b) { return (a.lastUsed || 0) - (b.lastUsed || 0); });
                                                            var removeN = Math.min(arr.length, map.size - max);
                                                            for (var i = 0; i < removeN; i++) {
                                                                map.delete(arr[i].key);
                                                            }
                                                        };

                                                        Renderer.prototype.__cb2_rebuildChunk = function (entry, world) {
                                                            var cfg = this.__cb2_cfg || {};
                                                            var cts = (cfg.tiles | 0) || 16;
                                                            var ts = CONFIG.TILE_SIZE;

                                                            var startX = entry.cx * cts;
                                                            var startY = entry.cy * cts;
                                                            var endX = Math.min(world.w, startX + cts);
                                                            var endY = Math.min(world.h, startY + cts);

                                                            var ctx = entry.ctx;
                                                            ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
                                                            ctx.imageSmoothingEnabled = false;

                                                            var tiles = world.tiles;
                                                            var texGen = this.textures;

                                                            for (var x = startX; x < endX; x++) {
                                                                var colTiles = tiles[x];
                                                                var dx = (x - startX) * ts;
                                                                for (var y = startY; y < endY; y++) {
                                                                    var id = colTiles[y];
                                                                    if (id === BLOCK.AIR) continue;

                                                                    // 为了保证“发光方块”外观 100% 与原实现一致：glow 块不烘焙进 chunk，交给后续逐 tile 绘制
                                                                    if (BL && BL[id] > 5) continue;

                                                                    var tex = texGen.get(id);
                                                                    if (tex) ctx.drawImage(tex, dx, (y - startY) * ts);
                                                                }
                                                            }

                                                            entry.dirty = false;
                                                        };

                                                        Renderer.prototype.__cb2_getEntry = function (world, cx, cy) {
                                                            this.__cb2_ensureCache(world);

                                                            var cfg = this.__cb2_cfg || {};
                                                            var cts = (cfg.tiles | 0) || 16;

                                                            // 世界边界外不建条目
                                                            if (cx < 0 || cy < 0) return null;
                                                            if (cx * cts >= world.w || cy * cts >= world.h) return null;

                                                            var map = this.__cb2_chunkMap;
                                                            var key = _cb2_key(cx, cy);
                                                            var entry = map.get(key);
                                                            if (!entry) {
                                                                var size = cts * CONFIG.TILE_SIZE;

                                                                var canvas = document.createElement('canvas');
                                                                canvas.width = size;
                                                                canvas.height = size;

                                                                var cctx = canvas.getContext('2d', { alpha: true });
                                                                if (!cctx) return null;

                                                                cctx.imageSmoothingEnabled = false;

                                                                entry = {
                                                                    key: key,
                                                                    cx: cx,
                                                                    cy: cy,
                                                                    canvas: canvas,
                                                                    ctx: cctx,
                                                                    dirty: true,
                                                                    lastUsed: 0
                                                                };
                                                                map.set(key, entry);

                                                                this.__cb2_evictIfNeeded();
                                                            }

                                                            this.__cb2_chunkFrame = (this.__cb2_chunkFrame + 1) | 0;
                                                            entry.lastUsed = this.__cb2_chunkFrame;

                                                            if (entry.dirty) this.__cb2_rebuildChunk(entry, world);
                                                            return entry;
                                                        };

                                                        // 用 chunk batching 包装 renderWorld：保持原视觉（暗角/发光/遮罩）完全一致
                                                        Renderer.prototype.renderWorld = function (world, cam, time) {
                                                            // Chunk batching only: no legacy fallback path.
                                                            if (!world || !world.tiles || !world.light || !this.textures || !BL || !Utils || !CONFIG) return;

                                                            try {
                                                                var ctx = this.ctx;
                                                                var ts = CONFIG.TILE_SIZE;

                                                                var startX = Math.floor(cam.x / ts) - 1;
                                                                var startY = Math.floor(cam.y / ts) - 1;
                                                                var endX = startX + Math.ceil(this.w / ts) + 2;
                                                                var endY = startY + Math.ceil(this.h / ts) + 2;

                                                                if (startX < 0) startX = 0;
                                                                if (startY < 0) startY = 0;
                                                                if (endX >= world.w) endX = world.w - 1;
                                                                if (endY >= world.h) endY = world.h - 1;

                                                                var tiles = world.tiles;
                                                                var light = world.light;

                                                                var camCeilX = Math.ceil(cam.x);
                                                                var camCeilY = Math.ceil(cam.y);

                                                                // 复用/重建 LUT（与原 renderWorld 公式一致） + 天气联动（BLOCK_LIGHT_LUT）
                                                                var night = Utils.nightFactor(time);
                                                                var qNight = Math.round(night * 100) / 100;
                                                                var levels = CONFIG.LIGHT_LEVELS;

                                                                // 天气联动参数（由 Game._updateWeather 写入）
                                                                var wf = window.TU_WEATHER_FX || null;
                                                                var wType = (wf && wf.type) ? wf.type : 'clear';
                                                                var wGloom = (wf && typeof wf.gloom === 'number') ? wf.gloom : 0;
                                                                var wFlash = (wf && typeof wf.lightning === 'number') ? wf.lightning : 0;
                                                                if (wGloom < 0) wGloom = 0;
                                                                if (wGloom > 1) wGloom = 1;
                                                                if (wFlash < 0) wFlash = 0;
                                                                if (wFlash > 1) wFlash = 1;
                                                                var wKey = wType + ':' + ((wGloom * 100) | 0) + ':' + ((wFlash * 100) | 0) + ':' + qNight + ':' + levels;

                                                                if (!this._darkAlphaLUTDay || this._darkAlphaLUTLevels !== levels) {
                                                                    this._darkAlphaLUTLevels = levels;
                                                                    this._darkAlphaLUTDay = _cb2_buildDarkLUT(levels, 0);
                                                                    this._darkAlphaLUTNight = _cb2_buildDarkLUT(levels, 0.2);
                                                                }
                                                                var lut = this._darkAlphaLUTBlend;
                                                                if (!lut || this._darkAlphaLUTBlendWeatherKey !== wKey || this._darkAlphaLUTBlendNight !== qNight || this._darkAlphaLUTBlendLevels !== levels) {
                                                                    lut = this._darkAlphaLUTBlend || (this._darkAlphaLUTBlend = new Float32Array(256));
                                                                    var dayL = this._darkAlphaLUTDay;
                                                                    var nightL = this._darkAlphaLUTNight;
                                                                    var lv = levels || 1;
                                                                    var gloom = wGloom;
                                                                    var flash = wFlash;
                                                                    var th = 0.05 - gloom * 0.02;
                                                                    if (th < 0.02) th = 0.02;

                                                                    for (var i = 0; i < 256; i++) {
                                                                        var v = dayL[i] + (nightL[i] - dayL[i]) * qNight;

                                                                        // gloom：让暗部更“压抑”，并在强天气下略微压亮部
                                                                        if (gloom > 0.001) {
                                                                            var light01 = i / lv;
                                                                            if (light01 < 0) light01 = 0;
                                                                            if (light01 > 1) light01 = 1;
                                                                            var sh = 1 - light01;
                                                                            v += gloom * (0.08 + 0.22 * sh);
                                                                            v *= (1 + gloom * 0.18);
                                                                        }

                                                                        // lightning flash：短促减弱暗角（模拟闪电照亮）
                                                                        if (flash > 0.001) {
                                                                            v *= (1 - flash * 0.75);
                                                                            v -= flash * 0.08;
                                                                        }

                                                                        if (v > 0.92) v = 0.92;
                                                                        if (v < th) v = 0;
                                                                        lut[i] = v;
                                                                    }
                                                                    this._darkAlphaLUTBlendNight = qNight;
                                                                    this._darkAlphaLUTBlendLevels = levels;
                                                                    this._darkAlphaLUTBlendWeatherKey = wKey;
                                                                }

                                                                // 暴露到全局：便于在 Renderer 之外做联动/调试
                                                                window.BLOCK_LIGHT_LUT = lut;

                                                                // 重置关键状态（避免其它渲染残留影响 chunk draw）
                                                                ctx.globalCompositeOperation = 'source-over';
                                                                ctx.globalAlpha = 1;
                                                                ctx.shadowBlur = 0;

                                                                // 1) 画 chunk（非发光方块）
                                                                var cfg = this.__cb2_cfg || { tiles: 16 };
                                                                var cts = (cfg.tiles | 0) || 16;

                                                                var cStartX = (startX / cts) | 0;
                                                                var cStartY = (startY / cts) | 0;
                                                                var cEndX = (endX / cts) | 0;
                                                                var cEndY = (endY / cts) | 0;

                                                                for (var cy = cStartY; cy <= cEndY; cy++) {
                                                                    for (var cx = cStartX; cx <= cEndX; cx++) {
                                                                        var e = this.__cb2_getEntry(world, cx, cy);
                                                                        if (!e) continue;
                                                                        ctx.drawImage(e.canvas, cx * cts * ts - camCeilX, cy * cts * ts - camCeilY);
                                                                    }
                                                                }

                                                                // 2) 逐 tile：只补画“发光方块” + 画暗角遮罩（保持和原 renderWorld 一样）
                                                                ctx.globalAlpha = 1;
                                                                ctx.fillStyle = (wf && wf.shadowColor) ? wf.shadowColor : 'rgb(10,5,20)';

                                                                for (var x = startX; x <= endX; x++) {
                                                                    var colTiles = tiles[x];
                                                                    var colLight = light[x];
                                                                    for (var y = startY; y <= endY; y++) {
                                                                        var block = colTiles[y];
                                                                        if (block === BLOCK.AIR) continue;

                                                                        var px = x * ts - camCeilX;
                                                                        var py = y * ts - camCeilY;

                                                                        // 发光方块：按原逻辑绘制（shadowBlur）
                                                                        var bl = BL[block] | 0;
                                                                        if (bl > 5) {
                                                                            var tex = this.textures.get(block);
                                                                            if (this.enableGlow && tex) {
                                                                                ctx.save();
                                                                                ctx.shadowColor = (BC && BC[block]) ? BC[block] : '#fff';
                                                                                ctx.shadowBlur = bl * 2;
                                                                                ctx.drawImage(tex, px, py);
                                                                                ctx.restore();
                                                                            } else if (tex) {
                                                                                ctx.drawImage(tex, px, py);
                                                                            }
                                                                        }

                                                                        var a = lut[colLight[y]];
                                                                        if (a) {
                                                                            ctx.globalAlpha = a;
                                                                            ctx.fillRect(px, py, ts, ts);
                                                                            ctx.globalAlpha = 1;
                                                                        }
                                                                    }
                                                                }

                                                                ctx.globalAlpha = 1;
                                                            } catch (e) {
                                                                // 一旦异常：永久降级回原 renderWorld，避免“渲染出问题但还能玩”的体验
                                                                this.__disableChunkBatching = true;
                                                                try { console.warn('[chunkBatchSafeV2] disabled:', e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                return orig && orig.call(this, world, cam, time);
                                                            }
                                                        };

                                                        // 与 tile 改动联动：markTile 时让 chunk 失效（更稳）
                                                        if (SaveSystem && SaveSystem.prototype && typeof SaveSystem.prototype.markTile === 'function') {
                                                            if (!SaveSystem.prototype.__cb2_markTileWrapped) {
                                                                SaveSystem.prototype.__cb2_markTileWrapped = true;
                                                                var _oldMarkTile = SaveSystem.prototype.markTile;
                                                                SaveSystem.prototype.markTile = function (x, y, newId) {
                                                                    _oldMarkTile.call(this, x, y, newId);
                                                                    try {
                                                                        var r = this.game && this.game.renderer;
                                                                        if (r && typeof r.invalidateTile === 'function') r.invalidateTile(x, y);
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                };
                                                            }
                                                        }

                                                        // 读档后：整体失效一次（避免 chunk 里残留旧世界）
                                                        if (SaveSystem && SaveSystem.prototype && typeof SaveSystem.prototype.importLoaded === 'function') {
                                                            if (!SaveSystem.prototype.__cb2_importWrapped) {
                                                                SaveSystem.prototype.__cb2_importWrapped = true;
                                                                var _oldImportLoaded = SaveSystem.prototype.importLoaded;
                                                                SaveSystem.prototype.importLoaded = function (save) {
                                                                    _oldImportLoaded.call(this, save);
                                                                    try {
                                                                        var r = this.game && this.game.renderer;
                                                                        if (r && typeof r.invalidateAllChunks === 'function') r.invalidateAllChunks();
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                };
                                                            }
                                                        }
                                                    }

                                                    // ───────────────────────── Pickup Animation (safe v2) ─────────────────────────
                                                    if (!FLAGS.disablePickupAnim && DroppedItem && DroppedItem.prototype && DroppedItemManager && DroppedItemManager.prototype) {
                                                        if (!DroppedItem.prototype.__pickupAnimSafeV2Installed) {
                                                            DroppedItem.prototype.__pickupAnimSafeV2Installed = true;

                                                            // 开始拾取动画
                                                            DroppedItem.prototype.startPickup = function (player) {
                                                                if (this._pickup) return;
                                                                this._pickup = {
                                                                    t: 0,
                                                                    dur: 240, // ms
                                                                    sx: this.x,
                                                                    sy: this.y,
                                                                    phase: Math.random() * Math.PI * 2
                                                                };
                                                                // 动画期间不受物理/磁吸干扰
                                                                this.vx = 0;
                                                                this.vy = 0;
                                                                this.rotation = 0;
                                                                this.grounded = false;
                                                            };

                                                            // 拾取动画期间不再重复触发拾取
                                                            if (typeof DroppedItem.prototype.canPickup === 'function') {
                                                                var _oldCanPickup = DroppedItem.prototype.canPickup;
                                                                DroppedItem.prototype.canPickup = function (player) {
                                                                    if (this._pickup) return false;
                                                                    return _oldCanPickup.call(this, player);
                                                                };
                                                            }

                                                            // easeOutBack
                                                            function easeOutBack(x) {
                                                                var c1 = 1.70158;
                                                                var c3 = c1 + 1;
                                                                return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
                                                            }

                                                            // update：优先处理 pickup 动画
                                                            if (typeof DroppedItem.prototype.update === 'function') {
                                                                var _oldUpdate = DroppedItem.prototype.update;
                                                                DroppedItem.prototype.update = function (world, player, dt) {
                                                                    if (this._pickup && player) {
                                                                        var p = this._pickup;
                                                                        p.t += dt;

                                                                        var tt = p.t / p.dur;
                                                                        if (tt < 0) tt = 0;
                                                                        if (tt > 1) tt = 1;

                                                                        var e = easeOutBack(tt);

                                                                        var tx = (typeof player.cx === 'function') ? (player.cx() - this.w / 2) : (player.x - this.w / 2);
                                                                        var ty = (typeof player.cy === 'function') ? (player.cy() - this.h / 2) : (player.y - this.h / 2);

                                                                        var r = (1 - tt) * 18;
                                                                        var ang = p.phase + tt * Math.PI * 2.4;
                                                                        var ox = Math.cos(ang) * r;
                                                                        var oy = Math.sin(ang) * r * 0.6;

                                                                        this.x = p.sx + (tx - p.sx) * e + ox;
                                                                        this.y = p.sy + (ty - p.sy) * e + oy;

                                                                        this.rotation = tt * 0.6;

                                                                        this._pickupAlpha = 1 - tt;
                                                                        this._pickupScale = 1 - tt * 0.55;

                                                                        if (tt >= 1) return false;
                                                                        return true;
                                                                    }

                                                                    return _oldUpdate.call(this, world, player, dt);
                                                                };
                                                            }
                                                        }

                                                        if (!DroppedItemManager.prototype.__pickupAnimSafeV2MgrInstalled) {
                                                            DroppedItemManager.prototype.__pickupAnimSafeV2MgrInstalled = true;

                                                            // update：拾取时先触发 callback，再播放动画，动画结束后自然回收
                                                            if (typeof DroppedItemManager.prototype.update === 'function') {
                                                                var _oldMgrUpdate = DroppedItemManager.prototype.update;
                                                                DroppedItemManager.prototype.update = function (world, player, dt, addToInventoryCallback) {
                                                                    // 反向遍历，删除只做“置空”，保持原来的 _start/_holes 压缩策略
                                                                    for (var i = this.items.length - 1; i >= this._start; i--) {
                                                                        var item = this.items[i];
                                                                        if (!item) continue;

                                                                        var alive = item.update(world, player, dt);
                                                                        if (!alive) {
                                                                            this._release(item);
                                                                            this.items[i] = null;
                                                                            this._holes++;
                                                                            continue;
                                                                        }

                                                                        // 检测拾取（动画期间 canPickup 会返回 false）
                                                                        if (item.canPickup && item.canPickup(player)) {
                                                                            var picked = true;
                                                                            try { picked = addToInventoryCallback ? addToInventoryCallback(item.blockId, item.count) : true; } catch (_) { picked = true; }
                                                                            if (picked) {
                                                                                if (typeof item.startPickup === 'function') {
                                                                                    item.startPickup(player);
                                                                                } else {
                                                                                    // 兜底：没有动画函数就直接移除
                                                                                    this._release(item);
                                                                                    this.items[i] = null;
                                                                                    this._holes++;
                                                                                }
                                                                            }
                                                                        }
                                                                    }

                                                                    // 推进头指针（跳过前面的空洞）
                                                                    while (this._start < this.items.length && !this.items[this._start]) {
                                                                        this._start++;
                                                                        this._holes = Math.max(0, this._holes - 1);
                                                                    }

                                                                    // 需要时压缩，避免空洞过多导致遍历成本上升
                                                                    this._maybeCompact(false);
                                                                };
                                                            }

                                                            // render：拾取动画期间应用缩放/透明度，同时保留原“快消失闪烁 + 数量显示 + 发光”
                                                            if (typeof DroppedItemManager.prototype.render === 'function') {
                                                                var _oldMgrRender = DroppedItemManager.prototype.render;
                                                                DroppedItemManager.prototype.render = function (ctx, cam, textures, timeOfDay) {
                                                                    // 复制原渲染主干，增加 _pickupAlpha/_pickupScale
                                                                    var ts = CONFIG.TILE_SIZE;
                                                                    var now = (performance && performance.now) ? performance.now() : Date.now();
                                                                    var blinkPhase = Math.floor(now / 200) % 2;

                                                                    for (var i = this._start; i < this.items.length; i++) {
                                                                        var item = this.items[i];
                                                                        if (!item) continue;

                                                                        var sx = item.x - cam.x;
                                                                        var sy = item.y - cam.y;

                                                                        // 浮动效果（拾取动画中关闭 bob）
                                                                        var bob = item._pickup ? 0 : (Math.sin(now * 0.005 + item.bobOffset) * 3);

                                                                        // 闪烁效果（快消失时）
                                                                        if (!item._pickup && item.age > item.maxAge - 5000 && blinkPhase === 0) {
                                                                            continue;
                                                                        }

                                                                        var alpha = (typeof item._pickupAlpha === 'number') ? item._pickupAlpha : 1;
                                                                        var scale = (typeof item._pickupScale === 'number') ? item._pickupScale : 1;

                                                                        ctx.save();
                                                                        ctx.globalAlpha *= alpha;
                                                                        ctx.translate(sx + item.w / 2, sy + item.h / 2 + bob);
                                                                        ctx.rotate(item.rotation || 0);
                                                                        ctx.scale(scale, scale);

                                                                        // 发光效果（用查表避免每帧对象查找）
                                                                        var lightLv = BL ? (BL[item.blockId] | 0) : 0;
                                                                        if (lightLv > 0) {
                                                                            ctx.shadowColor = (BC && BC[item.blockId]) ? BC[item.blockId] : '#fff';
                                                                            ctx.shadowBlur = 15;
                                                                        } else {
                                                                            ctx.shadowColor = '#ffeaa7';
                                                                            ctx.shadowBlur = 8;
                                                                        }

                                                                        // 绘制物品
                                                                        var tex = textures && textures.get ? textures.get(item.blockId) : null;
                                                                        if (tex) {
                                                                            ctx.drawImage(tex, -item.w / 2, -item.h / 2, item.w, item.h);
                                                                        } else {
                                                                            // 后备渲染
                                                                            ctx.fillStyle = (BC && BC[item.blockId]) ? BC[item.blockId] : '#fff';
                                                                            ctx.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
                                                                        }

                                                                        ctx.shadowBlur = 0;

                                                                        // 显示数量（如果大于1）
                                                                        if (item.count > 1) {
                                                                            ctx.fillStyle = '#ffeaa7';
                                                                            ctx.font = 'bold 8px Arial';
                                                                            ctx.textAlign = 'right';
                                                                            ctx.fillText(String(item.count), item.w / 2, item.h / 2);
                                                                        }

                                                                        ctx.restore();
                                                                    }
                                                                };
                                                            }
                                                        }
                                                    }
                                                })();
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();