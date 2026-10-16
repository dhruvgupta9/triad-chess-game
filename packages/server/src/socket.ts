import type { Move } from "@triad-chess/engine";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";

import { asRoomManagerError, RoomManagerError } from "./errors.js";
import { RoomManager, type RoomSnapshot } from "./room-manager.js";

export interface SocketServerOptions {
  readonly corsOrigin?: string | readonly string[];
}

export interface SocketAckSuccess {
  readonly ok: true;
  readonly room?: RoomSnapshot;
  readonly code?: string;
  readonly roomCode?: string;
  readonly playerId?: string;
  readonly seat?: string;
  readonly displayName?: string;
  readonly move?: Move;
}

export interface SocketAckFailure {
  readonly ok: false;
  readonly error: ReturnType<RoomManagerError["toJSON"]>;
}

export type SocketAck = (response: SocketAckSuccess | SocketAckFailure) => void;

export function createSocketServer(
  httpServer: HttpServer,
  manager: RoomManager,
  options: SocketServerOptions = {},
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: socketCorsOrigin(options.corsOrigin ?? process.env.CORS_ORIGIN),
      credentials: true,
    },
  });

  attachSocketHandlers(io, manager);
  return io;
}

export function attachSocketHandlers(io: SocketIOServer, manager: RoomManager): void {
  io.on("connection", (socket) => {
    registerRoomHandlers(io, manager, socket);
  });
}

function registerRoomHandlers(io: SocketIOServer, manager: RoomManager, socket: Socket): void {
  socket.on("room:create", (_payload: unknown, ack?: SocketAck) => {
    try {
      if (findConnectionRoom(manager, socket.id)) {
        throw new RoomManagerError(
          "ALREADY_IN_ROOM",
          "Leave the current room before creating another one.",
        );
      }
      const room = manager.createRoom();
      const joined = manager.joinRoom(room.code, socket.id, readDisplayName(_payload));
      socket.join(room.code);
      emitRoomState(io, room.code, joined.room);
      respond(ack, {
        ok: true,
        code: joined.room.code,
        roomCode: joined.room.code,
        room: joined.room,
        playerId: String(joined.participant.playerId),
        seat: joined.participant.seat,
        displayName: joined.participant.displayName,
      });
    } catch (error) {
      respondError(socket, error, ack);
    }
  });

  socket.on("room:join", (payload: unknown, ack?: SocketAck) => {
    try {
      const code = readRoomCode(payload);
      const joined = manager.joinRoom(code, socket.id, readDisplayName(payload));
      socket.join(joined.room.code);
      emitRoomState(io, joined.room.code, joined.room);
      respond(ack, {
        ok: true,
        code: joined.room.code,
        roomCode: joined.room.code,
        room: joined.room,
        playerId: String(joined.participant.playerId),
        seat: joined.participant.seat,
        displayName: joined.participant.displayName,
      });
    } catch (error) {
      respondError(socket, error, ack);
    }
  });

  socket.on("room:leave", (_payload: unknown, ack?: SocketAck) => {
    try {
      const roomCode = findConnectionRoom(manager, socket.id);
      if (!roomCode) {
        throw new RoomManagerError("NOT_IN_ROOM", "This connection is not in a room.");
      }
      const room = manager.leaveRoom(roomCode, socket.id);
      socket.leave(roomCode);
      if (room) {
        emitRoomState(io, roomCode, room);
      }
      respond(ack, { ok: true, ...(room ? { room } : {}) });
    } catch (error) {
      respondError(socket, error, ack);
    }
  });

  socket.on("game:move", (payload: unknown, ack?: SocketAck) => {
    try {
      const roomCode = findConnectionRoom(manager, socket.id);
      if (!roomCode) {
        throw new RoomManagerError("NOT_IN_ROOM", "Join a room before making a move.");
      }
      const move = readMove(payload);
      const result = manager.submitMove(roomCode, socket.id, move);
      const event = {
        roomCode,
        move: result.move,
        playerId: result.participant.playerId,
        state: result.room.state,
      };
      io.to(roomCode).emit("game:move", event);
      io.to(roomCode).emit("game:state", result.room);
      respond(ack, {
        ok: true,
        room: result.room,
        move: result.move,
        playerId: String(result.participant.playerId),
      });
    } catch (error) {
      respondError(socket, error, ack);
    }
  });

  socket.on("game:reset", (_payload: unknown, ack?: SocketAck) => {
    try {
      const roomCode = findConnectionRoom(manager, socket.id);
      if (!roomCode) {
        throw new RoomManagerError("NOT_IN_ROOM", "Join a room before resetting the game.");
      }
      const room = manager.resetRoom(roomCode, socket.id);
      io.to(roomCode).emit("game:reset", room);
      emitRoomState(io, roomCode, room);
      respond(ack, { ok: true, room });
    } catch (error) {
      respondError(socket, error, ack);
    }
  });

  socket.on("disconnect", () => {
    const result = manager.disconnect(socket.id);
    if (result?.room) {
      emitRoomState(io, result.roomCode, result.room);
    }
  });
}

function emitRoomState(io: SocketIOServer, roomCode: string, room: RoomSnapshot): void {
  io.to(roomCode).emit("room:state", room);
  io.to(roomCode).emit("game:state", room);
}

function findConnectionRoom(manager: RoomManager, connectionId: string): string | undefined {
  return manager.roomCodeForConnection(connectionId);
}

function socketCorsOrigin(value: string | readonly string[] | undefined): string | string[] | boolean {
  if (
    !value ||
    (typeof value === "string" && (value === "*" || value.trim() === "")) ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return true;
  }
  return typeof value === "string"
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : [...value];
}

function readRoomCode(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object" && payload !== null && ("code" in payload || "roomCode" in payload)) {
    const value = payload as { code?: unknown; roomCode?: unknown };
    const code = value.code ?? value.roomCode;
    if (typeof code === "string") {
      return code;
    }
  }
  throw new RoomManagerError("INVALID_REQUEST", "A room code is required.");
}

function readDisplayName(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Player";
  const value = (payload as { displayName?: unknown }).displayName;
  return typeof value === "string" ? value : "Player";
}

function readMove(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && "move" in payload) {
    return (payload as { move?: unknown }).move;
  }
  return payload;
}

function respond(ack: SocketAck | undefined, response: SocketAckSuccess): void {
  ack?.(response);
}

function respondError(socket: Socket, error: unknown, ack?: SocketAck): void {
  const normalized = asRoomManagerError(error);
  const response: SocketAckFailure = { ok: false, error: normalized.toJSON() };
  ack?.(response);
  socket.emit("server:error", response.error);
}
