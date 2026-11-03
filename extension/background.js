// Service Worker: サーバーとのWebSocket接続を一元管理し、
// ポップアップ(UI) と コンテンツスクリプト(プレイヤー制御) の間を中継する。
// ページのCSPにブロックされないよう、WS接続はここで張る。

let ws = null;
let state = {
  connected: false,
  roomId: null,
  peers: 1,
  tabId: null, // 同期対象のタブ
  serverUrl: 'ws://localhost:8787'
};

function broadcastState() {
  chrome.runtime.sendMessage({ cmd: 'state', state }).catch(() => {});
}

function toContent(msg) {
  if (state.tabId == null) return;
  chrome.tabs.sendMessage(state.tabId, msg).catch(() => {});
}

function connect(serverUrl, onOpen) {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  state.serverUrl = serverUrl;
  ws = new WebSocket(serverUrl);

  ws.onopen = () => {
    state.connected = true;
    broadcastState();
    if (onOpen) onOpen();
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'ping':
        return; // Service Workerの延命用
      case 'created':
      case 'joined':
        state.roomId = msg.roomId;
        state.peers = msg.count || 1;
        broadcastState();
        toContent({ cmd: 'room', roomId: msg.roomId });
        if (msg.type === 'joined') {
          // 参加直後にホスト側へ現在位置を問い合わせる
          sendToServer({ type: 'sync-request' });
        }
        return;
      case 'peers':
        state.peers = msg.count;
        broadcastState();
        toContent({ cmd: 'peers', count: msg.count });
        return;
      case 'error':
        chrome.runtime.sendMessage({ cmd: 'server-error', message: msg.message }).catch(() => {});
        return;
      // play / pause / seek / chat / sync-request / sync-state はプレイヤーへ
      default:
        toContent({ cmd: 'remote', event: msg });
    }
  };

  ws.onclose = () => {
    state.connected = false;
    state.roomId = null;
    state.peers = 1;
    broadcastState();
    toContent({ cmd: 'room', roomId: null });
    ws = null;
  };

  ws.onerror = () => {
    chrome.runtime.sendMessage({
      cmd: 'server-error',
      message: 'サーバーに接続できません。server.js が起動しているか確認してください。'
    }).catch(() => {});
  };
}

function sendToServer(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.cmd) {
    case 'create':
      state.tabId = msg.tabId;
      connect(msg.serverUrl, () => sendToServer({ type: 'create' }));
      break;
    case 'join':
      state.tabId = msg.tabId;
      connect(msg.serverUrl, () => sendToServer({ type: 'join', roomId: msg.roomId }));
      break;
    case 'leave':
      if (ws) { try { ws.close(); } catch {} }
      break;
    case 'status':
      sendResponse({ state });
      return; // 同期応答
    case 'playerEvent':
      // コンテンツスクリプトからのローカル操作をルームへ中継
      if (sender.tab && sender.tab.id === state.tabId) sendToServer(msg.event);
      break;
  }
});
