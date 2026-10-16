/* eslint-disable no-use-before-define */

/**
 * Triad Chess rules implementation.
 *
 * This module intentionally has no browser, UI, server, or third-party
 * dependencies.  GameState is made only from arrays, records, strings,
 * numbers, booleans, and null so it can be sent over JSON unchanged.
 */

export const BOARD_RADIUS = 7;

const PLAYER_IDS = Object.freeze(["P0", "P1", "P2"]);

/** The six adjacent directions in q,r axial coordinates. */
export const HEX_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 })
]);

/* A bishop uses the six long diagonals of the axial hex grid. */
const HEX_BISHOP_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 1 }),
  Object.freeze({ q: 2, r: -1 }),
  Object.freeze({ q: 1, r: -2 }),
  Object.freeze({ q: -1, r: -1 }),
  Object.freeze({ q: -2, r: 1 }),
  Object.freeze({ q: -1, r: 2 })
]);

/* Six rotationally symmetric jumps, each two hexes from the origin. */
const HEX_KNIGHT_JUMPS = Object.freeze([
  Object.freeze({ q: 2, r: -1 }),
  Object.freeze({ q: 1, r: -2 }),
  Object.freeze({ q: -1, r: -1 }),
  Object.freeze({ q: -2, r: 1 }),
  Object.freeze({ q: -1, r: 2 }),
  Object.freeze({ q: 1, r: 1 })
]);

const BACK_RANK = Object.freeze([
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook"
]);

const PIECE_VALUES = Object.freeze({
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000
});

const PLAYER_FORWARD = Object.freeze({
  P0: Object.freeze({ q: 1, r: 0 }),
  P1: Object.freeze({ q: -1, r: 1 }),
  P2: Object.freeze({ q: 0, r: -1 })
});

const PLAYER_HOME = Object.freeze({
  P0: Object.freeze({ axis: "q", edge: -BOARD_RADIUS }),
  P1: Object.freeze({ axis: "r", edge: -BOARD_RADIUS }),
  P2: Object.freeze({ axis: "s", edge: -BOARD_RADIUS })
});

const PLAYER_PROMOTION = Object.freeze({
  P0: (coordinate) => coordinate.q === BOARD_RADIUS,
  P1: (coordinate) => coordinate.q === -BOARD_RADIUS,
  P2: (coordinate) => coordinate.r === -BOARD_RADIUS
});

function makeBoardCells() {
  const cells = [];
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
    const minR = Math.max(-BOARD_RADIUS, -q - BOARD_RADIUS);
    const maxR = Math.min(BOARD_RADIUS, -q + BOARD_RADIUS);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push(`${q},${r}`);
    }
  }
  return Object.freeze(cells);
}

/** All 169 cells in a deterministic q-major order. */
export const BOARD_CELLS = makeBoardCells();
export const BOARD_CELL_COUNT = BOARD_CELLS.length;

function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function isInsideCoordinate(q, r) {
  const s = -q - r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= BOARD_RADIUS;
}

/**
 * Parse and validate a canonical axial position. Objects are accepted as a
 * convenience for geometry callers, while state positions remain strings.
 */
export function parsePosition(position) {
  let q;
  let r;
  if (typeof position === "string") {
    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(position);
    if (!match) {
      throw new Error(`Invalid position "${position}"; expected "q,r".`);
    }
    q = Number(match[1]);
    r = Number(match[2]);
  } else if (position && typeof position === "object") {
    q = position.q;
    r = position.r;
  }
  if (!isInteger(q) || !isInteger(r) || !isInsideCoordinate(q, r)) {
    throw new Error(`Invalid position; q and r must be integers inside radius ${BOARD_RADIUS}.`);
  }
  return { q, r };
}

export function positionKey(position) {
  const { q, r } = parsePosition(position);
  return `${q},${r}`;
}

export function axialToPixel(position, hexSize = 1) {
  const { q, r } = parsePosition(position);
  if (typeof hexSize !== "number" || !Number.isFinite(hexSize) || hexSize <= 0) {
    throw new Error("hexSize must be a positive finite number.");
  }
  return {
    x: Math.sqrt(3) * hexSize * (q + r / 2),
    y: 1.5 * hexSize * r
  };
}

/**
 * Return the nearest home sector.  Cells exactly on a sector boundary, and
 * the center, are neutral and return null.
 */
export function getSectorForPosition(position) {
  const { q, r } = parsePosition(position);
  const s = -q - r;
  const values = { P0: q, P1: r, P2: s };
  const minimum = Math.min(q, r, s);
  const matches = PLAYER_IDS.filter((player) => values[player] === minimum);
  return matches.length === 1 ? matches[0] : null;
}

function makePlayerMap(factory) {
  return {
    P0: factory("P0"),
    P1: factory("P1"),
    P2: factory("P2")
  };
}

