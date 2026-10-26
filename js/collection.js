/* 猫咪图鉴 · 收集进度（约定见 we/GAME-CONVENTIONS.md §9）
 * 结构：{ "0": { n: 测出次数, f: 首次日期 }, ... }，key 用结果下标。
 * localStorage 立即生效；容器内异步从平台 Storage 合并（次数取 max、日期取最早）。
 */
(function () {
  'use strict';
  var CFG = window.CATCFG;
  var Platform = window.CatPlatform;
  var KEY = 'suika-coll';
  var TOTAL = CFG.TOTAL;
  var data = {};
  var loaded = false;
  var listeners = [];

  function sanitize(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      var idx = Number(k);
      if (!isFinite(idx) || idx < 0 || idx >= TOTAL) continue;
      var v = raw[k];
      if (!v || typeof v !== 'object') continue;
      var n = Math.max(0, Math.round(Number(v.n) || 0));
      var f = typeof v.f === 'string' ? v.f : (typeof v.first === 'string' ? v.first : '');
      if (n <= 0) continue;
      out[String(idx)] = { n: n, f: f };
    }
    return out;
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw == null) return {};
      return sanitize(JSON.parse(raw));
    } catch (err) { return {}; }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (err) {}
    if (Platform) Platform.save(KEY, data);
  }

  function merge(remote) {
    var r = sanitize(remote);
    var changed = false;
    for (var k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      var cur = data[k];
      if (!cur) { data[k] = r[k]; changed = true; continue; }
      if (r[k].n > cur.n) { cur.n = r[k].n; changed = true; }
      if (r[k].f && (!cur.f || r[k].f < cur.f)) { cur.f = r[k].f; changed = true; }
    }
    return changed;
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](api); } catch (err) {}
    }
  }

  var api = (window.Collection = {
    TOTAL: TOTAL,

    init: function () {
      data = readLocal();
      loaded = true;
      var src = Platform ? Platform.load(KEY) : Promise.resolve(null);
      return Promise.resolve(src).then(function (remote) {
        if (remote && merge(remote)) persist();
        emit();
        return api.progress();
      }, function () { return api.progress(); });
    },

    loaded: function () { return loaded; },

    get: function (i) { return data[String(i)] || null; },

    countOf: function (i) {
      var item = data[String(i)];
      return item ? item.n : 0;
    },

    isUnlocked: function (i) { return api.countOf(i) > 0; },

    /* 测出一只：返回 { isNew, n, unlocked, total, index, name, complete } */
    record: function (index, dateStr) {
      var key = String(index);
      var cur = data[key];
      var isNew = !cur;
      if (!cur) {
        data[key] = { n: 1, f: dateStr || CFG.today() };
      } else {
        cur.n += 1;
        if (!cur.f) cur.f = dateStr || CFG.today();
      }
      persist();
      emit();
      var unlocked = api.unlockedCount();
      return {
        isNew: isNew,
        n: data[key].n,
        unlocked: unlocked,
        total: TOTAL,
        index: index,
        name: CFG.catOf(index).name,
        tag: CFG.catOf(index).tag,
        complete: unlocked >= TOTAL,
      };
    },

    unlockedCount: function () {
      var n = 0;
      for (var k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k)) n++;
      }
      return n;
    },

    progress: function () {
      return { unlocked: api.unlockedCount(), total: TOTAL };
    },

    all: function () {
      var out = [];
      for (var i = 0; i < TOTAL; i++) {
        out.push({
          index: i,
          cat: CFG.catOf(i),
          unlocked: api.isUnlocked(i),
          count: api.countOf(i),
          first: (data[String(i)] && data[String(i)].f) || '',
        });
      }
      return out;
    },

    /* 还差几只 / 称号 */
    remain: function () { return TOTAL - api.unlockedCount(); },

    title: function () {
      return api.unlockedCount() >= TOTAL ? '猫咖店长' : '猫咖实习生';
    },

    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },

    _inject: function (raw) { data = sanitize(raw); },
    _raw: function () { return data; },
  });
})();
