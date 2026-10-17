// index.html 안의 인라인 스크립트를 꺼내서 Node에서 돌릴 수 있게 해 주는 도우미.
// 스크립트는 IIFE 하나라서, 마지막 `})();` 앞에 return 을 끼워 넣어 내부 함수를 노출한다.
const fs = require('fs');
const path = require('path');

const EXPORTS = [
  'S', 'joinRoom', 'leaveRoom', 'startGame', 'playCard', 'skipTurn', 'startSolo',
  'options', 'botChoice', 'applyPlay', 'makeDeck', 'shuffle', 'nextPlayer', 'drawCard',
  'nickOf', 'pushLog', 'clone', 'rank'
];

function loadScript() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(x => x.trim());
  return blocks[blocks.length - 1];
}

function buildHooked(src) {
  const i = src.lastIndexOf('})();');
  let code = src.slice(0, i) + 'return {' + EXPORTS.map(n => n + ':' + n).join(',') + '};\n})();';
  code = code.replace('(function(){', 'return (function(){');
  code = code.replace(/var PROBE_MS=\d+;/, 'var PROBE_MS=500;'); // 테스트는 빠르게
  return code;
}

// ---- 가짜 MQTT 중계 서버 (같은 URL 의 클라이언트끼리 토픽으로 메시지 전달) ----
class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  once(e, f) { const w = (...a) => { this.off(e, w); f(...a); }; return this.on(e, w); }
  off(e, f) { this.h[e] = (this.h[e] || []).filter(x => x !== f); }
  emit(e, ...a) { (this.h[e] || []).slice().forEach(f => f(...a)); }
}

function createFakeMqtt() {
  const brokers = {};
  const down = new Set(); // 접속 불가로 만들 브로커 URL
  class Client extends Emitter {
    constructor(url, opts) {
      super();
      this.url = url; this.options = opts; this.connected = false; this.subs = new Set();
      if (down.has(url)) {
        setTimeout(() => { this.emit('error', new Error('down')); this.emit('close'); }, 5);
        return;
      }
      (brokers[url] = brokers[url] || { clients: new Set() }).clients.add(this);
      setTimeout(() => { this.connected = true; this.emit('connect'); }, 3 + Math.random() * 10);
    }
    subscribe(t) { (Array.isArray(t) ? t : [t]).forEach(x => this.subs.add(x)); }
    unsubscribe(t) { this.subs.delete(t); }
    publish(topic, payload) {
      const b = brokers[this.url]; if (!b || !this.connected) return;
      b.clients.forEach(c => {
        if (c.connected && c.subs.has(topic)) {
          const buf = Buffer.from(payload);
          setTimeout(() => c.emit('message', topic, buf), 1 + Math.random() * 6);
        }
      });
    }
    end() { this.connected = false; const b = brokers[this.url]; if (b) b.clients.delete(this); }
    // 비정상 종료 시뮬레이션: 브로커가 유언(will) 메시지를 대신 발행한다
    _crash() {
      const w = this.options.will; this.connected = false;
      const b = brokers[this.url]; if (b) b.clients.delete(this);
      if (w && b) b.clients.forEach(c => {
        if (c.connected && c.subs.has(w.topic)) {
          const buf = Buffer.from(w.payload);
          setTimeout(() => c.emit('message', w.topic, buf), 2);
        }
      });
    }
  }
  return { mqtt: { connect: (u, o) => new Client(u, o) }, down };
}

// ---- 가짜 브라우저 환경 + 게임 인스턴스 하나(=접속한 사람 한 명) ----
function createGameFactory(mqtt) {
  const code = buildHooked(loadScript());
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
    const f = new Function('document', 'localStorage', 'navigator', 'requestAnimationFrame',
      'mqtt', 'window', 'TextDecoder', code);
    const api = f(document, localStorage, { clipboard: { writeText: () => Promise.resolve() } },
      fn => fn(), mqtt, { addEventListener() {} }, TextDecoder);
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

module.exports = { loadScript, buildHooked, createFakeMqtt, createGameFactory, wait, assert, failCount };