function makeCounterMap() {
  return makePlayerMap(() => 0);
}

function makeSectorCounterMap() {
  return makePlayerMap(() => ({ P0: 0, P1: 0, P2: 0 }));
}

function normalizeConfig(config = {}) {
  if (config === null || typeof config !== "object") {
    throw new Error("Game config must be an object.");
  }
  if (config.radius !== undefined && config.radius !== BOARD_RADIUS) {
    throw new Error(`Triad Chess uses a fixed board radius of ${BOARD_RADIUS}.`);
  }
  const eliminationMode = config.eliminationMode ?? config.neutralMode ?? (config.neutralPieces ? "neutral" : "disappear");
  if (eliminationMode !== "neutral" && eliminationMode !== "disappear") {
    throw new Error('eliminationMode must be "neutral" or "disappear".');
  }
  const startingPlayer = config.startingPlayer ?? "P0";
  if (!PLAYER_IDS.includes(startingPlayer)) {
    throw new Error("startingPlayer must be P0, P1, or P2.");
  }
  const promotionPiece = config.promotionPiece ?? "queen";
  if (!["queen", "rook", "bishop", "knight"].includes(promotionPiece)) {
    throw new Error("promotionPiece must be queen, rook, bishop, or knight.");
  }
  const coordinationWindow = config.coordinationWindow ?? 6;
  if (!Number.isInteger(coordinationWindow) || coordinationWindow < 2 || coordinationWindow > 18) {
    throw new Error("coordinationWindow must be an integer from 2 to 18.");
  }
  return {
    eliminationMode,
    startingPlayer,
    pawnDoubleStep: config.pawnDoubleStep !== false,
    promotionPiece,
    fairnessBonus: config.fairnessBonus !== false,
    coordinationWindow,
    radius: BOARD_RADIUS
  };
}

function homeCoordinate(player, rank, index) {
  const base = { q: -BOARD_RADIUS + rank, r: index };
  if (player === "P0") return base;
  /* Rotate the base army by 120 degrees for each subsequent seat. */
  const rotate = (coordinate) => ({ q: -coordinate.q - coordinate.r, r: coordinate.q });
  if (player === "P1") return rotate(base);
  return rotate(rotate(base));
}

function makePiece(owner, type, index, coordinate) {
  return {
    id: `${owner}-${type}-${index}`,
    type,
    owner,
    position: positionKey(coordinate),
    hasMoved: false,
    neutral: false
  };
}

function buildInitialPieces() {
  const pieces = [];
  for (const player of PLAYER_IDS) {
    for (let index = 0; index < BACK_RANK.length; index += 1) {
      pieces.push(makePiece(player, BACK_RANK[index], index, homeCoordinate(player, 0, index)));
    }
    for (let index = 0; index < 8; index += 1) {
      pieces.push(makePiece(player, "pawn", index, homeCoordinate(player, 1, index)));
    }
  }
  return pieces;
}

function buildBoard(pieces) {
  const board = {};
  for (const piece of pieces) {
    if (board[piece.position]) {
      throw new Error(`Board collision at ${piece.position} between ${board[piece.position]} and ${piece.id}.`);
    }
    board[piece.position] = piece.id;
  }
  return board;
}

function makePlayers() {
  return {
    P0: { id: "P0", status: "active", kingId: "P0-king-4", eliminatedTurn: null },
    P1: { id: "P1", status: "active", kingId: "P1-king-4", eliminatedTurn: null },
    P2: { id: "P2", status: "active", kingId: "P2-king-4", eliminatedTurn: null }
  };
}

export function createInitialGame(config = {}) {
  const resolvedConfig = normalizeConfig(config);
  const pieces = buildInitialPieces();
  return {
    config: resolvedConfig,
    pieces,
    board: buildBoard(pieces),
    players: makePlayers(),
    activePlayers: [...PLAYER_IDS],
    eliminatedPlayers: [],
    currentPlayer: resolvedConfig.startingPlayer,
    turnNumber: 0,
    winner: null,
    moveHistory: [],
    lastMove: null,
    fairness: {
      turnsTaken: makeCounterMap(),
      movesByPlayer: makeCounterMap(),
      skippedTurns: makeCounterMap(),
      balanceScore: 0,
      rotationViolations: 0,
      lastPlayer: null,
      leader: null,
      leaderAttackBonus: makeCounterMap(),
      defensiveBonus: makeCounterMap()
    },
    coordination: {
      capturesBy: makeCounterMap(),
      checksBy: makeCounterMap(),
      threatsBy: makeCounterMap(),
      sectorVisits: makeSectorCounterMap(),
      recentAttacks: [],
      coordinatedAttacks: makeCounterMap(),
      focusTarget: null,
      lastMove: null
    }
  };
}

