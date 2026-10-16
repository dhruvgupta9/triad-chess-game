import { getAiMove, type GameState, type AiDifficulty } from '@triad-chess/engine';

// A dedicated worker keeps the board and pause/leave controls responsive during search.
self.onmessage = (event: MessageEvent<{ state: GameState; difficulty: AiDifficulty }>) => {
  try {
    self.postMessage({ move: getAiMove(event.data.state, event.data.difficulty) });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'Bot search failed.' });
  }
};
