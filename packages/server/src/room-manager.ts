import type { GameState, Move, PlayerId } from "@triad-chess/engine";

import { RoomManagerError } from "./errors.js";
import {
  applyGameMove,
  createGameState,
  currentPlayer,
  playerIdForSeat,
  seatForPlayerId,
  SEATS,
  type Seat,
  validateMoveInput,
} from "./engine-adapter.js";

export { SEATS } from "./engine-adapter.js";

export const MAX_PLAYERS = SEATS.length;

export interface RoomParticipant {
  readonly connectionId: string;
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly displayName: string;
  readonly joinedAt: number;
}

export interface PublicParticipant {
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly displayName: string;
  readonly connected: true;
}

export interface RoomSnapshot {
  readonly code: string;
  readonly state: GameState;
  readonly players: readonly PublicParticipant[];
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly status: "waiting" | "playing";
  readonly currentPlayer: PlayerId | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface JoinResult {
  readonly room: RoomSnapshot;
  readonly participant: RoomParticipant;
}

export interface MoveResult {
  readonly room: RoomSnapshot;
  readonly participant: RoomParticipant;
  readonly move: Move;
}

export interface DisconnectResult {
  readonly roomCode: string;
  readonly participant: RoomParticipant;
  readonly room?: RoomSnapshot;
}

export interface RoomManagerOptions {
  readonly maxPlayers?: number;
  readonly codeLength?: number;
  readonly codeGenerator?: () => string;
  readonly gameFactory?: () => GameState;
  readonly moveApplier?: (state: GameState, move: Move) => GameState;
  readonly currentPlayerResolver?: (state: GameState) => PlayerId | null | undefined;
  readonly now?: () => number;
}

interface StoredRoom {
  readonly code: string;
  readonly createdAt: number;
  updatedAt: number;
  state: GameState;
  readonly players: Map<Seat, RoomParticipant>;
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_CODE_LENGTH = 6;

/**
 * In-memory authoritative room state.  This class deliberately knows nothing
 * about HTTP or Socket.io, so lifecycle and turn rules can be tested offline.
 */
export class RoomManager {
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly connections = new Map<string, string>();
  private readonly maxPlayers: number;
  private readonly codeLength: number;
  private readonly codeGenerator: () => string;
  private readonly gameFactory: () => GameState;
  private readonly moveApplier: (state: GameState, move: Move) => GameState;
  private readonly currentPlayerResolver: (state: GameState) => PlayerId | undefined;
  private readonly now: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
    this.codeLength = options.codeLength ?? DEFAULT_CODE_LENGTH;
    this.codeGenerator = options.codeGenerator ?? (() => generateRoomCode(this.codeLength));
    this.gameFactory = options.gameFactory ?? createGameState;
    this.moveApplier = options.moveApplier ?? applyGameMove;
    this.currentPlayerResolver = options.currentPlayerResolver
      ? (state) => options.currentPlayerResolver!(state) ?? undefined
      : currentPlayer;
    this.now = options.now ?? Date.now;

    if (!Number.isInteger(this.maxPlayers) || this.maxPlayers < 1 || this.maxPlayers > MAX_PLAYERS) {
      throw new Error(`maxPlayers must be an integer from 1 to ${MAX_PLAYERS}.`);
    }
    if (!Number.isInteger(this.codeLength) || this.codeLength < 4) {
      throw new Error("codeLength must be an integer of at least 4.");
    }
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Locate a connection without exposing the manager's private maps. */
  roomCodeForConnection(connectionId: string): string | undefined {
    if (typeof connectionId !== "string" || connectionId.trim().length === 0) {
      return undefined;
    }
    return this.connections.get(connectionId.trim());
  }

  createRoom(): RoomSnapshot {
    let code = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      code = normalizeRoomCode(this.codeGenerator());
      if (!this.rooms.has(code)) {
        break;
      }
      code = "";
    }

    if (!code) {
      throw new RoomManagerError("INVALID_REQUEST", "Could not generate a unique room code.", 503);
    }

    const timestamp = this.now();
    const room: StoredRoom = {
      code,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: this.gameFactory(),
      players: new Map(),
    };
    this.rooms.set(code, room);
    return this.snapshot(room);
  }

  getRoom(roomCode: string): RoomSnapshot | undefined {
    const code = normalizeRoomCodeOrUndefined(roomCode);
    if (!code) {
      return undefined;
    }

    const room = this.rooms.get(code);
    return room ? this.snapshot(room) : undefined;
  }

  joinRoom(roomCode: string, connectionId: string, displayName = "Player"): JoinResult {
    const room = this.requireRoom(roomCode);
    const normalizedConnectionId = normalizeConnectionId(connectionId);

    if (this.connections.has(normalizedConnectionId)) {
      throw new RoomManagerError(
        "ALREADY_IN_ROOM",
        "This connection is already associated with a room.",
      );
    }

    if (room.players.size >= this.maxPlayers) {
      throw new RoomManagerError("ROOM_FULL", "This room already has three players.");
    }

    const seat = SEATS.find((candidate, index) => index < this.maxPlayers && !room.players.has(candidate));
    if (!seat) {
      throw new RoomManagerError("NO_SEAT", "No seat is available in this room.");
    }

    const participant: RoomParticipant = {
      connectionId: normalizedConnectionId,
      playerId: playerIdForSeat(seat),
      seat,
      displayName: normalizeDisplayName(displayName),
      joinedAt: this.now(),
    };
    room.players.set(seat, participant);
    this.connections.set(normalizedConnectionId, room.code);
    room.updatedAt = this.now();

    return { room: this.snapshot(room), participant };
  }