function cloneState(state) {
  return {
    ...state,
    config: { ...state.config },
    pieces: state.pieces.map((piece) => ({ ...piece })),
    board: { ...state.board },
    players: makePlayerMap((player) => ({ ...state.players[player] })),
    activePlayers: [...state.activePlayers],
    eliminatedPlayers: [...state.eliminatedPlayers],
    moveHistory: state.moveHistory.map((move) => ({ ...move })),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    fairness: {
      ...state.fairness,
      turnsTaken: { ...state.fairness.turnsTaken },
      movesByPlayer: { ...state.fairness.movesByPlayer },
      skippedTurns: { ...state.fairness.skippedTurns },
      leaderAttackBonus: { ...state.fairness.leaderAttackBonus },
      defensiveBonus: { ...state.fairness.defensiveBonus }
    },
    coordination: {
      ...state.coordination,
      capturesBy: { ...state.coordination.capturesBy },
      checksBy: { ...state.coordination.checksBy },
      threatsBy: { ...state.coordination.threatsBy },
      recentAttacks: state.coordination.recentAttacks.map((event) => ({ ...event })),
      coordinatedAttacks: { ...state.coordination.coordinatedAttacks },
      sectorVisits: {
        P0: { ...state.coordination.sectorVisits.P0 },
        P1: { ...state.coordination.sectorVisits.P1 },
        P2: { ...state.coordination.sectorVisits.P2 }
      },
      lastMove: state.coordination.lastMove ? { ...state.coordination.lastMove } : null
    }
  };
}

function isActivePlayer(state, player) {
  return PLAYER_IDS.includes(player) && state.activePlayers.includes(player) && state.players[player]?.status === "active";
}

function getPieceById(state, pieceId) {
  return state.pieces.find((piece) => piece.id === pieceId) ?? null;
}

function getPieceAt(state, position) {
  const key = typeof position === "string" ? position : positionKey(position);
  const pieceId = state.board?.[key];
  if (pieceId) {
    const indexedPiece = getPieceById(state, pieceId);
    if (indexedPiece) return indexedPiece;
  }
  /* Tolerate hand-authored JSON states whose board index is stale. */
  return state.pieces.find((piece) => piece.position === key) ?? null;
}

function resolvePiece(state, pieceOrId) {
  if (typeof pieceOrId === "string") {
    return getPieceById(state, pieceOrId) ?? getPieceAt(state, positionKey(pieceOrId));
  }
  if (pieceOrId && typeof pieceOrId === "object" && pieceOrId.id) {
    return getPieceById(state, pieceOrId.id);
  }
  return null;
}

function addCoordinate(coordinate, direction, amount = 1) {
  return { q: coordinate.q + direction.q * amount, r: coordinate.r + direction.r * amount };
}

function directionForPawn(player) {
  return PLAYER_FORWARD[player];
}

function directionIndex(direction) {
  return HEX_DIRECTIONS.findIndex((candidate) => candidate.q === direction.q && candidate.r === direction.r);
}

function pawnCaptureDirections(player) {
  const index = directionIndex(directionForPawn(player));
  return [
    HEX_DIRECTIONS[(index + 1) % HEX_DIRECTIONS.length],
    HEX_DIRECTIONS[(index + HEX_DIRECTIONS.length - 1) % HEX_DIRECTIONS.length]
  ];
}

function isPromotionSquare(player, coordinate) {
  return PLAYER_PROMOTION[player](coordinate);
}

function isFriendly(piece, player) {
  return piece && piece.owner === player && !piece.neutral;
}

function isCapturableBy(piece, player) {
  return piece && !piece.neutral && piece.owner !== player;
}

function candidateMove(piece, target, capturedPiece, promotion) {
  const move = {
    pieceId: piece.id,
    from: piece.position,
    to: positionKey(target)
  };
  if (capturedPiece) {
    move.capturedPieceId = capturedPiece.id;
  }
  if (promotion) {
    move.promotion = promotion;
  }
  return move;
}

function addStepMoves(state, piece, directions, moves, attacksOnly = false) {
  const from = parsePosition(piece.position);
  for (const direction of directions) {
    const target = addCoordinate(from, direction);
    if (!isInsideCoordinate(target.q, target.r)) {
      continue;
    }
    const occupant = getPieceAt(state, positionKey(target));
    if (attacksOnly) {
      moves.push(candidateMove(piece, target, occupant));
      continue;
    }
    if (!occupant || isCapturableBy(occupant, piece.owner)) {
      moves.push(candidateMove(piece, target, occupant));
    }
  }
}

