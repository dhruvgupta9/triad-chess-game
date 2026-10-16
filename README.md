# Triad Chess Game

Triad Chess is a three-player strategy game on an axial hex board. The
repository is an npm workspace monorepo: a framework-independent rules engine,
an authoritative multiplayer server, and a browser client that renders the
board with Phaser and the heads-up display with React.

The repository is pinned to Node.js 20.18.1 and uses a checked-in npm lockfile.
All commands below are intended to be run from the repository root.

## Quick start

### Prerequisites

- Node.js 20.18.1 (the version in `.nvmrc`)
- npm 10.8 or newer within npm major version 10
- `make` for the convenience targets (optional; the equivalent npm commands
  are shown below)
- Docker 24 or newer for container builds and deployment

Use the pinned runtime with nvm:

```sh
nvm install
nvm use
node --version       # v20.18.1
npm --version        # 10.x
```

On Windows, install Node 20.18.1 with nvm-windows or use the official Node.js
installer, then verify `node --version` before continuing. The npm commands
are the source of truth when `make` is not available.

### Install and configure

```sh
npm ci
cp .env.example .env
cp packages/client/.env.example packages/client/.env
```

PowerShell equivalent:

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item packages/client/.env.example packages/client/.env
```

The checked-in `.env.example` contains development-safe defaults and blank
optional AI credentials. Keep real credentials in the untracked `.env` file or
in the deployment environment; never commit them.

### Run locally

Start both the server and browser client in development mode:

```sh
npm run dev
# or: make dev
```

The default server address is `http://localhost:3001`; the client dev server
is `http://localhost:5173`. Open the client URL in a browser. `npm run dev`
uses `concurrently` so a failure in either workspace stops the other process.

To run the production server and the built client preview:

```sh
npm run build
npm start
# or: make build && make start
```

The browser client is previewed on `http://localhost:5173`; use
`npm run start:server` when only the API/realtime server is needed.

## Repository architecture

The workspaces have deliberately narrow responsibilities:

```text
packages/engine   Pure TypeScript game state, coordinates, move legality,
                  captures, turn/elimination rules, and AI decisions.
packages/server   Node.js authoritative API and realtime room transport;
                  owns sessions, validation, revisions, and broadcasts.
packages/client   React application shell, Phaser board renderer, HUD,
                  input handling, and realtime client state.
```

The root `package.json` supplies the workspace scripts. The root TypeScript
configuration establishes the shared compiler baseline, while
`npm run typecheck` delegates to each workspace's own configuration so the
engine, server, and client are checked with their platform-specific module
settings. The engine must remain browser/server agnostic: state,
actions, events, coordinates, and errors are JSON serializable. The server is
the authority even when the client performs optimistic highlighting.

### Move and state flow

1. The client creates a room or joins an existing room through the server.
2. The server assigns one of the active seats (`P0`, `P1`, or `P2`) and returns
   a JSON snapshot containing the authoritative engine state.
3. The client renders the snapshot in Phaser and exposes legal destinations.
   A selected move is sent with the room code, source coordinate, destination
   coordinate, and any promotion choice.
4. The server checks the current seat, ownership, board bounds, and engine
   legality before applying the move and broadcasting the new snapshot.
5. Clients replace their local state with the authoritative snapshot. A
   malformed, out-of-turn, or illegal request is rejected without mutating the
   game; reconnecting clients can request `GET /rooms/:code` for a fresh state.

This sequence makes simultaneous browser tabs safe: clients never resolve
conflicting moves locally, and every accepted move is represented in the
engine's JSON move history.

## Current rules

The engine is the executable source of truth for legal moves. The following
rules describe the current default board and match contract:

- The board is an axial hex grid of radius 7. A coordinate is written `q,r`,
  with `s = -q-r`; a cell is on the board when
  `max(abs(q), abs(r), abs(s)) <= 7`. This produces 169 playable cells.
- Three rotated home edges establish the starting sides for `P0`, `P1`, and
  `P2`. The three seats are symmetric under a 120-degree rotation; seat
  identity is still preserved in serialized state and network events.
- Turns advance `P0 -> P1 -> P2`. A seat that has been eliminated is skipped;
  the turn advances to the next active seat rather than stalling the match.
