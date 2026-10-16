import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import cors, { type CorsOptions } from "cors";

import { asRoomManagerError, RoomManagerError } from "./errors.js";
import { RoomManager, type RoomSnapshot } from "./room-manager.js";

export interface HttpServerOptions {
  readonly corsOrigin?: string | readonly string[];
}

export function createApp(
  manager: RoomManager = new RoomManager(),
  options: HttpServerOptions = {},
): Express {
  const app = express();
  app.locals.roomManager = manager;
  app.use(cors(corsOptions(options.corsOrigin ?? process.env.CORS_ORIGIN)));
  app.use(express.json());

  const health = (_request: Request, response: Response): void => {
    response.status(200).json({ status: "ok" });
  };
  app.get("/health", health);
  app.get("/api/health", health);

  const createRoom = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const connectionId = optionalConnectionId(request.body) ?? httpConnectionId();
      if (manager.roomCodeForConnection(connectionId)) {
        throw new RoomManagerError(
          "ALREADY_IN_ROOM",
          "Leave the current room before creating another one.",
        );
      }
      const room = manager.createRoom();
      const joined = manager.joinRoom(room.code, connectionId, displayNameFrom(request.body));
      response.status(201).json(roomResponse(joined.room, joined.participant, connectionId));
    } catch (error) {
      next(error);
    }
  };
  app.post(["/rooms", "/api/rooms"], createRoom);

  const getRoom = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const room = manager.getRoom(request.params.code);
      if (!room) {
        throw new RoomManagerError("ROOM_NOT_FOUND", `Room ${request.params.code} was not found.`);
      }
      response.status(200).json(roomResponse(room));
    } catch (error) {
      next(error);
    }
  };
  app.get(["/rooms/:code", "/api/rooms/:code"], getRoom);

  const joinRoom = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const connectionId = optionalConnectionId(request.body) ?? httpConnectionId();
      const joined = manager.joinRoom(request.params.code, connectionId, displayNameFrom(request.body));
      response.status(200).json(roomResponse(joined.room, joined.participant, connectionId));
    } catch (error) {
      next(error);
    }
  };
  app.post(["/rooms/:code/join", "/api/rooms/:code/join"], joinRoom);

  const submitMove = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const body = asObject(request.body);
      const connectionId = body.connectionId;
      if (typeof connectionId !== "string") {
        throw new RoomManagerError("INVALID_REQUEST", "connectionId is required.");
      }
      const move = body.move ?? withoutConnectionId(body);
      const result = manager.submitMove(request.params.code, connectionId, move);
      response.status(200).json({
        ok: true,
        ...roomResponse(result.room),
        move: result.move,
        playerId: result.participant.playerId,
      });
    } catch (error) {
      next(error);
    }
  };
  app.post(["/rooms/:code/moves", "/api/rooms/:code/moves"], submitMove);

  const resetRoom = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const body = request.body === undefined ? {} : asObject(request.body);
      const connectionId = body.connectionId;
      if (typeof connectionId !== "string" || !connectionId.trim()) {
        throw new RoomManagerError("INVALID_REQUEST", "connectionId is required to reset a room.");
      }
      const room = manager.resetRoom(request.params.code, connectionId);
      response.status(200).json(roomResponse(room));
    } catch (error) {
      next(error);
    }
  };
  app.post(["/rooms/:code/reset", "/api/rooms/:code/reset"], resetRoom);

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "The requested endpoint was not found." },
    });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const normalized = asRoomManagerError(error);
    response.status(normalized.status).json({ ok: false, error: normalized.toJSON() });
  });

  return app;
}

function roomResponse(
  room: RoomSnapshot,
  participant?: { playerId: unknown; seat: string; displayName?: string },
  connectionId?: string,
): Record<string, unknown> {
  return {
    ok: true,
    room,
    code: room.code,
    roomCode: room.code,
    state: room.state,
    players: room.players,
    ...(participant
      ? {
           playerId: participant.playerId,
           seat: participant.seat,
           displayName: participant.displayName,
          ...(connectionId ? { connectionId } : {}),
        }
      : {}),
  };
}

function optionalConnectionId(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "connectionId" in body) {
    const value = (body as { connectionId?: unknown }).connectionId;
    return typeof value === "string" && value.trim() ? value : undefined;
  }
  return undefined;
}

function displayNameFrom(body: unknown): string {
  if (typeof body !== "object" || body === null) return "Player";
  const value = (body as { displayName?: unknown }).displayName;
  return typeof value === "string" ? value : "Player";
}

function httpConnectionId(): string {
  return `http-${randomUUID()}`;
}

function asObject(value: unknown): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RoomManagerError("INVALID_REQUEST", "A JSON object is required.");
  }
  return value as Record<string, any>;
}

function withoutConnectionId(body: Record<string, any>): Record<string, unknown> {
  const { connectionId: _connectionId, ...move } = body;
  return move;
}

function corsOptions(value: string | readonly string[] | undefined): CorsOptions {
  if (!value || (typeof value === "string" && value === "*")) {
    return { origin: true, credentials: true };
  }

  const allowed = typeof value === "string"
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : [...value];
  return {
    credentials: true,
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || allowed.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin is not allowed by CORS."));
      }
    },
  };
}