function addJumpMoves(state, piece, directions, moves, attacksOnly = false) {
  const from = parsePosition(piece.position);
  for (const direction of directions) {
    const target = addCoordinate(from, direction);
    if (!isInsideCoordinate(target.q, target.r)) {
      continue;
    }
    const occupant = getPieceAt(state, positionKey(target));
    if (attacksOnly || !occupant || isCapturableBy(occupant, piece.owner)) {
      moves.push(candidateMove(piece, target, occupant));
    }
  }
}

function addSlidingMoves(state, piece, directions, moves, attacksOnly = false) {
  const from = parsePosition(piece.position);
  for (const direction of directions) {
    for (let distance = 1; ; distance += 1) {
      const target = addCoordinate(from, direction, distance);
      if (!isInsideCoordinate(target.q, target.r)) {
        break;
      }
      const occupant = getPieceAt(state, positionKey(target));
      if (attacksOnly) {
        moves.push(candidateMove(piece, target, occupant));
        if (occupant) {
          break;
        }
        continue;
      }
      if (!occupant) {
        moves.push(candidateMove(piece, target, null));
        continue;
      }
      if (isCapturableBy(occupant, piece.owner)) {
        moves.push(candidateMove(piece, target, occupant));
      }
      break;
    }
  }
}

function generatePseudoMoves(state, piece, attacksOnly = false) {
  if (!piece || piece.neutral || !isActivePlayer(state, piece.owner)) {
    return [];
  }
  const moves = [];
  if (piece.type === "pawn") {
    const from = parsePosition(piece.position);
    const forward = directionForPawn(piece.owner);
    const oneStep = addCoordinate(from, forward);
    if (attacksOnly) {
      for (const direction of pawnCaptureDirections(piece.owner)) {
        const target = addCoordinate(from, direction);
        if (isInsideCoordinate(target.q, target.r)) {
          moves.push(candidateMove(piece, target, getPieceAt(state, positionKey(target))));
        }
      }
      return moves;
    }
    if (isInsideCoordinate(oneStep.q, oneStep.r) && !getPieceAt(state, positionKey(oneStep))) {
      const promotion = isPromotionSquare(piece.owner, oneStep) ? state.config.promotionPiece : undefined;
      moves.push(candidateMove(piece, oneStep, null, promotion));
      const home = PLAYER_HOME[piece.owner];
      const onHomeRank = home.axis === "q"
        ? from.q === home.edge + 1
        : home.axis === "r"
          ? from.r === home.edge + 1
          : from.q + from.r === -home.edge - 1;
      const twoStep = addCoordinate(from, forward, 2);
      if (state.config.pawnDoubleStep && !piece.hasMoved && onHomeRank && isInsideCoordinate(twoStep.q, twoStep.r) && !getPieceAt(state, positionKey(twoStep))) {
        moves.push(candidateMove(piece, twoStep, null));
      }
    }
    for (const direction of pawnCaptureDirections(piece.owner)) {
      const target = addCoordinate(from, direction);
      if (!isInsideCoordinate(target.q, target.r)) {
        continue;
      }
      const occupant = getPieceAt(state, positionKey(target));
      if (occupant && isCapturableBy(occupant, piece.owner)) {
        const promotion = isPromotionSquare(piece.owner, target) ? state.config.promotionPiece : undefined;
        moves.push(candidateMove(piece, target, occupant, promotion));
      }
    }
    return moves;
  }
  if (piece.type === "king") {
    addStepMoves(state, piece, HEX_DIRECTIONS, moves, attacksOnly);
    return moves;
  }
  if (piece.type === "knight") {
    addJumpMoves(state, piece, HEX_KNIGHT_JUMPS, moves, attacksOnly);
    return moves;
  }
  if (piece.type === "bishop") {
    addSlidingMoves(state, piece, HEX_BISHOP_DIRECTIONS, moves, attacksOnly);
    return moves;
  }
  if (piece.type === "rook") {
    addSlidingMoves(state, piece, HEX_DIRECTIONS, moves, attacksOnly);
    return moves;
  }
  /* The queen combines the rook and bishop axes on a hex board. */
  if (piece.type === "queen") {
    addSlidingMoves(state, piece, [...HEX_DIRECTIONS, ...HEX_BISHOP_DIRECTIONS], moves, attacksOnly);
  }
  return moves;
}

