# Refactor Journal - Terraria Ultra Modular Architecture

## Phase 0: Baseline Snapshot

### Module/Class Responsibility Map

| Module | Responsibility | Lines (approx) |
|--------|---------------|----------------|
| TU_Defensive | Error handling, type guards, safe math, boundary checks, input validation, world access | ~400 |
| EventManager | Listener lifecycle management | ~25 |
| ParticlePool | Object pooling for particles | ~55 |
| RingBuffer | Circular buffer (unused) | ~25 |
| PERF_MONITOR | Bridge to PerfMonitor | ~5 |
| ObjectPool | Generic typed object pool | ~90 |
| VecPool | 2D vector pool (O(1) release via _pooled tag) | ~60 |
| ArrayPool | Sized array pool with bucket strategy | ~50 |
| MemoryManager | Periodic pool cleanup | ~60 |
| PerfMonitor | FPS/frame-time tracking | ~100 |
| TextureCache | Map-based LRU texture cache | ~70 |
| BatchRenderer | Batched draw calls (dead code) | ~40 |
| LazyLoader | Promise-based lazy loading (dead code) | ~30 |
| Utils | clamp, lerp, hexToRgb, isMobile, etc. | ~120 |
| SafeAccess/WorldAccess | Safe tile/light get/set with bounds checking | ~30 |
| DOM | getElementById/querySelector helpers | ~10 |
| PatchManager | once()/wrapProto() for monkey-patches | ~25 |
| GameSettings | Load/save/sanitize settings from localStorage | ~100 |
| Toast | Notification popups | ~15 |
| FullscreenManager | Fullscreen API wrapper | ~60 |
| AudioManager | Web Audio API for SFX | ~120 |
| SaveSystem | localStorage save/load with RLE diff encoding | ~200 |
| wireUXUI | Connects pause/settings/help overlays | ~250 |
| CONFIG | Game constants (tile size, world size, physics) | ~40 |
| BLOCK | Block type enum (162 types) | ~100 |
| BLOCK_DATA | Block metadata (name, solid, color, hardness) | ~700 |
| TextureGenerator | Procedural pixel-art textures | ~600 |
| WorldGenerator | Terrain generation with biomes | ~2000 |
| NoiseGenerator | Simplex/FBM noise | ~80 |
| ParticleSystem | Mining/placement particle effects | ~80 |
| DroppedItemManager | Dropped item physics & pickup | ~350 |
| AmbientParticles | Firefly/weather DOM particles | ~150 |
| Player | Player entity with physics, sprint, coyote time | ~500 |
| TouchController | Mobile joystick/button input | ~200 |
| Renderer | Canvas 2D rendering (sky, world, lighting, UI) | ~1100 |
| renderParallaxMountains | Parallax mountain background | ~300 |
| CraftingSystem | Recipe management and crafting UI | ~150 |
| QualityManager | Auto quality adjustment based on FPS | ~300 |
| UIManager | HUD updates (health, mana, hotbar, FPS) | ~450 |
| Minimap | Mini-map rendering and toggle | ~120 |
| InventoryUI | Full inventory management UI | ~750 |
| InputManager | Keyboard/mouse input handling | ~300 |
| Game | Core game loop, init, update, camera, interaction | ~3400 |
| TileLogicEngine | Water physics + redstone-like logic (Worker/idle) | ~1200 |
| Weather patches | Weather system, biome patches, structure gen | ~5000+ |
| Boot | Game instantiation and startup | ~30 |
| Health check | 30s interval health monitoring | ~65 |

### Dependency Graph Summary

**Load Order (Critical):**
1. TU_Defensive (head) - establishes global error handling
2. EventManager, ParticlePool, PERF_MONITOR (between head/body)
3. ObjectPool, VecPool, ArrayPool, MemoryManager, PerfMonitor, TextureCache
4. Utils, DOM, SafeAccess, PatchManager
5. GameSettings, Toast, FullscreenManager, AudioManager, SaveSystem
6. CONFIG, BLOCK, BLOCK_DATA, BLOCK_COLOR, BLOCK_HARDNESS, BLOCK_SOLID
7. TextureGenerator, WorldGenerator
8. ParticleSystem, DroppedItemManager, AmbientParticles, Player
9. TouchController, Renderer, renderParallaxMountains
10. CraftingSystem, QualityManager, UIManager, Minimap, InventoryUI
11. InputManager
12. Game class
13. Patch layers (weather, biomes, structures, sprint, postFX, canvas FX)
14. TileLogicEngine, water physics
15. Boot, health check

### Patch Chain Final Versions

| Method | Patched by | Final version location |
|--------|-----------|----------------------|
| Renderer.prototype.renderWorld | Multiple patches in weather/render blocks | Last patch in render-patches.js |
| Renderer.prototype.renderSky | Weather patch layer | weather-patch.js |
| Renderer.prototype._getSkyBucket | Multiple conflicting patches | render-patches.js (bypassed in parallax) |
| Game.prototype._spreadLight | Final SpreadLight Patch | lighting-patch.js |
| TouchController.prototype.getInput | Runtime patch (removed as no-op) | Original class definition |
| Game.prototype.loop | Adaptive substeps in Game class itself | game.js |
| SaveSystem | Three layers merged | save.js + save-idb-patch.js |

### Behavior Baseline Checklist

- [x] Page loads without console errors
- [x] World generates with biomes and structures
- [x] Player movement (WASD/arrows + mobile joystick)
- [x] Mining (left click / mine button)
- [x] Block placement (right click / place button)
- [x] Lighting system (torch placement, day/night)
- [x] Water physics (flow down, spread sideways)
- [x] UI: Health/mana bars, hotbar, FPS counter
- [x] Inventory system (B/I key)
- [x] Crafting system (C key)
- [x] Save/load (localStorage)
- [x] Weather effects
- [x] Audio (mine, place, pickup SFX)
- [x] Mobile touch controls
- [x] Minimap
- [x] Fullscreen toggle
- [x] Toast notifications
- [x] Pause/Settings/Help overlays

