import {
  applyMove as applyMoveFromEngine,
  createInitialGame as createInitialGameFromEngine,
  getCurrentPlayer as getCurrentPlayerFromEngine,
} from "@triad-chess/engine";
import type { GameState, Move, PlayerId } from "@triad-chess/engine";

import { RoomManagerError } from "./errors.js";

/** The three seats used by the server and by the wire protocol. */
export const SEATS = ["P0", "P1", "P2"] as const;
export type Seat = (typeof SEATS)[number];

// The casts intentionally keep this boundary tolerant of an engine that adds
// overloads (for example, a richer move result) while preserving the public
// engine types for callers of the server package.
const createInitialGame = createInitialGameFromEngine as unknown as () => GameState;
const applyMove = applyMoveFromEngine as unknown as (state: GameState, move: Move) => unknown;
const getCurrentPlayer = getCurrentPlayerFromEngine as unknown as (
  state: GameState,
) => PlayerId | null;

export function createGameState(): GameState {
  return createInitialGame();
}

export function playerIdForSeat(seat: Seat): PlayerId {
  return seat as unknown as PlayerId;
}

export function seatForPlayerId(playerId: PlayerId | null | undefined): Seat | undefined {
  if (playerId === null || playerId === undefined) {
    return undefined;
  }

  const value = String(playerId).toUpperCase();
  return SEATS.includes(value as Seat) ? (value as Seat) : undefined;
}

export function currentPlayer(state: GameState): PlayerId | undefined {
  try {
    return getCurrentPlayer(state) ?? undefined;
  } catch {
    // A finished game may not have a current player.  The manager will turn
    // this into a useful INVALID_GAME_STATE error when a move is attempted.
    return undefined;
  }
}

export function currentSeat(state: GameState): Seat | undefined {
  return seatForPlayerId(currentPlayer(state));
}

export function validateMoveInput(value: unknown): Move {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoomManagerError("INVALID_MOVE", "A move must be a JSON object.");
  }

  return value as Move;
}

/** Apply a move and translate engine failures into the server error contract. */
export function applyGameMove(state: GameState, move: Move): GameState {
  try {
    const result = applyMove(state, move);

    // The engine contract is expected to return a GameState.  Supporting a
    // common `{ state, error }` result shape here keeps malformed or rejected
    // moves from accidentally being broadcast if an engine build opts into a
    // result object instead of throwing.
    if (isRejectedMoveResult(result)) {
      throw new RoomManagerError("INVALID_MOVE", result.error);
    }

    if (isAcceptedMoveResult(result)) {
      return result.state;
    }

    if (result === null || typeof result !== "object") {
      throw new RoomManagerError("INVALID_GAME_STATE", "The engine returned no game state.");
    }

    return result as GameState;
  } catch (error) {
    if (error instanceof RoomManagerError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "The engine rejected the move.";
    throw new RoomManagerError("INVALID_MOVE", message);
  }
}

function isRejectedMoveResult(
  value: unknown,
): value is { state?: unknown; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

function isAcceptedMoveResult(value: unknown): value is { state: GameState } {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    (value as { state?: unknown }).state !== undefined
  );
}
