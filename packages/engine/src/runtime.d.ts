/*
 * Declaration shim for consumers that type-check the public index.ts without
 * enabling allowJs.  The executable implementation is runtime.js.
 */
export const BOARD_RADIUS: 7;
export const BOARD_CELLS: readonly string[];
export const HEX_DIRECTIONS: readonly { q: number; r: number }[];

export function createInitialGame(config?: unknown): any;
export function positionKey(position: unknown): string;
export function parsePosition(position: unknown): { q: number; r: number };
export function getLegalMoves(state: unknown, player?: unknown): any[];
export function getLegalMovesForPiece(state: unknown, piece: unknown): any[];
export function applyMove(state: unknown, move: unknown): any;
export function isInCheck(state: unknown, player: unknown): boolean;
export function getGameStatus(state: unknown): any;
export function getCurrentPlayer(state: unknown): any;
export function getNextActivePlayer(state: unknown, from?: unknown): any;
export function getSectorForPosition(position: unknown): any;
export function axialToPixel(position: unknown, hexSize?: number): { x: number; y: number };
export function getAiMove(state: unknown, difficulty?: unknown, player?: unknown): any;
