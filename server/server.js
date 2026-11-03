// ウォッチパーティー同期サーバー
// ルーム単位で play / pause / seek / chat イベントを中継するだけの薄いリレー
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });

// roomId -> Set<ws>
const rooms = new Map();

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(id) ? genRoomId() : id;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) {
    rooms.delete(ws.roomId);
  } else {
    for (const peer of room) send(peer, { type: 'peers', count: room.size });
  }
  ws.roomId = null;
}

wss.on('connection', (ws) => {
  ws.roomId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        leaveRoom(ws);
        const roomId = genRoomId();
        rooms.set(roomId, new Set([ws]));
        ws.roomId = roomId;
        send(ws, { type: 'created', roomId });
        break;
      }
      case 'join': {
        const roomId = String(msg.roomId || '').toUpperCase().trim();
        const room = rooms.get(roomId);
        if (!room) {
          send(ws, { type: 'error', message: `ルーム ${roomId} が見つかりません` });
          return;
        }
        leaveRoom(ws);
        room.add(ws);
        ws.roomId = roomId;
        send(ws, { type: 'joined', roomId, count: room.size });
        for (const peer of room) {
          if (peer !== ws) send(peer, { type: 'peers', count: room.size });
        }
        break;
      }
      case 'leave':
        leaveRoom(ws);
        break;
      // play / pause / seek / chat / sync-request など: 同じルームの他メンバーへ中継
      default: {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        for (const peer of room) {
          if (peer !== ws) send(peer, msg);
        }
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

// MV3のService Workerが休止しないよう定期ping
setInterval(() => {
  for (const ws of wss.clients) send(ws, { type: 'ping' });
}, 20000);

console.log(`watch-party sync server listening on ws://0.0.0.0:${PORT}`);
