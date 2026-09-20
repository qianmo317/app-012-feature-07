import { GameCanvas } from '../renderer/canvas';
import { CabinetRenderer } from '../renderer/cabinet';
import { ScaleRenderer } from '../renderer/scale';
import { UIRenderer } from '../renderer/ui';
import { GameManager, type OrganizeAction } from './state';
import { getHerbByName } from '../herbs';
import { resumeAudio, playDrawerSound, playDropSound, playPointerSound, playErrorSound, playSuccessSound } from '../audio/synth';

export class ApothecaryGame {
  canvas: GameCanvas;
  cabinet: CabinetRenderer;
  scale: ScaleRenderer;
  ui: UIRenderer;
  game: GameManager;
  animId = 0;
  mouseX = 0;
  mouseY = 0;

  constructor(canvasId: string) {
    this.canvas = new GameCanvas(canvasId);
    this.cabinet = new CabinetRenderer();
    this.scale = new ScaleRenderer();
    this.ui = new UIRenderer();
    this.game = new GameManager();
    this.setupInput();
    this.resize();
    this.loop = this.loop.bind(this);
  }

  resize(): void {
    this.canvas.resize();
    this.cabinet.layout(this.canvas.width, this.canvas.height);
    this.scale.layout(this.canvas.width, this.canvas.height);
    this.ui.layout(this.canvas.width, this.canvas.height);
  }

  start(): void {
    document.getElementById('loading')!.style.display = 'none';
    this.loop(performance.now());
  }

  loop(now: number): void {
    this.animId = requestAnimationFrame(this.loop);
    this.game.tick(now);
    this.scale.animate();
    this.render();
  }

  render(): void {
    const ctx = this.canvas.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.game.phase === 'menu') {
      this.renderMenu(ctx, w, h);
      return;
    }

    ctx.fillStyle = '#2d2418';
    ctx.fillRect(0, 0, w, h);

    this.cabinet.draw(ctx, this.game.cells, this.game.openDrawerIndex, this.game.flashIndex, this.game.organizeSource);
    this.scale.draw(ctx, this.game.currentWeight, this.game.zeroOffset);

    if (this.game.prescription) {
      this.ui.drawPrescription(ctx, this.game.prescription, this.game.weighed, this.game.currentHerb);
    }

    this.ui.drawStatus(ctx, this.game.state.level, this.game.state.score, this.game.state.combo, this.game.state.queue, this.game.state.satisfaction, this.game.getTimeLeft());
    this.ui.drawPackageArea(ctx, w, h, this.game.packages);
    this.ui.drawInstructions(ctx, w, h, this.game.phase, this.game.levelConfig.requireOrganize);

    if (this.game.levelConfig.requireOrganize) {
      this.cabinet.drawPanel(ctx, w, this.game.phase === 'organize' ? 'organize' : 'playing', this.game.getOrganizeProgress());
    }

    if (this.game.message) {
      this.cabinet.drawMessage(ctx, w, this.game.message);
    }

    if (this.game.levelConfig.requireTare) {
      this.ui.drawTareButton(ctx, this.scale.x + this.scale.w - 60, this.scale.y + this.scale.h + 10, false);
    }

    if (this.game.currentHerb) {
      const herbMeta = getHerbByName(this.game.currentHerb);
      if (herbMeta) {
        this.drawHerbPile(ctx, this.scale.x + this.scale.w / 2 - 20, this.scale.y + this.scale.h - 40, herbMeta.color, Math.min(40, this.game.currentWeight * 2));
      }
    }

    if (this.game.draggingHerb) {
      const herbMeta = getHerbByName(this.game.draggingHerb);
      if (herbMeta) {
        ctx.globalAlpha = 0.8;
        this.drawHerbPile(ctx, this.mouseX - 20, this.mouseY - 20, herbMeta.color, 30);
        ctx.globalAlpha = 1;
      }
    }

    if (this.game.phase === 'review') {
      if (this.game.reviewQuestion) {
        this.ui.drawReview(ctx, w, h, this.game.reviewQuestion.herb, this.game.reviewQuestion.options, this.game.reviewSelected, this.game.reviewResult);
      }
    } else if (this.game.phase === 'result') {
      this.ui.drawResult(ctx, w, h, this.game.state.score, this.game.state.level, this.game.results, this.game.results.every(r => r.ok));
    } else if (this.game.phase === 'gameover') {
      this.ui.drawGameOver(ctx, w, h, this.game.state.score, this.game.state.level);
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const save = loadSaveData();
    this.ui.drawMenu(ctx, w, h, save.highestScore, save.highestLevel);
  }

