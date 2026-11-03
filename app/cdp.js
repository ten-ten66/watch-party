// Chrome DevTools Protocol の最小クライアント。
// デバッグポート付きで起動したChrome/Edgeのタブに接続し、JSを評価する。
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  return targets.filter((t) => t.type === 'page');
}

class CdpPage {
  constructor(target) {
    this.target = target;
    this.pending = new Map();
    this.nextId = 1;
    this.closedPromise = new Promise((r) => (this._onClosed = r));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.target.webSocketDebuggerUrl);
      this.ws = ws;
      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', (d) => {
        let m;
        try { m = JSON.parse(d); } catch { return; }
        const cb = this.pending.get(m.id);
        if (cb) {
          this.pending.delete(m.id);
          cb(m);
        }
      });
      ws.on('close', () => this._onClosed());
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('CDP disconnected'));
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // ページのメインワールドで式を評価して値を返す
  async evaluate(expression) {
    const m = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (m.result?.exceptionDetails) return null;
    return m.result?.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

// 対象サービスのタブが現れるまでポーリングして接続する
async function findStreamingPage(port, pattern, ctl = {}) {
  while (!ctl.aborted) {
    try {
      const pages = await listPages(port);
      const target = pages.find((p) => pattern.test(p.url));
      if (target) {
        const page = new CdpPage(target);
        await page.connect();
        return page;
      }
    } catch {
      // ブラウザ起動前 or 終了後。リトライする
    }
    await sleep(2000);
  }
  return null;
}

module.exports = { CdpPage, listPages, findStreamingPage };
