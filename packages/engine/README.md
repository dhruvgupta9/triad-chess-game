# @triad-chess/engine

Framework-independent Triad Chess rules for the client and server workspaces.
The package has no runtime dependencies and its test command runs offline:

```sh
npm test
```

## Coordinate model

The board is an axial hexagon of radius `7` (`169` cells). Positions in game
state are canonical strings such as `"0,-7"`; `parsePosition` and
`positionKey` validate and normalize them. `HEX_DIRECTIONS` contains the six
adjacent axial vectors. `axialToPixel` uses a pointy-top layout and accepts an
optional hex size.

Each player owns one of three rotated home edges. Every army has the standard
16 pieces (`rook`, `knight`, `bishop`, `queen`, `king`, and eight `pawn`s).
Pawns move toward the center from their own edge, can make a first double step,
capture on the two forward diagonals, and promote on the opposite edge.
Rooks slide on the six axial axes, bishops on the six long hex diagonals,
queens use both, kings step one cell, and knights use the six rotational
two-cell jumps.

## State and elimination

`createInitialGame` returns plain JSON data: pieces, a position index, player
status, turn rotation, move history, and fairness/coordination counters.
`applyMove` is immutable and throws a descriptive error for malformed, out of
turn, self-checking, blocked, or otherwise illegal moves.

Capturing a king or delivering checkmate eliminates that player. The default `eliminationMode` is
`"disappear"`, which removes all of the eliminated player's pieces. Set
`{ eliminationMode: "neutral" }` to keep those pieces on the board as inert,
neutral obstacles. Neutral pieces cannot move or be captured, and they stop
sliding pieces just like a physical blocker. The next turn skips eliminated
seats while preserving P0/P1/P2 rotation.

The optional fairness layer tracks the current material leader, leader-targeting
bonuses, and a rolling window of captures/checks. When two different seats
repeatedly pressure the same active seat, `coordination.focusTarget` and
`coordinatedAttacks` expose that focus-fire signal for UI, scoring, or future
matchmaking rules. Set `fairnessBonus: false` to disable leader-targeting
incentive counters, or tune `coordinationWindow` from 2 to 18 turns.

`getGameStatus` reports `playing`, `check`, `checkmate`, `stalemate`, or
`finished`; `isInCheck` and the legal move functions enforce king safety.
`getAiMove` provides capture-biased random Easy moves, shallow multi-player
minimax Medium moves, and bounded beam-search Hard moves. Hard evaluation
combines material, king safety, pseudo-mobility, rival pressure, leader-targeting
bonuses, and the coordinated-attack signal.
