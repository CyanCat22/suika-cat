# 小红书小工具包（minitool）构建与校验记录

按 `minitool-zip-builder` v1.8.0（`.skill/minitool-zip-builder/SKILL.md`）对《合成大猫咪》做容器化改造、校验并打包。

- **产物**：`suika-cat-minitool.zip`（102.9 KiB，zip 根目录直接是 `index.html`）
- **构建**：`npm run minitool`（= `node scripts/build-minitool.mjs`，会重新生成 `minitool/` 并压缩）
- **验收**：`npm run test:minitool`（= `node tests/minitool.mjs`，解压真实 zip 后跑 38 项断言）

## 1. 在线能力核对（先做这一步再动手）

- 已获取官方能力清单：<https://miniapp-sandbox.xiaohongshu.com/minitool/doc>（页面标注「最后更新 2026-10-22」）
- 与随包 baseline（`references/js-api.md`，2026-09-23 快照）逐项比对：

| 在线新增能力 | 最低客户端 | 本次是否使用 |
| --- | --- | --- |
| `AI.createModel(...).generateText()` 平台文本生成 | 内测加白 | 未使用（与玩法无关） |
| `getWindowInfo` 窗口信息 / 安全区 / 顶部按钮位置 | 9.49+ | 未使用（页面用 CSS 安全区变量自适应） |
| `getLocation` 单次定位 | 9.49+ | 未使用 |
| `interactionOpenApi({payload:{action:'post_comment', content, media_bean, miniToolSnapshotInfo}})` 贴评论 | 9.49+ | **已使用**：「贴到评论区」（评论 ≤120 字 + 战绩卡 + snapshot） |
| `getLaunchOptions().miniToolSnapshotInfo` 读评论快照 | 9.49+ | **已使用**：三探针读取（launchOptions → location.search → getLaunchOptions） |
| `vibrateShort({type})` / `vibrateLong()` 振动 | 9.50+ | 未使用（未做触感反馈，避免额外权限） |
| `startGyroscope` / `stopGyroscope` / `onGyroscopeChange` / `offGyroscopeChange` | 9.50+ | 未使用 |
| `followAuthor` / `getFollowStatus` 关注作者 | 9.51+ | 未使用 |

- 在线文档中 baseline 已有能力的参数、配额、替代关系未见变化；`postNote` / `saveImageToPhotosAlbum` / `writeTempFile` / Storage（9.46+）/ 文件系统（9.49+）/ `interactionOpenApi`（9.49+）与 baseline 一致，本次按在线契约实现。
- 客户端版本判断按「`buildVersion` 末三位是编译序号」处理：`clientVersion = floor(buildVersion / 1000)`，Storage 门限 `9460`、振动门限 `9500`。

## 2. 改造内容（只替换被禁能力，未改玩法与美术）

| 原实现 | 问题 | 改法 |
| --- | --- | --- |
| `<a download>` + `URL.createObjectURL(blob)` 保存战绩卡 | 容器**禁用文件下载**（`a[download]`/blob 下载） | 新增 `js/xhs.js`：优先 `writeTempFile` → `saveImageToPhotosAlbum`；无容器时退回 Web 提示「长按 / 右键保存」 |
| 只能保存图片再去发笔记 | 平台有原生发布能力 | 容器内多一个「发笔记」按钮，调用 `postNote`（标题 ≤20 字、正文 ≤1000 字、图片走 `image_resources`） |
| 只读写 `localStorage` | 容器不保证 localStorage 持久、推荐 Storage API | `js/xhs.js` 做双写：平台 `setStorage`（9.46+，带版本判断）+ localStorage 兜底；启动时先从平台 `getStorage` 恢复最高分/静音，再回填 localStorage |
| `AudioContext` 直接 `new` | 音频被策略拦截时可能抛错、打断输入 | 构造与 `resume()` 全部 try/catch + Promise catch，失败时静音降级，不影响游戏 |
| Flex `gap`、`clamp()`/`max()`、`inset`、`aspect-ratio`、`backdrop-filter`、裸 `env()` | Chrome 61 不支持，会整条丢弃或布局错位 | 全部补基线层：子项 margin、先写 vmin 固定值再写现代写法、`top/right/bottom/left`、canvas 固有比例、`@supports` 内才启用毛玻璃、`var(--safe-area-inset-*, env(...))` |

改动文件：`index.html`、`style.css`、`js/main.js`、`js/sharecard.js`、`js/audio.js`，新增 `js/compat.js`（Flex gap 行为检测）、`js/xhs.js`（容器桥）。包内另带 `assets/icon-180.png`、`assets/icon-192.png`（网页/主屏图标），构建时会校验「HTML 引用的资源必须都在包内」。

## 3. 校验结果

### 3.1 静态门禁（`scripts/build-minitool.mjs`，任一项失败即退出 1）