## Phase 1: Safe Cleanup

### Actions Taken
1. **File renamed**: `index (92).html` -> modular structure (`index.html` + `css/` + `js/`)
2. **Dead code identified**: RingBuffer, BatchRenderer, LazyLoader - retained in extraction but marked for potential removal
3. **VecPool.release**: Already uses O(1) `_pooled` tag (no includes() call found)
4. **ArrayPool.release**: Already uses Map-based pools (no includes() call)
5. **ObjectPool.get**: No "clear all properties" anti-pattern found - clean implementation
6. **PerfMonitor.getMinFPS**: Uses `Math.max(...validSamples)` which could blow stack on large arrays - samples capped at 60 which is safe
7. **CSS consolidated**: 6 style blocks -> 6 organized CSS files
8. **HTML structure fixed**: Scripts moved to body, proper head/body separation

### Evidence for Dead Code
- **RingBuffer**: `grep -r 'RingBuffer' js/` - only defined in event-manager.js, window.RingBuffer assigned, no consumers found
- **BatchRenderer**: defined in object-pool.js, `window.BatchRenderer` assigned, no calls to `.begin()/.flush()/.addTile()` found outside definition
- **LazyLoader**: defined in object-pool.js, `window.LazyLoader` assigned, no calls to `.load()/.isLoaded()` found

## Phase 2: CSS Consolidation

### CSS File Organization
| File | Content | Size |
|------|---------|------|
| css/components.css | Top buttons, toast, UX overlay (from inline style) | 12KB |
| css/main.css | All core UI styles (HUD, hotbar, minimap, loading, etc.) | 49KB |
| css/frost-theme.css | Frosted glass theme overrides | 8KB |
| css/performance.css | Low-power/quality CSS downgrades | 3KB |
| css/optimizations.css | Containment, GPU hints, reduced-motion | 1KB |
| css/low-perf.css | Low perf particle/VFX hiding | 0.1KB |

### CSS Improvements
- Multiple `:root` blocks consolidated within their respective files
- `!important` usage retained where theme overrides require it (frost-theme.css)
- Mobile styles via `html.is-mobile` class retained for JS fallback path

## Phase 3: Monkey-Patch Organization

Patch layers extracted as separate files maintaining original execution order:
- `js/engine/world-patches.js` - World generation enhancements
- `js/engine/render-patches.js` - Sky, world rendering, parallax mountains
- `js/systems/weather-patch.js` - Weather system, biome patches
- `js/engine/lighting-patch.js` - Final spreadLight implementation
- `js/boot/runtime-patches.js` - Renderer tile skip optimization

## Phase 4-8: Architecture

### Final Project Structure
```
index.html                          - Clean HTML with proper structure
css/
  components.css                    - UI component styles
  main.css                          - Core game UI styles
  frost-theme.css                   - Glass morphism theme
  performance.css                   - Performance mode CSS
  optimizations.css                 - GPU/containment hints
  low-perf.css                      - Low-perf particle hiding
js/
  core/
    defensive.js                    - Error handling, type guards, safe math
    event-manager.js                - Event lifecycle management
    naming-aliases.js               - TU namespace aliases
    utils.js                        - Utility functions, DOM helpers
    constants.js                    - CONFIG, BLOCK, BLOCK_DATA
  systems/
    settings.js                     - GameSettings
    audio.js                        - AudioManager
    save.js                         - SaveSystem
    save-idb-patch.js               - IDB save extension
    fullscreen.js                   - FullscreenManager
    quality.js                      - QualityManager
    tile-logic-engine.js            - Water/logic simulation
    water-physics.js                - Water physics system
    water-pump-patch.js             - Water pump mechanics
    weather-patch.js                - Weather system
    logic-drop-patch.js             - Logic block drops
  engine/
    game.js                         - Game class (core loop)
    renderer.js                     - (merged into render-patches.js)
    render-patches.js               - Full renderer + patches
    world-generator.js              - WorldGenerator
    world-patches.js                - World gen enhancements
    texture-generator.js            - Procedural textures
    structures-data.js              - Structure definitions
    lighting-patch.js               - Light spread BFS
  entities/
    player.js                       - Player entity
    particle-system.js              - Mining particles
    dropped-items.js                - Dropped item physics
    ambient-particles.js            - Firefly/weather particles
  ui/
    toast.js                        - Toast notifications
    toast-safe-patch.js             - Toast rate limiting
    crafting-ui.js                  - Crafting interface
    ui-manager.js                   - HUD manager
    ui-flush.js                     - UI batch flush
    minimap.js                      - Minimap renderer
    minimap-toggle.js               - Minimap expand/collapse
    inventory-ui.js                 - Inventory exports
    inventory-ui-full.js            - Full inventory UI
    ux-wiring.js                    - Overlay wiring
  input/
    input-manager.js                - Keyboard/mouse input
    touch-controller.js             - Mobile touch input
  performance/
    object-pool.js                  - Object/Vec/Array pools + caches
    particle-pool.js                - Particle object pool
    perf-monitor-bridge.js          - PERF_MONITOR bridge
  boot/
    loading-particles.js            - Loading screen particles
    boot.js                         - Game bootstrap
    runtime-patches.js              - Runtime optimizations
    health-check.js                 - Health monitoring
docs/
  RefactorJournal.md                - This file
  BehaviorChanges.md                - Behavioral changes log
  RiskRegister.md                   - Risk tracking
  VerificationChecklist.md          - Gate check results
  FinalAudit.md                     - Final audit report
```
