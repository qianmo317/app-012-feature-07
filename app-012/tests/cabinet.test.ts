import { describe, it, expect } from 'vitest';
import {
  createCabinet, openDrawer, identifySlot, restoreSlot,
  findSlot, isMessy, messyCount, isOrganized,
  MESS_OPEN_THRESHOLD,
  ORGANIZE_IDENTIFY_COST, ORGANIZE_RESTORE_COST,
} from '../src/cabinet';
import { GameManager } from '../src/game/state';

const HERBS = ['白芍', '赤芍', '生地', '熟地', '黄芪'];

function sortedContents(state: ReturnType<typeof createCabinet>): string[] {
  return state.slots.map(s => s.content).sort();
}

describe('createCabinet', () => {
  it('should start with every drawer matching its label', () => {
    const c = createCabinet(HERBS);
    expect(c.slots.length).toBe(HERBS.length);
    for (const s of c.slots) {
      expect(s.content).toBe(s.label);
      expect(s.identified).toBe(false);
    }
    expect(isMessy(c)).toBe(false);
    expect(isOrganized(c)).toBe(true);
  });
});

describe('openDrawer', () => {
  it('should not mess up before the open threshold', () => {
    const c = createCabinet(HERBS);
    for (let i = 0; i < MESS_OPEN_THRESHOLD - 1; i++) {
      const r = openDrawer(c, '白芍', () => 0);
      expect(r.opened).toBe(true);
      expect(r.swapped).toBe(false);
    }
    expect(isMessy(c)).toBe(false);
  });

  it('may swap contents once a drawer has been opened several times', () => {
    const c = createCabinet(HERBS);
    openDrawer(c, '白芍', () => 0.99);
    const r = openDrawer(c, '白芍', () => 0); // 第 2 回，rng 强制错位
    expect(r.swapped).toBe(true);
    expect(isMessy(c)).toBe(true);
    expect(messyCount(c)).toBe(2);
    // 抽屉上的名字不动，只是里面装的被对调
    expect(c.slots.map(s => s.label).sort()).toEqual([...HERBS].sort());
    expect(sortedContents(c)).toEqual([...HERBS].sort());
  });

  it('should not swap when rng says no', () => {
    const c = createCabinet(HERBS);
    for (let i = 0; i < 10; i++) {
      const r = openDrawer(c, '白芍', () => 0.99);
      expect(r.swapped).toBe(false);
    }
    expect(isMessy(c)).toBe(false);
  });

  it('should preserve the multiset of contents after many opens', () => {
    const c = createCabinet(HERBS);
    for (let i = 0; i < 50; i++) {
      openDrawer(c, '白芍', () => 0);
      openDrawer(c, '生地', () => 0);
    }
    expect(sortedContents(c)).toEqual([...HERBS].sort());
  });

  it('should return opened=false for unknown drawer', () => {
    const c = createCabinet(HERBS);
    expect(openDrawer(c, '不存在', () => 0).opened).toBe(false);
  });
});

describe('identifySlot / restoreSlot', () => {
  function messedCabinet() {
    const c = createCabinet(HERBS);
    const i = findSlot(c, '白芍');
    const j = findSlot(c, '赤芍');
    const tmp = c.slots[i].content;
    c.slots[i].content = c.slots[j].content;
    c.slots[j].content = tmp;
    return c;
  }

  it('identify reveals actual content and leaves a mark', () => {
    const c = messedCabinet();
    expect(identifySlot(c, '白芍')).toBe('赤芍');
    expect(c.slots[findSlot(c, '白芍')].identified).toBe(true);
    expect(identifySlot(c, '不存在')).toBeNull();
  });

  it('restore fixes a mismatched drawer', () => {
    const c = messedCabinet();
    identifySlot(c, '白芍');
    const r = restoreSlot(c, '白芍');
    expect(r.ok).toBe(true);
    expect(r.swapped).toBe(true);
    expect(r.wasted).toBe(false);
    expect(isOrganized(c)).toBe(true);
  });

  it('restore on an already-correct drawer is wasted work', () => {
    const c = createCabinet(HERBS);
    const r = restoreSlot(c, '白芍');
    expect(r.ok).toBe(true);
    expect(r.wasted).toBe(true);
    expect(r.swapped).toBe(false);
    expect(isOrganized(c)).toBe(true);
  });

  it('restoring the same drawer twice is recognized as wasted', () => {
    const c = messedCabinet();
    identifySlot(c, '白芍');
    const first = restoreSlot(c, '白芍');
    expect(first.swapped).toBe(true);
    const second = restoreSlot(c, '白芍');
    expect(second.wasted).toBe(true);
    expect(second.swapped).toBe(false);
  });

  it('restore on unknown drawer fails without side effects', () => {
    const c = messedCabinet();
    const r = restoreSlot(c, '不存在');
    expect(r.ok).toBe(false);
    expect(messyCount(c)).toBe(2);
  });
});

