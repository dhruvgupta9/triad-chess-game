import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameState, Move } from '@triad-chess/engine';
import {
  aiMove,
  allLegalMoves,
  applyEngineMove,
  currentPlayerOf,
  eliminatedOf,
  inCheckOf,
  legalMovesFor,
  makeInitialState,
  moveView,
  positionForKey,
  positionForMove,
  readBoardKeys,
  readHistory,
  readPieces,
  stateHasPieces,
  winnerOf,
} from '../engineAdapter';
import type {
  AnimationView,
  BoardModel,
  Difficulty,
  GameView,
  MoveView,
  RoomInfo,
  SeatConfig,
  SeatId,
  SessionConfig,
  SessionMode,
} from '../types';
import { DEFAULT_SEATS, PLAYER_META } from '../types';

interface UseGameSessionResult {
  mode: SessionMode | null;
  config: SessionConfig | null;
  game: GameView | null;
  board: BoardModel | null;
  selectedKey: string | null;
  room: RoomInfo;
  error: string | null;
  notice: string | null;
  isThinking: boolean;
  startLocal: (seats?: Record<SeatId, SeatConfig>) => void;
  startOnline: (config: SessionConfig, intent: 'create' | 'join') => void;
  selectPosition: (key: string) => void;
  leave: () => void;
  clearError: () => void;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function fallbackBoard(): string[] {
  const keys: string[] = [];
  for (let q = -7; q <= 7; q += 1) {
    for (let r = -7; r <= 7; r += 1) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= 7) keys.push(`${q},${r}`);
    }
  }
  return keys;
}

const BOARD_KEYS = readBoardKeys().length > 0 ? readBoardKeys() : fallbackBoard();

function copySeats(seats: Record<SeatId, SeatConfig>): Record<SeatId, SeatConfig> {
  return {
    P0: { ...seats.P0 },
    P1: { ...seats.P1 },
    P2: { ...seats.P2 },
  };
}

function payloadState(payload: unknown): GameState | null {
  if (!payload) return null;
  const source = payload as Record<string, unknown>;
  const candidates = [source.state, source.gameState, source.game, source.snapshot, payload];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && (stateHasPieces(candidate) || 'currentPlayer' in candidate || 'turn' in candidate || 'pieces' in candidate)) {
      return candidate as GameState;
    }
  }
  return null;
}

function roomCodeFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const value = source.roomCode ?? source.roomId ?? (source.message ? undefined : source.code) ?? source.id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatSeat(seat: SeatId): string {
  return PLAYER_META[seat].label;
}