function attacksSquare(state, piece, targetPosition) {
  if (!piece || piece.neutral || !isActivePlayer(state, piece.owner)) {
    return false;
  }
  const target = parsePosition(targetPosition);
  const from = parsePosition(piece.position);
  const delta = { q: target.q - from.q, r: target.r - from.r };
  if (piece.type === "pawn") {
    return pawnCaptureDirections(piece.owner).some((direction) => direction.q === delta.q && direction.r === delta.r);
  }
  if (piece.type === "king") {
    return HEX_DIRECTIONS.some((direction) => direction.q === delta.q && direction.r === delta.r);
  }
  if (piece.type === "knight") {
    return HEX_KNIGHT_JUMPS.some((direction) => direction.q === delta.q && direction.r === delta.r);
  }
  let directions;
  if (piece.type === "bishop") directions = HEX_BISHOP_DIRECTIONS;
  else if (piece.type === "rook") directions = HEX_DIRECTIONS;
  else if (piece.type === "queen") directions = [...HEX_DIRECTIONS, ...HEX_BISHOP_DIRECTIONS];
  else return false;
  for (const direction of directions) {
    let cursor = { ...from };
    for (;;) {
      cursor = addCoordinate(cursor, direction);
      if (!isInsideCoordinate(cursor.q, cursor.r)) break;
      const key = positionKey(cursor);
      if (key === positionKey(target)) return true;
      if (getPieceAt(state, key)) break;
    }
  }
  return false;
}

export function isInCheck(state, player) {
  if (!PLAYER_IDS.includes(player) || !isActivePlayer(state, player)) {
    return false;
  }
  const king = state.pieces.find((piece) => piece.owner === player && piece.type === "king" && !piece.neutral);
  if (!king) {
    return false;
  }
  return state.pieces.some((piece) => piece.owner !== player && attacksSquare(state, piece, king.position));
}

function resolvedPromotion(state, piece, move) {
  if (piece.type !== "pawn") return undefined;
  const target = parsePosition(move.to);
  if (!isPromotionSquare(piece.owner, target)) return undefined;
  const promotion = move.promotion ?? state.config.promotionPiece;
  if (!["queen", "rook", "bishop", "knight"].includes(promotion)) {
    throw new Error("Promotion must be queen, rook, bishop, or knight.");
  }
  return promotion;
}

function applyRawMove(state, move, promotion) {
  const moving = getPieceById(state, move.pieceId);
  if (!moving) throw new Error(`Unknown piece ${move.pieceId}.`);
  const captured = move.capturedPieceId ? getPieceById(state, move.capturedPieceId) : getPieceAt(state, move.to);
  state.pieces = state.pieces
    .filter((piece) => !captured || piece.id !== captured.id)
    .map((piece) => piece.id === moving.id
      ? { ...piece, position: positionKey(move.to), hasMoved: true, type: promotion ?? piece.type }
      : piece);
  state.board = buildBoard(state.pieces);
  return captured;
}

function simulateMove(state, move) {
  const next = cloneState(state);
  const moving = getPieceById(next, move.pieceId);
  const promotion = moving ? resolvedPromotion(next, moving, move) : undefined;
  applyRawMove(next, move, promotion);
  return next;
}

export function getLegalMovesForPiece(state, pieceOrId) {
  const piece = resolvePiece(state, pieceOrId);
  const activeCount = PLAYER_IDS.filter((candidate) => isActivePlayer(state, candidate)).length;
  /* Move generation is useful for previews for any active piece; applyMove
     remains the authority that enforces the current turn. */
  if (state?.winner || activeCount <= 1 || !piece || piece.neutral || !isActivePlayer(state, piece.owner)) {
    return [];
  }
  const pseudo = generatePseudoMoves(state, piece);
  return pseudo.filter((move) => {
    const next = simulateMove(state, move);
    return !isInCheck(next, piece.owner);
  });
}

export function getLegalMoves(state, player = getCurrentPlayer(state)) {
  if (state?.winner || PLAYER_IDS.filter((candidate) => isActivePlayer(state, candidate)).length <= 1) return [];
  if (!player || !isActivePlayer(state, player)) return [];
  const previous = state.currentPlayer;
  /* The public helper can inspect another active player's legal moves. */
  const working = previous === player ? state : { ...state, currentPlayer: player };
  const moves = [];
  for (const piece of working.pieces) {
    if (piece.owner === player && !piece.neutral) {
      moves.push(...getLegalMovesForPiece(working, piece));
    }
  }
  return moves;
}

function skippedBetweenPlayers(state, from, to) {
  if (!to) return [];
  const skipped = [];
  let index = PLAYER_IDS.indexOf(from);
  for (let step = 0; step < PLAYER_IDS.length; step += 1) {
    index = (index + 1) % PLAYER_IDS.length;
    const candidate = PLAYER_IDS[index];
    if (candidate === to) break;
    if (!isActivePlayer(state, candidate)) skipped.push(candidate);
  }
  return skipped;
}

function eliminatePlayer(state, player) {
  if (!PLAYER_IDS.includes(player) || !state.activePlayers.includes(player)) return;
  state.activePlayers = state.activePlayers.filter((candidate) => candidate !== player);
  if (!state.eliminatedPlayers.includes(player)) state.eliminatedPlayers.push(player);
  state.players[player] = {
    ...state.players[player],
    status: "eliminated",
    eliminatedTurn: state.turnNumber
  };
  if (state.config.eliminationMode === "disappear") {
    state.pieces = state.pieces.filter((piece) => piece.owner !== player);
  } else {
    state.pieces = state.pieces.map((piece) => piece.owner === player ? { ...piece, neutral: true } : piece);
  }
  state.board = buildBoard(state.pieces);
}

