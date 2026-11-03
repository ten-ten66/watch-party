// インストール済みのChrome / Edgeを探してデバッグポート付きで起動する
const { spawn } = require('child_process');
const fs = require('fs');

function candidates() {
  const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  switch (process.platform) {
    case 'win32':
      return [
        `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
        `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
        `${local}\\Google\\Chrome\\Application\\chrome.exe`,
        `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`
      ];
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      ];
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/microsoft-edge',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium'
      ];
  }
}

function findBrowser() {
  return candidates().find((p) => p && fs.existsSync(p)) || null;
}

function launchBrowser({ port, url, profileDir, exe }) {
  const bin = exe || findBrowser();
  if (!bin) {
    throw new Error('ChromeまたはEdgeが見つかりません。インストールしてから再度お試しください。');
  }
  const child = spawn(
    bin,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`, // 専用プロファイル（初回のみ各サービスへのログインが必要）
      '--no-first-run',
      '--no-default-browser-check',
      url
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  return child;
}

module.exports = { findBrowser, launchBrowser };
