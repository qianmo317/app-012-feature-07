import type { HerbMeta } from '../types';
import type { CabinetState } from '../cabinet';
import { findSlot, MESS_OPEN_THRESHOLD } from '../cabinet';

export interface DrawerRect {
  x: number;
  y: number;
  w: number;
  h: number;
  herb: string;
  open: number;
  hovered: boolean;
}

export class CabinetRenderer {
  drawers: DrawerRect[] = [];
  private cols = 6;
  private rows = 6;
  private padding = 10;
  private drawerW = 80;
  private drawerH = 50;

  layout(canvasW: number, _canvasH: number): void {
    this.drawers = [];
    const startX = canvasW - this.cols * (this.drawerW + this.padding) - this.padding;
    const startY = this.padding + 60;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.drawers.push({
          x: startX + c * (this.drawerW + this.padding),
          y: startY + r * (this.drawerH + this.padding),
          w: this.drawerW,
          h: this.drawerH,
          herb: '',
          open: 0,
          hovered: false,
        });
      }
    }
  }

  setHerbs(herbs: HerbMeta[]): void {
    for (let i = 0; i < this.drawers.length && i < herbs.length; i++) {
      this.drawers[i].herb = herbs[i].name;
    }
    for (let i = herbs.length; i < this.drawers.length; i++) {
      this.drawers[i].herb = '';
    }
  }

  updateHover(mx: number, my: number): void {
    for (const d of this.drawers) {
      d.hovered = mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h;
    }
  }

  getDrawerAt(mx: number, my: number): DrawerRect | null {
    return this.drawers.find(d => mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h) || null;
  }

  openDrawer(herb: string): void {
    const d = this.drawers.find(x => x.herb === herb);
    if (d) d.open = 1;
  }

  closeDrawer(herb: string): void {
    const d = this.drawers.find(x => x.herb === herb);
    if (d) d.open = 0;
  }

  draw(ctx: CanvasRenderingContext2D, cabinet: CabinetState | null = null, organizeMode = false): void {
    for (const d of this.drawers) {
      const idx = cabinet && d.herb ? findSlot(cabinet, d.herb) : -1;
      const slot = idx >= 0 && cabinet ? cabinet.slots[idx] : null;
      const openCount = idx >= 0 && cabinet ? cabinet.openCounts[idx] : 0;
      this.drawDrawer(ctx, d, slot, openCount, organizeMode);
    }
  }

  private drawDrawer(
    ctx: CanvasRenderingContext2D,
    d: DrawerRect,
    slot: { label: string; content: string; identified: boolean } | null,
    openCount: number,
    organizeMode: boolean,
  ): void {
    const depth = d.open * 8;
    const bg = d.hovered ? '#8b6914' : '#6b4e23';

    ctx.fillStyle = '#4a3728';
    ctx.fillRect(d.x, d.y, d.w, d.h);

    ctx.fillStyle = bg;
    ctx.fillRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    ctx.strokeStyle = '#3e2b1f';
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x + depth, d.y + depth, d.w - depth * 2, d.h - depth * 2);

    if (d.herb) {
      ctx.fillStyle = '#f5e6d3';
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelY = organizeMode && slot ? d.y + d.h / 2 - 8 + depth : d.y + d.h / 2 + depth;
      ctx.fillText(d.herb, d.x + d.w / 2 + depth, labelY);
    }

    // 整理模式：认过的格子亮出实际内容，对不上的标红
    if (organizeMode && slot) {
      ctx.font = '11px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const subY = d.y + d.h - 12 + depth;
      if (!slot.identified) {
        ctx.fillStyle = '#b0a090';
        ctx.fillText('？', d.x + d.w / 2 + depth, subY);
      } else if (slot.content === slot.label) {
        ctx.fillStyle = '#90ee90';
        ctx.fillText(`✓ ${slot.content}`, d.x + d.w / 2 + depth, subY);
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText(`✗ 装的是${slot.content}`, d.x + d.w / 2 + depth, subY);
      }
    }

    // 拉开次数多了的抽屉画磨损点，提示这格可能乱了
    if (openCount >= MESS_OPEN_THRESHOLD) {
      const dots = Math.min(3, openCount - MESS_OPEN_THRESHOLD + 1);
      ctx.fillStyle = '#d4a574';
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(d.x + d.w - 8 - i * 7 + depth, d.y + 7 + depth, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (d.open > 0.5) {
      ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
      ctx.fillRect(d.x + depth + 4, d.y + depth + 4, d.w - depth * 2 - 8, d.h - depth * 2 - 8);
    }
  }
}
