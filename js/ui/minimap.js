            render(px, py) {
                // 每帧仅做一次 drawImage + 画玩家点，避免玩家点“拖尾”
                this.ctx.drawImage(this._mapCanvas, 0, 0);
                this.renderPlayer(px, py);
            }

            renderPlayer(px, py) {
                const mx = (px / CONFIG.TILE_SIZE / this.world.w) * 160;
                const my = (py / CONFIG.TILE_SIZE / this.world.h) * 100;

                // 发光玩家点
                this.ctx.shadowColor = '#ffeaa7';
                this.ctx.shadowBlur = 6;
                this.ctx.fillStyle = '#ffeaa7';
                this.ctx.beginPath();
                this.ctx.arc(mx, my, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }

            invalidate() { this.dirty = true; }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        //                                    游戏主类
        // ═══════════════════════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════════════════════════
        //                               系统分层（可维护性）

        // ───────────────────────── Exports ─────────────────────────
        window.TU = window.TU || {};
        Object.assign(window.TU, { Minimap });

    



        (() => {
            const minimapEl = document.getElementById('minimap');
            if (!minimapEl) return;

            const root = document.documentElement;
            const isMobileNow = () => root.classList.contains('is-mobile');

            window.TU = window.TU || {};

            const computeScale = (state) => {
                // offsetWidth/Height 不受 transform 影响，正好作为“基准尺寸”
                const baseW = minimapEl.offsetWidth || 160;
                const baseH = minimapEl.offsetHeight || 100;

                let targetW = baseW, targetH = baseH;

                if (state === 'collapsed') {
                    targetW = 44; targetH = 44;
                } else if (state === 'expanded') {
                    targetW = Math.min(360, Math.round(window.innerWidth * 0.70));
                    targetH = Math.min(240, Math.round(window.innerHeight * 0.45));
                }

                const sx = Math.max(0.1, targetW / baseW);
                const sy = Math.max(0.1, targetH / baseH);

                minimapEl.style.setProperty('--mm-sx', sx.toFixed(4));
                minimapEl.style.setProperty('--mm-sy', sy.toFixed(4));
            };

            const setState = (state) => {
                minimapEl.dataset.state = state;
                minimapEl.classList.toggle('minimap-collapsed', state === 'collapsed');
                minimapEl.classList.toggle('minimap-expanded', state === 'expanded');

                // 折叠时跳过小地图渲染，省电（尤其移动端）
                window.TU.MINIMAP_VISIBLE = (state !== 'collapsed');

                computeScale(state);
            };

            // 初始化：移动端默认折叠（关闭），桌面端默认正常显示
            setState(isMobileNow() ? 'collapsed' : 'normal');

            const toggle = () => {
                const state = minimapEl.dataset.state || 'normal';
                if (state === 'collapsed') {
                    setState('expanded');
                } else if (state === 'expanded') {
                    setState(isMobileNow() ? 'collapsed' : 'normal');
                } else {
                    setState('expanded');
                }
            };

            // 对外暴露：键盘快捷键 / 其他系统可直接调用
            window.TU.toggleMinimap = toggle;
            window.TU.setMinimapState = setState;

            // resize/orientation 变化时重算缩放（保持展开尺寸一致）
            let raf = 0;
            const sync = () => {
                raf = 0;
                computeScale(minimapEl.dataset.state || 'normal');
            };
            const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
            window.addEventListener('resize', schedule, { passive: true });
            window.addEventListener('orientationchange', schedule, { passive: true });

            minimapEl.setAttribute('role', 'button');
            minimapEl.tabIndex = 0;
            minimapEl.setAttribute('aria-label', '小地图（点击展开/收起）');
            minimapEl.setAttribute('aria-keyshortcuts', 'M');

            minimapEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle();
            });

            minimapEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        })();
    



        class InventoryUI {
            /** @param {Game} game */
            constructor(game) {
                this.game = game;

                this.isOpen = false;
                this.MAX_SIZE = (window.INVENTORY_LIMITS && INVENTORY_LIMITS.MAX_SIZE) ? INVENTORY_LIMITS.MAX_SIZE : 36;
                this.MAX_STACK = (window.INVENTORY_LIMITS && INVENTORY_LIMITS.MAX_STACK) ? INVENTORY_LIMITS.MAX_STACK : 999;
                this.EMPTY_ID = '__empty__';

                this.overlay = document.getElementById('inventory-overlay');
                this.panel = document.getElementById('inventory-panel');

                this.hotbarGrid = document.getElementById('inv-hotbar-grid');
                this.backpackGrid = document.getElementById('inv-backpack-grid');

                this.closeBtn = document.getElementById('inv-close');
                this.capacityText = document.getElementById('inv-capacity-text');
                this.capacityFill = document.getElementById('inv-capacity-fill');

                this.previewBox = document.getElementById('inv-preview');
                this.nameEl = document.getElementById('inv-item-name');
                this.metaEl = document.getElementById('inv-item-meta');
                this.descEl = document.getElementById('inv-item-desc');

                this.btnSort = document.getElementById('inv-sort');
                this.btnToHotbar = document.getElementById('inv-to-hotbar');
                this.btnPutBack = document.getElementById('inv-put-back');
                this.btnDrop = document.getElementById('inv-drop');

                this.btnTop = document.getElementById('btn-inventory');
                this.btnFloat = document.getElementById('btn-bag-toggle');

                this.heldEl = document.getElementById('inv-held');

                this._slotEls = new Array(this.MAX_SIZE);
                this._slotCanvases = new Array(this.MAX_SIZE);
                this._slotCtx = new Array(this.MAX_SIZE);
                this._slotCountEls = new Array(this.MAX_SIZE);
                this._slotEmojiEls = new Array(this.MAX_SIZE);
                this._lastId = new Array(this.MAX_SIZE).fill(null);
                this._lastCount = new Array(this.MAX_SIZE).fill(-1);

                this._selectedIdx = 0;
                this._cursorItem = null;
                this._cursorFrom = -1;

                this._previewCanvas = document.createElement('canvas');
                this._previewCanvas.width = this._previewCanvas.height = 56;
                this._previewCtx = this._previewCanvas.getContext('2d', { willReadFrequently: true });
                this._previewCtx.imageSmoothingEnabled = false;

                this._previewEmoji = document.createElement('span');
                this._previewEmoji.className = 'item-icon';
                this._previewEmoji.style.display = 'none';

                this.previewBox.innerHTML = '';
                this.previewBox.appendChild(this._previewEmoji);
                this.previewBox.appendChild(this._previewCanvas);
                this._previewCanvas.style.display = 'none';

                this._heldCanvas = document.createElement('canvas');
                this._heldCanvas.width = this._heldCanvas.height = 34;
                this._heldCtx = this._heldCanvas.getContext('2d', { willReadFrequently: true });
                this._heldCtx.imageSmoothingEnabled = false;

                this._heldEmoji = document.createElement('span');
                this._heldEmoji.className = 'item-icon';
                this._heldEmoji.style.display = 'none';

                this._heldCount = document.createElement('span');
                this._heldCount.className = 'count';

                this.heldEl.innerHTML = '';
                this.heldEl.appendChild(this._heldEmoji);
                this.heldEl.appendChild(this._heldCanvas);
                this.heldEl.appendChild(this._heldCount);

                this._buildSlots();
                this._bind();
