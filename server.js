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
const rooms = new Map(); // code → { white, black, variant, whiteName, blackName, created }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
        white:     ws,
        black:     null,
        variant:   msg.variant || 'putn-take',
        whiteName: msg.name || 'Anonymous',
        blackName: '',
        created:   Date.now(),
      });
      ws.room  = code;
      ws.color = 'w';
      send(ws, { type: 'created', room: code, color: 'w' });
      console.log(`Room ${code} created (${msg.variant}) by "${msg.name}"`);
    }

    // ── Join room ──
    else if (msg.type === 'join') {
      const code = (msg.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room)      { send(ws, { type: 'error', msg: 'Room not found — check the code.' }); return; }
      if (room.black) { send(ws, { type: 'error', msg: 'Room is full.' });                    return; }
      room.black    = ws;
      room.blackName = msg.name || 'Anonymous';
      ws.room  = code;
      ws.color = 'b';
      send(ws,         { type: 'joined',          color: 'b', variant: room.variant, name: room.whiteName });
      send(room.white, { type: 'opponent_joined', variant: room.variant,             name: room.blackName });
      console.log(`Room ${code}: "${room.blackName}" joined`);
    }

    // ── Relay move (pass sync payload through) ──
    else if (msg.type === 'move') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'move', move: msg.move, sync: msg.sync });
    }

    // ── Resign ──
    else if (msg.type === 'resign') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'resigned' });
    }

    // ── New game ──
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
      ws.room  = msg.room;
      ws.color = msg.color;
      if (msg.color === 'w') room.white = ws;
      else                   room.black = ws;
      send(ws, { type: 'rejoined', color: msg.color });
      const opp = msg.color === 'w' ? room.black : room.white;
      if (opp?.readyState === WebSocket.OPEN) send(opp, { type: 'opponent_rejoined' });
    }

    // ── Sync state (reconnect board exchange) ──
    else if (msg.type === 'sync_state') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, { type: 'sync_state', state: msg.state });
    }

    // ── Sync request (emergency re-sync button) ──
    else if (msg.type === 'sync_request') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      // Forward our state to opponent, and ask opponent to send theirs back
      send(opp, { type: 'sync_state',   state: msg.state });
      send(opp, { type: 'sync_request_ack' }); // tell opponent to also send their state
    }

    // ── Sync request ack (opponent sends their state back) ──
    else if (msg.type === 'sync_request_ack') {
      // Sender should respond with their own sync_state
      const state = { board: null }; // client handles this — ack triggers client to sendWs sync_state
      send(ws, { type: 'sync_ack_please' }); // tell this side to send their state
    }

    // ── Rewind request/accept/reject ──
    else if (msg.type === 'rewind_request' || msg.type === 'rewind_accept' || msg.type === 'rewind_reject') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const opp = ws.color === 'w' ? room.black : room.white;
      send(opp, msg); // relay as-is
    }

    // ── Swap colors ──
    else if (msg.type === 'swap_colors') {
      const room = rooms.get(ws.room);
      if (!room) return;
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
    // Don't delete room — player may rejoin within 2hr window
    if (ws.color === 'w') room.white = null;
    else                  room.black = null;
    console.log(`Room ${ws.room}: ${ws.color} disconnected`);
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