function countThreats(state, player) {
  const enemies = state.pieces.filter((piece) => piece.owner !== player && !piece.neutral && isActivePlayer(state, piece.owner));
  const own = state.pieces.filter((piece) => piece.owner === player && !piece.neutral);
  let count = 0;
  for (const enemy of enemies) {
    if (own.some((target) => attacksSquare(state, enemy, target.position))) count += 1;
  }
  return count;
}

function materialForPlayer(state, player) {
  return state.pieces
    .filter((piece) => piece.owner === player && !piece.neutral)
    .reduce((total, piece) => total + (PIECE_VALUES[piece.type] ?? 0), 0);
}

function getLeadingPlayer(state) {
  const active = PLAYER_IDS.filter((player) => isActivePlayer(state, player));
  if (active.length === 0) return null;
  const scores = active.map((player) => ({ player, score: materialForPlayer(state, player) }));
  const highest = Math.max(...scores.map((entry) => entry.score));
  const leaders = scores.filter((entry) => entry.score === highest);
  return leaders.length === 1 ? leaders[0].player : null;
}

function pseudoMobility(state, player) {
  return state.pieces
    .filter((piece) => piece.owner === player && !piece.neutral && isActivePlayer(state, player))
    .reduce((total, piece) => total + generatePseudoMoves(state, piece).length, 0);
}

function updateTracking(state, player, move, captured, nextPlayer, leaderBefore) {
  state.fairness.turnsTaken[player] += 1;
  state.fairness.movesByPlayer[player] += 1;
  state.fairness.lastPlayer = player;
  const counts = PLAYER_IDS.map((candidate) => state.fairness.turnsTaken[candidate]);
  state.fairness.balanceScore = Math.max(...counts) - Math.min(...counts);
  for (const skipped of skippedBetweenPlayers(state, player, nextPlayer)) {
    state.fairness.skippedTurns[skipped] += 1;
  }

  if (captured) state.coordination.capturesBy[player] += 1;
  const checkedPlayers = state.activePlayers.filter((candidate) => candidate !== player && isInCheck(state, candidate));
  state.coordination.checksBy[player] += checkedPlayers.length;
  state.coordination.threatsBy[player] += countThreats(state, player);
  const sector = getSectorForPosition(move.to);
  if (sector) state.coordination.sectorVisits[player][sector] += 1;
  state.coordination.lastMove = {
    player,
    from: move.from,
    to: move.to,
    sector,
    ...(captured ? { capturedOwner: captured.owner } : {})
  };

  const attackEvents = [];
  if (captured && isActivePlayer(state, captured.owner)) {
    attackEvents.push({ attacker: player, target: captured.owner, turn: state.turnNumber, kind: "capture" });
  }
  for (const target of checkedPlayers) {
    attackEvents.push({ attacker: player, target, turn: state.turnNumber, kind: "check" });
  }
  const oldestAllowedTurn = state.turnNumber - state.config.coordinationWindow + 1;
  const recent = state.coordination.recentAttacks
    .filter((event) => event.turn >= oldestAllowedTurn)
    .concat(attackEvents);
  state.coordination.recentAttacks = recent;

  for (const target of new Set(attackEvents.map((event) => event.target))) {
    const attackers = new Set(recent.filter((event) => event.target === target).map((event) => event.attacker));
    if (attackers.size < 2) continue;
    state.coordination.coordinatedAttacks[target] += 1;
    state.fairness.defensiveBonus[target] += 1;
  }

  if (state.config.fairnessBonus && leaderBefore && leaderBefore !== player) {
    const targetedLeader = attackEvents.some((event) => event.target === leaderBefore);
    if (targetedLeader) state.fairness.leaderAttackBonus[player] += 1;
  }

  const focusCandidates = PLAYER_IDS
    .filter((candidate) => state.coordination.coordinatedAttacks[candidate] > 0)
    .sort((left, right) => state.coordination.coordinatedAttacks[right] - state.coordination.coordinatedAttacks[left]);
  state.coordination.focusTarget = focusCandidates[0] ?? null;
  state.fairness.leader = getLeadingPlayer(state);
}

export function getCurrentPlayer(state) {
  if (!state || !Array.isArray(state.activePlayers) || state.activePlayers.length === 0) return null;
  if (isActivePlayer(state, state.currentPlayer)) return state.currentPlayer;
  if (!PLAYER_IDS.includes(state.currentPlayer)) {
    return PLAYER_IDS.find((player) => isActivePlayer(state, player)) ?? null;
  }
  return getNextActivePlayer(state, state.currentPlayer);
}

