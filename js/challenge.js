/* 评论区挑战赛 · 合成大猫咪（约定见 we/GAME-CONVENTIONS.md）
 * 这个游戏比的是分数，所以 snapshot 带分数 + 进化到的等级。
 */
(function () {
  'use strict';
  var CFG = window.CATCFG;
  var GAME_ID = 'suika';
  var NICK_KEY = 'suika-nick';
  var RIVAL_KEY = 'suika-rival';
  var SNAP_KEY = 'suika-challenge';
  var MAX_NICK = 8;
  var DEFAULT_NICK = '路人猫';

  function sanitizeNick(input) {
    var s = String(input == null ? '' : input).replace(/\s+/g, '').slice(0, MAX_NICK);
    return s || DEFAULT_NICK;
  }

  function readNick() {
    try {
      var raw = localStorage.getItem(NICK_KEY);
      return sanitizeNick(raw == null ? '' : JSON.parse(raw));
    } catch (err) { return DEFAULT_NICK; }
  }

  function writeNick(nick) {
    var n = sanitizeNick(nick);
    try { localStorage.setItem(NICK_KEY, JSON.stringify(n)); } catch (err) {}
    return n;
  }

  function dayInfo(dateStr) {
    var date = dateStr || CFG.today();
    return { date: date, code: CFG.dayCode(date) };
  }

  function catName(level) {
    return CFG.catOf(Math.max(0, Math.min(CFG.MAX_LEVEL, Number(level) || 0))).name;
  }

  /* ---------- snapshot ---------- */
  function encodeSnapshot(info) {
    var day = dayInfo(info && info.date);
    var snap = {
      v: 1,
      g: GAME_ID,
      s: Math.max(0, Math.round(Number(info && info.score) || 0)),
      lv: Math.max(0, Math.min(CFG.MAX_LEVEL, Math.round(Number(info && info.maxLevel) || 0))),
      d: day.date,
      n: sanitizeNick(info && info.nick),
      k: day.code,
    };
    if (info && typeof info.collection === 'number') snap.c = info.collection;
    var json = JSON.stringify(snap);
    if (json.length > 2048) {
      delete snap.c;
      json = JSON.stringify(snap);
    }
    return { json: json, data: snap };
  }

  function decodeSnapshot(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.v !== 1 && obj.v !== '1') return null;
    if (obj.g && obj.g !== GAME_ID) return null;
    var score = Number(obj.s);
    if (!isFinite(score) || score < 0 || score > 999999) return null;
    var lv = Math.round(Number(obj.lv) || 0);
    if (!isFinite(lv) || lv < 0 || lv > CFG.MAX_LEVEL) lv = 0;
    return {
      score: Math.round(score),
      maxLevel: lv,
      cat: CFG.catOf(lv),
      label: catName(lv),
      date: String(obj.d || ''),
      nick: sanitizeNick(obj.n),
      code: String(obj.k || ''),
      collection: typeof obj.c === 'number' ? obj.c : null,
    };
  }

  /* ---------- 文案 ---------- */
  var COMMENT_TAILS = [
    '今天来破我这局？',
    '同一天同一套猫，你也试试。',
    '评论区报分数，我看看谁更高。',
    '不敢一个人丢脸，你也来合一个。',
  ];

  function commentText(info) {
    var score = Math.max(0, Math.round(Number(info && info.score) || 0));
    var level = Number(info && info.maxLevel) || 0;
    var seed = (info && info.code ? CFG.hashSeed(info.code) : CFG.hashSeed(CFG.today()));
    var tail = COMMENT_TAILS[Math.abs(seed) % COMMENT_TAILS.length];
    var text = '我合出「' + catName(level) + '」，' + score + ' 分，' + tail;
    return text.slice(0, 120);
  }

  function noteTitle(info) {
    var score = Math.max(0, Math.round(Number(info && info.score) || 0));
    var level = Number(info && info.maxLevel) || 0;
    var t = '我合出' + catName(level) + '，' + score + ' 分';
    return t.slice(0, 20);
  }

  function noteContent(info) {
    var score = Math.max(0, Math.round(Number(info && info.score) || 0));
    var level = Number(info && info.maxLevel) || 0;
    var combo = Math.max(0, Math.round(Number(info && info.maxCombo) || 0));
    var merges = Math.max(0, Math.round(Number(info && info.merges) || 0));
    var day = dayInfo(info && info.date);
    var lines = [
      '《合成大猫咪》一局 ' + score + ' 分，进化到「' + catName(level) + '」。',
      '最高连击 x' + combo + '，一局合了 ' + merges + ' 次。',
      '玩法就一句话：两只一样的猫碰一下，就合成下一级，10 级能合出猫神。',
      '同一天所有人的规则一样（对局编号 ' + day.code + '），分数能直接比。',
      '你也来试试，能合到哪只猫？评论区报分数，我看看谁更高。',
    ];
    return lines.join('\n').slice(0, 1000);
  }

  /* ---------- 被挑战记录 ---------- */
  function readRival() {
    try {
      var raw = localStorage.getItem(RIVAL_KEY);
      return raw == null ? null : decodeSnapshot(JSON.parse(raw));
    } catch (err) { return null; }
  }

  function writeRival(snap) {
    if (!snap) return null;
    var payload = {
      v: 1, g: GAME_ID, s: snap.score, lv: snap.maxLevel,
      d: snap.date, n: snap.nick, k: snap.code || '',
    };
    try { localStorage.setItem(RIVAL_KEY, JSON.stringify(payload)); } catch (err) {}
    return payload;
  }

  function clearRival() {
    try { localStorage.removeItem(RIVAL_KEY); } catch (err) {}
  }

  /* 结果对比：分数差 / 同分 */
  function compareText(rival, score) {
    if (!rival) return '';
    var mine = Math.max(0, Math.round(Number(score) || 0));
    var diff = mine - rival.score;
    if (diff === 0) return '你和' + rival.nick + '都打了 ' + mine + ' 分，平手。';
    if (diff > 0) return rival.nick + ' 打了 ' + rival.score + ' 分，你比他高 ' + diff + ' 分。';
    return rival.nick + ' 打了 ' + rival.score + ' 分，你还差 ' + (-diff) + ' 分。';
  }

  window.Challenge = {
    GAME_ID: GAME_ID,
    MAX_NICK: MAX_NICK,
    DEFAULT_NICK: DEFAULT_NICK,
    sanitizeNick: sanitizeNick,
    readNick: readNick,
    writeNick: writeNick,
    dayInfo: dayInfo,
    catName: catName,
    encodeSnapshot: encodeSnapshot,
    decodeSnapshot: decodeSnapshot,
    commentText: commentText,
    noteTitle: noteTitle,
    noteContent: noteContent,
    readRival: readRival,
    writeRival: writeRival,
    clearRival: clearRival,
    compareText: compareText,
    SNAP_KEY: SNAP_KEY,
  };
})();