| 检查 | 结果 |
| --- | --- |
| zip 根目录就是 `index.html`（不多套一层目录） | ✓ |
| 仅含允许类型（html/css/js/png/jpg/gif/webp/svg/woff/woff2/json），无 `node_modules`/`*.map`/`.DS_Store`/构建配置 | ✓ |
| `<!DOCTYPE html>` + `lang="zh-CN"` + `charset=UTF-8` | ✓ |
| viewport 含 `width=device-width, initial-scale=1.0, viewport-fit=cover` | ✓ |
| 无内联 `<script>`、无 `onclick=` 等行内事件、无 `javascript:`、无 `type="module"` | ✓ |
| 无 `<base>`、`<iframe>`/`<object>`、自建 CSP | ✓ |
| 无任何 `http(s)://` 外部资源（favicon 用 `data:` SVG，图片类允许） | ✓ |
| 未命中禁用 API：fetch/XHR/WebSocket/SSE/WebRTC/Worker/Worker-SW/geolocation/clipboard/requestFullscreen/window.open/window.prompt/eval/new Function/WASM/a[download]/navigator.vibrate/IndexedDB/Cache | ✓ |
| 未命中 ES2018+ 语法：`?.`、`??`、逻辑赋值、`Object.fromEntries`、`replaceAll`、`.at()`、`.flat()`、`structuredClone`、`globalThis`、`allSettled`、可选 catch 绑定、ES Module、class 私有字段 | ✓ |
| CSS：无裸 `inset`/`aspect-ratio`、Flex 间距不依赖 `gap`（`.supports-flex-gap` 增强层除外）、每个 `clamp()/max()/min()` 声明都有旧值兜底、`backdrop-filter` 只在 `@supports` 内、安全区用 `var(--safe-area-inset-*, env(...))` | ✓ |
| 单条内联 base64 < 100 KiB | ✓（favicon < 1 KiB） |
| 官方审计脚本 `audit_artifact.mjs` 对目录与 zip 各跑一次 | ✓ `PASS: 11 file(s), 0 warning(s)` / zip `PASS` |
| zip ≤ 10 MiB（建议 ≤ 2 MiB） | ✓ 102.9 KiB |

### 3.2 运行验收（`tests/minitool.mjs`，38 项全过）

解压真实 zip，在 headless Chrome 里用 `evaluateOnNewDocument` 注入假 `window.xhs`（buildVersion `9462004` → 9.46.2）：

- [x] 识别到容器，`canSave()` / `canPost()` 为真
- [x] 启动时从平台 `getStorage` 恢复最高分 777、静音 true
- [x] 容器内正常投放与合成（首次合并发生）
- [x] 结算页弹出、分数 1286
- [x] 战绩卡生成并显示在预览（1080×1440）
- [x] 容器内出现「发笔记」按钮
- [x] 保存链路：`writeTempFile` → `saveImageToPhotosAlbum({filePath})`，提示「已保存到相册」
- [x] `postNote` 携带图片、标题 7 字（≤20）、正文 <1000 字
- [x] 结束后 `setStorage('suika-cat-best','1286')`
- [x] 图鉴从平台 Storage 恢复（1/10，2 级已合 3 次），解锁后写回 `suika-coll`
- [x] 猫名从平台 Storage 回填（`suika-nick`）
- [x] 9.46 客户端禁用「贴到评论区」
- [x] 9.50 容器：从评论 snapshot 回场 → 首页「被挑战」横幅
- [x] 9.50 容器：`interactionOpenApi({action:'post_comment'})`，评论 ≤120 字、带战绩卡 `media_bean`、snapshot ≤2KB、调用前先落盘 `suika-challenge`
- [x] 结算页显示与挑战者的分数差
- [x] 无 JS 报错
- [x] 同包在无容器环境：隐藏「发笔记」、保存给出「长按/右键」提示、无报错

### 3.3 桌面浏览器回归

`npm test` 仍是 71 项全过（玩法 / 物理 / 判负 / 像素 / 三端布局 / 图鉴 / 挑战赛），说明容器化改造没有破坏原 Web 版。

## 4. 还没验证的（务必在真容器里过一遍）

| 项目 | 状态 |
| --- | --- |
| 创服平台模拟器：整体功能、导航栏与安全区避让、发笔记/存相册弹窗 | **未验证**（不在本地能力范围） |
| Android 真机扫码：Chrome/WebView 61 基线布局、触摸手感、音效 | **未验证** |
| iOS 真机扫码：安全区、音频解锁、相册权限弹窗 | **未验证** |
| Chrome 61 实机 CSS/JS 兼容 | **未实测**，仅做静态门禁 + 现代内核回归 |
| 帧率/内存 | **未实测**（PC 上 40 只猫单帧 0.53 ms，仅供参考） |

## 5. 上传与验证步骤

1. 打开小工具上传页，第一步复制「改写口令」并确认与本次 Skill 版本（v1.8.0）一致；本仓库已按该 Skill 执行。
2. 第二步上传 `suika-cat-minitool.zip`。
3. 先在**创服平台模拟器**完整跑一局：投放 → 合成 → 结算 → 生成战绩卡 → 保存到相册 → 发笔记。
4. 再用 **Android 真机**扫码验证同一产物；最后用 **iOS 真机**扫码验证。
5. 三项都通过前，不要对外宣称「已上线可用」。
