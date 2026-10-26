/* 合成大猫咪 · 小红书小工具容器桥
 * 容器内通过 window.xhs.miniTool 调用端能力（保存相册 / 发笔记 / 本地缓存 / 振动），
 * 脱离容器（普通浏览器、本地文件）时全部降级为 Web 方案，调用方始终拿到 Promise。
 * 只使用 ES2017 语法；对 API 缺失、调用失败、版本不足都做了降级。
 */
(function () {
  'use strict';

  var STORAGE_MIN_CLIENT = 9460; // 客户端 9.46+（buildVersion 去掉末三位编译序号）
  var VIBRATE_MIN_CLIENT = 9500; // 客户端 9.50+
  var KEY_BEST = 'suika-cat-best';
  var KEY_MUTED = 'suika-cat-muted';

  var cachedBuildVersion = null;

  function xhsRoot() {
    return window.xhs || null;
  }

  function miniTool() {
    var root = xhsRoot();
    return root && root.miniTool ? root.miniTool : null;
  }

  function isFn(obj, key) {
    return !!obj && typeof obj[key] === 'function';
  }

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
    if (sync) {
      cachedBuildVersion = sync;
      return Promise.resolve(sync);
    }
    var mt = miniTool();
    if (!isFn(mt, 'getLaunchOptions')) {
      cachedBuildVersion = 0;
      return Promise.resolve(0);
    }
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

  function inContainer() {
    return !!miniTool();
  }

  function canSave() {
    return isFn(miniTool(), 'saveImageToPhotosAlbum');
  }

  function canPost() {
    return isFn(miniTool(), 'postNote');
  }

  /* 把 canvas 变成容器可用的 filePath：大图优先 writeTempFile，失败退回 data URI */
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
      var mediaInfo = { image_resources: [{ url: filePath }] };
      var payload = { title: title, content: content, mediaInfo: mediaInfo };
      return Promise.resolve(mt.postNote(payload));
    });
  }

  function vibrate(type) {
    var mt = miniTool();
    if (!isFn(mt, 'vibrateShort')) return Promise.resolve(false);
    return versionAtLeast(VIBRATE_MIN_CLIENT).then(function (ok) {
      if (!ok) return false;
      return Promise.resolve(mt.vibrateShort({ type: type || 'light' })).then(function () {
        return true;
      }, function () {
        return false;
      });
    });
  }

  /* ---------- 本地缓存：平台 Storage 优先，localStorage 兜底 ---------- */

  function platformSet(key, value) {
    if (!isFn(miniTool(), 'setStorage')) return Promise.resolve(false);
    return versionAtLeast(STORAGE_MIN_CLIENT).then(function (ok) {
      if (!ok) return false;
      var mt = miniTool();
      var data;
      try {
        data = JSON.stringify(value);
      } catch (err) {
        return false;
      }
      return Promise.resolve(mt.setStorage({ key: key, data: data })).then(function () {
        return true;
      }, function () {
        return false;
      });
    });
  }

  function platformGet(key) {
    if (!isFn(miniTool(), 'getStorage')) return Promise.resolve(null);
    return versionAtLeast(STORAGE_MIN_CLIENT).then(function (ok) {
      if (!ok) return null;
      var mt = miniTool();
      return Promise.resolve(mt.getStorage({ key: key })).then(function (res) {
        if (!res || typeof res.data !== 'string') return null;
        try {
          return JSON.parse(res.data);
        } catch (err) {
          return null;
        }
      }, function () {
        return null;
      });
    });
  }

  function saveBest(score) {
    var value = Number(score) || 0;
    var ok = false;
    try {
      localStorage.setItem(KEY_BEST, String(value));
      ok = true;
    } catch (err) {}
    return platformSet(KEY_BEST, value).then(function (saved) {
      return ok || saved;
    });
  }

  function saveMuted(muted) {
    var value = !!muted;
    try {
      localStorage.setItem(KEY_MUTED, value ? '1' : '0');
    } catch (err) {}
    return platformSet(KEY_MUTED, value);
  }

  /* 启动时读平台缓存（平台可能比 localStorage 更可靠），返回 { best, muted } */
  function loadState() {
    var state = { best: 0, muted: null };
    return platformGet(KEY_BEST).then(function (best) {
      if (typeof best === 'number' && best > state.best) state.best = best;
      return platformGet(KEY_MUTED);
    }).then(function (muted) {
      if (typeof muted === 'boolean') state.muted = muted;
      else if (muted === 1 || muted === '1') state.muted = true;
      else if (muted === 0 || muted === '0') state.muted = false;
      return state;
    }, function () {
      return state;
    });
  }

  window.CatPlatform = {
    inContainer: inContainer,
    canSave: canSave,
    canPost: canPost,
    canVibrate: function () { return isFn(miniTool(), 'vibrateShort'); },
    buildVersion: buildVersion,
    saveImage: saveImage,
    postNote: postNote,
    vibrate: vibrate,
    saveBest: saveBest,
    saveMuted: saveMuted,
    loadState: loadState,
  };
})();
