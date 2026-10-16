import {
  BOARD_CELLS,
  applyMove as engineApplyMove,
  axialToPixel,
  createInitialGame,
  getAiMove as engineGetAiMove,
  getLegalMoves as engineGetLegalMoves,
  getLegalMovesForPiece as engineGetLegalMovesForPiece,
  getSectorForPosition,
  parsePosition,
  positionKey,
} from '@triad-chess/engine';
import type { GameState, Move, Position } from '@triad-chess/engine';
import type { Difficulty, MoveView, PieceView, SeatId } from './types';
import { isSeatId } from './types';

type AnyRecord = Record<string, unknown>;
type UnknownFn = (...args: unknown[]) => unknown;

const asFn = (value: unknown): UnknownFn => value as UnknownFn;

export function recordOf(value: unknown): AnyRecord {
  return value !== null && typeof value === 'object' ? (value as AnyRecord) : {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.entries());
  if (value !== null && typeof value === 'object') return Object.entries(value as AnyRecord);
  return [];
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Convert all supported serialized forms into the engine's Position. */
export function toPosition(value: unknown): Position | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const coordinate = asFn(parsePosition)(value) as { q: number; r: number };
      return `${coordinate.q},${coordinate.r}` as Position;
    } catch {
      const [q, r] = value.split(',').map(Number);
      return Number.isFinite(q) && Number.isFinite(r) ? (`${q},${r}` as Position) : null;
    }
  }
  if (Array.isArray(value) && value.length >= 2) {
    const q = numberValue(value[0]);
    const r = numberValue(value[1]);
    return q === null || r === null ? null : (`${q},${r}` as Position);
  }
  if (typeof value === 'object') {
    const source = recordOf(value);
    const q = numberValue(source.q ?? source.x ?? source.column);
    const r = numberValue(source.r ?? source.y ?? source.row);
    if (q !== null && r !== null) return `${q},${r}` as Position;
  }
  return null;
}

export function keyOf(value: unknown): string {
  if (typeof value === 'string') return value;
  const position = toPosition(value);
  if (!position) return '';
  try {
    return String(asFn(positionKey)(position));
  } catch {
    const source = recordOf(position);
    return `${String(source.q)},${String(source.r)}`;
  }
}

export function positionForKey(key: string): Position | null {
  return toPosition(key);
}

export function sectorFor(value: unknown): string {
  const position = toPosition(value);
  if (!position) return 'center';
  try {
    return String(asFn(getSectorForPosition)(position));
  } catch {
    return 'center';
  }
}

export function pixelFor(value: unknown): { x: number; y: number } {
  const position = toPosition(value);
  if (!position) return { x: 0, y: 0 };
  try {
    const pixel = asFn(axialToPixel)(position) as unknown;
    if (Array.isArray(pixel)) return { x: Number(pixel[0]) || 0, y: Number(pixel[1]) || 0 };
    const source = recordOf(pixel);
    return { x: Number(source.x) || 0, y: Number(source.y) || 0 };
  } catch {
    const source = recordOf(position);
    const q = Number(source.q) || 0;
    const r = Number(source.r) || 0;
    return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
  }
}

function normalizeSeat(value: unknown): SeatId | null {
  if (isSeatId(value)) return value;
  if (typeof value === 'number' && value >= 0 && value <= 2) return `P${value}` as SeatId;
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === '0' || normalized === 'player0' || normalized === 'cobalt' || normalized === 'blue') return 'P0';
  if (normalized === '1' || normalized === 'player1' || normalized === 'amber' || normalized === 'yellow') return 'P1';
  if (normalized === '2' || normalized === 'player2' || normalized === 'violet' || normalized === 'purple') return 'P2';
  if (/^p[012]$/.test(normalized)) return normalized.toUpperCase() as SeatId;
  return null;
}

export function playerOf(value: unknown): SeatId | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const source = recordOf(value);
    return normalizeSeat(source.id ?? source.playerId ?? source.player ?? source.owner ?? source.color ?? source.name);
  }
  return normalizeSeat(value);
}

export function rawPlayerName(value: unknown): string {
  const seat = playerOf(value);
  return seat ?? (typeof value === 'string' ? value : '');
}

