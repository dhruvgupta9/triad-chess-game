import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Express } from "express";
import type { Server as SocketIOServer } from "socket.io";

import { createApp, type HttpServerOptions } from "./http.js";
import { createSocketServer } from "./socket.js";
import { RoomManager } from "./room-manager.js";

export { RoomManager } from "./room-manager.js";
export {
  generateRoomCode,
  normalizeRoomCode,
  MAX_PLAYERS,
  SEATS,
  type DisconnectResult,
  type JoinResult,
  type MoveResult,
  type PublicParticipant,
  type RoomManagerOptions,
  type RoomParticipant,
  type RoomSnapshot,
} from "./room-manager.js";
export { RoomManagerError, type RoomErrorCode } from "./errors.js";
export { createApp } from "./http.js";
export { attachSocketHandlers, createSocketServer } from "./socket.js";

export interface ServerOptions extends HttpServerOptions {
  readonly manager?: RoomManager;
  readonly port?: number;
  readonly host?: string;
}

export interface TriadServer {
  readonly app: Express;
  readonly httpServer: HttpServer;
  readonly io: SocketIOServer;
  readonly manager: RoomManager;
  close(): Promise<void>;
}

export interface RunningTriadServer extends TriadServer {
  readonly port: number;
}

export function createServer(options: ServerOptions = {}): TriadServer {
  const manager = options.manager ?? new RoomManager();
  const app = createApp(manager, options);
  const httpServer = createHttpServer(app);
  const io = createSocketServer(httpServer, manager, options);

  return {
    app,
    httpServer,
    io,
    manager,
    close: () => closeServer(io, httpServer),
  };
}

export function startServer(options: ServerOptions = {}): Promise<RunningTriadServer> {
  const server = createServer(options);
  const port = options.port ?? readPort(process.env.PORT);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.httpServer.off("error", onError);
      const address = server.httpServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ ...server, port: actualPort });
    };
    server.httpServer.once("error", onError);
    server.httpServer.once("listening", onListening);
    server.httpServer.listen(port, host);
  });
}

export function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535.");
  }
  return port;
}

function closeServer(io: SocketIOServer, httpServer: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!httpServer.listening) {
      io.close();
      resolve();
      return;
    }

    io.close((ioError?: Error) => {
      if (ioError) {
        if ((ioError as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
        } else {
          reject(ioError);
        }
        return;
      }
      // Socket.IO owns the attached HTTP server and closes it as part of
      // io.close(). Calling httpServer.close() again races with that close.
      resolve();
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer()
    .then(({ port }) => {
      // Keep startup output intentionally small for Docker and local scripts.
      console.log(`Triad Chess server listening on ${port}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
