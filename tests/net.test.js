// 가짜 Firebase 실시간 DB로 방장 1 + 친구 2 의 멀티플레이 흐름을 검증한다.
const { createFakeFirebase, createGameFactory, wait, assert, failCount } = require('./helpers');
const fb = createFakeFirebase();
/* 각 클라이언트의 DB 어댑터를 uid로 찾아 끊김·재연결을 흉내 낸다 */
const adapters = new Map();
const mk = createGameFactory(() => ({ FB_ADAPTER: async () => { const a = fb.adapter(); adapters.set(a.uid, a); return a; } }));
const dbOf = c => adapters.get(c.S.uid);

const enter = (c, nick, room) => { c.S.nick = nick; c.S.codeInput = room; return c.joinRoom(); };
const R = code => 'card99/rooms/' + code;

async function playOut(clients, steps = 400) {
  let n = 0;
  const hostc = () => clients.find(c => c.S.isHostNet);
  while (hostc() && hostc().S.game.status === 'playing' && n < steps) {
    const t = hostc().S.game.turn, c = clients.find(x => x.S.uid === t);
    /* 끊긴 사람 차례면 방장이 건너뛰기 */
    if (!c) { await hostc().skipTurn(); await wait(30); n++; continue; }
    const g = c.S.game, hand = g.hands[t]; let pick = null;
    if (!hand || hand.includes('?')) { await wait(20); continue; }
    for (const card of hand) {
      const o = c.options(card, g.total).find(o => !o.over);
      if (o) { pick = { card, o }; break; }
    }
    if (!pick) { const card = hand[0]; pick = { card, o: c.options(card, g.total)[0] }; }
    const m0 = hostc().S.m;
    await c.playCard(pick.card, pick.o);
    for (let i = 0; i < 50 && hostc().S.m === m0; i++) await wait(5);
    await wait(15); n++;
  }
  return n;
}