export function getNextActivePlayer(state, from = state.currentPlayer) {
  const active = PLAYER_IDS.filter((player) => isActivePlayer(state, player));
  if (active.length === 0) return null;
  const start = PLAYER_IDS.indexOf(from);
  const index = start < 0 ? 0 : start;
  for (let offset = 1; offset <= PLAYER_IDS.length; offset += 1) {
    const candidate = PLAYER_IDS[(index + offset) % PLAYER_IDS.length];
    if (active.includes(candidate)) return candidate;
  }
  return active[0];
}

export function applyMove(state, move) {
  if (!state || typeof state !== "object") throw new Error("Cannot apply a move to an empty game state.");
  if (!move || typeof move !== "object") throw new Error("Move must be an object with pieceId, from, and to.");
  if (state.winner || PLAYER_IDS.filter((player) => isActivePlayer(state, player)).length <= 1) {
    throw new Error("The game is finished; no further moves are allowed.");
  }
  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer) throw new Error("The game has no active players.");
  if (!move.pieceId || move.from === undefined || move.to === undefined) {
    throw new Error("Move must include pieceId, from, and to.");
  }
  const piece = getPieceById(state, move.pieceId);
  if (!piece) throw new Error(`Unknown piece ${move.pieceId}.`);
  if (piece.owner !== currentPlayer) {
    throw new Error(`It is ${currentPlayer}'s turn; piece ${piece.id} belongs to ${piece.owner}.`);
  }
  if (piece.neutral) throw new Error(`Piece ${piece.id} is neutral and cannot move.`);
  const leaderBefore = state.fairness?.leader ?? getLeadingPlayer(state);
  let from;
  let to;
  try {
    from = positionKey(move.from);
    to = positionKey(move.to);
  } catch (error) {
    throw new Error(`Invalid move coordinates: ${error.message}`);
  }
  if (piece.position !== from) throw new Error(`Piece ${piece.id} is at ${piece.position}, not ${from}.`);

  const legal = getLegalMovesForPiece(state, piece);
  const selected = legal.find((candidate) => candidate.to === to && (!move.promotion || candidate.promotion === move.promotion));
  if (!selected) {
    throw new Error(`Illegal move for ${piece.id}: ${from} to ${to}.`);
  }
  if (move.capturedPieceId && move.capturedPieceId !== selected.capturedPieceId) {
    throw new Error(`Move capture does not match the piece at ${to}.`);
  }
  const next = cloneState(state);
  const nextPiece = getPieceById(next, piece.id);
  const promotion = resolvedPromotion(next, nextPiece, { ...selected, ...move, from, to });
  const captured = applyRawMove(next, { ...selected, ...move, from, to }, promotion);
  const appliedMove = {
    pieceId: piece.id,
    from,
    to,
    ...(captured ? { capturedPieceId: captured.id, capturedOwner: captured.owner, capturedPieceType: captured.type } : {}),
    ...(promotion ? { promotion } : {}),
    player: currentPlayer
  };
  next.turnNumber += 1;
  if (captured?.type === "king" && isActivePlayer(next, captured.owner)) {
    eliminatePlayer(next, captured.owner);
    appliedMove.eliminatedPlayer = captured.owner;
  }
  let nextPlayer = getNextActivePlayer(next, currentPlayer);
  const candidateCheck = nextPlayer ? isInCheck(next, nextPlayer) : false;
  if (nextPlayer && isActivePlayer(next, nextPlayer)) {
    const candidateHasKing = next.pieces.some((piece) => piece.owner === nextPlayer && piece.type === "king" && !piece.neutral);
    const candidateIsCheckmated = candidateCheck && getLegalMoves(next, nextPlayer).length === 0;
    if (!candidateHasKing || candidateIsCheckmated) {
      eliminatePlayer(next, nextPlayer);
      appliedMove.eliminatedPlayer ??= nextPlayer;
      nextPlayer = getNextActivePlayer(next, currentPlayer);
    }
  }
  next.currentPlayer = nextPlayer ?? currentPlayer;
  appliedMove.isCheck = candidateCheck;
  next.moveHistory.push(appliedMove);
  next.lastMove = appliedMove;
  updateTracking(next, currentPlayer, appliedMove, captured, nextPlayer, leaderBefore);
  if (next.activePlayers.length === 1) next.winner = next.activePlayers[0];
  return next;
}

