import Phaser from 'phaser';
import { pixelFor, positionForKey, sectorFor } from '../engineAdapter';
import type { BoardModel, PieceView, SeatId } from '../types';
import { PLAYER_META } from '../types';

export interface BoardCallbacks {
  onPositionClick: (key: string) => void;
}

interface PixelPoint {
  x: number;
  y: number;
}

const BACKGROUND = 0x0d1428;
const BOARD_EDGE = 0x334466;
const CELL_BASE = 0x162441;
const CELL_DARK = 0x111c35;
const CELL_LIGHT = 0x1a2d4e;
// axialToPixel uses a unit hex radius, so preserve that scale when fitting the
// board; a smaller value would leave visible gaps between adjacent cells.
const CELL_RADIUS_RATIO = 0.9;

/** Phaser scene responsible only for the board surface; HUD state remains in React. */
export class HexBoardScene extends Phaser.Scene {
  private callbacks: BoardCallbacks;
  private model: BoardModel | null = null;
  private boardGraphics?: Phaser.GameObjects.Graphics;
  private pieceLayer?: Phaser.GameObjects.Container;
  private interactiveCells = new Map<string, Phaser.GameObjects.Zone>();
  private cellCenters = new Map<string, PixelPoint>();
  private pieceObjects = new Map<string, Phaser.GameObjects.Container>();
  private previousAnimationNonce = -1;
  private layout = { width: 900, height: 700, radius: 18, minX: -1, minY: -1, scale: 1 };

  constructor(callbacks: BoardCallbacks) {
    super({ key: 'triad-chess-board' });
    this.callbacks = callbacks;
  }

  create(): void {
    this.boardGraphics = this.add.graphics();
    this.pieceLayer = this.add.container(0, 0);
    this.scale.on('resize', this.handleResize, this);
    this.input.setTopOnly(true);
    this.redraw();
  }

  setModel(model: BoardModel): void {
    const animation = model.animation;
    const shouldAnimate = animation !== null && animation.nonce !== this.previousAnimationNonce;
    this.model = model;
    this.redraw();
    if (animation) this.previousAnimationNonce = animation.nonce;
    if (shouldAnimate && animation) this.playMoveAnimation(animation.fromKey, animation.toKey, animation.captureKey ?? null);
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layout.width = gameSize.width;
    this.layout.height = gameSize.height;
    this.redraw();
  }

