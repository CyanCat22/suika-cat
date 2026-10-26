/* 猫猫打地鼠 · 小红书小工具容器桥
 * 端能力：保存相册 / 发笔记 / 发评论（挑战赛）/ 本地缓存 / 振动。
 * 脱离容器或版本不足时全部降级，调用方始终拿到 Promise，不抛同步异常。
 * 只使用 ES2017 语法（Chrome 61 基线）。
 */
(function () {
  'use strict';

  var STORAGE_MIN_CLIENT = 9460;   // 9.46+
  var COMMENT_MIN_CLIENT = 9490;   // 9.49+（interactionOpenApi）
  var VIBRATE_MIN_CLIENT = 9500;   // 9.50+
  var cachedBuildVersion = null;
  var snapshotDebug = [];

  function xhsRoot() { return window.xhs || null; }
  function miniTool() {
    var root = xhsRoot();
    return root && root.miniTool ? root.miniTool : null;
  }
  function isFn(obj, key) { return !!obj && typeof obj[key] === 'function'; }

  function readBuildVersion(launchOptions) {
    var env = launchOptions && launchOptions.miniToolEnv;
    return Number(env && env.buildVersion) || 0;
  }
  function clientVersion(buildVersion) {
    return Math.floor((Number(buildVersion) || 0) / 1000);
  }

  function buildVersion() {
    if (cachedBuildVersion !== null) return Promise.resolve(cachedBuildVersion);
    var root = xhsRoot();
    var sync = readBuildVersion(root && root.launchOptions);
    if (sync) { cachedBuildVersion = sync; return Promise.resolve(sync); }
    var mt = miniTool();
    if (!isFn(mt, 'getLaunchOptions')) { cachedBuildVersion = 0; return Promise.resolve(0); }
    return Promise.resolve(mt.getLaunchOptions()).then(function (options) {
      cachedBuildVersion = readBuildVersion(options);
      return cachedBuildVersion;
    }, function () {
      cachedBuildVersion = 0;
      return 0;
    });
  }

  function versionAtLeast(minClient) {
    return buildVersion().then(function (v) {
      var c = clientVersion(v);
      return c > 0 && c >= minClient;
    });
  }

  function inContainer() { return !!miniTool(); }
  function canSave() { return isFn(miniTool(), 'saveImageToPhotosAlbum'); }
  function canPost() { return isFn(miniTool(), 'postNote'); }
  function canCommentSync() { return isFn(miniTool(), 'interactionOpenApi'); }

  /* 把 canvas 变成容器可用 filePath：优先 writeTempFile，失败退回 data URI */
  function imagePath(canvas) {
    var mt = miniTool();
    var dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      return Promise.reject(err);
    }
    if (!isFn(mt, 'writeTempFile')) return Promise.resolve(dataUrl);
    return Promise.resolve(mt.writeTempFile({ data: dataUrl })).then(function (res) {
      return res && res.filePath ? res.filePath : dataUrl;
    }, function () {
      return dataUrl;
    });
  }

  function saveImage(canvas) {
    if (!canSave()) return Promise.reject(new Error('saveImageToPhotosAlbum unsupported'));
    var mt = miniTool();
    return imagePath(canvas).then(function (filePath) {
      return mt.saveImageToPhotosAlbum({ filePath: filePath });
    });
  }

  function postNote(canvas, options) {
    if (!canPost()) return Promise.reject(new Error('postNote unsupported'));
    var mt = miniTool();
    var opts = options || {};
    var title = String(opts.title || '').slice(0, 20);
    var content = String(opts.content || '').slice(0, 1000);
    return imagePath(canvas).then(function (filePath) {
      return Promise.resolve(mt.postNote({
        title: title,
        content: content,
        mediaInfo: { image_resources: [{ url: filePath }] },
      }));
    });
  }

  /* 评论区挑战赛：唤起评论编辑器，草稿带战绩卡 + 分数 + snapshot（≤2KB） */
  function postComment(canvas, options) {
    if (!canCommentSync()) return Promise.reject(new Error('interactionOpenApi unsupported'));
    var mt = miniTool();
    var opts = options || {};
    var content = String(opts.content || '').slice(0, 120);
    var snapshot = opts.snapshot || {};
    var json = '';
    try { json = JSON.stringify(snapshot); } catch (err) { json = ''; }
    if (json.length > 2048) json = '';
    return imagePath(canvas).then(function (filePath) {
      return Promise.resolve(mt.interactionOpenApi({
        payload: {
          action: 'post_comment',
          content: content,
          media_bean: [{ media_type: 'image', cover_image_url: filePath }],
          miniToolSnapshotInfo: json,
        },
      }));
    });
  }

  function vibrate(type) {
    var mt = miniTool();
    if (!isFn(mt, 'vibrateShort')) return Promise.resolve(false);
    return versionAtLeast(VIBRATE_MIN_CLIENT).then(function (ok) {
      if (!ok) return false;
      return Promise.resolve(mt.vibrateShort({ type: type || 'light' })).then(function () {
        return true;
      }, function () { return false; });
    });
  }

  function canComment() {
    if (!canCommentSync()) return Promise.resolve(false);
    return versionAtLeast(COMMENT_MIN_CLIENT);
  }

  /* ---------- 缓存：平台 Storage 优先，localStorage 兜底 ---------- */
  function platformSet(key, value) {
    if (!isFn(miniTool(), 'setStorage')) return Promise.resolve(false);
    return versionAtLeast(STORAGE_MIN_CLIENT).then(function (ok) {
      if (!ok) return false;
      var mt = miniTool();
      var data;
      try { data = JSON.stringify(value); } catch (err) { return false; }
      return Promise.resolve(mt.setStorage({ key: key, data: data })).then(function () {
        return true;
      }, function () { return false; });
    });
  }

  function platformGet(key) {
    if (!isFn(miniTool(), 'getStorage')) return Promise.resolve(null);
    return versionAtLeast(STORAGE_MIN_CLIENT).then(function (ok) {
      if (!ok) return null;
      var mt = miniTool();
      return Promise.resolve(mt.getStorage({ key: key })).then(function (res) {
        if (!res || typeof res.data !== 'string') return null;
        try { return JSON.parse(res.data); } catch (err) { return null; }
      }, function () { return null; });
    });
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { return false; }
  }
  function readLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return null;
      return JSON.parse(raw);
    } catch (err) { return null; }
  }

  /* 双写：本地立刻生效，平台异步同步；返回 Promise<boolean> */
  function save(key, value) {
    var ok = writeLocal(key, value);
    return platformSet(key, value).then(function (synced) {
      return ok || synced;
    });
  }

  /* 读：平台优先（容器重开更可靠），失败/为空回本地 */
  function load(key) {
    var local = readLocal(key);
    return platformGet(key).then(function (remote) {
      if (remote == null) return local;
      if (local == null) return remote;
      // 数组型数据取并集由上层处理，这里只给"哪个更完整"的初判
      if (typeof remote === 'object' && typeof local === 'object') {
        var rk = Object.keys(remote).length, lk = Object.keys(local).length;
        return rk >= lk ? remote : local;
      }
      return remote;
    }, function () {
      return local;
    });
  }

  /* ---------- 从评论入口回到小工具时读取 snapshot ----------
   * 官方只说"可读取"，未公开字段位置 → 多路探测，读不到就返回 null（上层降级）。
   */
  function pickSnapshot(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var keys = ['miniToolSnapshotInfo', 'snapshotInfo', 'snapshot', 'miniToolSnapshot'];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v == null) continue;
      if (typeof v === 'object') return v;
      if (typeof v === 'string' && v.length) {
        try { return JSON.parse(v); } catch (err) {}
      }
    }
    if (obj.query && typeof obj.query === 'object') {
      var q = pickSnapshot(obj.query);
      if (q) return q;
    }
    return null;
  }

  function snapshotFromUrl() {
    try {
      var search = String(location.search || '');
      if (!search) return null;
      var m = search.match(/[?&](?:miniToolSnapshotInfo|snapshot)=([^&]+)/);
      if (!m) return null;
      return JSON.parse(decodeURIComponent(m[1]));
    } catch (err) { return null; }
  }

  function readSnapshot() {
    snapshotDebug.length = 0;
    var root = xhsRoot();
    var direct = pickSnapshot(root && root.launchOptions);
    if (direct) { snapshotDebug.push('launchOptions'); return Promise.resolve(direct); }
    var url = snapshotFromUrl();
    if (url) { snapshotDebug.push('location.search'); return Promise.resolve(url); }
    var mt = miniTool();
    if (!isFn(mt, 'getLaunchOptions')) { snapshotDebug.push('none'); return Promise.resolve(null); }
    return Promise.resolve(mt.getLaunchOptions()).then(function (options) {
      var snap = pickSnapshot(options);
      snapshotDebug.push(snap ? 'getLaunchOptions' : 'none');
      return snap;
    }, function () {
      snapshotDebug.push('getLaunchOptions failed');
      return null;
    });
  }

  window.CatPlatform = {
    inContainer: inContainer,
    canSave: canSave,
    canPost: canPost,
    canComment: canComment,
    canCommentSync: canCommentSync,
    canVibrate: function () { return isFn(miniTool(), 'vibrateShort'); },
    buildVersion: buildVersion,
    saveImage: saveImage,
    postNote: postNote,
    postComment: postComment,
    vibrate: vibrate,
    save: save,
    load: load,
    writeLocal: writeLocal,
    readLocal: readLocal,
    readSnapshot: readSnapshot,
    snapshotDebug: function () { return snapshotDebug.slice(); },

    /* ---------- 旧接口（最高分 / 静音 / 启动状态），保持向后兼容 ---------- */
    saveBest: function (best) { return save('suika-cat-best', Number(best) || 0); },
    saveMuted: function (muted) { return save('suika-muted', !!muted); },
    loadState: function () {
      return Promise.all([load('suika-cat-best'), load('suika-muted'), load('suika-cat-muted')]).then(function (arr) {
        var muted = typeof arr[1] === 'boolean' ? arr[1] : arr[2];
        return {
          best: Number(arr[0]) || 0,
          muted: typeof muted === 'boolean' ? muted : undefined,
        };
      });
    },
  };
})();
