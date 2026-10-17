// 가짜 MQTT 중계 서버로 방장 1 + 친구 2 의 멀티플레이 흐름을 검증한다.
const { createFakeMqtt, createGameFactory, wait, assert, failCount } = require('./helpers');
const { mqtt, down } = createFakeMqtt();
const mk = createGameFactory(mqtt);
const enter = (c, nick, room) => { c.S.nick = nick; c.S.codeInput = room; return c.joinRoom(); };

async function playOut(clients, hostc) {
  let n = 0;
  while (hostc.S.game.status === 'playing' && n < 400) {
    const t = hostc.S.game.turn, c = clients.find(x => x.S.uid === t);
    const g = c.S.game, hand = g.hands[t]; let pick = null;
    for (const card of hand) {
      const o = c.options(card, g.total).find(o => !o.over);
      if (o) { pick = { card, o }; break; }
    }
    if (!pick) { const card = hand[0]; pick = { card, o: c.options(card, g.total)[0] }; }
    await c.playCard(pick.card, pick.o); await wait(25); n++;
  }
  return n;
}

(async () => {
  // 1) 세 명이 같은 새 방에 동시에 입장 -> 방장은 정확히 1명
  const [H, A, B] = [mk(), mk(), mk()];
  await Promise.all([enter(H, '호스트', '4821'), enter(A, '철수', '4821'), enter(B, '영희', '4821')]);
  await wait(900);
  const all = [H, A, B];
  assert(all.filter(c => c.S.role === 'host').length === 1, '동시 입장해도 방장은 1명');
  const host = all.find(c => c.S.role === 'host');
  assert(host.S.players.length === 3, '방장이 3명 모두 확인');
  assert(all.every(c => c.S.game && c.S.players.length === 3 && c.S.players.some(p => p.id === c.S.uid)),
    '모든 화면에 같은 3명 대기실');

  // 2) 게임 진행 / 종료 / 한 판 더
  await host.startGame(); await wait(150);
  assert(all.every(c => c.S.game.status === 'playing' && c.S.game.hands[c.S.uid].length === 3), '모두 3장씩 받고 시작');
  const n = await playOut(all, host); await wait(100);
  assert(host.S.game.status === 'ended' && host.S.game.loser, `게임 종료 (${n}번 냄)`);
  assert(all.every(c => JSON.stringify(c.S.game) === JSON.stringify(host.S.game)), '모든 화면의 최종 상태 동일');
  await host.startGame(); await wait(150);
  assert(host.S.game.status === 'playing' && host.S.game.round === 2, '한 판 더');

  // 3) 친구 연결이 갑자기 끊겼다가 같은 닉네임으로 재입장
  const guest = all.find(c => c.S.role === 'guest');
  const gnick = guest.S.nick, gid = guest.S.uid;
  guest.S.mqs.forEach(c => c._crash()); guest.S.mqs = []; guest.S.role = null;
  await wait(100);
  const G2 = mk(); await enter(G2, gnick, '4821'); await wait(300);
  assert(G2.S.game && G2.S.game.hands[G2.S.uid] && G2.S.game.hands[G2.S.uid].length === 3 &&
    !host.S.game.order.includes(gid), '끊겼던 친구가 같은 닉네임으로 재입장하면 패를 이어받음');

  // 4) 모르는 사람은 진행 중인 방에 못 들어옴
  const C = mk(); await enter(C, '낯선이', '4821'); await wait(300);
  assert(C.S.code === null && C.toasts.some(t => /진행 중/.test(t)), '진행 중 방에는 입장 거절');

  // 5) 방장이 나가면 친구들은 홈으로
  const others = all.filter(c => c !== host && c !== guest);
  await host.leaveRoom(); await wait(200);
  assert(others.every(c => c.S.code === null), '방장이 나가면 친구들은 홈으로');

  // 6) 중계 서버 하나가 죽어 있어도 입장 가능, 다른 방번호는 분리
  down.add('wss://broker.emqx.io:8084/mqtt');
  const [H2, A2, B2] = [mk(), mk(), mk()];
  await enter(H2, '방장', '7777'); await wait(100);
  await enter(A2, '친구1', '7777'); await enter(B2, '친구2', '7777'); await wait(300);
  assert(H2.S.role === 'host' && H2.S.players.length === 3 && A2.S.role === 'guest' && B2.S.role === 'guest',
    '서버 하나가 죽어도 순차 입장 가능');
  const X = mk(); await enter(X, '다른방', '8888'); await wait(100);
  assert(X.S.role === 'host' && X.S.players.length === 1, '다른 방번호는 별도 방');

  // 7) 모든 서버가 죽어 있으면 안내 문구
  ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'].forEach(u => down.add(u));
  const Y = mk(); await enter(Y, '오프라인', '9999'); await wait(100);
  assert(Y.S.code === null && Y.toasts.some(t => /연결 서버/.test(t)), '전부 불통이면 안내 문구');

  process.exit(failCount() ? 1 : 0);
})();
