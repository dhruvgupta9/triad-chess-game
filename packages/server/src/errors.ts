export type RoomErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ROOM_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NO_SEAT"
  | "NOT_YOUR_TURN"
  | "INVALID_MOVE"
  | "INVALID_GAME_STATE";

/**
 * Errors raised by the socket-free room manager.  Keeping an error code on
 * every failure lets both HTTP and Socket.io callers present the same useful
 * message to a client.
 */
export class RoomManagerError extends Error {
  readonly code: RoomErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RoomErrorCode,
    message: string,
    status = statusForRoomError(code),
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RoomManagerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): {
    code: RoomErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function statusForRoomError(code: RoomErrorCode): number {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return 404;
    case "ROOM_FULL":
      return 409;
    case "ALREADY_IN_ROOM":
    case "NOT_IN_ROOM":
      return 409;
    case "NOT_YOUR_TURN":
      return 403;
    case "INVALID_REQUEST":
    case "INVALID_ROOM_CODE":
    case "NO_SEAT":
    case "INVALID_MOVE":
    case "INVALID_GAME_STATE":
      return 400;
  }
}

export function asRoomManagerError(error: unknown): RoomManagerError {
  if (error instanceof RoomManagerError) {
    return error;
  }

  if (error instanceof Error) {
    return new RoomManagerError("INVALID_REQUEST", error.message);
  }

  return new RoomManagerError("INVALID_REQUEST", "The request could not be processed.");
}
