# 99 카드게임 (정적 단일 HTML 웹게임)

친구와 방번호로 같이 하거나, 혼자 봇과 하는 99 카드게임. **빌드 없이 `index.html` 하나**로 동작하고 GitHub Pages로 배포한다.
사용자는 한국어 사용자다. 화면 문구·설명·커밋 메시지는 한국어(해요체)로 쓴다.

## 자주 쓰는 명령
- 실행: `python3 -m http.server 8000` → `http://localhost:8000` (폰에서는 같은 와이파이의 PC IP로 접속)
- 테스트: `node tests/bots.test.js && node tests/net.test.js` (또는 `npm test`)
  - 테스트는 `index.html` 안의 인라인 스크립트를 자동으로 꺼내 쓰므로 따로 빌드/동기화가 필요 없다.
  - `net.test.js`는 가짜 Firebase(`helpers.js`의 `createFakeFirebase`, DB 규칙을 단순 흉내)로 동시 입장·패 숨김·방장 끊김/이어 받기·재입장·방 삭제를 검증한다.
  - 진짜 서버 시험: `node _workspace\live.mjs`(Node 3명, 규칙까지) · `node _workspace\live-browser.mjs [주소]`(브라우저 2개). 둘 다 ssub-kk 실DB에 시험 방을 만들고 지운다.
- 배포: GitHub `ssub-kk/99-card-game` main에 push → https://ssub-kk.github.io/99-card-game/ (Pages, main/root).
- DB 규칙은 이 폴더가 아니라 `D:\studio\_firebase\database.rules.json`의 `card99` 칸 → `cd D:\studio\_firebase; npx firebase deploy --only database`.

## 파일 구조
- `index.html` — 게임 전부(CSS + HTML + JS). JS는 하나의 IIFE, `/* ---------- 구역 ---------- */` 주석으로 나뉜다.
  유틸 → 규칙(`options`, `face`) → 저장(`save`) → 네트워크 → 게임 진행(`startGame`, `applyPlay`, `playCard`) → 봇 → 화면 조각 → 화면(`homeHTML`, `lobbyHTML`, `gameHTML`, `render`) → 이벤트(`data-act` 위임) → 시작.
- `tests/` — Node 테스트(`helpers.js`가 스크립트 추출·가짜 Firebase·가짜 브라우저 환경 제공)
- 외부 의존: Google Fonts(Do Hyeon, Noto Sans KR), Firebase JS SDK `12.19.0`(gstatic, `fbInit`에서 동적 import, 버전 고정). 새 라이브러리를 넣을 땐 **정확한 버전 고정**.

## 게임 규칙
- 52장 덱(`makeDeck`, 카드 id는 `숫자+무늬` 예: `7H`, `10S`). 무늬는 효과와 무관. 손패 3장, 낸 뒤 1장 뽑고(덱이 비면 버린 카드 섞어 재사용) 항상 3장 유지.
- 합계는 0에서 시작. **합계가 99를 넘기면 그 카드를 낸 사람이 지고 종료**(99 정확히는 안전).
- 카드 효과(`options(card,total)`이 가능한 선택지 목록을 돌려줌):

| 카드 | 효과 |
|---|---|
| A | +1, +11 중 선택. 합계가 1 이상이면 −1, 11 이상이면 −11도 선택 가능 |
| 2·3·5·6·7·8 | 숫자만큼 더하기 |
| 4 | 진행 방향 반대(합계 그대로). **2명 게임(봇·친구)에선 덱에서 뺀다**(`makeDeck(no4)`, 48장) |
| 9 | 패스(합계 그대로) |
| 10 | +10, 합계가 10 이상이면 −10도 선택 가능 |
| J·Q | +10 |
| K | 합계를 99로 |

- 선택지가 1개면 바로 내고, 2개 이상이면 선택 버튼이 뜬다(`S.pending`). 모든 선택지가 99 초과인 카드는 `isRisky` → 빨간 테두리+경고.
- 규칙을 바꾸면 **`options`, `face`(카드 면 표시), `rulesData`(하단 룰 표시), 봇 점수(`botChoice`)** 를 같이 고치고 테스트를 돌린다.

## 상태 구조
- `S` : 클라이언트 로컬 상태(내 id `uid`(=Firebase 익명 uid), `role`(host|guest), `isHostNet`(방장 이어 받기가 끝나 실제로 방장 노릇 중), `game`, `players`, `code`, `pending`, 솔로 여부 `solo`, `botLevel` 등).
- `S.game` — 방장에겐 진짜 전체 상태, 친구에겐 `viewOf`로 만든 화면용 상태(남의 패는 장수만큼 `"?"`, 덱은 장수만큼 0):
  `status`(lobby|playing|ended), `hostId`, `round`, `order`(차례 순서 id 배열), `hands{id:[카드]}`, `deck`, `discard`, `total`, `prevTotal`, `turn`, `dir`(1|−1), `nicks{id:닉}`, `log`, `loser`, `lastCard`, `lastLabel`, `lastBy`, `losses{id:진 횟수}`.