  drawHerbPile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, size: number): void {
    const particles = Math.max(5, Math.floor(size / 3));
    for (let i = 0; i < particles; i++) {
      const px = x + Math.random() * size - size / 2;
      const py = y + Math.random() * size / 2;
      const r = 2 + Math.random() * 3;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  setupInput(): void {
    const c = this.canvas.canvas;

    c.addEventListener('mousedown', e => {
      resumeAudio();
      const pos = this.canvas.getMousePos(e);
      this.handlePointerDown(pos.x, pos.y);
    });

    c.addEventListener('mousemove', e => {
      const pos = this.canvas.getMousePos(e);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this.handlePointerMove(pos.x, pos.y);
    });

    c.addEventListener('mouseup', () => {
      this.handlePointerUp();
    });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.game.phase === 'weighing') {
        const dir = e.deltaY > 0 ? 1 : -1;
        this.game.addWeight(dir * 0.5);
        playPointerSound();
      }
    }, { passive: false });

    c.addEventListener('touchstart', e => {
      resumeAudio();
      e.preventDefault();
      if (e.touches.length > 0) {
        const pos = this.canvas.getMousePos(e.touches[0]);
        this.handlePointerDown(pos.x, pos.y);
      }
    }, { passive: false });

    c.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length > 0) {
        const pos = this.canvas.getMousePos(e.touches[0]);
        this.mouseX = pos.x;
        this.mouseY = pos.y;
        this.handlePointerMove(pos.x, pos.y);
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this.handlePointerUp();
    });

    window.addEventListener('keydown', e => {
      this.handleKey(e.key);
    });
  }

  handlePointerDown(x: number, y: number): void {
    if (this.game.phase === 'menu') {
      const btn = this.ui.buttonRects.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (btn) {
        if (btn.action === 'start') {
          this.game.startLevel(1, false);
        } else if (btn.action === 'endless') {
          this.game.startLevel(1, true);
        }
      }
      return;
    }

    if (this.game.phase === 'review') {
      const btn = this.ui.buttonRects.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (btn && btn.action.startsWith('review-')) {
        const val = parseInt(btn.action.replace('review-', ''));
        const correct = this.game.answerReview(val);
        if (correct) playSuccessSound();
        else playErrorSound();
      }
      return;
    }

    if (this.game.phase === 'result' || this.game.phase === 'gameover') {
      const btn = this.ui.buttonRects.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (btn) {
        if (btn.action === 'next') {
          this.game.nextLevel();
        } else if (btn.action === 'retry') {
          this.game.retryLevel();
        } else if (btn.action === 'menu') {
          this.game.phase = 'menu';
        }
      }
      return;
    }

    if (this.game.phase === 'playing' || this.game.phase === 'organize') {
      const panelBtn = this.cabinet.getButtonAt(x, y);
      if (panelBtn) {
        if (panelBtn.action === 'organize') {
          this.game.enterOrganize();
          playPointerSound();
        } else if (panelBtn.action === 'exit-organize') {
          this.game.exitOrganize();
          playPointerSound();
        }
        return;
      }

      const drawer = this.cabinet.getDrawerAt(x, y, this.game.cells.length);
      if (drawer) {
        if (this.game.phase === 'organize') {
          this.handleOrganizeAction(this.game.organizeClick(drawer.index));
        } else {
          const result = this.game.selectDrawer(drawer.index);
          if (result.ok) playDrawerSound();
          else if (result.pull === 'scrambled') playErrorSound();
        }
      }
      return;
    }

    if (this.game.phase === 'weighing') {
      const sx = this.scale.x;
      const sy = this.scale.y + this.scale.h + 10;
      if (x >= sx && x <= sx + 40 && y >= sy && y <= sy + 32) {
        this.game.addWeight(1);
        playPointerSound();
        return;
      }
      if (x >= sx + 50 && x <= sx + 90 && y >= sy && y <= sy + 32) {
        this.game.addWeight(-1);
        playPointerSound();
        return;
      }
      if (x >= sx + 100 && x <= sx + 160 && y >= sy && y <= sy + 32) {
        this.game.tare();
        playPointerSound();
        return;
      }

      const scaleArea = { x: this.scale.x, y: this.scale.y, w: this.scale.w, h: this.scale.h };
      if (x >= scaleArea.x && x <= scaleArea.x + scaleArea.w && y >= scaleArea.y && y <= scaleArea.y + scaleArea.h) {
        this.game.draggingHerb = this.game.currentHerb;
      }
      return;
    }
  }

  private handleOrganizeAction(action: OrganizeAction): void {
    switch (action) {
      case 'restored':
      case 'done':
        playSuccessSound();
        break;
      case 'scrambled':
      case 'already-home':
      case 'wrong-target':
      case 'not-inspected':
        playErrorSound();
        break;
      default:
        playDrawerSound();
    }
  }

  handlePointerMove(x: number, y: number): void {
    this.cabinet.updateHover(x, y);
    if (this.game.phase === 'weighing' && this.game.draggingHerb) {
      const scaleArea = { x: this.scale.x, y: this.scale.y, w: this.scale.w, h: this.scale.h };
      this.game.onScale = x >= scaleArea.x && x <= scaleArea.x + scaleArea.w && y >= scaleArea.y && y <= scaleArea.y + scaleArea.h;
    }
  }

  handlePointerUp(): void {
    if (this.game.phase === 'weighing' && this.game.draggingHerb) {
      if (this.game.onScale) {
        this.game.currentWeight = Math.min(50, this.game.currentWeight + 5);
        playDropSound();
      }
      this.game.draggingHerb = null;
      this.game.onScale = false;
    }
  }

  handleKey(key: string): void {
    if (this.game.phase === 'menu') {
      if (key === 'Enter' || key === ' ') {
        this.game.startLevel(1, false);
      }
      return;
    }

    if (this.game.phase === 'organize') {
      if (key === 'Escape' || key === 'o' || key === 'O') {
        this.game.exitOrganize();
        playPointerSound();
      }
      return;
    }

    if (this.game.phase === 'playing') {
      if ((key === 'o' || key === 'O') && this.game.levelConfig.requireOrganize) {
        this.game.enterOrganize();
        playPointerSound();
        return;
      }
      const idx = parseInt(key);
      if (!isNaN(idx) && idx >= 1 && idx <= 9) {
        const drawers = this.cabinet.drawers.filter(d => d.index < this.game.cells.length);
        if (idx <= drawers.length) {
          const result = this.game.selectDrawer(drawers[idx - 1].index);
          if (result.ok) playDrawerSound();
          else if (result.pull === 'scrambled') playErrorSound();
        }
      }
      return;
    }

    if (this.game.phase === 'weighing') {
      if (key === ' ' || key === 'Enter') {
        const result = this.game.confirmWeight();
        if (result) {
          if (result.ok) {
            playSuccessSound();
          } else {
            playErrorSound();
          }
        }
      } else if (key === 'z' || key === 'Z') {
        this.game.tare();
        playPointerSound();
      } else if (key === 'ArrowUp' || key === 'ArrowRight') {
        this.game.addWeight(0.5);
        playPointerSound();
      } else if (key === 'ArrowDown' || key === 'ArrowLeft') {
        this.game.addWeight(-0.5);
        playPointerSound();
      }
      return;
    }

    if (this.game.phase === 'result') {
      if (key === 'Enter' || key === ' ') {
        const passed = this.game.results.every(r => r.ok);
        if (passed) {
          this.game.nextLevel();
        } else {
          this.game.retryLevel();
        }
      }
      return;
    }

    if (this.game.phase === 'gameover') {
      if (key === 'Enter' || key === ' ') {
        this.game.phase = 'menu';
      }
      return;
    }
  }
}

function loadSaveData(): { highestScore: number; highestLevel: number } {
  try {
    const raw = localStorage.getItem('apothecary-weighing-v1');
    if (raw) {
      const data = JSON.parse(raw);
      return { highestScore: data.highestScore ?? 0, highestLevel: data.highestLevel ?? 0 };
    }
  } catch {
    // ignore
  }
  return { highestScore: 0, highestLevel: 0 };
}
