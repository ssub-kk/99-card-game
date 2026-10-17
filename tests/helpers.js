// index.html 안의 인라인 스크립트를 꺼내서 Node에서 돌릴 수 있게 해 주는 도우미.
// 스크립트는 IIFE 하나라서, 마지막 `})();` 앞에 return 을 끼워 넣어 내부 함수를 노출한다.
const fs = require('fs');
const path = require('path');

const EXPORTS = [
  'S', 'joinRoom', 'leaveRoom', 'startGame', 'playCard', 'skipTurn', 'startSolo',
  'options', 'botChoice', 'applyPlay', 'makeDeck', 'shuffle', 'nextPlayer', 'drawCard',
  'nickOf', 'pushLog', 'clone', 'rank', 'netTick', 'fbInit'
];

function loadScript() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(x => x.trim());
  return blocks[blocks.length - 1];
}

function buildHooked(src, fast = true) {
  const i = src.lastIndexOf('})();');
  let code = src.slice(0, i) + 'return {' + EXPORTS.map(n => n + ':' + n).join(',') + '};\n})();';
  code = code.replace('(function(){', 'return (function(){');
  /* 시험은 빠르게: 방장 이어 받기·대기실 정리 기다림을 줄인다 */
  if (fast) code = code.replace(/var DAY_MS=(\d+), HOST_GRACE=\d+, LOBBY_GRACE=\d+, TICK_MS=\d+;/,
    'var DAY_MS=$1, HOST_GRACE=300, LOBBY_GRACE=300, TICK_MS=100;');
  return code;
}