- `S.players` : `[{id,nick,joinedAt,on}]` (DB `players`에서, 들어온 순).
- 항상 `clone(S.game)`으로 복사해서 `applyPlay`로 바꾼 뒤 `save(g)`. 직접 `S.game`을 수정하지 않는다.

## 네트워크 (멀티플레이) — Firebase 실시간 DB + 방장 중심
- 프로젝트 `ssub-kk`(웹 앱 card99, 설정값 `FB_CONFIG`는 공개용이라 코드에 둔다), 익명 로그인. DB 칸: `card99/rooms/<방번호>/`
  - `createdAt`, `host`(방장 uid), `players/<uid>{nick,at,on}` — `on`은 `.info/connected` + `onDisconnect`로 관리, 탭을 떠나면(`pagehide`) `goOffline`.
  - `pub` 공개 상태 JSON `{m,g}`(손패·덱 대신 `hc`·`dk` 장수), `secret` 전체 상태(방장만 읽음), `hands/<uid>` 내 손패(나만 읽음), `req/<uid>` 낼 카드 요청 `{m,card,i}`.
  - 깊은 상태는 RTDB가 빈 배열을 지우므로 **JSON 글자로 통째 저장**. `m`은 방장이 상태를 바꿀 때마다 +1, 요청의 `m`이 현재와 다르면 무시(옛 요청 재적용 방지).
- 입장(`joinRoom`): 방이 없거나 하루 지났으면 만들고 방장, 있으면 `players`에 나를 쓰고 친구. 진행 중인 방은 같은 닉네임의 끊긴 자리가 있을 때만 `re`로 이어 받기(방장이 `remapId`).
- 방장이 규칙을 검증한다(`onReq`: 차례·손패·선택지). 상태가 바뀌면 `pushState`가 `pub`·`secret`·`hands/*`를 한 번에 `update`.
- **방장 이어 받기**: 방장 `on=false`가 `HOST_GRACE`(15초, 폰 앱 전환 정도로는 안 넘어가게) 넘으면 접속 중인 사람 중 먼저 들어온 사람이 `host`를 트랜잭션으로 가져가고(`netTick`), `secret`을 읽어 같은 판을 이어 간다(`takeHost`). 트랜잭션은 내 화면에 먼저 보이므로 **`secret` 읽기가 허락될 때까지 다시 시도**하고, 다 읽은 뒤에야 `isHostNet=true`.
- 방장이 '나가기'를 누르면 다음 사람에게 `host`를 넘기고, 아무도 없으면 방을 지운다. 대기실에서 `LOBBY_GRACE`(8초) 넘게 끊긴 사람은 방장이 목록에서 지운다. 게임 중엔 자리 유지.
- **건너뛰기**: 차례인 사람이 끊기면 모두에게 "OO 님 연결을 기다리는 중…", `SKIP_WAIT`(20초) 넘게 끊겨 있어야 방장에게 'OO 님 차례 건너뛰기' 단추가 뜬다(`awayMs`, `skipTurn`도 같은 조건으로 막음). 접속 중이거나 잠깐 끊긴 사람은 절대 건너뛰지 않는다.
- 시간 상수 줄(`DAY_MS, HOST_GRACE, LOBBY_GRACE, TICK_MS, SKIP_WAIT`)은 `tests/helpers.js`가 정규식으로 짧게 바꿔 시험한다 — 줄 모양을 바꾸면 helpers도 고칠 것(못 찾으면 시험이 바로 실패).
- 초대 링크 `?room=번호`(대기실 '초대 링크 복사'), 열면 방 번호가 채워진다.
- DB 규칙(`D:\studio\_firebase\database.rules.json`): 방 만들기는 없거나 하루 지난 방만 · `host` 변경은 현재 방장이거나(넘기기) 방장이 끊겼을 때 접속 중인 사람만 · `pub/secret/hands`는 방장만 씀 · `req/<uid>`는 본인만.
- 한계: 방장 기기는 전체 상태를 가지므로 방장은 남의 패를 볼 수 있다(서버 함수 없이 하는 한 어쩔 수 없음).

## 솔로 모드 (봇)
- 홈의 "혼자 하기": 네트워크 없이 로컬에서 동작. `S.solo=true`, 내 id는 `"me"`, 봇은 `bot1..3`(`BOT_NAMES`).
- `save()`가 솔로일 땐 `S.game`에 바로 넣고 `botTick()`이 봇 차례에 1~1.7초 뒤 `botPlay()`를 실행.
- `botChoice(g,id,lv)` 실력 3단계(`BOT_LEVELS`, 홈에서 고름, `g99_lv` 저장):
  - `easy` 안전한 선택지 중 아무거나 / `normal` 합계가 높은 쪽 선호(+잡음), K는 70 이상, 4·9는 80 이상에서 / `hard` 다음 사람이 막힐 확률(`stuckChance`)을 높이고 탈출 카드(A·4·9·10·K)를 아끼며 내 다음 차례 안전도 본다.
  - `bots.test.js`가 1:1 4000판으로 어려움 < 보통 < 쉬움 패배율을 확인(어려움 vs 보통 ≈ 25%, 보통 vs 쉬움 ≈ 43%).