- A move must originate from the moving seat's piece, stay on the board, use
  that piece's legal movement pattern, and obey occupancy/capture rules. A
  player cannot move an opponent's piece or overwrite a friendly piece.
- Captures remove the captured piece and are included in the authoritative
  move event. The engine, rather than the renderer, determines legal targets
  and terminal state.
- When a seat is eliminated, its remaining pieces use the room's configured
  eliminated-piece mode. The default is `disappear`; `neutral` is available
  for variants in which those pieces remain as non-turn-taking obstacles.
- A match ends when the engine's configured victory/terminal condition is met
  (the default competitive flow leaves one active seat). The final snapshot
  contains the winner and move history so all clients display the same result.
- The server rejects moves from spectators, eliminated seats, the wrong turn,
  and malformed coordinates. Clients should show the error and refresh their
  snapshot rather than retrying a rejected mutation blindly.

Coordinates, rotations, initial-state construction, and move generation live
in `@triad-chess/engine`; do not duplicate those rules in React or Phaser.

## AI levels

AI runs through the same engine action interface as a human move. Local seats
are scheduled in the browser, and every generated action is still validated by
the engine before it changes state. The setup screen can assign a bot to any
local seat and can choose one of these levels:

| Level | Name | Behavior |
| --- | --- | --- |
| `human` / `0` | Human | The seat waits for a player action. |
| `easy` / `1` | Easy | Chooses a random legal move, preferring captures when available. |
| `medium` / `2` | Medium | Uses shallow multi-player minimax with capture ordering and material evaluation. |
| `hard` / `3` | Hard | Uses bounded beam search plus material, king safety, mobility, rival pressure, and fairness signals. |

AI difficulty is a search/decision budget, not a second rules implementation.
Every generated action is passed back through the engine and committed by the
local session or server. `DEFAULT_AI_LEVEL=human` in `.env.example` keeps
online rooms human controlled; local seats can opt into a bot in the setup
screen.

## Multiplayer flow

The server owns rooms and authoritative game state. A typical online match is:

1. Host requests a room and receives a shareable room code plus a waiting
   snapshot.
2. Guests join using the room code. The server assigns the first available
   seat and broadcasts the same snapshot to every connected member.
3. Clients send move intents over the realtime connection. The server
   validates and broadcasts `game:move` and `game:state` with the captured
   piece (if any), active seat, and terminal metadata.
4. If a player leaves, the connection is removed and the room broadcasts its
   updated roster. Eliminated seats are skipped in turn order.
5. At game over, the server broadcasts the final snapshot. The room can be
   reset with `game:reset` for a rematch without changing the engine rules.

The transport may be WebSocket-based, but the payload contract remains plain
JSON so it can also be tested offline and replayed in a CLI or future mobile
client.

## Configuration

Copy `.env.example` to `.env` and adjust only what is needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Server bind address. |
| `PORT` | `3001` | Server HTTP/realtime port. |
| `CLIENT_PORT` | `5173` | Client development-server port. |
| `PUBLIC_API_URL` | `http://localhost:3001` | Browser API base URL. |
| `PUBLIC_WS_URL` | `ws://localhost:3001` | Browser realtime URL. |
| `VITE_SERVER_URL` | `http://localhost:3001` | Socket.io origin used by the Online table flow; configure it in `packages/client/.env`. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin. |
| `DEFAULT_AI_LEVEL` | `human` | Default seat policy for new local rooms. |
| `NEUTRAL_ELIMINATED_PIECES` | `disappear` | `disappear` or `neutral` eliminated-piece behavior. |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` | local/blank | Optional remote AI integration; local engine AI requires no key. |

## Checks and build commands

Install the exact dependency graph and run the offline checks:

```sh
npm ci
npm test
# or: make install && make test
```

`npm test` first builds all workspaces and then invokes every workspace test
script. It does not fetch data, call a remote AI provider, or require a running
server, so `make test` is suitable for an offline clean checkout after
`npm ci`.

Run the individual checks when diagnosing a failure:

```sh
npm run typecheck
npm run build
npm run test:workspaces
```

Build output is workspace-local and should not be committed. Remove it with:

```sh
npm run clean
# or: make clean
```

## Docker

The multi-stage `Dockerfile` uses the pinned Node 20.18.1 image, installs the
lockfile dependencies with `npm ci`, builds all workspaces, and starts the root
production command. That command runs the server and serves the built client
through Vite preview. Build and run it with:

```sh
cp .env.example .env
docker build --tag triad-chess-game:local .
docker run --rm --env-file .env \
  --publish 3001:3001 --publish 5173:5173 \
  triad-chess-game:local
