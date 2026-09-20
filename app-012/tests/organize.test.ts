import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameManager } from '../src/game/state';
import { createCabinet } from '../src/cabinet';
import type { CabinetCell } from '../src/types';

function startOrganizeLevel(herbs: string[]): GameManager {
  const game = new GameManager();
  game.startLevel(11, false);
  // 用固定的小柜子替换随机关卡，便于断言
  game.cells = createCabinet(herbs);
  game.herbs = herbs.map(name => ({ name, color: '#000' }));
  game.phase = 'playing';
  return game;
}

function swap(cells: CabinetCell[], i: number, j: number): void {
  const tmp = cells[i].content;
  cells[i].content = cells[j].content;
  cells[j].content = tmp;
}

describe('GameManager organize flow', () => {
  beforeEach(() => vi.useFakeTimers());

  const HERBS = ['白芍', '赤芍', '生地', '熟地', '黄芪'];

  it('keeps organize progress when interrupted to serve a patient', () => {
    const game = startOrganizeLevel(HERBS);
    // 前三味药轮转错位：白芍格装赤芍、赤芍格装生地、生地格装白芍；其余不动
    game.cells[0].content = '赤芍';
    game.cells[1].content = '生地';
    game.cells[2].content = '白芍';
    game.cells[0].inspected = true;

    game.enterOrganize();
    expect(game.organizeClick(0)).toBe('picked');
    expect(game.organizeClick(1)).toBe('restored');
    // 只有赤芍格归位，白芍格仍装着生地
    expect(game.getOrganizeProgress()).toEqual({ done: 3, total: 5 });

    // 中途回去抓药，再重新进入整理：进度与认药标记都还在
    game.exitOrganize();
    expect(game.phase).toBe('playing');
    expect(game.getOrganizeProgress()).toEqual({ done: 3, total: 5 });
    game.enterOrganize();
    // 重新进入后接着整：已归位的赤芍格再点就是白做
    expect(game.organizeClick(1)).toBe('already-home');
  });

  it('reports done when the final restore puts every herb back', () => {
    const game = startOrganizeLevel(['白芍', '赤芍', '生地']);
    swap(game.cells, 0, 1);
    game.enterOrganize();
    game.organizeClick(0);
    expect(game.organizeClick(1)).toBe('done');
  });

  it('treats re-doing an already home drawer as wasted work', () => {
    const game = startOrganizeLevel(HERBS);
    game.enterOrganize();
    expect(game.organizeClick(0)).toBe('pull');
    expect(game.organizeClick(0)).toBe('already-home');
  });

  it('requires opening a drawer to see its herb before selecting it', () => {
    const game = startOrganizeLevel(HERBS);
    swap(game.cells, 0, 1);
    game.enterOrganize();
    // 第一下总是先拉开认药；错位才会进入选中状态
    expect(game.organizeClick(0)).toBe('picked');
    expect(game.organizeClick(0)).toBe('cancel');
  });

  it('rejects restoring to a drawer with a mismatched label', () => {
    const game = startOrganizeLevel(HERBS);
    swap(game.cells, 0, 1); // 白芍格装赤芍
    game.enterOrganize();
    game.organizeClick(0); // 拉开并选中（里面是赤芍）
    expect(game.organizeClick(2)).toBe('wrong-target'); // 生地格不收赤芍
    expect(game.organizeSource).toBe(0); // 手里还拿着，没白选
  });

  it('only allows entering organize on levels that require it', () => {
    const game = new GameManager();
    game.startLevel(1, false); // requireOrganize=false
    expect(game.phase).toBe('playing');
    game.enterOrganize();
    expect(game.phase).toBe('playing');
  });

  it('keeps the clock running while organizing', () => {
    const game = startOrganizeLevel(HERBS);
    const before = game.getTimeLeft();
    game.enterOrganize();
    game.tick((game as unknown as { lastTick: number }).lastTick + 1000);
    expect(game.getTimeLeft()).toBeCloseTo((before ?? 0) - 1);
  });
});
