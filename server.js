const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ── Room registry ─────────────────────────────────────────
const rooms = new Map(); // code → { white, black, variant, created }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 confusion
function genCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return c;
}

function send(ws, msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Connection handler ────────────────────────────────────
wss.on('connection', (ws) => {
  ws.room  = null;
  ws.color = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Create room ──
    if (msg.type === 'create') {
      let code = genCode();
      while (rooms.has(code)) code = genCode();
      rooms.set(code, {
        white:   ws,
        black:   null,
        variant: msg.variant || 'putn-take',
        created: Date.now(),
      });
      ws.room  = code;
      ws.color = 'w';
      send(ws, { type: 'created', room: code, color: 'w' });
      console.log(`Room ${code} created (${msg.variant})`);
    }

    // ── Join room ──
    else if (msg.type === 'join') {
      const code = (msg.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room)        { send(ws, { type: 'error', msg: 'Room not found — check the code.' }); return; }
      if (room.black)   { send(ws, { type: 'error', msg: 'Room is full.' });                   return; }
      room.black = ws;
      ws.room  = code;
      ws.color = 'b';
      send(ws,        { type: 'joined',          color: 'b', variant: room.variant });
      send(room.white, { type: 'opponent_joined', variant: room.variant });
      console.log(`Room ${code}: opponent joined`);
    }

    // ── Relay move ──
    else if (msg.type === 'move') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'move', move: msg.move });
    }

    // ── Resign ──
    else if (msg.type === 'resign') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'resigned' });
    }

    // ── New game (sync both boards) ──
    else if (msg.type === 'new_game') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'new_game', variant: msg.variant });
    }

    // ── Rejoin after disconnect ──
    else if (msg.type === 'rejoin') {
      const room = rooms.get(msg.room);
      if (!room) { send(ws, { type: 'error', msg: 'Room expired. Start a new game.' }); return; }
      ws.room = msg.room; ws.color = msg.color;
      if (msg.color === 'w') room.white = ws;
      else room.black = ws;
      send(ws, { type: 'rejoined', color: msg.color });
      const opp = msg.color === 'w' ? room.black : room.white;
      if (opp?.readyState === 1) send(opp, { type: 'opponent_rejoined' });
    }

    // ── Sync state (board state exchange after reconnect) ──
    else if (msg.type === 'sync_state') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      if (opp?.readyState === 1) send(opp, { type: 'sync_state', state: msg.state });
    }

    // ── Swap colors ──
    else if (msg.type === 'swap_colors') {
      const room = rooms.get(ws.room);
      if (!room) return;
      // Relay to the OTHER player only (sender already swapped locally)
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'swap_colors' });
    }

    // ── Keepalive ──
    else if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    const opp = ws.color === 'w' ? room.black : room.white;
    send(opp, { type: 'opponent_disconnected' });
    rooms.delete(ws.room);
    console.log(`Room ${ws.room}: closed (disconnect)`);
  });
});

// ── Clean up stale rooms every 30 min (max 2 hr) ─────────
setInterval(() => {
  const MAX = 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (Date.now() - room.created > MAX) rooms.delete(code);
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3850;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Put'N Take server listening on port ${PORT}`);
});
