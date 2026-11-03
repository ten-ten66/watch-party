const $ = (id) => document.getElementById(id);

const DEFAULT_SERVER = 'ws://localhost:8787';
$('server').value = localStorage.getItem('serverUrl') || DEFAULT_SERVER;
$('room').value = localStorage.getItem('lastRoom') || '';
$('token').value = localStorage.getItem('discordToken') || '';
$('channel').value = localStorage.getItem('discordChannel') || '';
$('transport').value = localStorage.getItem('transport') || 'discord';

function refreshTransportUI() {
  const t = $('transport').value;
  $('discordBox').style.display = t === 'discord' ? 'block' : 'none';
  $('serverBox').style.display = t === 'server' ? 'block' : 'none';
}
$('transport').addEventListener('change', () => {
  localStorage.setItem('transport', $('transport').value);
  refreshTransportUI();
});
refreshTransportUI();

function logLine(text, isError = false) {
  const div = document.createElement('div');
  div.textContent = text;
  if (isError) div.className = 'err';
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
}

function setInRoom(roomId, count) {
  const inRoom = !!roomId;
  $('setup').style.display = inRoom ? 'none' : 'block';
  $('roomBox').style.display = inRoom ? 'block' : 'none';
  $('leave').style.display = inRoom ? 'block' : 'none';
  if (inRoom) {
    $('roomLabel').textContent = String(roomId).startsWith('#')
      ? '接続先チャンネル'
      : 'ルームID（相手に伝えてください）';
    $('roomId').textContent = roomId;
    $('peers').textContent = count != null ? `視聴中: ${count}人` : '接続中';
  }
}

function setBusy(busy) {
  for (const id of ['connect', 'create', 'join']) $(id).disabled = busy;
}

async function start(mode) {
  const transport = $('transport').value;
  const opts = { transport, mode, service: $('service').value };

  if (transport === 'discord') {
    opts.discordToken = $('token').value.trim();
    opts.discordChannel = $('channel').value.trim();
    if (!opts.discordToken || !opts.discordChannel) {
      logLine('Botトークンとチャンネル IDを入力してください', true);
      return;
    }
    localStorage.setItem('discordToken', opts.discordToken);
    localStorage.setItem('discordChannel', opts.discordChannel);
  } else {
    opts.serverUrl = $('server').value.trim() || DEFAULT_SERVER;
    opts.roomId = $('room').value.trim().toUpperCase();
    if (mode === 'join' && !opts.roomId) {
      logLine('ルームIDを入力してください', true);
      return;
    }
    localStorage.setItem('serverUrl', opts.serverUrl);
    if (opts.roomId) localStorage.setItem('lastRoom', opts.roomId);
  }

  setBusy(true);
  const res = await window.api.start(opts);
  setBusy(false);
  if (!res.ok) logLine(res.error, true);
}

$('connect').addEventListener('click', () => start('join'));
$('create').addEventListener('click', () => start('create'));
$('join').addEventListener('click', () => start('join'));
$('leave').addEventListener('click', () => window.api.leave());

window.api.onUpdate((data) => {
  switch (data.kind) {
    case 'room':
      setInRoom(data.roomId, data.count);
      if (data.roomId) logLine(`${data.roomId} に接続しました`);
      else logLine('切断されました');
      break;
    case 'peers':
      $('peers').textContent = `視聴中: ${data.count}人`;
      break;
    case 'error':
      logLine(data.text, true);
      break;
    case 'info':
      logLine(data.text);
      break;
  }
});
