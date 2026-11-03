// 同期エンジン本体（Electron非依存・単体テスト可能）。
// トランスポート（自前サーバー or Discord）と、CDP経由のプレイヤー監視/制御をつなぐ。
const { EventEmitter } = require('events');

const POLL_MS = 500;
const SEEK_THRESHOLD = 1.5; // 秒。これ以上ズレていたら合わせにいく
const JUMP_THRESHOLD = 2.5; // ポーリング間の自然経過を超えたらユーザーのシークとみなす
const SUPPRESS_MS = 1500;   // リモート操作反映中はローカル操作として誤検知しない

// 再生状態の読み取り（全サービス共通: <video>から読む）
const READ_STATE = `(() => {
  const v = [...document.querySelectorAll('video')].find(x => x.duration > 0 && x.readyState > 0);
  if (!v) return null;
  return { t: v.currentTime, p: v.paused };
})()`;

// 再生制御スクリプトを生成する。
// Netflixは<video>のcurrentTime書き換えを受け付けないため内部プレイヤーAPIを使う。
// 先頭の /*MWP ...*/ コメントはテスト用マーカー（動作には無関係）。
function controlScript(ev) {
  const time = ev.time != null ? Number(ev.time) : null;
  const wantPlay = ev.type === 'play' || (ev.type === 'seek' && ev.paused === false);
  const wantPause = ev.type === 'pause' || (ev.type === 'seek' && ev.paused === true);
  return `/*MWP ${JSON.stringify(ev)} */(() => {
  const time = ${time};
  const wantPlay = ${wantPlay};
  const wantPause = ${wantPause};
  if (location.hostname.includes('netflix.com')) {
    try {
      const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds();
      const p = vp.getVideoPlayerBySessionId(ids.find(s => s.startsWith('watch-')) || ids[0]);
      if (time != null && Math.abs(p.getCurrentTime() / 1000 - time) > ${SEEK_THRESHOLD}) p.seek(Math.round(time * 1000));
      if (wantPlay) p.play();
      if (wantPause) p.pause();
    } catch (e) {}
    return;
  }
  const v = [...document.querySelectorAll('video')].find(x => x.duration > 0 && x.readyState > 0);
  if (!v) return;
  if (time != null && Math.abs(v.currentTime - time) > ${SEEK_THRESHOLD}) v.currentTime = time;
  if (wantPlay && v.paused) v.play().catch(() => {});
  if (wantPause && !v.paused) v.pause();
})()`;
}

class Party extends EventEmitter {
  constructor() {
    super();
    this.transport = null;
    this.page = null;
    this.prev = null;
    this.suppressUntil = 0;
    this.timer = null;
    this.roomId = null;
  }

  // トランスポート（WsTransport / DiscordTransport）を接続する。
  // ルームへの参加はトランスポート側がconnect時に行う。
  async useTransport(transport) {
    this.transport = transport;
    transport.on('message', (m) => this.onServer(m));
    transport.on('error', (text) => this.emit('error', text));
    transport.on('close', () => {
      this.roomId = null;
      this.emit('room', null, 0);
    });
    await transport.connect();
  }

  send(obj) {
    this.transport?.send(obj);
  }

  onServer(m) {
    switch (m.type) {
      case 'ping':
        return;
      case 'created':
        this.roomId = m.roomId;
        this.emit('room', m.roomId, 1);
        return;
      case 'joined':
        this.roomId = m.roomId;
        this.emit('room', m.roomId, m.count);
        this.send({ type: 'sync-request' }); // ホストの現在位置をもらう
        return;
      case 'peers':
        this.emit('peers', m.count);
        return;
      case 'error':
        this.emit('error', m.message);
        return;
      case 'sync-request':
        if (this.prev) this.send({ type: 'sync-state', time: this.prev.t, paused: this.prev.p });
        return;
      case 'sync-state':
        this.applyRemote({ type: m.paused ? 'pause' : 'play', time: m.time });
        return;
      case 'play':
      case 'pause':
      case 'seek':
        this.applyRemote(m);
        return;
    }
  }

  attach(page) {
    this.page = page;
    this.prev = null;
    this.timer = setInterval(() => this.poll().catch(() => {}), POLL_MS);
  }

  detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.page = null;
    this.prev = null;
  }

  // ローカルプレイヤーの状態変化を検知して送信
  async poll() {
    if (!this.page) return;
    const s = await this.page.evaluate(READ_STATE);
    if (!s) {
      this.prev = null;
      return;
    }
    const prev = this.prev;
    this.prev = s;
    if (!prev || !this.roomId) return;
    if (Date.now() < this.suppressUntil) return;

    if (s.p !== prev.p) {
      this.send({ type: s.p ? 'pause' : 'play', time: s.t });
      this.emit('info', s.p ? '⏸ 一時停止を送信' : '▶ 再生を送信');
      return;
    }
    const expected = prev.t + (prev.p ? 0 : POLL_MS / 1000);
    if (Math.abs(s.t - expected) > JUMP_THRESHOLD) {
      this.send({ type: 'seek', time: s.t, paused: s.p });
      this.emit('info', '⏩ シークを送信');
    }
  }

  // 相手の操作を自分のプレイヤーへ反映
  applyRemote(ev) {
    if (!this.page) return;
    this.suppressUntil = Date.now() + SUPPRESS_MS;
    this.page.evaluate(controlScript(ev)).catch(() => {});
    // 直後のポーリングでシークと誤検知しないよう prev も合わせる
    if (ev.time != null) {
      const paused = ev.type === 'pause' ? true : ev.type === 'play' ? false : (ev.paused ?? this.prev?.p ?? true);
      this.prev = { t: ev.time, p: paused };
    }
    const label = { play: '▶ 再生', pause: '⏸ 一時停止', seek: '⏩ シーク' }[ev.type];
    this.emit('info', `相手の操作を反映: ${label}`);
  }

  dispose() {
    this.detach();
    try { this.transport?.close(); } catch {}
    this.transport = null;
  }
}

module.exports = { Party, READ_STATE, controlScript, POLL_MS };
