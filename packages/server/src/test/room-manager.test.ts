import assert from "node:assert/strict";
import test from "node:test";

import type { GameState } from "@triad-chess/engine";
import { getLegalMoves } from "@triad-chess/engine";

import { RoomManager, RoomManagerError, SEATS } from "../index.js";

interface TestState {
  currentPlayer: "P0" | "P1" | "P2";
  moves: unknown[];
}

function testManager(): RoomManager {
  let nextCode = 0;
  let currentPlayer: TestState["currentPlayer"] = "P0";
  return new RoomManager({
    codeGenerator: () => `TEST${++nextCode}`,
    gameFactory: () => ({ currentPlayer, moves: [] }) as unknown as GameState,
  });
}

function moveManager(): RoomManager {
  const currentPlayer: TestState["currentPlayer"] = "P0";
  return new RoomManager({
    codeGenerator: () => "MOVES1",
    gameFactory: () => ({ currentPlayer, moves: [] }) as unknown as GameState,
    currentPlayerResolver: () => currentPlayer,
    moveApplier: (state, move) => {
      const typedState = state as unknown as TestState;
      return {
        currentPlayer: typedState.currentPlayer === "P0" ? "P1" : "P0",
        moves: [...typedState.moves, move],
      } as unknown as GameState;
    },
  });
}

test("creates a room, assigns all three seats, and rejects a fourth player", () => {
  const manager = testManager();
  const room = manager.createRoom();

  assert.equal(room.code, "TEST1");
  assert.equal(room.playerCount, 0);

  const first = manager.joinRoom(room.code, "socket-a");
  const second = manager.joinRoom(room.code, "socket-b");
  const third = manager.joinRoom(room.code, "socket-c");

  assert.equal(first.participant.seat, SEATS[0]);
  assert.equal(second.participant.seat, SEATS[1]);
  assert.equal(third.participant.seat, SEATS[2]);
  assert.deepEqual(third.room.players.map((player) => player.seat), [...SEATS]);
  assert.equal(third.room.status, "playing");

  assert.throws(
    () => manager.joinRoom(room.code, "socket-d"),
    (error: unknown) => error instanceof RoomManagerError && error.code === "ROOM_FULL",
  );
});

test("disconnect frees a seat and removes an empty room", () => {
  const manager = testManager();
  const room = manager.createRoom();
  manager.joinRoom(room.code, "socket-a");
  manager.joinRoom(room.code, "socket-b");

  const disconnected = manager.disconnect("socket-a");
  assert.equal(disconnected?.participant.seat, "P0");
  assert.deepEqual(disconnected?.room?.players.map((player) => player.seat), ["P1"]);

  manager.disconnect("socket-b");
  assert.equal(manager.size, 0);
  assert.equal(manager.getRoom(room.code), undefined);
});

test("enforces the engine current player before applying a move", () => {
  const manager = moveManager();
  const room = manager.createRoom();
  const first = manager.joinRoom(room.code, "socket-a");
  const second = manager.joinRoom(room.code, "socket-b");

  assert.throws(
    () => manager.submitMove(room.code, second.participant.connectionId, { from: "a", to: "b" }),
    (error: unknown) => error instanceof RoomManagerError && error.code === "NOT_YOUR_TURN",
  );

  const result = manager.submitMove(room.code, first.participant.connectionId, {
    from: "a",
    to: "b",
  });
  assert.equal(result.participant.seat, "P0");
  assert.deepEqual(result.move, { from: "a", to: "b" });
});

test("reset restores a fresh game state while keeping players", () => {
  let gameNumber = 0;
  const manager = new RoomManager({
    codeGenerator: () => "RESET1",
    gameFactory: () => ({ gameNumber: ++gameNumber, currentPlayer: "P0" }) as unknown as GameState,
  });
  const room = manager.createRoom();
  manager.joinRoom(room.code, "socket-a");
  const reset = manager.resetRoom(room.code, "socket-a");

  assert.equal((reset.state as unknown as { gameNumber: number }).gameNumber, 2);
  assert.equal(reset.playerCount, 1);
});

test("uses the engine as the authoritative move validator", () => {
  const manager = new RoomManager({ codeGenerator: () => "ENGINE1" });
  const room = manager.createRoom();
  const first = manager.joinRoom(room.code, "socket-a");

  assert.throws(
    () =>
      manager.submitMove(room.code, first.participant.connectionId, {
        pieceId: "does-not-exist",
        from: "0,0",
        to: "0,1",
      }),
    (error: unknown) => error instanceof RoomManagerError && error.code === "INVALID_MOVE",
  );

  const legalMove = getLegalMoves(room.state, "P0")[0];
  assert.ok(legalMove, "the initial game should expose a legal P0 move");
  const result = manager.submitMove(room.code, first.participant.connectionId, legalMove);
  assert.equal(result.room.state.turnNumber, 1);
  assert.equal(result.room.currentPlayer, "P1");
});
