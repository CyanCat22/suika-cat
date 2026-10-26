/* 合成大猫咪 · 圆形刚体物理（自研，零依赖）
 * 只处理圆 vs 圆、圆 vs 左右墙/地面：位移修正 + 冲量 + 切向摩擦，
 * 多迭代求解，配合 1/120s 子步长，堆叠稳定、不抖、不穿透。
 */
(function () {
  const CFG = window.CATCFG;
  let uid = 1;

  function makeBody(level, x, y, opts) {
    opts = opts || {};
    const L = CFG.catOf(level);
    const r = L.r;
    const mass = r * r * 0.0009;
    return {
      id: uid++,
      level: level,
      r: r,
      x: x,
      y: y,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      angle: opts.angle != null ? opts.angle : (Math.random() - 0.5) * 0.4,
      angVel: opts.angVel || 0,
      mass: mass,
      invMass: 1 / mass,
      age: 0,
      born: 0,        // 合成出生动画计时（秒）
      overT: 0,
      alive: true,
      dropId: opts.dropId || 0,
      sleeping: false,
    };
  }

  /* 单个子步：积分 -> 求解碰撞 -> 约束墙面 */
  function step(bodies, dt) {
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.vy += CFG.GRAVITY * dt;
      b.vx *= CFG.AIR_DAMP;
      b.vy *= CFG.AIR_DAMP;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.angVel) {
        b.angle += b.angVel * dt;
        b.angVel *= 0.985;
      }
      b.age += dt;
      b.born += dt;
    }

    for (let it = 0; it < CFG.SOLVER_ITER; it++) {
      for (let i = 0; i < n; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = a.r + b.r;
          let d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const pen = rr - d;
          const invSum = a.invMass + b.invMass;

          const corr = Math.max(pen - CFG.POS_SLOP, 0) * CFG.POS_PERCENT / invSum;
          a.x -= nx * corr * a.invMass;
          a.y -= ny * corr * a.invMass;
          b.x += nx * corr * b.invMass;
          b.y += ny * corr * b.invMass;

          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const jn = -(1 + CFG.RESTITUTION) * vn / invSum;
            a.vx -= jn * nx * a.invMass;
            a.vy -= jn * ny * a.invMass;
            b.vx += jn * nx * b.invMass;
            b.vy += jn * ny * b.invMass;

            const tx = -ny;
            const ty = nx;
            const vt = rvx * tx + rvy * ty;
            let jt = -vt / invSum;
            const maxF = jn * CFG.FRICTION;
            jt = Math.max(-maxF, Math.min(maxF, jt));
            a.vx -= jt * tx * a.invMass;
            a.vy -= jt * ty * a.invMass;
            b.vx += jt * tx * b.invMass;
            b.vy += jt * ty * b.invMass;

            // 轻微自转，让猫看起来被撞得晃一下
            a.angVel -= vt * 0.0006;
            b.angVel += vt * 0.0006;
          }
        }
      }
      applyWalls(bodies);
    }
  }

  function applyWalls(bodies) {
    const L = CFG.WALL;
    const R = CFG.W - CFG.WALL;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.x - b.r < L) {
        b.x = L + b.r;
        if (b.vx < 0) b.vx = -b.vx * CFG.WALL_RESTITUTION;
        b.angVel *= 0.9;
      } else if (b.x + b.r > R) {
        b.x = R - b.r;
        if (b.vx > 0) b.vx = -b.vx * CFG.WALL_RESTITUTION;
        b.angVel *= 0.9;
      }
      if (b.y + b.r > CFG.FLOOR) {
        b.y = CFG.FLOOR - b.r;
        if (b.vy > 0) {
          b.vy = -b.vy * CFG.WALL_RESTITUTION;
          if (b.vy > -40) b.vy = 0;
        }
        b.vx *= 0.94;
        b.angVel *= 0.9;
      }
    }
  }

  window.CatPhysics = {
    makeBody: makeBody,
    step: step,
    applyWalls: applyWalls,
  };
})();
