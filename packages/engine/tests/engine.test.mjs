import assert from "node:assert/strict";
import {
  BOARD_CELLS,
  BOARD_RADIUS,
  HEX_DIRECTIONS,
  applyMove,
  axialToPixel,
  createInitialGame,
  getAiMove,
  getCurrentPlayer,
  getGameStatus,
  getLegalMoves,
  getLegalMovesForPiece,
  getNextActivePlayer,
  getSectorForPosition,
  isInCheck,
  parsePosition,
  positionKey
} from "../src/runtime.js";

function piece(state, predicate) {
  const found = state.pieces.find(predicate);
  assert.ok(found, "expected a matching piece");
  return found;
}

function withoutInitialPieces(state, pieces) {
  const next = structuredClone(state);
  next.pieces = pieces;
  next.board = Object.fromEntries(pieces.map((item) => [item.position, item.id]));
  return next;
}

// Geometry and coordinate invariants.
assert.equal(BOARD_RADIUS, 7);
assert.equal(BOARD_CELLS.length, 169);
assert.equal(new Set(BOARD_CELLS).size, BOARD_CELLS.length);
assert.equal(HEX_DIRECTIONS.length, 6);
assert.deepEqual(parsePosition(" 0, -7 "), { q: 0, r: -7 });
assert.equal(positionKey({ q: -7, r: 0 }), "-7,0");
assert.deepEqual(axialToPixel("0,0", 2), { x: 0, y: 0 });
assert.equal(getSectorForPosition("-7,0"), "P0");
assert.equal(getSectorForPosition("0,-7"), "P1");
assert.equal(getSectorForPosition("7,0"), "P2");
assert.equal(getSectorForPosition("0,0"), null);
assert.throws(() => parsePosition("8,0"), /radius 7/);

// Initial armies, JSON shape, and rotated home edges.
const initial = createInitialGame();
assert.equal(initial.pieces.length, 48);
assert.equal(Object.keys(initial.board).length, 48);
assert.deepEqual(initial.activePlayers, ["P0", "P1", "P2"]);
assert.equal(initial.currentPlayer, "P0");
assert.equal(JSON.parse(JSON.stringify(initial)).pieces.length, 48);
for (const player of initial.activePlayers) {
  assert.equal(initial.pieces.filter((item) => item.owner === player && item.type === "king").length, 1);
}

// Pawn movement, turn rotation, and an illegal-turn error.
const pawn = piece(initial, (item) => item.owner === "P0" && item.type === "pawn" && item.position === "-6,0");
const pawnMoves = getLegalMovesForPiece(initial, pawn);
assert.deepEqual(new Set(pawnMoves.map((move) => move.to)), new Set(["-5,0", "-4,0"]));
const afterPawn = applyMove(initial, pawnMoves.find((move) => move.to === "-4,0"));
assert.equal(afterPawn.currentPlayer, "P1");
assert.equal(afterPawn.turnNumber, 1);
assert.equal(afterPawn.fairness.turnsTaken.P0, 1);
assert.equal(afterPawn.fairness.balanceScore, 1);
assert.throws(() => applyMove(afterPawn, pawnMoves[0]), /belongs to P0|Illegal move/);
assert.equal(getCurrentPlayer(afterPawn), "P1");
assert.equal(getNextActivePlayer(afterPawn), "P2");

// A knight jumps over occupied cells, and a blocked rook cannot pass through.
const knight = piece(initial, (item) => item.owner === "P0" && item.type === "knight" && item.position === "-7,1");
assert.ok(getLegalMovesForPiece(initial, knight).some((move) => move.to === "-5,0"));
const rook = piece(initial, (item) => item.owner === "P0" && item.type === "rook" && item.position === "-7,0");
const rookMoveTargets = getLegalMovesForPiece(initial, rook).map((move) => move.to);
assert.ok(rookMoveTargets.length > 0);
assert.equal(rookMoveTargets.includes("-5,0"), false);
assert.equal(rookMoveTargets.includes("-6,0"), false);
const p1Pawn = piece(initial, (item) => item.owner === "P1" && item.type === "pawn" && item.position === "6,-6");
assert.deepEqual(new Set(getLegalMovesForPiece(initial, p1Pawn).map((move) => move.to)), new Set(["5,-5", "4,-4"]));
const p2Pawn = piece(initial, (item) => item.owner === "P2" && item.type === "pawn" && item.position === "0,6");
assert.deepEqual(new Set(getLegalMovesForPiece(initial, p2Pawn).map((move) => move.to)), new Set(["0,5", "0,4"]));