(async () => {
  // 1) 세 명이 같은 새 방에 동시에 입장 -> 방장은 정확히 1명
  const [H, A, B] = [mk(), mk(), mk()];
  await Promise.all([enter(H, '호스트', '4821'), enter(A, '철수', '4821'), enter(B, '영희', '4821')]);
  await wait(300);
  const all = [H, A, B];
  assert(all.filter(c => c.S.isHostNet).length === 1, '동시 입장해도 방장은 1명');
  const host = all.find(c => c.S.isHostNet);
  assert(all.every(c => c.S.code === '4821' && c.S.players.length === 3), '모든 화면에 같은 3명 대기실');

  // 2) 게임 시작: 내 패는 보이고 남의 패는 안 보임
  await host.startGame(); await wait(150);
  const guests = all.filter(c => c !== host);
  assert(all.every(c => c.S.game.status === 'playing' && c.S.game.hands[c.S.uid].length === 3 && !c.S.game.hands[c.S.uid].includes('?')),
    '모두 자기 패 3장을 받고 시작');
  assert(guests.every(c => c.S.game.order.filter(id => id !== c.S.uid).every(id => c.S.game.hands[id].every(x => x === '?'))),
    '친구 화면에는 남의 패가 장수만 보임');
  let peek = null; try { await dbOf(guests[0]).get(R('4821') + '/hands/' + guests[1].S.uid); } catch (e) { peek = e; }
  let peekS = null; try { await dbOf(guests[0]).get(R('4821') + '/secret'); } catch (e) { peekS = e; }
  assert(peek && peekS, '친구는 DB에서도 남의 패·전체 상태를 못 읽음');
  let cheat = null; try { await dbOf(guests[0]).set(R('4821') + '/pub', 'x'); } catch (e) { cheat = e; }
  assert(cheat, '친구는 공개 상태를 직접 못 고침');

  // 3) 끝까지 진행 / 한 판 더
  const n = await playOut(all); await wait(100);
  assert(host.S.game.status === 'ended' && host.S.game.loser, `게임 종료 (${n}번 냄)`);
  assert(guests.every(c => c.S.game.status === 'ended' && c.S.game.loser === host.S.game.loser && c.S.game.total === host.S.game.total),
    '모든 화면의 결과 동일');
  await host.startGame(); await wait(150);
  assert(host.S.game.round === 2 && guests.every(c => c.S.game.round === 2 && c.S.game.status === 'playing'), '한 판 더');

  // 4) 방장이 갑자기 끊기면 먼저 들어온 친구가 방장을 이어 받고 판이 계속됨
  const before = JSON.stringify(host.S.game.hands);
  dbOf(host)._crash();
  await wait(1200);
  const nh = guests.find(c => c.S.isHostNet);
  assert(nh && guests.filter(c => c.S.isHostNet).length === 1, '방장이 끊기면 친구 한 명이 방장을 이어 받음');
  assert(nh && JSON.stringify(nh.S.game.hands) === before && nh.S.game.status === 'playing', '이어 받은 방장이 같은 판(패 그대로)을 이어 감');
  // 끊긴 옛 방장 자리는 남아 있고, 그 차례면 새 방장이 건너뛰기
  if (nh.S.game.turn === host.S.uid) { await nh.skipTurn(); await wait(50); }
  const m0 = nh.S.m; const n2 = await playOut(guests, 3);
  assert(nh.S.m > m0 || nh.S.game.status === 'ended', `새 방장 아래에서 계속 진행 (${n2}번 냄)`);

  // 5) 옛 방장이 다시 연결되면 친구로 돌아옴
  dbOf(host)._reconnect(); await wait(300);
  assert(!host.S.isHostNet && host.S.game && host.S.game.status === nh.S.game.status, '돌아온 옛 방장은 친구가 됨');

  // 6) 다른 기기(새 uid)에서 같은 닉네임으로 재입장하면 자리를 이어 받음
  const other = guests.find(c => c !== nh);
  const onick = other.S.nick, oid = other.S.uid;
  await other.leaveRoom(); await wait(150);
  const G2 = mk(); await enter(G2, onick, '4821'); await wait(400);
  const ng = nh.S.game;
  assert(G2.S.code === '4821' && ng.order.includes(G2.S.uid) && !ng.order.includes(oid) &&
    G2.S.game.hands[G2.S.uid] && G2.S.game.hands[G2.S.uid].length >= 1 && !G2.S.game.hands[G2.S.uid].includes('?'),
    '같은 닉네임으로 재입장하면 패를 이어받음');

  // 7) 모르는 사람은 진행 중인 방에 못 들어옴
  const C = mk(); await enter(C, '낯선이', '4821'); await wait(100);
  assert(C.S.code === null && C.toasts.some(t => /진행 중/.test(t)), '진행 중 방에는 입장 거절');

  // 8) 방장이 '나가기'를 누르면 다음 사람에게 방장이 넘어감, 모두 나가면 방이 지워짐
  const cur = [host, nh, G2];
  await nh.leaveRoom(); await wait(300);
  assert(cur.filter(c => c !== nh && c.S.isHostNet).length === 1 && nh.S.code === null, '방장이 나가면 다음 사람이 방장');
  for (const c of cur.filter(c => c.S.code)) { await c.leaveRoom(); await wait(100); }
  assert(fb.read(R('4821')) === null, '모두 나가면 방이 지워짐');

  // 9) 다른 방번호는 별도 방, 대기실에서 끊긴 사람은 정리
  const [H2, A2] = [mk(), mk()];
  await enter(H2, '방장', '7777'); await enter(A2, '친구1', '7777'); await wait(100);
  const X = mk(); await enter(X, '다른방', '8888'); await wait(100);
  assert(H2.S.isHostNet && H2.S.players.length === 2 && X.S.isHostNet && X.S.players.length === 1, '다른 방번호는 별도 방');
  dbOf(A2)._crash(); await wait(800);
  assert(H2.S.players.length === 1, '대기실에서 끊긴 사람은 목록에서 빠짐');

  // 10) 연결이 안 되면 안내 문구
  const Y = createGameFactory(() => ({ FB_ADAPTER: async () => { throw { code: 'network' }; } }))();
  await enter(Y, '오프라인', '9999'); await wait(50);
  assert(Y.S.code === null && Y.toasts.some(t => /연결 서버/.test(t)), '연결이 안 되면 안내 문구');

  process.exit(failCount() ? 1 : 0);
})();
