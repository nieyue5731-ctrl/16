(() => {
                                    'use strict';
                                    const TU = window.TU || {};

                                    // ───────────────────────── Game: simple dynamic weather (rain/snow) + tone
                                    const Game = TU.Game;
                                    if (Game && Game.prototype && !Game.prototype._updateWeather) {
                                        function mulberry32(a) {
                                            return function () {
                                                a |= 0;
                                                a = (a + 0x6D2B79F5) | 0;
                                                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                                                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                                                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                                            };
                                        }

                                        Game.prototype._updateWeather = function (dtMs) {
                                            const settings = this.settings || {};
                                            const reducedMotion = !!settings.reducedMotion;

                                            // 统一 dt（ms），做上限保护
                                            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() :
                                                Date.now();
                                            const dt = Math.min(1000, Math.max(0, dtMs || 0));

                                            // 初始化 weather 对象（支持：clear / rain / snow / thunder / bloodmoon）
                                            if (!this.weather) {
                                                this.weather = {
                                                    type: 'clear',
                                                    intensity: 0,
                                                    targetIntensity: 0,
                                                    nextType: 'clear',
                                                    nextIntensity: 0,
                                                    lightning: 0
                                                };
                                            }
                                            const w = this.weather;

                                            if (!Number.isFinite(w.intensity)) w.intensity = 0;
                                            if (!Number.isFinite(w.targetIntensity)) w.targetIntensity = 0;
                                            if (!Number.isFinite(w.nextIntensity)) w.nextIntensity = 0;
                                            if (!Number.isFinite(w.lightning)) w.lightning = 0;
                                            if (!w.type) w.type = 'clear';
                                            if (!w.nextType) w.nextType = w.type;

                                            // 若关闭环境粒子或减少动画：直接清空天气（并同步关闭音效/后期参数）
                                            if (reducedMotion || !settings.ambient) {
                                                w.type = 'clear';
                                                w.intensity = 0;
                                                w.targetIntensity = 0;
                                                w.nextType = 'clear';
                                                w.nextIntensity = 0;
                                                w.lightning = 0;

                                                if (document && document.body) {
                                                    document.body.classList.remove('weather-on', 'weather-rain', 'weather-snow',
                                                        'weather-thunder', 'weather-bloodmoon');
                                                }
                                                if (document && document.documentElement && document.documentElement.style) {
                                                    const st = document.documentElement.style;
                                                    st.setProperty('--weather-hue', '0deg');
                                                    st.setProperty('--weather-sat', '1');
                                                    st.setProperty('--weather-bright', '1');
                                                    st.setProperty('--weather-contrast', '1');
                                                }

                                                // 全局天气后期参数：回到默认
                                                const fx0 = window.TU_WEATHER_FX || (window.TU_WEATHER_FX = {});
                                                fx0.type = 'clear';
                                                fx0.intensity = 0;
                                                fx0.gloom = 0;
                                                fx0.lightning = 0;
                                                fx0.shadowColor = 'rgb(10,5,20)';
                                                fx0.postMode = 'source-over';
                                                fx0.postR = 0; fx0.postG = 0; fx0.postB = 0; fx0.postA = 0;

                                                // 音频（合成雨声）停用
                                                if (this.audio && typeof this.audio.updateWeatherAmbience === 'function') {
                                                    this.audio.updateWeatherAmbience(dt, w);
                                                }
                                                return;
                                            }

                                            // RNG（与 seed 绑定，保持可复现）
                                            if (!this._weatherRng) {
                                                const seed = (Number.isFinite(this.seed) ? this.seed : ((Math.random() * 1e9) | 0)) >>> 0;
                                                this._weatherRng = mulberry32(seed ^ 0x9E3779B9);
                                            }
                                            const rng = this._weatherRng;

                                            if (!this._weatherNextAt) this._weatherNextAt = now + 8000 + rng() * 12000;

                                            const t = this.timeOfDay || 0;
                                            const night = (typeof Utils !== 'undefined' && Utils.nightFactor) ? Utils.nightFactor(t) :
                                                0;

                                            // 血月：只在夜晚触发，触发后尽量持续到天亮
                                            if (w.type === 'bloodmoon') {
                                                w.nextType = 'bloodmoon';
                                                w.nextIntensity = 1;
                                                w.targetIntensity = 1;

                                                // 天亮后开始淡出到 clear
                                                if (night < 0.18) {
                                                    w.nextType = 'clear'; w.nextIntensity = 0; w.targetIntensity = 0; //
                                // 允许后续重新滚天气
 if (!this._weatherNextAt || this._weatherNextAt - now > 15000) {
                                                        this._weatherNextAt = now + 8000 + rng() * 12000;
                                                    }
                                                } else {
                                                    // 血月期间，不频繁重新决策
                                                    if (this._weatherNextAt < now) this._weatherNextAt = now + 60000;
                                                }
                                            } // 决策新的天气目标（非血月时）
 if
                                            (w.type !== 'bloodmoon' && now >= this._weatherNextAt) {
                                                // dawn/dusk 略提高下雨概率；夜晚略提高下雪概率；深夜少量概率触发血月
                                                const dawn = Math.max(0, 1 - Math.abs(t - 0.28) / 0.14);
                                                const dusk = Math.max(0, 1 - Math.abs(t - 0.72) / 0.14);

                                                let pRain = 0.10 + (dawn + dusk) * 0.10;
                                                let pSnow = 0.05 + night * 0.05;

                                                // 血月概率：只在较深夜晚才可能出现
                                                let pBlood = 0;
                                                if (night > 0.55) pBlood = Math.min(0.03, 0.022 * night);

                                                pRain = Math.min(0.28, Math.max(0, pRain));
                                                pSnow = Math.min(0.16, Math.max(0, pSnow));

                                                // 选择类型（血月优先级最高）
                                                const r = rng();
                                                let nextType = 'clear';
                                                if (pBlood > 0 && r < pBlood) { nextType = 'bloodmoon'; } else {
                                                    const rr = r - pBlood;
                                                    if (rr < pSnow) nextType = 'snow'; else if (rr < pSnow + pRain) { // 雷雨：rain
                                                        // 的一个更“压抑”的分支
 const pThunder = 0.38 + night * 0.22; nextType = (rng() < pThunder)
                                                            ? 'thunder' : 'rain';
                                                    }
                                                } const nextIntensity = (nextType === 'clear') ? 0 :
                                                    (nextType === 'bloodmoon') ? 1 : (0.25 + rng() * 0.75); w.nextType = nextType;
                                                w.nextIntensity = nextIntensity; // 换天气：先淡出，再切换类型，再淡入 if (w.type !==nextType)
                                                if (w.type !== nextType) w.targetIntensity = 0; else w.targetIntensity = nextIntensity; // 下一次变更：18~45 秒
                                                this._weatherNextAt = now + 18000 + rng() * 27000;
                                            }
                                            // 当强度足够低时允许切换类型
                                            if (w.type
                                        !== w.nextType && w.intensity < 0.04 && w.targetIntensity === 0) {
                                                w.type = w.nextType; w.targetIntensity = w.nextIntensity;
                                            }
                                            // 平滑插值强度（指数趋近，防止 dt 抖动导致跳变）
                                            const tau = 650; // ms
                                            const k = 1 - Math.exp(-dt / tau);
                                            w.intensity += (w.targetIntensity - w.intensity) * k;
                                            if (Math.abs(w.intensity) < 0.001) w.intensity = 0;
                                            // 雷雨闪电：使用极短的闪光衰减（配合后期 / 光照 LUT）
                                            if (w.type === 'thunder' && w.intensity > 0.12) {
                                                if (!w._lightningNextAt) w._lightningNextAt = now + 1200 + rng() * 2800;
                                                if (now >= w._lightningNextAt) {
                                                    w.lightning = 1;
                                                    w._lightningNextAt = now + 1800 + rng() * 6500;
                                                }
                                            }
                                            if (w.lightning > 0) {
                                                w.lightning -= dt / 220;
                                                if (w.lightning < 0) w.lightning = 0;
                                            } // 应用 UI / CSS 色调（仅 rain/snow 使用轻量 CSS
                                            // filter；血月 / 雷雨交给 Renderer 的 LUT + postFX）
 const key = w.type + ':' +
                                                Math.round(w.intensity * 100) + ':' + Math.round(w.lightning * 100); if (key
                                                    !== this._weatherAppliedKey) {
                                                        this._weatherAppliedKey = key; const
                                                            cssOn = w.intensity > 0.06 && (w.type === 'rain' || w.type === 'snow');

                                                if (document && document.body) {
                                                    document.body.classList.toggle('weather-on', cssOn);
                                                    document.body.classList.toggle('weather-rain', cssOn && w.type === 'rain');
                                                    document.body.classList.toggle('weather-snow', cssOn && w.type === 'snow');

                                                    // 新增类型：用于 DOM 粒子/状态展示（不驱动 CSS filter）
                                                    document.body.classList.toggle('weather-thunder', w.type === 'thunder' &&
                                                        w.intensity > 0.06);
                                                    document.body.classList.toggle('weather-bloodmoon', w.type === 'bloodmoon'
                                                        && w.intensity > 0.06);
                                                }

                                                if (document && document.documentElement && document.documentElement.style) {
                                                    const st = document.documentElement.style;

                                                    if (!cssOn) {
                                                        st.setProperty('--weather-hue', '0deg');
                                                        st.setProperty('--weather-sat', '1');
                                                        st.setProperty('--weather-bright', '1');
                                                        st.setProperty('--weather-contrast', '1');
                                                    } else if (w.type === 'rain') {
                                                        st.setProperty('--weather-hue', (-6 * w.intensity).toFixed(1) + 'deg');
                                                        st.setProperty('--weather-sat', (1 - 0.10 * w.intensity).toFixed(3));
                                                        st.setProperty('--weather-bright', (1 - 0.10 * w.intensity).toFixed(3));
                                                        st.setProperty('--weather-contrast', (1 + 0.10 * w.intensity).toFixed(3));
                                                    } else if (w.type === 'snow') {
                                                        st.setProperty('--weather-hue', (4 * w.intensity).toFixed(1) + 'deg');
                                                        st.setProperty('--weather-sat', (1 - 0.06 * w.intensity).toFixed(3));
                                                        st.setProperty('--weather-bright', (1 + 0.08 * w.intensity).toFixed(3));
                                                        st.setProperty('--weather-contrast', (1 + 0.06 * w.intensity).toFixed(3));
                                                    }
                                                }
                                            }

                                            // ───────────────────────── Renderer 联动参数：BLOCK_LIGHT_LUT + postProcess
                                            // 色偏（供渲染阶段读取）
                                            const fx = window.TU_WEATHER_FX || (window.TU_WEATHER_FX = {});
                                            fx.type = w.type;
                                            fx.intensity = w.intensity;
                                            fx.lightning = w.lightning;

                                            // gloom：驱动光照 LUT（越大越压抑）
                                            let gloom = 0;
                                            if (w.type === 'thunder') {
                                                gloom = 0.18 + w.intensity * 0.45;
                                            } else if (w.type === 'bloodmoon') {
                                                gloom = w.intensity * (0.25 + 0.38 * night);
                                            }
                                            // clamp 0..0.75
                                            if (gloom < 0) gloom = 0; if (gloom > 0.75) gloom = 0.75;
                                            fx.gloom = gloom;

                                            // 阴影底色（暗角遮罩用）
                                            fx.shadowColor = (w.type === 'bloodmoon') ? 'rgb(30,0,6)'
                                                : (w.type === 'thunder') ? 'rgb(6,10,22)'
                                                    : 'rgb(10,5,20)';

                                            // postFX 色偏参数（在 applyPostFX 末尾叠加）
                                            if (w.type === 'thunder') {
                                                fx.postMode = 'multiply';
                                                fx.postR = 70; fx.postG = 90; fx.postB = 125;
                                                fx.postA = Math.min(0.26, 0.08 + 0.16 * w.intensity);
                                            } else if (w.type === 'bloodmoon') {
                                                fx.postMode = 'source-over';
                                                fx.postR = 160; fx.postG = 24; fx.postB = 34;
                                                fx.postA = Math.min(0.30, 0.06 + 0.22 * w.intensity);
                                            } else {
                                                fx.postMode = 'source-over';
                                                fx.postR = 0; fx.postG = 0; fx.postB = 0; fx.postA = 0;
                                            }

                                            // 音频：合成雨声（与 rain/thunder 粒子强度同步）
                                            if (this.audio && typeof this.audio.updateWeatherAmbience ===
                                                'function') {
                                                this.audio.updateWeatherAmbience(dt, w);
                                            }
                                        };
                                    }

                                    // ───────────────────────── Inventory: PointerEvents drag & drop swap
                                    (mobile - friendly)
                                    const InventoryUI = TU.InventoryUI || window.InventoryUI;
                                    if (InventoryUI && InventoryUI.prototype &&
                                        !InventoryUI.prototype.__dragDropPatched) {
                                        const proto = InventoryUI.prototype;
                                        proto.__dragDropPatched = true;

                                        proto._slotIndexFromPoint = function (clientX, clientY) {
                                            const el = document.elementFromPoint(clientX, clientY);
                                            if (!el) return -1;
                                            const slot = el.closest ? el.closest('.inv-slot') : null;
                                            if (!slot) return -1;
                                            const idx = parseInt(slot.dataset.idx, 10);
                                            return Number.isFinite(idx) ? idx : -1;
                                        };

                                        proto._dragSetSource = function (idx) {
                                            if (this._dragSourceIdx === idx) return;
                                            if (Number.isFinite(this._dragSourceIdx) && this._slotEls &&
                                                this._slotEls[this._dragSourceIdx]) {
                                                this._slotEls[this._dragSourceIdx].classList.remove('drag-source');
                                            }
                                            this._dragSourceIdx = idx;
                                            if (Number.isFinite(idx) && this._slotEls && this._slotEls[idx]) {
                                                this._slotEls[idx].classList.add('drag-source');
                                            }
                                        };

                                        proto._dragSetTarget = function (idx) {
                                            if (this._dragTargetIdx === idx) return;
                                            if (Number.isFinite(this._dragTargetIdx) && this._slotEls &&
                                                this._slotEls[this._dragTargetIdx]) {
                                                this._slotEls[this._dragTargetIdx].classList.remove('drag-target');
                                            }
                                            this._dragTargetIdx = idx;
                                            if (Number.isFinite(idx) && idx >= 0 && this._slotEls &&
                                                this._slotEls[idx]) {
                                                this._slotEls[idx].classList.add('drag-target');
                                            }
                                        };

                                        proto._dragClear = function () {
                                            this._dragPointerId = null;
                                            this._dragMoved = false;
                                            this._dragStartX = 0;
                                            this._dragStartY = 0;
                                            this._dragStartIdx = -1;

                                            this._dragSetTarget(-1);
                                            this._dragSetSource(-1);
                                        };

                                        // Close 时清理状态
                                        if (typeof proto.close === 'function') {
                                            const _oldClose = proto.close;
                                            proto.close = function () {
                                                this._dragClear && this._dragClear();
                                                return _oldClose.call(this);
                                            };
                                        }

                                        // 绑定额外的 pointermove/up 来完成拖拽交换
                                        if (typeof proto._bind === 'function') {
                                            const _oldBind = proto._bind;
                                            proto._bind = function () {
                                                _oldBind.call(this);
                                                if (this.__dragListenersAdded) return;
                                                this.__dragListenersAdded = true;

                                                const onMove = (e) => {
                                                    if (this._dragPointerId !== e.pointerId) return;
                                                    const dx = e.clientX - this._dragStartX;
                                                    const dy = e.clientY - this._dragStartY;
                                                    if (!this._dragMoved && (dx * dx + dy * dy) > 64) this._dragMoved =
                                                        true;

                                                    const idx = this._slotIndexFromPoint(e.clientX, e.clientY);
                                                    this._dragSetTarget(idx);

                                                    if (this._dragMoved) e.preventDefault();
                                                };

                                                const onUp = (e) => {
                                                    if (this._dragPointerId !== e.pointerId) return;

                                                    const moved = !!this._dragMoved;
                                                    const targetIdx = Number.isFinite(this._dragTargetIdx) ?
                                                        this._dragTargetIdx : -1;
                                                    const startIdx = Number.isFinite(this._dragStartIdx) ?
                                                        this._dragStartIdx : -1;

                                                    this._dragClear();

                                                    // 只有“真正拖动”才触发自动落下；点击不动则沿用原逻辑（继续拿在手上）
                                                    if (moved && this._cursorItem && targetIdx >= 0 && targetIdx !==
                                                        startIdx) {
                                                        this._leftClick(targetIdx);
                                                        this._changed();
                                                    }
                                                };

                                                // 这些监听不会替换原逻辑，只补全拖拽体验
                                                this.overlay.addEventListener('pointermove', onMove, {
                                                    passive: false
                                                });
                                                this.overlay.addEventListener('pointerup', onUp, { passive: true });
                                                this.overlay.addEventListener('pointercancel', onUp, { passive: true });

                                                // 兜底：防止 pointerup 在极端情况下丢失
                                                window.addEventListener('pointerup', onUp, { passive: true });
                                                window.addEventListener('pointercancel', onUp, { passive: true });
                                            };
                                        }

                                        // Slot pointerdown：开始拖拽状态
                                        if (typeof proto._onSlotPointerDown === 'function') {
                                            const _oldDown = proto._onSlotPointerDown;
                                            proto._onSlotPointerDown = function (e) {
                                                const idx = parseInt(e.currentTarget.dataset.idx, 10);
                                                const isLeft = (e.button === 0);

                                                _oldDown.call(this, e);

                                                if (!isLeft) return;
                                                if (!this._cursorItem) return;

                                                this._dragPointerId = e.pointerId;
                                                this._dragStartX = e.clientX;
                                                this._dragStartY = e.clientY;
                                                this._dragStartIdx = idx;
                                                this._dragMoved = false;

                                                this._dragSetSource(idx);
                                                this._dragSetTarget(idx);

                                                // 尝试捕获 pointer，确保移动/抬起事件稳定
                                                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /*
                                                silently ignore */ }
                                            };
                                        }
                                    }
                                }
)();

