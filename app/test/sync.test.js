// 同期エンジン (sync.js) の単体テスト。node --test で実行する。
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Party, READ_STATE, controlScript, POLL_MS } = require('../sync');

// プレイヤーの状態を外から差し替えられる偽のページ（CDP の page.evaluate 相当）
function fakePage() {
  const page = {
    state: null,
    scripts: [],
    async evaluate(script) {
      if (script === READ_STATE) return page.state;
      page.scripts.push(script);
      return undefined;
    },
  };
  return page;
}

// 送信内容を記録するだけの偽トランスポート
function fakeTransport() {
  const t = new EventEmitter();
  t.sent = [];
  t.connect = async () => {};
  t.send = (m) => t.sent.push(m);
  t.close = () => {};
  return t;
}

async function setup() {
  const party = new Party();
  const transport = fakeTransport();
  await party.useTransport(transport);
  transport.emit('message', { type: 'created', roomId: '123456' });
  const page = fakePage();
  party.page = page; // attach() はタイマーを張るので、テストでは poll() を直接呼ぶ
  return { party, transport, page };
}

test('ローカルの一時停止を検知して pause を送る', async () => {
  const { party, transport, page } = await setup();
  page.state = { t: 10, p: false };
  await party.poll();
  page.state = { t: 10.5, p: true };
  await party.poll();
  assert.deepEqual(transport.sent, [{ type: 'pause', time: 10.5 }]);
});

test('通常の再生進行ではイベントを送らない', async () => {
  const { party, transport, page } = await setup();
  page.state = { t: 10, p: false };
  await party.poll();
  page.state = { t: 10 + POLL_MS / 1000, p: false };
  await party.poll();
  assert.deepEqual(transport.sent, []);
});

test('ポーリング間の大きな時刻ジャンプはシークとして送る', async () => {
  const { party, transport, page } = await setup();
  page.state = { t: 10, p: false };
  await party.poll();
  page.state = { t: 95, p: false };
  await party.poll();
  assert.deepEqual(transport.sent, [{ type: 'seek', time: 95, paused: false }]);
});

test('相手の操作を反映した直後の状態変化は送り返さない（エコー防止）', async () => {
  const { party, transport, page } = await setup();
  page.state = { t: 10, p: true };
  await party.poll();

  transport.emit('message', { type: 'play', time: 42 });
  assert.equal(page.scripts.length, 1, '制御スクリプトがページへ送られる');
  assert.match(page.scripts[0], /const time = 42;/);
  assert.match(page.scripts[0], /const wantPlay = true;/);

  page.state = { t: 42, p: false }; // 反映の結果ローカルが再生状態になった
  await party.poll();
  assert.deepEqual(transport.sent, [], '抑制期間中は送信しない');

  party.suppressUntil = 0; // 抑制期間が過ぎたあとのユーザー操作は送る
  page.state = { t: 42.5, p: true };
  await party.poll();
  assert.deepEqual(transport.sent, [{ type: 'pause', time: 42.5 }]);
});

test('途中参加すると現在位置を要求し、ホストは自分の位置を返す', async () => {
  const { party, transport, page } = await setup();
  transport.emit('message', { type: 'joined', roomId: '123456', count: 2 });
  assert.deepEqual(transport.sent.at(-1), { type: 'sync-request' });

  page.state = { t: 300, p: false };
  await party.poll();
  transport.emit('message', { type: 'sync-request' });
  assert.deepEqual(transport.sent.at(-1), { type: 'sync-state', time: 300, paused: false });
});

test('controlScript は一時停止付きシークで停止フラグを立てる', () => {
  const script = controlScript({ type: 'seek', time: 12.5, paused: true });
  assert.match(script, /const time = 12.5;/);
  assert.match(script, /const wantPlay = false;/);
  assert.match(script, /const wantPause = true;/);
});
