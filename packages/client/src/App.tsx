import { useMemo, useState, type CSSProperties } from 'react';
import { BoardCanvas } from './board/BoardCanvas';
import { useGameSession } from './hooks/useGameSession';
import type { Difficulty, MoveView, SeatConfig, SeatId, SessionConfig, SessionMode } from './types';
import { DEFAULT_SEATS, PLAYER_META, SEATS } from './types';

function cloneSeats(): Record<SeatId, SeatConfig> {
  return {
    P0: { ...DEFAULT_SEATS.P0 },
    P1: { ...DEFAULT_SEATS.P1 },
    P2: { ...DEFAULT_SEATS.P2 },
  };
}

export default function App(): JSX.Element {
  const session = useGameSession();
  if (!session.mode) return <SetupScreen onStartLocal={session.startLocal} onStartOnline={session.startOnline} error={session.error} onClearError={session.clearError} />;
  if (!session.game || !session.board) {
    return (
      <div className="app-shell">
        <TopBar mode={session.mode} room={session.room.code} onLeave={session.leave} />
        <main className="waiting-layout">
          <div className="waiting-card card-surface">
            <div className="waiting-orbit" aria-hidden="true"><span /><span /><span /></div>
            <p className="eyebrow">ONLINE TABLE</p>
            <h1>{session.room.code ? `Room ${session.room.code}` : 'Setting up your room'}</h1>
            <p className="muted">{session.notice || session.room.message || 'Waiting for the game state…'}</p>
            <div className={`connection-line ${session.room.connected ? 'is-connected' : ''}`}>
              <span className="connection-dot" />
              {session.room.connected ? 'Connected to the game server' : 'Connecting to the game server'}
            </div>
            {session.error && <ErrorBanner message={session.error} onDismiss={session.clearError} />}
            <button className="button button-quiet" onClick={session.leave}>Back to setup</button>
          </div>
        </main>
      </div>
    );
  }
  return <GameScreen session={session} />;
}

interface SetupProps {
  onStartLocal: (seats: Record<SeatId, SeatConfig>) => void;
  onStartOnline: (config: SessionConfig, intent: 'create' | 'join') => void;
  error: string | null;
  onClearError: () => void;
}

function SetupScreen({ onStartLocal, onStartOnline, error, onClearError }: SetupProps): JSX.Element {
  const [mode, setMode] = useState<SessionMode>('local');
  const [seats, setSeats] = useState<Record<SeatId, SeatConfig>>(cloneSeats);
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const updateSeat = (seat: SeatId, patch: Partial<SeatConfig>) => {
    setSeats((current) => ({ ...current, [seat]: { ...current[seat], ...patch } }));
  };

  return (
    <div className="app-shell setup-shell">
      <header className="topbar setup-topbar">
        <Brand />
        <div className="topbar-note"><span className="online-dot" /> Strategy for three</div>
      </header>
      <main className="setup-layout">
        <section className="setup-hero">
          <div className="hero-badge"><span className="hero-badge-glyph">✦</span> THREE SIDES. ONE BOARD.</div>
          <h1>Make your move<br /><em>from every angle.</em></h1>
          <p className="hero-copy">Triad Chess is a tactical three-player battle where every line opens a new threat. Play locally with adaptive bots or invite your table online.</p>
          <div className="hero-rings" aria-hidden="true"><span className="ring ring-one" /><span className="ring ring-two" /><span className="ring ring-three" /><span className="ring-core">3</span></div>
          <div className="feature-row"><span><b>01</b> Plan in hexes</span><span><b>02</b> Watch two fronts</span><span><b>03</b> Own the center</span></div>
        </section>
        <section className="setup-card card-surface" aria-labelledby="setup-title">
          <div className="setup-card-heading">
            <div><p className="eyebrow">NEW TABLE</p><h2 id="setup-title">Choose your arena</h2></div>
            <div className="mode-switch" role="tablist" aria-label="Game mode">
              <button className={mode === 'local' ? 'mode-tab is-active' : 'mode-tab'} onClick={() => setMode('local')} role="tab" aria-selected={mode === 'local'}>Local</button>
              <button className={mode === 'online' ? 'mode-tab is-active' : 'mode-tab'} onClick={() => setMode('online')} role="tab" aria-selected={mode === 'online'}>Online</button>
            </div>
          </div>

          {mode === 'local' ? (
            <>
              <p className="section-help">Set each seat to a human or bot. You can change your strategy between rounds.</p>
              <div className="seat-list">
                {SEATS.map((seat) => <SeatSetupRow key={seat} seat={seat} config={seats[seat]} onChange={(patch) => updateSeat(seat, patch)} />)}
              </div>
              <button className="button button-primary button-wide" onClick={() => onStartLocal(seats)}><span>Start local game</span><span className="button-arrow">↗</span></button>
              <p className="fine-print"><span className="kbd">SPACE</span> You can pause a local table at any time.</p>
            </>
          ) : (
            <>
              <p className="section-help">Create a room for friends or join a table with a room code. The server URL is set by <code>VITE_SERVER_URL</code>.</p>
              <label className="field-label" htmlFor="display-name">Display name</label>
              <input id="display-name" className="text-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your table name" maxLength={24} />
              <label className="field-label" htmlFor="room-code">Room code <span className="optional">for joining</span></label>
              <input id="room-code" className="text-input code-input" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="E.G. 7KQ4" maxLength={12} />
              <div className="online-actions">
                <button className="button button-primary" onClick={() => onStartOnline({ mode: 'online', seats: onlineSeats(), displayName }, 'create')}>Create room <span className="button-arrow">↗</span></button>
                <button className="button button-outline" disabled={!roomCode.trim()} onClick={() => onStartOnline({ mode: 'online', seats: onlineSeats(), displayName, roomCode: roomCode.trim() }, 'join')}>Join room</button>
              </div>
              <div className="secure-note"><span className="secure-icon">⌁</span><span>Room state is authoritative on the connected game server.</span></div>
            </>
          )}
          {error && <ErrorBanner message={error} onDismiss={onClearError} />}
        </section>
      </main>
      <footer className="setup-footer"><span>TRIAD CHESS <small>v0.1</small></span><span>Built for deliberate players</span></footer>
    </div>
  );
}

