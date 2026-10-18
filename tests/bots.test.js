// 봇끼리 판을 돌려서 규칙/덱/종료 로직이 깨지지 않는지, 실력 단계가 제대로 나뉘는지 확인한다.
const { createGameFactory, assert, failCount } = require('./helpers');
const g0 = createGameFactory()();
const LV = ['easy', 'normal', 'hard'];

function newGame(ids, first) {
  const deck = g0.shuffle(g0.makeDeck(ids.length === 2)), hands = {}, nicks = {};
  ids.forEach(id => { hands[id] = []; nicks[id] = id; });
  for (let i = 0; i < 3; i++) ids.forEach(id => hands[id].push(deck.pop()));
  return { status: 'playing', order: ids, hands, deck, discard: [], total: 0, prevTotal: 0,
    turn: first || ids[0], dir: 1, nicks, log: [], loser: null, lastCard: null };
}
function run(g, lvOf) {
  let turns = 0;
  while (g.status === 'playing' && turns < 500) {
    const id = g.turn, ch = g0.botChoice(g, id, lvOf(id));
    if (!ch) { g.turn = g0.nextPlayer(g, id); turns++; continue; }
    if (!g0.applyPlay(g, id, ch.card, ch.opt) || g.total < 0) return -1;
    turns++;
  }
  return g.status === 'ended' ? turns : -1;
}

/* 1) 2~4명, 실력 섞어서 3000판: 오류 없이 끝나야 함 */
let errors = 0, maxT = 0;
for (let t = 0; t < 3000; t++) {
  const n = 2 + Math.floor(Math.random() * 3), ids = [];
  for (let i = 0; i < n; i++) ids.push('p' + i);
  const lv = {}; ids.forEach(id => { lv[id] = LV[Math.floor(Math.random() * 3)]; });
  const r = run(newGame(ids), id => lv[id]);
  if (r < 0) errors++; else maxT = Math.max(maxT, r);
}
assert(errors === 0, `봇 대전 3000판 오류 없음 (최대 ${maxT}턴)`);

/* 2) 1:1 4000판씩 패배율로 실력 차이 확인 */
function lossRate(a, b, N = 4000) {
  let lost = 0;
  for (let t = 0; t < N; t++) {
    const g = newGame(['a', 'b'], t % 2 ? 'a' : 'b');
    run(g, id => (id === 'a' ? a : b));
    if (g.loser === 'a') lost++;
  }
  return lost / N;
}
const hn = lossRate('hard', 'normal'), ne = lossRate('normal', 'easy');
assert(hn < 0.4, `어려움이 보통보다 강함 (어려움 패배율 ${(hn * 100).toFixed(0)}%)`);
assert(ne < 0.5, `보통이 쉬움보다 강함 (보통 패배율 ${(ne * 100).toFixed(0)}%)`);
process.exit(failCount() ? 1 : 0);