  private calculateLayout(): void {
    const model = this.model;
    const width = Math.max(250, this.layout.width);
    const height = Math.max(240, this.layout.height);
    const points = (model?.boardKeys ?? []).map((key) => pixelFor(positionForKey(key))).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length === 0) {
      this.layout = { ...this.layout, width, height, radius: Math.min(width, height) / 14, minX: 0, minY: 0, scale: 1 };
      return;
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const usableWidth = Math.max(1, width - 40);
    const usableHeight = Math.max(1, height - 40);
    const sourceWidth = Math.max(1, maxX - minX);
    const sourceHeight = Math.max(1, maxY - minY);
    const scale = Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight);
    // A point-to-point axial spacing is sqrt(3) in the default engine projection.
    const radius = Math.max(9, Math.min(44, scale * CELL_RADIUS_RATIO));
    this.layout = { width, height, radius, minX, minY, scale };
  }

  private centerForKey(key: string): PixelPoint {
    const base = pixelFor(positionForKey(key));
    const { minX, minY, scale, width, height } = this.layout;
    const points = (this.model?.boardKeys ?? []).map((candidate) => pixelFor(positionForKey(candidate)));
    const maxX = points.length > 0 ? Math.max(...points.map((point) => point.x)) : minX + 1;
    const maxY = points.length > 0 ? Math.max(...points.map((point) => point.y)) : minY + 1;
    const drawnWidth = (maxX - minX) * scale;
    const drawnHeight = (maxY - minY) * scale;
    return {
      x: width / 2 - drawnWidth / 2 + (base.x - minX) * scale,
      y: height / 2 - drawnHeight / 2 + (base.y - minY) * scale,
    };
  }

  private hexPoints(center: PixelPoint, radius = this.layout.radius): number[] {
    const points: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI / 180) * (60 * index - 30);
      points.push(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    }
    return points;
  }

  private sectorTint(sector: string): number {
    const normalized = sector.toLowerCase();
    if (normalized.includes('p0') || normalized.includes('0') || normalized.includes('blue') || normalized.includes('cobalt')) return 0x214873;
    if (normalized.includes('p1') || normalized.includes('1') || normalized.includes('amber') || normalized.includes('yellow')) return 0x4c4021;
    if (normalized.includes('p2') || normalized.includes('2') || normalized.includes('violet') || normalized.includes('purple')) return 0x432e5d;
    return CELL_BASE;
  }

  private redraw(): void {
    if (!this.boardGraphics || !this.pieceLayer) return;
    this.calculateLayout();
    this.cellCenters.clear();
    this.boardGraphics.clear();
    this.interactiveCells.forEach((zone) => zone.destroy());
    this.interactiveCells.clear();
    this.pieceLayer.removeAll(true);
    this.pieceObjects.clear();
    const model = this.model;
    if (!model) return;

    this.boardGraphics.fillStyle(BACKGROUND, 1);
    this.boardGraphics.fillRect(0, 0, this.layout.width, this.layout.height);
    this.boardGraphics.lineStyle(1, BOARD_EDGE, 0.32);

    model.boardKeys.forEach((key, index) => {
      const center = this.centerForKey(key);
      this.cellCenters.set(key, center);
      const sector = sectorFor(positionForKey(key));
      const isSelected = model.selectedKey === key;
      const isLegal = model.legalMoveKeys.includes(key);
      const parity = index % 2 === 0 ? CELL_LIGHT : CELL_DARK;
      const fill = isSelected ? 0x285a7c : isLegal ? 0x1c574e : this.sectorTint(sector) || parity;
      const points = this.hexPoints(center);
      this.boardGraphics?.fillStyle(fill, 1);
      this.boardGraphics?.fillPoints(pointsToPairs(points), true);
      this.boardGraphics?.strokePoints(pointsToPairs(points), true);
      if (isLegal) {
        this.boardGraphics?.lineStyle(3, 0x5ee5bd, 0.95);
        this.boardGraphics?.strokePoints(pointsToPairs(this.hexPoints(center, this.layout.radius * 0.78)), true);
        this.boardGraphics?.fillStyle(0x5ee5bd, 0.72);
        this.boardGraphics?.fillCircle(center.x, center.y, Math.max(3, this.layout.radius * 0.13));
        this.boardGraphics?.lineStyle(1, BOARD_EDGE, 0.32);
      }
      if (isSelected) {
        this.boardGraphics?.lineStyle(3, 0xc9f2ff, 1);
        this.boardGraphics?.strokePoints(pointsToPairs(this.hexPoints(center, this.layout.radius * 0.9)), true);
        this.boardGraphics?.lineStyle(1, BOARD_EDGE, 0.32);
      }
      if (model.winner) {
        this.boardGraphics?.lineStyle(2, 0xf4d98b, 0.35);
        this.boardGraphics?.strokePoints(pointsToPairs(this.hexPoints(center, this.layout.radius * 0.96)), true);
        this.boardGraphics?.lineStyle(1, BOARD_EDGE, 0.32);
      }
      const zone = this.add.zone(center.x, center.y, this.layout.radius * 1.75, this.layout.radius * 1.75);
      zone.setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.callbacks.onPositionClick(key));
      zone.on('pointerover', () => this.drawHover(key, true));
      zone.on('pointerout', () => this.drawHover(key, false));
      this.interactiveCells.set(key, zone);
    });

    model.pieces.filter((piece) => !piece.captured).forEach((piece) => this.drawPiece(piece));
  }

  private drawHover(key: string, active: boolean): void {
    if (!this.boardGraphics || !this.model || this.model.selectedKey === key || this.model.legalMoveKeys.includes(key)) return;
    const center = this.cellCenters.get(key);
    if (!center) return;
    if (active) {
      this.boardGraphics.lineStyle(2, 0x9bb7d8, 0.64);
      this.boardGraphics.strokePoints(pointsToPairs(this.hexPoints(center, this.layout.radius * 0.88)), true);
    } else {
      this.redraw();
    }
  }

  private drawPiece(piece: PieceView): void {
    const center = this.cellCenters.get(piece.key);
    if (!center || !this.pieceLayer) return;
    const meta = PLAYER_META[piece.player];
    const radius = Math.max(8, this.layout.radius * 0.58);
    const token = this.add.container(center.x, center.y);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x050914, 0.62);
    shadow.fillCircle(2, 4, radius * 1.03);
    const disc = this.add.graphics();
    disc.fillStyle(colorNumber(meta.color), 1);
    disc.fillCircle(0, 0, radius);
    disc.lineStyle(2, 0xf4f7ff, 0.82);
    disc.strokeCircle(0, 0, radius);
    const inner = this.add.graphics();
    inner.lineStyle(1, 0x081020, 0.55);
    inner.strokeCircle(0, 0, radius * 0.72);
    const glyph = pieceGlyph(piece.type);
    const text = this.add.text(0, 0, glyph, {
      color: '#081020',
      fontFamily: 'Inter, ui-sans-serif, sans-serif',
      fontSize: `${Math.max(10, radius * 0.8)}px`,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    token.add([shadow, disc, inner, text]);
    token.setSize(radius * 2, radius * 2);
    token.setInteractive({ useHandCursor: true });
    token.on('pointerdown', () => this.callbacks.onPositionClick(piece.key));
    this.pieceLayer.add(token);
    this.pieceObjects.set(piece.id, token);
  }

  private playMoveAnimation(fromKey: string, toKey: string, captureKey: string | null): void {
    const from = this.cellCenters.get(fromKey);
    const to = this.cellCenters.get(toKey);
    if (!from || !to || !this.pieceLayer) return;
    const moving = this.add.graphics();
    moving.fillStyle(0xe8f5ff, 1);
    moving.fillCircle(0, 0, Math.max(7, this.layout.radius * 0.42));
    moving.lineStyle(2, 0xffffff, 0.9);
    moving.strokeCircle(0, 0, Math.max(7, this.layout.radius * 0.42));
    moving.setPosition(from.x, from.y);
    this.pieceLayer.add(moving);
    if (captureKey) {
      const captured = this.cellCenters.get(captureKey);
      if (captured) {
        const flash = this.add.circle(captured.x, captured.y, this.layout.radius * 0.54, 0xff6d76, 0.75);
        this.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 260, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
      }
    }
    this.tweens.add({
      targets: moving,
      x: to.x,
      y: to.y,
      duration: 300,
      ease: 'Cubic.easeInOut',
      onComplete: () => moving.destroy(),
    });
  }
}

function pointsToPairs(points: number[]): Phaser.Geom.Point[] {
  const output: Phaser.Geom.Point[] = [];
  for (let index = 0; index < points.length; index += 2) output.push(new Phaser.Geom.Point(points[index], points[index + 1]));
  return output;
}

function colorNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

function pieceGlyph(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('king') || normalized.includes('leader')) return '♛';
  if (normalized.includes('queen')) return '♕';
  if (normalized.includes('knight') || normalized.includes('horse')) return '♞';
  if (normalized.includes('bishop')) return '♝';
  if (normalized.includes('rook') || normalized.includes('tower')) return '♜';
  if (normalized.includes('pawn') || normalized.includes('soldier')) return '♟';
  return '◆';
}