export function getGameStatus(state) {
  const active = PLAYER_IDS.filter((player) => isActivePlayer(state, player));
  if (active.length <= 1) {
    return {
      status: "finished",
      currentPlayer: active[0] ?? null,
      winner: active[0] ?? state.winner ?? null,
      inCheck: false,
      legalMoveCount: 0,
      eliminatedPlayers: [...state.eliminatedPlayers]
    };
  }
  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer) {
    return {
      status: "finished",
      currentPlayer: null,
      winner: state.winner ?? null,
      inCheck: false,
      legalMoveCount: 0,
      eliminatedPlayers: [...state.eliminatedPlayers]
    };
  }
  const king = state.pieces.find((piece) => piece.owner === currentPlayer && piece.type === "king" && !piece.neutral);
  const inCheck = Boolean(king) && isInCheck(state, currentPlayer);
  const legalMoveCount = getLegalMoves(state, currentPlayer).length;
  let status = "playing";
  if (legalMoveCount === 0) status = inCheck || !king ? "checkmate" : "stalemate";
  else if (inCheck) status = "check";
  return {
    status,
    currentPlayer,
    winner: state.winner ?? null,
    inCheck,
    legalMoveCount,
    eliminatedPlayers: [...state.eliminatedPlayers]
  };
}

function evaluateState(state, player, includeMobility = true) {
  let score = 0;
  for (const piece of state.pieces) {
    if (piece.neutral) continue;
    const value = PIECE_VALUES[piece.type] ?? 0;
    score += piece.owner === player ? value : -value * 0.55;
  }
  if (!isActivePlayer(state, player)) score -= 100000;
  if (state.winner === player) score += 100000;
  if (isInCheck(state, player)) score -= 250;
  const incomingThreats = countThreats(state, player);
  score -= incomingThreats * 18;
  if (includeMobility) {
    score += pseudoMobility(state, player) * 3;
    for (const opponent of PLAYER_IDS) {
      if (opponent === player || !isActivePlayer(state, opponent)) continue;
      if (isInCheck(state, opponent)) score += 38;
      /* Count pressure on each rival without recursively generating every
         rival move. This keeps hard AI responsive while still considering the
         three-way threat map. */
      score += countThreats(state, opponent) * 2;
    }
  }
  if (state.config?.fairnessBonus) {
    score += (state.fairness?.leaderAttackBonus?.[player] ?? 0) * 70;
    score += (state.fairness?.defensiveBonus?.[player] ?? 0) * 18;
    if (state.coordination?.focusTarget === player) score -= 45;
  }
  return score;
}

function moveHeuristic(state, move) {
  let score = 0;
  if (move.capturedPieceId) {
    const captured = getPieceById(state, move.capturedPieceId);
    score += captured ? PIECE_VALUES[captured.type] : 50;
  }
  if (move.promotion) score += PIECE_VALUES[move.promotion] - PIECE_VALUES.pawn;
  if (move.isCheck) score += 40;
  return score;
}

function searchAi(state, rootPlayer, depth, alpha = -Infinity, beta = Infinity) {
  if (depth <= 0 || state.winner) return evaluateState(state, rootPlayer, true);
  const player = getCurrentPlayer(state);
  if (!player) return evaluateState(state, rootPlayer);
  const moves = getLegalMoves(state, player);
  if (moves.length === 0) return evaluateState(state, rootPlayer);
  const maximizing = player === rootPlayer;
  const ordered = [...moves]
    .sort((a, b) => moveHeuristic(state, b) - moveHeuristic(state, a))
    .slice(0, depth > 1 ? 5 : 8);
  let best = maximizing ? -Infinity : Infinity;
  for (const move of ordered) {
    const child = applyMove(state, move);
    const value = searchAi(child, rootPlayer, depth - 1, alpha, beta);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function getAiMove(state, difficulty = "easy", player = getCurrentPlayer(state)) {
  if (state?.winner || PLAYER_IDS.filter((candidate) => isActivePlayer(state, candidate)).length <= 1) return null;
  if (!player || !isActivePlayer(state, player)) return null;
  const normalizedDifficulty = String(difficulty).toLowerCase();
  if (!["easy", "medium", "hard"].includes(normalizedDifficulty)) {
    throw new Error('AI difficulty must be "easy", "medium", or "hard".');
  }
  const working = state.currentPlayer === player ? state : { ...state, currentPlayer: player };
  const moves = getLegalMoves(working, player);
  if (moves.length === 0) return null;
  if (normalizedDifficulty === "easy") {
    const captures = moves.filter((move) => move.capturedPieceId);
    const pool = captures.length > 0 && Math.random() < 0.72 ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let bestMove = moves[0];
  let bestScore = -Infinity;
  const searchDepth = normalizedDifficulty === "medium" ? 1 : 2;
  const ordered = [...moves]
    .sort((a, b) => moveHeuristic(working, b) - moveHeuristic(working, a))
    .slice(0, normalizedDifficulty === "medium" ? 12 : 8);
  let alpha = -Infinity;
  for (const move of ordered) {
    const child = applyMove(working, move);
    const score = searchAi(child, player, searchDepth, alpha, Infinity) + moveHeuristic(working, move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return bestMove;
}