  leaveRoom(roomCode: string, connectionId: string): RoomSnapshot | undefined {
    const room = this.requireRoom(roomCode);
    const participant = this.requireParticipant(room, connectionId);
    this.removeParticipant(room, participant);
    return this.finishRoomUpdate(room);
  }

  disconnect(connectionId: string): DisconnectResult | undefined {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const roomCode = this.connections.get(normalizedConnectionId);
    if (!roomCode) {
      return undefined;
    }

    const room = this.rooms.get(roomCode);
    this.connections.delete(normalizedConnectionId);
    if (!room) {
      return undefined;
    }

    const participant = [...room.players.values()].find(
      (candidate) => candidate.connectionId === normalizedConnectionId,
    );
    if (!participant) {
      return undefined;
    }

    this.removeParticipant(room, participant);
    const snapshot = this.finishRoomUpdate(room);
    return { roomCode, participant, ...(snapshot ? { room: snapshot } : {}) };
  }

  submitMove(roomCode: string, connectionId: string, rawMove: unknown): MoveResult {
    const room = this.requireRoom(roomCode);
    const participant = this.requireParticipant(room, connectionId);
    if (!this.isReady(room)) {
      throw new RoomManagerError("ROOM_NOT_READY", "Waiting for all active players to join the table.");
    }
    const turnPlayer = this.currentPlayerResolver(room.state);
    const turnSeat = seatForPlayerId(turnPlayer);

    if (!turnSeat) {
      throw new RoomManagerError(
        "INVALID_GAME_STATE",
        "The game does not have a current player.",
      );
    }

    if (turnSeat !== participant.seat) {
      throw new RoomManagerError(
        "NOT_YOUR_TURN",
        `It is ${turnSeat}'s turn.`,
        403,
        { expectedPlayerId: playerIdForSeat(turnSeat) },
      );
    }

    const move = validateMoveInput(rawMove);
    room.state = this.moveApplier(room.state, move);
    room.updatedAt = this.now();

    return { room: this.snapshot(room), participant, move };
  }

  resetRoom(roomCode: string, connectionId: string): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireParticipant(room, connectionId);

    room.state = this.gameFactory();
    room.updatedAt = this.now();
    return this.snapshot(room);
  }

  private requireRoom(roomCode: string): StoredRoom {
    const code = normalizeRoomCodeOrThrow(roomCode);
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomManagerError("ROOM_NOT_FOUND", `Room ${code} was not found.`);
    }
    return room;
  }

  private requireParticipant(room: StoredRoom, connectionId: string): RoomParticipant {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const mappedRoomCode = this.connections.get(normalizedConnectionId);
    if (mappedRoomCode !== room.code) {
      throw new RoomManagerError("NOT_IN_ROOM", "This connection is not a member of the room.");
    }

    const participant = [...room.players.values()].find(
      (candidate) => candidate.connectionId === normalizedConnectionId,
    );
    if (!participant) {
      throw new RoomManagerError("NOT_IN_ROOM", "This connection is not a member of the room.");
    }
    return participant;
  }

  private removeParticipant(room: StoredRoom, participant: RoomParticipant): void {
    room.players.delete(participant.seat);
    this.connections.delete(participant.connectionId);
  }

  private finishRoomUpdate(room: StoredRoom): RoomSnapshot | undefined {
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return undefined;
    }
    room.updatedAt = this.now();
    return this.snapshot(room);
  }

  private snapshot(room: StoredRoom): RoomSnapshot {
    const player = this.currentPlayerResolver(room.state);
    return {
      code: room.code,
      state: room.state,
      players: SEATS.slice(0, this.maxPlayers)
        .filter((seat) => room.players.has(seat))
        .map((seat) => ({
          playerId: room.players.get(seat)!.playerId,
          seat,
          displayName: room.players.get(seat)!.displayName,
          connected: true as const,
        })),
      playerCount: room.players.size,
      maxPlayers: this.maxPlayers,
      status: this.isReady(room) ? "playing" : "waiting",
      currentPlayer: player ?? null,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  private isReady(room: StoredRoom): boolean {
    const requiredSeats = room.state.activePlayers ?? SEATS.slice(0, this.maxPlayers);
    return requiredSeats.every((seat) => room.players.has(seat));
  }
}

export function generateRoomCode(length = DEFAULT_CODE_LENGTH): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    result += ROOM_CODE_ALPHABET[randomIndex];
  }
  return result;
}

export function normalizeRoomCode(roomCode: string): string {
  return normalizeRoomCodeOrThrow(roomCode);
}

function normalizeRoomCodeOrThrow(roomCode: string): string {
  const normalized = normalizeRoomCodeOrUndefined(roomCode);
  if (!normalized) {
    throw new RoomManagerError("INVALID_ROOM_CODE", "Room codes use 4-12 letters or numbers.");
  }
  return normalized;
}

function normalizeRoomCodeOrUndefined(roomCode: string): string | undefined {
  if (typeof roomCode !== "string") {
    return undefined;
  }
  const normalized = roomCode.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(normalized) ? normalized : undefined;
}

function normalizeConnectionId(connectionId: string): string {
  if (typeof connectionId !== "string" || connectionId.trim().length === 0) {
    throw new RoomManagerError("INVALID_REQUEST", "A connection id is required.");
  }
  return connectionId.trim();
}

function normalizeDisplayName(displayName: string): string {
  if (typeof displayName !== "string") return "Player";
  const normalized = displayName.trim().replace(/\s+/g, " ").slice(0, 24);
  return normalized || "Player";
}