// --- Merged from block 39 (line 17786) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'weather_lighting_audio_sync_v1',
                                            order: 50,
                                            description: "天气-光照-音频同步修复（v1）",
                                            apply: () => {
                                                const TU = window.TU || {};
                                                const AudioManager = TU.AudioManager;
                                                const Renderer = TU.Renderer;

                                                // ───────────────────────── WebAudio: real-time rain synth (sync with weather particles)
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__rainSynthInstalled) {
                                                    AudioManager.prototype.__rainSynthInstalled = true;

                                                    AudioManager.prototype._makeLoopNoiseBuffer = function (seconds) {
                                                        try {
                                                            if (!this.ctx) return null;
                                                            const ctx = this.ctx;
                                                            const sr = ctx.sampleRate || 44100;
                                                            const len = Math.max(1, (sr * (seconds || 2)) | 0);
                                                            const buf = ctx.createBuffer(1, len, sr);
                                                            const d = buf.getChannelData(0);

                                                            // white noise
                                                            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);

                                                            // fade-in/out to avoid loop clicks
                                                            const fade = Math.min((sr * 0.02) | 0, (len / 2) | 0);
                                                            for (let i = 0; i < fade; i++) {
                                                                const t = i / fade;
                                                                d[i] *= t;
                                                                d[len - 1 - i] *= t;
                                                            }
                                                            return buf;
                                                        } catch (_) {
                                                            return null;
                                                        }
                                                    };

                                                    AudioManager.prototype._startRainSynth = function () {
                                                        if (!this.ctx) return false;
                                                        const ctx = this.ctx;
                                                        if (ctx.state === 'suspended') return false;

                                                        const st = this._rainSynth || (this._rainSynth = { active: false, dropAcc: 0 });
                                                        if (st.active) return true;

                                                        if (!st.buf) st.buf = this._makeLoopNoiseBuffer(2.0);
                                                        if (!st.buf) return false;

                                                        const src = ctx.createBufferSource();
                                                        src.buffer = st.buf;
                                                        src.loop = true;

                                                        const hp = ctx.createBiquadFilter();
                                                        hp.type = 'highpass';
                                                        hp.frequency.value = 140;

                                                        const lp = ctx.createBiquadFilter();
                                                        lp.type = 'lowpass';
                                                        lp.frequency.value = 4200;

                                                        const gain = ctx.createGain();
                                                        gain.gain.value = 0;

                                                        src.connect(hp);
                                                        hp.connect(lp);
                                                        lp.connect(gain);
                                                        gain.connect(ctx.destination);

                                                        try { src.start(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        st.src = src;
                                                        st.hp = hp;
                                                        st.lp = lp;
                                                        st.gain = gain;
                                                        st.active = true;
                                                        st.dropAcc = 0;

                                                        return true;
                                                    };

                                                    AudioManager.prototype._stopRainSynth = function () {
                                                        const st = this._rainSynth;
                                                        if (!st || !st.active) return;

                                                        st.active = false;

                                                        try {
                                                            const ctx = this.ctx;
                                                            if (ctx && st.gain && st.gain.gain) {
                                                                const now = ctx.currentTime;
                                                                try { st.gain.gain.setTargetAtTime(0, now, 0.08); } catch (_) { st.gain.gain.value = 0; }
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                        const src = st.src;
                                                        const hp = st.hp, lp = st.lp, gain = st.gain;

                                                        st.src = null;
                                                        st.hp = null;
                                                        st.lp = null;
                                                        st.gain = null;

                                                        // 延迟 stop，给淡出留时间
                                                        setTimeout(() => {
                                                            try { if (src) src.stop(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (src) src.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (hp) hp.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (lp) lp.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            try { if (gain) gain.disconnect(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }, 520);
                                                    };

                                                    // 主入口：每帧调用（由 Game._updateWeather 驱动）
                                                    AudioManager.prototype.updateWeatherAmbience = function (dtMs, weather) {
                                                        const wType = (weather && weather.type) ? weather.type : 'clear';
                                                        const wInt = (weather && Number.isFinite(weather.intensity)) ? weather.intensity : 0;

                                                        const wantRain = (wInt > 0.06) && (wType === 'rain' || wType === 'thunder');
                                                        const thunder = (wType === 'thunder');

                                                        // 没有交互解锁音频时，ctx 可能不存在；这里不强行创建，等 arm() 的手势触发
                                                        if (!this.ctx || !this.enabled) {
                                                            if (!wantRain) return;
                                                            return;
                                                        }

                                                        const sv = (this.settings && Number.isFinite(this.settings.sfxVolume)) ? this.settings.sfxVolume : 0;
                                                        if (sv <= 0.001) {
                                                            // 音量为 0：确保停掉
                                                            if (this._rainSynth && this._rainSynth.active) this._stopRainSynth();
                                                            return;
                                                        }

                                                        if (!wantRain) {
                                                            if (this._rainSynth && this._rainSynth.active) this._stopRainSynth();
                                                            return;
                                                        }

                                                        if (!this._startRainSynth()) return;

                                                        const st = this._rainSynth;
                                                        if (!st || !st.active || !this.ctx) return;

                                                        const ctx = this.ctx;
                                                        const now = ctx.currentTime;

                                                        // 目标音量：与粒子强度同步（雷雨略更重一些）
                                                        const base = sv * (thunder ? 0.22 : 0.16);
                                                        const targetVol = base * Math.min(1, Math.max(0, wInt));

                                                        try { st.gain.gain.setTargetAtTime(targetVol, now, 0.08); } catch (_) { st.gain.gain.value = targetVol; }

                                                        // 过滤器：雨越大，高频越多；雷雨略加强低频/压抑感
                                                        const hpHz = 110 + wInt * (thunder ? 260 : 200);
                                                        const lpHz = 2600 + wInt * (thunder ? 5200 : 4200);

                                                        try { st.hp.frequency.setTargetAtTime(hpHz, now, 0.08); } catch (_) { st.hp.frequency.value = hpHz; }
                                                        try { st.lp.frequency.setTargetAtTime(lpHz, now, 0.08); } catch (_) { st.lp.frequency.value = lpHz; }

                                                        // 雨点：用短噪声 burst 模拟“打在叶子/地面”的颗粒感（频率与强度同步）
                                                        st.dropAcc = (st.dropAcc || 0) + (dtMs || 0);

                                                        const rate = (thunder ? 3.2 : 2.2) + wInt * (thunder ? 7.0 : 5.0); // 次/秒
                                                        const interval = 1000 / Math.max(0.8, rate);

                                                        let fired = 0;
                                                        while (st.dropAcc >= interval && fired < 4) {
                                                            st.dropAcc -= interval;
                                                            fired++;

                                                            // 避免过“嘈杂”：一定概率跳过
                                                            if (Math.random() < 0.35) continue;

                                                            const dVol = (thunder ? 0.055 : 0.045) + wInt * 0.065;
                                                            const dur = 0.018 + Math.random() * 0.03;
                                                            try { this.noise(dur, dVol); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }
                                                    };
                                                }

                                                // ───────────────────────── Renderer: postProcess 色偏叠加（血月/雷雨）
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__weatherPostTintInstalled) {
                                                    Renderer.prototype.__weatherPostTintInstalled = true;

                                                    const _orig = Renderer.prototype.applyPostFX;

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        const gs = (window.GAME_SETTINGS || {});
                                                        let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                                                        if (!Number.isFinite(mode)) mode = 2;
                                                        if (mode <= 0) return;

                                                        // 先跑原有后期（Bloom/雾化/暗角/颗粒等）
                                                        if (_orig) _orig.call(this, time, depth01, reducedMotion);

                                                        const fx = window.TU_WEATHER_FX;
                                                        if (!fx) return;

                                                        const a = Number(fx.postA) || 0;
                                                        const lightning = Number(fx.lightning) || 0;

                                                        if (a <= 0.001 && lightning <= 0.001) return;

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;

                                                        ctx.save();
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;

                                                        // 1) 色偏（压抑氛围）
                                                        if (a > 0.001) {
                                                            const r = (fx.postR | 0) & 255;
                                                            const g = (fx.postG | 0) & 255;
                                                            const b = (fx.postB | 0) & 255;
                                                            const mode2 = fx.postMode || 'source-over';

                                                            ctx.globalCompositeOperation = mode2;
                                                            ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 2) 雷雨闪电：短促 screen 叠加 + 轻微径向高光
                                                        if (lightning > 0.001) {
                                                            const f = Math.min(1, Math.max(0, lightning));

                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = `rgba(210,230,255,${(0.10 + 0.34 * f).toFixed(3)})`;
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            const cx = wPx * 0.5;
                                                            const cy = hPx * 0.45;
                                                            const r0 = Math.min(wPx, hPx) * 0.06;
                                                            const r1 = Math.max(wPx, hPx) * 0.95;

                                                            const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                            g.addColorStop(0, `rgba(255,255,255,${(0.18 * f).toFixed(3)})`);
                                                            g.addColorStop(1, 'rgba(255,255,255,0)');

                                                            ctx.fillStyle = g;
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 恢复
                                                        ctx.globalCompositeOperation = 'source-over';
                                                        try { ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        ctx.restore();
                                                    };
                                                }

                                                // ───────────────────────── Debug helper (Console)
                                                // 用法示例：
                                                //   TU.forceWeather('thunder', 1, 30000)   // 30 秒雷雨
                                                //   TU.forceWeather('bloodmoon', 1, 30000) // 30 秒血月（夜晚效果更明显）
                                                //   TU.forceWeather('clear', 0, 1)        // 清空天气
                                                if (TU && !TU.forceWeather) {
                                                    TU.forceWeather = function (type, intensity, durationMs) {
                                                        try {
                                                            const g = window.__GAME_INSTANCE__;
                                                            if (!g) return;

                                                            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                            const dur = Math.max(1, Number(durationMs) || 30000);

                                                            if (!g.weather) {
                                                                g.weather = { type: 'clear', intensity: 0, targetIntensity: 0, nextType: 'clear', nextIntensity: 0, lightning: 0 };
                                                            }

                                                            const w = g.weather;
                                                            const tt = (type || 'clear').toString();
                                                            const ii = (tt === 'clear') ? 0 : Math.min(1, Math.max(0, Number(intensity)));
                                                            w.nextType = tt;
                                                            w.nextIntensity = ii;

                                                            // 若需要换类型：先淡出
                                                            if (w.type !== tt) w.targetIntensity = 0;
                                                            else w.targetIntensity = ii;

                                                            // 延后系统随机决策
                                                            g._weatherNextAt = now + dur;

                                                            // 若强制 clear：直接清空 lightning
                                                            if (tt === 'clear') {
                                                                w.lightning = 0;
                                                                w._lightningNextAt = 0;
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 40 (line 18091) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'weather_canvas_fx_perf_v1',
                                            order: 60,
                                            description: "天气 Canvas 特效与性能优化（v1）",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || (window.TU = {});
                                                const Game = TU.Game;
                                                const Renderer = TU.Renderer;

                                                // ───────────────────────── CSS: add weather overlay canvas + disable expensive CSS filter on #game
                                                try {
                                                    const style = document.createElement('style');
                                                    style.setAttribute('data-tu-patch', 'weather_canvas_fx_perf_v1');
                                                    style.textContent = `
            #weatherfx{
              position: fixed;
              top: 0; left: 0;
              width: 100%; height: 100%;
              pointer-events: none;
              z-index: 55; /* above ambient particles (50), below UI (100) */
            }
            .reduced-motion #weatherfx{ display:none !important; }
            body.weather-on #game{ filter:none !important; }
          `;
                                                    document.head && document.head.appendChild(style);
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // ───────────────────────── Ensure overlay canvas exists
                                                function ensureWeatherCanvas() {
                                                    // DOM-less offscreen canvas: avoid extra overlay layer & DOM reflow
                                                    let c = (window.TU && TU.__weatherfxCanvas) || null;
                                                    if (c) return c;
                                                    c = document.createElement('canvas'); // offscreen (NOT appended)
                                                    c.width = 1; c.height = 1;
                                                    if (window.TU) TU.__weatherfxCanvas = c;
                                                    return c;
                                                }

                                                // ───────────────────────── WeatherCanvasFX: fast rain/snow + lightning on a single canvas
                                                class WeatherCanvasFX {
                                                    constructor(canvas) {
                                                        this.canvas = canvas;
                                                        this.ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null;

                                                        this._wPx = 0;
                                                        this._hPx = 0;
                                                        this._wCss = 0;
                                                        this._hCss = 0;
                                                        this._dpr = 1;

                                                        this._lastNow = 0;
                                                        this._hadFx = false;

                                                        // deterministic-ish RNG (xorshift32) to reduce Math.random usage during generation
                                                        this._seed = 0x12345678;

                                                        // Rain / snow pattern buffers (offscreen)
                                                        this._rain = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                        this._snow = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };

                                                        // Lightning flash gradient cache (depends on resolution only)
                                                        this._flash = { w: 0, h: 0, grad: null };

                                                        // Lightning bolt (reused object + typed array)
                                                        this._bolt = { pts: null, n: 0, life: 0, maxLife: 0 };
                                                        this._prevLightning = 0;
                                                    }

                                                    _rand01() {
                                                        // xorshift32
                                                        let x = this._seed | 0;
                                                        x ^= (x << 13);
                                                        x ^= (x >>> 17);
                                                        x ^= (x << 5);
                                                        this._seed = x | 0;
                                                        return ((x >>> 0) / 4294967296);
                                                    }

                                                    _makeOffscreenCanvas(w, h) {
                                                        try {
                                                            if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        const c = document.createElement('canvas');
                                                        c.width = w; c.height = h;
                                                        return c;
                                                    }

                                                    resizeLike(renderer) {
                                                        if (!renderer || !renderer.canvas || !this.canvas || !this.ctx) return;
                                                        const wPx = renderer.canvas.width | 0;
                                                        const hPx = renderer.canvas.height | 0;

                                                        // renderer.w/h are CSS px viewport units used by the game
                                                        const wCss = (renderer.w | 0) || Math.round(window.innerWidth || 0);
                                                        const hCss = (renderer.h | 0) || Math.round(window.innerHeight || 0);

                                                        const dpr = Number(renderer.dpr) || (window.devicePixelRatio || 1);

                                                        const sizeChanged = (this.canvas.width !== wPx) || (this.canvas.height !== hPx);

                                                        if (sizeChanged) {
                                                            this.canvas.width = wPx;
                                                            this.canvas.height = hPx;
                                                            this.canvas.style.width = wCss + 'px';
                                                            this.canvas.style.height = hCss + 'px';

                                                            this._wPx = wPx; this._hPx = hPx;
                                                            this._wCss = wCss; this._hCss = hCss;
                                                            this._dpr = dpr;

                                                            // invalidate caches on resize
                                                            this._rain.pattern = null;
                                                            this._rain.tile = null;
                                                            this._snow.pattern = null;
                                                            this._snow.tile = null;
                                                            this._flash.grad = null;
                                                            this._flash.w = 0; this._flash.h = 0;
                                                        } else {
                                                            this._wPx = wPx; this._hPx = hPx;
                                                            this._wCss = wCss; this._hCss = hCss;
                                                            this._dpr = dpr;
                                                        }

                                                        // Always render in pixel space (identity transform) for predictable pattern scrolling
                                                        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        // Keep smoothing on for nicer rain streaks; it mainly affects drawImage scaling.
                                                        try { this.ctx.imageSmoothingEnabled = true; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }

                                                    _ensureRainPattern() {
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        // Choose tile size by DPR for fewer repeats
                                                        const tile = (this._dpr > 1.25) ? 512 : 256;
                                                        if (this._rain.pattern && this._rain.size === tile) return;

                                                        const c = this._makeOffscreenCanvas(tile, tile);
                                                        const g = c.getContext('2d', { alpha: true });
                                                        if (!g) return;

                                                        // draw rain streaks onto tile (one-time cost)
                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        g.lineCap = 'round';
                                                        g.lineJoin = 'round';

                                                        const drops = Math.round((tile * tile) / 2600); // density knob (higher = denser)
                                                        const angle = 12 * Math.PI / 180;
                                                        const sx = Math.sin(angle);
                                                        const cy = Math.cos(angle);

                                                        // two passes: thin + thick for variation
                                                        for (let pass = 0; pass < 2; pass++) {
                                                            g.lineWidth = pass === 0 ? 1 : 2;
                                                            g.strokeStyle = pass === 0 ? 'rgba(180,220,255,0.55)' : 'rgba(180,220,255,0.35)';

                                                            const n = pass === 0 ? drops : Math.round(drops * 0.35);
                                                            for (let i = 0; i < n; i++) {
                                                                const x = this._rand01() * tile;
                                                                const y = this._rand01() * tile;

                                                                const len = (8 + this._rand01() * 22) * (pass === 0 ? 1 : 1.2);
                                                                const dx = sx * len;
                                                                const dy = cy * len;

                                                                const a = pass === 0
                                                                    ? (0.10 + this._rand01() * 0.22)
                                                                    : (0.06 + this._rand01() * 0.16);

                                                                g.globalAlpha = a;
                                                                g.beginPath();
                                                                g.moveTo(x, y);
                                                                g.lineTo(x + dx, y + dy);
                                                                g.stroke();
                                                            }
                                                        }

                                                        g.globalAlpha = 1;

                                                        // pattern is tied to output ctx
                                                        const p = ctxOut.createPattern(c, 'repeat');
                                                        if (!p) return;

                                                        this._rain.tile = c;
                                                        this._rain.ctx = g;
                                                        this._rain.pattern = p;
                                                        this._rain.size = tile;
                                                        this._rain.ox = 0;
                                                        this._rain.oy = 0;
                                                    }

                                                    _ensureSnowPattern() {
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        const tile = (this._dpr > 1.25) ? 384 : 256;
                                                        if (this._snow.pattern && this._snow.size === tile) return;

                                                        const c = this._makeOffscreenCanvas(tile, tile);
                                                        const g = c.getContext('2d', { alpha: true });
                                                        if (!g) return;

                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        const flakes = Math.round((tile * tile) / 5200);
                                                        g.fillStyle = 'rgba(255,255,255,0.9)';
                                                        for (let i = 0; i < flakes; i++) {
                                                            const x = this._rand01() * tile;
                                                            const y = this._rand01() * tile;
                                                            const r = 0.8 + this._rand01() * 1.8;
                                                            const a = 0.10 + this._rand01() * 0.35;

                                                            g.globalAlpha = a;
                                                            g.beginPath();
                                                            g.arc(x, y, r, 0, Math.PI * 2);
                                                            g.fill();
                                                        }
                                                        g.globalAlpha = 1;

                                                        const p = ctxOut.createPattern(c, 'repeat');
                                                        if (!p) return;

                                                        this._snow.tile = c;
                                                        this._snow.ctx = g;
                                                        this._snow.pattern = p;
                                                        this._snow.size = tile;
                                                        this._snow.ox = 0;
                                                        this._snow.oy = 0;
                                                    }

                                                    drawRain(intensity, dtMs, isThunder) {
                                                        if (!this.ctx) return;
                                                        this._ensureRainPattern();
                                                        if (!this._rain.pattern) return;

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = this._rain.size | 0;

                                                        // Speed in px/s, scaled by DPR for consistent look
                                                        const base = (isThunder ? 1400 : 1100) * this._dpr;
                                                        const speed = base * (0.55 + 0.85 * Math.min(1, Math.max(0, intensity)));

                                                        const dt = (dtMs || 0) / 1000;
                                                        // scroll diagonally to match streak angle
                                                        this._rain.oy = (this._rain.oy + speed * dt) % tile;
                                                        this._rain.ox = (this._rain.ox + speed * 0.18 * dt) % tile;

                                                        const ox = this._rain.ox;
                                                        const oy = this._rain.oy;

                                                        // Density & alpha: draw one or two layers (still just 1–2 fillRect calls)
                                                        const aBase = (0.10 + 0.28 * intensity) * (isThunder ? 1.10 : 1.0);

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = this._rain.pattern;

                                                        // Far layer (subtle)
                                                        ctx.globalAlpha = aBase * 0.55;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.65, -oy * 0.65);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Reset
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    }

                                                    drawSnow(intensity, dtMs) {
                                                        if (!this.ctx) return;
                                                        this._ensureSnowPattern();
                                                        if (!this._snow.pattern) return;

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = this._snow.size | 0;

                                                        const dt = (dtMs || 0) / 1000;

                                                        // Slow fall + gentle drift
                                                        const fall = (180 + 240 * intensity) * this._dpr;
                                                        const drift = (40 + 80 * intensity) * this._dpr;

                                                        this._snow.oy = (this._snow.oy + fall * dt) % tile;
                                                        this._snow.ox = (this._snow.ox + drift * dt) % tile;

                                                        const ox = this._snow.ox;
                                                        const oy = this._snow.oy;

                                                        const aBase = 0.08 + 0.22 * intensity;

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = this._snow.pattern;

                                                        // Far layer (less alpha, slower)
                                                        ctx.globalAlpha = aBase * 0.50;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.55, -oy * 0.55);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    }

                                                    _ensureFlashGradient() {
                                                        const ctx = this.ctx;
                                                        if (!ctx) return;

                                                        const w = this._wPx | 0;
                                                        const h = this._hPx | 0;

                                                        if (this._flash.grad && this._flash.w === w && this._flash.h === h) return;

                                                        const cx = w * 0.5;
                                                        const cy = h * 0.45;
                                                        const r0 = Math.min(w, h) * 0.06;
                                                        const r1 = Math.max(w, h) * 0.95;

                                                        const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                        g.addColorStop(0, 'rgba(255,255,255,1)');
                                                        g.addColorStop(1, 'rgba(255,255,255,0)');

                                                        this._flash.grad = g;
                                                        this._flash.w = w;
                                                        this._flash.h = h;
                                                    }

                                                    _spawnBolt() {
                                                        const w = this._wPx | 0;
                                                        const h = this._hPx | 0;
                                                        if (w <= 0 || h <= 0) return;

                                                        const segs = 18;
                                                        if (!this._bolt.pts || this._bolt.pts.length !== segs * 2) {
                                                            this._bolt.pts = new Float32Array(segs * 2);
                                                        }

                                                        let x = w * (0.22 + this._rand01() * 0.56);
                                                        let y = -h * 0.05;
                                                        const stepY = (h * 1.08) / (segs - 1);
                                                        let amp = w * 0.10;

                                                        const pts = this._bolt.pts;
                                                        for (let i = 0; i < segs; i++) {
                                                            pts[i * 2] = x;
                                                            pts[i * 2 + 1] = y;

                                                            y += stepY;
                                                            x += (this._rand01() - 0.5) * amp;
                                                            amp *= 0.82;
                                                        }

                                                        this._bolt.n = segs;
                                                        this._bolt.maxLife = 120 + (this._rand01() * 80); // ms
                                                        this._bolt.life = this._bolt.maxLife;
                                                    }

                                                    drawLightning(lightning, dtMs) {
                                                        if (!this.ctx) return;
                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;

                                                        const f = Math.min(1, Math.max(0, Number(lightning) || 0));
                                                        if (f <= 0.001) return;

                                                        // Rising edge: spawn a visible bolt sometimes
                                                        if (f > 0.75 && this._prevLightning <= 0.12) {
                                                            this._spawnBolt();
                                                        }

                                                        // 1) Flash overlay (cheap): 2 fillRect, cached gradient, no string allocations per frame
                                                        this._ensureFlashGradient();

                                                        ctx.globalCompositeOperation = 'screen';

                                                        // Full-screen cool flash
                                                        ctx.globalAlpha = 0.10 + 0.34 * f;
                                                        ctx.fillStyle = 'rgb(210,230,255)';
                                                        ctx.fillRect(0, 0, w, h);

                                                        // Radial highlight
                                                        if (this._flash.grad) {
                                                            ctx.globalAlpha = 0.18 * f;
                                                            ctx.fillStyle = this._flash.grad;
                                                            ctx.fillRect(0, 0, w, h);
                                                        }

                                                        // 2) Bolt (optional, short-lived)
                                                        if (this._bolt && this._bolt.life > 0 && this._bolt.pts && this._bolt.n >= 2) {
                                                            const dt = Math.max(0, Number(dtMs) || 0);
                                                            this._bolt.life = Math.max(0, this._bolt.life - dt);

                                                            const life01 = this._bolt.maxLife > 0 ? (this._bolt.life / this._bolt.maxLife) : 0;
                                                            if (life01 > 0.001) {
                                                                const pts = this._bolt.pts;
                                                                const n = this._bolt.n;

                                                                ctx.lineCap = 'round';
                                                                ctx.lineJoin = 'round';

                                                                ctx.beginPath();
                                                                ctx.moveTo(pts[0], pts[1]);
                                                                for (let i = 1; i < n; i++) {
                                                                    const j = i * 2;
                                                                    ctx.lineTo(pts[j], pts[j + 1]);
                                                                }

                                                                const s = (this._dpr || 1);

                                                                // Outer glow-ish stroke (no shadowBlur to keep it cheap)
                                                                ctx.globalAlpha = 0.10 * f * life01;
                                                                ctx.strokeStyle = 'rgb(140,190,255)';
                                                                ctx.lineWidth = 5.5 * s;
                                                                ctx.stroke();

                                                                // Core stroke
                                                                ctx.globalAlpha = 0.70 * f * life01;
                                                                ctx.strokeStyle = 'rgb(255,255,255)';
                                                                ctx.lineWidth = 1.8 * s;
                                                                ctx.stroke();
                                                            }
                                                        }

                                                        // reset minimal states
                                                        ctx.globalAlpha = 1;
                                                        ctx.globalCompositeOperation = 'source-over';
                                                    }

                                                    render(weather, renderer) {
                                                        if (!this.ctx || !this.canvas) return;

                                                        // Respect reduced-motion: hide & clear once
                                                        const reduced = !!(document.documentElement && document.documentElement.classList.contains('reduced-motion'));
                                                        if (reduced) {
                                                            if (this._hadFx) {
                                                                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                this.ctx.clearRect(0, 0, this._wPx || this.canvas.width, this._hPx || this.canvas.height);
                                                                this._hadFx = false;
                                                            }
                                                            return;
                                                        }

                                                        this.resizeLike(renderer);

                                                        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                        let dtMs = now - (this._lastNow || now);
                                                        if (!Number.isFinite(dtMs)) dtMs = 0;
                                                        if (dtMs < 0) dtMs = 0;
                                                        if (dtMs > 200) dtMs = 200;
                                                        this._lastNow = now;

                                                        const w = weather || {};
                                                        const type = (w.type || 'clear').toString();
                                                        const intensity = Number(w.intensity) || 0;
                                                        const lightning = Number(w.lightning) || 0;

                                                        // If nothing to draw, clear once then stop touching the canvas (saves fill-rate)
                                                        if (intensity <= 0.001 && lightning <= 0.001) {
                                                            if (this._hadFx) {
                                                                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                                this.ctx.clearRect(0, 0, this._wPx, this._hPx);
                                                                this._hadFx = false;
                                                            }
                                                            this._prevLightning = lightning;
                                                            return;
                                                        }

                                                        this._hadFx = true;

                                                        // Clear overlay each frame when active (transparent canvas)
                                                        const ctx = this.ctx;
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.clearRect(0, 0, this._wPx, this._hPx);

                                                        if ((type === 'rain' || type === 'thunder') && intensity > 0.01) {
                                                            this.drawRain(intensity, dtMs, type === 'thunder');
                                                        } else if (type === 'snow' && intensity > 0.01) {
                                                            this.drawSnow(intensity, dtMs);
                                                        }

                                                        if (lightning > 0.001) {
                                                            this.drawLightning(lightning, dtMs);
                                                        } else if (this._bolt && this._bolt.life > 0) {
                                                            // Let bolt fade out naturally even if lightning param drops fast
                                                            this.drawLightning(Math.max(0, this._prevLightning * 0.8), dtMs);
                                                        }

                                                        this._prevLightning = lightning;
                                                    }
                                                }

                                                TU.WeatherCanvasFX = WeatherCanvasFX;

                                                // ───────────────────────── AmbientParticles: fix missing container + skip rain/snow DOM particles (we draw on canvas)
                                                const AP = TU.AmbientParticles;
                                                if (AP && AP.prototype && !AP.prototype.__weatherCanvasFxInstalled) {
                                                    AP.prototype.__weatherCanvasFxInstalled = true;
                                                    const _oldUpdate = AP.prototype.update;

                                                    AP.prototype.update = function (timeOfDay, weather) {
                                                        // Hotfix: Game 构造时没传 containerId，导致 container 为 null
                                                        if (!this.container) this.container = document.getElementById('ambient-particles');
                                                        if (!this.container) return;

                                                        const w = weather || {};
                                                        const t = w.type;
                                                        const it = Number(w.intensity) || 0;

                                                        // rain/snow/thunder：改为 canvas 绘制，DOM 粒子直接关闭，避免大量节点/动画导致卡顿 + GC
                                                        if ((t === 'rain' || t === 'snow' || t === 'thunder') && it > 0.05) {
                                                            if (this.mode !== 'none' || (this.particles && this.particles.length)) {
                                                                try { this._clearAll(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                            this.mode = 'none';
                                                            return;
                                                        }

                                                        return _oldUpdate.call(this, timeOfDay, weather);
                                                    };
                                                }

                                                // ───────────────────────── Weather color grading: move rain/snow tone into Canvas PostFX tint (offscreen pipeline)
                                                // We keep the original weather system, but override the post tint params after its update.
                                                if (Game && Game.prototype && !Game.prototype.__weatherCanvasFxPostTint) {
                                                    Game.prototype.__weatherCanvasFxPostTint = true;
                                                    const _oldWeather = Game.prototype._updateWeather;

                                                    if (typeof _oldWeather === 'function') {
                                                        Game.prototype._updateWeather = function (dtMs) {
                                                            _oldWeather.call(this, dtMs);

                                                            const w = this.weather || {};
                                                            const fx = window.TU_WEATHER_FX || (window.TU_WEATHER_FX = {});

                                                            // Only override for rain/snow (thunder/bloodmoon already managed by the original patch)
                                                            if (w && w.intensity > 0.06) {
                                                                if (w.type === 'rain') {
                                                                    // Slight cool/dim, like wet weather; multiply darkens and shifts
                                                                    fx.postMode = 'multiply';
                                                                    fx.postR = 110;
                                                                    fx.postG = 125;
                                                                    fx.postB = 155;
                                                                    fx.postA = Math.min(0.22, 0.05 + 0.14 * w.intensity);
                                                                } else if (w.type === 'snow') {
                                                                    // Slight cool brightening; screen lightens gently
                                                                    fx.postMode = 'screen';
                                                                    fx.postR = 210;
                                                                    fx.postG = 228;
                                                                    fx.postB = 255;
                                                                    fx.postA = Math.min(0.20, 0.04 + 0.12 * w.intensity);
                                                                }
                                                            }
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── Renderer: optimize weather tint + lightning flash overlay to reduce allocations & state churn
                                                if (Renderer && Renderer.prototype && !Renderer.prototype.__weatherPostTintOptimizedV2) {
                                                    Renderer.prototype.__weatherPostTintOptimizedV2 = true;

                                                    const prev = Renderer.prototype.applyPostFX;

                                                    Renderer.prototype.applyPostFX = function (time, depth01, reducedMotion) {
                                                        // Respect postFxMode like original wrapper
                                                        const gs = (window.GAME_SETTINGS || {});
                                                        let mode = (typeof gs.__postFxModeEffective === 'number') ? gs.__postFxModeEffective : Number(gs.postFxMode);
                                                        if (!Number.isFinite(mode)) mode = 2;

                                                        const fx = window.TU_WEATHER_FX;
                                                        let a = 0, lightning = 0, r = 0, g = 0, b = 0, comp = 'source-over';

                                                        if (fx) {
                                                            a = Number(fx.postA) || 0;
                                                            lightning = Number(fx.lightning) || 0;
                                                            r = (fx.postR | 0) & 255;
                                                            g = (fx.postG | 0) & 255;
                                                            b = (fx.postB | 0) & 255;
                                                            comp = fx.postMode || 'source-over';
                                                        }

                                                        // Temporarily disable the older weather wrapper (so we don't double-apply)
                                                        let restoreA = null, restoreL = null;
                                                        if (fx && (a > 0.001 || lightning > 0.001)) {
                                                            restoreA = fx.postA;
                                                            restoreL = fx.lightning;
                                                            fx.postA = 0;
                                                            fx.lightning = 0;
                                                        }

                                                        // Run original postFX pipeline
                                                        if (prev) prev.call(this, time, depth01, reducedMotion);

                                                        // Restore fx params for the rest of the game
                                                        if (fx && restoreA !== null) {
                                                            fx.postA = restoreA;
                                                            fx.lightning = restoreL;
                                                        }

                                                        // If postFx is off, keep behavior consistent (no extra tint)
                                                        if (mode <= 0) return;

                                                        if (a <= 0.001 && lightning <= 0.001) return;

                                                        const ctx = this.ctx;
                                                        const canvas = this.canvas;
                                                        if (!ctx || !canvas) return;

                                                        const wPx = canvas.width | 0;
                                                        const hPx = canvas.height | 0;

                                                        // Cache to avoid per-frame string/gradient allocations
                                                        const cache = this._weatherPostCache || (this._weatherPostCache = {});
                                                        if (cache.w !== wPx || cache.h !== hPx) {
                                                            cache.w = wPx; cache.h = hPx;

                                                            // lightning radial gradient (alpha handled via globalAlpha)
                                                            const cx = wPx * 0.5;
                                                            const cy = hPx * 0.45;
                                                            const r0 = Math.min(wPx, hPx) * 0.06;
                                                            const r1 = Math.max(wPx, hPx) * 0.95;
                                                            const lg = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                                                            lg.addColorStop(0, 'rgba(255,255,255,1)');
                                                            lg.addColorStop(1, 'rgba(255,255,255,0)');
                                                            cache.lg = lg;
                                                        }

                                                        // tint color string cache
                                                        if (cache.r !== r || cache.g !== g || cache.b !== b) {
                                                            cache.r = r; cache.g = g; cache.b = b;
                                                            cache.tintRGB = `rgb(${r},${g},${b})`;
                                                        }

                                                        ctx.save();
                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);

                                                        // 1) Color tint overlay (use globalAlpha + rgb() to avoid rgba() string churn)
                                                        if (a > 0.001) {
                                                            ctx.globalCompositeOperation = comp;
                                                            ctx.globalAlpha = a;
                                                            ctx.fillStyle = cache.tintRGB || 'rgb(0,0,0)';
                                                            ctx.fillRect(0, 0, wPx, hPx);
                                                        }

                                                        // 2) Lightning flash (screen + cached gradient)
                                                        if (lightning > 0.001) {
                                                            const f = Math.min(1, Math.max(0, lightning));

                                                            ctx.globalCompositeOperation = 'screen';

                                                            // Fullscreen flash
                                                            ctx.globalAlpha = 0.10 + 0.34 * f;
                                                            ctx.fillStyle = 'rgb(210,230,255)';
                                                            ctx.fillRect(0, 0, wPx, hPx);

                                                            // Radial highlight
                                                            if (cache.lg) {
                                                                ctx.globalAlpha = 0.18 * f;
                                                                ctx.fillStyle = cache.lg;
                                                                ctx.fillRect(0, 0, wPx, hPx);
                                                            }
                                                        }

                                                        // Reset
                                                        ctx.globalAlpha = 1;
                                                        ctx.globalCompositeOperation = 'source-over';
                                                        try { ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        ctx.restore();
                                                    };
                                                }

                                                // ───────────────────────── Game.render: draw weather overlay after main render/postFX (keeps rain cheap, avoids DOM particles)
                                                if (Game && Game.prototype && !Game.prototype.__weatherCanvasFxRenderInstalled) {
                                                    Game.prototype.__weatherCanvasFxRenderInstalled = true;

                                                    const _oldRender = Game.prototype.render;

                                                    Game.prototype.render = function () {
                                                        _oldRender.call(this);

                                                        // Lazy init overlay
                                                        if (!this._weatherCanvasFx) {
                                                            try {
                                                                const c = ensureWeatherCanvas();
                                                                this._weatherCanvasFx = new TU.WeatherCanvasFX(c);
                                                            } catch (_) {
                                                                this._weatherCanvasFx = null;
                                                            }
                                                        }

                                                        if (!this._weatherCanvasFx) return;

                                                        // Render overlay
                                                        try {
                                                            this._weatherCanvasFx.render(this.weather, this.renderer);

                                                            try {
                                                                const __c = this._weatherCanvasFx && this._weatherCanvasFx.canvas;
                                                                const __r = this.renderer;
                                                                if (__c && __r && __r.ctx) __r.ctx.drawImage(__c, 0, 0, __r.w, __r.h);
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 41 (line 18817) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_experience_optimizations_v3',
                                            order: 70,
                                            description: "体验优化（v3）",
                                            apply: () => {
                                                const TU = window.TU || {};
                                                const Game = TU.Game;
                                                const InputManager = TU.InputManager;
                                                const AudioManager = TU.AudioManager;

                                                // ───────────────────────── 1) Dispatch tu:gameReady after init completes ─────────────────────────
                                                if (Game && Game.prototype && !Game.prototype.__tuGameReadyEvent) {
                                                    Game.prototype.__tuGameReadyEvent = true;
                                                    const _init = Game.prototype.init;
                                                    if (typeof _init === 'function') {
                                                        Game.prototype.init = async function (...args) {
                                                            const r = await _init.apply(this, args);
                                                            try {
                                                                document.dispatchEvent(new CustomEvent('tu:gameReady', { detail: { game: this } }));
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── 2) Input safety + mouse wheel hotbar (desktop QoL) ─────────────────────────
                                                if (InputManager && InputManager.prototype && !InputManager.prototype.__tuInputSafety) {
                                                    InputManager.prototype.__tuInputSafety = true;
                                                    const _bind = InputManager.prototype.bind;

                                                    InputManager.prototype.bind = function (...args) {
                                                        if (typeof _bind === 'function') _bind.apply(this, args);

                                                        if (this.__tuExtraBound) return;
                                                        this.__tuExtraBound = true;

                                                        const game = this.game;

                                                        const resetKeys = () => {
                                                            if (!game || !game.input) return;
                                                            game.input.left = false;
                                                            game.input.right = false;
                                                            game.input.jump = false;
                                                            game.input.sprint = false;
                                                        };
                                                        const resetMouseButtons = () => {
                                                            if (!game || !game.input) return;
                                                            game.input.mouseLeft = false;
                                                            game.input.mouseRight = false;
                                                        };
                                                        const resetAll = () => { resetKeys(); resetMouseButtons(); };

                                                        // Window blur/tab switch: avoid “stuck key/button”
                                                        window.addEventListener('blur', resetAll, { passive: true });
                                                        document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll(); }, { passive: true });

                                                        // Mouse leaves canvas: clear mouse buttons to avoid “stuck mining/placing”
                                                        if (game && game.canvas) {
                                                            game.canvas.addEventListener('mouseleave', resetMouseButtons, { passive: true });
                                                        }
                                                        // Mouse up anywhere: clear buttons even if released outside canvas
                                                        window.addEventListener('mouseup', resetMouseButtons, { passive: true });

                                                        // Mouse wheel: switch hotbar slot (1..9)
                                                        const onWheel = (e) => {
                                                            if (e.ctrlKey) return; // allow browser zoom / trackpad pinch
                                                            const g = game || window.__GAME_INSTANCE__;
                                                            if (!g || !g.ui || !g.player) return;

                                                            // If UI modal open, do nothing
                                                            const modal = (g.inventoryUI && g.inventoryUI.isOpen) ||
                                                                (g.crafting && g.crafting.isOpen) ||
                                                                g.paused || g._inputBlocked;
                                                            if (modal) return;

                                                            const dx = Number(e.deltaX) || 0;
                                                            const dy = Number(e.deltaY) || 0;
                                                            const delta = (Math.abs(dy) >= Math.abs(dx)) ? dy : dx;

                                                            // Ignore tiny noise
                                                            if (!delta || Math.abs(delta) < 1) return;

                                                            e.preventDefault();

                                                            const dir = delta > 0 ? 1 : -1;
                                                            const size = 9;

                                                            const cur = (Number.isFinite(g.player.selectedSlot) ? g.player.selectedSlot : 0) | 0;
                                                            const next = (cur + dir + size) % size;
                                                            try { g.ui.selectSlot(next); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };

                                                        if (game && game.canvas && !game.canvas.__tuWheelBound) {
                                                            game.canvas.__tuWheelBound = true;
                                                            game.canvas.addEventListener('wheel', onWheel, { passive: false });
                                                        }
                                                    };
                                                }

                                                // ───────────────────────── 3) Low-power CSS: reduce expensive UI effects ─────────────────────────
                                                const ensureLowPowerCSS = () => {
                                                    if (document.getElementById('tu-low-power-css')) return;
                                                    const style = document.createElement('style');
                                                    style.id = 'tu-low-power-css';
                                                    style.textContent = `
            /* Low power mode: reduce expensive backdrop-filter / shadows / animations */
            html.low-power *, html.low-power *::before, html.low-power *::after {
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
            }
            html.low-power .shimmer,
            html.low-power .pulse,
            html.low-power .sparkle,
            html.low-power .floating,
            html.low-power .glow {
              animation: none !important;
            }
            html.low-power #ambient-particles {
              opacity: 0.5 !important;
              filter: none !important;
            }
          `;
                                                    document.head.appendChild(style);
                                                };

                                                if (Game && Game.prototype && !Game.prototype.__tuLowPowerCssHook) {
                                                    Game.prototype.__tuLowPowerCssHook = true;
                                                    ensureLowPowerCSS();

                                                    const _setQuality = Game.prototype._setQuality;
                                                    if (typeof _setQuality === 'function') {
                                                        Game.prototype._setQuality = function (level) {
                                                            const r = _setQuality.call(this, level);
                                                            try {
                                                                document.documentElement.classList.toggle('low-power', level === 'low');
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── 4) Weather ambience audio: enable flag fix + suspend on hidden ─────────────────────────
                                                if (AudioManager && AudioManager.prototype && !AudioManager.prototype.__tuAudioVisPatch) {
                                                    AudioManager.prototype.__tuAudioVisPatch = true;

                                                    // Fix: updateWeatherAmbience uses this.enabled, but base AudioManager doesn't define it
                                                    if (typeof AudioManager.prototype.updateWeatherAmbience === 'function') {
                                                        const _ua = AudioManager.prototype.updateWeatherAmbience;
                                                        AudioManager.prototype.updateWeatherAmbience = function (dtMs, weather) {
                                                            if (typeof this.enabled === 'undefined') this.enabled = true;
                                                            return _ua.call(this, dtMs, weather);
                                                        };
                                                    }

                                                    // Battery saver: suspend audio context when hidden
                                                    const suspendAudio = () => {
                                                        const g = window.__GAME_INSTANCE__;
                                                        const audio = g && g.audio;
                                                        const ctx = audio && audio.ctx;
                                                        if (!ctx) return;
                                                        try { if (ctx.state === 'running') ctx.suspend().catch(() => { }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                    const resumeAudio = () => {
                                                        const g = window.__GAME_INSTANCE__;
                                                        const audio = g && g.audio;
                                                        const ctx = audio && audio.ctx;
                                                        if (!ctx) return;
                                                        try { if (ctx.state === 'suspended') ctx.resume().catch(() => { }); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };

                                                    document.addEventListener('visibilitychange', () => {
                                                        if (document.hidden) suspendAudio();
                                                        else resumeAudio();
                                                    }, { passive: true });

                                                    // pagehide: always suspend (best-effort)
                                                    window.addEventListener('pagehide', suspendAudio, { passive: true });
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 44 (line 20901) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_weather_rain_visible_fix_v1',
                                            order: 90,
                                            description: "雨滴可见性修复（v1）",
                                            apply: () => {
                                                'use strict';
                                                const TU = window.TU || {};
                                                const W = TU.WeatherCanvasFX;
                                                if (!W || !W.prototype) return;
                                                if ((window.TU && window.TU.PatchManager) ? !window.TU.PatchManager.once('tu_weather_rain_visible_fix_v1', null) : W.prototype.__tu_weather_rain_visible_fix_v1) return;

                                                // 1) Ensure the weather overlay canvas is NOT hidden (some builds hid it under reduced-motion)
                                                try {
                                                    const st = document.createElement('style');
                                                    st.setAttribute('data-tu-patch', 'tu_weather_rain_visible_fix_v1');
                                                    st.textContent = `
            #weatherfx{ display:block !important; opacity:1 !important; }
            .reduced-motion #weatherfx{ display:block !important; opacity:1 !important; }
          `;
                                                    document.head && document.head.appendChild(st);
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // Helper: get 2D ctx with maximum compatibility (some browsers return null when passing options)
                                                function get2dCtx(canvas) {
                                                    if (!canvas || !canvas.getContext) return null;
                                                    try {
                                                        return canvas.getContext('2d', { alpha: true }) || canvas.getContext('2d', { willReadFrequently: true });
                                                    } catch (e) {
                                                        try { return canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                                                    }
                                                }

                                                // 2) Ensure WeatherCanvasFX always has a valid ctx (fallback to getContext('2d', { willReadFrequently: true }) without options)
                                                if (!W.prototype._ensure2d) {
                                                    W.prototype._ensure2d = function () {
                                                        if (this.ctx) return true;
                                                        this.ctx = get2dCtx(this.canvas);
                                                        if (this.ctx) {
                                                            try { this.ctx.imageSmoothingEnabled = false; } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        }
                                                        return !!this.ctx;
                                                    };
                                                }

                                                // 3) More robust pattern builders (use ctx fallback on OffscreenCanvas / old WebViews)
                                                const _mk = (typeof W.prototype._makeOffscreenCanvas === 'function')
                                                    ? W.prototype._makeOffscreenCanvas
                                                    : function (w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

                                                W.prototype._ensureRainPattern = function () {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctxOut = this.ctx;
                                                    if (!ctxOut) return;

                                                    const tile = (this._dpr > 1.25) ? 512 : 256;
                                                    if (this._rain && this._rain.pattern && this._rain.size === tile) return;

                                                    const c = _mk.call(this, tile, tile);
                                                    const g = get2dCtx(c);
                                                    if (!g) return;

                                                    g.setTransform(1, 0, 0, 1, 0, 0);
                                                    g.clearRect(0, 0, tile, tile);

                                                    // Draw diagonal rain streaks (one-time cost)
                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const count = Math.max(220, (tile === 512 ? 420 : 260));
                                                    g.lineCap = 'round';

                                                    for (let i = 0; i < count; i++) {
                                                        const x = rand() * tile;
                                                        const y = rand() * tile;
                                                        const len = 18 + rand() * 46;
                                                        const lw = 0.55 + rand() * 0.95;

                                                        // Around 78deg (down-right)
                                                        const ang = (Math.PI / 180) * (74 + rand() * 10);
                                                        const dx = Math.cos(ang) * len;
                                                        const dy = Math.sin(ang) * len;

                                                        const grad = g.createLinearGradient(x, y, x + dx, y + dy);
                                                        grad.addColorStop(0.00, 'rgba(180,220,255,0.00)');
                                                        grad.addColorStop(0.55, 'rgba(180,220,255,0.20)');
                                                        grad.addColorStop(1.00, 'rgba(180,220,255,0.85)');

                                                        g.strokeStyle = grad;
                                                        g.lineWidth = lw;
                                                        g.beginPath();
                                                        g.moveTo(x, y);
                                                        g.lineTo(x + dx, y + dy);
                                                        g.stroke();
                                                    }

                                                    let p = null;
                                                    try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                    if (!p) return;

                                                    this._rain = this._rain || { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                    this._rain.tile = c;
                                                    this._rain.ctx = g;
                                                    this._rain.pattern = p;
                                                    this._rain.size = tile;
                                                    this._rain.ox = 0;
                                                    this._rain.oy = 0;
                                                };

                                                W.prototype._ensureSnowPattern = function () {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctxOut = this.ctx;
                                                    if (!ctxOut) return;

                                                    const tile = (this._dpr > 1.25) ? 512 : 256;
                                                    if (this._snow && this._snow.pattern && this._snow.size === tile) return;

                                                    const c = _mk.call(this, tile, tile);
                                                    const g = get2dCtx(c);
                                                    if (!g) return;

                                                    g.setTransform(1, 0, 0, 1, 0, 0);
                                                    g.clearRect(0, 0, tile, tile);

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const count = Math.max(160, (tile === 512 ? 320 : 220));

                                                    for (let i = 0; i < count; i++) {
                                                        const x = rand() * tile;
                                                        const y = rand() * tile;
                                                        const r = 0.6 + rand() * 1.8;

                                                        // soft snow dot
                                                        const grad = g.createRadialGradient(x, y, 0, x, y, r);
                                                        grad.addColorStop(0.00, 'rgba(255,255,255,0.85)');
                                                        grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');

                                                        g.fillStyle = grad;
                                                        g.beginPath();
                                                        g.arc(x, y, r, 0, Math.PI * 2);
                                                        g.fill();
                                                    }

                                                    let p = null;
                                                    try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                    if (!p) return;

                                                    this._snow = this._snow || { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                    this._snow.tile = c;
                                                    this._snow.ctx = g;
                                                    this._snow.pattern = p;
                                                    this._snow.size = tile;
                                                    this._snow.ox = 0;
                                                    this._snow.oy = 0;
                                                };

                                                // 4) Fallback draw (if pattern creation fails on some devices)
                                                W.prototype._drawRainFallback = function (intensity, dtMs, isThunder) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctx = this.ctx;
                                                    if (!ctx) return;

                                                    const w = this._wPx || (this.canvas ? this.canvas.width : 0);
                                                    const h = this._hPx || (this.canvas ? this.canvas.height : 0);
                                                    if (!w || !h) return;

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const dt = (dtMs || 0) / 1000;
                                                    const speed = (isThunder ? 1600 : 1250) * (0.55 + 0.85 * Math.min(1, Math.max(0, intensity))) * (this._dpr || 1);

                                                    // Advance a rolling offset so rain "moves"
                                                    this._rain = this._rain || { ox: 0, oy: 0 };
                                                    this._rain.oy = (this._rain.oy + speed * dt) % (h + 1);
                                                    this._rain.ox = (this._rain.ox + speed * 0.18 * dt) % (w + 1);

                                                    const n = Math.max(60, Math.min(240, (80 + intensity * 220) | 0));
                                                    const alpha = (0.08 + 0.22 * intensity) * (isThunder ? 1.10 : 1.0);

                                                    ctx.save();
                                                    ctx.globalCompositeOperation = 'source-over';
                                                    ctx.globalAlpha = alpha;
                                                    ctx.strokeStyle = 'rgba(190,225,255,0.9)';
                                                    ctx.lineCap = 'round';

                                                    for (let i = 0; i < n; i++) {
                                                        const x = ((rand() * (w + 200)) - 100 + (this._rain.ox || 0)) % (w + 200) - 100;
                                                        const y = ((rand() * (h + 200)) - 100 + (this._rain.oy || 0)) % (h + 200) - 100;

                                                        const len = 10 + rand() * 22;
                                                        const lw = 0.7 + rand() * 1.1;
                                                        const dx = len * 0.30;
                                                        const dy = len * 1.00;

                                                        ctx.lineWidth = lw;
                                                        ctx.beginPath();
                                                        ctx.moveTo(x, y);
                                                        ctx.lineTo(x + dx, y + dy);
                                                        ctx.stroke();
                                                    }
                                                    ctx.restore();
                                                };

                                                W.prototype._drawSnowFallback = function (intensity, dtMs) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    const ctx = this.ctx;
                                                    if (!ctx) return;

                                                    const w = this._wPx || (this.canvas ? this.canvas.width : 0);
                                                    const h = this._hPx || (this.canvas ? this.canvas.height : 0);
                                                    if (!w || !h) return;

                                                    const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                    const dt = (dtMs || 0) / 1000;

                                                    this._snow = this._snow || { ox: 0, oy: 0 };
                                                    const speed = 280 * (0.35 + 0.8 * Math.min(1, Math.max(0, intensity))) * (this._dpr || 1);
                                                    this._snow.oy = (this._snow.oy + speed * dt) % (h + 1);
                                                    this._snow.ox = (this._snow.ox + speed * 0.12 * dt) % (w + 1);

                                                    const n = Math.max(40, Math.min(180, (60 + intensity * 180) | 0));
                                                    const alpha = 0.10 + 0.25 * intensity;

                                                    ctx.save();
                                                    ctx.globalCompositeOperation = 'source-over';
                                                    ctx.globalAlpha = alpha;
                                                    ctx.fillStyle = 'rgba(255,255,255,0.95)';

                                                    for (let i = 0; i < n; i++) {
                                                        const x = ((rand() * (w + 200)) - 100 + (this._snow.ox || 0)) % (w + 200) - 100;
                                                        const y = ((rand() * (h + 200)) - 100 + (this._snow.oy || 0)) % (h + 200) - 100;
                                                        const r = 0.7 + rand() * 1.9;
                                                        ctx.beginPath();
                                                        ctx.arc(x, y, r, 0, Math.PI * 2);
                                                        ctx.fill();
                                                    }
                                                    ctx.restore();
                                                };

                                                // 5) Wrap drawRain/drawSnow: if the pattern path fails, use fallback so "只有声音没画面" never happens
                                                const _origDrawRain = W.prototype.drawRain;
                                                W.prototype.drawRain = function (intensity, dtMs, isThunder) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    try { if (typeof _origDrawRain === 'function') _origDrawRain.call(this, intensity, dtMs, isThunder); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    if (!this._rain || !this._rain.pattern) {
                                                        try { this._drawRainFallback(intensity, dtMs, isThunder); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                };

                                                const _origDrawSnow = W.prototype.drawSnow;
                                                W.prototype.drawSnow = function (intensity, dtMs) {
                                                    if (!this._ensure2d || !this._ensure2d()) return;
                                                    try { if (typeof _origDrawSnow === 'function') _origDrawSnow.call(this, intensity, dtMs); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    if (!this._snow || !this._snow.pattern) {
                                                        try { this._drawSnowFallback(intensity, dtMs); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                };

                                                // 6) Override render: do NOT early-return just because of reduced-motion; instead render with slower motion.
                                                W.prototype.render = function (weather, renderer) {
                                                    if (!this.canvas) return;
                                                    if (!this._ensure2d || !this._ensure2d()) return;

                                                    const reduced = !!(document.documentElement && document.documentElement.classList.contains('reduced-motion'));
                                                    const motionScale = reduced ? 0.15 : 1.0;
                                                    const densityScale = reduced ? 0.75 : 1.0;

                                                    // Keep size synced to main renderer
                                                    try { this.resizeLike(renderer); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                                    let dtMs = now - (this._lastNow || now);
                                                    if (!Number.isFinite(dtMs)) dtMs = 0;
                                                    if (dtMs < 0) dtMs = 0;
                                                    if (dtMs > 200) dtMs = 200;
                                                    this._lastNow = now;
                                                    dtMs *= motionScale;

                                                    const w = weather || {};
                                                    const type = (w.type || 'clear').toString();
                                                    const intensity = (Number(w.intensity) || 0) * densityScale;
                                                    const lightning = Number(w.lightning) || 0;

                                                    // If nothing to draw, clear once then stop touching the canvas
                                                    if (intensity <= 0.001 && lightning <= 0.001) {
                                                        if (this._hadFx) {
                                                            const ctx = this.ctx;
                                                            ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                            ctx.clearRect(0, 0, (this._wPx || this.canvas.width), (this._hPx || this.canvas.height));
                                                            this._hadFx = false;
                                                        }
                                                        this._prevLightning = lightning;
                                                        return;
                                                    }

                                                    this._hadFx = true;

                                                    const ctx = this.ctx;
                                                    const wPx = this._wPx || this.canvas.width;
                                                    const hPx = this._hPx || this.canvas.height;

                                                    // Clear overlay each frame when active (transparent canvas)
                                                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                    ctx.clearRect(0, 0, wPx, hPx);

                                                    if ((type === 'rain' || type === 'thunder') && intensity > 0.01) {
                                                        this.drawRain(intensity, dtMs, type === 'thunder');
                                                    } else if (type === 'snow' && intensity > 0.01) {
                                                        this.drawSnow(intensity, dtMs);
                                                    }

                                                    if (lightning > 0.001) {
                                                        this.drawLightning(lightning, dtMs);
                                                    } else if (this._bolt && this._bolt.life > 0) {
                                                        // Let bolt fade out naturally even if lightning param drops fast
                                                        this.drawLightning(Math.max(0, this._prevLightning * 0.8), dtMs);
                                                    }

                                                    this._prevLightning = lightning;
                                                };
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 45 (line 21228) ---

(() => {
                                    const TU = window.TU || {};
                                    (function () {
                                        const __p = ({
                                            id: 'tu_acid_rain_hazard_v1',
                                            order: 100,
                                            description: "酸雨危害机制（v1）",
                                            apply: () => {
                                                'use strict';
                                                if (window.__TU_ACID_RAIN_HAZARD_V1__) return;
                                                window.__TU_ACID_RAIN_HAZARD_V1__ = true;

                                                const TU = window.TU || {};
                                                const Game = TU.Game;
                                                const Player = TU.Player;
                                                const UIManager = TU.UIManager;
                                                const WeatherCanvasFX = TU.WeatherCanvasFX;

                                                if (!Game || !Game.prototype) return;

                                                const ACID_CHANCE = 0.30;          // 30% chance when rain starts
                                                const ACID_MIN_INTENSITY = 0.06;   // below this, no damage / no strong effects
                                                const SHELTER_CHECK_MS = 120;      // shelter raycast throttling
                                                const DMG_INTERVAL_MIN = 250;      // ms
                                                const DMG_INTERVAL_MAX = 1050;     // ms

                                                // ───────────────────────── CSS & overlay element ─────────────────────────
                                                function ensureStyle() {
                                                    try {
                                                        if (document.getElementById('tu-acid-rain-style')) return;
                                                        const st = document.createElement('style');
                                                        st.id = 'tu-acid-rain-style';
                                                        st.textContent = `
              /* Acid rain damage flash overlay */
              #damage-flash{
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 80; /* above weatherfx (55), below UI (100) */
                opacity: 0;
                background: radial-gradient(circle at 50% 45%,
                  rgba(255, 90, 90, 0.22),
                  rgba(0, 0, 0, 0)
                );
                mix-blend-mode: screen;
              }
              #damage-flash.acid{
                background: radial-gradient(circle at 50% 45%,
                  rgba(0, 255, 140, 0.20),
                  rgba(0, 0, 0, 0)
                );
              }
              #damage-flash.flash{
                animation: tuDamageFlash 0.28s ease-out 1;
              }
              @keyframes tuDamageFlash{
                0%{ opacity: 0; }
                28%{ opacity: 1; }
                100%{ opacity: 0; }
              }

              /* Health bar feedback when taking damage */
              .stat-bar.hurt-acid{
                animation: tuHurtShake 0.28s ease-out 1;
                border-color: rgba(0, 255, 140, 0.55) !important;
                box-shadow: 0 0 0 2px rgba(0, 255, 140, 0.25), var(--shadow);
              }
              .stat-bar.hurt-acid .fill{
                filter: brightness(1.25) saturate(1.35);
              }
              @keyframes tuHurtShake{
                0%{ transform: translateX(0) scale(1); }
                25%{ transform: translateX(-2px) scale(1.06); }
                55%{ transform: translateX(2px) scale(1.04); }
                100%{ transform: translateX(0) scale(1); }
              }
            `;
                                                        document.head && document.head.appendChild(st);
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                }

                                                function ensureDamageFlashEl() {
                                                    try {
                                                        let el = document.getElementById('damage-flash');
                                                        if (el) return el;
                                                        el = document.createElement('div');
                                                        el.id = 'damage-flash';
                                                        document.body && document.body.appendChild(el);
                                                        return el;
                                                    } catch (_) {
                                                        return null;
                                                    }
                                                }

                                                ensureStyle();
                                                const damageFlashEl = ensureDamageFlashEl();

                                                // ───────────────────────── UI: flash damage feedback ─────────────────────────
                                                if (UIManager && UIManager.prototype && !UIManager.prototype.flashDamage) {
                                                    UIManager.prototype.flashDamage = function (kind) {
                                                        try {
                                                            const isAcid = (kind === 'acid' || kind === 'acidRain');
                                                            const bar = this.healthFillEl && this.healthFillEl.closest ? this.healthFillEl.closest('.stat-bar') : null;
                                                            if (bar) {
                                                                // restart animation
                                                                bar.classList.remove('hurt-acid');
                                                                if (isAcid) {
                                                                    // force reflow once (only on damage, not per-frame)
                                                                    void bar.offsetWidth;
                                                                    bar.classList.add('hurt-acid');
                                                                }
                                                            }
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }

                                                // ───────────────────────── Player: simple hurt flash (render overlay) ─────────────────────────
                                                if (Player && Player.prototype && !Player.prototype.__tuAcidRainHurtFlash) {
                                                    Player.prototype.__tuAcidRainHurtFlash = true;

                                                    const _update = Player.prototype.update;
                                                    if (typeof _update === 'function') {
                                                        Player.prototype.update = function (input, world, dt) {
                                                            // 防御性参数检查
                                                            if (!world) {
                                                                console.warn('[Player.update] World not provided');
                                                                return;
                                                            }
                                                            if (typeof dt !== 'number' || dt <= 0) {
                                                                console.warn(`[Player.update] Invalid dt: ${dt}`);
                                                                dt = 16.67;
                                                            }

                                                            _update.call(this, input, world, dt);
                                                            const d = Math.min(50, Math.max(0, Number(dt) || 0));
                                                            if (this._hurtFlashMs > 0) {
                                                                this._hurtFlashMs = Math.max(0, this._hurtFlashMs - d);
                                                            }
                                                        };
                                                    }

                                                    const _render = Player.prototype.render;
                                                    if (typeof _render === 'function') {
                                                        Player.prototype.render = function (ctx, cam) {
                                                            _render.call(this, ctx, cam);
                                                            const ms = Number(this._hurtFlashMs) || 0;
                                                            if (ms <= 0 || !ctx || !cam) return;

                                                            const t = Math.min(1, ms / 240);
                                                            const sx = Math.floor(this.x - cam.x);
                                                            const sy = Math.floor(this.y - cam.y);

                                                            ctx.save();
                                                            try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            ctx.globalAlpha = 0.28 * t;
                                                            ctx.globalCompositeOperation = 'screen';
                                                            ctx.fillStyle = (this._hurtKind === 'acid') ? 'rgba(0,255,140,0.75)' : 'rgba(255,90,90,0.75)';
                                                            // slightly larger than hitbox for visibility
                                                            ctx.fillRect(sx - 2, sy - 2, (this.w | 0) + 4, (this.h | 0) + 4);
                                                            ctx.globalAlpha = 1;
                                                            ctx.globalCompositeOperation = 'source-over';
                                                            ctx.restore();
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── WeatherCanvasFX: green rain variant when acid ─────────────────────────
                                                if (WeatherCanvasFX && WeatherCanvasFX.prototype && !WeatherCanvasFX.prototype.__tuAcidRainGreen) {
                                                    WeatherCanvasFX.prototype.__tuAcidRainGreen = true;

                                                    // Helper: robust ctx getter (some browsers dislike passing options)
                                                    function get2dCtx(canvas) {
                                                        if (!canvas || !canvas.getContext) return null;
                                                        try { return canvas.getContext('2d', { alpha: true }) || canvas.getContext('2d', { willReadFrequently: true }); } catch (e) {
                                                            try { return canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; }
                                                        }
                                                    }

                                                    // Ensure acid rain pattern cache slot exists
                                                    function acidSlot(self) {
                                                        if (!self._rainAcid) self._rainAcid = { tile: null, ctx: null, pattern: null, size: 0, ox: 0, oy: 0 };
                                                        return self._rainAcid;
                                                    }

                                                    // Invalidate acid cache on resize (pattern is ctx-bound)
                                                    const _resizeLike = WeatherCanvasFX.prototype.resizeLike;
                                                    if (typeof _resizeLike === 'function') {
                                                        WeatherCanvasFX.prototype.resizeLike = function (renderer) {
                                                            const oldW = this.canvas ? this.canvas.width : 0;
                                                            const oldH = this.canvas ? this.canvas.height : 0;
                                                            _resizeLike.call(this, renderer);
                                                            const nw = this.canvas ? this.canvas.width : 0;
                                                            const nh = this.canvas ? this.canvas.height : 0;
                                                            if (nw !== oldW || nh !== oldH) {
                                                                const s = acidSlot(this);
                                                                s.pattern = null; s.tile = null; s.size = 0; s.ox = 0; s.oy = 0;
                                                            }
                                                        };
                                                    }

                                                    // Build a green rain pattern (same performance profile as normal rain)
                                                    WeatherCanvasFX.prototype._ensureAcidRainPattern = function () {
                                                        // If the fixed patch installed _ensure2d, use it (it also restores ctx on old browsers)
                                                        if (typeof this._ensure2d === 'function') {
                                                            if (!this._ensure2d()) return;
                                                        }
                                                        const ctxOut = this.ctx;
                                                        if (!ctxOut) return;

                                                        const tile = (this._dpr > 1.25) ? 512 : 256;
                                                        const slot = acidSlot(this);
                                                        if (slot.pattern && slot.size === tile) return;

                                                        const mk = (typeof this._makeOffscreenCanvas === 'function')
                                                            ? (w, h) => this._makeOffscreenCanvas(w, h)
                                                            : (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

                                                        const c = mk(tile, tile);
                                                        const g = get2dCtx(c);
                                                        if (!g) return;

                                                        g.setTransform(1, 0, 0, 1, 0, 0);
                                                        g.clearRect(0, 0, tile, tile);

                                                        // Use deterministic RNG if available
                                                        const rand = (typeof this._rand01 === 'function') ? () => this._rand01() : () => Math.random();
                                                        const count = Math.max(220, (tile === 512 ? 420 : 260));

                                                        g.lineCap = 'round';

                                                        // Draw diagonal streaks with green gradient (one-time cost)
                                                        for (let i = 0; i < count; i++) {
                                                            const x = rand() * tile;
                                                            const y = rand() * tile;
                                                            const len = 18 + rand() * 46;
                                                            const lw = 0.55 + rand() * 0.95;

                                                            const ang = (Math.PI / 180) * (74 + rand() * 10);
                                                            const dx = Math.cos(ang) * len;
                                                            const dy = Math.sin(ang) * len;

                                                            const grad = g.createLinearGradient(x, y, x + dx, y + dy);
                                                            grad.addColorStop(0.00, 'rgba(0,255,140,0.00)');
                                                            grad.addColorStop(0.55, 'rgba(0,255,140,0.22)');
                                                            grad.addColorStop(1.00, 'rgba(0,255,140,0.85)');

                                                            g.strokeStyle = grad;
                                                            g.lineWidth = lw;
                                                            g.beginPath();
                                                            g.moveTo(x, y);
                                                            g.lineTo(x + dx, y + dy);
                                                            g.stroke();
                                                        }

                                                        let p = null;
                                                        try { p = ctxOut.createPattern(c, 'repeat'); } catch (_) { p = null; }
                                                        if (!p) return;

                                                        slot.tile = c;
                                                        slot.ctx = g;
                                                        slot.pattern = p;
                                                        slot.size = tile;
                                                        slot.ox = 0;
                                                        slot.oy = 0;
                                                    };

                                                    // Use acid pattern when the render wrapper marked it as acid rain
                                                    const _render = WeatherCanvasFX.prototype.render;
                                                    if (typeof _render === 'function') {
                                                        WeatherCanvasFX.prototype.render = function (weather, renderer) {
                                                            this._tuIsAcidRain = !!(weather && weather.acid);
                                                            return _render.call(this, weather, renderer);
                                                        };
                                                    }

                                                    // Override drawRain to optionally use acid pattern (no extra draw calls)
                                                    const _drawRain = WeatherCanvasFX.prototype.drawRain;
                                                    WeatherCanvasFX.prototype.drawRain = function (intensity, dtMs, isThunder) {
                                                        const useAcid = !!this._tuIsAcidRain;
                                                        if (!this.ctx) return;

                                                        if (useAcid) this._ensureAcidRainPattern();
                                                        else if (typeof this._ensureRainPattern === 'function') this._ensureRainPattern();

                                                        const rain = useAcid ? acidSlot(this) : this._rain;
                                                        if (!rain || !rain.pattern) {
                                                            // fallback to original if something went wrong
                                                            if (!useAcid && typeof _drawRain === 'function') return _drawRain.call(this, intensity, dtMs, isThunder);
                                                            return;
                                                        }

                                                        const ctx = this.ctx;
                                                        const w = this._wPx, h = this._hPx;
                                                        const tile = rain.size | 0;
                                                        if (!tile) return;

                                                        const it = Math.min(1, Math.max(0, Number(intensity) || 0));
                                                        const base = ((isThunder ? 1400 : 1100) * (this._dpr || 1));
                                                        const speed = base * (0.55 + 0.85 * it);

                                                        const dt = (Number(dtMs) || 0) / 1000;
                                                        rain.oy = (rain.oy + speed * dt) % tile;
                                                        rain.ox = (rain.ox + speed * 0.18 * dt) % tile;

                                                        const ox = rain.ox;
                                                        const oy = rain.oy;

                                                        const aBase = (0.10 + 0.28 * it) * (isThunder ? 1.10 : 1.0);

                                                        ctx.globalCompositeOperation = 'source-over';
                                                        ctx.fillStyle = rain.pattern;

                                                        // Far layer
                                                        ctx.globalAlpha = aBase * 0.55;
                                                        ctx.setTransform(1, 0, 0, 1, -ox * 0.65, -oy * 0.65);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        // Near layer
                                                        ctx.globalAlpha = aBase;
                                                        ctx.setTransform(1, 0, 0, 1, -ox, -oy);
                                                        ctx.fillRect(0, 0, w + tile, h + tile);

                                                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                                                        ctx.globalAlpha = 1;
                                                    };
                                                }

                                                // ───────────────────────── Weather logic: decide acid rain (30%) when rain starts ─────────────────────────
                                                if (!Game.prototype.__tuAcidRainWeatherLogic) {
                                                    Game.prototype.__tuAcidRainWeatherLogic = true;

                                                    const _updateWeather = Game.prototype._updateWeather;
                                                    if (typeof _updateWeather === 'function') {
                                                        Game.prototype._updateWeather = function (dtMs) {
                                                            _updateWeather.call(this, dtMs);

                                                            const w = this.weather;
                                                            if (!w) return;

                                                            const inRainDomain = (w.type === 'rain' || w.type === 'thunder');
                                                            const wasInRain = !!this._tuWasInRainDomain;

                                                            if (inRainDomain && !wasInRain) {
                                                                // New rain event => roll acid chance
                                                                let r = Math.random();
                                                                try {
                                                                    const rng = this._weatherRng;
                                                                    if (typeof rng === 'function') r = rng();
                                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                                w.acid = (r < ACID_CHANCE);

                                                                if (w.acid) {
                                                                    try { if (typeof Toast !== 'undefined' && Toast && Toast.show) Toast.show('☣️ 酸雨降临！躲到遮挡物下避免伤害', 1800); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            } else if (!inRainDomain) {
                                                                w.acid = false;
                                                            } else {
                                                                // staying in rain domain => keep previous
                                                                if (typeof w.acid !== 'boolean') w.acid = !!this._tuAcidWasOn;
                                                            }

                                                            this._tuWasInRainDomain = inRainDomain;
                                                            this._tuAcidWasOn = !!w.acid;

                                                            // Optional: let CSS react if you want (debug / future UI)
                                                            try { document.body && document.body.classList.toggle('weather-acid', inRainDomain && !!w.acid); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }

                                                // ───────────────────────── Acid rain damage (only if exposed to sky) ─────────────────────────
                                                function isSolid(blockId) {
                                                    try {
                                                        if (typeof BLOCK_SOLID !== 'undefined' && BLOCK_SOLID && BLOCK_SOLID[blockId]) return true;
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    try {
                                                        const bs = TU && TU.BLOCK_SOLID;
                                                        if (bs && bs[blockId]) return true;
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return false;
                                                }

                                                // Blocks that count as "cover" even if not solid (platforms, leaves, etc.)
                                                const __TU_RAIN_COVER_IDS__ = (() => {
                                                    try {
                                                        if (typeof BLOCK !== 'undefined' && BLOCK) {
                                                            return new Set([
                                                                BLOCK.LEAVES, BLOCK.PALM_LEAVES, BLOCK.CHERRY_LEAVES, BLOCK.PINE_LEAVES,
                                                                BLOCK.LIVING_LEAF, BLOCK.MAHOGANY_LEAVES,
                                                                BLOCK.PLATFORMS_WOOD, BLOCK.PLATFORMS_STONE, BLOCK.PLATFORMS_METAL
                                                            ]);
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return null;
                                                })();

                                                function blocksRain(id) {
                                                    if (isSolid(id)) return true;
                                                    const set = __TU_RAIN_COVER_IDS__;
                                                    if (set && set.has(id)) return true;

                                                    // Fallback: match by Chinese block name ("叶" / "平台")
                                                    try {
                                                        if (typeof BLOCK_META !== 'undefined' && BLOCK_META && BLOCK_META[id] && BLOCK_META[id].name) {
                                                            const n = BLOCK_META[id].name;
                                                            if (n.indexOf('叶') !== -1 || n.indexOf('平台') !== -1) return true;
                                                        }
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    return false;
                                                }

                                                function isShelteredFromRain(game) {
                                                    const world = game && game.world;
                                                    const p = game && game.player;
                                                    const ts = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.TILE_SIZE) ? CONFIG.TILE_SIZE : 16;
                                                    if (!world || !world.tiles || !p) return true;

                                                    const tiles = world.tiles;
                                                    const wW = world.w || tiles.length || 0;
                                                    if (wW <= 0) return true;

                                                    const AIR = (typeof BLOCK !== 'undefined' && BLOCK && typeof BLOCK.AIR !== 'undefined') ? BLOCK.AIR : 0;

                                                    const left = Math.floor(p.x / ts);
                                                    const right = Math.floor((p.x + p.w - 1) / ts);
                                                    const topY = Math.floor(p.y / ts) - 1;

                                                    if (topY <= 0) return false; // head is at/above top => exposed

                                                    // Rain can hit if ANY column above the player's width is open to sky
                                                    for (let tx = left; tx <= right; tx++) {
                                                        if (tx < 0 || tx >= wW) continue;
                                                        const col = tiles[tx];
                                                        if (!col) continue;

                                                        let blocked = false;
                                                        for (let ty = topY; ty >= 0; ty--) {
                                                            const id = col[ty];
                                                            if (id !== AIR && blocksRain(id)) { blocked = true; break; }
                                                        }
                                                        if (!blocked) return false;
                                                    }
                                                    return true;
                                                }

                                                function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

                                                function ensureFlash(game, kind) {
                                                    const el = (game && game._tuDamageFlashEl) || damageFlashEl || document.getElementById('damage-flash');
                                                    if (!el) return;
                                                    try {
                                                        if (game) game._tuDamageFlashEl = el;
                                                        el.classList.toggle('acid', kind === 'acid' || kind === 'acidRain');
                                                        el.classList.remove('flash');
                                                        void el.offsetWidth;
                                                        el.classList.add('flash');
                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                }

                                                function applyDamage(game, amount, kind) {
                                                    const p = game && game.player;
                                                    if (!p) return;

                                                    const dmg = Math.max(0, amount | 0);
                                                    if (!dmg) return;

                                                    // Apply damage
                                                    p.health = Math.max(0, (p.health | 0) - dmg);

                                                    // Feedback (UI + flash + haptic)
                                                    p._hurtFlashMs = 240;
                                                    p._hurtKind = (kind === 'acidRain') ? 'acid' : (kind || 'acid');

                                                    try { if (game.ui && typeof game.ui.flashDamage === 'function') game.ui.flashDamage(p._hurtKind); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    ensureFlash(game, p._hurtKind);
                                                    try { if (typeof game._haptic === 'function') game._haptic(8); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                    // Death / respawn (simple)
                                                    if (p.health <= 0) {
                                                        try { if (typeof Toast !== 'undefined' && Toast && Toast.show) Toast.show('💀 你被酸雨腐蚀了…', 1500); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        p.health = p.maxHealth | 0;
                                                        if (game._tuSpawnPoint) {
                                                            p.x = game._tuSpawnPoint.x;
                                                            p.y = game._tuSpawnPoint.y;
                                                        }
                                                        p.vx = 0; p.vy = 0;
                                                    }
                                                }

                                                // Store spawn point after init
                                                if (!Game.prototype.__tuAcidRainSpawnPoint) {
                                                    Game.prototype.__tuAcidRainSpawnPoint = true;
                                                    const _init = Game.prototype.init;
                                                    if (typeof _init === 'function') {
                                                        Game.prototype.init = async function (...args) {
                                                            const r = await _init.apply(this, args);
                                                            try {
                                                                if (this.player && (this._tuSpawnPoint == null)) {
                                                                    this._tuSpawnPoint = { x: this.player.x, y: this.player.y };
                                                                }
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            return r;
                                                        };
                                                    }
                                                }

                                                // Damage tick in update
                                                if (!Game.prototype.__tuAcidRainDamageTick) {
                                                    Game.prototype.__tuAcidRainDamageTick = true;

                                                    Game.prototype._tuUpdateAcidRainDamage = function (dtMs) {
                                                        const w = this.weather;
                                                        const p = this.player;
                                                        if (!w || !p) return false;

                                                        const inRainDomain = (w.type === 'rain' || w.type === 'thunder');
                                                        const acid = !!w.acid;
                                                        const it = clamp01(Number(w.intensity) || 0);

                                                        if (!inRainDomain || !acid || it < ACID_MIN_INTENSITY) {
                                                            this._tuAcidDmgAcc = 0;
                                                            this._tuShelterAcc = 0;
                                                            this._tuSheltered = true;
                                                            return false;
                                                        }

                                                        // Shelter check (throttled)
                                                        this._tuShelterAcc = (this._tuShelterAcc || 0) + (Number(dtMs) || 0);
                                                        if (this._tuShelterAcc >= SHELTER_CHECK_MS || this._tuSheltered === undefined) {
                                                            this._tuShelterAcc = 0;
                                                            this._tuSheltered = isShelteredFromRain(this);
                                                        }

                                                        if (this._tuSheltered) {
                                                            this._tuAcidDmgAcc = 0; // don't "bank" damage while protected
                                                            return false;
                                                        }

                                                        // Damage interval scales with intensity
                                                        const interval = Math.max(DMG_INTERVAL_MIN, Math.min(DMG_INTERVAL_MAX, DMG_INTERVAL_MAX - 650 * it));
                                                        this._tuAcidDmgAcc = (this._tuAcidDmgAcc || 0) + (Number(dtMs) || 0);

                                                        let didDamage = false;
                                                        while (this._tuAcidDmgAcc >= interval) {
                                                            this._tuAcidDmgAcc -= interval;
                                                            const dmg = 1 + (it > 0.82 ? 1 : 0);
                                                            applyDamage(this, dmg, 'acidRain');
                                                            didDamage = true;
                                                        }
                                                        return didDamage;
                                                    };

                                                    const _update = Game.prototype.update;
                                                    if (typeof _update === 'function') {
                                                        Game.prototype.update = function (dt) {
                                                            _update.call(this, dt);
                                                            try {
                                                                const d = Math.min(50, Math.max(0, Number(dt) || 0));
                                                                const did = this._tuUpdateAcidRainDamage(d);
                                                                // Ensure UI reflects health change immediately (only when damage happened)
                                                                if (did && this.ui && typeof this.ui.updateStats === 'function') this.ui.updateStats();
                                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                        };
                                                    }
                                                }
                                            }
                                        }); try { __p && __p.apply && __p.apply(); } catch (e) { console.warn('[TU merge] patch apply failed', __p && __p.id, e); }
                                    })();
                                })();

// --- Merged from block 49 (line 23468) ---

(() => {
                                    'use strict';

                                    // ─────────────────────────────────────────────────────────────
                                    // 1) Chunk glow bake: bake glow layer into chunk glowCanvas (with padding)
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Renderer !== 'undefined' && Renderer && Renderer.prototype && Renderer.prototype.__cb2_getEntry) {
                                            const GLOW_PAD = 32; // chunk-level padding to avoid blur clipping on chunk borders

                                            // Wrap/replace rebuildChunk to draw BOTH base + glow layers into chunk-local canvases.
                                            const _origRebuild = Renderer.prototype.__cb2_rebuildChunk;
                                            Renderer.prototype.__cb2_rebuildChunk = function (entry, world) {
                                                try {
                                                    const cfg = this.__cb2_cfg || { tiles: 16 };
                                                    const cts = (cfg.tiles | 0) || 16;
                                                    const ts = (CONFIG && CONFIG.TILE_SIZE) ? (CONFIG.TILE_SIZE | 0) : 16;

                                                    const pxW = cts * ts;
                                                    const pad = GLOW_PAD | 0;
                                                    const glowW = pxW + pad * 2;

                                                    // Ensure base canvas
                                                    if (!entry.canvas) {
                                                        entry.canvas = document.createElement('canvas');
                                                        entry.ctx = entry.canvas.getContext('2d', { alpha: true });
                                                        entry.ctx.imageSmoothingEnabled = false;
                                                    }
                                                    if (entry.canvas.width !== pxW || entry.canvas.height !== pxW) {
                                                        entry.canvas.width = entry.canvas.height = pxW;
                                                    }
                                                    const ctx = entry.ctx;

                                                    // Ensure glow canvas
                                                    if (!entry.glowCanvas) {
                                                        entry.glowCanvas = document.createElement('canvas');
                                                        entry.glowCtx = entry.glowCanvas.getContext('2d', { alpha: true });
                                                        entry.glowCtx.imageSmoothingEnabled = false;
                                                        entry.glowPad = pad;
                                                        entry.hasGlow = false;
                                                    }
                                                    if (entry.glowCanvas.width !== glowW || entry.glowCanvas.height !== glowW) {
                                                        entry.glowCanvas.width = entry.glowCanvas.height = glowW;
                                                    }
                                                    const gctx = entry.glowCtx;
                                                    entry.glowPad = pad;
                                                    entry.hasGlow = false;

                                                    // Clear
                                                    ctx.clearRect(0, 0, pxW, pxW);
                                                    gctx.clearRect(0, 0, glowW, glowW);

                                                    const tilesCols = world && world.tiles;
                                                    const tilesFlat = world && world.tilesFlat;
                                                    const H = world ? (world.h | 0) : 0;

                                                    const texGen = this.textures;
                                                    const BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : null;

                                                    const cx0 = (entry.cx | 0) * cts;
                                                    const cy0 = (entry.cy | 0) * cts;

                                                    for (let lx = 0; lx < cts; lx++) {
                                                        const wx = cx0 + lx;
                                                        if (wx < 0 || wx >= world.w) continue;

                                                        let col = null;
                                                        let baseIdx = 0;
                                                        if (tilesFlat && H) {
                                                            baseIdx = (wx * H) | 0;
                                                        } else if (tilesCols) {
                                                            col = tilesCols[wx];
                                                        }

                                                        for (let ly = 0; ly < cts; ly++) {
                                                            const wy = cy0 + ly;
                                                            if (wy < 0 || wy >= world.h) continue;

                                                            const id = (tilesFlat && H) ? (tilesFlat[baseIdx + wy] | 0) : (col ? (col[wy] | 0) : 0);
                                                            if (id === 0) continue;

                                                            // Base tile & glow bake
                                                            const tex = texGen && texGen.get ? texGen.get(id) : null;
                                                            const bl = BL ? (BL[id] | 0) : 0;

                                                            if (bl > 5) {
                                                                // Glow tiles: draw into glowCanvas (includes tile content when using getGlow fallback),
                                                                // base canvas intentionally skips to avoid double-draw.
                                                                const gtex = (texGen && texGen.getGlow) ? texGen.getGlow(id) : null;
                                                                if (gtex) {
                                                                    const gp = gtex.__pad | 0;
                                                                    gctx.drawImage(gtex, lx * ts + pad - gp, ly * ts + pad - gp);
                                                                    entry.hasGlow = true;
                                                                } else if (tex) {
                                                                    // Fallback: shadowBlur bake directly into glowCanvas
                                                                    try {
                                                                        gctx.save();
                                                                        gctx.shadowColor = (typeof BLOCK_COLOR !== 'undefined' && BLOCK_COLOR[id]) ? BLOCK_COLOR[id] : '#ffffff';
                                                                        gctx.shadowBlur = bl * 2;
                                                                        gctx.drawImage(tex, lx * ts + pad, ly * ts + pad);
                                                                        gctx.restore();
                                                                        entry.hasGlow = true;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            } else {
                                                                if (tex) ctx.drawImage(tex, lx * ts, ly * ts);
                                                            }

                                                        }
                                                    }

                                                    entry.dirty = false;
                                                    return;
                                                } catch (e) {
                                                    // Fallback to previous rebuild if anything goes wrong.
                                                    try { if (_origRebuild) return _origRebuild.call(this, entry, world); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    entry.dirty = false;
                                                }
                                            };

                                            // Ensure existing cached entries get glow canvases after patch
                                            try {
                                                const oldGet = Renderer.prototype.__cb2_getEntry;
                                                Renderer.prototype.__cb2_getEntry = function (world, cx, cy) {
                                                    const e = oldGet.call(this, world, cx, cy);
                                                    if (e && !e.glowCanvas) {
                                                        e.dirty = true; // force rebuild with new glow bake path
                                                        try { this.__cb2_rebuildChunk(e, world); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    }
                                                    return e;
                                                };
                                            } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 2) Vignette/darkness: tile-resolution alpha-map (offscreen ImageData), single draw
                                    //    + draw glowCanvas per chunk (no per-tile glow loops)
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof Renderer !== 'undefined' && Renderer && Renderer.prototype && typeof Renderer.prototype.renderWorld === 'function') {
                                            const _prevRW = Renderer.prototype.renderWorld;

                                            function parseRgb(str) {
                                                // supports 'rgb(r,g,b)' or 'rgba(r,g,b,a)' or '#rrggbb'
                                                if (!str) return { r: 10, g: 5, b: 20 };
                                                const s = String(str).trim();
                                                let m = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*/i);
                                                if (m) return { r: (m[1] | 0), g: (m[2] | 0), b: (m[3] | 0) };
                                                m = s.match(/^#([0-9a-f]{6})$/i);
                                                if (m) {
                                                    const n = parseInt(m[1], 16);
                                                    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
                                                }
                                                return { r: 10, g: 5, b: 20 };
                                            }

                                            // dark LUT builder (same as original renderWorld)
                                            function buildDarkLUT(levels, nightBonus) {
                                                const lut = new Float32Array(256);
                                                for (let i = 0; i < 256; i++) {
                                                    const darkness = 1 - (i / levels);
                                                    let totalDark = darkness * 0.6 + nightBonus;
                                                    if (totalDark > 0.88) totalDark = 0.88;
                                                    lut[i] = (totalDark > 0.05) ? totalDark : 0;
                                                }
                                                return lut;
                                            }

                                            Renderer.prototype.renderWorld = function (world, cam, time) {
                                                // Preserve worker-rendered fast path (if present)
                                                try {
                                                    const ww = this.__ww;
                                                    if (ww && ww.renderEnabled && ww.worldReady) {
                                                        ww.requestFrame(cam, time, this);
                                                        const bm = ww.consumeBitmap();
                                                        if (bm) {
                                                            try { this.ctx.drawImage(bm, 0, 0, this.w, this.h); return; }
                                                            finally { try { bm.close && bm.close(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } }
                                                        }
                                                    }
                                                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                // Preconditions for our path
                                                if (!world || !cam || !this.__cb2_getEntry || !this.__cb2_cfg || !this.ctx) {
                                                    return _prevRW.call(this, world, cam, time);
                                                }
                                                const ts = (CONFIG && CONFIG.TILE_SIZE) ? (CONFIG.TILE_SIZE | 0) : 16;
                                                const ctx = this.ctx;

                                                // Visible tile range (clamped once)
                                                let startX = (cam.x / ts) | 0; startX -= 1;
                                                let startY = (cam.y / ts) | 0; startY -= 1;
                                                let endX = startX + ((this.w / ts) | 0) + 3;
                                                let endY = startY + ((this.h / ts) | 0) + 3;

                                                if (startX < 0) startX = 0;
                                                if (startY < 0) startY = 0;
                                                if (endX >= world.w) endX = world.w - 1;
                                                if (endY >= world.h) endY = world.h - 1;

                                                const camCeilX = Math.ceil(cam.x);
                                                const camCeilY = Math.ceil(cam.y);

                                                // ───────── LUT (day/night + weather gloom/flash) ─────────
                                                const Utils = window.Utils || (window.TU && window.TU.Utils);
                                                const night = Utils && Utils.nightFactor ? Utils.nightFactor(time) : 0;
                                                const qNight = Math.round(night * 100) / 100;
                                                const levels = (CONFIG && CONFIG.LIGHT_LEVELS) ? (CONFIG.LIGHT_LEVELS | 0) : 16;

                                                const wf = window.TU_WEATHER_FX || null;
                                                let wType = (wf && wf.type) ? wf.type : 'clear';
                                                let wGloom = (wf && typeof wf.gloom === 'number') ? wf.gloom : 0;
                                                let wFlash = (wf && typeof wf.lightning === 'number') ? wf.lightning : 0;
                                                if (wGloom < 0) wGloom = 0;
                                                if (wGloom > 1) wGloom = 1;
                                                if (wFlash < 0) wFlash = 0;
                                                if (wFlash > 1) wFlash = 1;
                                                const wKey = wType + ':' + ((wGloom * 100) | 0) + ':' + ((wFlash * 100) | 0) + ':' + qNight + ':' + levels;

                                                if (!this._darkAlphaLUTDay || this._darkAlphaLUTLevels !== levels) {
                                                    this._darkAlphaLUTLevels = levels;
                                                    this._darkAlphaLUTDay = buildDarkLUT(levels, 0);
                                                    this._darkAlphaLUTNight = buildDarkLUT(levels, 0.2);
                                                }
                                                let lut = this._darkAlphaLUTBlend;
                                                if (!lut || this._darkAlphaLUTBlendWeatherKey !== wKey || this._darkAlphaLUTBlendNight !== qNight || this._darkAlphaLUTBlendLevels !== levels) {
                                                    lut = this._darkAlphaLUTBlend || (this._darkAlphaLUTBlend = new Float32Array(256));
                                                    const dayL = this._darkAlphaLUTDay;
                                                    const nightL = this._darkAlphaLUTNight;
                                                    const lv = levels || 1;
                                                    const gloom = wGloom;
                                                    const flash = wFlash;
                                                    let th = 0.05 - gloom * 0.02;
                                                    if (th < 0.02) th = 0.02;

                                                    for (let i = 0; i < 256; i++) {
                                                        let v = dayL[i] + (nightL[i] - dayL[i]) * qNight;

                                                        if (gloom > 0.001) {
                                                            let light01 = i / lv;
                                                            if (light01 < 0) light01 = 0;
                                                            if (light01 > 1) light01 = 1;
                                                            const sh = 1 - light01;
                                                            v += gloom * (0.08 + 0.22 * sh);
                                                            v *= (1 + gloom * 0.18);
                                                        }

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
                                                window.BLOCK_LIGHT_LUT = lut;

                                                // ───────── 1) Draw tile chunks (base) ─────────
                                                ctx.globalCompositeOperation = 'source-over';
                                                ctx.globalAlpha = 1;
                                                ctx.shadowBlur = 0;

                                                const cfg = this.__cb2_cfg || { tiles: 16 };
                                                const cts = (cfg.tiles | 0) || 16;

                                                const cStartX = (startX / cts) | 0;
                                                const cStartY = (startY / cts) | 0;
                                                const cEndX = (endX / cts) | 0;
                                                const cEndY = (endY / cts) | 0;

                                                for (let cy = cStartY; cy <= cEndY; cy++) {
                                                    for (let cx = cStartX; cx <= cEndX; cx++) {
                                                        const e = this.__cb2_getEntry(world, cx, cy);
                                                        if (!e || !e.canvas) continue;
                                                        const dx = cx * cts * ts - camCeilX;
                                                        const dy = cy * cts * ts - camCeilY;
                                                        ctx.drawImage(e.canvas, dx, dy);
                                                    }
                                                }

                                                // ───────── 2) Draw baked glow canvases (chunk-level) ─────────
                                                if (this.enableGlow) {
                                                    for (let cy = cStartY; cy <= cEndY; cy++) {
                                                        for (let cx = cStartX; cx <= cEndX; cx++) {
                                                            const e = this.__cb2_getEntry(world, cx, cy);
                                                            if (!e || !e.glowCanvas || !e.hasGlow) continue;
                                                            const pad = e.glowPad | 0;
                                                            const dx = cx * cts * ts - camCeilX - pad;
                                                            const dy = cy * cts * ts - camCeilY - pad;
                                                            ctx.drawImage(e.glowCanvas, dx, dy);
                                                        }
                                                    }
                                                }

                                                // ───────── 3) Tile-resolution darkness alpha-map (offscreen ImageData) ─────────
                                                const tilesCols = world.tiles;
                                                const lightCols = world.light;
                                                const tilesFlat = world.tilesFlat;
                                                const lightFlat = world.lightFlat;
                                                const H = world.h | 0;

                                                const wTiles = (endX - startX + 1) | 0;
                                                const hTiles = (endY - startY + 1) | 0;

                                                let mask = this.__tu_darkMask;
                                                if (!mask || mask.w !== wTiles || mask.h !== hTiles) {
                                                    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(wTiles, hTiles) : document.createElement('canvas');
                                                    c.width = wTiles; c.height = hTiles;
                                                    const mctx = c.getContext('2d', { alpha: true });
                                                    mask = this.__tu_darkMask = { canvas: c, ctx: mctx, w: wTiles, h: hTiles, imageData: mctx.createImageData(wTiles, hTiles) };
                                                }

                                                const wfShadow = wf && wf.shadowColor ? wf.shadowColor : 'rgb(10,5,20)';
                                                const rgb = parseRgb(wfShadow);

                                                const data = mask.imageData.data;
                                                // Fill
                                                let di = 0;
                                                if (tilesFlat && lightFlat && H) {
                                                    // x-major scan for cache friendliness on column-major flat arrays
                                                    // We write into row-major ImageData with a constant stride.
                                                    for (let y = 0; y < hTiles; y++) {
                                                        const wy = startY + y;
                                                        const rowBase = (y * wTiles) << 2;
                                                        for (let x = 0; x < wTiles; x++) {
                                                            const wx = startX + x;
                                                            const idx = (wx * H + wy) | 0;
                                                            const id = tilesFlat[idx] | 0;
                                                            const a = id ? lut[lightFlat[idx] | 0] : 0;
                                                            const o = rowBase + (x << 2);
                                                            data[o] = rgb.r;
                                                            data[o + 1] = rgb.g;
                                                            data[o + 2] = rgb.b;
                                                            data[o + 3] = a ? ((a * 255) | 0) : 0;
                                                        }
                                                    }
                                                } else {
                                                    for (let y = startY; y <= endY; y++) {
                                                        for (let x = startX; x <= endX; x++) {
                                                            const id = tilesCols && tilesCols[x] ? (tilesCols[x][y] | 0) : 0;
                                                            const lv = lightCols && lightCols[x] ? (lightCols[x][y] | 0) : 0;
                                                            const a = id ? lut[lv] : 0;
                                                            data[di++] = rgb.r;
                                                            data[di++] = rgb.g;
                                                            data[di++] = rgb.b;
                                                            data[di++] = a ? ((a * 255) | 0) : 0;
                                                        }
                                                    }
                                                }

                                                mask.ctx.putImageData(mask.imageData, 0, 0);

                                                const oldSmooth = ctx.imageSmoothingEnabled;
                                                ctx.imageSmoothingEnabled = false;
                                                ctx.globalAlpha = 1;
                                                ctx.globalCompositeOperation = 'source-over';

                                                ctx.drawImage(
                                                    mask.canvas,
                                                    0, 0, wTiles, hTiles,
                                                    startX * ts - camCeilX,
                                                    startY * ts - camCeilY,
                                                    wTiles * ts,
                                                    hTiles * ts
                                                );

                                                ctx.imageSmoothingEnabled = oldSmooth;
                                                ctx.globalAlpha = 1;
                                            };
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                    // ─────────────────────────────────────────────────────────────
                                    // 3) TileLogic diff: column-view bitpack (only when diff is huge) + apply path
                                    // ─────────────────────────────────────────────────────────────
                                    try {
                                        if (typeof TileLogicEngine !== 'undefined' && TileLogicEngine) {

                                            // ---- Worker source: add packed path when len is large ----
                                            if (!TileLogicEngine.__tu_packXYWorkerSourcePatched && typeof TileLogicEngine._workerSource === 'function') {
                                                const _orig = TileLogicEngine._workerSource;
                                                TileLogicEngine._workerSource = function () {
                                                    let s = _orig.call(TileLogicEngine);
                                                    try {
                                                        if (!s || s.indexOf("type: 'changes'") === -1) return s;
                                                        if (s.indexOf("type: 'changesXY'") !== -1) return s;

                                                        // 1) inject allocator + threshold near pool definition
                                                        const poolDecl = "const __TU_OUT_POOL__ = [];";
                                                        if (s.indexOf(poolDecl) !== -1) {
                                                            const inject = `
  const __TU_PACK_THRESHOLD__ = 6144; // ints (3 per change); only pack when very large
  function __tuAllocOutPacked(n) {
    const need = (n << 3) >>> 0; // 8 bytes per change (xy uint32 + ids uint16 + pad)
    let b = null;
    for (let i = __TU_OUT_POOL__.length - 1; i >= 0; i--) {
      const cand = __TU_OUT_POOL__[i];
      if (cand && cand.byteLength >= need) { b = cand; __TU_OUT_POOL__.splice(i, 1); break; }
    }
    return b || new ArrayBuffer(need);
  }
`;
                                                            s = s.replace(poolDecl, poolDecl + inject);
                                                        }

                                                        // 2) replace postMessage line with conditional packed send
                                                        const needle = "postMessage({ type: 'changes', buf: buf, len: len }, [buf]);";
                                                        if (s.indexOf(needle) !== -1) {
                                                            const repl = `
      if (len >= __TU_PACK_THRESHOLD__) {
        const n = (len / 3) | 0;
        const pbuf = __tuAllocOutPacked(n);
        const xy = new Uint32Array(pbuf, 0, n);
        const ids = new Uint16Array(pbuf, n * 4, n);
        for (let k = 0, j = 0; k < n; k++, j += 3) {
          const idx = __tuOutView[j] | 0;
          const x = (idx / H) | 0;
          const y = idx - x * H;
          xy[k] = ((x & 0xffff) << 16) | (y & 0xffff);
          const oldId = __tuOutView[j + 1] | 0;
          const newId = __tuOutView[j + 2] | 0;
          ids[k] = ((oldId & 255) | ((newId & 255) << 8)) & 0xffff;
        }
        try { __TU_OUT_POOL__.push(buf); } catch(_) { /* silently ignore */ }
        postMessage({ type: 'changesXY', buf: pbuf, n: n }, [pbuf]);
      } else {
        postMessage({ type: 'changes', buf: buf, len: len }, [buf]);
      }`;
                                                            s = s.replace(needle, repl);
                                                        }

                                                        return s;
                                                    } catch (_) {
                                                        return s;
                                                    }
                                                };
                                                TileLogicEngine.__tu_packXYWorkerSourcePatched = true;
                                            }

                                            // ---- Main thread: accept changesXY and apply using column view getter ----
                                            if (TileLogicEngine.prototype && !TileLogicEngine.prototype.__tu_packXYApplyWrapped) {
                                                TileLogicEngine.prototype.__tu_packXYApplyWrapped = true;

                                                // Column view getter (cached)
                                                TileLogicEngine.prototype.__tu_getTileCol = function (x) {
                                                    const wx = x | 0;
                                                    if (this.__tu_lastColX === wx && this.__tu_lastCol) return this.__tu_lastCol;
                                                    const cols = this.world && this.world.tiles;
                                                    const col = cols ? cols[wx] : null;
                                                    this.__tu_lastColX = wx;
                                                    this.__tu_lastCol = col;
                                                    return col;
                                                };

                                                // Wrap _initWorker to extend onmessage
                                                if (typeof TileLogicEngine.prototype._initWorker === 'function') {
                                                    const _origInit = TileLogicEngine.prototype._initWorker;
                                                    TileLogicEngine.prototype._initWorker = function () {
                                                        _origInit.call(this);

                                                        try {
                                                            if (!this.worker || this.__tu_packXYOnMsgWrapped) return;
                                                            this.__tu_packXYOnMsgWrapped = true;

                                                            const self = this;
                                                            const w = this.worker;
                                                            const oldHandler = w.onmessage;

                                                            // pending pool (reuse objects)
                                                            const pendingPool = [];
                                                            function allocPendingPacked(buf, n) {
                                                                const o = pendingPool.pop() || { type: 'xy', buf: null, n: 0, pos: 0 };
                                                                o.type = 'xy';
                                                                o.buf = buf;
                                                                o.n = n | 0;
                                                                o.pos = 0;
                                                                return o;
                                                            }
                                                            function allocPendingArr(arr) {
                                                                const o = pendingPool.pop() || { type: 'i32', arr: null, pos: 0 };
                                                                o.type = 'i32';
                                                                o.arr = arr;
                                                                o.pos = 0;
                                                                return o;
                                                            }
                                                            function freePending(o) {
                                                                o.type = 'i32';
                                                                o.arr = null;
                                                                o.buf = null;
                                                                o.n = 0;
                                                                o.pos = 0;
                                                                pendingPool.push(o);
                                                            }
                                                            self.__tu_pendingPool2 = { allocPendingPacked, allocPendingArr, freePending };

                                                            w.onmessage = (e) => {
                                                                const msg = e.data;
                                                                if (!msg || !msg.type) { if (oldHandler) try { oldHandler(e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); } return; }

                                                                if (msg.type === 'changes' && msg.buf) {
                                                                    try {
                                                                        const len = (msg.len | 0) > 0 ? (msg.len | 0) : 0;
                                                                        const arr = len ? new Int32Array(msg.buf, 0, len) : new Int32Array(msg.buf);
                                                                        self.pending.push(allocPendingArr(arr));
                                                                        self._scheduleApply();
                                                                        return;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }

                                                                if (msg.type === 'changesXY' && msg.buf) {
                                                                    try {
                                                                        const n = (msg.n | 0) > 0 ? (msg.n | 0) : 0;
                                                                        self.pending.push(allocPendingPacked(msg.buf, n));
                                                                        self._scheduleApply();
                                                                        return;
                                                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }

                                                                if (oldHandler) {
                                                                    try { oldHandler(e); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            };
                                                        } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                    };
                                                }

                                                // Replace _applyPending with a packed-aware version (keeps recycle behavior)
                                                if (typeof TileLogicEngine.prototype._applyPending === 'function') {
                                                    const _origApply = TileLogicEngine.prototype._applyPending;

                                                    TileLogicEngine.prototype._applyPending = function (deadline) {
                                                        // If we don't have packed items, just use original (perfpack wrapper will recycle buffers)
                                                        let hasPacked = false;
                                                        for (let i = 0; i < this.pending.length; i++) {
                                                            const it = this.pending[i];
                                                            if (it && it.type === 'xy') { hasPacked = true; break; }
                                                        }
                                                        if (!hasPacked) return _origApply.call(this, deadline);

                                                        this._applyScheduled = false;
                                                        if (!this.pending.length) return;

                                                        const game = this.game;
                                                        const world = this.world;
                                                        const renderer = game && game.renderer;

                                                        const BL = (typeof BLOCK_LIGHT !== 'undefined') ? BLOCK_LIGHT : null;

                                                        let any = false;
                                                        const lightSeeds = [];
                                                        const maxLightSeeds = 16;

                                                        const maxOps = 2000;
                                                        let ops = 0;

                                                        const pool = this.__tu_pendingPool2 || null;
                                                        const getCol = this.__tu_getTileCol ? this.__tu_getTileCol.bind(this) : null;

                                                        while (this.pending.length && (deadline.timeRemaining() > 2 || deadline.didTimeout) && ops < maxOps) {
                                                            const cur = this.pending[0];

                                                            if (cur.type === 'xy') {
                                                                const n = cur.n | 0;
                                                                const buf = cur.buf;
                                                                if (!buf || !n) { this.pending.shift(); ops++; continue; }

                                                                const xy = new Uint32Array(buf, 0, n);
                                                                const ids = new Uint16Array(buf, n * 4, n);

                                                                while ((cur.pos | 0) < n && ops < maxOps) {
                                                                    const k = cur.pos | 0;
                                                                    cur.pos = k + 1;

                                                                    const v = xy[k] >>> 0;
                                                                    const x = (v >>> 16) & 0xffff;
                                                                    const y = v & 0xffff;
                                                                    if (x >= (this.w | 0) || y >= (this.h | 0)) { ops++; continue; }

                                                                    const pack = ids[k] >>> 0;
                                                                    const expectOld = pack & 255;
                                                                    const newId = (pack >>> 8) & 255;

                                                                    const col = getCol ? getCol(x) : (world.tiles ? world.tiles[x] : null);
                                                                    if (!col) { ops++; continue; }
                                                                    const oldMain = col[y] | 0;
                                                                    if (oldMain !== expectOld) { ops++; continue; }

                                                                    col[y] = newId;
                                                                    any = true;

                                                                    try { renderer && renderer.invalidateTile && renderer.invalidateTile(x, y); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                                                    if (BL) {
                                                                        const blOld = BL[expectOld] | 0;
                                                                        const blNew = BL[newId] | 0;
                                                                        if (blOld !== blNew && lightSeeds.length < maxLightSeeds) lightSeeds.push([x, y]);
                                                                    }

                                                                    this._minimapDirty = true;
                                                                    ops++;
                                                                }

                                                                if ((cur.pos | 0) >= n) {
                                                                    this.pending.shift();
                                                                    // recycle packed buffer back to worker
                                                                    const rbuf = cur.buf;
                                                                    if (rbuf && this.worker && typeof this.worker.postMessage === 'function') {
                                                                        try { this.worker.postMessage({ type: 'recycle', buf: rbuf }, [rbuf]); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                    }
                                                                    if (pool && pool.freePending) try { pool.freePending(cur); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                } else {
                                                                    break;
                                                                }
                                                            } else {
                                                                // Non-packed: delegate to original apply for this timeslice (keeps semantics & recycling)
                                                                _origApply.call(this, deadline);
                                                                break;
                                                            }
                                                        }

                                                        if (any) {
                                                            if (lightSeeds.length && game && game._deferLightUpdate) {
                                                                for (let i = 0; i < lightSeeds.length; i++) {
                                                                    const p = lightSeeds[i];
                                                                    try { game._deferLightUpdate(p[0], p[1]); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                                }
                                                            }

                                                            const now = performance.now();
                                                            if (this._minimapDirty && (now - this._lastMinimapFlush > 600)) {
                                                                this._minimapDirty = false;
                                                                this._lastMinimapFlush = now;
                                                                try { game._deferMinimapUpdate && game._deferMinimapUpdate(); } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }
                                                            }
                                                        }

                                                        if (this.pending.length) this._scheduleApply();
                                                    };
                                                }
                                            }
                                        }
                                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[Debug] Silently caught:', e); }

                                })();