describe('GameManager 整理流程', () => {
  it('only creates a cabinet when the level requires organizing', () => {
    const gm = new GameManager();
    gm.startLevel(1);
    expect(gm.cabinet).toBeNull();
    expect(gm.toggleOrganize()).toBe(false);

    gm.startLevel(11);
    expect(gm.cabinet).not.toBeNull();
    expect(gm.levelConfig.requireOrganize).toBe(true);
  });

  it('prescription herbs always have a drawer', () => {
    const gm = new GameManager();
    gm.startLevel(11);
    const names = new Set(gm.herbs.map(h => h.name));
    for (const item of gm.prescription!.items) {
      expect(names.has(item.herb)).toBe(true);
    }
  });

  it('keeps organize progress when interrupted and resumed', () => {
    const gm = new GameManager();
    gm.startLevel(11);
    const c = gm.cabinet!;
    // 制造错位
    const tmp = c.slots[0].content;
    c.slots[0].content = c.slots[1].content;
    c.slots[1].content = tmp;

    expect(gm.toggleOrganize()).toBe(true);
    expect(gm.phase).toBe('organizing');

    const label = c.slots[0].label;
    gm.identifyDrawer(label);
    expect(c.slots[0].identified).toBe(true);
    const r1 = gm.restoreDrawer(label);
    expect(r1!.swapped).toBe(true);

    // 整理到一半被打断：回去抓药，再重新整理
    gm.toggleOrganize();
    expect(gm.phase).toBe('playing');
    gm.toggleOrganize();
    expect(gm.phase).toBe('organizing');

    // 进度留在原处：认过的还认着，归过位的还对着
    expect(c.slots[0].identified).toBe(true);
    expect(isOrganized(c)).toBe(true);

    // 同一格归位两次 = 白做
    const r2 = gm.restoreDrawer(label);
    expect(r2!.wasted).toBe(true);
    expect(r2!.swapped).toBe(false);
  });

  it('organizing costs time while patients wait', () => {
    const gm = new GameManager();
    gm.startLevel(11); // 90s 时限
    expect(gm.timeLeft).toBe(90);

    gm.toggleOrganize();
    const before = gm.timeLeft!;
    gm.identifyDrawer(gm.cabinet!.slots[0].label);
    expect(gm.timeLeft!).toBe(before - ORGANIZE_IDENTIFY_COST);

    gm.restoreDrawer(gm.cabinet!.slots[0].label); // 本来就是对的，白做也花时间
    expect(gm.timeLeft!).toBe(before - ORGANIZE_IDENTIFY_COST - ORGANIZE_RESTORE_COST);
  });

  it('refuses to restore a drawer that has not been identified', () => {
    const gm = new GameManager();
    gm.startLevel(11);
    gm.toggleOrganize();
    const r = gm.restoreDrawer(gm.cabinet!.slots[0].label);
    expect(r!.ok).toBe(false);
    expect(r!.swapped).toBe(false);
  });

  it('selectDrawer reveals a mismatch instead of weighing', () => {
    const gm = new GameManager();
    gm.startLevel(11);
    const c = gm.cabinet!;
    const needed = gm.prescription!.items[0].herb;
    const idx = findSlot(c, needed);
    const other = (idx + 1) % c.slots.length;
    const tmp = c.slots[idx].content;
    c.slots[idx].content = c.slots[other].content;
    c.slots[other].content = tmp;

    const ok = gm.selectDrawer(needed);
    expect(ok).toBe(false);
    expect(gm.phase).toBe('playing'); // 没进入称重
    expect(c.slots[idx].identified).toBe(true); // 拉开认过了
    expect(gm.message).toContain(needed);
  });

  it('selectDrawer works normally when drawer content matches', () => {
    const gm = new GameManager();
    gm.startLevel(11);
    const needed = gm.prescription!.items[0].herb;
    expect(gm.selectDrawer(needed)).toBe(true);
    expect(gm.phase).toBe('weighing');
  });
});