function onlineSeats(): Record<SeatId, SeatConfig> {
  return {
    P0: { id: 'P0', name: 'You', kind: 'human' },
    P1: { id: 'P1', name: 'Opponent 1', kind: 'human' },
    P2: { id: 'P2', name: 'Opponent 2', kind: 'human' },
  };
}

function SeatSetupRow({ seat, config, onChange }: { seat: SeatId; config: SeatConfig; onChange: (patch: Partial<SeatConfig>) => void }): JSX.Element {
  const meta = PLAYER_META[seat];
  return (
    <div className="seat-setup-row">
      <span className="seat-swatch" style={{ background: meta.color, color: '#07101f' }}>{meta.short}</span>
      <div className="seat-setup-name"><strong>{meta.label}</strong><span>{seat === 'P0' ? 'Your seat' : `Seat ${seat.slice(1)}`}</span></div>
      <select className="select-input seat-kind" value={config.kind} onChange={(event) => onChange({ kind: event.target.value as 'human' | 'bot' })} aria-label={`${meta.label} controller`}>
        <option value="human">Human</option>
        <option value="bot">Bot</option>
      </select>
      {config.kind === 'bot' && <select className="select-input bot-level" value={config.difficulty ?? 'medium'} onChange={(event) => onChange({ difficulty: event.target.value as Difficulty })} aria-label={`${meta.label} bot difficulty`}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>}
    </div>
  );
}

interface SessionViewProps {
  mode: SessionMode | null;
  config: SessionConfig | null;
  game: NonNullable<ReturnType<typeof useGameSession>['game']>;
  board: NonNullable<ReturnType<typeof useGameSession>['board']>;
  room: ReturnType<typeof useGameSession>['room'];
  error: string | null;
  notice: string | null;
  isThinking: boolean;
  selectPosition: (key: string) => void;
  leave: () => void;
  clearError: () => void;
}

