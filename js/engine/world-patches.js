// ═══════════════════════════════════════════════════════════════════════════════
        //                                世界生成器 (超级增强版)
        // ═══════════════════════════════════════════════════════════════════════════════
        // ───────────────────────── StructureDescriptor System (JSON, v11-safe) ─────────────────────────
        (() => {
            const TU = window.TU = window.TU || {};
            const LS_KEY = 'TU_STRUCTURES_JSON';
            const LIMITS = Object.freeze({ MAX_W: 96, MAX_H: 96, MAX_CELLS: 4096, MAX_DESC: 256, MAX_CONN: 16 });

            const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
            const clamp01 = (n) => (n < 0 ? 0 : (n > 1 ? 1 : n));
            const clampI = (n, lo, hi) => (n < lo ? lo : (n > hi ? hi : n)) | 0;
            const asNum = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
            const asStr = (v, d = '') => (typeof v === 'string' ? v : d);

            function resolveBlockId(v) {
                if (typeof v === 'number' && Number.isFinite(v)) return clampI(v, 0, 255);
                if (typeof v === 'string') {
                    const k = v.trim();
                    if (!k || k === 'KEEP' || k === 'NULL' || k === 'null') return null;
                    if (typeof BLOCK === 'object' && k in BLOCK) return BLOCK[k];
                }
                return null;
            }
            function resolveWallId(v) {
                if (v === null || v === undefined) return null;
                if (typeof v === 'number' && Number.isFinite(v)) return clampI(v, 0, 255);
                if (typeof v === 'string') {
                    const s = v.trim();
                    if (!s) return null;
                    const n = Number(s);
                    if (Number.isFinite(n)) return clampI(n, 0, 255);
                }
                return null;
            }
            function dirVec(dir) {
                switch (dir) {
                    case 'left': return [-1, 0];
                    case 'right': return [1, 0];
                    case 'up': return [0, -1];
                    case 'down': return [0, 1];
                    default: return [0, 0];
                }
            }

            function normalizeDescriptor(raw, idx) {
                if (!isObj(raw)) return null;

                const id = asStr(raw.id, `desc_${idx}`).slice(0, 64);
                const tags = Array.isArray(raw.tags) ? raw.tags.map(t => asStr(t, '')).filter(Boolean).slice(0, 16) : [];
                const weight = Math.max(0.0001, asNum(raw.weight, 1));

                let depth = [0, 1];
                if (Array.isArray(raw.depth) && raw.depth.length >= 2) {
                    const a = clamp01(asNum(raw.depth[0], 0));
                    const b = clamp01(asNum(raw.depth[1], 1));
                    depth = a <= b ? [a, b] : [b, a];
                }

                const placement = isObj(raw.placement) ? raw.placement : {};
                const mode = placement.mode === 'surface' ? 'surface' : 'underground';
                const minSolidRatio = clamp01(asNum(placement.minSolidRatio, mode === 'underground' ? 0.5 : 0.0));
                const defaultWall = clampI(asNum(placement.defaultWall, 0), 0, 255);

                let anchor = [0.5, 0.5];
                if (Array.isArray(raw.anchor) && raw.anchor.length >= 2) {
                    anchor = [clamp01(asNum(raw.anchor[0], 0.5)), clamp01(asNum(raw.anchor[1], 0.5))];
                }

                const pat = Array.isArray(raw.pattern) ? raw.pattern.map(s => String(s).replace(/\r/g, '')) : [];
                if (!pat.length) return null;

                const h = pat.length;
                let w = 0;
                for (let i = 0; i < pat.length; i++) w = Math.max(w, pat[i].length);

                if (w <= 0 || h <= 0) return null;
                if (w > LIMITS.MAX_W || h > LIMITS.MAX_H) return null;
                if (w * h > LIMITS.MAX_CELLS) return null;

                const grid = pat.map(line => line.padEnd(w, ' '));

                const legendRaw = isObj(raw.legend) ? raw.legend : {};
                const legend = Object.create(null);
                for (const k in legendRaw) {
                    if (!k || k.length !== 1) continue;
                    const v = legendRaw[k];
                    if (!isObj(v)) continue;

                    const tile = resolveBlockId(v.tile);
                    const wall = resolveWallId(v.wall);
                    const replace = (v.replace === 'solid' || v.replace === 'air' || v.replace === 'any') ? v.replace : 'any';
                    const chance = clamp01(asNum(v.chance, 1));

                    // tile === null → KEEP（跳过写入 tile）
                    legend[k] = { tile, wall, replace, chance };
                }

                const connectors = [];
                if (Array.isArray(raw.connectors)) {
                    for (let i = 0; i < raw.connectors.length && connectors.length < LIMITS.MAX_CONN; i++) {
                        const c = raw.connectors[i];
                        if (!isObj(c)) continue;
                        const x = clampI(asNum(c.x, 0), 0, w - 1);
                        const y = clampI(asNum(c.y, 0), 0, h - 1);
                        const dir = asStr(c.dir, 'right');
                        const len = clampI(asNum(c.len, 10), 1, 64);
                        const carve = !!c.carve;
                        const wall = resolveWallId(c.wall);
                        connectors.push({ x, y, dir, len, carve, wall });
                    }
                }

                return { id, tags, weight, depth, placement: { mode, minSolidRatio, defaultWall }, anchor, w, h, grid, legend, connectors };
            }

            class StructureLibrary {
                constructor() {
                    this._descs = [];
                    this._loaded = false;
                    this._lastError = '';
                }
                count() { return this._descs.length; }
                lastError() { return this._lastError; }

                clear() {
                    this._descs.length = 0;
                    this._loaded = true;
                    this._lastError = '';
                }

                loadFromArray(arr, { replace = false } = {}) {
                    if (!Array.isArray(arr)) return { ok: false, added: 0, error: 'not_array' };
                    if (replace) this._descs.length = 0;

                    let added = 0;
                    for (let i = 0; i < arr.length && this._descs.length < LIMITS.MAX_DESC; i++) {
                        const desc = normalizeDescriptor(arr[i], i);
                        if (!desc) continue;
                        this._descs.push(desc);
                        added++;
                    }
                    this._loaded = true;
                    this._lastError = '';
                    return { ok: true, added };
                }

                loadFromJSON(json, { replace = false } = {}) {
                    try {
                        const arr = typeof json === 'string' ? JSON.parse(json) : json;
                        return this.loadFromArray(arr, { replace });
                    } catch (e) {
                        this._lastError = String(e && e.message ? e.message : e);
                        return { ok: false, added: 0, error: this._lastError };
                    }
                }

                ensureLoaded() {
                    if (this._loaded) return;

                    // 1) localStorage 覆盖
                    const ls = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
                    if (ls) {
                        const r = this.loadFromJSON(ls, { replace: true });
                        if (r.ok && this._descs.length) { this._loaded = true; return; }
                    }

                    // 2) 内嵌 JSON（默认库）
                    const el = document.getElementById('tu-structures-json');
                    if (el && el.textContent) {
                        const r = this.loadFromJSON(el.textContent, { replace: true });
                        if (r.ok) { this._loaded = true; return; }
                    }

                    // 3) 兜底：空库
                    this._loaded = true;
                }

                // tags: string | string[]
                pick(depthNorm, tags) {
                    this.ensureLoaded();
                    if (!this._descs.length) return null;

                    const dn = clamp01(asNum(depthNorm, 0.5));
                    const tagList = Array.isArray(tags) ? tags : (tags ? [tags] : []);
                    const filtered = [];

                    for (let i = 0; i < this._descs.length; i++) {
                        const d = this._descs[i];
                        if (dn < d.depth[0] || dn > d.depth[1]) continue;
                        if (tagList.length) {
                            let ok = false;
                            for (let t = 0; t < tagList.length; t++) {
                                if (d.tags.includes(tagList[t])) { ok = true; break; }
                            }
                            if (!ok) continue;
                        }
                        filtered.push(d);
                    }
                    if (!filtered.length) return null;

                    let total = 0;
                    for (let i = 0; i < filtered.length; i++) total += filtered[i].weight;

                    let r = Math.random() * total;
                    for (let i = 0; i < filtered.length; i++) {
                        r -= filtered[i].weight;
                        if (r <= 0) return filtered[i];
                    }
                    return filtered[filtered.length - 1];
                }

                exportJSON() {
                    // 仅导出可序列化的“原型信息”（pattern/grid 会被保留为数组）
                    this.ensureLoaded();
                    return JSON.stringify(this._descs.map(d => ({
                        id: d.id, tags: d.tags, weight: d.weight, depth: d.depth,
                        anchor: d.anchor, placement: d.placement,
                        pattern: d.grid, legend: d.legend, connectors: d.connectors
                    })), null, 2);
                }
            }

            TU.Structures = TU.Structures || new StructureLibrary();

            // 便捷 API：开发者可在控制台/自定义 UI 中调用
            TU.loadStructureJSON = (jsonString) => {
                try { localStorage.setItem(LS_KEY, jsonString); } catch { }
                const r = TU.Structures.loadFromJSON(jsonString, { replace: true });
                return r;
            };
            TU.clearStructureJSON = () => { try { localStorage.removeItem(LS_KEY); } catch { } TU.Structures.clear(); TU.Structures.ensureLoaded(); };

            // 提前加载一次（避免首次生成时 parse 卡顿）
            try { TU.Structures.ensureLoaded(); } catch { }
        })();

        class WorldGenerator {
            constructor(w, h, seed) {
                this.w = w;
                this.h = h;
                this.seed = seed;
                this.noise = new NoiseGenerator(seed);
                this.biomeNoise = new NoiseGenerator(seed + 1000);
                this.caveNoise = new NoiseGenerator(seed + 2000);
                this.oreNoise = new NoiseGenerator(seed + 3000);
                this.structureNoise = new NoiseGenerator(seed + 4000);
            }

            async generate(progress) {
                const tiles = Array.from({ length: this.w }, () => new Uint8Array(this.h));
                const walls = Array.from({ length: this.w }, () => new Uint8Array(this.h));
                const light = Array.from({ length: this.w }, () => new Uint8Array(this.h));

                const steps = [
                    ['✨ 编织地形...', () => this._terrain(tiles, walls)],
                    ['🏔️ 生成山脉峡谷...', () => this._specialTerrain(tiles, walls)],
                    ['🕳️ 雕刻洞穴...', () => this._caves(tiles, walls)],
                    ['🌊 创造湖泊...', () => this._lakes(tiles)],
                    ['💎 埋藏宝藏...', () => this._ores(tiles)],
                    ['🌿 种植生命...', () => this._vegetation(tiles)],
                    ['🍄 地下生态...', () => this._undergroundLife(tiles, walls)],
                    ['🏠 建造遗迹...', () => this._structures(tiles, walls)],
                    ['🏰 隐秘地牢...', () => this._dungeons(tiles, walls)],
                    ['💫 点亮世界...', () => this._lighting(tiles, light)]
                ];

                for (let i = 0; i < steps.length; i++) {
                    progress(steps[i][0], (i / steps.length) * 100);
                    steps[i][1]();
                    await new Promise(r => setTimeout(r, 30));
                }

                progress('🎮 准备就绪!', 100);
                return { tiles, walls, light, w: this.w, h: this.h };
            }

            _biome(x) {
                const v = this.biomeNoise.fbm(x * 0.003, 0, 4);
                const v2 = this.biomeNoise.fbm(x * 0.008 + 500, 100, 3);

                if (v < -0.35) return 'tundra';
                if (v < -0.15) return 'snow';
                if (v < 0.05) return 'forest';
                if (v < 0.2) return 'plains';
                if (v < 0.35) return v2 > 0 ? 'cherry' : 'bamboo';
                if (v < 0.55) return 'jungle';
                if (v < 0.7) return 'savanna';
                return v2 > 0.2 ? 'red_desert' : 'desert';
            }

            _subBiome(x, y) {
                const v = this.biomeNoise.fbm(x * 0.02, y * 0.02, 3);
                if (y > this.h * 0.5 && y < this.h * 0.7) {
                    if (v > 0.4) return 'mushroom_cave';
                    if (v < -0.4) return 'crystal_cave';
                }
                if (y > this.h * 0.65 && y < this.h * 0.85) {
                    if (v > 0.3) return 'lush_cave';
                    if (v < -0.3) return 'ice_cave';
                }
                return 'normal';
            }

            _terrain(tiles, walls) {
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);

                for (let x = 0; x < this.w; x++) {
                    const biome = this._biome(x);

                    // 更复杂的地形高度
                    let heightMod = this.noise.fbm(x * 0.008, 0, 6) * 25;
                    heightMod += this.noise.fbm(x * 0.02, 0, 4) * 8;
                    heightMod += this.noise.fbm(x * 0.05, 0, 2) * 3;

                    // 生物群系影响高度
                    if (biome === 'tundra' || biome === 'snow') heightMod += 10;
                    if (biome === 'plains') heightMod -= 5;
                    if (biome === 'jungle') heightMod += this.noise.fbm(x * 0.03, 50, 3) * 12;

                    const groundY = surfY + Math.floor(heightMod);

                    for (let y = 0; y < this.h; y++) {
                        if (y < groundY - 3) {
                            tiles[x][y] = BLOCK.AIR;
                        } else if (y === groundY) {
                            // 表面方块根据生物群系
                            tiles[x][y] = this._getSurfaceBlock(biome);
                        } else if (y < groundY + 4 + Math.floor(Math.random() * 4)) {
                            // 表土层
                            tiles[x][y] = this._getSubSurfaceBlock(biome);
                            walls[x][y] = 1;
                        } else if (y < this.h * CONFIG.UNDERGROUND_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'upper');
                            walls[x][y] = 1;
                        } else if (y < this.h * CONFIG.CAVERN_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'middle');
                            walls[x][y] = 2;
                        } else if (y < this.h * CONFIG.UNDERWORLD_LEVEL) {
                            tiles[x][y] = this._getUndergroundBlock(x, y, 'deep');
                            walls[x][y] = 2;
                        } else if (y >= this.h - 4) {
                            tiles[x][y] = BLOCK.BEDROCK;
                            walls[x][y] = 3;
                        } else {
                            // 地狱层
                            const hellNoise = this.noise.fbm(x * 0.03, y * 0.03, 3);
                            if (hellNoise > 0.3) tiles[x][y] = BLOCK.HELLSTONE;
                            else if (hellNoise > 0) tiles[x][y] = BLOCK.ASH;
                            else if (hellNoise > -0.3) tiles[x][y] = BLOCK.OBSIDIAN;
                            else tiles[x][y] = BLOCK.BASALT;
                            walls[x][y] = 3;
                        }
                    }
                }
            }

            _getSurfaceBlock(biome) {
                switch (biome) {
                    case 'tundra': case 'snow': return BLOCK.SNOW_GRASS;
                    case 'desert': return BLOCK.SAND;
                    case 'red_desert': return BLOCK.RED_SAND;
                    case 'jungle': return BLOCK.JUNGLE_GRASS;
                    case 'bamboo': return BLOCK.JUNGLE_GRASS;
                    case 'cherry': return BLOCK.GRASS;
                    case 'savanna': return Math.random() > 0.3 ? BLOCK.GRASS : BLOCK.SAND;
                    default: return BLOCK.GRASS;
                }
            }

            _getSubSurfaceBlock(biome) {
                switch (biome) {
                    case 'tundra': case 'snow': return Math.random() > 0.8 ? BLOCK.ICE : BLOCK.SNOW;
                    case 'desert': return Math.random() > 0.7 ? BLOCK.SANDSTONE : BLOCK.SAND;
                    case 'red_desert': return Math.random() > 0.6 ? BLOCK.SANDSTONE : BLOCK.RED_SAND;
                    case 'jungle': case 'bamboo': return Math.random() > 0.5 ? BLOCK.MUD : BLOCK.CLAY;
                    default: return BLOCK.DIRT;
                }
            }

            _getUndergroundBlock(x, y, layer) {
                const n = this.noise.fbm(x * 0.04, y * 0.04, 3);
                const n2 = this.noise.fbm(x * 0.08 + 200, y * 0.08, 2);

                if (layer === 'upper') {
                    if (n > 0.5) return BLOCK.GRAVEL;
                    if (n > 0.35) return BLOCK.CLAY;
                    if (n < -0.4) return BLOCK.LIMESTONE;
                    return BLOCK.STONE;
                } else if (layer === 'middle') {
                    if (n > 0.45) return BLOCK.MOSSY_STONE;
                    if (n > 0.3 && n2 > 0.2) return BLOCK.SLATE;
                    if (n < -0.35) return BLOCK.MARBLE;
                    if (n < -0.5) return BLOCK.GRANITE;
                    return BLOCK.STONE;
                } else {
                    if (n > 0.4) return BLOCK.GRANITE;
                    if (n > 0.25 && n2 > 0.1) return BLOCK.BASALT;
                    if (n < -0.3) return BLOCK.OBSIDIAN;
                    if (n < -0.45) return BLOCK.SLATE;
                    return BLOCK.STONE;
                }
            }

            _specialTerrain(tiles, walls) {
                // 浮空岛屿
                for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
                    const ix = 80 + Math.floor(Math.random() * (this.w - 160));
                    const iy = 15 + Math.floor(Math.random() * 25);
                    const iw = 20 + Math.floor(Math.random() * 30);
                    const ih = 8 + Math.floor(Math.random() * 8);

                    this._createFloatingIsland(tiles, walls, ix, iy, iw, ih);
                }

                // 峡谷/裂缝
                for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
                    const cx = 50 + Math.floor(Math.random() * (this.w - 100));
                    this._createRavine(tiles, cx);
                }

                // 地表湖泊位置预留
                for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
                    const lx = 30 + Math.floor(Math.random() * (this.w - 60));
                    this._createSurfaceLake(tiles, lx);
                }
            }

            _createFloatingIsland(tiles, walls, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    const edgeDist = Math.min(dx + w / 2, w / 2 - dx) / (w / 2);
                    const height = Math.floor(h * edgeDist * (0.7 + Math.random() * 0.3));

                    for (let dy = 0; dy < height; dy++) {
                        const y = cy + dy;
                        if (y < 0 || y >= this.h) continue;

                        if (dy === 0) {
                            tiles[x][y] = BLOCK.GRASS;
                        } else if (dy < 3) {
                            tiles[x][y] = BLOCK.DIRT;
                        } else {
                            tiles[x][y] = BLOCK.STONE;
                        }
                        walls[x][y] = 1;
                    }
                }

                // 岛上放些好东西
                if (cx > 0 && cx < this.w && cy > 0) {
                    if (Math.random() > 0.5) tiles[cx][cy - 1] = BLOCK.TREASURE_CHEST;
                    else tiles[cx][cy - 1] = BLOCK.CRYSTAL;
                }
            }

            _createRavine(tiles, startX) {
                let x = startX;
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);

                // 找到地表
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }

                const depth = 30 + Math.floor(Math.random() * 40);
                const width = 3 + Math.floor(Math.random() * 4);

                for (let y = groundY; y < groundY + depth && y < this.h - 10; y++) {
                    const w = width + Math.floor(Math.sin(y * 0.1) * 2);
                    for (let dx = -w; dx <= w; dx++) {
                        const tx = x + dx + Math.floor(Math.sin(y * 0.15) * 3);
                        if (tx >= 0 && tx < this.w) {
                            tiles[tx][y] = BLOCK.AIR;
                        }
                    }
                }

                // 底部放水或熔岩
                for (let dx = -width - 2; dx <= width + 2; dx++) {
                    const tx = x + dx;
                    const ty = groundY + depth - 3;
                    if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                        if (tiles[tx][ty] === BLOCK.AIR) {
                            tiles[tx][ty] = Math.random() > 0.7 ? BLOCK.LAVA : BLOCK.WATER;
                        }
                    }
                }
            }

            _createSurfaceLake(tiles, startX) {
                const biome = this._biome(startX);
                if (biome === 'desert' || biome === 'red_desert') return; // 沙漠没有湖

                const width = 15 + Math.floor(Math.random() * 25);
                const depth = 4 + Math.floor(Math.random() * 6);

                // 找地表高度
                let minGroundY = this.h;
                for (let dx = 0; dx < width; dx++) {
                    const x = startX + dx;
                    if (x >= this.w) continue;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) {
                            minGroundY = Math.min(minGroundY, y);
                            break;
                        }
                    }
                }

                // 挖湖
                for (let dx = 0; dx < width; dx++) {
                    const x = startX + dx;
                    if (x >= this.w) continue;

                    const edgeDist = Math.min(dx, width - dx) / (width / 2);
                    const d = Math.floor(depth * edgeDist);

                    for (let dy = 0; dy < d; dy++) {
                        const y = minGroundY + dy;
                        if (y >= this.h) continue;
                        tiles[x][y] = biome === 'snow' || biome === 'tundra' ? BLOCK.ICE : BLOCK.WATER;
                    }
                }
            }

            _caves(tiles, walls) {
                const startY = Math.floor(this.h * CONFIG.SURFACE_LEVEL) + 8;

                // 多层洞穴系统
                for (let x = 0; x < this.w; x++) {
                    for (let y = startY; y < this.h - 4; y++) {
                        const subBiome = this._subBiome(x, y);

                        // 主洞穴网络
                        const c1 = this.caveNoise.warpedNoise(x * 0.032, y * 0.032);
                        const c2 = this.caveNoise.fbm(x * 0.05 + 500, y * 0.05, 4);
                        const c3 = this.caveNoise.fbm(x * 0.02 + 1000, y * 0.02, 3);

                        const depth = Math.min(1, (y - startY) / (this.h * 0.3));
                        const thresh = 0.35 + depth * 0.15;

                        // 主要洞穴
                        if (c1 > thresh || (c2 > 0.55 && Math.random() > 0.3)) {
                            tiles[x][y] = BLOCK.AIR;
                        }

                        // 大型洞室
                        if (y > this.h * CONFIG.CAVERN_LEVEL && c3 > 0.48) {
                            tiles[x][y] = BLOCK.AIR;
                        }

                        // 蠕虫状隧道
                        const worm = Math.sin(x * 0.05 + y * 0.1) * Math.sin(x * 0.02 - y * 0.03);
                        if (Math.abs(worm) < 0.08 && y > this.h * 0.35 && Math.random() > 0.3) {
                            tiles[x][y] = BLOCK.AIR;
                        }
                    }
                }

                // 地下水和熔岩池
                this._fillCaveLiquids(tiles);
            }

            _fillCaveLiquids(tiles) {
                for (let x = 0; x < this.w; x++) {
                    for (let y = Math.floor(this.h * 0.45); y < this.h - 4; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) continue;

                        // 检查是否是池底
                        if (y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            // 深层熔岩
                            if (y > this.h * CONFIG.UNDERWORLD_LEVEL && Math.random() > 0.5) {
                                this._fillPool(tiles, x, y, BLOCK.LAVA, 8);
                            }
                            // 中层水池
                            else if (y < this.h * CONFIG.UNDERWORLD_LEVEL && Math.random() > 0.88) {
                                this._fillPool(tiles, x, y, BLOCK.WATER, 12);
                            }
                        }
                    }
                }
            }

            _fillPool(tiles, sx, sy, liquid, maxSize) {
                // 性能：避免 queue.shift() 的 O(n) 开销 & 字符串 key 的频繁分配
                const queue = [{ x: sx, y: sy }];
                let head = 0;
                const filled = new Set();
                let count = 0;

                while (head < queue.length && count < maxSize) {
                    const { x, y } = queue[head++];

                    if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                    // 以 32-bit key 代替 `${x},${y}`，减少 GC 压力（假设世界尺寸 < 65536）
                    const key = (x << 16) | (y & 0xffff);
                    if (filled.has(key)) continue;
                    filled.add(key);

                    if (tiles[x][y] !== BLOCK.AIR) continue;

                    tiles[x][y] = liquid;
                    count++;

                    // 只向下和水平扩展
                    queue.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y + 1 });
                }
            }

            _lakes(tiles) {
                // 地下大型湖泊
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const lx = 50 + Math.floor(Math.random() * (this.w - 100));
                    const ly = Math.floor(this.h * (0.5 + Math.random() * 0.25));
                    const lw = 25 + Math.floor(Math.random() * 35);
                    const lh = 8 + Math.floor(Math.random() * 12);

                    this._createUndergroundLake(tiles, lx, ly, lw, lh);
                }

                // 熔岩湖
                for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
                    const lx = 40 + Math.floor(Math.random() * (this.w - 80));
                    const ly = Math.floor(this.h * (0.85 + Math.random() * 0.1));
                    const lw = 20 + Math.floor(Math.random() * 30);
                    const lh = 5 + Math.floor(Math.random() * 8);

                    this._createLavaLake(tiles, lx, ly, lw, lh);
                }
            }

            _createUndergroundLake(tiles, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 1 - Math.random() * 0.2) {
                            tiles[x][y] = BLOCK.WATER;
                        }
                    }
                }
            }

            _createLavaLake(tiles, cx, cy, w, h) {
                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 0.9) {
                            tiles[x][y] = BLOCK.LAVA;
                        }
                    }
                }
                // 周围放萤石
                for (let i = 0; i < 8; i++) {
                    const gx = cx + Math.floor((Math.random() - 0.5) * w * 1.2);
                    const gy = cy + Math.floor((Math.random() - 0.5) * h * 1.5);
                    if (gx >= 0 && gx < this.w && gy >= 0 && gy < this.h) {
                        if (tiles[gx][gy] === BLOCK.STONE || tiles[gx][gy] === BLOCK.OBSIDIAN) {
                            tiles[gx][gy] = BLOCK.GLOWSTONE;
                        }
                    }
                }
            }

            _ores(tiles) {
                const ores = [
                    // 常见矿石
                    { id: BLOCK.COPPER_ORE, minY: 0.26, maxY: 0.55, chance: 0.008, size: 6 },
                    { id: BLOCK.IRON_ORE, minY: 0.35, maxY: 0.65, chance: 0.006, size: 5 },
                    { id: BLOCK.SILVER_ORE, minY: 0.45, maxY: 0.75, chance: 0.005, size: 4 },
                    { id: BLOCK.GOLD_ORE, minY: 0.52, maxY: 0.82, chance: 0.004, size: 4 },
                    // 稀有矿石
                    { id: BLOCK.DIAMOND_ORE, minY: 0.70, maxY: 0.88, chance: 0.0015, size: 3 },
                    { id: BLOCK.RUBY_ORE, minY: 0.60, maxY: 0.80, chance: 0.002, size: 3 },
                    { id: BLOCK.EMERALD_ORE, minY: 0.55, maxY: 0.75, chance: 0.002, size: 3 },
                    { id: BLOCK.SAPPHIRE_ORE, minY: 0.58, maxY: 0.78, chance: 0.002, size: 3 },
                    // 特殊矿石
                    { id: BLOCK.CRYSTAL, minY: 0.48, maxY: 0.72, chance: 0.003, size: 4 },
                    { id: BLOCK.AMETHYST, minY: 0.55, maxY: 0.80, chance: 0.0025, size: 4 },
                    { id: BLOCK.GLOWSTONE, minY: 0.60, maxY: 0.85, chance: 0.003, size: 3 },
                    // 地狱矿石
                    { id: BLOCK.HELLSTONE, minY: 0.88, maxY: 0.98, chance: 0.015, size: 5 }
                ];

                for (const ore of ores) {
                    const minY = Math.floor(this.h * ore.minY);
                    const maxY = Math.floor(this.h * ore.maxY);

                    for (let x = 0; x < this.w; x++) {
                        for (let y = minY; y < maxY; y++) {
                            // 使用噪声增加矿脉聚集性
                            const oreChance = ore.chance * (1 + this.oreNoise.fbm(x * 0.1, y * 0.1, 2));
                            if (Math.random() < oreChance) {
                                const block = tiles[x][y];
                                if (block === BLOCK.STONE || block === BLOCK.GRANITE ||
                                    block === BLOCK.SLATE || block === BLOCK.LIMESTONE) {
                                    this._placeVein(tiles, x, y, ore.id, ore.size + Math.floor(Math.random() * 3));
                                }
                            }
                        }
                    }
                }
            }

            _placeVein(tiles, sx, sy, id, size) {
                const placed = [{ x: sx, y: sy }];
                tiles[sx][sy] = id;
                let attempts = 0;

                while (placed.length < size && attempts < size * 3) {
                    attempts++;
                    const p = placed[Math.floor(Math.random() * placed.length)];
                    const nx = p.x + Math.floor(Math.random() * 3) - 1;
                    const ny = p.y + Math.floor(Math.random() * 3) - 1;

                    if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h) {
                        const block = tiles[nx][ny];
                        if (block === BLOCK.STONE || block === BLOCK.GRANITE ||
                            block === BLOCK.SLATE || block === BLOCK.LIMESTONE ||
                            block === BLOCK.MARBLE || block === BLOCK.BASALT) {
                            tiles[nx][ny] = id;
                            placed.push({ x: nx, y: ny });
                        }
                    }
                }
            }

            _vegetation(tiles) {
                for (let x = 5; x < this.w - 5; x++) {
                    const biome = this._biome(x);
                    let groundY = 0;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }
                    if (!groundY || groundY > this.h * 0.5) continue;

                    // 各种树木
                    this._placeTree(tiles, x, groundY, biome);

                    // 花草装饰
                    this._placeFlora(tiles, x, groundY, biome);
                }
            }

            _placeTree(tiles, x, groundY, biome) {
                const treeChance = {
                    'forest': 0.08, 'jungle': 0.12, 'plains': 0.03, 'cherry': 0.07,
                    'bamboo': 0.15, 'snow': 0.04, 'tundra': 0.02, 'savanna': 0.02,
                    'desert': 0, 'red_desert': 0
                };

                if (Math.random() > (treeChance[biome] || 0.05)) return;
                if (tiles[x][groundY - 1] !== BLOCK.AIR) return;

                let logType = BLOCK.LOG;
                let leafType = BLOCK.LEAVES;
                let height = 5 + Math.floor(Math.random() * 4);
                let canopyRadius = 2;

                switch (biome) {
                    case 'jungle':
                        height = 10 + Math.floor(Math.random() * 8);
                        canopyRadius = 3 + Math.floor(Math.random() * 2);
                        break;
                    case 'bamboo':
                        logType = BLOCK.BAMBOO;
                        height = 8 + Math.floor(Math.random() * 6);
                        // 竹子没有树冠
                        for (let i = 1; i <= height && groundY - i >= 0; i++) {
                            tiles[x][groundY - i] = logType;
                        }
                        return;
                    case 'cherry':
                        logType = BLOCK.CHERRY_LOG;
                        leafType = BLOCK.CHERRY_LEAVES;
                        height = 6 + Math.floor(Math.random() * 3);
                        canopyRadius = 3;
                        break;
                    case 'snow': case 'tundra':
                        logType = BLOCK.PINE_LOG;
                        leafType = BLOCK.PINE_LEAVES;
                        height = 8 + Math.floor(Math.random() * 5);
                        // 松树是三角形
                        for (let i = 1; i <= height && groundY - i >= 0; i++) {
                            tiles[x][groundY - i] = logType;
                        }
                        for (let layer = 0; layer < height - 2; layer++) {
                            const w = Math.max(1, Math.floor((height - layer) / 2));
                            const y = groundY - height + layer;
                            for (let dx = -w; dx <= w; dx++) {
                                const tx = x + dx;
                                if (tx >= 0 && tx < this.w && y >= 0 && tiles[tx][y] === BLOCK.AIR) {
                                    tiles[tx][y] = leafType;
                                }
                            }
                        }
                        return;
                    case 'savanna':
                        height = 4 + Math.floor(Math.random() * 2);
                        canopyRadius = 4;
                        break;
                    case 'desert': case 'red_desert':
                        // 仙人掌
                        if (Math.random() > 0.96) {
                            const h = 3 + Math.floor(Math.random() * 4);
                            for (let i = 1; i <= h && groundY - i >= 0; i++) {
                                tiles[x][groundY - i] = BLOCK.CACTUS;
                            }
                            // 仙人掌手臂
                            if (h > 3 && Math.random() > 0.5) {
                                const armY = groundY - Math.floor(h / 2);
                                const armDir = Math.random() > 0.5 ? 1 : -1;
                                if (x + armDir >= 0 && x + armDir < this.w) {
                                    if (armY >= 0 && armY < this.h && tiles[x + armDir][armY] === BLOCK.AIR) tiles[x + armDir][armY] = BLOCK.CACTUS;
                                    if (armY - 1 >= 0 && (armY - 1) < this.h && tiles[x + armDir][armY - 1] === BLOCK.AIR) tiles[x + armDir][armY - 1] = BLOCK.CACTUS;
                                }
                            }
                        }
                        return;
                }

                // 标准树干
                for (let i = 1; i <= height && groundY - i >= 0; i++) {
                    tiles[x][groundY - i] = logType;
                }

                // 树冠
                for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
                    for (let dy = -canopyRadius - 1; dy <= 1; dy++) {
                        const tx = x + dx, ty = groundY - height + dy;
                        if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist <= canopyRadius + 0.5 && tiles[tx][ty] === BLOCK.AIR && Math.random() > 0.15) {
                                tiles[tx][ty] = leafType;
                            }
                        }
                    }
                }
            }

            _placeFlora(tiles, x, groundY, biome) {
                if (tiles[x][groundY - 1] !== BLOCK.AIR) return;

                const floraChance = biome === 'jungle' ? 0.5 : biome === 'plains' ? 0.4 :
                    biome === 'forest' ? 0.35 : biome === 'cherry' ? 0.45 : 0.2;

                if (Math.random() > floraChance) return;

                const r = Math.random();
                let flora = BLOCK.TALL_GRASS;

                switch (biome) {
                    case 'plains':
                        if (r > 0.92) flora = BLOCK.SUNFLOWER;
                        else if (r > 0.85) flora = BLOCK.FLOWER_RED;
                        else if (r > 0.78) flora = BLOCK.FLOWER_YELLOW;
                        else if (r > 0.7) flora = BLOCK.PINK_FLOWER;
                        else if (r > 0.62) flora = BLOCK.BLUE_FLOWER;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'forest':
                        if (r > 0.9) flora = BLOCK.MUSHROOM;
                        else if (r > 0.8) flora = BLOCK.FERN;
                        else if (r > 0.7) flora = BLOCK.FLOWER_RED;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'jungle':
                        if (r > 0.85) flora = BLOCK.FERN;
                        else if (r > 0.75) flora = BLOCK.PINK_FLOWER;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'cherry':
                        if (r > 0.8) flora = BLOCK.PINK_FLOWER;
                        else if (r > 0.6) flora = BLOCK.FLOWER_RED;
                        else flora = BLOCK.TALL_GRASS;
                        break;
                    case 'snow': case 'tundra':
                        if (r > 0.9) flora = BLOCK.BLUE_FLOWER;
                        break;
                    default:
                        if (r > 0.85) flora = BLOCK.FLOWER_YELLOW;
                        else if (r > 0.7) flora = BLOCK.TALL_GRASS;
                        else return;
                }

                tiles[x][groundY - 1] = flora;
            }

            _undergroundLife(tiles, walls) {
                const startY = Math.floor(this.h * CONFIG.UNDERGROUND_LEVEL);

                for (let x = 0; x < this.w; x++) {
                    for (let y = startY; y < this.h * CONFIG.UNDERWORLD_LEVEL; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) continue;

                        const subBiome = this._subBiome(x, y);

                        // 地下蘑菇
                        if (tiles[x][y + 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            if (Math.random() > 0.992) {
                                tiles[x][y] = subBiome === 'mushroom_cave' ? BLOCK.UNDERGROUND_MUSHROOM : BLOCK.MUSHROOM;
                            }
                            if (subBiome === 'mushroom_cave' && Math.random() > 0.97) {
                                // 巨型蘑菇
                                this._placeGiantMushroom(tiles, x, y);
                            }
                        }

                        // 天花板装饰
                        if (y > 0 && tiles[x][y - 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y - 1]]?.solid) {
                            if (Math.random() > 0.985) {
                                tiles[x][y] = BLOCK.STALACTITE;
                            }
                            if (subBiome === 'lush_cave' && Math.random() > 0.9) {
                                tiles[x][y] = BLOCK.VINE;
                            }
                        }

                        // 地面装饰
                        if (y + 1 < this.h && tiles[x][y + 1] !== BLOCK.AIR && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            if (Math.random() > 0.988) {
                                tiles[x][y] = BLOCK.STALAGMITE;
                            }
                            if (subBiome === 'lush_cave' && Math.random() > 0.93) {
                                tiles[x][y] = BLOCK.GLOWING_MOSS;
                            }
                            if (subBiome === 'crystal_cave' && Math.random() > 0.95) {
                                tiles[x][y] = Math.random() > 0.5 ? BLOCK.CRYSTAL : BLOCK.AMETHYST;
                            }
                        }

                        // 墙壁装饰
                        if (subBiome === 'lush_cave') {
                            if (x > 0 && tiles[x - 1][y] !== BLOCK.AIR && Math.random() > 0.92) {
                                tiles[x][y] = BLOCK.MOSS;
                            }
                            if (x + 1 < this.w && tiles[x + 1][y] !== BLOCK.AIR && Math.random() > 0.92) {
                                tiles[x][y] = BLOCK.MOSS;
                            }
                        }

                        // 冰洞穴
                        if (subBiome === 'ice_cave') {
                            if (Math.random() > 0.95) {
                                // 将周围石头变成冻石
                                for (let dx = -1; dx <= 1; dx++) {
                                    for (let dy = -1; dy <= 1; dy++) {
                                        const tx = x + dx, ty = y + dy;
                                        if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                                            if (tiles[tx][ty] === BLOCK.STONE) {
                                                tiles[tx][ty] = BLOCK.FROZEN_STONE;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            _placeGiantMushroom(tiles, x, groundY) {
                const height = 5 + Math.floor(Math.random() * 4);
                const capRadius = 2 + Math.floor(Math.random() * 2);

                // 茎
                for (let i = 1; i <= height && groundY - i >= 0; i++) {
                    tiles[x][groundY - i] = BLOCK.MUSHROOM_GIANT;
                }

                // 伞盖
                for (let dx = -capRadius; dx <= capRadius; dx++) {
                    const tx = x + dx;
                    const ty = groundY - height;
                    if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) {
                        if (tiles[tx][ty] === BLOCK.AIR) {
                            tiles[tx][ty] = BLOCK.MUSHROOM_GIANT;
                        }
                        if (ty - 1 >= 0 && tiles[tx][ty - 1] === BLOCK.AIR && Math.abs(dx) < capRadius) {
                            tiles[tx][ty - 1] = BLOCK.MUSHROOM_GIANT;
                        }
                    }
                }
            }

            _structures(tiles, walls) {
                // 地表小屋
                for (let i = 0; i < 6 + Math.floor(Math.random() * 5); i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    this._placeHouse(tiles, walls, x);
                }

                // 地下遗迹小屋
                for (let i = 0; i < 8 + Math.floor(Math.random() * 6); i++) {
                    const x = 40 + Math.floor(Math.random() * (this.w - 80));
                    const y = Math.floor(this.h * (0.4 + Math.random() * 0.35));
                    this._placeUndergroundCabin(tiles, walls, x, y);
                }

                // 矿井入口
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const x = 60 + Math.floor(Math.random() * (this.w - 120));
                    this._placeMineEntrance(tiles, walls, x);
                }

                // 神殿
                if (Math.random() > 0.3) {
                    const x = 100 + Math.floor(Math.random() * (this.w - 200));
                    const y = Math.floor(this.h * (0.55 + Math.random() * 0.2));
                    this._placeTemple(tiles, walls, x, y);
                }
            }

            _placeHouse(tiles, walls, x) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY || groundY > this.h * 0.4) return;

                const w = 8 + Math.floor(Math.random() * 4);
                const h = 6 + Math.floor(Math.random() * 3);
                const biome = this._biome(x);

                let wallBlock = BLOCK.PLANKS;
                if (biome === 'desert' || biome === 'red_desert') wallBlock = BLOCK.SANDSTONE;
                if (biome === 'snow' || biome === 'tundra') wallBlock = Math.random() > 0.5 ? BLOCK.PLANKS : BLOCK.ICE;

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = groundY - h + dy;
                        if (tx >= this.w || ty < 0) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        const isDoor = dy === h - 1 && dx === Math.floor(w / 2);

                        if (isDoor) {
                            tiles[tx][ty] = BLOCK.AIR;
                        } else if (isWall) {
                            tiles[tx][ty] = wallBlock;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                            walls[tx][ty] = 1;
                        }
                    }
                }

                // 内部装饰
                const midX = x + Math.floor(w / 2);
                const floorY = groundY - 1;
                if (midX < this.w && floorY > 0) {
                    tiles[midX][groundY - h + 1] = BLOCK.LANTERN;
                    if (Math.random() > 0.5 && x + w - 2 < this.w) {
                        tiles[x + w - 2][floorY] = BLOCK.TREASURE_CHEST;
                    }
                }
            }

            _placeUndergroundCabin(tiles, walls, x, y) {
                const w = 7 + Math.floor(Math.random() * 5);
                const h = 5 + Math.floor(Math.random() * 3);

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = y + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        tiles[tx][ty] = isWall ? BLOCK.PLANKS : BLOCK.AIR;
                        if (!isWall) walls[tx][ty] = 1;
                    }
                }

                // 火把
                if (x + Math.floor(w / 2) < this.w && y + 1 < this.h) {
                    tiles[x + Math.floor(w / 2)][y + 1] = BLOCK.TORCH;
                }
                // 宝箱
                if (x + w - 2 < this.w && y + h - 2 < this.h && Math.random() > 0.3) {
                    tiles[x + w - 2][y + h - 2] = BLOCK.TREASURE_CHEST;
                }
            }

            _placeMineEntrance(tiles, walls, x) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY) return;

                // 矿井入口框架
                const entranceW = 4;
                const entranceH = 5;

                for (let dx = 0; dx < entranceW; dx++) {
                    for (let dy = 0; dy < entranceH; dy++) {
                        const tx = x + dx, ty = groundY + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        if (dx === 0 || dx === entranceW - 1) {
                            tiles[tx][ty] = BLOCK.PLANKS;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                        }
                    }
                }

                // 向下的竖井
                const shaftDepth = 20 + Math.floor(Math.random() * 30);
                for (let dy = entranceH; dy < shaftDepth; dy++) {
                    const ty = groundY + dy;
                    if (ty >= this.h - 10) break;

                    for (let dx = 1; dx < entranceW - 1; dx++) {
                        const tx = x + dx;
                        if (tx < this.w) tiles[tx][ty] = BLOCK.AIR;
                    }

                    // 周期性放置梯子平台
                    if (dy % 8 === 0) {
                        for (let dx = 0; dx < entranceW; dx++) {
                            const tx = x + dx;
                            if (tx < this.w) tiles[tx][ty] = BLOCK.PLANKS;
                        }
                    }

                    // 火把
                    if (dy % 6 === 0 && x < this.w) {
                        tiles[x][ty] = BLOCK.TORCH;
                    }
                }
            }

            _placeTemple(tiles, walls, x, y) {
                const w = 15 + Math.floor(Math.random() * 10);
                const h = 10 + Math.floor(Math.random() * 5);

                const wallBlock = Math.random() > 0.5 ? BLOCK.BRICK : BLOCK.COBBLESTONE;

                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const tx = x + dx, ty = y + dy;
                        if (tx >= this.w || ty >= this.h) continue;

                        const isWall = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
                        const isPillar = (dx === 3 || dx === w - 4) && dy > 1 && dy < h - 1;

                        if (isWall || isPillar) {
                            tiles[tx][ty] = wallBlock;
                        } else {
                            tiles[tx][ty] = BLOCK.AIR;
                            walls[tx][ty] = 2;
                        }
                    }
                }

                // 中央宝藏
                const cx = x + Math.floor(w / 2);
                const cy = y + h - 2;
                if (cx < this.w && cy < this.h) {
                    tiles[cx][cy] = BLOCK.TREASURE_CHEST;
                    tiles[cx][y + 1] = BLOCK.LANTERN;

                    // 周围水晶
                    for (let i = 0; i < 4; i++) {
                        const crystalX = cx + (i % 2 === 0 ? -2 : 2);
                        const crystalY = cy - (i < 2 ? 0 : 1);
                        if (crystalX >= 0 && crystalX < this.w && crystalY >= 0 && crystalY < this.h) {
                            tiles[crystalX][crystalY] = Math.random() > 0.5 ? BLOCK.CRYSTAL : BLOCK.AMETHYST;
                        }
                    }
                }

                // 蜘蛛网装饰
                for (let i = 0; i < 5; i++) {
                    const wx = x + 1 + Math.floor(Math.random() * (w - 2));
                    const wy = y + 1 + Math.floor(Math.random() * 3);
                    if (wx < this.w && wy < this.h && tiles[wx][wy] === BLOCK.AIR) {
                        tiles[wx][wy] = BLOCK.SPIDER_WEB;
                    }
                }
            }

            _dungeons(tiles, walls) {
                const dungeonCount = 2 + Math.floor(Math.random() * 3);

                for (let d = 0; d < dungeonCount; d++) {
                    const startX = 80 + Math.floor(Math.random() * (this.w - 160));
                    const startY = Math.floor(this.h * (0.5 + Math.random() * 0.3));

                    this._createDungeon(tiles, walls, startX, startY);
                }

                // 额外添加特殊结构
                this._createSpecialFeatures(tiles, walls);

                // StructureDescriptor：从 JSON 结构库按深度抽取并焊接到地形中
                if (this._weldStructuresFromLibrary) this._weldStructuresFromLibrary(tiles, walls);
            }

            // 创建特殊地形特征
            _createSpecialFeatures(tiles, walls) {
                // 陨石坑
                for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
                    const mx = 100 + Math.floor(Math.random() * (this.w - 200));
                    this._createMeteoriteCrater(tiles, mx);
                }

                // 蜂巢
                for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
                    const hx = 60 + Math.floor(Math.random() * (this.w - 120));
                    const hy = Math.floor(this.h * (0.35 + Math.random() * 0.2));
                    this._createBeehive(tiles, walls, hx, hy);
                }

                // 蜘蛛巢穴
                for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
                    const sx = 50 + Math.floor(Math.random() * (this.w - 100));
                    const sy = Math.floor(this.h * (0.45 + Math.random() * 0.3));
                    this._createSpiderNest(tiles, walls, sx, sy);
                }

                // 生命树
                for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
                    const tx = 80 + Math.floor(Math.random() * (this.w - 160));
                    this._createLivingTree(tiles, walls, tx);
                }

                // 金字塔 (沙漠)
                this._createPyramids(tiles, walls);

                // 地下丛林神庙
                if (Math.random() > 0.4) {
                    const jx = Math.floor(this.w * 0.6 + Math.random() * this.w * 0.3);
                    const jy = Math.floor(this.h * (0.65 + Math.random() * 0.15));
                    this._createJungleTemple(tiles, walls, jx, jy);
                }

                // 天空岛链
                this._createSkyIslandChain(tiles, walls);

                // 地下蘑菇生态区
                this._createMushroomBiome(tiles, walls);

                // 腐化/猩红区域
                this._createEvilBiome(tiles, walls);

                // 神圣区域
                this._createHallowBiome(tiles, walls);

                // 海洋/沙滩
                this._createOceans(tiles, walls);

                // 药草分布
                this._distributeHerbs(tiles);

                // 生命水晶
                this._placeLifeCrystals(tiles);
            }

            _createMeteoriteCrater(tiles, cx) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[cx][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY) return;

                const craterRadius = 8 + Math.floor(Math.random() * 6);

                // 挖出陨石坑
                for (let dx = -craterRadius; dx <= craterRadius; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= this.w) continue;

                    const depth = Math.floor(Math.sqrt(craterRadius * craterRadius - dx * dx) * 0.7);
                    for (let dy = -2; dy < depth; dy++) {
                        const y = groundY + dy;
                        if (y >= 0 && y < this.h) {
                            tiles[x][y] = BLOCK.AIR;
                        }
                    }
                }

                // 填充陨石
                for (let dx = -craterRadius + 2; dx <= craterRadius - 2; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= this.w) continue;

                    const meteoriteHeight = Math.floor(Math.sqrt((craterRadius - 2) * (craterRadius - 2) - dx * dx) * 0.5);
                    for (let dy = 0; dy < meteoriteHeight; dy++) {
                        const y = groundY + Math.floor(craterRadius * 0.5) - dy;
                        if (y >= 0 && y < this.h && Math.random() > 0.15) {
                            tiles[x][y] = BLOCK.METEORITE;
                        }
                    }
                }
            }

            _createBeehive(tiles, walls, cx, cy) {
                const w = 12 + Math.floor(Math.random() * 8);
                const h = 8 + Math.floor(Math.random() * 6);

                for (let dx = -w / 2; dx < w / 2; dx++) {
                    for (let dy = -h / 2; dy < h / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(cy + dy);
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
                        if (dist < 0.85) {
                            if (dist > 0.7) {
                                tiles[x][y] = BLOCK.HIVE;
                            } else if (Math.random() > 0.6) {
                                tiles[x][y] = BLOCK.HONEY_BLOCK;
                            } else {
                                tiles[x][y] = BLOCK.AIR;
                            }
                            walls[x][y] = 1;
                        }
                    }
                }

                // 中心蜂窝
                if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                    tiles[cx][cy] = BLOCK.BEE_NEST;
                }
            }

            _createSpiderNest(tiles, walls, cx, cy) {
                const radius = 6 + Math.floor(Math.random() * 5);

                // 挖空区域
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < radius * 0.9) {
                            tiles[x][y] = BLOCK.AIR;
                            walls[x][y] = 2;
                        }
                    }
                }

                // 添加蜘蛛网
                for (let i = 0; i < radius * 3; i++) {
                    const wx = cx + Math.floor((Math.random() - 0.5) * radius * 1.5);
                    const wy = cy + Math.floor((Math.random() - 0.5) * radius * 1.5);
                    if (wx >= 0 && wx < this.w && wy >= 0 && wy < this.h) {
                        if (tiles[wx][wy] === BLOCK.AIR) {
                            tiles[wx][wy] = BLOCK.SPIDER_WEB;
                        }
                    }
                }

                // 中心蜘蛛巢
                if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                    tiles[cx][cy] = BLOCK.SPIDER_NEST;
                }
            }

            _createLivingTree(tiles, walls, cx) {
                let groundY = 0;
                for (let y = 0; y < this.h; y++) {
                    if (tiles[cx][y] !== BLOCK.AIR) { groundY = y; break; }
                }
                if (!groundY || groundY > this.h * 0.4) return;

                const trunkWidth = 4 + Math.floor(Math.random() * 3);
                const trunkHeight = 25 + Math.floor(Math.random() * 20);
                const rootDepth = 15 + Math.floor(Math.random() * 10);

                // 树干
                for (let dx = -trunkWidth / 2; dx < trunkWidth / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    for (let dy = 1; dy <= trunkHeight; dy++) {
                        const y = groundY - dy;
                        if (y >= 0) {
                            tiles[x][y] = BLOCK.LIVING_WOOD;
                        }
                    }
                }

                // 树根 (向下延伸)
                for (let dx = -trunkWidth / 2; dx < trunkWidth / 2; dx++) {
                    const x = Math.floor(cx + dx);
                    if (x < 0 || x >= this.w) continue;

                    for (let dy = 0; dy < rootDepth; dy++) {
                        const y = groundY + dy;
                        if (y < this.h) {
                            tiles[x][y] = BLOCK.LIVING_WOOD;
                            walls[x][y] = 1;
                        }
                    }
                }

                // 地下房间
                const roomY = groundY + Math.floor(rootDepth / 2);
                const roomW = 6 + Math.floor(Math.random() * 4);
                const roomH = 5 + Math.floor(Math.random() * 3);

                for (let dx = -roomW / 2; dx < roomW / 2; dx++) {
                    for (let dy = -roomH / 2; dy < roomH / 2; dy++) {
                        const x = Math.floor(cx + dx);
                        const y = Math.floor(roomY + dy);
                        if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                            tiles[x][y] = BLOCK.AIR;
                            walls[x][y] = 1;
                        }
                    }
                }

                // 宝箱
                if (cx >= 0 && cx < this.w && roomY >= 0 && roomY < this.h) {
                    tiles[cx][Math.floor(roomY + roomH / 2 - 1)] = BLOCK.TREASURE_CHEST;
                    tiles[cx][Math.floor(roomY - roomH / 2 + 1)] = BLOCK.LANTERN;
                }

                // 树冠
                const canopyRadius = trunkWidth + 4 + Math.floor(Math.random() * 3);
                for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
                    for (let dy = -canopyRadius; dy <= 2; dy++) {
                        const x = cx + dx;
                        const y = groundY - trunkHeight + dy;
                        if (x < 0 || x >= this.w || y < 0) continue;

                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= canopyRadius && tiles[x][y] === BLOCK.AIR && Math.random() > 0.2) {
                            tiles[x][y] = BLOCK.LIVING_LEAF;
                        }
                    }
                }
            }

            _createPyramids(tiles, walls) {
                // 找沙漠区域
                for (let x = 50; x < this.w - 50; x += 80) {
                    const biome = this._biome(x);
                    if (biome !== 'desert' && biome !== 'red_desert') continue;
                    if (Math.random() > 0.4) continue;

                    let groundY = 0;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }
                    if (!groundY) continue;

                    const pyramidW = 30 + Math.floor(Math.random() * 20);
                    const pyramidH = Math.floor(pyramidW * 0.6);

                    // 金字塔外壳
                    for (let layer = 0; layer < pyramidH; layer++) {
                        const layerW = pyramidW - layer * 2;
                        const y = groundY - layer;
                        if (y < 0) break;

                        for (let dx = -layerW / 2; dx < layerW / 2; dx++) {
                            const px = Math.floor(x + dx);
                            if (px >= 0 && px < this.w) {
                                tiles[px][y] = BLOCK.SANDSTONE;
                            }
                        }
                    }

                    // 内部通道和房间
                    const corridorY = groundY - Math.floor(pyramidH / 3);
                    const roomY = groundY - Math.floor(pyramidH / 2);

                    // 入口通道
                    for (let dy = 0; dy < pyramidH / 2; dy++) {
                        const y = groundY - dy;
                        if (y >= 0 && tiles[x][y] !== BLOCK.AIR) {
                            tiles[x][y] = BLOCK.AIR;
                            if (x - 1 >= 0) tiles[x - 1][y] = BLOCK.AIR;
                        }
                    }

                    // 宝藏室
                    const treasureRoomW = 8;
                    const treasureRoomH = 6;
                    for (let dx = -treasureRoomW / 2; dx < treasureRoomW / 2; dx++) {
                        for (let dy = -treasureRoomH / 2; dy < treasureRoomH / 2; dy++) {
                            const px = Math.floor(x + dx);
                            const py = Math.floor(roomY + dy);
                            if (px >= 0 && px < this.w && py >= 0 && py < this.h) {
                                tiles[px][py] = BLOCK.AIR;
                                walls[px][py] = 1;
                            }
                        }
                    }

                    // 宝箱和装饰
                    if (x >= 0 && x < this.w && roomY >= 0 && roomY < this.h) {
                        tiles[x][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.TREASURE_CHEST;
                        tiles[x - 2][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.GOLD_BRICK;
                        tiles[x + 2][Math.floor(roomY + treasureRoomH / 2 - 1)] = BLOCK.GOLD_BRICK;
                    }
                }
            }

            _createJungleTemple(tiles, walls, cx, cy) {
                const w = 40 + Math.floor(Math.random() * 20);
                const h = 30 + Math.floor(Math.random() * 15);

                const wallBlock = BLOCK.LIHZAHRD_BRICK;

                // 外墙
                for (let dx = 0; dx < w; dx++) {
                    for (let dy = 0; dy < h; dy++) {
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x >= this.w || y >= this.h) continue;

                        const isWall = dx < 3 || dx >= w - 3 || dy < 3 || dy >= h - 3;
                        tiles[x][y] = isWall ? wallBlock : BLOCK.AIR;
                        if (!isWall) walls[x][y] = 2;
                    }
                }

                // 内部隔墙
                for (let i = 0; i < 5; i++) {
                    const wx = cx + 5 + Math.floor(Math.random() * (w - 10));
                    const wy = cy + 5;
                    const wh = Math.floor(Math.random() * (h - 10));

                    for (let dy = 0; dy < wh; dy++) {
                        if (wx < this.w && wy + dy < this.h) {
                            tiles[wx][wy + dy] = wallBlock;
                        }
                    }
                }

                // 机关和宝藏
                const treasureX = cx + Math.floor(w / 2);
                const treasureY = cy + h - 5;
                if (treasureX < this.w && treasureY < this.h) {
                    tiles[treasureX][treasureY] = BLOCK.TREASURE_CHEST;
                    tiles[treasureX][cy + 4] = BLOCK.LANTERN;
                }

                // 祭坛
                const altarX = cx + Math.floor(w / 2);
                const altarY = cy + Math.floor(h / 2);
                if (altarX < this.w && altarY < this.h) {
                    tiles[altarX][altarY] = BLOCK.ALTAR;
                }
            }

            _createSkyIslandChain(tiles, walls) {
                const chainCount = 1 + Math.floor(Math.random() * 2);

                for (let c = 0; c < chainCount; c++) {
                    const startX = 100 + Math.floor(Math.random() * (this.w - 300));
                    const startY = 8 + Math.floor(Math.random() * 12);
                    const islandCount = 3 + Math.floor(Math.random() * 4);

                    let currentX = startX;
                    let currentY = startY;

                    for (let i = 0; i < islandCount; i++) {
                        const iw = 15 + Math.floor(Math.random() * 15);
                        const ih = 5 + Math.floor(Math.random() * 4);

                        // 云层基础
                        for (let dx = -iw / 2; dx < iw / 2; dx++) {
                            const x = Math.floor(currentX + dx);
                            if (x < 0 || x >= this.w) continue;

                            const edgeDist = Math.min(dx + iw / 2, iw / 2 - dx) / (iw / 2);
                            const height = Math.floor(ih * edgeDist);

                            for (let dy = 0; dy < height; dy++) {
                                const y = currentY + dy;
                                if (y >= 0 && y < this.h) {
                                    if (dy === 0) {
                                        tiles[x][y] = BLOCK.SUNPLATE;
                                    } else if (dy < 2) {
                                        tiles[x][y] = BLOCK.CLOUD;
                                    } else {
                                        tiles[x][y] = Math.random() > 0.5 ? BLOCK.CLOUD : BLOCK.RAIN_CLOUD;
                                    }
                                }
                            }
                        }

                        // 岛上建筑
                        if (Math.random() > 0.4) {
                            const houseX = Math.floor(currentX);
                            const houseY = currentY - 1;
                            if (houseX >= 0 && houseX < this.w && houseY >= 0) {
                                // 小房子
                                for (let hdx = -3; hdx <= 3; hdx++) {
                                    for (let hdy = 0; hdy < 4; hdy++) {
                                        const hx = houseX + hdx;
                                        const hy = houseY - hdy;
                                        if (hx >= 0 && hx < this.w && hy >= 0) {
                                            if (hdx === -3 || hdx === 3 || hdy === 0 || hdy === 3) {
                                                tiles[hx][hy] = BLOCK.SUNPLATE;
                                            } else {
                                                tiles[hx][hy] = BLOCK.AIR;
                                            }
                                        }
                                    }
                                }
                                tiles[houseX][houseY] = BLOCK.TREASURE_CHEST;
                            }
                        }

                        currentX += iw + 10 + Math.floor(Math.random() * 15);
                        currentY += Math.floor(Math.random() * 5) - 2;
                        currentY = Utils.clamp(currentY, 5, 25);
                    }
                }
            }

            _createMushroomBiome(tiles, walls) {
                const biomeCount = 1 + Math.floor(Math.random() * 2);

                for (let b = 0; b < biomeCount; b++) {
                    const cx = 100 + Math.floor(Math.random() * (this.w - 200));
                    const cy = Math.floor(this.h * (0.55 + Math.random() * 0.15));
                    const radius = 30 + Math.floor(Math.random() * 25);

                    // 转换区域为蘑菇生态
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dy = -radius; dy <= radius; dy++) {
                            const x = cx + dx;
                            const y = cy + dy;
                            if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;

                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist > radius) continue;

                            const block = tiles[x][y];

                            // 转换方块
                            if (block === BLOCK.STONE) {
                                tiles[x][y] = Math.random() > 0.3 ? BLOCK.MUSHROOM_GRASS : block;
                            } else if (block === BLOCK.DIRT) {
                                tiles[x][y] = BLOCK.MUD;
                            }

                            // 在空气中生成蘑菇
                            if (block === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                                if (Math.random() > 0.9) {
                                    tiles[x][y] = BLOCK.UNDERGROUND_MUSHROOM;
                                }
                            }
                        }
                    }

                    // 巨型蘑菇
                    for (let i = 0; i < 5 + Math.floor(Math.random() * 5); i++) {
                        const mx = cx + Math.floor((Math.random() - 0.5) * radius);
                        const my = cy + Math.floor((Math.random() - 0.5) * radius);
                        if (mx >= 0 && mx < this.w && my >= 0 && my < this.h) {
                            if (tiles[mx][my] === BLOCK.AIR && my + 1 < this.h && BLOCK_DATA[tiles[mx][my + 1]]?.solid) {
                                this._placeGiantMushroom(tiles, mx, my);
                            }
                        }
                    }
                }
            }

            _createEvilBiome(tiles, walls) {
                const isCrimson = Math.random() > 0.5;
                const stoneType = isCrimson ? BLOCK.CRIMSON_STONE : BLOCK.EBONSTONE;
                const altarType = isCrimson ? BLOCK.CRIMSON_ALTAR : BLOCK.DEMON_ALTAR;

                // 在世界一侧创建邪恶生态
                const side = Math.random() > 0.5 ? 'left' : 'right';
                const startX = side === 'left' ? 30 : this.w - 80;
                const endX = side === 'left' ? 80 : this.w - 30;

                for (let x = startX; x < endX; x++) {
                    for (let y = Math.floor(this.h * 0.25); y < this.h * 0.85; y++) {
                        if (x < 0 || x >= this.w) continue;

                        const block = tiles[x][y];

                        if (block === BLOCK.STONE || block === BLOCK.GRANITE || block === BLOCK.SLATE) {
                            if (Math.random() > 0.3) {
                                tiles[x][y] = stoneType;
                            }
                        } else if (block === BLOCK.GRASS) {
                            tiles[x][y] = isCrimson ? BLOCK.CRIMSON_STONE : BLOCK.CORRUPTION_STONE;
                        }
                    }
                }

                // 放置祭坛
                for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
                    const ax = startX + Math.floor(Math.random() * (endX - startX));
                    const ay = Math.floor(this.h * (0.4 + Math.random() * 0.3));
                    if (ax >= 0 && ax < this.w && ay >= 0 && ay < this.h) {
                        if (tiles[ax][ay] === BLOCK.AIR || tiles[ax][ay] === stoneType) {
                            tiles[ax][ay] = altarType;
                        }
                    }
                }
            }

            _createHallowBiome(tiles, walls) {
                // 在世界另一侧创建神圣生态
                const cx = Math.floor(this.w * 0.7);
                const radius = 40 + Math.floor(Math.random() * 20);

                for (let dx = -radius; dx <= radius; dx++) {
                    for (let y = Math.floor(this.h * 0.25); y < this.h * 0.75; y++) {
                        const x = cx + dx;
                        if (x < 0 || x >= this.w) continue;

                        const dist = Math.abs(dx) / radius;
                        if (dist > 1 || Math.random() > (1 - dist * 0.5)) continue;

                        const block = tiles[x][y];

                        if (block === BLOCK.STONE) {
                            tiles[x][y] = Math.random() > 0.5 ? BLOCK.PEARLSTONE : BLOCK.HALLOW_STONE;
                        } else if (block === BLOCK.GRASS) {
                            tiles[x][y] = BLOCK.HALLOW_STONE;
                        } else if (block === BLOCK.SAND) {
                            tiles[x][y] = BLOCK.PEARLSTONE;
                        }
                    }
                }
            }

            _createOceans(tiles, walls) {
                // 左侧海洋
                this._createOcean(tiles, 0, 60, true);
                // 右侧海洋
                this._createOcean(tiles, this.w - 60, this.w, false);
            }

            _createOcean(tiles, startX, endX, isLeft) {
                const surfY = Math.floor(this.h * CONFIG.SURFACE_LEVEL);
                const oceanDepth = 20 + Math.floor(Math.random() * 15);

                for (let x = startX; x < endX; x++) {
                    if (x < 0 || x >= this.w) continue;

                    // 找地表
                    let groundY = surfY;
                    for (let y = 0; y < this.h; y++) {
                        if (tiles[x][y] !== BLOCK.AIR) { groundY = y; break; }
                    }

                    // 挖深并填水
                    const depth = oceanDepth * (isLeft ? (endX - x) / (endX - startX) : (x - startX) / (endX - startX));

                    for (let dy = 0; dy < depth; dy++) {
                        const y = groundY + dy;
                        if (y >= this.h) break;

                        tiles[x][y] = BLOCK.WATER;
                    }

                    // 海底沙子
                    for (let dy = Math.floor(depth); dy < Math.floor(depth) + 5; dy++) {
                        const y = groundY + dy;
                        if (y >= this.h) break;
                        tiles[x][y] = BLOCK.SAND;
                    }

                    // 海草和海带
                    if (Math.random() > 0.85) {
                        const seaY = groundY + Math.floor(depth) - 1;
                        if (seaY >= 0 && seaY < this.h && tiles[x][seaY] === BLOCK.WATER) {
                            tiles[x][seaY] = Math.random() > 0.5 ? BLOCK.SEAWEED : BLOCK.KELP;
                        }
                    }

                    // 珊瑚
                    if (Math.random() > 0.92) {
                        const coralY = groundY + Math.floor(depth);
                        if (coralY >= 0 && coralY < this.h) {
                            tiles[x][coralY] = BLOCK.CORAL;
                        }
                    }
                }
            }

            _distributeHerbs(tiles) {
                const herbs = [
                    { id: BLOCK.DAYBLOOM, biomes: ['plains', 'forest'], surface: true },
                    { id: BLOCK.MOONGLOW, biomes: ['jungle', 'bamboo'], underground: true },
                    { id: BLOCK.BLINKROOT, biomes: ['all'], underground: true },
                    { id: BLOCK.WATERLEAF, biomes: ['desert', 'red_desert'], surface: true },
                    { id: BLOCK.FIREBLOSSOM, biomes: ['all'], hell: true },
                    { id: BLOCK.SHIVERTHORN, biomes: ['snow', 'tundra'], surface: true },
                    { id: BLOCK.DEATHWEED, biomes: ['all'], underground: true }
                ];

                for (let x = 10; x < this.w - 10; x++) {
                    const biome = this._biome(x);

                    for (const herb of herbs) {
                        if (herb.biomes[0] !== 'all' && !herb.biomes.includes(biome)) continue;
                        if (Math.random() > 0.005) continue;

                        let startY, endY;
                        if (herb.surface) {
                            startY = 0;
                            endY = Math.floor(this.h * 0.35);
                        } else if (herb.underground) {
                            startY = Math.floor(this.h * 0.35);
                            endY = Math.floor(this.h * 0.85);
                        } else if (herb.hell) {
                            startY = Math.floor(this.h * 0.9);
                            endY = this.h - 5;
                        }

                        for (let y = startY; y < endY; y++) {
                            if (tiles[x][y] === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                                tiles[x][y] = herb.id;
                                break;
                            }
                        }
                    }
                }
            }

            _placeLifeCrystals(tiles) {
                const crystalCount = 15 + Math.floor(Math.random() * 10);

                for (let i = 0; i < crystalCount; i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    const y = Math.floor(this.h * (0.4 + Math.random() * 0.4));

                    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                        if (tiles[x][y] === BLOCK.AIR && y + 1 < this.h && BLOCK_DATA[tiles[x][y + 1]]?.solid) {
                            tiles[x][y] = Math.random() > 0.7 ? BLOCK.HEART_CRYSTAL : BLOCK.LIFE_CRYSTAL;
                        }
                    }
                }

                // 魔力水晶
                const manaCount = 10 + Math.floor(Math.random() * 8);
                for (let i = 0; i < manaCount; i++) {
                    const x = 50 + Math.floor(Math.random() * (this.w - 100));
                    const y = Math.floor(this.h * (0.5 + Math.random() * 0.35));

                    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
                        if (tiles[x][y] === BLOCK.AIR) {
                            tiles[x][y] = BLOCK.MANA_CRYSTAL;
                        }
                    }
                }
            }

            _createDungeon(tiles, walls, startX, startY) {
                const roomCount = 4 + Math.floor(Math.random() * 4);
                const rooms = [];

                // 生成房间
                let lastRoom = { x: startX, y: startY, w: 8, h: 6 };
                rooms.push(lastRoom);

                for (let i = 1; i < roomCount; i++) {
                    const dir = Math.floor(Math.random() * 4);
                    let nx = lastRoom.x, ny = lastRoom.y;
                    const nw = 6 + Math.floor(Math.random() * 5);
                    const nh = 5 + Math.floor(Math.random() * 4);

                    switch (dir) {
                        case 0: nx = lastRoom.x + lastRoom.w + 5 + Math.floor(Math.random() * 8); break;
                        case 1: nx = lastRoom.x - nw - 5 - Math.floor(Math.random() * 8); break;
                        case 2: ny = lastRoom.y + lastRoom.h + 3 + Math.floor(Math.random() * 5); break;
                        case 3: ny = lastRoom.y - nh - 3 - Math.floor(Math.random() * 5); break;
                    }

                    if (nx < 10 || nx + nw >= this.w - 10 || ny < this.h * 0.35 || ny + nh >= this.h - 10) continue;

                    const newRoom = { x: nx, y: ny, w: nw, h: nh };
                    rooms.push(newRoom);

                    // 连接走廊
                    this._createCorridor(tiles, walls, lastRoom, newRoom);
                    lastRoom = newRoom;
                }

                // 绘制房间
                const wallBlock = BLOCK.BRICK;
                for (const room of rooms) {
                    for (let dx = 0; dx < room.w; dx++) {
                        for (let dy = 0; dy < room.h; dy++) {
                            const tx = room.x + dx, ty = room.y + dy;
                            if (tx >= this.w || ty >= this.h || tx < 0 || ty < 0) continue;

                            const isWall = dx === 0 || dx === room.w - 1 || dy === 0 || dy === room.h - 1;
                            tiles[tx][ty] = isWall ? wallBlock : BLOCK.AIR;
                            if (!isWall) walls[tx][ty] = 2;
                        }
                    }

                    // 房间装饰
                    const midX = room.x + Math.floor(room.w / 2);
                    const floorY = room.y + room.h - 2;

                    if (midX < this.w && room.y + 1 < this.h) {
                        tiles[midX][room.y + 1] = BLOCK.LANTERN;
                    }

                    // 随机放置物品
                    if (Math.random() > 0.4) {
                        const itemX = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
                        if (itemX < this.w && floorY < this.h && tiles[itemX][floorY] === BLOCK.AIR) {
                            const r = Math.random();
                            if (r > 0.7) tiles[itemX][floorY] = BLOCK.TREASURE_CHEST;
                            else if (r > 0.4) tiles[itemX][floorY] = BLOCK.CRYSTAL;
                            else tiles[itemX][floorY] = BLOCK.BONE;
                        }
                    }

                    // 蜘蛛网
                    if (Math.random() > 0.5) {
                        for (let i = 0; i < 3; i++) {
                            const wx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
                            const wy = room.y + 1 + Math.floor(Math.random() * 2);
                            if (wx < this.w && wy < this.h && tiles[wx][wy] === BLOCK.AIR) {
                                tiles[wx][wy] = BLOCK.SPIDER_WEB;
                            }
                        }
                    }
                }
            }

            _createCorridor(tiles, walls, room1, room2) {
                const x1 = Math.floor(room1.x + room1.w / 2);
                const y1 = Math.floor(room1.y + room1.h / 2);
                const x2 = Math.floor(room2.x + room2.w / 2);
                const y2 = Math.floor(room2.y + room2.h / 2);

                let cx = x1, cy = y1;

                // 先水平后垂直
                while (cx !== x2) {
                    if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                        tiles[cx][cy] = BLOCK.AIR;
                        if (cy - 1 >= 0) tiles[cx][cy - 1] = BLOCK.AIR;
                        if (cy + 1 < this.h) tiles[cx][cy + 1] = BLOCK.AIR;
                        walls[cx][cy] = 2;
                    }
                    cx += cx < x2 ? 1 : -1;
                }

                while (cy !== y2) {
                    if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
                        tiles[cx][cy] = BLOCK.AIR;
                        if (cx - 1 >= 0) tiles[cx - 1][cy] = BLOCK.AIR;
                        if (cx + 1 < this.w) tiles[cx + 1][cy] = BLOCK.AIR;
                        walls[cx][cy] = 2;
                    }
                    cy += cy < y2 ? 1 : -1;
                }
            }

            _lighting(tiles, light) {
                // 阳光（垂直直射）+ 收集光源
                const w = this.w, h = this.h;
                const srcX = [];
                const srcY = [];
                const srcL = [];

                for (let x = 0; x < w; x++) {
                    let sun = CONFIG.LIGHT_LEVELS;
                    const colTiles = tiles[x];
                    const colLight = light[x];

                    for (let y = 0; y < h; y++) {
                        const id = colTiles[y];

                        // SUN_DECAY: 0 / 1 / 3（与原规则一致）
                        const decay = SUN_DECAY[id];
                        if (decay) sun = sun > decay ? (sun - decay) : 0;

                        const bl = BLOCK_LIGHT[id];
                        const v = sun > bl ? sun : bl;
                        colLight[y] = v;

                        // 只扩散“方块光源”，不扩散太阳光（保持旧效果：太阳光只向下直射）
                        if (bl > 0) {
                            srcX.push(x);
                            srcY.push(y);
                            srcL.push(bl);
                        }
                    }
                }

                // 多光源一次性扩散（比逐个光源 BFS 更快，且无需 visited Set / queue.shift）
                if (srcX.length) this._spreadLights(tiles, light, srcX, srcY, srcL);
            }

            _spreadLights(tiles, light, srcX, srcY, srcL) {
                const w = this.w, h = this.h;

                // 复用数组队列（避免对象分配）
                const qx = [];
                const qy = [];
                const ql = [];
                let head = 0;

                for (let i = 0; i < srcX.length; i++) {
                    qx.push(srcX[i]);
                    qy.push(srcY[i]);
                    ql.push(srcL[i]);
                }

                while (head < qx.length) {
                    const x = qx[head];
                    const y = qy[head];
                    const l = ql[head];
                    head++;

                    if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;

                    const colLight = light[x];
                    if (l <= colLight[y]) continue; // 不会变亮就不传播，天然去重
                    colLight[y] = l;

                    const nl = l - (BLOCK_SOLID[tiles[x][y]] ? 2 : 1);
                    if (nl > 0) {
                        // push 顺序与旧实现一致：left, right, up, down
                        qx.push(x - 1, x + 1, x, x);
                        qy.push(y, y, y - 1, y + 1);
                        ql.push(nl, nl, nl, nl);
                    }
                }
            }

        }

        // ───────────────────────── WorldGen: weld StructureDescriptors into terrain ─────────────────────────
        WorldGenerator.prototype._weldStructuresFromLibrary = function (tiles, walls) {
            const TU = window.TU || {};
            const lib = TU.Structures;
            if (!lib) return;
            lib.ensureLoaded();
            if (!lib.count || !lib.count()) return;

            const w = this.w, h = this.h;

            const randInt = (a, b) => (a + Math.floor(Math.random() * (b - a + 1))) | 0;
            const clampI = (n, lo, hi) => (n < lo ? lo : (n > hi ? hi : n)) | 0;

            const groundYAt = (x) => {
                if (x < 0 || x >= w) return -1;
                const col = tiles[x];
                for (let y = 0; y < h; y++) {
                    if (col[y] !== BLOCK.AIR) return y;
                }
                return -1;
            };

            const tryPlace = (desc, anchorX, anchorY) => {
                if (!desc) return false;
                const tlx = (anchorX - Math.floor(desc.w * desc.anchor[0])) | 0;
                const tly = (anchorY - Math.floor(desc.h * desc.anchor[1])) | 0;

                // v11-safe bounds: keep a 1-tile margin to reduce edge-cases
                if (tlx < 1 || tly < 1 || tlx + desc.w >= w - 1 || tly + desc.h >= h - 1) return false;

                // 轻量采样碰撞检测：地下结构要求一定比例的“固体”
                const needSolid = desc.placement.mode !== 'surface';
                const minSolid = desc.placement.minSolidRatio || 0;
                if (needSolid && minSolid > 0) {
                    const samples = 36;
                    let solid = 0;
                    for (let i = 0; i < samples; i++) {
                        const sx = tlx + randInt(0, desc.w - 1);
                        const sy = tly + randInt(0, desc.h - 1);
                        const id = tiles[sx][sy];
                        if (BLOCK_SOLID[id]) solid++;
                    }
                    if (solid / samples < minSolid) return false;
                }

                // 写入结构（grid/legend）
                const defWall = (desc.placement.defaultWall | 0) & 255;

                for (let gy = 0; gy < desc.h; gy++) {
                    const row = desc.grid[gy];
                    const yy = tly + gy;
                    if (yy < 0 || yy >= h) continue;

                    for (let gx = 0; gx < desc.w; gx++) {
                        const xx = tlx + gx;
                        if (xx < 0 || xx >= w) continue;

                        const ch = row[gx];
                        if (ch === ' ') continue;

                        const rule = desc.legend[ch];
                        if (!rule) continue;
                        if (rule.chance < 1 && Math.random() > rule.chance) continue;

                        const cur = tiles[xx][yy];
                        if (rule.replace === 'air' && cur !== BLOCK.AIR) continue;
                        if (rule.replace === 'solid' && !BLOCK_SOLID[cur]) continue;

                        if (rule.tile !== null && rule.tile !== undefined) {
                            tiles[xx][yy] = rule.tile & 255;
                            if ((rule.tile & 255) === BLOCK.AIR && defWall) walls[xx][yy] = defWall;
                        }
                        if (rule.wall !== null && rule.wall !== undefined) {
                            walls[xx][yy] = rule.wall & 255;
                        }
                    }
                }

                // “焊接”：从连接点向外挖掘短通道，尽量连到已有空腔
                if (desc.connectors && desc.connectors.length) {
                    for (let i = 0; i < desc.connectors.length; i++) {
                        const c = desc.connectors[i];
                        const cx = tlx + c.x;
                        const cy = tly + c.y;
                        if (cx < 1 || cx >= w - 1 || cy < 1 || cy >= h - 1) continue;

                        if (c.carve) {
                            const wallId = (c.wall === null || c.wall === undefined) ? defWall : (c.wall & 255);
                            this._carveConnectorTunnel(tiles, walls, cx, cy, c.dir, c.len, wallId);
                        }
                    }
                }
                return true;
            };

            // 计划：按深度分布自动抽取结构
            const scale = Math.max(1, (w / 260));
            const plan = [
                { tag: 'tree', count: randInt(3, 6) * scale, depth: [0.08, 0.32] },
                { tag: 'ruin', count: randInt(6, 10) * scale, depth: [0.34, 0.72] },
                { tag: 'dungeon', count: randInt(8, 14) * scale, depth: [0.60, 0.92] }
            ];

            for (let p = 0; p < plan.length; p++) {
                const { tag, count, depth } = plan[p];
                const triesPer = 12;

                for (let i = 0; i < count; i++) {
                    const dn = depth[0] + Math.random() * (depth[1] - depth[0]);
                    const desc = lib.pick(dn, tag) || lib.pick(dn, [tag, 'room']);

                    let placed = false;
                    for (let t = 0; t < triesPer && !placed; t++) {
                        const x = randInt(20, w - 21);

                        let y;
                        if (desc && desc.placement.mode === 'surface') {
                            const gy = groundYAt(x);
                            if (gy < 0 || gy > h * 0.55) continue;
                            y = gy - 1;
                        } else {
                            y = clampI((dn * h) | 0, 10, h - 11);
                            y += randInt(-12, 12);
                            y = clampI(y, 10, h - 11);
                        }
                        placed = tryPlace(desc, x, y);
                    }
                }
            }
        };

        WorldGenerator.prototype._carveConnectorTunnel = function (tiles, walls, x, y, dir, len, wallId) {
            const w = this.w, h = this.h;
            let dx = 0, dy = 0;
            switch (dir) {
                case 'left': dx = -1; break;
                case 'right': dx = 1; break;
                case 'up': dy = -1; break;
                case 'down': dy = 1; break;
                default: return;
            }

            // 从连接点开始向外“找空腔”：最多 len 格；遇到连续空气（已有洞穴/通道）就停
            let ax = x, ay = y;
            let airStreak = 0;
            for (let i = 0; i < len; i++) {
                ax += dx; ay += dy;
                if (ax < 1 || ax >= w - 1 || ay < 1 || ay >= h - 1) break;

                const cur = tiles[ax][ay];
                if (cur === BLOCK.AIR) {
                    airStreak++;
                    if (i > 3 && airStreak >= 2) break;
                } else {
                    airStreak = 0;
                }

                tiles[ax][ay] = BLOCK.AIR;
                if (wallId) walls[ax][ay] = wallId & 255;

                // 做一点点宽度（避免 1 格通道太别扭）
                if (i > 1 && (dx !== 0)) {
                    if (ay - 1 > 0) { tiles[ax][ay - 1] = BLOCK.AIR; if (wallId) walls[ax][ay - 1] = wallId & 255; }
                    if (ay + 1 < h - 1) { tiles[ax][ay + 1] = BLOCK.AIR; if (wallId) walls[ax][ay + 1] = wallId & 255; }
                } else if (i > 1 && (dy !== 0)) {
                    if (ax - 1 > 0) { tiles[ax - 1][ay] = BLOCK.AIR; if (wallId) walls[ax - 1][ay] = wallId & 255; }
                    if (ax + 1 < w - 1) { tiles[ax + 1][ay] = BLOCK.AIR; if (wallId) walls[ax + 1][ay] = wallId & 255; }
                }
            }
        };

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { WorldGenerator });

