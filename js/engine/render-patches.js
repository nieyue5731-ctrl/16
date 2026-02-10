// ═══════════════════════════════════════════════════════════════════════
        const WALL_COLORS = ['#2b2f3a', '#353b48', '#2d3436', '#1e272e'];
        const PARALLAX_LAYERS = [
            // 更精致的多层山脉（根据昼夜自动换色）
            {
                p: 0.05, y: 260, amp: 145, freq: 0.0019, detail: 0.0065, sharp: 1.60, seed: 17,
                snow: 1, snowLine: 0.74,
                palette: {
                    night: ['#070a18', '#111a33'],
                    dawn: ['#20122f', '#3a1f48'],
                    day: ['#b7d4f4', '#7a9cc2'],
                    dusk: ['#1c1430', '#3b2953']
                }
            },
            {
                p: 0.10, y: 215, amp: 120, freq: 0.0025, detail: 0.0078, sharp: 1.45, seed: 33,
                snow: 1, snowLine: 0.76,
                palette: {
                    night: ['#0b1024', '#18284a'],
                    dawn: ['#2a1430', '#5a2a3f'],
                    day: ['#9cc0e0', '#5f86b5'],
                    dusk: ['#22193f', '#5a3b6d']
                }
            },
            {
                p: 0.18, y: 165, amp: 105, freq: 0.0034, detail: 0.0105, sharp: 1.30, seed: 57,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#111c2c', '#243a4e'],
                    dawn: ['#3a2340', '#7a3b4b'],
                    day: ['#7db6c9', '#3d6f86'],
                    dusk: ['#2b2447', '#7a4b6d']
                }
            },
            {
                p: 0.30, y: 110, amp: 90, freq: 0.0046, detail: 0.0135, sharp: 1.18, seed: 89,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#162a2f', '#2f4a45'],
                    dawn: ['#3a2f3c', '#8a4a4a'],
                    day: ['#5fa39b', '#2f6b5f'],
                    dusk: ['#2a2f47', '#6a5a6d']
                }
            },
            {
                p: 0.45, y: 65, amp: 70, freq: 0.0060, detail: 0.0180, sharp: 1.10, seed: 123,
                snow: 0, snowLine: 0.0,
                palette: {
                    night: ['#1b2a2a', '#3a4a3f'],
                    dawn: ['#3a2a2a', '#7a3a2f'],
                    day: ['#4f8a4f', '#2e5f35'],
                    dusk: ['#2a2a3a', '#4a3a3f']
                }
            }
        ];

        // ═══════════════════════════════════════════════════════════════════════
        //                    Parallax Mountains (重绘美化版)
        //   目标：更像“层叠远山 + 空气透视 + 细节脊线”，替代原本的正弦波山丘
        // ═══════════════════════════════════════════════════════════════════════

        const _PX = (() => {
            // 快速 1D 噪声（整数 hash + smoothstep 插值），足够做山脊轮廓且很轻量。
            const hash = (n) => {
                n = (n << 13) ^ n;
                return 1.0 - (((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);
            };

            const smooth = (t) => t * t * (3 - 2 * t);

            const noise1 = (x, seed) => {
                const i = Math.floor(x);
                const f = x - i;
                const u = smooth(f);
                const a = hash(((i + seed) | 0));
                const b = hash(((i + 1 + seed) | 0));
                return a + (b - a) * u; // -1..1
            };

            const fbm = (x, seed, oct = 4) => {
                let v = 0;
                let amp = 0.55;
                let freq = 1;
                for (let o = 0; o < oct; o++) {
                    v += amp * noise1(x * freq, seed + o * 101);
                    freq *= 2;
                    amp *= 0.5;
                }
                return v; // ~[-1,1]
            };

            // ridged fbm：更“尖”的山脊
            const ridged = (x, seed, oct = 4) => {
                let v = 0;
                let amp = 0.65;
                let freq = 1;
                for (let o = 0; o < oct; o++) {
                    let n = noise1(x * freq, seed + o * 131);
                    n = 1 - Math.abs(n);
                    v += (n * n) * amp;
                    freq *= 2;
                    amp *= 0.55;
                }
                return v; // ~[0,1]
            };

            return { fbm, ridged };
        })();

        function renderParallaxMountains(renderer, cam, time = 0.5) {
            const ctx = renderer.ctx;
            const w = (renderer.w | 0);
            const h = (renderer.h | 0);
            if (!ctx || w <= 0 || h <= 0) return;

            // 可选：用户主动关闭“背景墙山脉”或性能管理器临时禁用
            try {
                const gs = window.GAME_SETTINGS || {};
                if (gs.bgMountains === false) return;
                if (gs.__bgMountainsEffective === false) return;
            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

            // ───────────────────────── Static helpers（只初始化一次） ─────────────────────────
            const PM = renderParallaxMountains.__PM || (renderParallaxMountains.__PM = (() => {
                const CHUNK_W = 512;   // 山脉“横向缓存块”宽度（px）
                const OVERLAP = 64;    // 两侧重叠，避免 chunk 拼接处的描边断裂
                const PAD_CHUNKS = 2;  // 视野外多缓存几个 chunk，减少移动时抖动/瞬时生成

                const makeCanvas = (cw, ch) => {
                    let c = null;
                    // OffscreenCanvas：更快且不进 DOM（不支持会回退）
                    if (typeof OffscreenCanvas !== 'undefined') {
                        try { c = new OffscreenCanvas(cw, ch); } catch (_) { c = null; }
                    }
                    if (!c) {
                        c = document.createElement('canvas');
                    }
                    // 无论 OffscreenCanvas / Canvas 都支持 width/height
                    c.width = cw;
                    c.height = ch;
                    return c;
                };

                const getCtx = (c) => {
                    try { return c.getContext('2d', { alpha: true }); } catch (e) {
                        try { return c.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                    }
                };

                return { CHUNK_W, OVERLAP, PAD_CHUNKS, makeCanvas, getCtx };
            })());

            const low = !!renderer.lowPower;
            const step = low ? 24 : 12;
            const layers = low ? PARALLAX_LAYERS.slice(0, 3) : PARALLAX_LAYERS;

            // ── Mountain Rendering Patch v2: deterministic theme derivation ──
            // Always derive the theme directly from the time value, never from
            // renderer._getSkyBucket which has multiple conflicting implementations
            // (class returns t*100, patch returns 0-3). This guarantees theme
            // is always correct regardless of which _getSkyBucket is active.
            const theme = (time < 0.2) ? 'night'
                        : (time < 0.3) ? 'dawn'
                        : (time < 0.7) ? 'day'
                        : (time < 0.8) ? 'dusk'
                        : 'night';

            // ───────────────────────── Cache（按主题/分辨率/低功耗重建） ─────────────────────────
            const cacheKey = theme + '|' + h + '|' + (low ? 1 : 0) + '|' + step + '|' + layers.length;
            let cache = renderer._parallaxMountainCache;
            if (!cache || cache.key !== cacheKey) {
                cache = renderer._parallaxMountainCache = {
                    key: cacheKey,
                    theme,
                    h,
                    low,
                    step,
                    chunkW: PM.CHUNK_W,
                    over: PM.OVERLAP,
                    pad: PM.PAD_CHUNKS,
                    layerMaps: Array.from({ length: layers.length }, () => new Map()),
                    fogKey: '',
                    fogGrad: null
                };
            } else {
                // 保险：层数变化时补齐/裁剪 map
                while (cache.layerMaps.length < layers.length) cache.layerMaps.push(new Map());
                if (cache.layerMaps.length > layers.length) cache.layerMaps.length = layers.length;
            }

            const ridgeStroke = (theme === 'day') ? 'rgba(255,255,255,0.20)' : 'rgba(220,230,255,0.14)';
            const snowStroke = (theme === 'day') ? 'rgba(255,255,255,0.75)' : 'rgba(220,230,255,0.55)';

            const chunkW = cache.chunkW;
            const over = cache.over;
            const fullW = chunkW + over * 2;

            // chunk 构建：只在“第一次进入视野”时生成（大幅减少每帧噪声/路径计算）
            const buildChunk = (layer, li, chunkIndex) => {
                const canvas = PM.makeCanvas(fullW, h);
                const g = PM.getCtx(canvas);
                if (!g) return { canvas };

                g.clearRect(0, 0, fullW, h);

                // 渐变填充
                const cols = (layer.palette && layer.palette[theme]) ? layer.palette[theme]
                    : (layer.palette ? layer.palette.night : ['#222', '#444']);
                const grad = g.createLinearGradient(0, h - layer.y - 160, 0, h);
                grad.addColorStop(0, cols[0]);
                grad.addColorStop(1, cols[1]);
                g.fillStyle = grad;

                const worldStart = chunkIndex * chunkW; // “山脉空间”的起点
                const x0 = -over;
                const x1 = chunkW + over;

                // 记录点：用于脊线高光与雪线（避免二次采样）
                const pts = [];

                // 轮廓填充
                g.beginPath();
                g.moveTo(0, h + 2);

                // 采样（用 < 再补一个端点，确保拼接处严格对齐）
                for (let x = x0; x < x1; x += step) {
                    const wx = worldStart + x;
                    const r = _PX.ridged(wx * layer.freq, layer.seed);
                    const f = _PX.fbm(wx * layer.detail, layer.seed + 999);

                    const contour = 0.72 * r + 0.28 * Math.pow(r, layer.sharp || 1.2);
                    const wobble = 0.86 + 0.14 * f;
                    const hh = layer.amp * contour * wobble;

                    const y = h - layer.y - hh;
                    const cx = x + over;
                    pts.push(cx, y, hh);
                    g.lineTo(cx, y);
                }

                // 末端精确补点（x1）
                {
                    const x = x1;
                    const wx = worldStart + x;
                    const r = _PX.ridged(wx * layer.freq, layer.seed);
                    const f = _PX.fbm(wx * layer.detail, layer.seed + 999);

                    const contour = 0.72 * r + 0.28 * Math.pow(r, layer.sharp || 1.2);
                    const wobble = 0.86 + 0.14 * f;
                    const hh = layer.amp * contour * wobble;

                    const y = h - layer.y - hh;
                    const cx = x + over;
                    pts.push(cx, y, hh);
                    g.lineTo(cx, y);
                }

                g.lineTo(fullW, h + 2);
                g.closePath();
                g.fill();

                // 脊线高光（薄薄一条，增强立体感）
                g.save();
                g.globalAlpha = low ? 0.10 : (0.12 + li * 0.02);
                g.strokeStyle = ridgeStroke;
                g.lineWidth = low ? 1 : 2;
                g.lineJoin = 'round';
                g.lineCap = 'round';
                g.beginPath();
                if (pts.length >= 3) {
                    g.moveTo(pts[0], pts[1]);
                    for (let i = 3; i < pts.length; i += 3) g.lineTo(pts[i], pts[i + 1]);
                }
                g.stroke();
                g.restore();

                // 雪线（只给最远两层，避免“到处发白”）
                if (layer.snow && !low) {
                    const threshold = (layer.snowLine || 0.75) * layer.amp;
                    g.save();
                    g.globalAlpha = (theme === 'day') ? 0.22 : 0.15;
                    g.strokeStyle = snowStroke;
                    g.lineWidth = 2;
                    g.lineJoin = 'round';
                    g.lineCap = 'round';
                    g.beginPath();
                    let inSeg = false;
                    for (let i = 0; i < pts.length; i += 3) {
                        const x = pts[i];
                        const y = pts[i + 1];
                        const hh = pts[i + 2];
                        if (hh > threshold) {
                            if (!inSeg) { g.moveTo(x, y + 1); inSeg = true; }
                            else g.lineTo(x, y + 1);
                        } else {
                            inSeg = false;
                        }
                    }
                    g.stroke();
                    g.restore();
                }

                return { canvas };
            };

            // ───────────────────────── Draw（按层绘制 chunk） ─────────────────────────
            for (let li = 0; li < layers.length; li++) {
                const layer = layers[li];
                const map = cache.layerMaps[li];

                // cam.x -> “山脉空间”偏移（与旧实现保持一致）
                const camP = (cam.x || 0) * layer.p;

                // 覆盖范围：与旧版一致，左右多画一点避免边缘露底
                const startWX = camP - 80;
                const endWX = camP + w + 80;

                const first = Math.floor(startWX / chunkW);
                const last = Math.floor(endWX / chunkW);

                const keepMin = first - cache.pad;
                const keepMax = last + cache.pad;

                // 生成缺失 chunk
                for (let ci = keepMin; ci <= keepMax; ci++) {
                    if (!map.has(ci)) {
                        map.set(ci, buildChunk(layer, li, ci));
                    }
                }

                // 清理远离视野的 chunk（控制内存 + Map 遍历成本）
                for (const k of map.keys()) {
                    if (k < keepMin || k > keepMax) map.delete(k);
                }

                // 绘制可见 chunk（裁剪掉 overlap 区域，拼接处无缝）
                for (let ci = first; ci <= last; ci++) {
                    const chunk = map.get(ci);
                    if (!chunk || !chunk.canvas) continue;

                    const dx = (ci * chunkW) - camP; // chunkStart - camOffset
                    try {
                        ctx.drawImage(chunk.canvas, over, 0, chunkW, h, dx, 0, chunkW, h);
                    } catch (_) {
                        // 某些极端环境下 OffscreenCanvas.drawImage 可能失败：降级为不渲染山脉（不影响游戏）
                    }
                }
            }

            // ───────────────────────── Fog overlay（缓存渐变，避免每帧 createLinearGradient） ─────────────────────────
            const fogKey = theme + '|' + h;
            if (!cache.fogGrad || cache.fogKey !== fogKey) {
                const fog = ctx.createLinearGradient(0, h * 0.35, 0, h);
                if (theme === 'day') {
                    fog.addColorStop(0, 'rgba(255,255,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(220,235,255,0.10)');
                    fog.addColorStop(1, 'rgba(200,230,255,0.14)');
                } else if (theme === 'dawn') {
                    fog.addColorStop(0, 'rgba(255,120,180,0.00)');
                    fog.addColorStop(0.72, 'rgba(255,170,140,0.06)');
                    fog.addColorStop(1, 'rgba(190,210,255,0.10)');
                } else if (theme === 'dusk') {
                    fog.addColorStop(0, 'rgba(170,140,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(255,160,120,0.05)');
                    fog.addColorStop(1, 'rgba(140,170,230,0.10)');
                } else {
                    fog.addColorStop(0, 'rgba(190,210,255,0.00)');
                    fog.addColorStop(0.72, 'rgba(160,180,255,0.06)');
                    fog.addColorStop(1, 'rgba(110,140,210,0.12)');
                }
                cache.fogGrad = fog;
                cache.fogKey = fogKey;
            }

            ctx.save();
            ctx.fillStyle = cache.fogGrad;
            ctx.fillRect(0, h * 0.35, w, h);
            ctx.restore();
        }


        // ═══════════════════ 渲染批量优化 ═══════════════════
        const RenderBatcher = {
            _batches: new Map(),

            begin() {
                this._batches.clear();
            },

            add(texture, x, y, alpha = 1) {
                if (!this._batches.has(texture)) {
                    this._batches.set(texture, []);
                }
                this._batches.get(texture).push({ x, y, alpha });
            },

            render(ctx) {
                for (const [texture, positions] of this._batches) {
                    ctx.save();
                    for (const pos of positions) {
                        if (pos.alpha !== 1) {
                            ctx.globalAlpha = pos.alpha;
                        }
                        ctx.drawImage(texture, pos.x, pos.y);
                        if (pos.alpha !== 1) {
                            ctx.globalAlpha = 1;
                        }
                    }
                    ctx.restore();
                }
            }
        };

        class Renderer {
            constructor(canvas) {
                this.canvas = canvas;
                this.ctx = null;
                if (canvas && canvas.getContext) {
                    try { this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                    if (!this.ctx) {
                        try { this.ctx = canvas.getContext('2d', { alpha: false }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                    }
                }
                if (!this.ctx) {
                    throw new Error('Canvas 2D context 初始化失败');
                }
                this._pp = {
                    canvas: document.createElement('canvas'),
                    ctx: null,
                    noise: document.createElement('canvas'),
                    nctx: null,
                    seed: 0,
                    _bloom: null
                };
                this._pp.ctx = this._pp.canvas.getContext('2d', { alpha: false });
                this._pp.nctx = this._pp.noise.getContext('2d', { alpha: true });
                this.textures = new TextureGenerator();
                this.enableGlow = true;
                this.lowPower = false;
                this.resolutionScale = 1;

                // Sprint Blur Props
                this._speedBlurAmt = 0;
                this._speedBlurDirX = 1;
                this._speedBlurBuf = null;

                // Caches
                this._tileBuckets = null;
                this._texArr = null;

                this.resize();
                this._resizeRAF = 0;
                this._resizeRafCb = this._resizeRafCb || (() => {
                    this._resizeRAF = 0;
                    this.resize();
                });
                this._onResize = this._onResize || (() => {
                    if (this._resizeRAF) return;
                    this._resizeRAF = requestAnimationFrame(this._resizeRafCb);
                });
                window.addEventListener('resize', this._onResize, { passive: true });
                window.addEventListener('orientationchange', this._onResize, { passive: true });
            }

            resize() {
                const gs = (window.GAME_SETTINGS || {});
                const effCap = (gs && typeof gs.__dprCapEffective === 'number') ? gs.__dprCapEffective : null;
                const dprCap = (effCap && effCap > 0) ? effCap : ((gs && gs.dprCap) ? gs.dprCap : 2);

                // 基础 DPR（用户上限 + 设备 DPR）
                const baseDpr = Math.min(window.devicePixelRatio || 1, dprCap);

                // 动态分辨率：通过 resolutionScale 调节负载，但要避免“半像素/非整数像素映射”造成的 tile 缝闪烁
                const scale = (typeof this.resolutionScale === 'number' && isFinite(this.resolutionScale)) ? this.resolutionScale : 1;

                // 目标 DPR（先算，再做量化）
                let desiredDpr = Math.max(0.5, Math.min(3, baseDpr * scale));

                // 关键修复：把 DPR 量化到 0.25 步进（16px tile * 0.25 = 4px，能显著降低 tile 边缘采样/拼缝闪动）
                const DPR_STEP = 0.25;
                desiredDpr = Math.round(desiredDpr / DPR_STEP) * DPR_STEP;
                desiredDpr = Math.max(0.5, Math.min(3, desiredDpr));

                const wCss = window.innerWidth;
                const hCss = window.innerHeight;

                // 关键修复：先按宽度取整得到像素尺寸，再反算“真实 DPR”，并用同一个 DPR 推导高度
                // 这样 setTransform 与 canvas 实际像素比例严格一致，避免每次 resize 的四舍五入误差引起的网格线闪动
                const wPx = Math.max(1, Math.round(wCss * desiredDpr));
                const dprActual = wPx / Math.max(1, wCss);
                const hPx = Math.max(1, Math.round(hCss * dprActual));

                // 史诗级优化：避免重复 resize 触发导致的 canvas 反复重分配（极容易引发卡顿/闪黑）
                if (this.canvas.width === wPx && this.canvas.height === hPx && this.w === wCss && this.h === hCss && Math.abs((this.dpr || 0) - dprActual) < 1e-6) {
                    return;
                }

                this.dpr = dprActual;

                // 画布内部像素缩放（动态分辨率）：不影响 UI 布局，只影响渲染负载
                this.canvas.width = wPx;
                this.canvas.height = hPx;
                this.canvas.style.width = wCss + 'px';
                this.canvas.style.height = hCss + 'px';

                // PostFX 缓冲区尺寸跟随主画布（像素级）
                if (this._pp && this._pp.canvas) {
                    this._pp.canvas.width = this.canvas.width;
                    this._pp.canvas.height = this.canvas.height;
                    // 噪点纹理固定较小尺寸，按需重建
                    const n = this._pp.noise;
                    const nSize = 256;
                    if (n.width !== nSize || n.height !== nSize) {
                        n.width = nSize; n.height = nSize;
                        this._pp.seed = 0;
                    }
                }

                // 用真实 DPR 做变换（与实际像素尺寸一致）
                this.ctx.setTransform(dprActual, 0, 0, dprActual, 0, 0);
                this.ctx.imageSmoothingEnabled = false;

                // w/h 仍以 CSS 像素作为世界视窗单位
                this.w = wCss;
                this.h = hCss;
            }

            setResolutionScale(scale01) {
                const s = Math.max(0.5, Math.min(1, Number(scale01) || 1));
                if (Math.abs((this.resolutionScale || 1) - s) < 0.001) return;
                this.resolutionScale = s;
                this.resize();
            }

            clear() {
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, this.w, this.h);
            }

            renderSky(cam, time) {
                const ctx = this.ctx;
                // Ultra Visual FX v3 Sky Logic
                const kfs = this._skyKeyframes || (this._skyKeyframes = [
                    { t: 0.00, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 0.22, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 0.30, c: ['#1a1a2e', '#4a1942', '#ff6b6b'] },
                    { t: 0.36, c: ['#74b9ff', '#81ecec', '#dfe6e9'] },
                    { t: 0.64, c: ['#74b9ff', '#81ecec', '#dfe6e9'] },
                    { t: 0.72, c: ['#6c5ce7', '#fd79a8', '#ffeaa7'] },
                    { t: 0.78, c: ['#0c0c1e', '#1a1a2e', '#16213e'] },
                    { t: 1.00, c: ['#0c0c1e', '#1a1a2e', '#16213e'] }
                ]);

                let i = 0;
                while (i < kfs.length - 2 && time >= kfs[i + 1].t) i++;
                const k0 = kfs[i], k1 = kfs[i + 1];
                const u = (k1.t === k0.t) ? 0 : Math.max(0, Math.min(1, (time - k0.t) / (k1.t - k0.t)));
                const eased = u * u * (3 - 2 * u); // smoothstep
                const colors = k0.c.map((c, idx) => Utils.lerpColor(c, k1.c[idx], eased));

                const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.75);
                grad.addColorStop(0, colors[0]);
                grad.addColorStop(0.5, colors[1]);
                grad.addColorStop(1, colors[2]);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, this.w, this.h);

                const night = Utils.nightFactor(time);
                // Stars
                if (night > 0.01) {
                    ctx.globalAlpha = night * 0.85;
                    if (!this._starCanvas) {
                        this._starCanvas = document.createElement('canvas');
                        this._starCanvas.width = this.w;
                        this._starCanvas.height = this.h * 0.6;
                        const sctx = this._starCanvas.getContext('2d');
                        for (let j = 0; j < 120; j++) {
                            const sx = Math.random() * this.w;
                            const sy = Math.random() * this.h * 0.5;
                            const size = Math.random() * 1.5 + 0.5;
                            sctx.fillStyle = '#fff';
                            sctx.beginPath();
                            sctx.arc(sx, sy, size, 0, Math.PI * 2);
                            sctx.fill();
                        }
                    }
                    if (this._starCanvas.width !== this.w) { this._starCanvas = null; } // dumb resize check
                    else ctx.drawImage(this._starCanvas, 0, 0);
                    ctx.globalAlpha = 1;
                }

                // Sun/Moon
                const cx = this.w * ((time + 0.25) % 1);
                const cy = this.h * 0.15 + Math.sin(((time + 0.25) % 1) * Math.PI) * (-this.h * 0.1);

                if (time > 0.2 && time < 0.8) {
                    // Sun
                    const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
                    sunGlow.addColorStop(0, 'rgba(255, 255, 220, 0.9)');
                    sunGlow.addColorStop(0.3, 'rgba(255, 240, 150, 0.4)');
                    sunGlow.addColorStop(1, 'rgba(255, 200, 50, 0)');
                    ctx.fillStyle = sunGlow;
                    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
                } else {
                    // Moon
                    ctx.fillStyle = '#f0f0f5';
                    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#d0d0d8';
                    ctx.beginPath(); ctx.arc(cx - 6, cy - 4, 5, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(cx + 8, cy + 6, 4, 0, Math.PI * 2); ctx.fill();
                }

                // --- TU Mount Fix Logic (DISABLED) ---
                // Mountains are now drawn from a single authoritative call site in
                // Game.prototype.render (see "Mountain Rendering Patch v2" below).
                // Drawing them inside renderSky caused double-draws, cache
                // interference, and desync with the sky/lighting system.
            }

            renderParallax(cam, time = 0.5) {
                renderParallaxMountains(this, cam, time);
            }

            renderWorld(world, cam, time) {
                if (!world || !world.tiles || !world.light) return;

                const ctx = this.ctx;
                const ts = CONFIG.TILE_SIZE;
                const startX = Math.max(0, ((cam.x / ts) | 0) - 1);
                const startY = Math.max(0, ((cam.y / ts) | 0) - 1);
                const endX = Math.min(world.w - 1, startX + ((this.w / ts) | 0) + 3);
                const endY = Math.min(world.h - 1, startY + ((this.h / ts) | 0) + 3);
                const camCeilX = Math.ceil(cam.x);
                const camCeilY = Math.ceil(cam.y);
                const lut = window.BLOCK_LIGHT_LUT;
                if (!lut) return;

                // Prepare Bucket
                const bucket = this._getBucketState();
                bucket.reset();
                const texArr = this._ensureTexArray();

                const tiles = world.tiles;
                const light = world.light;
                const BL = window.BLOCK_LIGHT;
                const AIR = (window.BLOCK && window.BLOCK.AIR) || 0;

                // Fill buckets
                // Check for flatified world (optimization)
                if (world.tilesFlat && world.lightFlat && world.tilesFlat.length === world.w * world.h) {
                    const H = world.h | 0;
                    const tf = world.tilesFlat;
                    const lf = world.lightFlat;
                    for (let x = startX; x <= endX; x++) {
                        const base = x * H;
                        for (let y = startY; y <= endY; y++) {
                            const idx = base + y;
                            const block = tf[idx] | 0;
                            if (block === AIR) continue;

                            const px = x * ts - camCeilX;
                            const py = y * ts - camCeilY;
                            const pp = ((px & 0xffff) << 16) | (py & 0xffff);

                            const bl = BL[block] | 0;
                            if (bl > 5) {
                                if (bucket.glowLists[block].length === 0) bucket.glowKeys.push(block);
                                bucket.glowLists[block].push(pp);
                            }

                            const lv = lf[idx] & 255;
                            const a = lut[lv];
                            if (a) {
                                if (bucket.darkLists[lv].length === 0) bucket.darkKeys.push(lv);
                                bucket.darkLists[lv].push(pp);
                            }
                        }
                    }
                } else {
                    // Legacy array of arrays
                    for (let x = startX; x <= endX; x++) {
                        const colT = tiles[x];
                        const colL = light[x];
                        for (let y = startY; y <= endY; y++) {
                            const block = colT[y] | 0;
                            if (block === AIR) continue;

                            const px = x * ts - camCeilX;
                            const py = y * ts - camCeilY;
                            const pp = ((px & 0xffff) << 16) | (py & 0xffff);

                            const bl = BL[block] | 0;
                            if (bl > 5) {
                                if (bucket.glowLists[block].length === 0) bucket.glowKeys.push(block);
                                bucket.glowLists[block].push(pp);
                            }
                            const lv = colL[y] & 255;
                            const a = lut[lv];
                            if (a) {
                                if (bucket.darkLists[lv].length === 0) bucket.darkKeys.push(lv);
                                bucket.darkLists[lv].push(pp);
                            }
                        }
                    }
                }

                // Render Glow Tiles
                if (this.enableGlow) {
                    ctx.shadowBlur = 0; // optimized handling inside loop? no, batch shadow change
                    // Group by block to share shadow color
                    for (let i = 0; i < bucket.glowKeys.length; i++) {
                        const bid = bucket.glowKeys[i];
                        const list = bucket.glowLists[bid];
                        const tex = texArr ? texArr[bid] : this.textures.get(bid);
                        if (!tex) continue;

                        const color = BLOCK_COLOR[bid] || '#fff';
                        const bl = BL[bid];
                        ctx.shadowColor = color;
                        ctx.shadowBlur = bl * 2;

                        for (let j = 0; j < list.length; j++) {
                            const p = list[j];
                            ctx.drawImage(tex, (p >> 16) & 0xffff, p & 0xffff);
                        }
                    }
                    ctx.shadowBlur = 0;
                } else {
                    // No glow, just draw
                    for (let i = 0; i < bucket.glowKeys.length; i++) {
                        const bid = bucket.glowKeys[i];
                        const list = bucket.glowLists[bid];
                        const tex = texArr ? texArr[bid] : this.textures.get(bid);
                        if (!tex) continue;
                        for (let j = 0; j < list.length; j++) {
                            const p = list[j];
                            ctx.drawImage(tex, (p >> 16) & 0xffff, p & 0xffff);
                        }
                    }
                }

                // Render Dark Mask
                ctx.fillStyle = '#000';
                bucket.darkKeys.sort((a, b) => a - b);
                for (let i = 0; i < bucket.darkKeys.length; i++) {
                    const lv = bucket.darkKeys[i];
                    const list = bucket.darkLists[lv];
                    ctx.globalAlpha = lut[lv];
                    ctx.beginPath();
                    for (let j = 0; j < list.length; j++) {
                        const p = list[j];
                        ctx.rect((p >> 16) & 0xffff, p & 0xffff, ts, ts);
                    }
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }

            renderHighlight(tx, ty, cam, inRange) {
                const ctx = this.ctx;
                const ts = CONFIG.TILE_SIZE;
                const sx = tx * ts - Math.ceil(cam.x);
                const sy = ty * ts - Math.ceil(cam.y);

                if (inRange) {
                    // 发光选框
                    ctx.shadowColor = '#ffeaa7';
                    ctx.shadowBlur = 15;
                    ctx.strokeStyle = 'rgba(255, 234, 167, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(sx, sy, ts, ts);
                    ctx.shadowBlur = 0;

                    ctx.fillStyle = 'rgba(255, 234, 167, 0.15)';
                    ctx.fillRect(sx, sy, ts, ts);
                } else {
                    ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(sx, sy, ts, ts);
                }
            }

            // Unified Post Process (incorporating Sprint Blur and Ultra Visuals)
            applyPostFX(time, depth01, reducedMotion) {
                // 1. Sprint Blur (Speed Lines)
                const amtRaw = (typeof this._speedBlurAmt === 'number') ? this._speedBlurAmt : 0;
                const amt = Math.max(0, Math.min(1, amtRaw));

                if (!reducedMotion && amt > 0.04) {
                    try {
                        const canvas = this.canvas;
                        const wPx = canvas.width | 0;
                        const hPx = canvas.height | 0;

                        let buf = this._speedBlurBuf;
                        if (!buf) {
                            const c = document.createElement('canvas');
                            const ctx = c.getContext('2d', { alpha: false });
                            buf = this._speedBlurBuf = { c, ctx };
                        }
                        if (buf.c.width !== wPx || buf.c.height !== hPx) {
                            buf.c.width = wPx;
                            buf.c.height = hPx;
                        }

                        const bctx = buf.ctx;
                        bctx.setTransform(1, 0, 0, 1, 0, 0);
                        bctx.globalCompositeOperation = 'copy';
                        bctx.globalAlpha = 1;

                        // Directional blur simulation
                        const blurPx = Math.min(2.6, 0.7 + amt * 1.4);
                        bctx.filter = `blur(${blurPx.toFixed(2)}px)`;
                        bctx.drawImage(canvas, 0, 0);
                        bctx.filter = 'none';

                        const ctx = this.ctx;
                        ctx.save();
                        ctx.setTransform(1, 0, 0, 1, 0, 0);

                        const dir = (this._speedBlurDirX === -1) ? -1 : 1;
                        const off = (-dir) * Math.min(18, (4 + amt * 11));

                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = Math.min(0.22, 0.06 + amt * 0.14);
                        ctx.drawImage(buf.c, off, 0);

                        ctx.globalAlpha = Math.min(0.18, 0.04 + amt * 0.10);
                        ctx.drawImage(buf.c, off * 0.5, 0);
                        ctx.restore();
                    } catch (_) { }
                }

                // 2. Ultra Visual FX Logic
                const gs = (window.GAME_SETTINGS || {});
                let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                if (!Number.isFinite(mode)) mode = 2;
                if (mode <= 0) return;
                if (this.lowPower && mode > 1) mode = 1;

                const ctx = this.ctx;
                const canvas = this.canvas;
                const dpr = this.dpr || 1;
                const wPx = canvas.width;
                const hPx = canvas.height;

                const night = Utils.nightFactor(time);
                const dusk = Math.max(0, 1 - Math.abs(time - 0.72) / 0.08);
                const dawn = Math.max(0, 1 - Math.abs(time - 0.34) / 0.08);
                const warm = Utils.clamp(dawn * 0.9 + dusk * 1.1, 0, 1);
                const cool = Utils.clamp(night * 0.9, 0, 1);

                const d = Utils.clamp(depth01 || 0, 0, 1);
                const underground = Utils.smoothstep(0.22, 0.62, d);

                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);

                // A) Mode 2: Bloom
                if (mode >= 2) {
                    const pp = this._pp;
                    if (pp && pp.canvas && pp.ctx) {
                        const bctx = pp.ctx;
                        bctx.setTransform(1, 0, 0, 1, 0, 0);
                        bctx.globalCompositeOperation = 'copy';
                        bctx.filter = 'none';
                        bctx.globalAlpha = 1;
                        bctx.drawImage(canvas, 0, 0);

                        // Grading
                        const contrast = 1.05 + warm * 0.03 + night * 0.06 + underground * 0.03;
                        const saturate = 1.07 + warm * 0.05 + cool * 0.03 - underground * 0.05;
                        const brightness = 1.01 + warm * 0.015 - cool * 0.008 - underground * 0.015;

                        ctx.globalCompositeOperation = 'copy';
                        ctx.filter = `contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) brightness(${brightness.toFixed(3)})`;
                        ctx.drawImage(pp.canvas, 0, 0);
                        ctx.filter = 'none';

                        // Bloom
                        // (simplified for conciseness, assuming similar logic to v3)
                        const bloomBase = 0.33 + night * 0.10 + underground * 0.06;
                        const blur1 = Math.max(1, Math.round(2.5 * dpr));

                        ctx.globalCompositeOperation = 'screen';
                        ctx.filter = `blur(${blur1}px) brightness(1.2)`;
                        ctx.globalAlpha = bloomBase;
                        ctx.drawImage(pp.canvas, 0, 0);

                        ctx.filter = 'none';
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = 1;
                    }
                }

                // B) Fog, Vignette, Grain (simplified)
                const fogAmt = Utils.smoothstep(0.18, 0.62, d) * (0.60 + night * 0.25);
                if (fogAmt > 0) {
                    const fog = ctx.createLinearGradient(0, hPx * 0.4, 0, hPx);
                    fog.addColorStop(0, 'rgba(30,20,50,0)');
                    fog.addColorStop(1, `rgba(30,20,50,${(0.25 * fogAmt).toFixed(2)})`);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = fog;
                    ctx.fillRect(0, 0, wPx, hPx);
                }

                const vig = (0.2 + night * 0.2) * (mode === 1 ? 0.9 : 1);
                if (vig > 0.01) {
                    // simplified vignette
                    const vg = ctx.createRadialGradient(wPx / 2, hPx / 2, wPx * 0.3, wPx / 2, hPx / 2, wPx * 0.8);
                    vg.addColorStop(0, 'rgba(0,0,0,0)');
                    vg.addColorStop(1, `rgba(0,0,0,${vig.toFixed(2)})`);
                    ctx.fillStyle = vg;
                    ctx.fillRect(0, 0, wPx, hPx);
                }

                ctx.restore();
            }

            postProcess(time = 0.5) {
                this.applyPostFX(time, 0, false);
            }

            // --- Helper Methods (Consolidated from patches) ---

            renderBackgroundCached(cam, time, drawParallax = true) {
                // ── Mountain Rendering Patch v2 ──
                // This method now ONLY caches the sky gradient + celestial bodies.
                // Mountains are drawn exclusively by Game.prototype.render after
                // this method returns, eliminating double-draw and cache-desync bugs.
                this._ensureBgCache();
                const bg = this._bgCache;
                if (!bg || !bg.canvas || !bg.ctx) {
                    this.renderSky(cam, time);
                    // Mountains intentionally NOT drawn here; Game.render handles them.
                    return;
                }

                this._resizeBgCache();

                const now = performance.now();
                const dt = now - (bg.lastAt || 0);
                const refreshInterval = this.lowPower ? 4600 : 750;
                const t = (typeof time === 'number' && isFinite(time)) ? time : (bg.lastTime || 0);

                // Check triggers
                const bucket = this._getSkyBucket(t);
                const bucketChanged = (bucket !== bg.lastBucket);
                const skyKey = this._getSkyKey(t, bucket);
                const skyKeyChanged = (skyKey != null && skyKey !== bg.lastSkyKey);
                const timeChanged = Math.abs(t - (bg.lastTime || 0)) > (this.lowPower ? 0.018 : 0.01);
                const needUpdate = !!bg.dirty || bucketChanged || skyKeyChanged || (dt >= refreshInterval && timeChanged);

                if (needUpdate) {
                    bg.dirty = false;
                    bg.lastAt = now;
                    bg.lastTime = t;
                    bg.lastBucket = bucket;
                    bg.lastSkyKey = skyKey;

                    const origCtx = this.ctx;
                    this.ctx = bg.ctx;
                    this._bgCacheDrawing = true;
                    try {
                        bg.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
                        bg.ctx.imageSmoothingEnabled = false;
                        bg.ctx.clearRect(0, 0, this.w, this.h);
                        this.renderSky(cam, t); // Only sky, not parallax
                    } finally {
                        this._bgCacheDrawing = false;
                        this.ctx = origCtx;
                    }
                }

                this.ctx.drawImage(bg.canvas, 0, 0, this.w, this.h);
                // Mountains intentionally NOT drawn here; Game.render handles them.
            }

            _ensureBgCache() {
                if (this._bgCache) return;
                const c = document.createElement('canvas');
                c.width = this.canvas.width;
                c.height = this.canvas.height;
                this._bgCache = {
                    canvas: c,
                    ctx: c.getContext('2d', { alpha: false }),
                    wPx: c.width,
                    hPx: c.height,
                    dirty: true
                };
            }

            _resizeBgCache() {
                const bg = this._bgCache;
                if (!bg) return;
                const w = this.canvas.width;
                const h = this.canvas.height;
                if (bg.wPx !== w || bg.hPx !== h) {
                    bg.canvas.width = w;
                    bg.canvas.height = h;
                    bg.wPx = w;
                    bg.hPx = h;
                    bg.dirty = true;
                }
            }

            _getSkyBucket(t) {
                // Simple bucket to avoid thrashing
                return (t * 100) | 0;
            }

            _getSkyKey(t, bucket) {
                // Simplified signature for sky color
                return bucket;
            }

            _ensureTexArray() {
                if (!this.textures || typeof this.textures.get !== 'function') return null;
                if (this._texArr && this._texArrMap === this.textures) return this._texArr;
                this._texArr = new Array(256).fill(null);
                try { this.textures.forEach((v, k) => { this._texArr[k & 255] = v; }); } catch (_) { }
                this._texArrMap = this.textures;
                return this._texArr;
            }

            _getBucketState() {
                if (this._tileBuckets) return this._tileBuckets;
                this._tileBuckets = {
                    glowKeys: [],
                    glowLists: new Array(256),
                    darkKeys: [],
                    darkLists: new Array(256),
                    reset() {
                        for (let i = 0; i < this.glowKeys.length; i++) this.glowLists[this.glowKeys[i]].length = 0;
                        for (let i = 0; i < this.darkKeys.length; i++) this.darkLists[this.darkKeys[i]].length = 0;
                        this.glowKeys.length = 0;
                        this.darkKeys.length = 0;
                    }
                };
                for (let i = 0; i < 256; i++) {
                    this._tileBuckets.glowLists[i] = [];
                    this._tileBuckets.darkLists[i] = [];
                }
                return this._tileBuckets;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                   配方数据
        // ═══════════════════════════════════════════════════════════════════════════════
        const RECIPES = [
            { out: BLOCK.PLANKS, count: 4, req: [{ id: BLOCK.LOG, count: 1 }], desc: "基础建筑材料，由原木加工而成。" },
            { out: BLOCK.TORCH, count: 4, req: [{ id: BLOCK.WOOD, count: 1 }], desc: "照亮黑暗的必需品。" },
            { out: BLOCK.BRICK, count: 4, req: [{ id: BLOCK.CLAY, count: 2 }], desc: "坚固的红色砖块。" },
            { out: BLOCK.GLASS, count: 2, req: [{ id: BLOCK.SAND, count: 2 }], desc: "透明的装饰方块。" },
            { out: BLOCK.TREASURE_CHEST, count: 1, req: [{ id: BLOCK.WOOD, count: 8 }], desc: "用于储存物品的箱子。" },
            { out: BLOCK.LANTERN, count: 1, req: [{ id: BLOCK.TORCH, count: 1 }, { id: BLOCK.IRON_ORE, count: 1 }], desc: "比火把更优雅的照明工具。" },
            { out: BLOCK.FROZEN_STONE, count: 4, req: [{ id: BLOCK.ICE, count: 2 }, { id: BLOCK.STONE, count: 2 }], desc: "寒冷的建筑石材。" },
            { out: BLOCK.GLOWSTONE, count: 1, req: [{ id: BLOCK.GLASS, count: 1 }, { id: BLOCK.TORCH, count: 2 }], desc: "人造发光石块。" },
            { out: BLOCK.METEORITE_BRICK, count: 4, req: [{ id: BLOCK.METEORITE, count: 1 }, { id: BLOCK.STONE, count: 1 }], desc: "来自外太空的建筑材料。" },
            { out: BLOCK.RAINBOW_BRICK, count: 10, req: [{ id: BLOCK.CRYSTAL, count: 1 }, { id: BLOCK.BRICK, count: 10 }], desc: "散发着彩虹光芒的砖块。" },
            { out: BLOCK.PARTY_BLOCK, count: 5, req: [{ id: BLOCK.PINK_FLOWER, count: 1 }, { id: BLOCK.DIRT, count: 5 }], desc: "让每一天都变成派对！" },
            { out: BLOCK.WOOD, count: 1, req: [{ id: BLOCK.PLANKS, count: 2 }], desc: "将木板还原为木材。" },
            { out: BLOCK.BONE, count: 2, req: [{ id: BLOCK.STONE, count: 1 }], desc: "由石头雕刻而成的骨头形状。" },
            { out: BLOCK.HAY, count: 4, req: [{ id: BLOCK.TALL_GRASS, count: 8 }], desc: "干草堆，适合建造农场。" }
        ];

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                  合成系统

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { Renderer });

// --- Merged from block 35 (line 14507) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'experience_optimized_v2',
                                            order: 10,
                                            description: "交互/渲染体验优化（v2）",
                                            apply: () => {
                                                const TU = window.TU || {};
                                                const Game = TU.Game;
                                                const Renderer = TU.Renderer;
                                                const TouchController = TU.TouchController;

                                                // ───────────────────── Crosshair UX (移动端默认显示时避免左上角“悬空”) ─────────────────────
                                                try {
                                                    const style = document.createElement('style');
                                                    style.id = 'patch-crosshair-style';
                                                    style.textContent = `
            /* 默认隐藏（用 opacity 控制，不影响布局；兼容原有 display:block 的媒体查询） */
            #crosshair {
              opacity: 0;
              transform: scale(0.9);
              transition: opacity 140ms ease, transform 140ms ease;
            }
            #crosshair.crosshair-active { opacity: 1; transform: scale(1); }
            #crosshair.crosshair-idle { opacity: 0.55; transform: scale(0.95); }
          `;
                                                    document.head.appendChild(style);
                                                } catch { }

                                                // ───────────────────────── Patch TouchController：多指更稳 + 自适应摇杆半径 ─────────────────────────
                                                if (TouchController && TouchController.prototype) {
                                                    TouchController.prototype._init = function () {
                                                        const joystickEl = document.getElementById('joystick');
                                                        const thumbEl = document.getElementById('joystick-thumb');
                                                        const crosshairEl = document.getElementById('crosshair');

                                                        const canvas = this.game && this.game.canvas;

                                                        // 兼容：缺少关键节点则直接返回
                                                        if (!joystickEl || !thumbEl || !canvas) return;

                                                        // 让浏览器知道这里不会滚动（减少一些浏览器的触控延迟）
                                                        try { canvas.style.touchAction = 'none'; } catch { }
                                                        try { joystickEl.style.touchAction = 'none'; } catch { }

                                                        // 十字准星：默认透明，第一次设定目标后才显示
                                                        if (crosshairEl) {
                                                            crosshairEl.classList.remove('crosshair-active', 'crosshair-idle');
                                                        }

                                                        // 安全区（防误触）：根据 UI 实际位置动态计算
                                                        const safeRects = [];
                                                        const expandRect = (r, m) => ({ left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m });
                                                        const hitRect = (r, x, y) => (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

                                                        const refreshSafeZones = () => {
                                                            safeRects.length = 0;

                                                            // joystick 安全区
                                                            try {
                                                                const jr = joystickEl.getBoundingClientRect();
                                                                const m = Math.max(18, jr.width * 0.18);
                                                                safeRects.push(expandRect(jr, m));

                                                                // 同步摇杆最大位移：跟随 joystick 尺寸
                                                                this._joyMaxDist = Math.max(30, Math.min(90, jr.width * 0.35));
                                                            } catch {
                                                                this._joyMaxDist = 50;
                                                            }

                                                            // action buttons 安全区
                                                            try {
                                                                const act = document.querySelector('.action-buttons');
                                                                if (act) {
                                                                    const ar = act.getBoundingClientRect();
                                                                    safeRects.push(expandRect(ar, 18));
                                                                }
                                                            } catch { }

                                                            // jump button 安全区
                                                            try {
                                                                const jc = document.querySelector('.jump-container');
                                                                if (jc) {
                                                                    const r = jc.getBoundingClientRect();
                                                                    safeRects.push(expandRect(r, 18));
                                                                }
                                                            } catch { }

                                                            // minimap 安全区（防止在边缘误触到画布瞄准）
                                                            try {
                                                                const mm = document.getElementById('minimap');
                                                                if (mm && mm.offsetParent !== null) {
                                                                    const r = mm.getBoundingClientRect();
                                                                    safeRects.push(expandRect(r, 14));
                                                                }
                                                            } catch { }
                                                        };

                                                        this._refreshSafeZones = refreshSafeZones;
                                                        refreshSafeZones();
                                                        window.addEventListener('resize', refreshSafeZones, { passive: true });
                                                        window.addEventListener('orientationchange', refreshSafeZones, { passive: true });

                                                        const findTouch = (touchList, id) => {
                                                            if (!touchList) return null;
                                                            for (let i = 0; i < touchList.length; i++) {
                                                                const t = touchList[i];
                                                                if (t && t.identifier === id) return t;
                                                            }
                                                            return null;
                                                        };

                                                        const inSafeZone = (x, y) => {
                                                            for (let i = 0; i < safeRects.length; i++) {
                                                                if (hitRect(safeRects[i], x, y)) return true;
                                                            }
                                                            return false;
                                                        };

                                                        // ── Joystick：绑定自己的 touchId，避免与准星/按钮互相抢
                                                        this.joystick.touchId = null;

                                                        joystickEl.addEventListener('touchstart', (e) => {
                                                            // 防止页面滑动/缩放
                                                            e.preventDefault();

                                                            // 已经有 joystick touch 在控制时，不抢占
                                                            if (this.joystick.touchId !== null) return;

                                                            const t = e.changedTouches && e.changedTouches[0];
                                                            if (!t) return;

                                                            this.joystick.touchId = t.identifier;
                                                            this.joystick.active = true;

                                                            // joystick 基准点：固定在底座中心
                                                            const rect = joystickEl.getBoundingClientRect();
                                                            this.joystick.startX = rect.left + rect.width / 2;
                                                            this.joystick.startY = rect.top + rect.height / 2;

                                                            this._updateJoystick(t.clientX, t.clientY, thumbEl);
                                                        }, { passive: false });

                                                        joystickEl.addEventListener('touchmove', (e) => {
                                                            e.preventDefault();
                                                            if (!this.joystick.active || this.joystick.touchId === null) return;

                                                            const t = findTouch(e.touches, this.joystick.touchId) || findTouch(e.changedTouches, this.joystick.touchId);
                                                            if (!t) return;

                                                            this._updateJoystick(t.clientX, t.clientY, thumbEl);
                                                        }, { passive: false });

                                                        const endJoy = (e) => {
                                                            e.preventDefault();
                                                            if (this.joystick.touchId === null) return;

                                                            // 只有结束了 joystick 自己的 touch 才归零
                                                            const ended = findTouch(e.changedTouches, this.joystick.touchId);
                                                            if (!ended) return;

                                                            this.joystick.active = false;
                                                            this.joystick.touchId = null;
                                                            this.joystick.dx = 0;
                                                            this.joystick.dy = 0;
                                                            thumbEl.style.transform = 'translate(-50%, -50%)';
                                                        };

                                                        joystickEl.addEventListener('touchend', endJoy, { passive: false });
                                                        joystickEl.addEventListener('touchcancel', endJoy, { passive: false });

                                                        // ── Buttons：沿用原有逻辑
                                                        this._setupButton('btn-jump', 'jump');
                                                        this._setupButton('btn-mine', 'mine');
                                                        this._setupButton('btn-place', 'place');

                                                        // ── Crosshair：允许“设定一次目标后松手继续挖/放”
                                                        const setCrosshairState = (state) => {
                                                            if (!crosshairEl) return;
                                                            crosshairEl.classList.toggle('crosshair-active', state === 'active');
                                                            crosshairEl.classList.toggle('crosshair-idle', state === 'idle');
                                                            if (state === 'hidden') crosshairEl.classList.remove('crosshair-active', 'crosshair-idle');
                                                        };

                                                        canvas.addEventListener('touchstart', (e) => {
                                                            // 阻止双指缩放/滚动（尤其 iOS）
                                                            e.preventDefault();

                                                            if (!e.changedTouches) return;

                                                            // 如果当前没有正在拖动的准星，就从新 touch 中挑一个合适的
                                                            if (this.targetTouchId === null) {
                                                                for (let i = 0; i < e.changedTouches.length; i++) {
                                                                    const t = e.changedTouches[i];
                                                                    if (!t) continue;

                                                                    // 过滤掉靠近摇杆/按钮/小地图的触点，防误触
                                                                    if (inSafeZone(t.clientX, t.clientY)) continue;

                                                                    this.targetTouchId = t.identifier;
                                                                    if (crosshairEl) {
                                                                        this._updateCrosshair(t.clientX, t.clientY, crosshairEl);
                                                                        // 第一次设定目标：开启 hasTarget
                                                                        this.crosshair.visible = true;
                                                                        setCrosshairState('active');
                                                                    }
                                                                    break;
                                                                }
                                                            } else {
                                                                // 已在拖动：不抢占
                                                            }
                                                        }, { passive: false });

                                                        canvas.addEventListener('touchmove', (e) => {
                                                            e.preventDefault();
                                                            if (this.targetTouchId === null) return;

                                                            const t = findTouch(e.touches, this.targetTouchId) || findTouch(e.changedTouches, this.targetTouchId);
                                                            if (!t || !crosshairEl) return;

                                                            this._updateCrosshair(t.clientX, t.clientY, crosshairEl);
                                                            // 正在拖动时保持 active
                                                            if (this.crosshair.visible) setCrosshairState('active');
                                                        }, { passive: false });

                                                        const endCross = (e) => {
                                                            e.preventDefault();
                                                            if (this.targetTouchId === null) return;

                                                            const ended = findTouch(e.changedTouches, this.targetTouchId);
                                                            if (!ended) return;

                                                            this.targetTouchId = null;
                                                            // 松手后：保留目标点，但变为 idle（更不遮挡）
                                                            if (this.crosshair.visible) setCrosshairState('idle');
                                                        };

                                                        canvas.addEventListener('touchend', endCross, { passive: false });
                                                        canvas.addEventListener('touchcancel', endCross, { passive: false });
                                                    };

                                                    // 自适应摇杆半径（maxDist 与 UI 尺寸匹配）
                                                    TouchController.prototype._updateJoystick = function (tx, ty, thumbEl) {
                                                        let dx = tx - this.joystick.startX;
                                                        let dy = ty - this.joystick.startY;

                                                        const maxDist = (typeof this._joyMaxDist === 'number' && isFinite(this._joyMaxDist)) ? this._joyMaxDist : 50;
                                                        const dist = Math.sqrt(dx * dx + dy * dy);

                                                        if (dist > maxDist) {
                                                            dx = dx / dist * maxDist;
                                                            dy = dy / dist * maxDist;
                                                        }

                                                        this.joystick.dx = dx / maxDist;
                                                        this.joystick.dy = dy / maxDist;

                                                        thumbEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                                                    };

                                                    // Crosshair：只做坐标更新（与原逻辑兼容）
                                                    TouchController.prototype._updateCrosshair = function (x, y, el) {
                                                        this.crosshair.x = x;
                                                        this.crosshair.y = y;
                                                        // 40x40
                                                        el.style.left = (x - 20) + 'px';
                                                        el.style.top = (y - 20) + 'px';
                                                    };
                                                }

                                                // ───────────────────────── Patch Renderer：缓存天空渐变 + 星星更省 + 视差降采样 ─────────────────────────
                                                if (Renderer && Renderer.prototype) {
                                                    const origResize = Renderer.prototype.resize;
                                                    Renderer.prototype.resize = function () {
                                                        origResize.call(this);
                                                        // 尺寸变化时清空缓存
                                                        this._skyGrad = null;
                                                        this._skyBucket = -1;
                                                        this._skyGradH = 0;

                                                        this._stars = null;
                                                        this._starsW = 0;
                                                        this._starsH = 0;
                                                        this._starsCount = 0;

                                                        this._parallaxGrad = null;
                                                        this._parallaxGradH = 0;
                                                    };

                                                    Renderer.prototype._ensureStars = function () {
                                                        const want = (this.lowPower ? 40 : 80);
                                                        if (this._stars && this._starsCount === want && this._starsW === this.w && this._starsH === this.h) return;

                                                        const stars = new Array(want);
                                                        const w = Math.max(1, this.w);
                                                        const h = Math.max(1, this.h * 0.5);

                                                        // 保持“看起来随机但稳定”的分布：沿用原有的取模方案
                                                        for (let i = 0; i < want; i++) {
                                                            const sx = (12345 * i * 17) % w;
                                                            const sy = (12345 * i * 31) % h;
                                                            const size = (i % 3) + 1;
                                                            const phase = i * 1.73;
                                                            const baseA = 0.55 + (i % 7) * 0.05; // 0.55~0.85
                                                            stars[i] = { x: sx, y: sy, s: size, p: phase, a: baseA };
                                                        }

                                                        this._stars = stars;
                                                        this._starsW = this.w;
                                                        this._starsH = this.h;
                                                        this._starsCount = want;
                                                    };

                                                    Renderer.prototype._getSkyBucket = function (time) {
                                                        if (time < 0.2) return 0;      // night
                                                        if (time < 0.3) return 1;      // dawn
                                                        if (time < 0.7) return 2;      // day
                                                        if (time < 0.8) return 3;      // dusk
                                                        return 0;                      // night
                                                    };

                                                    Renderer.prototype._ensureSkyGradient = function (bucket) {
                                                        if (this._skyGrad && this._skyBucket === bucket && this._skyGradH === this.h) return;

                                                        const ctx = this.ctx;
                                                        let colors;
                                                        if (bucket === 0) colors = ['#0c0c1e', '#1a1a2e', '#16213e'];
                                                        else if (bucket === 1) colors = ['#1a1a2e', '#4a1942', '#ff6b6b'];
                                                        else if (bucket === 2) colors = ['#74b9ff', '#81ecec', '#dfe6e9'];
                                                        else colors = ['#6c5ce7', '#fd79a8', '#ffeaa7'];

                                                        const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.7);
                                                        grad.addColorStop(0, colors[0]);
                                                        grad.addColorStop(0.5, colors[1]);
                                                        grad.addColorStop(1, colors[2]);

                                                        this._skyGrad = grad;
                                                        this._skyBucket = bucket;
                                                        this._skyGradH = this.h;
                                                    };

                                                    // 覆写天空渲染：同视觉，少分配/少字符串/少 arc
                                                    Renderer.prototype.renderSky = function (cam, time) {
                                                        const ctx = this.ctx;

                                                        // —— 平滑天空过渡：在关键时间点附近，用两套渐变叠加做 smoothstep 淡入淡出 ——
                                                        const transitions = this._skyTransitions || (this._skyTransitions = [
                                                            { at: 0.2, from: 0, to: 1, w: 0.04 }, // night -> dawn
                                                            { at: 0.3, from: 1, to: 2, w: 0.04 }, // dawn -> day
                                                            { at: 0.7, from: 2, to: 3, w: 0.04 }, // day -> dusk
                                                            { at: 0.8, from: 3, to: 0, w: 0.04 }  // dusk -> night
                                                        ]);

                                                        let bucketA = this._getSkyBucket(time);
                                                        let bucketB = bucketA;
                                                        let blend = 0;

                                                        for (let i = 0; i < transitions.length; i++) {
                                                            const tr = transitions[i];
                                                            const a = tr.at - tr.w, b = tr.at + tr.w;
                                                            if (time >= a && time <= b) {
                                                                bucketA = tr.from;
                                                                bucketB = tr.to;
                                                                blend = Utils.smoothstep(a, b, time);
                                                                break;
                                                            }
                                                        }

                                                        // 底层渐变
                                                        this._ensureSkyGradient(bucketA);
                                                        const gradA = this._skyGrad;
                                                        ctx.fillStyle = gradA;
                                                        ctx.fillRect(0, 0, this.w, this.h);

                                                        // 叠加渐变（仅在过渡期）
                                                        if (blend > 0.001 && bucketB !== bucketA) {
                                                            this._ensureSkyGradient(bucketB);
                                                            const gradB = this._skyGrad;
                                                            ctx.save();
                                                            ctx.globalAlpha = blend;
                                                            ctx.fillStyle = gradB;
                                                            ctx.fillRect(0, 0, this.w, this.h);
                                                            ctx.restore();
                                                        }

                                                        const night = Utils.nightFactor(time);

                                                        // 星星：夜晚按 nightFactor 平滑淡入淡出（避免“瞬间出现/消失”）
                                                        if (night > 0.01) {
                                                            const baseAlpha = night * 0.8;
                                                            this._ensureStars();
                                                            const stars = this._stars;
                                                            const now = Date.now() * 0.003;

                                                            ctx.save();
                                                            for (let i = 0; i < stars.length; i++) {
                                                                const s = stars[i];
                                                                const twinkle = Math.sin(now + i) * 0.3 + 0.7;
                                                                ctx.globalAlpha = baseAlpha * twinkle;
                                                                ctx.fillStyle = '#fff';
                                                                // fillRect 比 arc 省
                                                                ctx.fillRect(s.x, s.y, s.size, s.size);
                                                            }
                                                            ctx.restore();
                                                        }

                                                        // 太阳/月亮：使用透明度做平滑交接
                                                        const cx = this.w * ((time + 0.25) % 1);
                                                        const cy = 80 + Math.sin(((time + 0.25) % 1) * Math.PI) * -60;

                                                        const sunAlpha = Utils.smoothstep(0.18, 0.26, time) * (1 - Utils.smoothstep(0.74, 0.82, time));
                                                        const moonAlpha = night;

                                                        if (sunAlpha > 0.001) {
                                                            ctx.save();
                                                            ctx.globalAlpha = sunAlpha;

                                                            const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
                                                            sunGlow.addColorStop(0, 'rgba(255, 255, 200, 1)');
                                                            sunGlow.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
                                                            sunGlow.addColorStop(0.5, 'rgba(255, 180, 50, 0.3)');
                                                            sunGlow.addColorStop(1, 'rgba(255, 150, 0, 0)');
                                                            ctx.fillStyle = sunGlow;
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 60, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = '#FFF';
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 25, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.restore();
                                                        }

                                                        if (moonAlpha > 0.001) {
                                                            ctx.save();
                                                            ctx.globalAlpha = moonAlpha;

                                                            const moonGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
                                                            moonGlow.addColorStop(0, 'rgba(230, 230, 255, 1)');
                                                            moonGlow.addColorStop(0.5, 'rgba(200, 200, 255, 0.3)');
                                                            moonGlow.addColorStop(1, 'rgba(150, 150, 255, 0)');
                                                            ctx.fillStyle = moonGlow;
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 40, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = '#E8E8F0';
                                                            ctx.beginPath();
                                                            ctx.arc(cx, cy, 18, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.fillStyle = 'rgba(200, 200, 210, 0.5)';
                                                            ctx.beginPath();
                                                            ctx.arc(cx - 5, cy - 3, 4, 0, Math.PI * 2);
                                                            ctx.arc(cx + 6, cy + 5, 3, 0, Math.PI * 2);
                                                            ctx.fill();

                                                            ctx.restore();
                                                        }
                                                    };

                                                    // 覆写视差：低功耗时减少采样点/层数（更省）
                                                    Renderer.prototype.renderParallax = function (cam, time) {
                                                        renderParallaxMountains(this, cam, time);
                                                    };

                                                    // 覆写世界渲染：暗角 LUT 只在 levels 变化时构建（每帧少 256 次循环）
                                                    const buildDarkLUT = (levels, nightBonus) => {
                                                        const lut = new Float32Array(256);
                                                        for (let i = 0; i < 256; i++) {
                                                            const darkness = 1 - (i / levels);
                                                            let totalDark = darkness * 0.6 + nightBonus;
                                                            if (totalDark > 0.88) totalDark = 0.88;
                                                            lut[i] = (totalDark > 0.05) ? totalDark : 0;
                                                        }
                                                        return lut;
                                                    };

                                                    Renderer.prototype.renderWorld = function (world, cam, time) {
                                                        const ctx = this.ctx;
                                                        const ts = CONFIG.TILE_SIZE;

                                                        let startX = Math.floor(cam.x / ts) - 1;
                                                        let startY = Math.floor(cam.y / ts) - 1;
                                                        let endX = startX + Math.ceil(this.w / ts) + 2;
                                                        let endY = startY + Math.ceil(this.h / ts) + 2;

                                                        if (startX < 0) startX = 0;
                                                        if (startY < 0) startY = 0;
                                                        if (endX >= world.w) endX = world.w - 1;
                                                        if (endY >= world.h) endY = world.h - 1;

                                                        const tiles = world.tiles;
                                                        const light = world.light;

                                                        const camCeilX = Math.ceil(cam.x);
                                                        const camCeilY = Math.ceil(cam.y);

                                                        const night = Utils.nightFactor(time);
                                                        const qNight = Math.round(night * 100) / 100;
                                                        const levels = CONFIG.LIGHT_LEVELS;

                                                        if (!this._darkAlphaLUTDay || this._darkAlphaLUTLevels !== levels) {
                                                            this._darkAlphaLUTLevels = levels;
                                                            this._darkAlphaLUTDay = buildDarkLUT(levels, 0);
                                                            this._darkAlphaLUTNight = buildDarkLUT(levels, 0.2);
                                                        }
                                                        let lut = this._darkAlphaLUTBlend;
                                                        if (!lut || this._darkAlphaLUTBlendNight !== qNight || this._darkAlphaLUTBlendLevels !== levels) {
                                                            lut = this._darkAlphaLUTBlend || (this._darkAlphaLUTBlend = new Float32Array(256));
                                                            for (let i = 0; i < 256; i++) {
                                                                lut[i] = this._darkAlphaLUTDay[i] + (this._darkAlphaLUTNight[i] - this._darkAlphaLUTDay[i]) * qNight;
                                                            }
                                                            this._darkAlphaLUTBlendNight = qNight;
                                                            this._darkAlphaLUTBlendLevels = levels;
                                                        }

                                                        ctx.globalAlpha = 1;
                                                        ctx.fillStyle = 'rgb(10,5,20)';

                                                        for (let x = startX; x <= endX; x++) {
                                                            const colTiles = tiles[x];
                                                            const colLight = light[x];
                                                            for (let y = startY; y <= endY; y++) {
                                                                const block = colTiles[y];
                                                                if (block === BLOCK.AIR) continue;

                                                                const tex = this.textures.get(block);
                                                                const px = x * ts - camCeilX;
                                                                const py = y * ts - camCeilY;

                                                                const bl = BLOCK_LIGHT[block];
                                                                if (this.enableGlow && bl > 5 && tex) {
                                                                    ctx.save();
                                                                    ctx.shadowColor = BLOCK_COLOR[block];
                                                                    ctx.shadowBlur = bl * 2;
                                                                    ctx.drawImage(tex, px, py);
                                                                    ctx.restore();
                                                                } else if (tex) {
                                                                    ctx.drawImage(tex, px, py);
                                                                }

                                                                const a = lut[colLight[y]];
                                                                if (a) {
                                                                    ctx.globalAlpha = a;
                                                                    ctx.fillRect(px, py, ts, ts);
                                                                    ctx.globalAlpha = 1;
                                                                }
                                                            }
                                                        }

                                                        ctx.globalAlpha = 1;
                                                    };
                                                    // ───────────────────────── PostFX：色彩分级 / 氛围雾化 / 暗角 / 电影颗粒 ─────────────────────────
                                                    // 目标：在不引入昂贵像素级后处理（getImageData）的前提下，显著提升“质感”和层次
                                                    Renderer.prototype._ensureGrain = function () {
                                                        const size = 128; // 小纹理 + repeat，成本低
                                                        if (!this._grainCanvas) {
                                                            this._grainCanvas = document.createElement('canvas');
                                                            this._grainCanvas.width = size;
                                                            this._grainCanvas.height = size;
                                                            this._grainCtx = this._grainCanvas.getContext('2d', { alpha: true });
                                                            this._grainFrame = 0;
                                                            this._grainPattern = null;
                                                        }
                                                        // 每隔若干帧刷新一次噪声，避免每帧随机成本
                                                        const step = this.lowPower ? 18 : 10;
                                                        this._grainFrame = (this._grainFrame || 0) + 1;
                                                        if (!this._grainPattern || (this._grainFrame % step) === 0) {
                                                            const g = this._grainCtx;
                                                            const img = g.createImageData(size, size);
                                                            const d = img.data;
                                                            // LCG 伪随机（比 Math.random 更稳定更快）
                                                            let seed = (this._grainSeed = ((this._grainSeed || 1234567) * 1664525 + 1013904223) >>> 0);
                                                            for (let i = 0; i < d.length; i += 4) {
                                                                seed = (seed * 1664525 + 1013904223) >>> 0;
                                                                const v = (seed >>> 24); // 0..255
                                                                d[i] = v; d[i + 1] = v; d[i + 2] = v;
                                                                // 噪声 alpha：偏低，避免“脏屏”
                                                                d[i + 3] = 24 + (v & 15); // 24..39
                                                            }
                                                            g.putImageData(img, 0, 0);
                                                            this._grainPattern = this.ctx.createPattern(this._grainCanvas, 'repeat');
                                                        }
                                                    };

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        const ctx = this.ctx;
                                                        if (!ctx || reducedMotion) return;
                                                        const w = this.w, h = this.h;
                                                        const lowFx = !!this.lowPower;

                                                        // Precompute vignette once per resize
                                                        if (!this._vignetteFx || this._vignetteFx.w !== w || this._vignetteFx.h !== h) {
                                                            const vc = document.createElement('canvas');
                                                            vc.width = Math.max(1, w);
                                                            vc.height = Math.max(1, h);
                                                            const vctx = vc.getContext('2d', { alpha: true });
                                                            const r = Math.max(w, h) * 0.75;
                                                            const g = vctx.createRadialGradient(w * 0.5, h * 0.5, r * 0.15, w * 0.5, h * 0.5, r);
                                                            g.addColorStop(0, 'rgba(0,0,0,0)');
                                                            g.addColorStop(1, 'rgba(0,0,0,1)');
                                                            vctx.fillStyle = g;
                                                            vctx.fillRect(0, 0, w, h);
                                                            this._vignetteFx = { c: vc, w, h };
                                                        }

                                                        // Ensure grain pattern exists (generated once)
                                                        if (!this._grainPattern && this._ensureGrain) this._ensureGrain();

                                                        const night = Utils.nightFactor(time);
                                                        const dusk = Math.max(0, 1 - Math.abs(time - 0.72) / 0.08);
                                                        const dawn = Math.max(0, 1 - Math.abs(time - 0.34) / 0.08);

                                                        // Cheap “grading” using only a few translucent overlays (no ctx.filter)
                                                        const warmA = Utils.clamp(dawn * 0.22 + dusk * 0.30, 0, 0.35);
                                                        const coolA = Utils.clamp(night * 0.28, 0, 0.35);
                                                        const fogA = Utils.clamp((depth01 * 0.10) + (night * 0.06), 0, 0.20);

                                                        ctx.save();

                                                        if (warmA > 0.001) {
                                                            ctx.globalAlpha = warmA;
                                                            ctx.fillStyle = 'rgba(255,180,90,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }
                                                        if (coolA > 0.001) {
                                                            ctx.globalAlpha = coolA;
                                                            ctx.fillStyle = 'rgba(90,150,255,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }
                                                        if (fogA > 0.001) {
                                                            ctx.globalAlpha = fogA;
                                                            ctx.fillStyle = 'rgba(24,28,36,1)';
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        // Vignette
                                                        ctx.globalAlpha = (lowFx ? 0.16 : 0.24) + night * (lowFx ? 0.08 : 0.12);
                                                        ctx.drawImage(this._vignetteFx.c, 0, 0);

                                                        // Subtle grain (skip on low power)
                                                        if (this._grainPattern && !lowFx) {
                                                            ctx.globalAlpha = 0.045;
                                                            ctx.fillStyle = this._grainPattern;
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        ctx.restore();
                                                    };

                                                }

                                                // ───────────────────────── Patch Game.render：修复未定义变量 + 减少重复取值 ─────────────────────────
                                                if (Game && Game.prototype) {
                                                    Game.prototype.render = function () {
                                                        // 防御性空值检查
                                                        if (!this.renderer) {
                                                            console.warn('[Renderer.render] Renderer not initialized');
                                                            return;
                                                        }
                                                        if (!this.world) {
                                                            console.warn('[Renderer.render] World not available');
                                                            return;
                                                        }

                                                        const cam = this._renderCamera || this.camera;
                                                        const renderer = this.renderer;
                                                        const settings = this.settings || {};
                                                        const p = this.player;
                                                        const ts = CONFIG.TILE_SIZE;

                                                        // 防御性相机检查
                                                        if (!cam || typeof cam.x !== 'number' || typeof cam.y !== 'number') {
                                                            console.warn('[Renderer.render] Invalid camera');
                                                            return;
                                                        }

                                                        renderer.clear();
                                                        renderer.renderSky(cam, this.timeOfDay);

                                                        // ── Mountain Rendering Patch v2 ──
                                                        // Single authoritative call site for mountains.
                                                        // Respects the user bgMountains toggle and autoQuality
                                                        // effective flag, but no longer skipped by
                                                        // reducedMotion / low-perf — those only affected the
                                                        // old parallax *scrolling* which is not relevant to
                                                        // the static mountain backdrop.
                                                        {
                                                            const gs = window.GAME_SETTINGS || settings;
                                                            const mtEnabled = (gs.bgMountains !== false) && (gs.__bgMountainsEffective !== false);
                                                            if (mtEnabled && typeof renderParallaxMountains === 'function') {
                                                                renderParallaxMountains(renderer, cam, this.timeOfDay);
                                                            }
                                                        }

                                                        renderer.renderWorld(this.world, cam, this.timeOfDay);

                                                        // 掉落物 / 粒子 / 玩家
                                                        this.droppedItems.render(renderer.ctx, cam, renderer.textures, this.timeOfDay);
                                                        if (settings.particles) this.particles.render(renderer.ctx, cam);
                                                        p.render(renderer.ctx, cam);

                                                        // 高亮：取当前输入（移动端优先 touch 输入）
                                                        const input = (this.isMobile && this.touchController && this._latestTouchInput) ? this._latestTouchInput : this.input;

                                                        const sx = (typeof input.targetX === 'number') ? input.targetX : input.mouseX;
                                                        const sy = (typeof input.targetY === 'number') ? input.targetY : input.mouseY;

                                                        const safeSX = Number.isFinite(sx) ? sx : (p.cx() - cam.x);
                                                        const safeSY = Number.isFinite(sy) ? sy : (p.cy() - cam.y);

                                                        const worldX = safeSX + cam.x;
                                                        const worldY = safeSY + cam.y;

                                                        let tileX = Math.floor(worldX / ts);
                                                        let tileY = Math.floor(worldY / ts);
                                                        if (this.isMobile && settings.aimAssist) {
                                                            tileX = Math.floor((worldX + ts * 0.5) / ts);
                                                            tileY = Math.floor((worldY + ts * 0.5) / ts);
                                                        }

                                                        const dx = worldX - p.cx();
                                                        const dy = worldY - p.cy();
                                                        const reachPx = CONFIG.REACH_DISTANCE * ts;
                                                        const inRange = (dx * dx + dy * dy) <= (reachPx * reachPx);

                                                        if (tileX >= 0 && tileX < this.world.w && tileY >= 0 && tileY < this.world.h) {
                                                            renderer.renderHighlight(tileX, tileY, cam, inRange);
                                                        }

                                                        // PostFX：提升整体质感（色彩分级/雾化/暗角/颗粒），默认开启
                                                        if (renderer.applyPostFX) {
                                                            const depth01 = Utils.clamp((p.y + p.h * 0.5) / (this.world.h * ts), 0, 1);
                                                            renderer.applyPostFX(this.timeOfDay, depth01, !!settings.reducedMotion);
                                                        }

                                                        // 小地图（折叠时完全跳过）
                                                        const minimapVisible = !(window.TU && window.TU.MINIMAP_VISIBLE === false);
                                                        if (settings.minimap && minimapVisible && this.minimap) {
                                                            this.minimap.update();
                                                            this.minimap.render(p.x, p.y);
                                                        }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 42 (line 19008) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'v9_biomes_mines_dynamic_water_pumps_clouds_reverb',
                                            order: 80,
                                            description: "v9 生物群系/矿洞/动态水泵/云层/混响",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || (window.TU = {});
                                                const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : (TU.CONFIG || { TILE_SIZE: 16 });
                                                const BLOCK = (typeof window.BLOCK !== 'undefined') ? window.BLOCK : (TU.BLOCK || {});
                                                const BD = (typeof window.BLOCK_DATA !== 'undefined') ? window.BLOCK_DATA : (TU.BLOCK_DATA || {});
                                                const SOLID = (typeof window.BLOCK_SOLID !== 'undefined') ? window.BLOCK_SOLID : (TU.BLOCK_SOLID || new Uint8Array(256));
                                                const LIQ = (typeof window.BLOCK_LIQUID !== 'undefined') ? window.BLOCK_LIQUID : (TU.BLOCK_LIQUID || new Uint8Array(256));
                                                const TRANSP = (typeof window.BLOCK_TRANSPARENT !== 'undefined') ? window.BLOCK_TRANSPARENT : (TU.BLOCK_TRANSPARENT || new Uint8Array(256));
                                                const WALK = (typeof window.BLOCK_WALKABLE !== 'undefined') ? window.BLOCK_WALKABLE : (TU.BLOCK_WALKABLE || new Uint8Array(256));
                                                const BL = (typeof window.BLOCK_LIGHT !== 'undefined') ? window.BLOCK_LIGHT : null;
                                                const BH = (typeof window.BLOCK_HARDNESS !== 'undefined') ? window.BLOCK_HARDNESS : null;
                                                const BC = (typeof window.BLOCK_COLOR !== 'undefined') ? window.BLOCK_COLOR : null;
                                                const SD = (typeof window.SUN_DECAY !== 'undefined') ? window.SUN_DECAY : null;

                                                const Game = (typeof window.Game !== 'undefined') ? window.Game : (TU.Game || null);
                                                const Renderer = TU.Renderer || window.Renderer || null;
                                                const AudioManager = TU.AudioManager || window.AudioManager || null;
                                                const WorldGenerator = TU.WorldGenerator || window.WorldGenerator || null;

                                                // ─────────────────────────────────────────────────────────────
                                                // 0) Biome utilities (3 bands: forest/desert/snow)
                                                // ─────────────────────────────────────────────────────────────
                                                const Biomes = TU.Biomes || (TU.Biomes = {});
                                                Biomes.bandAt = function (worldW, x) {
                                                    const t = worldW > 0 ? (x / worldW) : 0.5;
                                                    if (t < 0.34) return 'forest';
                                                    if (t < 0.68) return 'desert';
                                                    return 'snow';
                                                };

                                                // ─────────────────────────────────────────────────────────────
                                                // 1) Add Pump + Pressure Plate blocks (logic compatible)
                                                // ─────────────────────────────────────────────────────────────
                                                const IDS = TU.LOGIC_BLOCKS || (TU.LOGIC_BLOCKS = {});
                                                function allocId(start) {
                                                    try {
                                                        const used = new Set();
                                                        if (BLOCK && typeof BLOCK === 'object') {
                                                            for (const k in BLOCK) used.add(BLOCK[k] | 0);
                                                        }
                                                        for (let id = start; id < 255; id++) {
                                                            if (BD[id] || used.has(id)) continue;
                                                            return id;
                                                        }
                                                    } catch { }
                                                    return start;
                                                }

                                                if (!IDS.PUMP_IN) IDS.PUMP_IN = allocId(206);
                                                if (!IDS.PUMP_OUT) IDS.PUMP_OUT = allocId((IDS.PUMP_IN | 0) + 1);
                                                if (!IDS.PLATE_OFF) IDS.PLATE_OFF = allocId((IDS.PUMP_OUT | 0) + 1);
                                                if (!IDS.PLATE_ON) IDS.PLATE_ON = allocId((IDS.PLATE_OFF | 0) + 1);

                                                function addBlock(id, def) {
                                                    try { BD[id] = def; } catch { }
                                                    try { SOLID[id] = def.solid ? 1 : 0; } catch { }
                                                    try { TRANSP[id] = def.transparent ? 1 : 0; } catch { }
                                                    try { LIQ[id] = def.liquid ? 1 : 0; } catch { }
                                                    try { if (BL) BL[id] = def.light ? (def.light | 0) : 0; } catch { }
                                                    try { if (BH) BH[id] = def.hardness ? +def.hardness : 0; } catch { }
                                                    try { if (BC) BC[id] = def.color; } catch { }
                                                    try { if (WALK) WALK[id] = def.solid ? 0 : 1; } catch { }
                                                    try {
                                                        if (SD) {
                                                            const AIR = (BLOCK && BLOCK.AIR !== undefined) ? BLOCK.AIR : 0;
                                                            let v = 0;
                                                            if (def.solid && !def.transparent) v = 3;
                                                            else if (def.transparent && id !== AIR) v = 1;
                                                            SD[id] = v;
                                                        }
                                                    } catch { }
                                                }

                                                try {
                                                    if (!BD[IDS.PUMP_IN]) {
                                                        addBlock(IDS.PUMP_IN, { name: '泵(入水口)', solid: true, transparent: false, liquid: false, light: 0, hardness: 1.2, color: '#3b3f46' });
                                                        addBlock(IDS.PUMP_OUT, { name: '泵(出水口)', solid: true, transparent: false, liquid: false, light: 0, hardness: 1.2, color: '#3b3f46' });
                                                        addBlock(IDS.PLATE_OFF, { name: '压力板', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.3, color: '#a37c57' });
                                                        addBlock(IDS.PLATE_ON, { name: '压力板(触发)', solid: false, transparent: true, liquid: false, light: 0, hardness: 0.3, color: '#d6a77a' });
                                                    }
                                                } catch (e) { console.warn('pump/plate block register failed', e); }

                                                // Pixel art for pump/plate (optional)
                                                try {
                                                    if (typeof TextureGenerator !== 'undefined' && TextureGenerator.prototype && !TextureGenerator.prototype.__pumpPlatePixV1) {
                                                        TextureGenerator.prototype.__pumpPlatePixV1 = true;
                                                        const _old = TextureGenerator.prototype._drawPixelArt;
                                                        TextureGenerator.prototype._drawPixelArt = function (ctx, id, data) {
                                                            const s = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (id === IDS.PUMP_IN || id === IDS.PUMP_OUT) {
                                                                ctx.fillStyle = '#2b2f36'; ctx.fillRect(0, 0, s, s);
                                                                ctx.fillStyle = '#4a4f59'; ctx.fillRect(2, 2, s - 4, s - 4);
                                                                ctx.fillStyle = '#0f1115'; ctx.fillRect(4, 4, s - 8, s - 8);
                                                                ctx.fillStyle = (id === IDS.PUMP_IN) ? '#42a5f5' : '#64dd17';
                                                                ctx.fillRect(6, 6, 4, 4);
                                                                ctx.fillStyle = '#cfd8dc';
                                                                ctx.fillRect(11, 5, 2, 7);
                                                                ctx.fillRect(5, 11, 7, 2);
                                                                return;
                                                            }
                                                            if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) {
                                                                ctx.fillStyle = '#00000000'; ctx.clearRect(0, 0, s, s);
                                                                ctx.fillStyle = (id === IDS.PLATE_ON) ? '#d6a77a' : '#a37c57';
                                                                ctx.fillRect(2, s - 4, s - 4, 2);
                                                                ctx.fillStyle = '#00000033';
                                                                ctx.fillRect(2, s - 3, s - 4, 1);
                                                                return;
                                                            }
                                                            return _old.call(this, ctx, id, data);
                                                        };
                                                    }
                                                } catch { }

                                                // ─────────────────────────────────────────────────────────────
                                                // 2) WorldGenerator: 3-biome bands + biome sky palette + temple styles + multi-layer mines
                                                // ─────────────────────────────────────────────────────────────
                                                function fillEnclosedWalls(tiles, walls, x0, y0, w, h, wallId) {
                                                    try {
                                                        const WW = tiles.length | 0;
                                                        const HH = (tiles[0] ? tiles[0].length : 0) | 0;
                                                        if (!WW || !HH) return;

                                                        const x1 = Math.min(WW - 1, x0 + w - 1);
                                                        const y1 = Math.min(HH - 1, y0 + h - 1);
                                                        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
                                                        if (x1 <= x0 || y1 <= y0) return;

                                                        const bw = (x1 - x0 + 1) | 0;
                                                        const bh = (y1 - y0 + 1) | 0;
                                                        const mark = new Uint8Array(bw * bh);

                                                        const qx = [];
                                                        const qy = [];
                                                        const push = (xx, yy) => {
                                                            const ix = xx - x0, iy = yy - y0;
                                                            const k = ix + iy * bw;
                                                            if (mark[k]) return;
                                                            if (tiles[xx][yy] !== BLOCK.AIR) return;
                                                            mark[k] = 1;
                                                            qx.push(xx); qy.push(yy);
                                                        };

                                                        // Seed from boundary: "outside air"
                                                        for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
                                                        for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }

                                                        while (qx.length) {
                                                            const xx = qx.pop();
                                                            const yy = qy.pop();
                                                            if (xx > x0) push(xx - 1, yy);
                                                            if (xx < x1) push(xx + 1, yy);
                                                            if (yy > y0) push(xx, yy - 1);
                                                            if (yy < y1) push(xx, yy + 1);
                                                        }

                                                        // Fill enclosed air that is NOT connected to outside air
                                                        for (let yy = y0; yy <= y1; yy++) {
                                                            for (let xx = x0; xx <= x1; xx++) {
                                                                if (tiles[xx][yy] !== BLOCK.AIR) continue;
                                                                const ix = xx - x0, iy = yy - y0;
                                                                const k = ix + iy * bw;
                                                                if (!mark[k]) walls[xx][yy] = wallId & 255;
                                                            }
                                                        }
                                                    } catch { }
                                                }

                                                if (WorldGenerator && WorldGenerator.prototype) {
                                                    // 2.1 Biome: override to 3 bands, with slightly wavy borders
                                                    WorldGenerator.prototype._biome = function (x) {
                                                        const w = this.w | 0;
                                                        let t = w > 0 ? x / w : 0.5;
                                                        // Wavy boundaries (stable per seed) – keeps bands readable but not "cut by knife"
                                                        let n = 0;
                                                        try { n = this.biomeNoise ? this.biomeNoise.fbm(x * 0.006, 0, 2) : 0; } catch { }
                                                        t += n * 0.03;
                                                        if (t < 0.34) return 'forest';
                                                        if (t < 0.68) return 'desert';
                                                        return 'snow';
                                                    };

                                                    // 2.2 Biome-specific surface & subsurface blocks
                                                    WorldGenerator.prototype._getSurfaceBlock = function (biome) {
                                                        if (biome === 'snow') return BLOCK.SNOW_GRASS;
                                                        if (biome === 'desert') return BLOCK.SAND;
                                                        return BLOCK.GRASS;
                                                    };
                                                    WorldGenerator.prototype._getSubSurfaceBlock = function (biome) {
                                                        if (biome === 'snow') return Math.random() > 0.78 ? BLOCK.ICE : BLOCK.SNOW;
                                                        if (biome === 'desert') return Math.random() > 0.68 ? BLOCK.SANDSTONE : BLOCK.SAND;
                                                        return BLOCK.DIRT;
                                                    };

                                                    // 2.3 Biome-tinted underground composition (keeps original noise but nudges materials)
                                                    const _oldUG = WorldGenerator.prototype._getUndergroundBlock;
                                                    WorldGenerator.prototype._getUndergroundBlock = function (x, y, layer) {
                                                        const biome = this._biome(x);
                                                        const base = _oldUG ? _oldUG.call(this, x, y, layer) : BLOCK.STONE;
                                                        if (biome === 'desert') {
                                                            if (layer === 'upper') return (Math.random() > 0.65) ? BLOCK.SANDSTONE : (Math.random() > 0.8 ? BLOCK.LIMESTONE : base);
                                                            if (layer === 'middle') return (Math.random() > 0.55) ? BLOCK.SANDSTONE : (Math.random() > 0.75 ? BLOCK.GRANITE : base);
                                                            return (Math.random() > 0.6) ? BLOCK.BASALT : base;
                                                        }
                                                        if (biome === 'snow') {
                                                            if (layer === 'upper') return (Math.random() > 0.82) ? BLOCK.ICE : base;
                                                            if (layer === 'middle') return (Math.random() > 0.7) ? BLOCK.GRANITE : (Math.random() > 0.86 ? BLOCK.ICE : base);
                                                            return (Math.random() > 0.78) ? BLOCK.OBSIDIAN : base;
                                                        }
                                                        return base;
                                                    };

                                                    // 2.4 Temple styles by depth (brick / marble / granite / hell)
                                                    WorldGenerator.prototype._placeTemple = function (tiles, walls, x, y) {
                                                        const w = 14 + ((Math.random() * 10) | 0);
                                                        const h = 9 + ((Math.random() * 6) | 0);

                                                        const WW = this.w | 0, HH = this.h | 0;
                                                        const depth01 = HH > 0 ? (y / HH) : 0.6;
                                                        const biome = this._biome(x);

                                                        let shell = BLOCK.BRICK;
                                                        let accent = BLOCK.COBBLESTONE;
                                                        let wallId = 2;

                                                        if (depth01 < 0.58) {
                                                            shell = (biome === 'desert') ? BLOCK.SANDSTONE : (Math.random() > 0.5 ? BLOCK.BRICK : BLOCK.COBBLESTONE);
                                                            accent = BLOCK.PLANKS;
                                                            wallId = 1;
                                                        } else if (depth01 < 0.78) {
                                                            shell = BLOCK.MARBLE;
                                                            accent = (biome === 'desert') ? BLOCK.SANDSTONE : BLOCK.BRICK;
                                                            wallId = 2;
                                                        } else if (depth01 < 0.90) {
                                                            shell = BLOCK.GRANITE;
                                                            accent = BLOCK.SLATE;
                                                            wallId = 2;
                                                        } else {
                                                            shell = BLOCK.OBSIDIAN;
                                                            accent = BLOCK.BASALT;
                                                            wallId = 3;
                                                        }

                                                        const tlx = x, tly = y;
                                                        for (let dx = 0; dx < w; dx++) {
                                                            for (let dy = 0; dy < h; dy++) {
                                                                const tx = tlx + dx, ty = tly + dy;
                                                                if (tx < 1 || tx >= WW - 1 || ty < 1 || ty >= HH - 1) continue;

                                                                const border = (dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1);
                                                                const pillar = ((dx === 3 || dx === w - 4) && dy > 1 && dy < h - 2);
                                                                const cornice = (dy === 1 && (dx % 3 === 0));
                                                                if (border || pillar) tiles[tx][ty] = shell;
                                                                else if (cornice && Math.random() > 0.4) tiles[tx][ty] = accent;
                                                                else { tiles[tx][ty] = BLOCK.AIR; walls[tx][ty] = wallId; }
                                                            }
                                                        }

                                                        // Inner details by style
                                                        const cx = tlx + (w >> 1);
                                                        const cy = tly + h - 2;

                                                        if (cx > 1 && cx < WW - 1 && cy > 1 && cy < HH - 1) {
                                                            tiles[cx][cy] = BLOCK.TREASURE_CHEST;
                                                            if (tly + 1 < HH) tiles[cx][tly + 1] = BLOCK.LANTERN;

                                                            // ornaments
                                                            const gem = (depth01 < 0.78) ? BLOCK.CRYSTAL : (depth01 < 0.90 ? BLOCK.AMETHYST : BLOCK.OBSIDIAN);
                                                            for (let i = 0; i < 6; i++) {
                                                                const ox = cx + ((i % 3) - 1) * 2;
                                                                const oy = cy - 1 - ((i / 3) | 0);
                                                                if (ox > 1 && ox < WW - 1 && oy > 1 && oy < HH - 1 && tiles[ox][oy] === BLOCK.AIR) tiles[ox][oy] = gem;
                                                            }
                                                        }

                                                        // Auto-fill background walls in enclosed interior (for "indoor" checks)
                                                        fillEnclosedWalls(tiles, walls, tlx, tly, w, h, wallId);

                                                        // Light cobwebs near ceiling (only shallow styles)
                                                        if (depth01 < 0.85) {
                                                            const webN = 3 + ((Math.random() * 5) | 0);
                                                            for (let i = 0; i < webN; i++) {
                                                                const wx = tlx + 1 + ((Math.random() * (w - 2)) | 0);
                                                                const wy = tly + 1 + ((Math.random() * 3) | 0);
                                                                if (wx > 0 && wx < WW && wy > 0 && wy < HH && tiles[wx][wy] === BLOCK.AIR) tiles[wx][wy] = BLOCK.SPIDER_WEB;
                                                            }
                                                        }
                                                    };

                                                    // 2.5 Multi-layer mines (connected tunnels, rooms, shafts)
                                                    WorldGenerator.prototype._generateMultiLayerMines = function (tiles, walls) {
                                                        const WW = this.w | 0, HH = this.h | 0;
                                                        const levels = 3 + ((Math.random() * 2) | 0); // 3-4
                                                        const y0 = (HH * 0.42) | 0;
                                                        const yStep = (HH * 0.10) | 0;

                                                        const carve = (x, y, r, wallId) => {
                                                            for (let dx = -r; dx <= r; dx++) {
                                                                for (let dy = -r; dy <= r; dy++) {
                                                                    if ((dx * dx + dy * dy) > (r * r + 0.4)) continue;
                                                                    const xx = x + dx, yy = y + dy;
                                                                    if (xx < 2 || xx >= WW - 2 || yy < 2 || yy >= HH - 2) continue;
                                                                    tiles[xx][yy] = BLOCK.AIR;
                                                                    walls[xx][yy] = wallId & 255;
                                                                }
                                                            }
                                                        };

                                                        const placeSupport = (x, y, wallId) => {
                                                            // 3-high tunnel supports: |-| with occasional torch
                                                            for (let dy = -1; dy <= 1; dy++) {
                                                                const yy = y + dy;
                                                                if (yy < 2 || yy >= HH - 2) continue;
                                                                if (x - 1 > 1) tiles[x - 1][yy] = BLOCK.PLANKS;
                                                                if (x + 1 < WW - 2) tiles[x + 1][yy] = BLOCK.PLANKS;
                                                            }
                                                            if (y - 2 > 1) tiles[x][y - 2] = BLOCK.PLANKS;
                                                            if (Math.random() > 0.6 && x - 2 > 1 && y > 2) tiles[x - 2][y] = BLOCK.TORCH;
                                                            // make interior count as "indoors"
                                                            if (walls[x][y] === 0) walls[x][y] = wallId & 255;
                                                        };

                                                        const placeRoom = (rx, ry, wallId) => {
                                                            const rw = 9 + ((Math.random() * 6) | 0);
                                                            const rh = 6 + ((Math.random() * 4) | 0);
                                                            const tlx = rx - (rw >> 1);
                                                            const tly = ry - (rh >> 1);
                                                            if (tlx < 3 || tly < 3 || tlx + rw >= WW - 3 || tly + rh >= HH - 3) return;
                                                            for (let dx = 0; dx < rw; dx++) {
                                                                for (let dy = 0; dy < rh; dy++) {
                                                                    const x = tlx + dx, y = tly + dy;
                                                                    const border = (dx === 0 || dx === rw - 1 || dy === 0 || dy === rh - 1);
                                                                    if (border) tiles[x][y] = (Math.random() > 0.5) ? BLOCK.PLANKS : BLOCK.COBBLESTONE;
                                                                    else { tiles[x][y] = BLOCK.AIR; walls[x][y] = wallId & 255; }
                                                                }
                                                            }
                                                            fillEnclosedWalls(tiles, walls, tlx, tly, rw, rh, wallId);
                                                            // Decor: lantern + chest by depth
                                                            if (rx > 2 && ry > 2 && rx < WW - 2 && ry < HH - 2) {
                                                                tiles[rx][tly + 1] = BLOCK.LANTERN;
                                                                if (Math.random() > 0.45) tiles[tlx + rw - 2][tly + rh - 2] = BLOCK.TREASURE_CHEST;
                                                            }
                                                        };

                                                        // Build each level as a wiggly horizontal backbone
                                                        const wallId = 1;
                                                        for (let lv = 0; lv < levels; lv++) {
                                                            let y = y0 + lv * yStep + ((Math.random() * 10) | 0) - 5;
                                                            y = Math.max((HH * 0.34) | 0, Math.min((HH * 0.86) | 0, y));

                                                            let x = 20 + ((Math.random() * 20) | 0);
                                                            const xEnd = WW - 20 - ((Math.random() * 20) | 0);

                                                            let seg = 0;
                                                            while (x < xEnd) {
                                                                // carve tunnel
                                                                carve(x, y, 1, wallId);
                                                                carve(x, y - 1, 1, wallId);
                                                                carve(x, y + 1, 1, wallId);

                                                                // gentle vertical drift
                                                                if ((seg % 7) === 0) {
                                                                    const drift = (Math.random() < 0.5 ? -1 : 1);
                                                                    const ny = y + drift;
                                                                    if (ny > (HH * 0.30) && ny < (HH * 0.88)) y = ny;
                                                                }

                                                                // supports
                                                                if ((seg % 10) === 0) placeSupport(x, y, wallId);

                                                                // rooms
                                                                if ((seg % 38) === 0 && Math.random() > 0.35) placeRoom(x + 6, y, wallId);

                                                                x++;
                                                                seg++;
                                                            }
                                                        }

                                                        // Connect levels with shafts (vertical connectors)
                                                        const shaftN = 4 + ((Math.random() * 5) | 0);
                                                        for (let i = 0; i < shaftN; i++) {
                                                            const sx = 30 + ((Math.random() * (WW - 60)) | 0);
                                                            const top = y0 + ((Math.random() * 10) | 0);
                                                            const bot = y0 + (levels - 1) * yStep + ((Math.random() * 10) | 0);
                                                            const yA = Math.min(top, bot), yB = Math.max(top, bot);
                                                            for (let y = yA; y <= yB; y++) {
                                                                carve(sx, y, 1, wallId);
                                                                // platforms every few tiles
                                                                if ((y % 8) === 0) {
                                                                    if (sx - 1 > 1) tiles[sx - 1][y] = BLOCK.PLANKS;
                                                                    if (sx + 1 < WW - 2) tiles[sx + 1][y] = BLOCK.PLANKS;
                                                                }
                                                                if ((y % 12) === 0 && Math.random() > 0.5) tiles[sx][y] = BLOCK.TORCH;
                                                            }
                                                        }
                                                    };

                                                    // 2.6 Hook mines into structure pass
                                                    if (!WorldGenerator.prototype.__mineV9Hooked) {
                                                        WorldGenerator.prototype.__mineV9Hooked = true;
                                                        const _oldStructures = WorldGenerator.prototype._structures;
                                                        WorldGenerator.prototype._structures = function (tiles, walls) {
                                                            if (_oldStructures) _oldStructures.call(this, tiles, walls);
                                                            try { this._generateMultiLayerMines(tiles, walls); } catch (e) { console.warn('mine gen failed', e); }
                                                        };
                                                    }

                                                    // 2.7 Extend StructureLibrary with mine pieces (pattern based, compatible with ruin_shrine descriptor)
                                                    try {
                                                        const lib = TU.Structures;
                                                        if (lib && !TU.__mineDescsAddedV9) {
                                                            TU.__mineDescsAddedV9 = true;
                                                            lib.ensureLoaded && lib.ensureLoaded();
                                                            const extra = [
                                                                {
                                                                    id: 'mine_room_small',
                                                                    tags: ['mine', 'room'],
                                                                    weight: 3,
                                                                    depth: [0.40, 0.82],
                                                                    anchor: [0.5, 0.5],
                                                                    placement: { mode: 'underground', minSolidRatio: 0.40, defaultWall: 1 },
                                                                    pattern: [
                                                                        "###########",
                                                                        "#.........#",
                                                                        "#..t...t..#",
                                                                        "#....C....#",
                                                                        "#.........#",
                                                                        "#..t...t..#",
                                                                        "###########"
                                                                    ],
                                                                    legend: {
                                                                        "#": { tile: "PLANKS", replace: "any" },
                                                                        ".": { tile: "AIR", wall: 1, replace: "any" },
                                                                        "t": { tile: "TORCH", replace: "any" },
                                                                        "C": { tile: "TREASURE_CHEST", replace: "any" }
                                                                    },
                                                                    connectors: [
                                                                        { x: 0, y: 3, dir: "left", len: 14, carve: true, wall: 1 },
                                                                        { x: 10, y: 3, dir: "right", len: 14, carve: true, wall: 1 },
                                                                        { x: 5, y: 6, dir: "down", len: 10, carve: true, wall: 1 }
                                                                    ]
                                                                },
                                                                {
                                                                    id: 'mine_junction',
                                                                    tags: ['mine', 'junction'],
                                                                    weight: 2,
                                                                    depth: [0.45, 0.88],
                                                                    anchor: [0.5, 0.5],
                                                                    placement: { mode: 'underground', minSolidRatio: 0.40, defaultWall: 1 },
                                                                    pattern: [
                                                                        "#####",
                                                                        "#...#",
                                                                        "#...#",
                                                                        "#...#",
                                                                        "#####"
                                                                    ],
                                                                    legend: {
                                                                        "#": { tile: "COBBLESTONE", replace: "any" },
                                                                        ".": { tile: "AIR", wall: 1, replace: "any" }
                                                                    },
                                                                    connectors: [
                                                                        { x: 0, y: 2, dir: "left", len: 18, carve: true, wall: 1 },
                                                                        { x: 4, y: 2, dir: "right", len: 18, carve: true, wall: 1 },
                                                                        { x: 2, y: 0, dir: "up", len: 10, carve: true, wall: 1 },
                                                                        { x: 2, y: 4, dir: "down", len: 10, carve: true, wall: 1 }
                                                                    ]
                                                                }
                                                            ];
                                                            lib.loadFromArray && lib.loadFromArray(extra, { replace: false });
                                                        }
                                                    } catch { }
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 3) Treasure chest: depth-based loot table (on break)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__chestLootV9) {
                                                    Game.prototype.__chestLootV9 = true;

                                                    Game.prototype._rollChestLoot = function (depth01) {
                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const picks = [];
                                                        const add = (id, cMin, cMax, chance = 1) => {
                                                            if (Math.random() > chance) return;
                                                            const c = (cMin === cMax) ? cMin : (cMin + ((Math.random() * (cMax - cMin + 1)) | 0));
                                                            if (c > 0) picks.push([id, c]);
                                                        };

                                                        // Tier thresholds
                                                        if (d < 0.36) {
                                                            add(BLOCK.TORCH, 6, 14, 1);
                                                            add(BLOCK.WOOD, 10, 30, 0.85);
                                                            add(BLOCK.COPPER_ORE || BLOCK.STONE, 6, 18, 0.75);
                                                            add(BLOCK.IRON_ORE || BLOCK.STONE, 4, 12, 0.55);
                                                        } else if (d < 0.62) {
                                                            add(BLOCK.TORCH, 8, 18, 1);
                                                            add(BLOCK.IRON_ORE || BLOCK.STONE, 10, 24, 0.85);
                                                            add(BLOCK.SILVER_ORE || BLOCK.IRON_ORE || BLOCK.STONE, 6, 16, 0.6);
                                                            add(BLOCK.GOLD_ORE || BLOCK.SILVER_ORE || BLOCK.STONE, 3, 10, 0.45);
                                                            add(BLOCK.LIFE_CRYSTAL || BLOCK.CRYSTAL, 1, 1, 0.18);
                                                        } else if (d < 0.86) {
                                                            add(BLOCK.TORCH, 10, 20, 1);
                                                            add(BLOCK.GOLD_ORE || BLOCK.SILVER_ORE || BLOCK.STONE, 8, 22, 0.8);
                                                            add(BLOCK.DIAMOND_ORE || BLOCK.RUBY_ORE || BLOCK.CRYSTAL, 1, 3, 0.35);
                                                            add(BLOCK.MANA_CRYSTAL || BLOCK.AMETHYST || BLOCK.CRYSTAL, 1, 2, 0.25);
                                                            add(BLOCK.CRYSTAL, 2, 6, 0.55);
                                                        } else {
                                                            add(BLOCK.HELLSTONE || BLOCK.BASALT || BLOCK.STONE, 10, 26, 0.85);
                                                            add(BLOCK.OBSIDIAN || BLOCK.BASALT, 8, 20, 0.75);
                                                            add(BLOCK.DIAMOND_ORE || BLOCK.CRYSTAL, 2, 4, 0.35);
                                                            add(BLOCK.LAVA || BLOCK.OBSIDIAN, 1, 1, 0.10);
                                                        }

                                                        // Small bonus: building supplies
                                                        add(BLOCK.PLANKS || BLOCK.WOOD, 6, 16, 0.45);
                                                        add(BLOCK.LANTERN, 1, 1, 0.15);

                                                        // De-dup (merge same ids)
                                                        const m = new Map();
                                                        for (const [id, c] of picks) m.set(id, (m.get(id) || 0) + c);
                                                        return Array.from(m.entries());
                                                    };

                                                    Game.prototype._spawnTreasureChestLoot = function (tileX, tileY, px, py) {
                                                        try {
                                                            const ts = CFG.TILE_SIZE || 16;
                                                            const depth01 = (this.world && this.world.h) ? (tileY / this.world.h) : 0.5;
                                                            const drops = this._rollChestLoot(depth01);

                                                            // Drop the chest itself
                                                            this.droppedItems && this.droppedItems.spawn(px, py, BLOCK.TREASURE_CHEST, 1);

                                                            // Scatter loot a bit so pickups feel good
                                                            for (let i = 0; i < drops.length; i++) {
                                                                const [id, count] = drops[i];
                                                                const sx = px + ((Math.random() * 18) - 9);
                                                                const sy = py + ((Math.random() * 10) - 5);
                                                                this.droppedItems && this.droppedItems.spawn(sx, sy, id, count);
                                                            }

                                                            // Feedback
                                                            try { this.audio && this.audio.play('pickup'); } catch { }
                                                            try { this.particles && this.particles.emit(tileX * ts + 8, tileY * ts + 8, { color: '#ffd166', count: 18, speed: 3.5, up: true, glow: true }); } catch { }
                                                        } catch (e) {
                                                            // Fallback: at least drop chest block
                                                            try { this.droppedItems && this.droppedItems.spawn(px, py, BLOCK.TREASURE_CHEST, 1); } catch { }
                                                        }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 4) Dynamic Water v2 + U-tube pressure: upgrade TileLogicEngine worker + idle fallback
                                                // ─────────────────────────────────────────────────────────────
                                                function buildTileLogicWorkerSourceV9() {
                                                    // Keep message protocol identical to v12, but improve fluid + add plate/pump awareness in logic scan.
                                                    // NOTE: This string is intentionally "plain JS" (no template interpolations).
                                                    return `/* TileLogic Worker v12+ (v9 fluids) */
      (() => {
        let W = 0, H = 0;
        let tiles = null;
        let water = null;
        let solid = null;

        let AIR = 0, WATER = 27;
        let IDS = null;

        const region = { x0: 0, y0: 0, x1: -1, y1: -1, set: false };
        let lastRegionKey = '';
        let perfLevel = 'high';
        const MAX = 8;

        const waterQ = [];
        let waterMark = null;
        const logicQ = [];
        let logicMark = null;

        function idx(x, y) { return x * H + y; }

        function inRegionIndex(i) {
          if (!region.set) return false;
          const x = (i / H) | 0;
          const y = i - x * H;
          return (x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1);
        }

        function isWire(id)   { return id === IDS.WIRE_OFF || id === IDS.WIRE_ON; }
        function isSwitch(id) { return id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON || id === IDS.PLATE_OFF || id === IDS.PLATE_ON; }
        function isSource(id) { return id === IDS.SWITCH_ON || id === IDS.PLATE_ON; }
        function isLamp(id)   { return id === IDS.LAMP_OFF || id === IDS.LAMP_ON; }
        function isPump(id)   { return id === IDS.PUMP_IN || id === IDS.PUMP_OUT; }
        function isConductor(id) { return isWire(id) || isSwitch(id) || isPump(id); }

        function canWaterEnterTile(id) { return id === AIR || id === WATER; }

        function scheduleWater(i) {
          if (!waterMark) return;
          if (!inRegionIndex(i)) return;
          if (waterMark[i]) return;
          waterMark[i] = 1;
          waterQ.push(i);
        }

        function scheduleWaterAround(x, y) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          scheduleWater(idx(x, y));
          if (x > 0) scheduleWater(idx(x - 1, y));
          if (x + 1 < W) scheduleWater(idx(x + 1, y));
          if (y > 0) scheduleWater(idx(x, y - 1));
          if (y + 1 < H) scheduleWater(idx(x, y + 1));
        }

        function scheduleLogic(i) {
          if (!logicMark) return;
          if (!inRegionIndex(i)) return;
          if (logicMark[i]) return;
          logicMark[i] = 1;
          logicQ.push(i);
        }

        function scheduleLogicAround(x, y) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          scheduleLogic(idx(x, y));
          if (x > 0) scheduleLogic(idx(x - 1, y));
          if (x + 1 < W) scheduleLogic(idx(x + 1, y));
          if (y > 0) scheduleLogic(idx(x, y - 1));
          if (y + 1 < H) scheduleLogic(idx(x, y + 1));
        }

        function setTile(i, newId, changes) {
          const old = tiles[i];
          if (old === newId) return false;
          tiles[i] = newId;
          changes.push(i, old, newId);
          const x = (i / H) | 0;
          const y = i - x * H;
          scheduleWaterAround(x, y);
          scheduleLogicAround(x, y);
          return true;
        }

        function ensureWaterTile(i, changes) {
          if (water[i] > 0) {
            if (tiles[i] !== WATER) setTile(i, WATER, changes);
          } else {
            if (tiles[i] === WATER) setTile(i, AIR, changes);
          }
        }

        // Dynamic water with smoothing + limited pressure-up (U-tube-ish)
        function waterTick(i, changes) {
          waterMark[i] = 0;
          if (!inRegionIndex(i)) return;

          let a = water[i] | 0;
          if (a <= 0) return;

          const tid = tiles[i];
          if (tid !== WATER && tid !== AIR) { water[i] = 0; return; }

          const x = (i / H) | 0;
          const y = i - x * H;

          // Snapshot neighbors (avoid directional bias)
          const down = (y + 1 < H) ? (i + 1) : -1;
          const up   = (y > 0) ? (i - 1) : -1;
          const left = (x > 0) ? (i - H) : -1;
          const right= (x + 1 < W) ? (i + H) : -1;

          // 1) Down flow (strong)
          if (down !== -1 && canWaterEnterTile(tiles[down])) {
            const b = water[down] | 0;
            const space = MAX - b;
            if (space > 0) {
              const mv = (a < space) ? a : space;
              water[i] = a - mv;
              water[down] = b + mv;
              a = water[i] | 0;

              ensureWaterTile(i, changes);
              ensureWaterTile(down, changes);

              scheduleWater(down);
              scheduleWater(i);
              scheduleWaterAround(x, y);
              scheduleWaterAround(x, y + 1);
            }
          }
          if (a <= 0) return;

          // 2) Horizontal smoothing (simultaneous-ish)
          let a0 = a;
          let mvL = 0, mvR = 0;

          if (left !== -1 && canWaterEnterTile(tiles[left])) {
            const b = water[left] | 0;
            const diff = a0 - b;
            if (diff > 1) {
              mvL = (diff / 3) | 0; // gentler than half, smoother
              if (mvL < 1) mvL = 1;
              const space = MAX - b;
              if (mvL > space) mvL = space;
            }
          }
          if (right !== -1 && canWaterEnterTile(tiles[right])) {
            const b = water[right] | 0;
            const diff = a0 - b;
            if (diff > 1) {
              mvR = (diff / 3) | 0;
              if (mvR < 1) mvR = 1;
              const space = MAX - b;
              if (mvR > space) mvR = space;
            }
          }

          // Cap total move to available water
          const tot = mvL + mvR;
          if (tot > a0) {
            // scale down proportionally
            mvL = ((mvL * a0) / tot) | 0;
            mvR = a0 - mvL;
          }

          if (mvL > 0 && left !== -1) {
            water[i] = (water[i] | 0) - mvL;
            water[left] = (water[left] | 0) + mvL;
            ensureWaterTile(i, changes);
            ensureWaterTile(left, changes);
            scheduleWater(left); scheduleWater(i);
          }
          if (mvR > 0 && right !== -1) {
            water[i] = (water[i] | 0) - mvR;
            water[right] = (water[right] | 0) + mvR;
            ensureWaterTile(i, changes);
            ensureWaterTile(right, changes);
            scheduleWater(right); scheduleWater(i);
          }

          a = water[i] | 0;
          if (a <= 0) return;

          // 3) Pressure-up (limited): if fully pressurized and blocked below, allow a tiny move upward
          if (up !== -1 && canWaterEnterTile(tiles[up])) {
            const ub = water[up] | 0;
            const belowBlocked = (down === -1) || !canWaterEnterTile(tiles[down]) || (water[down] | 0) >= MAX;
            if (belowBlocked && a >= MAX && ub + 1 < a && ub < MAX) {
              water[i] = (water[i] | 0) - 1;
              water[up] = ub + 1;
              ensureWaterTile(i, changes);
              ensureWaterTile(up, changes);
              scheduleWater(up); scheduleWater(i);
            }
          }
        }

        // Logic: same as v12, but treat pressure plate as switch/source and pumps as conductors (for connectivity)
        let vis = null;
        let stamp = 1;
        function ensureVis() {
          const N = W * H;
          if (!vis || vis.length !== N) vis = new Uint32Array(N);
        }

        function lampShouldOn(iLamp) {
          const x = (iLamp / H) | 0;
          const y = iLamp - x * H;
          if (x > 0) { const t = tiles[iLamp - H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (x + 1 < W) { const t = tiles[iLamp + H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y > 0) { const t = tiles[iLamp - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y + 1 < H) { const t = tiles[iLamp + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          return false;
        }

        function updateLampAt(iLamp, changes) {
          const t = tiles[iLamp];
          if (!(t === IDS.LAMP_OFF || t === IDS.LAMP_ON)) return;
          const want = lampShouldOn(iLamp) ? IDS.LAMP_ON : IDS.LAMP_OFF;
          if (t !== want) setTile(iLamp, want, changes);
        }

        function logicRecomputeFromSeed(seed, changes) {
          logicMark[seed] = 0;

          ensureVis();
          stamp = (stamp + 1) >>> 0;
          if (stamp === 0) { stamp = 1; vis.fill(0); }

          const starts = [];
          const sid = tiles[seed];
          if (isConductor(sid) || isLamp(sid)) starts.push(seed);
          else {
            const x = (seed / H) | 0;
            const y = seed - x * H;
            if (x > 0) { const n = seed - H; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (x + 1 < W) { const n = seed + H; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (y > 0) { const n = seed - 1; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
            if (y + 1 < H) { const n = seed + 1; if (isConductor(tiles[n]) || isLamp(tiles[n])) starts.push(n); }
          }
          if (!starts.length) return;

          const q = [];
          const comp = [];
          let powered = false;

          for (let si = 0; si < starts.length; si++) {
            const s = starts[si];
            if (vis[s] === stamp) continue;
            vis[s] = stamp;
            q.push(s);

            while (q.length) {
              const i = q.pop();
              const t = tiles[i];
              if (!(isConductor(t) || isLamp(t))) continue;

              comp.push(i);
              if (isSource(t)) powered = true;

              const x = (i / H) | 0;
              const y = i - x * H;

              if (x > 0) { const n = i - H; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (x + 1 < W) { const n = i + H; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (y > 0) { const n = i - 1; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }
              if (y + 1 < H) { const n = i + 1; if (vis[n] !== stamp && (isConductor(tiles[n]) || isLamp(tiles[n]))) { vis[n] = stamp; q.push(n); } }

              if (comp.length > 14000) break;
            }
            if (comp.length > 14000) break;
          }

          const wantWire = powered ? IDS.WIRE_ON : IDS.WIRE_OFF;
          for (let i = 0; i < comp.length; i++) {
            const p = comp[i];
            const t = tiles[p];
            if (isWire(t) && t !== wantWire) setTile(p, wantWire, changes);
            if (isLamp(t)) updateLampAt(p, changes);
          }
        }

        function primeRegionWork() {
          if (!region.set) return;
          for (let x = region.x0; x <= region.x1; x++) {
            const base = x * H;
            for (let y = region.y0; y <= region.y1; y++) {
              const i = base + y;
              if (water[i] > 0) scheduleWater(i);
              const t = tiles[i];
              if (t === IDS.SWITCH_ON || t === IDS.PLATE_ON || isWire(t) || isLamp(t) || isPump(t)) scheduleLogic(i);
            }
          }
        }

        // Optional: pump tick inside region (small budget), teleports 1 water unit between linked pumps along wires
        const pumpQ = [];
        const pumpMark = new Uint8Array(1);
        let pumpAcc = 0;

        function schedulePumpInRegion() {
          if (!region.set) return;
          pumpQ.length = 0;
          for (let x = region.x0; x <= region.x1; x++) {
            const base = x * H;
            for (let y = region.y0; y <= region.y1; y++) {
              const i = base + y;
              if (tiles[i] === IDS.PUMP_IN) pumpQ.push(i);
            }
          }
        }

        function pumpPowered(iPump) {
          const x = (iPump / H) | 0;
          const y = iPump - x * H;
          if (x > 0) { const t = tiles[iPump - H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (x + 1 < W) { const t = tiles[iPump + H]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y > 0) { const t = tiles[iPump - 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          if (y + 1 < H) { const t = tiles[iPump + 1]; if (t === IDS.WIRE_ON || t === IDS.SWITCH_ON || t === IDS.PLATE_ON) return true; }
          return false;
        }

        function findPumpOut(iSeed, maxNodes) {
          ensureVis();
          stamp = (stamp + 1) >>> 0;
          if (stamp === 0) { stamp = 1; vis.fill(0); }

          const q = [iSeed];
          vis[iSeed] = stamp;

          let found = -1;
          let nodes = 0;

          while (q.length && nodes < maxNodes) {
            const i = q.pop();
            nodes++;

            const t = tiles[i];
            if (t === IDS.PUMP_OUT) { found = i; break; }

            const x = (i / H) | 0;
            const y = i - x * H;

            // Traverse conductors (wire/switch/plate/pumps)
            const tryN = (n) => {
              if (n < 0 || n >= W * H) return;
              if (vis[n] === stamp) return;
              const tt = tiles[n];
              if (!isConductor(tt)) return;
              vis[n] = stamp;
              q.push(n);
            };

            if (x > 0) tryN(i - H);
            if (x + 1 < W) tryN(i + H);
            if (y > 0) tryN(i - 1);
            if (y + 1 < H) tryN(i + 1);
          }

          return found;
        }

        function pumpTransfer(iIn, iOut, changes) {
          const xi = (iIn / H) | 0;
          const yi = iIn - xi * H;
          const xo = (iOut / H) | 0;
          const yo = iOut - xo * H;

          // intake neighbor preference: below, left, right, up
          const nIn = [];
          if (yi + 1 < H) nIn.push(iIn + 1);
          if (xi > 0) nIn.push(iIn - H);
          if (xi + 1 < W) nIn.push(iIn + H);
          if (yi > 0) nIn.push(iIn - 1);

          let took = 0;
          for (let k = 0; k < nIn.length && took < 2; k++) {
            const n = nIn[k];
            if (!canWaterEnterTile(tiles[n])) continue;
            const a = water[n] | 0;
            if (a <= 0) continue;
            water[n] = a - 1;
            took++;
            ensureWaterTile(n, changes);
            scheduleWater(n);
          }
          if (took <= 0) return;

          // output neighbor preference: above, right, left, down
          const nOut = [];
          if (yo > 0) nOut.push(iOut - 1);
          if (xo + 1 < W) nOut.push(iOut + H);
          if (xo > 0) nOut.push(iOut - H);
          if (yo + 1 < H) nOut.push(iOut + 1);

          for (let t = 0; t < took; t++) {
            let placed = false;
            for (let k = 0; k < nOut.length; k++) {
              const n = nOut[k];
              if (!canWaterEnterTile(tiles[n])) continue;
              const b = water[n] | 0;
              if (b >= MAX) continue;
              water[n] = b + 1;
              ensureWaterTile(n, changes);
              scheduleWater(n);
              placed = true;
              break;
            }
            if (!placed) break;
          }
        }

        function step() {
          const changes = [];

          const waterBudget = (perfLevel === 'low') ? 420 : 1100;
          for (let ops = 0; ops < waterBudget && waterQ.length; ops++) {
            waterTick(waterQ.pop(), changes);
          }

          const logicBudget = 1;
          for (let ops = 0; ops < logicBudget && logicQ.length; ops++) {
            logicRecomputeFromSeed(logicQ.pop(), changes);
          }

          // Pump budget (light): run once every ~6 ticks
          pumpAcc = (pumpAcc + 1) | 0;
          if ((pumpAcc % 6) === 0) {
            if (!pumpQ.length) schedulePumpInRegion();
            const pumpBudget = (perfLevel === 'low') ? 1 : 2;
            for (let p = 0; p < pumpBudget && pumpQ.length; p++) {
              const iIn = pumpQ.pop();
              if (!pumpPowered(iIn)) continue;
              const out = findPumpOut(iIn, 9000);
              if (out !== -1) pumpTransfer(iIn, out, changes);
            }
          }

          if (changes.length) {
            const buf = new Int32Array(changes);
            postMessage({ type: 'changes', buf: buf.buffer }, [buf.buffer]);
          }

          const tickMs = (perfLevel === 'low') ? 55 : 35;
          setTimeout(step, tickMs);
        }

        onmessage = (e) => {
          const m = e.data;
          if (!m || !m.type) return;

          switch (m.type) {
            case 'init': {
              W = m.w | 0;
              H = m.h | 0;
              IDS = m.ids || {};
              AIR = (m.blocks && (m.blocks.AIR | 0) >= 0) ? (m.blocks.AIR | 0) : 0;
              WATER = (m.blocks && (m.blocks.WATER | 0) >= 0) ? (m.blocks.WATER | 0) : 27;

              tiles = new Uint8Array(m.tiles);
              solid = new Uint8Array(m.solid);

              const N = W * H;
              water = new Uint8Array(N);
              waterMark = new Uint8Array(N);
              logicMark = new Uint8Array(N);
              ensureVis();

              for (let i = 0; i < N; i++) if (tiles[i] === WATER) water[i] = MAX;

              step();
              break;
            }

            case 'tileWrite': {
              if (!tiles) return;
              const x = m.x | 0;
              const y = m.y | 0;
              if (x < 0 || y < 0 || x >= W || y >= H) return;

              const i = idx(x, y);
              const newId = m.id | 0;
              const oldId = tiles[i];
              tiles[i] = newId;

              if (newId === WATER) {
                water[i] = MAX;
                scheduleWaterAround(x, y);
              } else if (oldId === WATER && newId !== WATER) {
                water[i] = 0;
                scheduleWaterAround(x, y);
              }

              scheduleLogicAround(x, y);
              break;
            }

            case 'region': {
              const cx = m.cx | 0, cy = m.cy | 0;
              const rx = m.rx | 0, ry = m.ry | 0;

              const x0 = Math.max(0, cx - rx);
              const x1 = Math.min(W - 1, cx + rx);
              const y0 = Math.max(0, cy - ry);
              const y1 = Math.min(H - 1, cy + ry);

              const key = x0 + ',' + y0 + ',' + x1 + ',' + y1;
              if (key !== lastRegionKey) {
                lastRegionKey = key;
                region.x0 = x0; region.x1 = x1; region.y0 = y0; region.y1 = y1; region.set = true;
                primeRegionWork();
                schedulePumpInRegion();
              } else {
                region.set = true;
              }
              break;
            }

            case 'perf': {
              perfLevel = m.level || 'high';
              break;
            }
          }
        };
      })();`;
                                                }

                                                try {
                                                    const TileLogicEngine = TU.TileLogicEngine;
                                                    if (TileLogicEngine && !TileLogicEngine.__workerV9Installed) {
                                                        TileLogicEngine.__workerV9Installed = true;
                                                        TileLogicEngine._workerSource = buildTileLogicWorkerSourceV9;

                                                        // Upgrade running instance (if any)
                                                        const g = window.__GAME_INSTANCE__;
                                                        if (g && g.tileLogic && g.tileLogic.worker) {
                                                            try { g.tileLogic.worker.terminate(); } catch { }
                                                            g.tileLogic.worker = null;
                                                            try { g.tileLogic._initWorker && g.tileLogic._initWorker(); } catch { }
                                                        }
                                                    }
                                                } catch (e) {
                                                    console.warn('TileLogicEngine upgrade failed', e);
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 5) Light propagation: stronger shadowing for solid opaque blocks
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__shadowLightV9) {
                                                    Game.prototype.__shadowLightV9 = true;

                                                    // ═══════════════════ 光照传播优化 ═══════════════════
                                                    // 注意：OptimizedLighting 定义在此但未被实际使用
                                                    // 实际使用的是 Game.prototype._spreadLight 的下方实现
                                                    const OptimizedLighting = {
                                                        MAX_DEPTH: 15,
                                                        _lightQueue: new Int16Array(10000),
                                                        _queueHead: 0,
                                                        _queueTail: 0,

                                                        spreadLight(world, sx, sy, level) {
                                                            if (!world || !world.w || !world.h) return;
                                                            const w = world.w | 0, h = world.h | 0;
                                                            if (level <= 0 || level > this.MAX_DEPTH) return;

                                                            this._queueHead = 0;
                                                            this._queueTail = 0;

                                                            // 使用队列替代递归
                                                            this._enqueue(sx, sy, level);

                                                            let iterations = 0;
                                                            const MAX_ITERATIONS = 5000;

                                                            while (this._queueHead < this._queueTail && iterations < MAX_ITERATIONS) {
                                                                iterations++;

                                                                const x = this._lightQueue[this._queueHead++];
                                                                const y = this._lightQueue[this._queueHead++];
                                                                const l = this._lightQueue[this._queueHead++];

                                                                if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;

                                                                const colLight = world.light[x];
                                                                if (!colLight) continue;
                                                                const current = colLight[y] || 0;
                                                                if (l <= current) continue;

                                                                colLight[y] = l;

                                                                const nl = l - 1;
                                                                if (nl > 0) {
                                                                    // 检查四个方向
                                                                    const colTiles = world.tiles[x];
                                                                    const block = colTiles ? colTiles[y] : 0;
                                                                    const attenuation = (BLOCK_DATA[block] && BLOCK_DATA[block].lightAttenuation) || 1;
                                                                    const nextLevel = nl - attenuation + 1;

                                                                    if (nextLevel > 0) {
                                                                        this._enqueue(x - 1, y, nextLevel);
                                                                        this._enqueue(x + 1, y, nextLevel);
                                                                        // 防御性边界检查
                                                                        if (y - 1 >= 0 && y - 1 < h) {
                                                                            this._enqueue(x, y - 1, nextLevel);
                                                                        }
                                                                        if (y + 1 >= 0 && y + 1 < h) {
                                                                            this._enqueue(x, y + 1, nextLevel);
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        },

                                                        _enqueue(x, y, l) {
                                                            if (this._queueTail >= this._lightQueue.length - 3) return;
                                                            this._lightQueue[this._queueTail++] = x;
                                                            this._lightQueue[this._queueTail++] = y;
                                                            this._lightQueue[this._queueTail++] = l;
                                                        }
                                                    };

                                                    Game.prototype._spreadLight = function (sx, sy, level) {
                                                        const world = this.world;
                                                        if (!world) return;
                                                        const w = world.w | 0, h = world.h | 0;
                                                        const tiles = world.tiles;
                                                        const light = world.light;

                                                        if (!this._lightVisited || this._lightVisited.length !== w * h) {
                                                            this._lightVisited = new Uint32Array(w * h);
                                                            this._lightVisitMark = 1;
                                                        }

                                                        let mark = (this._lightVisitMark + 1) >>> 0;
                                                        if (mark === 0) { this._lightVisited.fill(0); mark = 1; }
                                                        this._lightVisitMark = mark;

                                                        const visited = this._lightVisited;
                                                        const qx = this._lightQx || (this._lightQx = []); const qy = this._lightQy || (this._lightQy = []); const ql = this._lightQl || (this._lightQl = []);
                                                        qx.length = 0; qy.length = 0; ql.length = 0;
                                                        let head = 0;

                                                        qx.push(sx); qy.push(sy); ql.push(level);

                                                        while (head < qx.length) {
                                                            const x = qx[head];
                                                            const y = qy[head];
                                                            const l = ql[head];
                                                            head++;

                                                            if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;
                                                            const idx = x + y * w;
                                                            if (visited[idx] === mark) continue;
                                                            visited[idx] = mark;

                                                            const colLight = light[x];
                                                            if (l > colLight[y]) colLight[y] = l;

                                                            const id = tiles[x][y] | 0;
                                                            let decay = 1;
                                                            if (SOLID[id]) decay += (TRANSP[id] ? 1 : 4);         // opaque blocks cast strong shadows
                                                            else if (LIQ[id]) decay += 2;                         // liquids attenuate a bit
                                                            else decay += 0;

                                                            const nl = l - decay;
                                                            if (nl > 0) {
                                                                qx.push(x - 1, x + 1, x, x);
                                                                qy.push(y, y, y - 1, y + 1);
                                                                ql.push(nl, nl, nl, nl);
                                                            }
                                                        }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 6) Underwater filter + deeper animated fog (applyPostFX)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__underwaterFogV9) {
                                                    Renderer.prototype.__underwaterFogV9 = true;

                                                    const prev = Renderer.prototype.applyPostFX;
                                                    Renderer.prototype._ensureFogNoise = function () {
                                                        const size = 96;
                                                        if (this._fogNoise && this._fogNoise.width === size) return;
                                                        const c = document.createElement('canvas');
                                                        c.width = c.height = size;
                                                        const ctx = c.getContext('2d', { alpha: true });
                                                        const img = ctx.createImageData(size, size);
                                                        for (let i = 0; i < img.data.length; i += 4) {
                                                            const v = (Math.random() * 255) | 0;
                                                            img.data[i] = v;
                                                            img.data[i + 1] = v;
                                                            img.data[i + 2] = v;
                                                            img.data[i + 3] = 255;
                                                        }
                                                        ctx.putImageData(img, 0, 0);
                                                        this._fogNoise = c;
                                                    };

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        if (prev) prev.call(this, time, depth01, reducedMotion);

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;

                                                        // Animated deep fog (add motion/noise so it feels alive)
                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const deep = Math.max(0, (d - 0.55) / 0.45);
                                                        if (deep > 0.01) {
                                                            this._ensureFogNoise();
                                                            const n = this._fogNoise;
                                                            const t = performance.now() * 0.00004;
                                                            const ox = ((t * 80) % n.width) | 0;
                                                            const oy = ((t * 55) % n.height) | 0;

                                                            ctx.save();
                                                            ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                            ctx.globalCompositeOperation = 'multiply';
                                                            ctx.globalAlpha = Math.min(0.22, 0.06 + deep * 0.18);

                                                            // tint base
                                                            ctx.fillStyle = `rgba(30, 40, 55, ${Math.min(0.28, 0.08 + deep * 0.20)})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            // noise overlay (scaled up)
                                                            ctx.globalCompositeOperation = 'overlay';
                                                            ctx.globalAlpha = Math.min(0.14, 0.04 + deep * 0.10);
                                                            for (let y = -1; y <= 1; y++) {
                                                                for (let x = -1; x <= 1; x++) {
                                                                    ctx.drawImage(n, ox, oy, n.width - ox, n.height - oy, x * (wPx / 2), y * (hPx / 2), wPx / 2, hPx / 2);
                                                                }
                                                            }
                                                            ctx.restore();
                                                        }

                                                        // Underwater overlay
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            const p = g && g.player;
                                                            const world = g && g.world;
                                                            const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (p && world && world.tiles) {
                                                                const tx = ((p.x + p.w * 0.5) / ts) | 0;
                                                                const ty = ((p.y + p.h * 0.6) / ts) | 0;
                                                                const inW = (tx >= 0 && ty >= 0 && tx < world.w && ty < world.h) ? (world.tiles[tx][ty] === BLOCK.WATER) : false;
                                                                if (inW) {
                                                                    ctx.save();
                                                                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                    ctx.globalCompositeOperation = 'screen';
                                                                    ctx.globalAlpha = 0.14;
                                                                    ctx.fillStyle = 'rgba(90, 170, 255, 1)';
                                                                    ctx.fillRect(0, 0, wPx, hPx);
                                                                    ctx.globalAlpha = 0.08;
                                                                    const g2 = ctx.createLinearGradient(0, 0, 0, hPx);
                                                                    g2.addColorStop(0, 'rgba(120,200,255,0.0)');
                                                                    g2.addColorStop(1, 'rgba(40,110,220,0.9)');
                                                                    ctx.fillStyle = g2;
                                                                    ctx.fillRect(0, 0, wPx, hPx);
                                                                    ctx.restore();
                                                                }
                                                            }
                                                        } catch { }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 7) Sky: biome-tinted gradients + cloud layer (Renderer.renderSky)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__cloudBiomeSkyV9) {
                                                    Renderer.prototype.__cloudBiomeSkyV9 = true;

                                                    // Palette per biome + time bucket
                                                    const SKY = {
                                                        forest: {
                                                            0: ['#0c0c1e', '#1a1a2e', '#16213e'],
                                                            1: ['#1a1a2e', '#3b2855', '#ff7b7b'],
                                                            2: ['#74b9ff', '#81ecec', '#dfe6e9'],
                                                            3: ['#6c5ce7', '#ff8fab', '#ffeaa7']
                                                        },
                                                        desert: {
                                                            0: ['#0b1022', '#1a1a2e', '#2b2a3a'],
                                                            1: ['#2b1d2f', '#7a3a2d', '#ffb37b'],
                                                            2: ['#ffcc80', '#ffd180', '#fff3e0'],
                                                            3: ['#ff8a65', '#ffb74d', '#ffeaa7']
                                                        },
                                                        snow: {
                                                            0: ['#08131f', '#102a43', '#0b1b2b'],
                                                            1: ['#16213e', '#3a6ea5', '#b3e5fc'],
                                                            2: ['#b3e5fc', '#e3f2fd', '#ffffff'],
                                                            3: ['#4f6d7a', '#9ad1d4', '#fff1c1']
                                                        }
                                                    };

                                                    // Override gradient cache: bucket + biome
                                                    Renderer.prototype._ensureSkyGradient = function (bucket) {
                                                        const biome = this._skyBiome || 'forest';
                                                        const key = biome + '|' + bucket + '|' + (this.h | 0);

                                                        const map = this._skyGradMap || (this._skyGradMap = Object.create(null));
                                                        if (map[key]) { this._skyGrad = map[key]; this._skyBucket = bucket; this._skyGradH = this.h; return; }

                                                        const ctx = this.ctx;
                                                        const colors = (SKY[biome] && SKY[biome][bucket]) ? SKY[biome][bucket] : SKY.forest[bucket];
                                                        const grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.7);
                                                        grad.addColorStop(0, colors[0]);
                                                        grad.addColorStop(0.5, colors[1]);
                                                        grad.addColorStop(1, colors[2]);
                                                        map[key] = grad;
                                                        this._skyGrad = grad;
                                                        this._skyBucket = bucket;
                                                        this._skyGradH = this.h;
                                                    };

                                                    const prevSky = Renderer.prototype.renderSky;
                                                    Renderer.prototype._ensureClouds = function () {
                                                        const want = (this.lowPower ? 8 : 16);
                                                        if (this._clouds && this._clouds.length === want) return;
                                                        const arr = [];
                                                        const w = Math.max(1, this.w | 0);
                                                        const h = Math.max(1, (this.h * 0.55) | 0);

                                                        for (let i = 0; i < want; i++) {
                                                            const seed = i * 9973;
                                                            arr.push({
                                                                x: (seed * 17) % w,
                                                                y: 20 + ((seed * 31) % h),
                                                                s: 0.6 + ((seed % 100) / 100) * 1.2,
                                                                sp: 8 + (seed % 13),
                                                                p: seed * 0.017
                                                            });
                                                        }
                                                        this._clouds = arr;
                                                    };

                                                    function cloudColor(time, biome) {
                                                        // interpolate between day and night-ish tints
                                                        const night = (typeof Utils !== 'undefined' && Utils.nightFactor) ? Utils.nightFactor(time) : ((time < 0.2 || time > 0.8) ? 1 : 0);
                                                        if (biome === 'desert') return night > 0.5 ? 'rgba(140,160,190,0.45)' : 'rgba(255,245,230,0.55)';
                                                        if (biome === 'snow') return night > 0.5 ? 'rgba(120,160,200,0.40)' : 'rgba(255,255,255,0.60)';
                                                        return night > 0.5 ? 'rgba(130,150,190,0.42)' : 'rgba(255,255,255,0.52)';
                                                    }

                                                    Renderer.prototype.renderSky = function (cam, time) {
                                                        // determine biome from camera center tile
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            const world = g && g.world;
                                                            const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                            if (world && world.w) {
                                                                const centerTileX = ((cam.x + this.w * 0.5) / ts) | 0;
                                                                this._skyBiome = Biomes.bandAt(world.w, centerTileX);
                                                            } else {
                                                                this._skyBiome = 'forest';
                                                            }
                                                        } catch { this._skyBiome = 'forest'; }

                                                        if (prevSky) prevSky.call(this, cam, time);

                                                        // cloud layer
                                                        try {
                                                            this._ensureClouds();
                                                            const ctx = this.ctx;
                                                            const biome = this._skyBiome || 'forest';
                                                            const cCol = cloudColor(time, biome);
                                                            const t = performance.now() * 0.001;

                                                            ctx.save();
                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = cCol;

                                                            for (let i = 0; i < this._clouds.length; i++) {
                                                                const c = this._clouds[i];
                                                                const speed = (c.sp * 0.35);
                                                                const px = (c.x + (t * speed) + cam.x * 0.08) % (this.w + 240);
                                                                const x = px - 120;
                                                                const y = c.y + Math.sin(t * 0.2 + c.p) * 6;

                                                                const s = 44 * c.s;
                                                                const h = 18 * c.s;

                                                                ctx.globalAlpha = 0.18 + (i % 3) * 0.06;
                                                                // puffy blobs (cheap: rect+arc)
                                                                ctx.beginPath();
                                                                ctx.ellipse(x, y, s, h, 0, 0, Math.PI * 2);
                                                                ctx.ellipse(x + s * 0.6, y + 3, s * 0.85, h * 0.95, 0, 0, Math.PI * 2);
                                                                ctx.ellipse(x - s * 0.6, y + 2, s * 0.72, h * 0.9, 0, 0, Math.PI * 2);
                                                                ctx.fill();
                                                            }
                                                            ctx.restore();
                                                        } catch { }
                                                    };
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 8) Pressure plates + Pumps (Game logic, cross-region capable)
                                                // ─────────────────────────────────────────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__machinesV9) {
                                                    Game.prototype.__machinesV9 = true;

                                                    Game.prototype._indexMachines = function () {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        const w = world.w | 0, h = world.h | 0;
                                                        const pumpsIn = [];
                                                        const pumpsOut = [];
                                                        const plates = [];

                                                        for (let x = 0; x < w; x++) {
                                                            const col = world.tiles[x];
                                                            for (let y = 0; y < h; y++) {
                                                                const id = col[y];
                                                                if (id === IDS.PUMP_IN) pumpsIn.push([x, y]);
                                                                else if (id === IDS.PUMP_OUT) pumpsOut.push([x, y]);
                                                                else if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) plates.push([x, y]);
                                                            }
                                                        }
                                                        this._machines = { pumpsIn, pumpsOut, plates };
                                                    };

                                                    Game.prototype._writeTileFast = function (x, y, id, persist) {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        if (x < 0 || y < 0 || x >= world.w || y >= world.h) return;
                                                        const old = world.tiles[x][y];
                                                        if (old === id) return;

                                                        world.tiles[x][y] = id;

                                                        // notify tilelogic worker (fluids + logic)
                                                        try { this.tileLogic && this.tileLogic.notifyTileWrite && this.tileLogic.notifyTileWrite(x, y, id); } catch { }
                                                        try { this.renderer && this.renderer.invalidateTile && this.renderer.invalidateTile(x, y); } catch { }
                                                        try { if (persist && this.saveSystem && this.saveSystem.markTile) this.saveSystem.markTile(x, y, id); } catch { }
                                                    };

                                                    Game.prototype._ensureMachineItems = function () {
                                                        try {
                                                            const inv = this.player && this.player.inventory;
                                                            if (!inv || !inv.push) return;
                                                            const has = (id) => inv.some(it => it && it.id === id);
                                                            if (!has(IDS.PUMP_IN)) inv.push({ id: IDS.PUMP_IN, name: '泵(入水口)', count: 4 });
                                                            if (!has(IDS.PUMP_OUT)) inv.push({ id: IDS.PUMP_OUT, name: '泵(出水口)', count: 4 });
                                                            if (!has(IDS.PLATE_OFF)) inv.push({ id: IDS.PLATE_OFF, name: '压力板', count: 8 });
                                                            this._deferHotbarUpdate && this._deferHotbarUpdate();
                                                        } catch { }
                                                    };

                                                    // Patch init: index machines + starter items
                                                    const _init = Game.prototype.init;
                                                    Game.prototype.init = async function () {
                                                        const r = await _init.call(this);
                                                        try { this._indexMachines(); } catch { }
                                                        try { this._ensureMachineItems(); } catch { }
                                                        return r;
                                                    };

                                                    // Pressure plate collision
                                                    Game.prototype._updatePressurePlates = function () {
                                                        const world = this.world;
                                                        const m = this._machines;
                                                        if (!world || !m || !m.plates || !m.plates.length) return;

                                                        const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;

                                                        // collect pressed positions this frame
                                                        const pressed = this._platePressed || (this._platePressed = new Set());
                                                        const next = new Set();

                                                        const markPlateUnder = (ent) => {
                                                            if (!ent) return;
                                                            const cx = (ent.x + ent.w * 0.5);
                                                            const fy = (ent.y + ent.h + 1);
                                                            const tx = (cx / ts) | 0;
                                                            const ty = (fy / ts) | 0;
                                                            if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return;
                                                            const id = world.tiles[tx][ty];
                                                            if (id === IDS.PLATE_OFF || id === IDS.PLATE_ON) {
                                                                next.add(tx + ',' + ty);
                                                            }
                                                        };

                                                        // player
                                                        markPlateUnder(this.player);

                                                        // mobs/enemies if present
                                                        try {
                                                            const ents = this.entities || this.mobs || this.enemies;
                                                            if (Array.isArray(ents)) for (let i = 0; i < ents.length; i++) markPlateUnder(ents[i]);
                                                        } catch { }

                                                        // Apply state changes (ON for pressed, OFF for released)
                                                        next.forEach((k) => {
                                                            if (pressed.has(k)) return;
                                                            pressed.add(k);
                                                            const [x, y] = k.split(',').map(n => n | 0);
                                                            this._writeTileFast(x, y, IDS.PLATE_ON, false);
                                                        });

                                                        pressed.forEach((k) => {
                                                            if (next.has(k)) return;
                                                            pressed.delete(k);
                                                            const [x, y] = k.split(',').map(n => n | 0);
                                                            this._writeTileFast(x, y, IDS.PLATE_OFF, false);
                                                        });
                                                    };

                                                    // Pump simulation (cross-region): moves water between PUMP_IN and PUMP_OUT on same wire network
                                                    Game.prototype._pumpSim = function (dtMs) {
                                                        const world = this.world;
                                                        if (!world || !world.tiles) return;
                                                        const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                        const m = this._machines;
                                                        if (!m || !m.pumpsIn || !m.pumpsOut) return;
                                                        if (!m.pumpsIn.length || !m.pumpsOut.length) return;

                                                        this._pumpAcc = (this._pumpAcc || 0) + (dtMs || 0);
                                                        if (this._pumpAcc < 220) return;
                                                        this._pumpAcc = 0;

                                                        const w = world.w | 0, h = world.h | 0;
                                                        const tiles = world.tiles;

                                                        // Visited marks for BFS
                                                        if (!this._pumpVisited || this._pumpVisited.length !== w * h) {
                                                            this._pumpVisited = new Uint32Array(w * h);
                                                            this._pumpStamp = 1;
                                                        }
                                                        let stamp = (this._pumpStamp + 1) >>> 0;
                                                        if (stamp === 0) { this._pumpVisited.fill(0); stamp = 1; }
                                                        this._pumpStamp = stamp;
                                                        const vis = this._pumpVisited;

                                                        const isWire = (id) => (id === IDS.WIRE_OFF || id === IDS.WIRE_ON);
                                                        const isSwitch = (id) => (id === IDS.SWITCH_OFF || id === IDS.SWITCH_ON || id === IDS.PLATE_OFF || id === IDS.PLATE_ON);
                                                        const isPump = (id) => (id === IDS.PUMP_IN || id === IDS.PUMP_OUT);
                                                        const isConductor = (id) => isWire(id) || isSwitch(id) || isPump(id);
                                                        const isPoweredSource = (id) => (id === IDS.SWITCH_ON || id === IDS.PLATE_ON);

                                                        const pickNeighborWater = (x, y) => {
                                                            // prefer below
                                                            const neigh = [[x, y + 1], [x - 1, y], [x + 1, y], [x, y - 1]];
                                                            for (let i = 0; i < neigh.length; i++) {
                                                                const nx = neigh[i][0], ny = neigh[i][1];
                                                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                                                                if (tiles[nx][ny] === BLOCK.WATER) return [nx, ny];
                                                            }
                                                            return null;
                                                        };
                                                        const pickNeighborOutput = (x, y) => {
                                                            const neigh = [[x, y - 1], [x + 1, y], [x - 1, y], [x, y + 1]];
                                                            for (let i = 0; i < neigh.length; i++) {
                                                                const nx = neigh[i][0], ny = neigh[i][1];
                                                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                                                                const id = tiles[nx][ny];
                                                                if (id === BLOCK.AIR) return [nx, ny];
                                                            }
                                                            return null;
                                                        };

                                                        // Process a small number of pumps per tick to keep fps stable
                                                        const budget = (this._perf && this._perf.level === 'low') ? 1 : 3;

                                                        for (let pi = 0, done = 0; pi < m.pumpsIn.length && done < budget; pi++) {
                                                            const [sx, sy] = m.pumpsIn[pi];
                                                            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                                                            if (tiles[sx][sy] !== IDS.PUMP_IN) continue;

                                                            // BFS wire network
                                                            const qx = [sx], qy = [sy];
                                                            const out = [];
                                                            let powered = false;
                                                            let nodes = 0;

                                                            const mark = (x, y) => { vis[x + y * w] = stamp; };

                                                            mark(sx, sy);

                                                            while (qx.length && nodes < 24000) {
                                                                const x = qx.pop();
                                                                const y = qy.pop();
                                                                nodes++;

                                                                const id = tiles[x][y];
                                                                if (isPoweredSource(id)) powered = true;
                                                                if (id === IDS.PUMP_OUT) out.push([x, y]);

                                                                const push = (nx, ny) => {
                                                                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
                                                                    const k = nx + ny * w;
                                                                    if (vis[k] === stamp) return;
                                                                    const tid = tiles[nx][ny];
                                                                    if (!isConductor(tid)) return;
                                                                    vis[k] = stamp;
                                                                    qx.push(nx); qy.push(ny);
                                                                };

                                                                push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
                                                            }

                                                            if (!powered || !out.length) continue;

                                                            // intake -> output water teleport
                                                            const inN = pickNeighborWater(sx, sy);
                                                            if (!inN) continue;

                                                            // pick a deterministic output (round-robin)
                                                            const rr = (this._pumpRR || 0) % out.length;
                                                            this._pumpRR = (rr + 1) | 0;
                                                            const [ox, oy] = out[rr];

                                                            const outN = pickNeighborOutput(ox, oy);
                                                            if (!outN) continue;

                                                            // move one tile of water (coarse, region independent)
                                                            this._writeTileFast(inN[0], inN[1], BLOCK.AIR, false);
                                                            this._writeTileFast(outN[0], outN[1], BLOCK.WATER, false);

                                                            done++;
                                                        }
                                                    };

                                                    const _update = Game.prototype.update;
                                                    Game.prototype.update = function (dt) {
                                                        // 防御性参数检查
                                                        if (typeof dt !== 'number' || dt < 0 || dt > 1000) {
                                                            console.warn(`[Game.update] Invalid dt: ${dt}, using default`);
                                                            dt = 16.67;
                                                        }

                                                        const r = _update.call(this, dt);
                                                        try {
                                                            if (!this._machines) this._indexMachines();
                                                            this._updatePressurePlates();
                                                            this._pumpSim(dt);
                                                            // Cave ambience for audio (depth-based)
                                                            if (this.audio && this.audio.setEnvironment) {
                                                                const ts = (CFG && CFG.TILE_SIZE) ? CFG.TILE_SIZE : 16;
                                                                const d01 = Utils.clamp((this.player.y + this.player.h * 0.6) / (this.world.h * ts), 0, 1);
                                                                // crude enclosure check: solid above head
                                                                const tx = ((this.player.x + this.player.w * 0.5) / ts) | 0;
                                                                const ty = ((this.player.y + 2) / ts) | 0;
                                                                const enclosed = (tx >= 0 && ty >= 0 && tx < this.world.w && ty < this.world.h) ? (SOLID[this.world.tiles[tx][ty]] ? 1 : 0) : 0;
                                                                this.audio.setEnvironment(d01, enclosed);
                                                            }
                                                        } catch { }
                                                        return r;
                                                    };

                                                    // Keep machine index fresh on tile changes (best-effort)
                                                    try {
                                                        const SS = window.SaveSystem;
                                                        if (SS && SS.prototype && !SS.prototype.__machineIndexPatchedV9) {
                                                            SS.prototype.__machineIndexPatchedV9 = true;
                                                            const _mark = SS.prototype.markTile;
                                                            SS.prototype.markTile = function (x, y, newId) {
                                                                const r = _mark.call(this, x, y, newId);
                                                                try {
                                                                    const g = this.game;
                                                                    if (!g) return r;
                                                                    if (!g._machines) return r;
                                                                    // Minimal: invalidate index when machine blocks changed
                                                                    if (newId === IDS.PUMP_IN || newId === IDS.PUMP_OUT || newId === IDS.PLATE_OFF || newId === IDS.PLATE_ON) g._machines = null;
                                                                } catch { }
                                                                return r;
                                                            };
                                                        }
                                                    } catch { }
                                                }

                                                // ─────────────────────────────────────────────────────────────
                                                // 9) Audio: cave reverb/echo for mining and ambience
                                                // ─────────────────────────────────────────────────────────────
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__caveReverbV9) {
                                                    AudioManager.prototype.__caveReverbV9 = true;

                                                    AudioManager.prototype._ensureCaveFx = function () {
                                                        if (!this.ctx || this._caveFx) return;
                                                        const ctx = this.ctx;

                                                        const inGain = ctx.createGain();
                                                        const dry = ctx.createGain();
                                                        const wet = ctx.createGain();

                                                        const delay = ctx.createDelay(0.35);
                                                        delay.delayTime.value = 0.12;

                                                        const fb = ctx.createGain();
                                                        fb.gain.value = 0.28;

                                                        const lp = ctx.createBiquadFilter();
                                                        lp.type = 'lowpass';
                                                        lp.frequency.value = 1800;

                                                        inGain.connect(dry);
                                                        dry.connect(ctx.destination);

                                                        inGain.connect(delay);
                                                        delay.connect(lp);
                                                        lp.connect(wet);
                                                        wet.connect(ctx.destination);

                                                        lp.connect(fb);
                                                        fb.connect(delay);

                                                        dry.gain.value = 1;
                                                        wet.gain.value = 0;

                                                        this._caveFx = { inGain, dry, wet, delay, fb, lp };
                                                    };

                                                    AudioManager.prototype.setEnvironment = function (depth01, enclosed01) {
                                                        if (!this.ctx) return;
                                                        this._ensureCaveFx();
                                                        const fx = this._caveFx;
                                                        if (!fx) return;

                                                        const d = Math.max(0, Math.min(1, +depth01 || 0));
                                                        const e = Math.max(0, Math.min(1, +enclosed01 || 0));
                                                        const cave = Math.max(0, (d - 0.42) / 0.55) * (0.65 + 0.35 * e);
                                                        this._caveAmt = cave;

                                                        const now = this.ctx.currentTime;
                                                        try { fx.wet.gain.setTargetAtTime(Math.min(0.55, cave * 0.55), now, 0.08); } catch { fx.wet.gain.value = Math.min(0.55, cave * 0.55); }
                                                        try { fx.dry.gain.setTargetAtTime(1 - Math.min(0.25, cave * 0.25), now, 0.08); } catch { fx.dry.gain.value = 1 - Math.min(0.25, cave * 0.25); }
                                                        try { fx.delay.delayTime.setTargetAtTime(0.09 + cave * 0.08, now, 0.08); } catch { fx.delay.delayTime.value = 0.09 + cave * 0.08; }
                                                        try { fx.fb.gain.setTargetAtTime(0.18 + cave * 0.18, now, 0.08); } catch { fx.fb.gain.value = 0.18 + cave * 0.18; }
                                                        try { fx.lp.frequency.setTargetAtTime(2200 - cave * 900, now, 0.08); } catch { fx.lp.frequency.value = 2200 - cave * 900; }
                                                    };

                                                    // Allow beep/noise to route through a destination node
                                                    const _beep = AudioManager.prototype.beep;
                                                    AudioManager.prototype.beep = function (freq, dur, type, vol, dest) {
                                                        if (!this.ctx) return;
                                                        const out = dest || (this._caveFx ? this._caveFx.inGain : null) || this.ctx.destination;
                                                        // re-implement lightly (avoid calling old which always connects destination)
                                                        const v = (this.settings.sfxVolume || 0) * (vol || 1);
                                                        if (v <= 0.0001) return;

                                                        const o = this.ctx.createOscillator();
                                                        o.type = type || 'sine';
                                                        o.frequency.value = freq || 440;

                                                        const g = this.ctx.createGain();
                                                        const now = this.ctx.currentTime;
                                                        g.gain.setValueAtTime(0.0001, now);
                                                        g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                                                        g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.06));

                                                        o.connect(g);
                                                        g.connect(out);

                                                        o.start(now);
                                                        o.stop(now + (dur || 0.06) + 0.02);
                                                    };

                                                    AudioManager.prototype.noise = function (dur, vol, dest) {
                                                        if (!this.ctx || !this._noiseBuf) return;
                                                        const out = dest || (this._caveFx ? this._caveFx.inGain : null) || this.ctx.destination;
                                                        const v = (this.settings.sfxVolume || 0) * (vol || 1);
                                                        if (v <= 0.0001) return;

                                                        const src = this.ctx.createBufferSource();
                                                        src.buffer = this._noiseBuf;

                                                        const g = this.ctx.createGain();
                                                        const now = this.ctx.currentTime;
                                                        g.gain.setValueAtTime(0.0001, now);
                                                        g.gain.exponentialRampToValueAtTime(v, now + 0.01);
                                                        g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.08));

                                                        src.connect(g);
                                                        g.connect(out);

                                                        src.start(now);
                                                        src.stop(now + (dur || 0.08) + 0.02);
                                                    };

                                                    // Patch play: mining gets subtle echo underground
                                                    const _play = AudioManager.prototype.play;
                                                    AudioManager.prototype.play = function (kind) {
                                                        if (!this.ctx) { try { return _play.call(this, kind); } catch { return; } }
                                                        const cave = (this._caveAmt || 0);
                                                        const dest = (cave > 0.05 && this._caveFx) ? this._caveFx.inGain : this.ctx.destination;

                                                        switch (kind) {
                                                            case 'mine':
                                                                this.noise(0.06, 0.9, dest);
                                                                this.beep(220, 0.05, 'triangle', 0.35, dest);
                                                                if (cave > 0.35) this.noise(0.03, 0.28, dest); // extra slapback
                                                                break;
                                                            default:
                                                                try { _play.call(this, kind); } catch { }
                                                        }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();