```

Equivalent Make targets are `make docker-build` and `make docker-run`.
The server and client must bind to `0.0.0.0` inside the container. The image
exposes both the API port (3001) and client port (5173).

## Deploy

Authenticate to the container registry before pushing. Replace the image name
with a registry/repository where you have permission:

```sh
export IMAGE=ghcr.io/your-org/triad-chess-game
export TAG=0.1.0
docker build --tag "$IMAGE:$TAG" .
docker push "$IMAGE:$TAG"
```

Or use the Make target (the variables are intentionally overridable):

```sh
make deploy IMAGE=ghcr.io/your-org/triad-chess-game TAG=0.1.0
```

Deploy the pushed image to the target container service with `PORT=3001`,
`HOST=0.0.0.0`, the public API/WebSocket URLs, and a production CORS origin.
Provide any remote AI key through the service's secret manager rather than a
Dockerfile argument or committed file.

## Troubleshooting

### `npm ci` reports a lockfile or workspace mismatch

Use Node 20.18.1 and npm 10, remove an old install, and retry:

```sh
nvm use
rm -rf node_modules packages/*/node_modules
npm ci
```

Do not use `npm install` to “fix” a clean build without reviewing the resulting
lockfile; the lockfile is part of the reproducible source tree.

### `npm run typecheck` cannot find a workspace or project configuration

Confirm that `packages/engine`, `packages/client`, and `packages/server` each
contain their workspace `package.json` and `tsconfig.json`. Run
`npm run build` after restoring a partial checkout. The root command delegates
to the workspace typecheck scripts so each package can keep its Node or browser
module-resolution settings.

### Port 3001 or 5173 is already in use

Change `PORT`/`CLIENT_PORT` and the corresponding `PUBLIC_*`, `VITE_*`, and
`CORS_ORIGIN` values in `.env`. For Docker, change the host side of the port
mapping, for example `--publish 13001:3001`.

### The browser connects but moves are rejected

Refresh the room snapshot first. A stale revision, wrong active seat, or an
eliminated seat is intentionally rejected by the authoritative server. Check
that the browser's `PUBLIC_API_URL`/`PUBLIC_WS_URL` point to the same host and
port exposed by the server and that `CORS_ORIGIN` matches the actual client
origin.

### Docker starts and exits immediately

Inspect the server logs:

```sh
docker run --rm --env-file .env \
  --publish 3001:3001 --publish 5173:5173 \
  triad-chess-game:local
```

The root `start` script delegates to `@triad-chess/server`; verify that the
server workspace has a production `start` script and that its built output was
created by `npm run build`.

### Tests fail without internet access

The test command is offline by design, but dependencies must already be in the
npm cache or installed by `npm ci`. Run `npm ci` once while connected, then
rerun `make test`; the test process itself does not call external services.

## Future features

The workspace boundaries leave room for the following without moving game
rules into the UI:

- Persistent rooms, authenticated accounts, matchmaking, ratings, and server
  horizontal scaling with a shared event store.
- Spectator mode, public/private room discovery, invite links, reconnection
  grace periods, and replay/export of the JSON event stream.
- Per-seat clocks, time controls, rematches, tournament brackets, and richer
  draw/claim rules.
- Stronger AI search, opening books, analysis mode, configurable variants,
  difficulty telemetry, and remote provider adapters with safe fallbacks.
- Accessibility improvements (keyboard/controller navigation, screen-reader
  move descriptions, color-safe themes), mobile layout, localization, and
  offline single-player packaging.
- CI build matrices, contract tests for transport messages, load tests for
  rooms, and production observability/metrics.

## License and contribution notes

Keep changes scoped to the owning workspace. Add or update engine rules first,
then expose them through server actions/events, and finally render them in the
client. Run `npm run typecheck`, `npm test`, and `npm run build` before opening
a change for review.
