const $ = (id) => document.getElementById(id);

const DEFAULT_SERVER = 'ws://localhost:8787';

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function render(state) {
  const inRoom = !!state.roomId;
  $('joinBox').style.display = inRoom ? 'none' : 'block';
  $('roomBox').style.display = inRoom ? 'block' : 'none';
  $('leave').style.display = inRoom ? 'block' : 'none';
  if (inRoom) {
    $('roomId').textContent = state.roomId;
    $('peers').textContent = `視聴中: ${state.peers}人`;
    $('status').textContent = '接続中 ✅';
    $('status').classList.remove('err');
  } else {
    $('status').textContent = state.connected ? '接続済み（ルーム未参加）' : '未接続';
  }
}

async function init() {
  const saved = await chrome.storage.local.get(['serverUrl', 'lastRoom']);
  $('server').value = saved.serverUrl || DEFAULT_SERVER;
  if (saved.lastRoom) $('room').value = saved.lastRoom;

  const res = await chrome.runtime.sendMessage({ cmd: 'status' }).catch(() => null);
  if (res?.state) render(res.state);
}

$('create').addEventListener('click', async () => {
  const serverUrl = $('server').value.trim() || DEFAULT_SERVER;
  await chrome.storage.local.set({ serverUrl });
  $('status').textContent = '接続中…';
  chrome.runtime.sendMessage({ cmd: 'create', serverUrl, tabId: await activeTabId() });
});

$('join').addEventListener('click', async () => {
  const serverUrl = $('server').value.trim() || DEFAULT_SERVER;
  const roomId = $('room').value.trim().toUpperCase();
  if (!roomId) {
    $('status').textContent = 'ルームIDを入力してください';
    $('status').classList.add('err');
    return;
  }
  await chrome.storage.local.set({ serverUrl, lastRoom: roomId });
  $('status').textContent = '接続中…';
  chrome.runtime.sendMessage({ cmd: 'join', serverUrl, roomId, tabId: await activeTabId() });
});

$('leave').addEventListener('click', () => {
  chrome.runtime.sendMessage({ cmd: 'leave' });
});

$('copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('roomId').textContent);
  $('copy').textContent = 'コピーしました ✓';
  setTimeout(() => ($('copy').textContent = 'IDをコピー'), 1500);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === 'state') render(msg.state);
  if (msg.cmd === 'server-error') {
    $('status').textContent = msg.message;
    $('status').classList.add('err');
  }
});

init();
