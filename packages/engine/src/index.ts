/*
 * Public, framework-independent API for Triad Chess.
 *
 * The implementation lives in runtime.js so the package can be exercised by
 * stock Node without a TypeScript runtime.  Keeping the declarations here
 * gives client and server workspaces a stable, checked API surface.
 */

import * as runtime from "./runtime.js";

export type PlayerId = "P0" | "P1" | "P2";
export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type PromotionPiece = Exclude<PieceType, "king" | "pawn">;
export type Position = string;
export type EliminationMode = "neutral" | "disappear";
export type AiDifficulty = "easy" | "medium" | "hard";
export type GameStatusKind = "playing" | "check" | "checkmate" | "stalemate" | "finished";

export interface AxialCoordinate {
  q: number;
  r: number;
}

export interface PixelPosition {
  x: number;
  y: number;
}

export interface Piece {
  id: string;
  type: PieceType;
  owner: PlayerId;
  position: Position;
  hasMoved: boolean;
  /** Eliminated players' pieces are retained, but inert, in neutral mode. */
  neutral: boolean;
}

export interface Move {
  pieceId: string;
  from: Position;
  to: Position;
  capturedPieceId?: string;
  capturedOwner?: PlayerId;
  capturedPieceType?: PieceType;
  promotion?: PromotionPiece;
  player?: PlayerId;
  isCheck?: boolean;
  eliminatedPlayer?: PlayerId;
}

export interface GameConfig {
  eliminationMode?: EliminationMode;
  /** Backwards-compatible shorthand for selecting neutral eliminated pieces. */
  neutralPieces?: boolean;
  /** Alias accepted by the runtime for integrations that call this a mode. */
  neutralMode?: EliminationMode;
  startingPlayer?: PlayerId;
  pawnDoubleStep?: boolean;
  promotionPiece?: PromotionPiece;
  /** Radius is fixed at seven; this optional field is validated for clarity. */
  radius?: number;
}

export interface ResolvedGameConfig {
  eliminationMode: EliminationMode;
  startingPlayer: PlayerId;
  pawnDoubleStep: boolean;
  promotionPiece: PromotionPiece;
  radius: 7;
}

export interface PlayerState {
  id: PlayerId;
  status: "active" | "eliminated";
  kingId: string;
  eliminatedTurn: number | null;
}

export interface FairnessStats {
  turnsTaken: Record<PlayerId, number>;
  movesByPlayer: Record<PlayerId, number>;
  skippedTurns: Record<PlayerId, number>;
  balanceScore: number;
  rotationViolations: number;
  lastPlayer: PlayerId | null;
}

export interface CoordinationLastMove {
  player: PlayerId;
  from: Position;
  to: Position;
  sector: PlayerId | null;
  capturedOwner?: PlayerId;
}

export interface CoordinationStats {
  capturesBy: Record<PlayerId, number>;
  checksBy: Record<PlayerId, number>;
  threatsBy: Record<PlayerId, number>;
  sectorVisits: Record<PlayerId, Record<PlayerId, number>>;
  lastMove: CoordinationLastMove | null;
}

export interface GameState {
  config: ResolvedGameConfig;
  pieces: Piece[];
  /** Position-to-piece index, kept as a plain object for JSON serialization. */
  board: Record<string, string>;
  players: Record<PlayerId, PlayerState>;
  activePlayers: PlayerId[];
  eliminatedPlayers: PlayerId[];
  currentPlayer: PlayerId;
  turnNumber: number;
  winner: PlayerId | null;
  moveHistory: Move[];
  lastMove: Move | null;
  fairness: FairnessStats;
  coordination: CoordinationStats;
}

export interface GameStatus {
  status: GameStatusKind;
  currentPlayer: PlayerId | null;
  winner: PlayerId | null;
  inCheck: boolean;
  legalMoveCount: number;
  eliminatedPlayers: PlayerId[];
}

export const BOARD_RADIUS: 7 = runtime.BOARD_RADIUS;
export const BOARD_CELLS: readonly Position[] = runtime.BOARD_CELLS;
export const HEX_DIRECTIONS: readonly AxialCoordinate[] = runtime.HEX_DIRECTIONS;

export const createInitialGame: (config?: GameConfig) => GameState = runtime.createInitialGame;
export const positionKey: (position: Position | AxialCoordinate) => Position = runtime.positionKey;
export const parsePosition: (position: Position | AxialCoordinate) => AxialCoordinate = runtime.parsePosition;
export const getLegalMoves: (state: GameState, player?: PlayerId) => Move[] = runtime.getLegalMoves;
export const getLegalMovesForPiece: (state: GameState, piece: Piece | string) => Move[] = runtime.getLegalMovesForPiece;
export const applyMove: (state: GameState, move: Move) => GameState = runtime.applyMove;
export const isInCheck: (state: GameState, player: PlayerId) => boolean = runtime.isInCheck;
export const getGameStatus: (state: GameState) => GameStatus = runtime.getGameStatus;
export const getCurrentPlayer: (state: GameState) => PlayerId | null = runtime.getCurrentPlayer;
export const getNextActivePlayer: (state: GameState, from?: PlayerId) => PlayerId | null = runtime.getNextActivePlayer;
export const getSectorForPosition: (position: Position | AxialCoordinate) => PlayerId | null = runtime.getSectorForPosition;
export const axialToPixel: (position: Position | AxialCoordinate, hexSize?: number) => PixelPosition = runtime.axialToPixel;
export const getAiMove: (state: GameState, difficulty?: AiDifficulty, player?: PlayerId) => Move | null = runtime.getAiMove;
