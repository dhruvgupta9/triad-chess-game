import type { GameState, Move, PlayerId, Position } from '@triad-chess/engine';

export type SeatId = 'P0' | 'P1' | 'P2';
export type SessionMode = 'local' | 'online';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type SeatKind = 'human' | 'bot';

export interface SeatConfig {
  id: SeatId;
  name: string;
  kind: SeatKind;
  difficulty?: Difficulty;
}

export interface PieceView {
  id: string;
  player: SeatId;
  type: string;
  position: Position;
  key: string;
  captured?: boolean;
}

export interface MoveView {
  move: Move;
  key: string;
  fromKey: string | null;
  toKey: string | null;
  captureKey: string | null;
  player: SeatId | null;
  label: string;
}

export interface AnimationView {
  nonce: number;
  fromKey: string;
  toKey: string;
  captureKey?: string | null;
}

export interface GameView {
  raw: GameState;
  currentPlayer: SeatId;
  pieces: PieceView[];
  legalMoves: MoveView[];
  history: MoveView[];
  eliminated: SeatId[];
  inCheck: SeatId[];
  winner: SeatId | null;
  boardKeys: string[];
  stalemate: boolean;
}

export interface BoardModel {
  boardKeys: string[];
  pieces: PieceView[];
  legalMoveKeys: string[];
  selectedKey: string | null;
  currentPlayer: SeatId;
  eliminated: SeatId[];
  inCheck: SeatId[];
  winner: SeatId | null;
  animation: AnimationView | null;
}

export interface RoomInfo {
  code: string;
  connected: boolean;
  message: string;
  localSeat: SeatId | null;
  playerCount?: number;
  ready?: boolean;
}

export interface SessionConfig {
  mode: SessionMode;
  seats: Record<SeatId, SeatConfig>;
  roomCode?: string;
  displayName?: string;
}

export const SEATS: SeatId[] = ['P0', 'P1', 'P2'];

export const DEFAULT_SEATS: Record<SeatId, SeatConfig> = {
  P0: { id: 'P0', name: 'You', kind: 'human' },
  P1: { id: 'P1', name: 'Amber bot', kind: 'bot', difficulty: 'easy' },
  P2: { id: 'P2', name: 'Violet bot', kind: 'bot', difficulty: 'medium' },
};

export const PLAYER_META: Record<SeatId, { label: string; short: string; color: string; soft: string }> = {
  P0: { label: 'Cobalt', short: 'C', color: '#5ca9ff', soft: 'rgba(92, 169, 255, 0.18)' },
  P1: { label: 'Amber', short: 'A', color: '#ffc65e', soft: 'rgba(255, 198, 94, 0.18)' },
  P2: { label: 'Violet', short: 'V', color: '#c594ff', soft: 'rgba(197, 148, 255, 0.18)' },
};

export function isSeatId(value: unknown): value is SeatId {
  return value === 'P0' || value === 'P1' || value === 'P2';
}
