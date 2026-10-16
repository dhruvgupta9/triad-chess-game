/**
 * The engine package currently publishes its TypeScript source as its type
 * entry while its runtime implementation is JavaScript.  This small local
 * contract keeps the server package independently typecheckable when the
 * workspace has not emitted engine declarations yet.  It mirrors only the
 * framework-independent values consumed by the server.
 */
declare module "@triad-chess/engine" {
  export type PlayerId = "P0" | "P1" | "P2";

  export interface Move {
    pieceId: string;
    from: string;
    to: string;
    player?: PlayerId;
    [key: string]: unknown;
  }

  export interface GameState {
    currentPlayer: PlayerId;
    activePlayers?: PlayerId[];
    [key: string]: unknown;
  }

  export function createInitialGame(): GameState;
  export function getLegalMoves(state: GameState, player?: PlayerId): Move[];
  export function applyMove(state: GameState, move: Move): GameState;
  export function getCurrentPlayer(state: GameState): PlayerId | null;
}
