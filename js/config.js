/* 合成大猫咪 · 数值与美术配置
 * 逻辑坐标系固定 720×1280（竖屏 9:16），所有数值都按这个坐标系写。
 */
(function () {
  const CFG = (window.CATCFG = {
    W: 720,
    H: 1280,          // 基准世界高（9:16）；更长的手机屏幕会把它拉长
    H_BASE: 1280,

    /* ---------- 容器 ---------- */
    WALL: 46,          // 左右墙内边距（猫不出界）
    FLOOR: 1204,       // 罐底 y
    TOP: 140,          // 罐口 y（视觉用）
    DANGER_Y: 320,     // 警戒线
    DROP_Y: 202,       // 待投放猫的高度

    /* ---------- 物理 ---------- */
    GRAVITY: 2600,
    SUBSTEP: 1 / 120,
    MAX_SUBSTEPS: 5,
    RESTITUTION: 0.05,     // 猫之间弹性
    WALL_RESTITUTION: 0.22,
    FRICTION: 0.32,
    AIR_DAMP: 0.9992,
    POS_SLOP: 0.04,
    POS_PERCENT: 0.92,
    SOLVER_ITER: 4,

    /* ---------- 玩法 ---------- */
    DROP_COOLDOWN: 0.34,   // 两次投放最短间隔（秒）
    MERGE_GAP: 4,          // 圆心距 < r1+r2+gap 视为贴上 -> 合成
    OVER_GRACE: 1.7,       // 超线停留多久判负
    OVER_DECAY: 2.2,       // 没超线时计时回落速度
    COMBO_WINDOW: 0.85,    // 连锁判定窗口
    SPAWN_WEIGHTS: [[0, 30], [1, 26], [2, 20], [3, 15], [4, 9]],

    /* 两只 L 级合成后得分（下标 = L） */
    SCORE: [1, 3, 6, 10, 16, 24, 34, 46, 60, 78],

    /* ---------- 猫咪图鉴 ---------- */
    LEVELS: [
      { name: '奶团子', r: 24,  fur: '#fffaf3', fur2: '#ffe8d2', ear: '#ffd3c6', line: '#8a6f66', pattern: 'none',    accessory: 'none' },
      { name: '橘宝宝', r: 31,  fur: '#ffcb80', fur2: '#ffab4d', ear: '#ffc0a8', line: '#8a5a2e', pattern: 'none',    accessory: 'none' },
      { name: '狸花仔', r: 39,  fur: '#d6c3a8', fur2: '#b39a7c', ear: '#f0bcae', line: '#6b5644', pattern: 'tabby',   accessory: 'none' },
      { name: '奶牛包', r: 48,  fur: '#fffdf8', fur2: '#eee5d9', ear: '#ffd3c6', line: '#5c5350', pattern: 'cow',     accessory: 'none' },
      { name: '三花卷', r: 58,  fur: '#fff6ec', fur2: '#f6e6d4', ear: '#ffd3c6', line: '#7a5f50', pattern: 'calico',  accessory: 'none' },
      { name: '布偶糖', r: 70,  fur: '#fff1e4', fur2: '#f3ddc9', ear: '#b9a4b6', line: '#7d6b78', pattern: 'ragdoll', accessory: 'none' },
      { name: '缅因塔', r: 84,  fur: '#dcab7a', fur2: '#c18753', ear: '#e8c3a6', line: '#6d4a2f', pattern: 'maine',   accessory: 'none' },
      { name: '橘座',   r: 100, fur: '#ffbb66', fur2: '#f0902f', ear: '#ffc0a8', line: '#8a5320', pattern: 'tabby',   accessory: 'none' },
      { name: '猫仙',   r: 120, fur: '#e6eefb', fur2: '#c3d4ec', ear: '#d8c4e0', line: '#5d6d86', pattern: 'ragdoll', accessory: 'halo' },
      { name: '猫神',   r: 145, fur: '#ffe9b8', fur2: '#f2c865', ear: '#f5d29a', line: '#8a6a2a', pattern: 'none',    accessory: 'crown' },
    ],
  });

  CFG.MAX_LEVEL = CFG.LEVELS.length - 1;
  CFG.TOTAL = CFG.LEVELS.length;

  /* 当天日期（本地时区）与对局编号：给"挑战赛"用的轻量标识 */
  CFG.today = function () {
    const d = new Date();
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  CFG.hashSeed = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  CFG.dayCode = function (dateStr) {
    const s = (CFG.hashSeed('suika|' + (dateStr || CFG.today())) >>> 0).toString(36);
    return ('000000' + s).slice(-6);
  };

  /* 屏幕更瘦长时，世界按高度拉长：罐子变高、可堆更多猫 */
  CFG.relayout = function (worldH) {
    CFG.H = Math.max(CFG.H_BASE, Math.round(worldH));
    CFG.FLOOR = CFG.H - 76;
  };

  /* 按权重抽一个初始等级 */
  CFG.randomSpawnLevel = function () {
    const total = CFG.SPAWN_WEIGHTS.reduce((s, w) => s + w[1], 0);
    let n = Math.random() * total;
    for (const [lv, w] of CFG.SPAWN_WEIGHTS) {
      n -= w;
      if (n <= 0) return lv;
    }
    return 0;
  };

  CFG.catOf = function (level) {
    return CFG.LEVELS[Math.max(0, Math.min(CFG.MAX_LEVEL, level))];
  };
})();
