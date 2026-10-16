import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { getLegalMoves } from '../packages/engine/src/runtime.js';
import { startServer } from '../packages/server/dist/index.js';

// Real transport check against an isolated, ephemeral local server.
const server = await startServer({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.port}`;
const sockets = [];
const request = (socket, event, payload) => socket.timeout(4000).emitWithAck(event, payload);
async function connect() {
  const socket = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

try {
  const host = await connect();
  const created = await request(host, 'room:create', { displayName: 'Host' });
  assert.equal(created.ok, true);
  assert.equal(created.seat, 'P0');
  const roomCode = created.roomCode;
  const move = getLegalMoves(created.room.state)[0];
  assert.equal((await request(host, 'game:move', { move })).error.code, 'ROOM_NOT_READY');
  const second = await connect();
  const third = await connect();
  assert.equal((await request(second, 'room:join', { roomCode, displayName: 'Second' })).seat, 'P1');
  const full = await request(third, 'room:join', { roomCode, displayName: 'Third' });
  assert.equal(full.room.status, 'playing');
  assert.deepEqual(full.room.players.map((player) => player.displayName), ['Host', 'Second', 'Third']);
  assert.equal((await request(second, 'game:move', { move })).error.code, 'NOT_YOUR_TURN');
  const broadcast = new Promise((resolve) => third.once('game:move', resolve));
  const accepted = await request(host, 'game:move', { move });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.room.state.turnNumber, 1);
  assert.equal((await broadcast).state.turnNumber, 1);

  for (const body of [{}, { connectionId: 'outsider' }]) {
    const response = await fetch(`${origin}/rooms/${roomCode}/reset`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.ok, false);
  }
  assert.equal(server.manager.getRoom(roomCode).state.turnNumber, 1);
  const outsider = await connect();
  assert.equal((await request(outsider, 'room:join', { roomCode })).error.code, 'ROOM_FULL');
  await request(third, 'room:leave', {});
  assert.equal((await request(second, 'game:move', { move: getLegalMoves(accepted.room.state)[0] })).error.code, 'ROOM_NOT_READY');
  assert.equal((await request(outsider, 'room:join', { roomCode })).seat, 'P2');
  const reset = await request(host, 'game:reset', {});
  assert.equal(reset.room.state.turnNumber, 0);
  console.log('Online smoke passed: seating, readiness, turns, broadcast, reset authorization, leave, rejoin, and rematch.');
} finally {
  for (const socket of sockets) socket.disconnect();
  await server.close();
}