function GameScreen({ session }: { session: ReturnType<typeof useGameSession> }): JSX.Element {
  const { game, board } = session;
  if (!game || !board) return <></>;
  const current = game.currentPlayer;
  const currentConfig = session.config?.seats[current];
  const status = game.winner
    ? `${PLAYER_META[game.winner].label} wins the table`
    : game.inCheck.includes(current)
      ? `${PLAYER_META[current].label} is in check`
      : session.isThinking
        ? `${PLAYER_META[current].label} is thinking…`
        : `${PLAYER_META[current].label} to move`;
  const piecesBySeat = useMemo(() => SEATS.reduce<Record<SeatId, number>>((counts, seat) => {
    counts[seat] = game.pieces.filter((piece) => piece.player === seat && !piece.captured).length;
    return counts;
  }, { P0: 0, P1: 0, P2: 0 }), [game.pieces]);

  return (
    <div className="app-shell game-shell">
      <TopBar mode={session.mode ?? 'local'} room={session.room.code} connected={session.room.connected} onLeave={session.leave} />
      <main className="game-layout">
        <section className="board-column">
          <div className="game-heading-row">
            <div><p className="eyebrow">LIVE TABLE <span className="live-pip" /></p><h1>Hold the center.</h1></div>
            <div className="turn-pill" style={{ '--turn-color': PLAYER_META[current].color } as CSSProperties}><span className="turn-pip" />{status}</div>
          </div>
          {session.error && <ErrorBanner message={session.error} onDismiss={session.clearError} />}
          {session.notice && !session.error && <div className="notice-banner"><span>✦</span>{session.notice}</div>}
          <div className="board-frame card-surface">
            <BoardCanvas model={board} onPositionClick={session.selectPosition} />
            <div className="board-legend"><span><i className="legend-dot legal" /> Legal move</span><span><i className="legend-dot selected" /> Selected</span><span className="board-coordinate-note">{session.mode === 'online' ? (session.room.connected ? 'SYNCED' : 'OFFLINE') : 'LOCAL TABLE'}</span></div>
          </div>
          <div className="board-bottom-row">
            <div className="turn-explainer"><span className="turn-icon" style={{ background: PLAYER_META[current].soft, color: PLAYER_META[current].color }}>↯</span><span><b>{game.inCheck.includes(current) ? 'Defend your leader.' : 'Your turn, read the lines.'}</b><small>{currentConfig?.kind === 'bot' ? 'The bot is calculating a route.' : 'Select a piece, then choose a highlighted hex.'}</small></span></div>
            <div className="online-room-chip">{session.mode === 'online' ? <><span className="connection-dot" /> Room {session.room.code || '—'}</> : <><span className="local-chip-icon">⌂</span> Local practice</>}</div>
          </div>
        </section>
        <aside className="side-column">
          <section className="side-section player-section"><div className="side-heading"><p className="eyebrow">THE THREE SEATS</p><span className="small-muted">{game.pieces.length} pieces</span></div><div className="player-list">{SEATS.map((seat) => <PlayerCard key={seat} seat={seat} config={session.config?.seats[seat]} count={piecesBySeat[seat]} current={seat === current} check={game.inCheck.includes(seat)} eliminated={game.eliminated.includes(seat)} winner={game.winner === seat} />)}</div></section>
          <section className="side-section moves-section"><div className="side-heading"><p className="eyebrow">MOVE LOG</p><span className="small-muted">{game.history.length} turns</span></div><div className="move-log" aria-live="polite">{game.history.length === 0 ? <div className="empty-log"><span>◌</span><p>No moves yet.<br /><small>The first line is yours to shape.</small></p></div> : game.history.slice().reverse().map((entry, index) => <MoveRow key={entry.key} entry={entry} index={game.history.length - index} />)}</div></section>
          <section className="side-section quick-section"><p className="eyebrow">TABLE TOOLS</p><div className="quick-actions">{session.mode === 'online' && <button className="tool-button" onClick={() => navigator.clipboard?.writeText(session.room.code).catch(() => undefined)}><span>⌘</span> Copy room code</button>}<button className="tool-button" onClick={session.leave}><span>↩</span> Leave table</button></div></section>
        </aside>
      </main>
      <footer className="game-footer"><span>TRIAD CHESS / {session.mode === 'online' ? 'ONLINE ROOM' : 'LOCAL PRACTICE'}</span><span>Every move changes the shape of the board.</span></footer>
    </div>
  );
}

function TopBar({ mode, room, connected, onLeave }: { mode: SessionMode; room?: string; connected?: boolean; onLeave: () => void }): JSX.Element {
  return <header className="topbar"><Brand /><div className="topbar-actions"><span className={`mode-chip ${mode === 'online' ? 'online' : ''}`}><span className="online-dot" />{mode === 'online' ? (connected ? 'Online' : 'Connecting') : 'Local'}</span>{room && <span className="room-label">ROOM <b>{room}</b></span>}<button className="icon-button" onClick={onLeave} aria-label="Leave table" title="Leave table">×</button></div></header>;
}

function Brand(): JSX.Element {
  return <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>TRIAD <b>CHESS</b></span></div>;
}

function PlayerCard({ seat, config, count, current, check, eliminated, winner }: { seat: SeatId; config?: SeatConfig; count: number; current: boolean; check: boolean; eliminated: boolean; winner: boolean }): JSX.Element {
  const meta = PLAYER_META[seat];
  return <div className={`player-card ${current ? 'is-current' : ''} ${eliminated ? 'is-eliminated' : ''}`} style={{ '--player-color': meta.color, '--player-soft': meta.soft } as CSSProperties}><div className="player-avatar">{meta.short}</div><div className="player-identity"><strong>{config?.name || meta.label}</strong><span>{config?.kind === 'bot' ? `${(config.difficulty ?? 'medium').replace(/^./, (letter) => letter.toUpperCase())} bot` : 'Human'} · {seat}</span></div><div className="player-status">{winner ? <span className="winner-label">WIN</span> : eliminated ? <span className="eliminated-label">OUT</span> : check ? <span className="check-label">CHECK</span> : current ? <span className="active-label">TURN</span> : <span className="piece-count">{count}</span>}</div></div>;
}

function MoveRow({ entry, index }: { entry: MoveView; index: number }): JSX.Element {
  const seat = entry.player ?? 'P0';
  return <div className="move-row"><span className="move-number">{String(index).padStart(2, '0')}</span><span className="move-player" style={{ color: PLAYER_META[seat].color }}>{PLAYER_META[seat].short}</span><span className="move-label">{entry.label}</span>{entry.captureKey && <span className="capture-mark">×</span>}</div>;
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }): JSX.Element {
  return <div className="error-banner" role="alert"><span className="error-symbol">!</span><span>{message}</span><button onClick={onDismiss} aria-label="Dismiss error">×</button></div>;
}
