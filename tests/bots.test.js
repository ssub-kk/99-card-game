// 봇끼리 2000판을 돌려서 규칙/덱/종료 로직이 깨지지 않는지 확인한다.
const { createFakeMqtt, createGameFactory, assert, failCount } = require('./helpers');
const { mqtt } = createFakeMqtt();
const g0 = createGameFactory(mqtt)();

const stats = { games: 0, errors: 0, maxTurns: 0 };
for (let t = 0; t < 2000; t++) {
  const n = 2 + Math.floor(Math.random() * 3), ids = [];
  for (let i = 0; i < n; i++) ids.push('p' + i);
  const deck = g0.shuffle(g0.makeDeck()), hands = {}, nicks = {};
  ids.forEach(id => { hands[id] = []; nicks[id] = id; });
  for (let i = 0; i < 3; i++) ids.forEach(id => hands[id].push(deck.pop()));
  const g = { status: 'playing', order: ids, hands, deck, discard: [], total: 0, prevTotal: 0,
    turn: ids[0], dir: 1, nicks, log: [], loser: null, lastCard: null };
  let turns = 0;
  while (g.status === 'playing' && turns < 500) {
    const id = g.turn, ch = g0.botChoice(g, id);
    if (!ch) { g.turn = g0.nextPlayer(g, id); turns++; continue; }
    if (!g0.applyPlay(g, id, ch.card, ch.opt) || g.total < 0) { stats.errors++; break; }
    turns++;
  }
  stats.games++;
  if (g.status !== 'ended') stats.errors++;
  stats.maxTurns = Math.max(stats.maxTurns, turns);
}
assert(stats.errors === 0, `봇 대전 2000판 오류 없음 (최대 ${stats.maxTurns}턴)`);
process.exit(failCount() ? 1 : 0);
