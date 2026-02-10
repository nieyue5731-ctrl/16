
                                /**
                                 * Runtime Optimization Patch (cleaned)
                                 * - Renderer: skip near-black tiles
                                 * - Removed duplicate TouchController.getInput (already zero-alloc in class)
                                 * - Removed no-op TileLogicEngine wrapper
                                 * - Removed unsafe game.loop wrapping (adaptive substeps handled in Game.loop itself)
                                 */
                                (function () {
                                    'use strict';

                                    // Renderer: skip drawing tiles that are too dark to see
                                    if (typeof Renderer !== 'undefined') {
                                        const RP = Renderer.prototype;
                                        const originalDrawTile = RP.drawTile;
                                        if (originalDrawTile) {
                                            RP.drawTile = function (ctx, id, x, y, size, light) {
                                                if (light <= 0.05) return;
                                                originalDrawTile.call(this, ctx, id, x, y, size, light);
                                            };
                                        }
                                    }
                                })();
                                

(function () {
  'use strict';

  if (!window.TU || !window.TU.Game || !window.TU.Game.prototype) return;

  const proto = window.TU.Game.prototype;
  if (proto.__TU_FINAL_SPREADLIGHT_PATCHED__) return;

  const _orig = proto._spreadLight;

  proto._spreadLight = function (sx, sy, level) {
    try {
      const world = this.world;
      if (!world || !world.tiles || !world.light) {
        if (typeof _orig === 'function') return _orig.call(this, sx, sy, level);
        return;
      }

      const w = world.w | 0;
      const h = world.h | 0;
      if (w <= 0 || h <= 0) {
        if (typeof _orig === 'function') return _orig.call(this, sx, sy, level);
        return;
      }

      const tiles = world.tiles;
      const light = world.light;

      // SOLID lookup table（优先使用 TU.BLOCK_SOLID）
      const SOLID = (window.TU && window.TU.BLOCK_SOLID) || window.BLOCK_SOLID;
      const solidArr = (SOLID && typeof SOLID.length === 'number') ? SOLID : null;
      if (!solidArr) {
        if (typeof _orig === 'function') return _orig.call(this, sx, sy, level);
        return;
      }

      // 访问标记数组（避免 Set 分配）
      const size = w * h;
      if (!this._lightVisited || this._lightVisited.length !== size) {
        this._lightVisited = new Uint32Array(size);
        this._lightVisitMark = 1;
      }
      let mark = (++this._lightVisitMark) >>> 0;
      if (mark === 0) {
        this._lightVisited.fill(0);
        mark = 1;
        this._lightVisitMark = 1;
      }
      const visited = this._lightVisited;

      const qx = this._lightQx || (this._lightQx = []);
      const qy = this._lightQy || (this._lightQy = []);
      const ql = this._lightQl || (this._lightQl = []);
      qx.length = 0; qy.length = 0; ql.length = 0;

      sx = sx | 0;
      sy = sy | 0;
      level = level | 0;
      if (level <= 0) return;

      qx.push(sx); qy.push(sy); ql.push(level);

      let head = 0;
      while (head < qx.length) {
        const x = qx[head] | 0;
        const y = qy[head] | 0;
        const l = ql[head] | 0;
        head++;

        if (l <= 0 || x < 0 || x >= w || y < 0 || y >= h) continue;

        const idx = x + y * w;
        if (visited[idx] === mark) continue;
        visited[idx] = mark;

        const colL = light[x];
        if (!colL) continue;
        if (l > colL[y]) colL[y] = l;

        const colT = tiles[x];
        if (!colT) continue;
        const id = colT[y] | 0;

        const nl = l - (solidArr[id] ? 2 : 1);
        if (nl > 0) {
          qx.push(x - 1, x + 1, x, x);
          qy.push(y, y, y - 1, y + 1);
          ql.push(nl, nl, nl, nl);
        }

        // Hard cap: prevent runaway queue growth
        if (qx.length > 12000) break;
      }
    } catch (e) {
      try { if (typeof _orig === 'function') return _orig.call(this, sx, sy, level); } catch (_) {}
    }
  };

  proto.__TU_FINAL_SPREADLIGHT_PATCHED__ = true;
  console.log('🛠️ Final SpreadLight Patch Applied (safe)');
})();




(function() {
    'use strict';

    // 页面卸载时清理资源
    window.addEventListener('beforeunload', function() {
        // 清理所有Worker
        if (window.TU && TU._worldWorkerClient && TU._worldWorkerClient.worker) {
            try { TU._worldWorkerClient.worker.terminate(); } catch (e) {}
        }
        // 清理ImageBitmap
        if (window.TU && TU._worldWorkerClient && TU._worldWorkerClient._lastBitmap) {
            try { TU._worldWorkerClient._lastBitmap.close(); } catch (e) {}
        }
        // 清理资源管理器
        if (window.TU_Defensive && window.TU_Defensive.ResourceManager) {
            try { window.TU_Defensive.ResourceManager.disposeAll(); } catch (e) {}
        }
    });

    // 单一健康检查定时器 (每30秒)
    setInterval(function() {
        // 检查Worker健康状态
        if (window.TU && TU._worldWorkerClient) {
            const client = TU._worldWorkerClient;
            if (client._frameTimeouts > 10) {
                console.error('[HealthCheck] Too many frame timeouts, resetting worker');
                try {
                    if (client.worker) client.worker.terminate();
                    client.worker = null;
                    client._initSent = false;
                    client._frameTimeouts = 0;
                    client._frameInFlight = false;
                } catch (e) {}
            }
        }

        // 检查游戏状态
        const game = window.__GAME_INSTANCE__ || window.game;
        if (game) {
            // 检查玩家位置有效性
            if (game.player && game.world) {
                const px = game.player.x;
                const py = game.player.y;
                if (typeof px !== 'number' || typeof py !== 'number' ||
                    isNaN(px) || isNaN(py) || !isFinite(px) || !isFinite(py)) {
                    console.error('[HealthCheck] Invalid player position, resetting');
                    game.player.x = game.world.w * 16 / 2;
                    game.player.y = game.world.h * 16 / 2;
                }
            }

            // 检查游戏循环是否冻结
            if (game._lastFrameTime && Date.now() - game._lastFrameTime > 10000) {
                console.error('[HealthCheck] Game loop appears frozen');
                if (typeof game.loop === 'function' && !game._rafRunning) {
                    game._rafRunning = true;
                    requestAnimationFrame((ts) => game.loop(ts));
                }
            }
        }
    }, 30000);

    console.log('[Cleanup] 统一清理与健康检查已注册');
})();