## 화면/디자인 규칙
- 모바일 우선(갤럭시 360×780 기준). 헤더 "99 카드게임 · 봇 대전 · 덱 n장 · ✕(그만하기)"는 **한 줄**로 유지(좁은 화면용 `@media (max-width:400px)` 있음).
- 게임 화면 순서: 헤더 → 참여자 박스(이름+남은 카드 수, 사이 화살표=진행 방향) → 차례 안내 → 합계 물탱크 → 손패 3장 → 룰 보기.
  - 게임 화면은 `.wrap.g`(높이 100dvh)이고 **물탱크가 남는 높이를 채운다**(`flex:1`, 최소 150·최대 330px, 안의 숫자판은 `cqh`로 줄어듦). 높이를 숫자로 고정하지 않는다.
  - 물탱크 안: 왼쪽 위 마지막으로 낸 카드(`lastPlayHTML`), 가운데 숫자판, 아래쪽에 겹쳐 뜨는 선택지(`choiceHTML`) — 손패 위치가 움직이지 않게.
  - 600px 이상은 기둥 560px, 900px 이상은 2단(왼쪽 탱크 / 오른쪽 참여자·손패) grid.
- 그만하기/나가기는 확인창(`leaveSheetHTML`)을 거친다. 종료 화면에 누적 진 횟수(`g.losses`).
- 타격감(`/* 타격감 */` 구역): 카드를 누르면 `fxPrepare`가 카드 복제본(`.flycard`)을 띄우고, `render()` 끝의 `runFx`가 물탱크로 날려 쾅(숫자판·탱크 흔들림·고리·효과 숫자) + 효과음(WebAudio 합성) + 진동. 남이 낸 카드는 소리 없이 가볍게. 효과음·진동 켜기/끄기는 룰 시트(`g99_fx`).
- 상시 움직이는 애니메이션 금지(물결은 그릴 때 한 번만).
- 카드: 상아색 카드(2:3, 최대 높이 220px)를 **물방울(`cardDropSVG`)이 꽉 채우고**, 효과 글씨는 물방울 배 안(위 66%). 숫자(A·J 등 랭크)는 어디에도 표시하지 않는다(마지막 카드·종료 화면도 물방울로). 눈은 위쪽 뾰족한 곳.
  - 크기는 카드의 컨테이너 단위(`cqw/cqh`, `--w`)로 맞춘다. 한 줄 카드는 글씨를 키운다(`.card.one`). 물방울 색: 파랑(+) / 민트(±0) / 주황(K).
- 색은 `:root` CSS 변수(라이트/다크 `prefers-color-scheme` + `data-theme`)로만 쓴다. 하드코딩 색을 늘리지 않는다.
- 화면은 `render()`가 `innerHTML`로 통째로 다시 그린다. 클릭은 `data-act="..."` 이벤트 위임(`/* 이벤트 */`). 사용자 입력은 `esc()`로 이스케이프.
- 문구는 해요체, 이모지는 최소.

## 건드릴 때 주의
- `index.html` 하나로 유지(빌드 도구·번들러 도입 금지, 외부 CSS/JS는 고정 버전 CDN만).
- DB 칸 구조나 `pub/secret` 모양을 바꾸면 **이미 열려 있는 옛 페이지와 통신이 안 된다**. 바꿀 때는 `GAME_ID`를 바꿔(규칙 칸도 함께) 방을 분리하고, 친구들에게 새로고침을 안내한다.
- `S.game`에 필드를 추가하면 `startGame`의 초기 객체, `applyPlay`, 종료 화면(`endHTML`), 재입장(`remapId`)도 확인한다.
- 수정 후에는 `npm test`, 그리고 360px 폭에서 솔로 모드 화면을 직접 확인한다(Playwright로 스크린샷을 찍어도 좋다).

## 알려진 한계 / 개선 아이디어
- 방장은 남의 패를 볼 수 있음(위 '한계'). 막으려면 Cloud Functions(유료 Blaze)로 판을 서버에서 돌려야 함.
- Firebase 무료(Spark) RTDB는 동시 접속 100명까지.
- 방번호가 짧으면 다른 사람과 우연히 겹칠 수 있음 → '랜덤'이나 긴 번호 권장.
- 접근성(스크린리더).
- 버전·변경 기록은 `패치노트.md`, 화면 점검은 `node _workspace\review.mjs`(7기기 숫자) · `node _workspace\shots.mjs`(눈 확인용 스크린숏, 보고 나서 지움).
