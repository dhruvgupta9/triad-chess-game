import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { HexBoardScene } from './HexBoardScene';
import type { BoardModel } from '../types';

interface BoardCanvasProps {
  model: BoardModel;
  onPositionClick: (key: string) => void;
}

export function BoardCanvas({ model, onPositionClick }: BoardCanvasProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HexBoardScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const callbackRef = useRef(onPositionClick);
  callbackRef.current = onPositionClick;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new HexBoardScene({ onPositionClick: (key) => callbackRef.current(key) });
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      backgroundColor: '#0d1428',
      transparent: false,
      scene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: host.clientWidth || 720,
        height: host.clientHeight || 640,
      },
      render: {
        antialias: true,
        roundPixels: false,
      },
    });
    gameRef.current = game;

    const resizeObserver = new ResizeObserver(() => {
      if (!host || !game.isRunning) return;
      game.scale.resize(host.clientWidth || 720, host.clientHeight || 640);
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setModel(model);
  }, [model]);

  return <div className="board-canvas" ref={hostRef} aria-label="Triad Chess board" role="application" />;
}
