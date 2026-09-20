import type { CabinetCell } from '../types';
import { getHerbByName } from '../herbs';

export interface DrawerRect {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
  open: number;
  hovered: boolean;
}

export interface PanelButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

export class CabinetRenderer {
  drawers: DrawerRect[] = [];
  panelButtons: PanelButton[] = [];
  private cols = 6;
  private rows = 6;
  private padding = 10;
  private drawerW = 80;
  private drawerH = 50;
  private panelY = 54;

  layout(canvasW: number, _canvasH: number): void {
    this.drawers = [];
    const startX = canvasW - this.cols * (this.drawerW + this.padding) - this.padding;
    const startY = this.padding + 100;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.drawers.push({
          x: startX + c * (this.drawerW + this.padding),
          y: startY + r * (this.drawerH + this.padding),
          w: this.drawerW,
          h: this.drawerH,
          index: r * this.cols + c,
          open: 0,
          hovered: false,
        });
      }
    }
  }

  updateHover(mx: number, my: number): void {
    for (const d of this.drawers) {
      d.hovered = mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h;
    }
  }

  getDrawerAt(mx: number, my: number, activeCount: number): DrawerRect | null {
    return this.drawers.find(
      d => d.index < activeCount && mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h,
    ) || null;
  }

  getButtonAt(mx: number, my: number): PanelButton | null {
    return this.panelButtons.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) || null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cells: CabinetCell[],
    openIndex: number | null,
    flashIndex: number | null,
    sourceIndex: number | null,
  ): void {
    for (const d of this.drawers) {
      const cell = d.index < cells.length ? cells[d.index] : null;
      const targetOpen = d.index === openIndex ? 1 : 0;
      d.open += (targetOpen - d.open) * 0.3;
      this.drawDrawer(ctx, d, cell, d.index === flashIndex, d.index === sourceIndex);
    }
  }

  private drawDrawer(
    ctx: CanvasRenderingContext2D,
    d: DrawerRect,
    cell: CabinetCell | null,
    flashing: boolean,
    selected: boolean,
  ): void {
    const depth = d.open * 8;
    const bg = d.hovered ? '#8b6914' : '#6b4e23';

    ctx.fillStyle = '#4a3728';
    ctx.fillRect(d.x, d.y, d.w, d.h);

    ctx.fillStyle = bg;
    ctx.fillRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    if (selected) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
    } else if (flashing) {
      ctx.strokeStyle = '#ff2222';
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = '#3e2b1f';
      ctx.lineWidth = 2;
    }
    ctx.strokeRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    if (cell) {
      // 抽屉上写的名字（标签）始终可见；拉开后里面的药若对不上，标签染红
      const open = d.open > 0.5;
      const mismatch = open && cell.label !== cell.content;
      ctx.fillStyle = mismatch ? '#ff6b6b' : '#f5e6d3';
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cell.label, d.x + d.w / 2 + depth, d.y + (open ? 14 : d.h / 2) + depth);

      if (open) {
        // 拉开后露出抽屉里实际装的药（名字 + 药材颜色）
        const meta = getHerbByName(cell.content);
        const cy = d.y + d.h - 14 + depth;
        if (meta) {
          ctx.fillStyle = meta.color;
          ctx.beginPath();
          ctx.arc(d.x + 18 + depth, cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#3e2b1f';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = mismatch ? '#ff6b6b' : '#ffe9b0';
        ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cell.content, d.x + d.w / 2 + 8 + depth, cy);
      }

      // 已拉开认过的格子点一个绿点，方便整理时记认药进度
      if (cell.inspected && !open) {
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.arc(d.x + d.w - 7, d.y + 7, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 整理入口/进度面板。仅在需要整理的关卡绘制 */
  drawPanel(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    phase: 'playing' | 'organize',
    progress: { done: number; total: number },
  ): void {
    this.panelButtons = [];
    const right = canvasW - this.padding;
    const panelW = this.cols * this.drawerW + (this.cols - 1) * this.padding;
    const x = right - panelW;
    const y = this.panelY;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, panelW, 36);

    ctx.fillStyle = '#f5e6d3';
    ctx.font = '14px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (phase === 'playing') {
      ctx.fillText(`药柜 ${progress.done}/${progress.total} 格对得上`, x + 10, y + 18);
      this.drawButton(ctx, right - 110, y + 3, 100, 30, '整理药柜(O)', 'organize');
    } else {
      ctx.fillText(`整理中 ${progress.done}/${progress.total}（计时继续）`, x + 10, y + 18);
      this.drawButton(ctx, right - 110, y + 3, 100, 30, '回去抓药', 'exit-organize');
    }
  }

  drawMessage(ctx: CanvasRenderingContext2D, canvasW: number, text: string): void {
    const w = Math.min(460, canvasW - 40);
    const x = (canvasW - w) / 2;
    const y = 100;
    ctx.fillStyle = 'rgba(30, 20, 8, 0.85)';
    ctx.fillRect(x, y, w, 36);
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 36);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = '15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + 18);
  }

  private drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, action: string): void {
    ctx.fillStyle = '#6b4e23';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#f5e6d3';
    ctx.font = '14px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
    this.panelButtons.push({ x, y, w, h, action });
  }
}