// ---- 가짜 Firebase 실시간 DB (database.rules.json의 card99 규칙을 단순하게 흉내) ----
function createFakeFirebase() {
  const store = { v: {} };
  const subs = new Set();
  let uidSeq = 0;
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const parts = p => p.split('/').filter(Boolean);
  const read = p => { let n = store.v; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; };
  const prune = v => {
    if (v === null || typeof v !== 'object') return v;
    const o = {}; for (const k of Object.keys(v)) { const c = prune(v[k]); if (c !== null && c !== undefined) o[k] = c; }
    return Object.keys(o).length ? o : null;
  };
  const resolveTs = v => {
    if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return Date.now(); const o = {}; for (const k of Object.keys(v)) o[k] = resolveTs(v[k]); return o; }
    return v;
  };
  const write = (p, v) => {
    const ks = parts(p); v = resolveTs(clone(v));
    if (!ks.length) { store.v = prune(v) || {}; return; }
    let n = store.v;
    for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
    n[ks[ks.length - 1]] = v; store.v = prune(store.v) || {};
  };
  /* 규칙: rooms/<code>/... 만 다룬다 */
  function allowed(uid, p, nv, isRead) {
    const k = parts(p); if (k[0] !== 'card99' || k[1] !== 'rooms' || !k[2]) return false;
    const room = read(k.slice(0, 3).join('/')) || null, host = room && room.host, sub = k[3];
    if (isRead) {
      if (!sub) return false;
      if (sub === 'secret' || sub === 'req') return host === uid;
      if (sub === 'hands') return k[4] === uid;
      return true;
    }
    if (!sub) {
      if (nv == null) return host === uid;
      return (!room || room.createdAt < Date.now() - 86400000) && nv.createdAt != null && nv.host === uid && /^[A-Z0-9_-]{3,12}$/.test(k[2]);
    }
    if (!room || room.createdAt == null) return false;
    if (sub === 'host') {
      if (nv == null) return false;
      const ps = room.players || {};
      return host === uid || (nv === uid && ps[uid] && ps[uid].on === true && !(ps[host] && ps[host].on === true));
    }
    if (sub === 'players') return k[4] === uid || host === uid;
    if (sub === 'pub' || sub === 'secret' || sub === 'hands') return host === uid;
    if (sub === 'req') return k[4] === uid && !!(room.players && room.players[uid]);
    return false;
  }
  const deny = () => Promise.reject({ code: 'PERMISSION_DENIED' });
  function notify() {
    for (const s of subs) {
      if (!s.c.connected && s.p !== '.info/connected') continue;
      const v = s.p === '.info/connected' ? s.c.connected : (allowed(s.c.uid, s.p, null, true) ? read(s.p) : null);
      const j = JSON.stringify(v ?? null);
      /* 진짜 Firebase처럼 한 구독 안에서는 순서대로 도착 */
      if (j !== s.last) { s.last = j; const val = clone(v); s.q = (s.q || Promise.resolve()).then(() => new Promise(r => setTimeout(r, 1 + Math.random() * 4))).then(() => s.on && s.cb(val)); }
    }
  }
  function adapter() {
    const c = { uid: 'fu' + (++uidSeq), connected: true, disc: new Map() };
    const W = (p, v) => {
      if (!c.connected) return new Promise(() => {});
      if (!allowed(c.uid, p, v)) return deny();
      write(p, v); notify(); return Promise.resolve();
    };
    const api = {
      uid: c.uid, _c: c,
      now: () => ({ '.sv': 'timestamp' }),
      get: async p => { if (!allowed(c.uid, p, null, true)) throw { code: 'PERMISSION_DENIED' }; return clone(read(p)); },
      set: W,
      update: (p, obj) => {
        if (!c.connected) return new Promise(() => {});
        const keys = Object.keys(obj);
        for (const k of keys) if (!allowed(c.uid, p + '/' + k, obj[k])) return deny();
        keys.forEach(k => write(p + '/' + k, obj[k])); notify(); return Promise.resolve();
      },
      remove: p => W(p, null),
      on: (p, cb) => { const s = { p, cb, c, last: undefined, on: true }; subs.add(s); notify(); return () => { s.on = false; subs.delete(s); }; },
      onDisc: (p, v) => { c.disc.set(p, v); return Promise.resolve(); },
      cancelDisc: p => { c.disc.delete(p); return Promise.resolve(); },
      /* 진짜처럼: 내 화면엔 먼저 보이고(낙관적), 서버 확정은 조금 뒤 */
      tx: async (p, fn) => {
        const r = fn(clone(read(p))); if (r === undefined) return { committed: false };
        for (const s of subs) if (s.c === c && s.p === p && s.on) { const v = clone(r); s.last = JSON.stringify(v); s.q = (s.q || Promise.resolve()).then(() => s.on && s.cb(v)); }
        await wait(40); await W(p, r); return { committed: true };
      },
      online: b => { if (b) api._reconnect(); else api._crash(); },
      /* 시험용: 갑자기 끊김(서버가 onDisconnect를 실행) / 다시 연결 */
      _crash: () => {
        if (!c.connected) return; c.connected = false;
        for (const [p, v] of c.disc) if (allowed(c.uid, p, v)) write(p, v);
        c.disc.clear(); notify();
      },
      _reconnect: () => { if (c.connected) return; c.connected = true; for (const s of subs) if (s.c === c) s.last = undefined; notify(); }
    };
    return api;
  }
  return { adapter, store, read };
}

// ---- 가짜 브라우저 환경 + 게임 인스턴스 하나(=접속한 사람 한 명) ----
function createGameFactory(winExtra = () => ({}), fast = true) {
  const code = buildHooked(loadScript(), fast);
  return function makeClient() {
    const els = {}; const toasts = [];
    const el = id => els[id] || (els[id] = {
      innerHTML: '', style: {}, className: '', setAttribute() {}, getAttribute() { return ''; },
      offsetWidth: 0, focus() {}, setSelectionRange() {},
      set textContent(v) { if (id === 'toast') toasts.push(v); this._t = v; },
      get textContent() { return this._t; }
    });
    const document = { getElementById: el, addEventListener() {}, activeElement: null };
    const ls = {};
    const localStorage = { getItem: k => ls[k] || null, setItem: (k, v) => { ls[k] = v; } };
    const window = Object.assign({ addEventListener() {} }, winExtra());
    const f = new Function('document', 'localStorage', 'navigator', 'requestAnimationFrame', 'window', code);
    const api = f(document, localStorage, { clipboard: { writeText: () => Promise.resolve() } }, fn => fn(), window);
    api.toasts = toasts;
    return api;
  };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL', msg); fails++; process.exitCode = 1; }
  else console.log('ok  ', msg);
}
function failCount() { return fails; }

module.exports = { loadScript, buildHooked, createFakeFirebase, createGameFactory, wait, assert, failCount };