// --- Merged from block 46 (line 21802) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_world_worker_patch_v1',
                                            order: 110,
                                            description: "世界生成 Worker + 渲染解耦（v1）",
                                            apply: () => {
                                                'use strict';
                                                if (window.__TU_WORLD_WORKER_PATCHED__) return;
                                                window.__TU_WORLD_WORKER_PATCHED__ = true;

                                                const TU = (window.TU = window.TU || {});

                                                const SUPPORT_GEN_WORKER = (typeof Worker !== 'undefined') && (typeof Blob !== 'undefined') && (typeof URL !== 'undefined');
                                                const SUPPORT_RENDER_WORKER =
                                                    SUPPORT_GEN_WORKER &&
                                                    (typeof OffscreenCanvas !== 'undefined') &&
                                                    (typeof ImageBitmap !== 'undefined');

                                                function _safeNow() {
                                                    try { return performance.now(); } catch (_) { return Date.now(); }
                                                }

                                                function _fnToExpr(fn) {
                                                    const s = String(fn);
                                                    // For class methods, toString() returns "name(args){...}" which isn't a valid expression.
                                                    // Prefix with "function " to make it a valid function expression.
                                                    if (s.startsWith('function')) return s;
                                                    return 'function ' + s;
                                                }

                                                class WorldWorkerClient {
                                                    constructor() {
                                                        // 防御性初始化
                                                        this.worker = null;
                                                        this._initSent = false;
                                                        this._pendingGen = null;
                                                        this._reqId = 1;
                                                        this._state = 'idle';
                                                        this._stateLock = Promise.resolve();
                                                        this._seq = 0;
                                                        this._pending = new Map();
                                                        this._processedSeqs = new Set();

                                                        let __tuWwRender = true;
                                                        try { __tuWwRender = (typeof localStorage === 'undefined' || localStorage.getItem('tuWorkerRender') !== '0'); } catch (_) { __tuWwRender = true; }
                                                        this._renderEnabled = !!SUPPORT_RENDER_WORKER && __tuWwRender;
                                                        this._worldReady = false;

                                                        this._frameInFlight = false;
                                                        this._frameId = 1;
                                                        this._initializing = false;
                                                        this._lastBitmap = null;
                                                        this._lastFrameSentAt = 0;
                                                        this._frameTimeouts = 0;

                                                        this._lightSynced = false;

                                                        this.perf = {
                                                            genMs: null
                                                        };
                                                    }

                                                    get renderEnabled() { return this._renderEnabled; }
                                                    get worldReady() { return this._worldReady; }
                                                    get lightSynced() { return this._lightSynced; }

                                                    _ensureWorker() {
                                                        if (this.worker) return;

                                                        const parts = WorldWorkerClient._buildWorkerSourceParts();
                                                        const blob = new Blob(parts, { type: 'application/javascript' });
                                                        const url = URL.createObjectURL(blob);

                                                        try {
                                                            this.worker = new Worker(url);
                                                        } catch (e) {
                                                            console.error('[WorldWorkerClient] Failed to create worker:', e);
                                                            this._initializing = false;
                                                            throw e;
                                                        }
                                                        URL.revokeObjectURL(url);

                                                        this.worker.onmessage = (e) => this._onMessage(e.data);
                                                        this.worker.onerror = (e) => {
                                                            console.error('[WorldWorker] error event', e);
                                                            if (this._pendingGen) {
                                                                const rej = this._pendingGen.reject;
                                                                this._pendingGen = null;
                                                                try { rej(new Error((e && e.message) ? e.message : 'Worker error')); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            } try { this._frameInFlight = false; this._renderEnabled = false; this._worldReady = false; this._lightSynced = false; if (this._lastBitmap && this._lastBitmap.close) { try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this._lastBitmap = null; const _w = this.worker; if (_w && _w.terminate) { try { _w.terminate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this.worker = null; this._initSent = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }

                                                    _sendInitOnce() {
                                                        if (this._initSent) return;
                                                        this._initSent = true;

                                                        const structuresEl = document.getElementById('tu-structures-json');
                                                        const structuresJSON = structuresEl ? structuresEl.textContent : '[]';

                                                        // Copy typed arrays so we can transfer their buffers without detaching originals.
                                                        let solidBuf = null;
                                                        let lightBuf = null;
                                                        let sunDecayBuf = null;

                                                        try {
                                                            if (typeof BLOCK_SOLID !== 'undefined' && BLOCK_SOLID) {
                                                                const c = new Uint8Array(BLOCK_SOLID);
                                                                solidBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        try {
                                                            if (typeof BLOCK_LIGHT !== 'undefined' && BLOCK_LIGHT) {
                                                                const c = new Uint8Array(BLOCK_LIGHT);
                                                                lightBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        try {
                                                            if (typeof SUN_DECAY !== 'undefined' && SUN_DECAY) {
                                                                const c = new Uint8Array(SUN_DECAY);
                                                                sunDecayBuf = c.buffer;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        const transfer = [];
                                                        if (solidBuf) transfer.push(solidBuf);
                                                        if (lightBuf) transfer.push(lightBuf);
                                                        if (sunDecayBuf) transfer.push(sunDecayBuf);

                                                        this.worker.postMessage({
                                                            type: 'init',
                                                            CONFIG,
                                                            BLOCK,
                                                            BLOCK_DATA,
                                                            structuresJSON,
                                                            solid: solidBuf,
                                                            light: lightBuf,
                                                            sunDecay: sunDecayBuf,
                                                            renderEnabled: this._renderEnabled
                                                        }, transfer);
                                                    }

                                                    async generate(w, h, seed, progressCb) {
                                                        // 防御性参数验证
                                                        if (!SUPPORT_GEN_WORKER) {
                                                            throw new Error('Worker not supported');
                                                        }

                                                        // 验证世界尺寸
                                                        if (!Number.isInteger(w) || w <= 0 || w > 10000) {
                                                            throw new Error(`Invalid world width: ${w}`);
                                                        }
                                                        if (!Number.isInteger(h) || h <= 0 || h > 10000) {
                                                            throw new Error(`Invalid world height: ${h}`);
                                                        }

                                                        // 验证种子
                                                        if (seed === undefined || seed === null) {
                                                            seed = Date.now();
                                                        }

                                                        this._ensureWorker();
                                                        this._sendInitOnce();

                                                        this._worldReady = false;
                                                        this._lightSynced = false;

                                                        return await new Promise((resolve, reject) => {
                                                            const id = this._reqId++;
                                                            this._pendingGen = {
                                                                id,
                                                                resolve,
                                                                reject,
                                                                progressCb: (typeof progressCb === 'function') ? progressCb : null,
                                                                t0: _safeNow()
                                                            };
                                                            this.worker.postMessage({
                                                                type: 'generate',
                                                                id,
                                                                w: w | 0,
                                                                h: h | 0,
                                                                seed: seed,
                                                                keepCopy: !!this._renderEnabled
                                                            });
                                                        });
                                                    }

                                                    _onMessage(msg) {
                                                        // 防御性：验证消息格式
                                                        if (!msg || typeof msg !== 'object') {
                                                            console.warn('[WorldWorkerClient] Invalid message format');
                                                            return;
                                                        }
                                                        if (!msg.type) {
                                                            console.warn('[WorldWorkerClient] Message missing type');
                                                            return;
                                                        }

                                                        // 序列号验证（防重放）
                                                        if (msg._seq !== undefined) {
                                                            if (this._processedSeqs.has(msg._seq)) {
                                                                console.warn(`[WorldWorkerClient] Duplicate message seq: ${msg._seq}`);
                                                                return;
                                                            }
                                                            this._processedSeqs.add(msg._seq);
                                                            if (this._processedSeqs.size > 4096) {
                                                                this._processedSeqs.clear();
                                                                this._processedSeqs.add(msg._seq);
                                                            }
                                                        }

                                                        if (msg.type === 'progress') {
                                                            if (this._pendingGen && msg.id === this._pendingGen.id && this._pendingGen.progressCb) {
                                                                try { this._pendingGen.progressCb(msg.status, msg.percent); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            return;
                                                        }

                                                        if (msg.type === 'done') {
                                                            if (!this._pendingGen || msg.id !== this._pendingGen.id) return;

                                                            const { resolve, t0 } = this._pendingGen;
                                                            this._pendingGen = null;

                                                            const w = msg.w | 0;
                                                            const h = msg.h | 0;

                                                            const tilesBuf = msg.tiles;
                                                            const wallsBuf = msg.walls;
                                                            const lightBuf = msg.light;

                                                            const world = { w, h, tiles: new Array(w), walls: new Array(w), light: new Array(w) };
                                                            for (let x = 0; x < w; x++) {
                                                                world.tiles[x] = new Uint8Array(tilesBuf, x * h, h);
                                                                world.walls[x] = new Uint8Array(wallsBuf, x * h, h);
                                                                world.light[x] = new Uint8Array(lightBuf, x * h, h);
                                                            }

                                                            this._worldReady = true;

                                                            const genMs = (typeof msg.genMs === 'number') ? msg.genMs : (_safeNow() - t0);
                                                            this.perf.genMs = genMs;
                                                            try {
                                                                console.info(`[WorldWorker] generated ${w}x${h} in ${genMs.toFixed(1)}ms`);
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            // Expose perf for manual benchmarking in devtools.
                                                            window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                            window.__TU_PERF__.worldGenMs = genMs;

                                                            resolve(world);
                                                            return;
                                                        }

                                                        if (msg.type === 'error') {
                                                            console.error('[WorldWorker] message error', msg);
                                                            if (this._pendingGen && msg.id === this._pendingGen.id) {
                                                                const rej = this._pendingGen.reject;
                                                                this._pendingGen = null;
                                                                try { rej(new Error(msg.message || 'Worker error')); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            try { this._frameInFlight = false; this._renderEnabled = false; this._worldReady = false; this._lightSynced = false; if (this._lastBitmap && this._lastBitmap.close) { try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this._lastBitmap = null; const _w = this.worker; if (_w && _w.terminate) { try { _w.terminate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } } this.worker = null; this._initSent = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } return;
                                                        }

                                                        if (msg.type === 'frame') {
                                                            // Bitmap world layer for main thread to draw.
                                                            if (this._lastBitmap && this._lastBitmap.close) {
                                                                try { this._lastBitmap.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            this._lastBitmap = msg.bitmap || null;
                                                            this._frameInFlight = false;
                                                            this._lastFrameSentAt = 0;
                                                            this._frameTimeouts = 0;
                                                            return;
                                                        }
                                                    }

                                                    requestFrame(cam, time, renderer) {
                                                        // 防御性状态检查
                                                        if (!this._renderEnabled || !this._worldReady || !this.worker) return;

                                                        // 验证相机对象
                                                        if (!cam || typeof cam.x !== 'number' || typeof cam.y !== 'number') {
                                                            console.warn('[WorldWorkerClient] Invalid camera object');
                                                            return;
                                                        }

                                                        // 验证renderer
                                                        if (!renderer || typeof renderer.w !== 'number' || typeof renderer.h !== 'number') {
                                                            console.warn('[WorldWorkerClient] Invalid renderer object');
                                                            return;
                                                        }

                                                        const now = (performance && performance.now) ? performance.now() : Date.now();

                                                        // Watchdog: prevent permanent stall if worker never returns a frame.
                                                        if (this._frameInFlight) {
                                                            if (this._lastFrameSentAt && (now - this._lastFrameSentAt) > 1500) {
                                                                this._frameTimeouts = (this._frameTimeouts | 0) + 1;
                                                                console.warn('[WorldWorkerClient] Frame timeout, resetting inFlight (count=' + this._frameTimeouts + ')');

                                                                this._frameInFlight = false;

                                                                // Too many consecutive timeouts -> disable worker rendering to fall back.
                                                                if (this._frameTimeouts >= 3) {
                                                                    console.warn('[WorldWorkerClient] Too many frame timeouts, disabling worker rendering');
                                                                    this._renderEnabled = false;
                                                                    this._frameTimeouts = 0;
                                                                    return;
                                                                }
                                                            }
                                                            return;
                                                        }

                                                        this._frameInFlight = true;
                                                        this._lastFrameSentAt = now;
                                                        const id = this._frameId++;

                                                        // Use renderer's CSS units & DPR to match its coordinate system.
                                                        const wCss = renderer && renderer.w ? renderer.w : 0;
                                                        const hCss = renderer && renderer.h ? renderer.h : 0;
                                                        const dpr = renderer && renderer.dpr ? renderer.dpr : 1;

                                                        try {
                                                            this.worker.postMessage({
                                                                type: 'render',
                                                                id,
                                                                camX: cam.x,
                                                                camY: cam.y,
                                                                time: time,
                                                                wCss: wCss,
                                                                hCss: hCss,
                                                                dpr: dpr
                                                            });
                                                        } catch (e) {
                                                            // If postMessage fails (e.g., terminated worker), reset flags to avoid perma-stall
                                                            this._frameInFlight = false;
                                                            this._lastFrameSentAt = 0;
                                                            this._frameTimeouts = 0;
                                                            this._renderEnabled = false; // fall back to main-thread renderer
                                                            window.TU_Defensive && window.TU_Defensive.ErrorReporter && window.TU_Defensive.ErrorReporter.report(e, { source: 'WorldWorkerClient.postMessage' });
                                                        }
                                                    }

                                                    consumeBitmap() {
                                                        const bm = this._lastBitmap;
                                                        this._lastBitmap = null;
                                                        return bm;
                                                    }

                                                    notifyTile(x, y, id) {
                                                        if (!this._renderEnabled || !this.worker) return;
                                                        this.worker.postMessage({ type: 'tile', x: x | 0, y: y | 0, id: id | 0 });
                                                    }

                                                    applyDiffMap(diffMap) {
                                                        if (!this._renderEnabled || !this.worker || !diffMap || !diffMap.size) return;

                                                        const n = diffMap.size;
                                                        const triples = new Int32Array(n * 3);
                                                        let i = 0;

                                                        for (const [key, val] of diffMap.entries()) {
                                                            const comma = key.indexOf(',');
                                                            if (comma < 0) continue;
                                                            triples[i++] = (key.slice(0, comma) | 0);
                                                            triples[i++] = (key.slice(comma + 1) | 0);
                                                            triples[i++] = (val | 0);
                                                        }

                                                        // If some entries were skipped due to malformed keys, slice to real size.
                                                        const buf = (i === triples.length) ? triples.buffer : triples.slice(0, i).buffer;
                                                        this.worker.postMessage({ type: 'tileBatch', buf }, [buf]);
                                                    }

                                                    syncLightFull(world) {
                                                        if (!this._renderEnabled || !this.worker || !world || !world.light) return;

                                                        const w = world.w | 0;
                                                        const h = world.h | 0;

                                                        const flat = new Uint8Array(w * h);
                                                        for (let x = 0; x < w; x++) {
                                                            flat.set(world.light[x], x * h);
                                                        }

                                                        const buf = flat.buffer;
                                                        this.worker.postMessage({ type: 'lightFull', w, h, buf }, [buf]);
                                                        this._lightSynced = true;
                                                    }

                                                    syncLightRegion(world, cx, cy, r) {
                                                        if (!this._renderEnabled || !this.worker || !world || !world.light) return;
                                                        if (!this._lightSynced) return; // suppress spam during load; full sync happens after init

                                                        const w = world.w | 0;
                                                        const h = world.h | 0;
                                                        const rr = (r == null) ? 14 : (r | 0);

                                                        const x0 = Math.max(0, (cx | 0) - rr);
                                                        const x1 = Math.min(w - 1, (cx | 0) + rr);
                                                        const y0 = Math.max(0, (cy | 0) - rr);
                                                        const y1 = Math.min(h - 1, (cy | 0) + rr);

                                                        const rw = (x1 - x0 + 1) | 0;
                                                        const rh = (y1 - y0 + 1) | 0;
                                                        if (rw <= 0 || rh <= 0) return;

                                                        const flat = new Uint8Array(rw * rh);
                                                        for (let x = x0; x <= x1; x++) {
                                                            const col = world.light[x];
                                                            const off = (x - x0) * rh;
                                                            for (let y = y0; y <= y1; y++) {
                                                                flat[off + (y - y0)] = col[y] | 0;
                                                            }
                                                        }

                                                        const buf = flat.buffer;
                                                        this.worker.postMessage({ type: 'lightRegion', x0, y0, w: rw, h: rh, buf }, [buf]);
                                                    }

                                                    static _buildWorkerSourceParts() {
                                                        if (WorldWorkerClient.__cachedWorkerParts) return WorldWorkerClient.__cachedWorkerParts;

                                                        // Capture current (possibly patched) generator code.
                                                        const NG = (typeof NoiseGenerator !== 'undefined') ? NoiseGenerator : null;
                                                        const WG = (typeof WorldGenerator !== 'undefined') ? WorldGenerator : null;

                                                        const parts = [];
                                                        const PRE = `'use strict';\n` +
                                                            `const window = self;\n` +
                                                            `let CONFIG=null, BLOCK=null, BLOCK_DATA=null;\n` +
                                                            `let BLOCK_SOLID=null, BLOCK_LIGHT=null, SUN_DECAY=null;\n` +
                                                            `let __STRUCT_JSON='[]';\n` +
                                                            `let __AIR=0;\n` +
                                                            `const Utils = { clamp: (v,a,b) => Math.max(a, Math.min(b, v)) };\n`;
                                                        parts.push(PRE);

                                                        // Minimal TU.Structures for patched structure welding.
                                                        parts.push("self.TU = self.TU || {};\n");
                                                        parts.push("self.TU.Structures = (function(){\n");
                                                        parts.push("  let _loaded = false;\n");
                                                        parts.push("  let _list = [];\n");
                                                        parts.push("  function _normDepth(d){\n");
                                                        parts.push("    if (Array.isArray(d) && d.length>=2) return [+(d[0]||0), +(d[1]||1)];\n");
                                                        parts.push("    return [0,1];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function _toId(name){\n");
                                                        parts.push("    if (!name) return 0;\n");
                                                        parts.push("    const v = BLOCK && (BLOCK[name] != null) ? BLOCK[name] : 0;\n");
                                                        parts.push("    return v|0;\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function _normalize(raw){\n");
                                                        parts.push("    if (!raw || !Array.isArray(raw.pattern)) return null;\n");
                                                        parts.push("    const grid = raw.pattern.slice();\n");
                                                        parts.push("    const h = grid.length|0;\n");
                                                        parts.push("    let w = 0;\n");
                                                        parts.push("    for (let i=0;i<grid.length;i++){ const row=grid[i]||''; if (row.length>w) w=row.length; }\n");
                                                        parts.push("    const legend = {};\n");
                                                        parts.push("    if (raw.legend){\n");
                                                        parts.push("      for (const ch in raw.legend){\n");
                                                        parts.push("        const r = raw.legend[ch] || {};\n");
                                                        parts.push("        legend[ch] = {\n");
                                                        parts.push("          tile: _toId(r.tile),\n");
                                                        parts.push("          wall: _toId(r.wall),\n");
                                                        parts.push("          replace: r.replace || 'any',\n");
                                                        parts.push("          chance: (r.chance==null?1:+r.chance)\n");
                                                        parts.push("        };\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    return {\n");
                                                        parts.push("      id: raw.id || '',\n");
                                                        parts.push("      tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],\n");
                                                        parts.push("      weight: +raw.weight || 1,\n");
                                                        parts.push("      depth: _normDepth(raw.depth),\n");
                                                        parts.push("      anchor: Array.isArray(raw.anchor) ? [raw.anchor[0]|0, raw.anchor[1]|0] : [0,0],\n");
                                                        parts.push("      placement: raw.placement || {},\n");
                                                        parts.push("      grid,\n");
                                                        parts.push("      w,\n");
                                                        parts.push("      h,\n");
                                                        parts.push("      legend,\n");
                                                        parts.push("      connectors: Array.isArray(raw.connectors) ? raw.connectors.map(c=>({x:c.x|0,y:c.y|0,dir:c.dir||'down'})) : []\n");
                                                        parts.push("    };\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function ensureLoaded(){\n");
                                                        parts.push("    if (_loaded) return;\n");
                                                        parts.push("    _loaded = true;\n");
                                                        parts.push("    let raw = [];\n");
                                                        parts.push("    try { raw = JSON.parse(__STRUCT_JSON || '[]'); } catch (_) { raw = []; }\n");
                                                        parts.push("    _list = raw.map(_normalize).filter(Boolean);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  function count(){ ensureLoaded(); return _list.length; }\n");
                                                        parts.push("  function pick(depthN, tags){\n");
                                                        parts.push("    ensureLoaded();\n");
                                                        parts.push("    const tagArr = Array.isArray(tags) ? tags : (tags ? [tags] : []);\n");
                                                        parts.push("    const candidates = [];\n");
                                                        parts.push("    for (let i=0;i<_list.length;i++){\n");
                                                        parts.push("      const d = _list[i];\n");
                                                        parts.push("      if (depthN < d.depth[0] || depthN > d.depth[1]) continue;\n");
                                                        parts.push("      if (tagArr.length){\n");
                                                        parts.push("        let ok=false;\n");
                                                        parts.push("        for (let k=0;k<tagArr.length;k++){ if (d.tags && d.tags.indexOf(tagArr[k])>=0){ ok=true; break; } }\n");
                                                        parts.push("        if (!ok) continue;\n");
                                                        parts.push("      }\n");
                                                        parts.push("      candidates.push(d);\n");
                                                        parts.push("    }\n");
                                                        parts.push("    const pool = candidates.length ? candidates : _list;\n");
                                                        parts.push("    if (!pool.length) return null;\n");
                                                        parts.push("    let sum = 0;\n");
                                                        parts.push("    for (let i=0;i<pool.length;i++) sum += pool[i].weight || 1;\n");
                                                        parts.push("    let r = Math.random() * sum;\n");
                                                        parts.push("    for (let i=0;i<pool.length;i++){ r -= pool[i].weight || 1; if (r<=0) return pool[i]; }\n");
                                                        parts.push("    return pool[pool.length-1];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  return { ensureLoaded, count, pick };\n");
                                                        parts.push("})();\n");

                                                        // Include generator classes.
                                                        if (NG) parts.push(NG.toString(), "\n");
                                                        if (WG) parts.push(WG.toString(), "\n");

                                                        // Re-apply any prototype patches that were applied on the main thread (biomes/structures/etc).
                                                        const patchNames = [
                                                            '_weldStructuresFromLibrary',
                                                            '_carveConnectorTunnel',
                                                            '_biome',
                                                            '_getSurfaceBlock',
                                                            '_getSubSurfaceBlock',
                                                            '_getUndergroundBlock',
                                                            '_getUndergroundBlockLegacy',
                                                            '_placeTemple',
                                                            '_generateMultiLayerMines',
                                                            '_structures'
                                                        ];
                                                        if (WG && WG.prototype) {
                                                            for (let i = 0; i < patchNames.length; i++) {
                                                                const name = patchNames[i];
                                                                const fn = WG.prototype[name];
                                                                if (typeof fn === 'function') {
                                                                    const expr = _fnToExpr(fn.toString());
                                                                    parts.push("WorldGenerator.prototype.", name, " = ", expr, ";\n");
                                                                }
                                                            }
                                                        }

                                                        // Simple render (world layer only) to ImageBitmap using OffscreenCanvas.
                                                        parts.push("let __renderEnabled = false;\n");
                                                        parts.push("let __worldW=0, __worldH=0;\n");
                                                        parts.push("let __tiles=null, __walls=null, __light=null;\n");
                                                        parts.push("let __tileLUT=null, __wallLUT=null, __maxId=0;\n");
                                                        parts.push("function __nightFactor(time){\n");
                                                        parts.push("  // same shape as Utils.nightFactor (0 day -> 1 night)\n");
                                                        parts.push("  const t = time - Math.floor(time);\n");
                                                        parts.push("  const d = Math.min(Math.abs(t - 0.5) * 2, 1);\n");
                                                        parts.push("  return Math.min(1, Math.pow(d, 2));\n");
                                                        parts.push("}\n");
                                                        parts.push("function __parseHexColor(hex){\n");
                                                        parts.push("  if (!hex || typeof hex !== 'string') return [128,128,128];\n");
                                                        parts.push("  const s = hex.trim();\n");
                                                        parts.push("  if (s[0] !== '#') return [128,128,128];\n");
                                                        parts.push("  if (s.length === 4){\n");
                                                        parts.push("    const r = parseInt(s[1]+s[1],16), g=parseInt(s[2]+s[2],16), b=parseInt(s[3]+s[3],16);\n");
                                                        parts.push("    return [r|0,g|0,b|0];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  if (s.length === 7){\n");
                                                        parts.push("    const r = parseInt(s.slice(1,3),16), g=parseInt(s.slice(3,5),16), b=parseInt(s.slice(5,7),16);\n");
                                                        parts.push("    return [r|0,g|0,b|0];\n");
                                                        parts.push("  }\n");
                                                        parts.push("  return [128,128,128];\n");
                                                        parts.push("}\n");
                                                        parts.push("function __buildColorLUT(){\n");
                                                        parts.push("  if (!BLOCK_DATA || !BLOCK) return;\n");
                                                        parts.push("  __maxId = 0;\n");
                                                        parts.push("  for (const k in BLOCK){ const v = BLOCK[k]|0; if (v>__maxId) __maxId=v; }\n");
                                                        parts.push("  const maxLight = 15;\n");
                                                        parts.push("  __tileLUT = new Array((__maxId+1)*16);\n");
                                                        parts.push("  __wallLUT = new Array((__maxId+1)*16);\n");
                                                        parts.push("  for (let id=0; id<=__maxId; id++){\n");
                                                        parts.push("    const data = BLOCK_DATA[id] || BLOCK_DATA[String(id)] || {};\n");
                                                        parts.push("    const rgb = __parseHexColor(data.color);\n");
                                                        parts.push("    for (let l=0; l<16; l++){\n");
                                                        parts.push("      const m = l / maxLight;\n");
                                                        parts.push("      const r = (rgb[0]*m)|0, g=(rgb[1]*m)|0, b=(rgb[2]*m)|0;\n");
                                                        parts.push("      __tileLUT[id*16+l] = 'rgb(' + r + ',' + g + ',' + b + ')';\n");
                                                        parts.push("      const wr=(rgb[0]*m*0.6)|0, wg=(rgb[1]*m*0.6)|0, wb=(rgb[2]*m*0.6)|0;\n");
                                                        parts.push("      __wallLUT[id*16+l] = 'rgb(' + wr + ',' + wg + ',' + wb + ')';\n");
                                                        parts.push("    }\n");
                                                        parts.push("  }\n");
                                                        parts.push("}\n");
                                                        parts.push("class __SimpleWorldRenderer {\n");
                                                        parts.push("  constructor(){\n");
                                                        parts.push("    this.canvas = new OffscreenCanvas(1,1);\n");
                                                        parts.push("    this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });\n");
                                                        parts.push("    this.wCss = 1; this.hCss = 1; this.dpr = 1;\n");
                                                        parts.push("    this.ts = (CONFIG && CONFIG.TILE_SIZE) ? CONFIG.TILE_SIZE : 16;\n");
                                                        parts.push("  }\n");
                                                        parts.push("  resize(wCss,hCss,dpr){\n");
                                                        parts.push("    wCss = Math.max(1, wCss|0);\n");
                                                        parts.push("    hCss = Math.max(1, hCss|0);\n");
                                                        parts.push("    dpr = (dpr && dpr>0) ? dpr : 1;\n");
                                                        parts.push("    const wPx = Math.max(1, Math.floor(wCss * dpr));\n");
                                                        parts.push("    const hPx = Math.max(1, Math.floor(hCss * dpr));\n");
                                                        parts.push("    if (this.canvas.width !== wPx) this.canvas.width = wPx;\n");
                                                        parts.push("    if (this.canvas.height !== hPx) this.canvas.height = hPx;\n");
                                                        parts.push("    this.wCss = wCss; this.hCss = hCss; this.dpr = dpr;\n");
                                                        parts.push("    this.ctx.setTransform(dpr,0,0,dpr,0,0);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  render(camX, camY, time){\n");
                                                        parts.push("    const ctx = this.ctx;\n");
                                                        parts.push("    const ts = this.ts;\n");
                                                        parts.push("    const wCss = this.wCss;\n");
                                                        parts.push("    const hCss = this.hCss;\n");
                                                        parts.push("    const halfW = wCss/2;\n");
                                                        parts.push("    const halfH = hCss/2;\n");
                                                        parts.push("    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);\n");
                                                        parts.push("    ctx.clearRect(0,0,wCss,hCss);\n");
                                                        parts.push("    const margin = 2;\n");
                                                        parts.push("    const x0 = Math.max(0, Math.floor((camX - halfW)/ts) - margin);\n");
                                                        parts.push("    const x1 = Math.min(__worldW-1, Math.floor((camX + halfW)/ts) + margin);\n");
                                                        parts.push("    const y0 = Math.max(0, Math.floor((camY - halfH)/ts) - margin);\n");
                                                        parts.push("    const y1 = Math.min(__worldH-1, Math.floor((camY + halfH)/ts) + margin);\n");
                                                        parts.push("    // Walls behind air\n");
                                                        parts.push("    for (let y=y0; y<=y1; y++){\n");
                                                        parts.push("      const sy = y*ts - camY + halfH;\n");
                                                        parts.push("      let runStart = x0;\n");
                                                        parts.push("      let runStyle = null;\n");
                                                        parts.push("      for (let x=x0; x<=x1+1; x++){\n");
                                                        parts.push("        let style = null;\n");
                                                        parts.push("        if (x<=x1){\n");
                                                        parts.push("          const idx = x*__worldH + y;\n");
                                                        parts.push("          const tid = __tiles ? __tiles[idx] : 0;\n");
                                                        parts.push("          const wid = __walls ? __walls[idx] : 0;\n");
                                                        parts.push("          if (wid && tid===__AIR){\n");
                                                        parts.push("            const lv = __light ? (__light[idx]&15) : 15;\n");
                                                        parts.push("            style = __wallLUT ? __wallLUT[wid*16 + lv] : 'rgb(40,40,40)';\n");
                                                        parts.push("          }\n");
                                                        parts.push("        }\n");
                                                        parts.push("        if (style !== runStyle){\n");
                                                        parts.push("          if (runStyle){\n");
                                                        parts.push("            ctx.fillStyle = runStyle;\n");
                                                        parts.push("            const sx = runStart*ts - camX + halfW;\n");
                                                        parts.push("            ctx.fillRect(sx, sy, (x-runStart)*ts, ts);\n");
                                                        parts.push("          }\n");
                                                        parts.push("          runStyle = style;\n");
                                                        parts.push("          runStart = x;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    // Foreground tiles\n");
                                                        parts.push("    for (let y=y0; y<=y1; y++){\n");
                                                        parts.push("      const sy = y*ts - camY + halfH;\n");
                                                        parts.push("      let runStart = x0;\n");
                                                        parts.push("      let runStyle = null;\n");
                                                        parts.push("      for (let x=x0; x<=x1+1; x++){\n");
                                                        parts.push("        let style = null;\n");
                                                        parts.push("        if (x<=x1){\n");
                                                        parts.push("          const idx = x*__worldH + y;\n");
                                                        parts.push("          const tid = __tiles ? __tiles[idx] : 0;\n");
                                                        parts.push("          if (tid && tid!==__AIR){\n");
                                                        parts.push("            const lv = __light ? (__light[idx]&15) : 15;\n");
                                                        parts.push("            style = __tileLUT ? __tileLUT[tid*16 + lv] : 'rgb(120,120,120)';\n");
                                                        parts.push("          }\n");
                                                        parts.push("        }\n");
                                                        parts.push("        if (style !== runStyle){\n");
                                                        parts.push("          if (runStyle){\n");
                                                        parts.push("            ctx.fillStyle = runStyle;\n");
                                                        parts.push("            const sx = runStart*ts - camX + halfW;\n");
                                                        parts.push("            ctx.fillRect(sx, sy, (x-runStart)*ts, ts);\n");
                                                        parts.push("          }\n");
                                                        parts.push("          runStyle = style;\n");
                                                        parts.push("          runStart = x;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("    }\n");
                                                        parts.push("    // Global night tint (cheap)\n");
                                                        parts.push("    const nf = __nightFactor(time || 0);\n");
                                                        parts.push("    if (nf > 0.001){\n");
                                                        parts.push("      ctx.fillStyle = 'rgba(0,0,0,' + (nf*0.35) + ')';\n");
                                                        parts.push("      ctx.fillRect(0,0,wCss,hCss);\n");
                                                        parts.push("    }\n");
                                                        parts.push("    return this.canvas.transferToImageBitmap();\n");
                                                        parts.push("  }\n");
                                                        parts.push("}\n");

                                                        // Worker message handler.
                                                        parts.push("async function __doGenerate(id,w,h,seed,keepCopy){\n");
                                                        parts.push("  const t0 = (self.performance && performance.now) ? performance.now() : Date.now();\n");
                                                        parts.push("  const gen = new WorldGenerator(w,h,seed);\n");
                                                        parts.push("  const data = await gen.generate((status, percent)=>{\n");
                                                        parts.push("    self.postMessage({ type: 'progress', id, status, percent });\n");
                                                        parts.push("  });\n");
                                                        parts.push("  // Flatten column arrays into a single transferable buffer per layer.\n");
                                                        parts.push("  const tilesBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const wallsBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const lightBuf = new ArrayBuffer(w*h);\n");
                                                        parts.push("  const tilesFlat = new Uint8Array(tilesBuf);\n");
                                                        parts.push("  const wallsFlat = new Uint8Array(wallsBuf);\n");
                                                        parts.push("  const lightFlat = new Uint8Array(lightBuf);\n");
                                                        parts.push("  for (let x=0; x<w; x++){\n");
                                                        parts.push("    tilesFlat.set(data.tiles[x], x*h);\n");
                                                        parts.push("    wallsFlat.set(data.walls[x], x*h);\n");
                                                        parts.push("    lightFlat.set(data.light[x], x*h);\n");
                                                        parts.push("  }\n");
                                                        parts.push("  if (keepCopy && __renderEnabled){\n");
                                                        parts.push("    __worldW = w; __worldH = h;\n");
                                                        parts.push("    __tiles = new Uint8Array(tilesBuf.slice(0));\n");
                                                        parts.push("    __walls = new Uint8Array(wallsBuf.slice(0));\n");
                                                        parts.push("    __light = new Uint8Array(lightBuf.slice(0));\n");
                                                        parts.push("    if (!__tileLUT) __buildColorLUT();\n");
                                                        parts.push("  }\n");
                                                        parts.push("  const t1 = (self.performance && performance.now) ? performance.now() : Date.now();\n");
                                                        parts.push("  const genMs = t1 - t0;\n");
                                                        parts.push("  self.postMessage({ type: 'done', id, w, h, tiles: tilesBuf, walls: wallsBuf, light: lightBuf, genMs }, [tilesBuf, wallsBuf, lightBuf]);\n");
                                                        parts.push("}\n");

                                                        parts.push("self.onmessage = async (e) => {\n");
                                                        parts.push("  const msg = e.data || {};\n");
                                                        parts.push("  const type = msg.type;\n");
                                                        parts.push("  try {\n");
                                                        parts.push("    if (type === 'init'){\n");
                                                        parts.push("      CONFIG = msg.CONFIG || null;\n");
                                                        parts.push("      BLOCK = msg.BLOCK || null;\n");
                                                        parts.push("      BLOCK_DATA = msg.BLOCK_DATA || null;\n");
                                                        parts.push("      __STRUCT_JSON = msg.structuresJSON || '[]';\n");
                                                        parts.push("      BLOCK_SOLID = msg.solid ? new Uint8Array(msg.solid) : null;\n");
                                                        parts.push("      BLOCK_LIGHT = msg.light ? new Uint8Array(msg.light) : null;\n");
                                                        parts.push("      SUN_DECAY = msg.sunDecay ? new Uint8Array(msg.sunDecay) : null;\n");
                                                        parts.push("      __AIR = (BLOCK && (BLOCK.AIR != null)) ? (BLOCK.AIR|0) : 0;\n");
                                                        parts.push("      __renderEnabled = !!msg.renderEnabled && (typeof OffscreenCanvas !== 'undefined');\n");
                                                        parts.push("      __buildColorLUT();\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'generate'){\n");
                                                        parts.push("      const id = msg.id|0;\n");
                                                        parts.push("      const w = msg.w|0;\n");
                                                        parts.push("      const h = msg.h|0;\n");
                                                        parts.push("      const seed = msg.seed;\n");
                                                        parts.push("      const keepCopy = !!msg.keepCopy;\n");
                                                        parts.push("      await __doGenerate(id,w,h,seed,keepCopy);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'tile'){\n");
                                                        parts.push("      if (!__tiles) return;\n");
                                                        parts.push("      const x = msg.x|0, y = msg.y|0, id = msg.id|0;\n");
                                                        parts.push("      if (x<0||y<0||x>=__worldW||y>=__worldH) return;\n");
                                                        parts.push("      __tiles[x*__worldH + y] = id;\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'tileBatch'){\n");
                                                        parts.push("      if (!__tiles || !msg.buf) return;\n");
                                                        parts.push("      const a = new Int32Array(msg.buf);\n");
                                                        parts.push("      for (let i=0; i<a.length; i+=3){\n");
                                                        parts.push("        const x=a[i]|0, y=a[i+1]|0, id=a[i+2]|0;\n");
                                                        parts.push("        if (x<0||y<0||x>=__worldW||y>=__worldH) continue;\n");
                                                        parts.push("        __tiles[x*__worldH + y] = id;\n");
                                                        parts.push("      }\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'lightFull'){\n");
                                                        parts.push("      if (!msg.buf) return;\n");
                                                        parts.push("      const w = msg.w|0, h = msg.h|0;\n");
                                                        parts.push("      __worldW = w; __worldH = h;\n");
                                                        parts.push("      __light = new Uint8Array(msg.buf);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'lightRegion'){\n");
                                                        parts.push("      if (!__light || !msg.buf) return;\n");
                                                        parts.push("      const x0 = msg.x0|0, y0 = msg.y0|0;\n");
                                                        parts.push("      const w = msg.w|0, h = msg.h|0;\n");
                                                        parts.push("      const src = new Uint8Array(msg.buf);\n");
                                                        parts.push("      for (let dx=0; dx<w; dx++){\n");
                                                        parts.push("        const off = dx*h;\n");
                                                        parts.push("        const x = x0 + dx;\n");
                                                        parts.push("        if (x<0||x>=__worldW) continue;\n");
                                                        parts.push("        for (let dy=0; dy<h; dy++){\n");
                                                        parts.push("          const y = y0 + dy;\n");
                                                        parts.push("          if (y<0||y>=__worldH) continue;\n");
                                                        parts.push("          __light[x*__worldH + y] = src[off + dy] & 15;\n");
                                                        parts.push("        }\n");
                                                        parts.push("      }\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("    if (type === 'render'){\n");
                                                        parts.push("      if (!__renderEnabled || !__tiles) return;\n");
                                                        parts.push("      if (!__tileLUT) __buildColorLUT();\n");
                                                        parts.push("      if (!self.__tuRenderer) self.__tuRenderer = new __SimpleWorldRenderer();\n");
                                                        parts.push("      const r = self.__tuRenderer;\n");
                                                        parts.push("      const wCss = msg.wCss|0;\n");
                                                        parts.push("      const hCss = msg.hCss|0;\n");
                                                        parts.push("      const dpr = msg.dpr || 1;\n");
                                                        parts.push("      r.resize(wCss,hCss,dpr);\n");
                                                        parts.push("      const bmp = r.render(+msg.camX||0, +msg.camY||0, +msg.time||0);\n");
                                                        parts.push("      self.postMessage({ type: 'frame', id: msg.id|0, bitmap: bmp }, [bmp]);\n");
                                                        parts.push("      return;\n");
                                                        parts.push("    }\n");
                                                        parts.push("  } catch (err) {\n");
                                                        parts.push("    self.postMessage({ type: 'error', id: msg.id|0, message: String(err && err.message ? err.message : err), stack: err && err.stack ? String(err.stack) : '' });\n");
                                                        parts.push("  }\n");
                                                        parts.push("};\n");

                                                        WorldWorkerClient.__cachedWorkerParts = parts;
                                                        return parts;
                                                    }
                                                }

                                                TU._worldWorkerClient = TU._worldWorkerClient || new WorldWorkerClient();

                                                // 1) Patch WorldGenerator.generate -> delegate to worker (fallback to main thread on any failure).
                                                if (typeof WorldGenerator !== 'undefined' && WorldGenerator.prototype && typeof WorldGenerator.prototype.generate === 'function') {
                                                    const _origGenerate = WorldGenerator.prototype.generate;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerGenerateWrapped', null) : !WorldGenerator.prototype.__tu_workerGenerateWrapped) {
                                                        // [refactor] Removed obsolete alias: WorldGenerator.prototype._generateMainThread (keep local _origGenerate only).
                                                        WorldGenerator.prototype.generate = async function (progressCb) {
                                                            const client = TU._worldWorkerClient;

                                                            // If workers aren't supported, keep original behavior.
                                                            if (!SUPPORT_GEN_WORKER) {
                                                                return _origGenerate.call(this, progressCb);
                                                            }

                                                            try {
                                                                const world = await client.generate(this.w, this.h, this.seed, progressCb);

                                                                // Attach bridge to current game instance (boot script sets window.__GAME_INSTANCE__).
                                                                const g = window.__GAME_INSTANCE__;
                                                                if (g) {
                                                                    g._worldWorkerClient = client;
                                                                    if (g.renderer) g.renderer.__ww = client;
                                                                }

                                                                return world;
                                                            } catch (err) {
                                                                console.warn('[WorldWorker] generation failed; falling back to main thread.', err);
                                                                return _origGenerate.call(this, progressCb);
                                                            }
                                                        };
                                                    }
                                                }

                                                // 2) Patch Renderer.renderWorld: if worker has a ready bitmap, draw it; otherwise fallback.
                                                if (typeof Renderer !== 'undefined' && Renderer.prototype && typeof Renderer.prototype.renderWorld === 'function') {
                                                    const _origRW = Renderer.prototype.renderWorld;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerRenderWorldWrapped', null) : !Renderer.prototype.__tu_workerRenderWorldWrapped) {
                                                        Renderer.prototype.renderWorld = function (world, cam, time) {
                                                            const ww = this.__ww;
                                                            if (ww && ww.renderEnabled && ww.worldReady) {
                                                                ww.requestFrame(cam, time, this);
                                                                const bm = ww.consumeBitmap();
                                                                if (bm) {
                                                                    try {
                                                                        // Canvas context is in CSS units (scaled by DPR). Draw bitmap scaled to CSS size.
                                                                        this.ctx.drawImage(bm, 0, 0, this.w, this.h);
                                                                        return;
                                                                    } finally {
                                                                        if (bm.close) {
                                                                            try { bm.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                            return _origRW.call(this, world, cam, time);
                                                        };
                                                    }
                                                }

                                                // 3) Keep worker's world copy in sync with live gameplay edits (tiles).
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._writeTileFast === 'function') {
                                                    const _origWTF = Game.prototype._writeTileFast;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerWriteTileWrapped', null) : !Game.prototype.__tu_workerWriteTileWrapped) {
                                                        Game.prototype._writeTileFast = function (x, y, id, persist = true) {
                                                            const r = _origWTF.call(this, x, y, id, persist);
                                                            const ww = this._worldWorkerClient;
                                                            if (ww) ww.notifyTile(x, y, id);
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // 4) Keep worker's world copy in sync with save diffs applied on load (batch).
                                                if (typeof SaveSystem !== 'undefined' && SaveSystem.prototype && typeof SaveSystem.prototype.applyToWorld === 'function') {
                                                    const _origApply = SaveSystem.prototype.applyToWorld;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerApplyToWorldWrapped', null) : !SaveSystem.prototype.__tu_workerApplyToWorldWrapped) {
                                                        SaveSystem.prototype.applyToWorld = function (world, save) {
                                                            const r = _origApply.call(this, world, save);
                                                            try {
                                                                const g = this.game;
                                                                const ww = g && g._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && save && save._diffMap && save._diffMap.size) {
                                                                    ww.applyDiffMap(save._diffMap);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // 5) Sync light map (full once after init), and optionally region updates for dynamic changes.
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype.init === 'function') {
                                                    const _origInit = Game.prototype.init;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerInitWrapped', null) : !Game.prototype.__tu_workerInitWrapped) {
                                                        Game.prototype.init = async function (...args) {
                                                            window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                            if (!window.__TU_PERF__.initStart) window.__TU_PERF__.initStart = _safeNow();
                                                            const r = await _origInit.apply(this, args);
                                                            window.__TU_PERF__.initEnd = _safeNow();
                                                            window.__TU_PERF__.initMs = window.__TU_PERF__.initEnd - window.__TU_PERF__.initStart;

                                                            // After init completes, do a single full light sync so worker rendering matches loaded saves.
                                                            try {
                                                                const ww = this._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && this.world) {
                                                                    ww.syncLightFull(this.world);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            return r;
                                                        };
                                                    }
                                                }

                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._updateLight === 'function') {
                                                    const _origUL = Game.prototype._updateLight;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_workerUpdateLightWrapped', null) : !Game.prototype.__tu_workerUpdateLightWrapped) {
                                                        Game.prototype._updateLight = function (x, y) {
                                                            _origUL.call(this, x, y);
                                                            try {
                                                                const ww = this._worldWorkerClient;
                                                                if (ww && ww.renderEnabled && this.world) {
                                                                    ww.syncLightRegion(this.world, x, y, 14);
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }

                                                // PERF: record first frame timing (init -> first RAF)
                                                if (typeof Game !== 'undefined' && Game.prototype && typeof Game.prototype._startRaf === 'function') {
                                                    const _origStartRaf = Game.prototype._startRaf;
                                                    if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_perfStartRafWrapped', null) : !Game.prototype.__tu_perfStartRafWrapped) {

                                                        Game.prototype._startRaf = function () {
                                                            try {
                                                                window.__TU_PERF__ = window.__TU_PERF__ || {};
                                                                if (!window.__TU_PERF__.rafStart) window.__TU_PERF__.rafStart = _safeNow();

                                                                if ((window.TU && window.TU.PatchManager) ? window.TU.PatchManager.once('tu_perfRafCbWrapped', null) : (!this.__tu_perfRafCbWrapped && this._rafCb)) {
                                                                    const _origCb = this._rafCb;

                                                                    this._rafCb = (t) => {
                                                                        const perf = (window.__TU_PERF__ = window.__TU_PERF__ || {});
                                                                        if (!perf.firstFrameAt) {
                                                                            perf.firstFrameAt = t;
                                                                            perf.firstFrameMs = _safeNow() - (perf.rafStart || _safeNow());
                                                                            if (perf.initStart) perf.firstFrameFromInitMs = _safeNow() - perf.initStart;
                                                                        }
                                                                        return _origCb(t);
                                                                    };
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                            return _origStartRaf.call(this);
                                                        };
                                                    }
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();