function valuesFromCollection(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) return Array.from(value.entries()).map(([key, item]) => [String(key), item]);
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (value && typeof value === 'object') return Object.entries(value as AnyRecord);
  return [];
}

function piecePosition(piece: unknown, collectionKey = ''): Position | null {
  const source = recordOf(piece);
  return toPosition(source.position ?? source.pos ?? source.coordinate ?? source.coord ?? source.at ?? source.location ?? collectionKey);
}

function piecePlayer(piece: unknown): SeatId | null {
  const source = recordOf(piece);
  return playerOf(source.player ?? source.playerId ?? source.owner ?? source.side ?? source.color ?? source.seat);
}

/** Normalize common engine state layouts without requiring the renderer to know their storage format. */
export function readPieces(state: GameState): PieceView[] {
  const source = recordOf(state);
  const candidates = source.pieces ?? source.units ?? source.board ?? source.positions ?? source.pieceMap;
  const pieces: PieceView[] = [];
  for (const [collectionKey, item] of valuesFromCollection(candidates)) {
    const itemSource = recordOf(item);
    // Some board maps use [position, piece] entries after a Map -> array conversion.
    const possiblePosition = Array.isArray(item) && item.length > 1 ? item[0] : piecePosition(item, collectionKey);
    const possiblePiece = Array.isArray(item) && item.length > 1 ? item[1] : item;
    const position = piecePosition(possiblePiece, String(possiblePosition ?? collectionKey)) ?? toPosition(possiblePosition);
    const player = piecePlayer(possiblePiece);
    if (!position || !player) continue;
    const key = keyOf(position);
    const piece = recordOf(possiblePiece);
    pieces.push({
      id: String(piece.id ?? piece.pieceId ?? `${player}-${key}`),
      player,
      type: String(piece.type ?? piece.kind ?? piece.role ?? 'unit'),
      position,
      key,
      captured: Boolean(piece.captured ?? piece.isCaptured),
    });
  }
  return pieces.filter((piece, index, all) => all.findIndex((other) => other.id === piece.id) === index);
}

export function readBoardKeys(): string[] {
  const cells = valuesFromCollection(BOARD_CELLS).map(([key, value]) => {
    // Objects in an array are values; object maps can use the key as the position.
    const position = toPosition(value) ?? toPosition(key);
    return position ? keyOf(position) : '';
  });
  return cells.filter((key, index, all) => key.length > 0 && all.indexOf(key) === index);
}

function readSeatList(value: unknown): SeatId[] {
  const values = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : Object.entries(recordOf(value)).filter(([, active]) => Boolean(active)).map(([id]) => id);
  return values.map(playerOf).filter((seat): seat is SeatId => Boolean(seat));
}

export function currentPlayerOf(state: GameState): SeatId {
  const source = recordOf(state);
  const player = playerOf(source.currentPlayer ?? source.turn ?? source.activePlayer ?? source.playerToMove ?? source.nextPlayer);
  return player ?? 'P0';
}

export function eliminatedOf(state: GameState): SeatId[] {
  const source = recordOf(state);
  const direct = readSeatList(source.eliminatedPlayers ?? source.eliminated ?? source.outPlayers);
  const players = source.players;
  const fromPlayers = valuesFromCollection(players)
    .filter(([, value]) => Boolean(recordOf(value).eliminated ?? recordOf(value).isEliminated))
    .map(([key, value]) => playerOf(recordOf(value).id ?? key))
    .filter((seat): seat is SeatId => Boolean(seat));
  return [...direct, ...fromPlayers].filter((seat, index, all) => all.indexOf(seat) === index);
}

export function inCheckOf(state: GameState): SeatId[] {
  const source = recordOf(state);
  const direct = readSeatList(source.inCheck ?? source.check ?? source.checkPlayers ?? source.checks);
  if (direct.length > 0) return direct;
  const current = currentPlayerOf(state);
  const lastMove = recordOf(source.lastMove);
  return lastMove.isCheck === true ? [current] : [];
}

export function winnerOf(state: GameState): SeatId | null {
  const source = recordOf(state);
  return playerOf(source.winner ?? source.winnerId ?? source.victor);
}

function valueFor(source: AnyRecord, names: string[]): unknown {
  for (const name of names) {
    if (source[name] !== undefined) return source[name];
  }
  return undefined;
}

