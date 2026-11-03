// コンテンツスクリプト: <video>要素を監視して操作イベントを送信し、
// 相手の操作を受信して自分のプレイヤーに反映する。チャットオーバーレイも描画する。

const IS_NETFLIX = location.hostname.includes('netflix.com');
const SEEK_THRESHOLD = 1.5; // 秒。これ以上ズレていたらシークとみなす

let video = null;
let inRoom = false;
let suppressUntil = 0; // リモート操作反映中はローカルイベントを送らない

// ---- Netflix: ページ本体のコンテキストに制御用スクリプトを注入 ----
// Netflixの<video>はcurrentTimeを直接書き換えられないため、
// 内部プレイヤーAPIをページ側から叩く必要がある。
if (IS_NETFLIX) {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected/netflix.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
}

function suppress(ms = 800) {
  suppressUntil = Date.now() + ms;
}
function isSuppressed() {
  return Date.now() < suppressUntil;
}

function sendEvent(event) {
  if (!inRoom) return;
  chrome.runtime.sendMessage({ cmd: 'playerEvent', event }).catch(() => {});
}

// ---- ローカルプレイヤーの操作を検知 ----
function attachVideo(v) {
  if (video === v) return;
  video = v;

  v.addEventListener('play', () => {
    if (isSuppressed()) return;
    sendEvent({ type: 'play', time: v.currentTime });
  });

  v.addEventListener('pause', () => {
    if (isSuppressed()) return;
    sendEvent({ type: 'pause', time: v.currentTime });
  });

  v.addEventListener('seeked', () => {
    if (isSuppressed()) return;
    sendEvent({ type: 'seek', time: v.currentTime, paused: v.paused });
  });
}

// SPA遷移で<video>が差し替わるためポーリングで追従
setInterval(() => {
  const v = document.querySelector('video');
  if (v) attachVideo(v);
}, 1000);

// ---- リモート操作を自分のプレイヤーへ反映 ----
function nfCommand(action, timeSec) {
  // ページ側 injected/netflix.js へ渡す
  window.postMessage({ source: 'mwp-ext', action, timeMs: timeSec != null ? Math.round(timeSec * 1000) : null }, '*');
}

function applyRemote(event) {
  if (!video) return;
  suppress();

  const needSeek = event.time != null && Math.abs(video.currentTime - event.time) > SEEK_THRESHOLD;

  if (IS_NETFLIX) {
    if (needSeek) nfCommand('seek', event.time);
    if (event.type === 'play') nfCommand('play');
    if (event.type === 'pause') nfCommand('pause');
    if (event.type === 'seek' && event.paused === false) nfCommand('play');
    return;
  }

  // プライムビデオ等: 標準のHTMLMediaElement APIで制御
  if (needSeek) video.currentTime = event.time;
  if (event.type === 'play' && video.paused) video.play().catch(() => {});
  if (event.type === 'pause' && !video.paused) video.pause();
  if (event.type === 'seek' && event.paused === false && video.paused) video.play().catch(() => {});
}

// ---- backgroundからのメッセージ ----
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.cmd) {
    case 'room':
      inRoom = !!msg.roomId;
      if (inRoom) {
        showOverlay();
        addChatLine('system', `ルーム ${msg.roomId} に接続しました`);
      } else {
        addChatLine('system', 'ルームから切断されました');
      }
      break;
    case 'peers':
      addChatLine('system', `現在 ${msg.count} 人が視聴中`);
      break;
    case 'remote': {
      const ev = msg.event;
      if (ev.type === 'chat') {
        addChatLine('peer', ev.text);
      } else if (ev.type === 'sync-request') {
        // 新規参加者に現在の状態を教える
        if (video) {
          sendEvent({ type: 'sync-state', time: video.currentTime, paused: video.paused });
        }
      } else if (ev.type === 'sync-state') {
        applyRemote({ type: ev.paused ? 'pause' : 'play', time: ev.time });
      } else {
        applyRemote(ev);
      }
      break;
    }
  }
});

// ---- チャットオーバーレイ ----
let overlay = null;
let chatLog = null;

function showOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'mwp-overlay';
  overlay.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:12px', 'width:280px', 'max-height:40vh',
    'z-index:2147483647', 'display:flex', 'flex-direction:column',
    'background:rgba(20,20,25,0.88)', 'color:#eee', 'border-radius:10px',
    'font:13px/1.5 sans-serif', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)', 'overflow:hidden'
  ].join(';');

  const header = document.createElement('div');
  header.textContent = '🎬 Watch Party';
  header.style.cssText = 'padding:6px 10px;font-weight:bold;background:rgba(255,255,255,0.08);cursor:pointer;';
  header.title = 'クリックで折りたたみ';

  chatLog = document.createElement('div');
  chatLog.style.cssText = 'flex:1;overflow-y:auto;padding:8px 10px;min-height:60px;';

  const input = document.createElement('input');
  input.placeholder = 'メッセージを送る…';
  input.style.cssText = 'border:0;outline:0;padding:8px 10px;background:rgba(255,255,255,0.12);color:#fff;';
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // プレイヤーのショートカット(スペース等)に食われないように
    if (e.key === 'Enter' && input.value.trim()) {
      sendEvent({ type: 'chat', text: input.value.trim() });
      addChatLine('me', input.value.trim());
      input.value = '';
    }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    chatLog.style.display = collapsed ? 'none' : 'block';
    input.style.display = collapsed ? 'none' : 'block';
  });

  overlay.append(header, chatLog, input);
  document.documentElement.appendChild(overlay);
}

function addChatLine(kind, text) {
  if (!chatLog) return;
  const line = document.createElement('div');
  line.style.marginBottom = '4px';
  if (kind === 'system') {
    line.style.opacity = '0.6';
    line.textContent = `— ${text}`;
  } else {
    line.textContent = `${kind === 'me' ? 'あなた' : '相手'}: ${text}`;
    if (kind === 'me') line.style.color = '#8ecbff';
  }
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}