export function useGameSession(): UseGameSessionResult {
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [animation, setAnimation] = useState<AnimationView | null>(null);
  const [manualHistory, setManualHistory] = useState<MoveView[]>([]);
  const [room, setRoom] = useState<RoomInfo>({ code: '', connected: false, message: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const animationNonce = useRef(0);
  const remoteMoveKey = useRef('');

  const game = useMemo<GameView | null>(() => {
    if (!state) return null;
    const pieces = readPieces(state);
    const rawHistory = readHistory(state);
    const history = rawHistory.length > 0 ? rawHistory : manualHistory;
    return {
      raw: state,
      currentPlayer: currentPlayerOf(state),
      pieces,
      legalMoves: allLegalMoves(state),
      history,
      eliminated: eliminatedOf(state),
      inCheck: inCheckOf(state),
      winner: winnerOf(state),
      boardKeys: BOARD_KEYS,
    };
  }, [manualHistory, state]);

  const selectedPiece = useMemo(() => game?.pieces.find((piece) => piece.key === selectedKey) ?? null, [game, selectedKey]);
  const selectedMoves = useMemo(() => {
    if (!game || !selectedKey || !selectedPiece) return [];
    const exact = legalMovesFor(game.raw, positionForKey(selectedKey) ?? selectedPiece.position, selectedPiece);
    if (exact.length > 0) return exact;
    return game.legalMoves.filter((candidate) => candidate.fromKey === selectedKey);
  }, [game, selectedKey, selectedPiece]);

  const board = useMemo<BoardModel | null>(() => {
    if (!game) return null;
    return {
      boardKeys: game.boardKeys,
      pieces: game.pieces,
      legalMoveKeys: selectedMoves.map((move) => move.toKey).filter((key): key is string => Boolean(key)),
      selectedKey,
      currentPlayer: game.currentPlayer,
      eliminated: game.eliminated,
      inCheck: game.inCheck,
      winner: game.winner,
      animation,
    };
  }, [animation, game, selectedKey, selectedMoves]);

  const closeSocket = useCallback(() => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const setRemoteState = useCallback((payload: unknown) => {
    const next = payloadState(payload);
    if (!next) return false;
    setState(next);
    setSelectedKey(null);
    const lastMove = (next as unknown as Record<string, unknown>).lastMove as Move | null | undefined;
    if (lastMove) {
      const fields = positionForMove(lastMove);
      const signature = `${fields.fromKey ?? ''}>${fields.toKey ?? ''}`;
      if (fields.fromKey && fields.toKey && signature !== remoteMoveKey.current) {
        remoteMoveKey.current = signature;
        animationNonce.current += 1;
        setAnimation({ nonce: animationNonce.current, fromKey: fields.fromKey, toKey: fields.toKey, captureKey: fields.captureKey });
      }
    } else {
      setAnimation(null);
    }
    setNotice(null);
    return true;
  }, []);

  const commitLocalMove = useCallback((move: Move, sourceState: GameState, actor: SeatId) => {
    try {
      const next = applyEngineMove(sourceState, move);
      const moveInfo = moveView(move, manualHistory.length);
      const { fromKey, toKey, captureKey } = positionForMove(move);
      animationNonce.current += 1;
      setAnimation({ nonce: animationNonce.current, fromKey: fromKey ?? '', toKey: toKey ?? '', captureKey });
      setManualHistory((history) => [...history, { ...moveInfo, player: moveInfo.player ?? actor }]);
      setState(next);
      setSelectedKey(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That move could not be applied.');
    }
  }, [manualHistory.length]);

  const sendOnlineMove = useCallback((move: Move) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setError('The room connection is not ready yet.');
      return;
    }
    const code = room.code || config?.roomCode || '';
    socket.emit('game:move', { roomCode: code, roomId: code, move }, (response: { ok?: boolean; error?: { message?: string } }) => {
      if (response?.ok === false) setError(response.error?.message || 'The server rejected that move.');
    });
    setSelectedKey(null);
    setNotice('Move sent — waiting for the room to confirm it.');
  }, [config?.roomCode, room.code]);

  const chooseMove = useCallback((move: Move) => {
    if (!state || !config || !game) return;
    if (mode === 'online') {
      sendOnlineMove(move);
      return;
    }
    commitLocalMove(move, state, game.currentPlayer);
  }, [commitLocalMove, config, game, mode, sendOnlineMove, state]);

  const selectPosition = useCallback((key: string) => {
    if (!game || !config || game.winner || game.eliminated.includes(game.currentPlayer)) return;
    const currentSeatConfig = config.seats[game.currentPlayer];
    if (currentSeatConfig?.kind !== 'human') {
      setNotice(`${formatSeat(game.currentPlayer)} is controlled by the ${currentSeatConfig?.difficulty ?? 'AI'} bot.`);
      return;
    }
    const targetMove = selectedMoves.find((move) => move.toKey === key);
    if (targetMove) {
      chooseMove(targetMove.move);
      return;
    }
    const piece = game.pieces.find((candidate) => candidate.key === key && candidate.player === game.currentPlayer && !candidate.captured);
    if (piece) {
      const moves = legalMovesFor(game.raw, piece.position, piece);
      setSelectedKey(key);
      setNotice(moves.length > 0 ? 'Choose a highlighted destination.' : 'That piece has no legal moves right now.');
      return;
    }
    setSelectedKey(null);
  }, [chooseMove, config, game, selectedMoves]);

  const startLocal = useCallback((seats: Record<SeatId, SeatConfig> = DEFAULT_SEATS) => {
    closeSocket();
    try {
      const initial = makeInitialState();
      setMode('local');
      setConfig({ mode: 'local', seats: copySeats(seats) });
      setState(initial);
      setSelectedKey(null);
      setManualHistory([]);
      setAnimation(null);
      remoteMoveKey.current = '';
      setRoom({ code: '', connected: true, message: 'Local table' });
      setError(null);
      setNotice('Your table is ready. Select a piece to see its legal moves.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The opening position could not be created.');
    }
  }, [closeSocket]);

  const startOnline = useCallback((nextConfig: SessionConfig, intent: 'create' | 'join') => {
    closeSocket();
    setMode('online');
    setConfig({ ...nextConfig, seats: copySeats(nextConfig.seats) });
    setState(null);
    setSelectedKey(null);
    setManualHistory([]);
    setAnimation(null);
    remoteMoveKey.current = '';
    setError(null);
    setNotice(intent === 'create' ? 'Creating your room…' : 'Joining the room…');
    setRoom({ code: nextConfig.roomCode ?? '', connected: false, message: 'Connecting…' });

    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'], autoConnect: false });
    socketRef.current = socket;
    socket.on('connect', () => {
      setRoom((current) => ({ ...current, connected: true, message: 'Connected' }));
      if (intent === 'create') {
        socket.emit('room:create', { displayName: nextConfig.displayName || 'Player', seats: nextConfig.seats });
      } else {
        socket.emit('room:join', { roomCode: nextConfig.roomCode, roomId: nextConfig.roomCode, displayName: nextConfig.displayName || 'Player' });
      }
    });
    socket.on('connect_error', () => {
      setRoom((current) => ({ ...current, connected: false, message: 'Connection failed' }));
      setError(`Could not reach the game server at ${SERVER_URL}.`);
    });
    socket.on('disconnect', () => setRoom((current) => ({ ...current, connected: false, message: 'Disconnected' })));
    socket.onAny((event: string, payload: unknown) => {
      const receivedCode = roomCodeFrom(payload);
      if (receivedCode) setRoom((current) => ({ ...current, code: receivedCode }));
      if (event === 'room:error' || event === 'server:error' || event === 'error') {
        const message = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).message === 'string'
          ? String((payload as Record<string, unknown>).message)
          : 'The room could not complete that request.';
        setError(message);
        return;
      }
      if (event === 'room:created' || event === 'room:joined' || event === 'room:ready') {
        setNotice(event === 'room:created' ? 'Room created. Share the code with your opponents.' : 'Joined the room. Waiting for the game to start.');
      }
      if (['room:state', 'game:state', 'game:started', 'state', 'room:updated'].includes(event)) {
        if (setRemoteState(payload)) setNotice(null);
      }
      // A few lightweight servers send a state directly with a move acknowledgement.
      if (event === 'room:move' || event === 'game:move' || event === 'move') setRemoteState(payload);
    });
    socket.connect();
  }, [closeSocket, setRemoteState]);

  const leave = useCallback(() => {
    closeSocket();
    setMode(null);
    setConfig(null);
    setState(null);
    setSelectedKey(null);
    setAnimation(null);
    remoteMoveKey.current = '';
    setManualHistory([]);
    setRoom({ code: '', connected: false, message: '' });
    setError(null);
    setNotice(null);
  }, [closeSocket]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => () => closeSocket(), [closeSocket]);

  useEffect(() => {
    if (!state || !game || mode !== 'local' || !config || game.winner) return undefined;
    const seatConfig = config.seats[game.currentPlayer];
    if (!seatConfig || seatConfig.kind !== 'bot' || game.eliminated.includes(game.currentPlayer)) return undefined;
    setIsThinking(true);
    const difficulty = seatConfig.difficulty ?? ('medium' as Difficulty);
    const timer = window.setTimeout(() => {
      const move = aiMove(state, difficulty, game.currentPlayer);
      const fallback = move ?? game.legalMoves[0]?.move ?? null;
      if (fallback) commitLocalMove(fallback, state, game.currentPlayer);
      else setNotice(`${formatSeat(game.currentPlayer)} has no legal moves.`);
      setIsThinking(false);
    }, difficulty === 'hard' ? 620 : difficulty === 'medium' ? 470 : 300);
    return () => {
      window.clearTimeout(timer);
      setIsThinking(false);
    };
  }, [commitLocalMove, config, game, mode, state]);

  return {
    mode,
    config,
    game,
    board,
    selectedKey,
    room,
    error,
    notice,
    isThinking,
    startLocal,
    startOnline,
    selectPosition,
    leave,
    clearError,
  };
}