export function moveFields(move: unknown): { from: Position | null; to: Position | null; capture: Position | null; player: SeatId | null } {
  const source = recordOf(move);
  const from = toPosition(valueFor(source, ['from', 'origin', 'start', 'source', 'fromPosition']));
  const to = toPosition(valueFor(source, ['to', 'target', 'destination', 'end', 'toPosition']));
  const directCapture = toPosition(valueFor(source, ['capture', 'capturePosition', 'capturedPosition']));
  const capture = directCapture ?? (source.capturedPieceId || source.captureId ? to : null);
  return {
    from,
    to,
    capture,
    player: playerOf(valueFor(source, ['player', 'playerId', 'owner', 'side'])),
  };
}

export function moveView(move: Move, index = 0): MoveView {
  const { from, to, capture, player } = moveFields(move);
  const fromKey = from ? keyOf(from) : null;
  const toKey = to ? keyOf(to) : null;
  const captureKey = capture ? keyOf(capture) : null;
  const key = `${fromKey ?? '?'}>${toKey ?? '?'}:${index}`;
  const label = fromKey && toKey ? `${fromKey} → ${toKey}` : String(recordOf(move).notation ?? recordOf(move).san ?? 'Move');
  return { move, key, fromKey, toKey, captureKey, player, label };
}

export function readHistory(state: GameState): MoveView[] {
  const source = recordOf(state);
  const moves = valueFor(source, ['history', 'moveHistory', 'moves', 'pastMoves']);
  return asArray(moves).map((entry, index) => {
    const move = Array.isArray(entry) && entry.length > 1 ? entry[1] : entry;
    return moveView(move as Move, index);
  });
}

function normalizeMoveCollection(value: unknown): Move[] {
  if (value instanceof Map) return Array.from(value.values()) as Move[];
  if (Array.isArray(value)) return value as Move[];
  const source = recordOf(value);
  if (Array.isArray(source.moves)) return source.moves as Move[];
  if (Array.isArray(source.legalMoves)) return source.legalMoves as Move[];
  return [];
}

export function legalMovesFor(state: GameState, position?: Position, piece?: PieceView): MoveView[] {
  const fn = asFn(position ? engineGetLegalMovesForPiece : engineGetLegalMoves);
  const attempts: unknown[][] = position
    ? [[state, position], [state, piece], [state, keyOf(position)], [position, state]]
    : [[state], [state, currentPlayerOf(state)]];
  let result: unknown = [];
  for (const args of attempts) {
    try {
      result = fn(...args);
      const moves = normalizeMoveCollection(result);
      if (moves.length > 0 || !position) return moves.map((move, index) => moveView(move, index));
    } catch {
      // The adapter intentionally supports the small signature variations used by engine builds.
    }
  }
  return [];
}

export function allLegalMoves(state: GameState): MoveView[] {
  return legalMovesFor(state);
}

export function makeInitialState(): GameState {
  return asFn(createInitialGame)() as GameState;
}

export function applyEngineMove(state: GameState, move: Move): GameState {
  return asFn(engineApplyMove)(state, move) as GameState;
}

export function aiMove(state: GameState, difficulty: Difficulty, player: SeatId): Move | null {
  const fn = asFn(engineGetAiMove);
  const attempts: unknown[][] = [
    [state, difficulty, player],
    [state, difficulty],
    [state, player, difficulty],
    [state, { difficulty, player }],
    [state],
  ];
  for (const args of attempts) {
    try {
      const value = fn(...args);
      if (value && typeof value === 'object') return value as Move;
    } catch {
      // Try the next compatible engine signature.
    }
  }
  return null;
}

export function positionForMove(move: Move): { fromKey: string | null; toKey: string | null; captureKey: string | null } {
  const fields = moveFields(move);
  const source = recordOf(move);
  const captured = source.capturedPieceId ?? source.captureId ?? source.captured;
  const toKey = fields.to ? keyOf(fields.to) : null;
  return {
    fromKey: fields.from ? keyOf(fields.from) : null,
    toKey,
    captureKey: fields.capture ? keyOf(fields.capture) : captured && toKey ? toKey : null,
  };
}

export function stateHasPieces(state: unknown): boolean {
  return readPieces(state as GameState).length > 0;
}
