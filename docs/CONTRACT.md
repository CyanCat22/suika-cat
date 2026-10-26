# 技术契约（改代码前先看这个）

## 1. 坐标系与缩放

- 逻辑坐标系固定宽 **720**，高 **H**（基准 1280）。
- `main.js` 每次 resize 重新计算：
  - 屏幕比 9:16 更瘦长（`vh/vw > 1280/720`，手机）→ 按宽度铺满，`H = round(720*vh/vw)`，罐子变高；
  - 否则（平板/桌面横屏）→ 按高度缩放，`H = 1280`，左右留背景。
- `CFG.relayout(H)` 只改 `CFG.H` 与 `CFG.FLOOR = H - 76`；**其余锚点（TOP=140 / DANGER_Y=320 / DROP_Y=202）恒定**，所以 HUD、投放区、警戒线在任何屏幕上位置一致。
- 画布 `canvas.width = cssW * dpr`，渲染前 `ctx.setTransform(canvas.width/720, 0, 0, canvas.height/CFG.H, 0, 0)`；所有绘制都用逻辑坐标。

## 2. 状态机（`CatGame.state`）

```
menu ──start()──▶ playing ──危险线超时──▶ over ──btn-again──▶ playing
                    │  ▲
              pause │  │ resume
                    ▼  │
                  paused
```

- `update(dt)`：`playing` 才跑物理与合并；`over` 只推进结算计时（`overAnimT`，0.6s 后调 `hooks.onOverUI`）；粒子/飘字任何状态都更新。
- 暂停时 `main.js` 用 `paused` 布尔拦掉 `update`，`state` 同步置 `paused`。

## 3. 物理不变量（改 `physics.js` 必须守住）

- 子步长 `SUBSTEP = 1/120`，单帧最多 `MAX_SUBSTEPS = 5` 步（超了丢时间不丢位置）。
- 每个子步：积分 → `SOLVER_ITER`(4) 次「圆-圆位置修正 + 冲量 + 切向摩擦」→ 墙面约束。
- 不变量：猫心 `x ∈ [WALL + r, W - WALL - r]`；`y + r ≤ FLOOR`；落定后同屏最大穿插 < 4px（QA 实测 2.91px）。
- 合并判定在 `game.tryMerge()`，不在物理里：同 level 且圆心距 `≤ r1+r2+MERGE_GAP(4)` 即合。

## 4. 话筒接口（`window.SUIKA`）

| 接口 | 用途 |
|---|---|
| `SUIKA_READY` | 启动完成的全局标记（测试用）|
| `SUIKA.start()` | 开始/重开一局 |
| `SUIKA.dropAt(x)` | 设定落点并投放，返回是否成功（冷却中为 false）|
| `SUIKA.forceDrop(level, x)` | 直接生成一只指定等级的猫（测试用，绕过冷却）|
| `SUIKA.game` | 游戏对象本体：`bodies / score / state / best / update(dt) / render() / gameOver()` |
| `SUIKA.overlay(name)` | 手动显示某个弹层（`menu/over/pause/share`）|
| `SUIKA.cardCanvas(data)` / `coverCanvas()` | 生成战绩卡 / 封面图 |
| `CatPhysics.makeBody(level, x, y, opts)` | 造一只猫（测试/调试用）|
| `CatCFG` / `CFG.relayout(H)` | 全部数值与自适应布局入口 |

`G.blinkEnabled = false` 可关掉眨眼（美术截图/像素测试用）。

## 5. 数值在哪调

- 手感：`CFG.GRAVITY / RESTITUTION / POS_PERCENT / DROP_COOLDOWN / MERGE_GAP / OVER_GRACE`。
- 节奏：`CFG.SPAWN_WEIGHTS`（初始 0~4 级的抽取权重）、`CFG.SCORE`（合成基分）。
- 尺寸：`CFG.LEVELS[i].r`（相邻两级半径差决定「容器能装多少」；改完跑 `npm test` 的物理项）。

## 6. 加一只新猫 / 改外观

1. 在 `CFG.LEVELS` 追加一项：`name / r / fur / fur2 / ear / line / pattern / accessory`。
2. `pattern` 可选：`none | tabby | cow | calico | ragdoll | maine`；`accessory`：`none | halo | crown`。
3. `SCORE` 同步补一位（合成基分）。
4. 跑 `npm test`：会校验 10 只猫的描边/眼睛/填充；新猫自动纳入像素检查。

## 7. 音效

`CatAudio` 全合成：`merge(level)` 音高 `320 * 1.16^level`；`drop / thud / combo / warn / over / record / click`。
首次用户手势里 `init()` 解锁；`muted` 存 `localStorage['suika-cat-muted']`。

## 8. 别踩的坑

- `drawPopups / drawParticles / Art.draw` 都依赖 `ctx.save/restore` 平衡；在中间 `return` 会污染后续绘制。
- `buildBackground()` 会预渲染到离屏 canvas，**改变 H 之后必须调 `G.relayout()`**，否则渐变错位。
- 结算弹层不要再用 `setTimeout`（后台标签会被节流），走 `update()` 里的帧计时。
- 每帧 `bodies.slice().sort()` 有开销，猫数上千时要换空间分区。
