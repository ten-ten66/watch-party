const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { launchBrowser } = require('./browser');
const { findStreamingPage } = require('./cdp');
const { Party } = require('./sync');
const { WsTransport, DiscordTransport } = require('./transports');

const CDP_PORT = 9333;
const PAGE_PATTERN = /netflix\.com|primevideo\.com|amazon\./i;
const SERVICES = {
  netflix: 'https://www.netflix.com/',
  prime: 'https://www.primevideo.com/'
};

let win = null;
let party = null;
let attachCtl = null;

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 560,
    resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function update(data) {
  win?.webContents.send('update', data);
}

// 対象タブを見つけて同期を開始し、タブが閉じたら再接続を待つループ
async function attachLoop(ctl) {
  while (!ctl.aborted) {
    update({ kind: 'info', text: '再生タブを探しています…（ブラウザで作品を開いてください）' });
    const page = await findStreamingPage(CDP_PORT, PAGE_PATTERN, ctl);
    if (!page || ctl.aborted) {
      page?.close();
      return;
    }
    update({ kind: 'info', text: 'ブラウザのタブに接続しました 🎬' });
    party.attach(page);
    await page.closedPromise;
    party.detach();
    if (!ctl.aborted) update({ kind: 'info', text: 'タブとの接続が切れました。再接続を待ちます…' });
  }
}

async function stop() {
  if (attachCtl) attachCtl.aborted = true;
  attachCtl = null;
  party?.dispose();
  party = null;
}

ipcMain.handle('start', async (_e, opts) => {
  try {
    await stop();
    party = new Party();
    party.on('room', (roomId, count) => update({ kind: 'room', roomId, count }));
    party.on('peers', (count) => update({ kind: 'peers', count }));
    party.on('error', (text) => update({ kind: 'error', text }));
    party.on('info', (text) => update({ kind: 'info', text }));

    update({ kind: 'info', text: 'ブラウザを起動しています…' });
    launchBrowser({
      port: CDP_PORT,
      url: SERVICES[opts.service] || SERVICES.netflix,
      profileDir: path.join(app.getPath('userData'), 'browser-profile')
    });

    let transport;
    if (opts.transport === 'discord') {
      update({ kind: 'info', text: 'Discordに接続しています…' });
      transport = new DiscordTransport({ token: opts.discordToken, channelId: opts.discordChannel });
    } else {
      update({ kind: 'info', text: 'サーバーに接続しています…' });
      transport = new WsTransport({ url: opts.serverUrl, mode: opts.mode, roomId: opts.roomId });
    }
    await party.useTransport(transport);

    attachCtl = { aborted: false };
    attachLoop(attachCtl); // バックグラウンドで回す

    return { ok: true };
  } catch (e) {
    await stop();
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('leave', async () => {
  await stop();
  update({ kind: 'room', roomId: null, count: 0 });
  return { ok: true };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await stop();
  app.quit();
});
