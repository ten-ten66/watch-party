// 同期イベントの通信路（トランスポート）2種類:
// - WsTransport: 自前のWebSocketサーバー経由（server/server.js）
// - DiscordTransport: Discordのテキストチャンネルを中継役に使う（サーバーのホスティング不要）
const { EventEmitter } = require('events');
const WebSocket = require('ws');

class WsTransport extends EventEmitter {
  constructor({ url, mode, roomId }) {
    super();
    this.url = url;
    this.mode = mode; // 'create' | 'join'
    this.roomId = roomId;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.on('open', () => {
        if (this.mode === 'create') this.send({ type: 'create' });
        else this.send({ type: 'join', roomId: this.roomId });
        resolve();
      });
      ws.on('error', (e) => {
        this.emit('error', 'サーバーに接続できません: ' + e.message);
        reject(e);
      });
      ws.on('message', (d) => {
        let m;
        try { m = JSON.parse(d); } catch { return; }
        this.emit('message', m);
      });
      ws.on('close', () => this.emit('close'));
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

const MWP_PREFIX = '[MWP]';

class DiscordTransport extends EventEmitter {
  constructor({ token, channelId }) {
    super();
    this.token = token;
    this.channelId = channelId;
    // 同じBotトークンを共有しても自分の送信を識別できるようセッションIDを持つ
    this.sid = Math.random().toString(36).slice(2, 10);
  }

  // メッセージ本文をパースする。自分の送信(sid一致)はnull
  static parse(content, ownSid) {
    if (typeof content !== 'string' || !content.startsWith(MWP_PREFIX)) return null;
    let m;
    try { m = JSON.parse(content.slice(MWP_PREFIX.length)); } catch { return null; }
    if (!m || typeof m !== 'object' || m.sid === ownSid) return null;
    return m;
  }

  async connect() {
    const { Client, GatewayIntentBits } = require('discord.js'); // 遅延require
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Dev PortalでMESSAGE CONTENT INTENTを有効にすること
      ]
    });

    this.client.on('messageCreate', (msg) => {
      if (msg.channelId !== this.channelId) return;
      const m = DiscordTransport.parse(msg.content, this.sid);
      if (m) this.emit('message', m);
    });

    try {
      await this.client.login(this.token);
      this.channel = await this.client.channels.fetch(this.channelId);
      if (!this.channel?.isTextBased()) throw new Error('テキストチャンネルではありません');
    } catch (e) {
      this.emit('error', 'Discordに接続できません: ' + e.message);
      throw e;
    }

    // チャンネル＝ルーム。参加イベントを合成してホストへの位置問い合わせを発火させる
    this.emit('message', { type: 'joined', roomId: '#' + (this.channel.name || this.channelId), count: null });
  }

  send(obj) {
    // discord.jsがレート制限(429)のキューイングを自動処理する
    this.channel?.send(MWP_PREFIX + JSON.stringify({ ...obj, sid: this.sid })).catch(() => {});
  }

  close() {
    try { this.client?.destroy(); } catch {}
  }
}

module.exports = { WsTransport, DiscordTransport };