const promotionState = withoutInitialPieces(initial, [
  { id: "P0-king", type: "king", owner: "P0", position: "0,0", hasMoved: false, neutral: false },
  { id: "P0-pawn", type: "pawn", owner: "P0", position: "6,0", hasMoved: true, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,7", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "-7,7", hasMoved: false, neutral: false }
]);
const promotionMove = getLegalMovesForPiece(promotionState, "P0-pawn").find((move) => move.to === "7,0");
assert.equal(promotionMove.promotion, "queen");
const promoted = applyMove(promotionState, promotionMove);
assert.equal(promoted.pieces.find((item) => item.id === "P0-pawn").type, "queen");

// Check detection and self-check filtering on a compact hand-authored state.
const checkState = withoutInitialPieces(initial, [
  { id: "P0-king", type: "king", owner: "P0", position: "0,0", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,3", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "-6,6", hasMoved: false, neutral: false },
  { id: "P1-rook", type: "rook", owner: "P1", position: "0,2", hasMoved: false, neutral: false }
]);
assert.equal(isInCheck(checkState, "P0"), true);
assert.equal(getGameStatus(checkState).status, "check");
assert.ok(getLegalMoves(checkState).every((move) => {
  const next = applyMove(checkState, move);
  return !isInCheck(next, "P0");
}));

const checkmateState = withoutInitialPieces(initial, [
  { id: "P0-king", type: "king", owner: "P0", position: "-7,0", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,7", hasMoved: false, neutral: false },
  { id: "P1-queen", type: "queen", owner: "P1", position: "-6,1", hasMoved: false, neutral: false },
  { id: "P1-knight-a", type: "knight", owner: "P1", position: "-6,0", hasMoved: false, neutral: false },
  { id: "P1-knight-b", type: "knight", owner: "P1", position: "-6,-1", hasMoved: false, neutral: false },
  { id: "P1-knight-c", type: "knight", owner: "P1", position: "-7,1", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "7,0", hasMoved: false, neutral: false }
]);
assert.equal(isInCheck(checkmateState, "P0"), true);
assert.equal(getLegalMoves(checkmateState).length, 0);
assert.equal(getGameStatus(checkmateState).status, "checkmate");

const stalemateState = withoutInitialPieces(initial, [
  { id: "P0-king", type: "king", owner: "P0", position: "-7,0", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,7", hasMoved: false, neutral: false },
  { id: "P1-knight-a", type: "knight", owner: "P1", position: "-6,0", hasMoved: false, neutral: false },
  { id: "P1-knight-b", type: "knight", owner: "P1", position: "-6,-1", hasMoved: false, neutral: false },
  { id: "P1-knight-c", type: "knight", owner: "P1", position: "-7,1", hasMoved: false, neutral: false },
  { id: "P1-rook-a", type: "rook", owner: "P1", position: "-5,0", hasMoved: false, neutral: false },
  { id: "P1-rook-b", type: "rook", owner: "P1", position: "-5,-2", hasMoved: false, neutral: false },
  { id: "P1-rook-c", type: "rook", owner: "P1", position: "-7,2", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "7,0", hasMoved: false, neutral: false }
]);
assert.equal(isInCheck(stalemateState, "P0"), false);
assert.equal(getLegalMoves(stalemateState).length, 0);
assert.equal(getGameStatus(stalemateState).status, "stalemate");

// King capture eliminates the player. Both elimination policies are checked.
const captureState = withoutInitialPieces(createInitialGame(), [
  { id: "P0-king", type: "king", owner: "P0", position: "0,0", hasMoved: false, neutral: false },
  { id: "P0-rook", type: "rook", owner: "P0", position: "0,1", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,3", hasMoved: false, neutral: false },
  { id: "P1-rook", type: "rook", owner: "P1", position: "0,4", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "-6,6", hasMoved: false, neutral: false }
]);
const captureMove = { pieceId: "P0-rook", from: "0,1", to: "0,3" };
const disappeared = applyMove(captureState, captureMove);
assert.deepEqual(disappeared.eliminatedPlayers, ["P1"]);
assert.equal(disappeared.activePlayers.includes("P1"), false);
assert.equal(disappeared.pieces.some((item) => item.owner === "P1"), false);
const neutralState = withoutInitialPieces(createInitialGame({ eliminationMode: "neutral" }), captureState.pieces);
const neutral = applyMove(neutralState, captureMove);
assert.equal(neutral.eliminatedPlayers[0], "P1");
assert.equal(neutral.pieces.some((item) => item.owner === "P1" && item.neutral), true);
assert.equal(neutral.currentPlayer, "P2");
assert.equal(getNextActivePlayer(neutral, "P0"), "P2");

// Neutral pieces are blockers, not capturable material.
const blockerState = withoutInitialPieces(createInitialGame({ eliminationMode: "neutral" }), [
  { id: "P0-king", type: "king", owner: "P0", position: "-7,0", hasMoved: false, neutral: false },
  { id: "P0-rook", type: "rook", owner: "P0", position: "0,1", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,7", hasMoved: false, neutral: false },
  { id: "P1-blocker", type: "rook", owner: "P1", position: "0,2", hasMoved: false, neutral: true },
  { id: "P2-king", type: "king", owner: "P2", position: "7,0", hasMoved: false, neutral: false }
]);
const blockerTargets = getLegalMovesForPiece(blockerState, "P0-rook").map((move) => move.to);
assert.equal(blockerTargets.includes("0,2"), false);
assert.equal(blockerTargets.includes("0,3"), false);
assert.throws(() => applyMove(blockerState, { pieceId: "P0-rook", from: "0,1", to: "0,2" }), /Illegal move/);

const fairnessConfig = createInitialGame({ fairnessBonus: false, coordinationWindow: 4 });
assert.equal(fairnessConfig.config.fairnessBonus, false);
assert.equal(fairnessConfig.config.coordinationWindow, 4);
assert.equal(fairnessConfig.fairness.leader, null);
assert.equal(fairnessConfig.coordination.focusTarget, null);

const coordinatedState = withoutInitialPieces(createInitialGame(), [
  { id: "P0-king", type: "king", owner: "P0", position: "-7,0", hasMoved: false, neutral: false },
  { id: "P0-rook", type: "rook", owner: "P0", position: "-1,1", hasMoved: false, neutral: false },
  { id: "P1-king", type: "king", owner: "P1", position: "0,4", hasMoved: false, neutral: false },
  { id: "P2-king", type: "king", owner: "P2", position: "7,0", hasMoved: false, neutral: false }
]);
coordinatedState.coordination.recentAttacks = [{ attacker: "P2", target: "P1", turn: 0, kind: "check" }];
const coordinatedMove = getLegalMovesForPiece(coordinatedState, "P0-rook").find((move) => move.to === "0,1");
assert.ok(coordinatedMove);
const coordinated = applyMove(coordinatedState, coordinatedMove);
assert.equal(coordinated.coordination.focusTarget, "P1");
assert.equal(coordinated.coordination.coordinatedAttacks.P1, 1);
assert.equal(coordinated.fairness.defensiveBonus.P1, 1);

// AI difficulty levels always return a legal move without mutating the state.
const aiState = createInitialGame();
const serializedBeforeAi = JSON.stringify(aiState);
for (const difficulty of ["easy", "medium", "hard"]) {
  const aiMove = getAiMove(aiState, difficulty);
  assert.ok(aiMove);
  assert.ok(getLegalMoves(aiState).some((move) => move.pieceId === aiMove.pieceId && move.to === aiMove.to));
}
assert.equal(JSON.stringify(aiState), serializedBeforeAi);

console.log("Triad Chess engine checks passed.");
