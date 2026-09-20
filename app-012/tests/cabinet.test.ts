import { describe, it, expect } from 'vitest';
import {
  createCabinet,
  pullDrawer,
  restoreDrawer,
  misplacedCount,
  SCRAMBLE_PULL_THRESHOLD,
  SCRAMBLE_CHANCE,
} from '../src/cabinet';

function seqRng(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const HERBS = ['白芍', '赤芍', '生地', '熟地', '黄芪'];

describe('createCabinet', () => {
  it('starts with every drawer matching its label', () => {
    const cells = createCabinet(HERBS);
    expect(cells).toHaveLength(HERBS.length);
    for (const c of cells) {
      expect(c.content).toBe(c.label);
      expect(c.pulls).toBe(0);
      expect(c.inspected).toBe(false);
    }
    expect(misplacedCount(cells)).toBe(0);
  });
});

describe('pullDrawer', () => {
  it('never scrambles on levels without organize and still marks inspected', () => {
    const cells = createCabinet(HERBS);
    for (let i = 0; i < 20; i++) {
      const result = pullDrawer(cells, 0, false, () => 0);
      expect(result).toBe('normal');
    }
    expect(cells[0].content).toBe('白芍');
    expect(cells[0].inspected).toBe(true);
    expect(misplacedCount(cells)).toBe(0);
  });

  it('does not scramble before the pull threshold', () => {
    const cells = createCabinet(HERBS);
    for (let i = 0; i < SCRAMBLE_PULL_THRESHOLD; i++) {
      expect(pullDrawer(cells, 1, true, () => 0)).toBe('normal');
    }
    expect(cells[1].content).toBe('赤芍');
  });

  it('scrambles only with chance after the threshold', () => {
    const cells = createCabinet(HERBS);
    for (let i = 0; i < SCRAMBLE_PULL_THRESHOLD; i++) pullDrawer(cells, 2, true, () => 1);
    // rng above chance -> no swap; first value is the chance check, only one draw needed
    const noSwap = pullDrawer(cells, 2, true, seqRng(SCRAMBLE_CHANCE));
    expect(noSwap).toBe('normal');
    expect(cells[2].content).toBe('生地');
  });

  it('swaps content with another drawer when the chance fires', () => {
    const cells = createCabinet(HERBS);
    for (let i = 0; i < SCRAMBLE_PULL_THRESHOLD; i++) pullDrawer(cells, 0, true, () => 0.9);
    // chance check passes (0 < chance); target index = floor(rng * others.length) = 0 -> other 1
    const result = pullDrawer(cells, 0, true, seqRng(0, 0));
    expect(result).toBe('scrambled');
    expect(cells[0].content).toBe('赤芍');
    expect(cells[1].content).toBe('白芍');
    expect(misplacedCount(cells)).toBe(2);
  });

  it('forces drawers involved in a swap to be re-inspected', () => {
    const cells = createCabinet(HERBS);
    pullDrawer(cells, 1, false, () => 0.5); // 赤芍 inspected (enabled=false keeps order)
    expect(cells[1].inspected).toBe(true);
    for (let i = 0; i < SCRAMBLE_PULL_THRESHOLD; i++) pullDrawer(cells, 0, true, () => 0.9);
    pullDrawer(cells, 0, true, seqRng(0, 0)); // swaps 0 <-> 1
    expect(cells[1].inspected).toBe(false);
    expect(cells[0].inspected).toBe(true);
  });

  it('keeps every herb exactly once after many scrambles', () => {
    const cells = createCabinet(HERBS);
    for (let i = 0; i < 200; i++) {
      pullDrawer(cells, i % cells.length, true, seqRng(0, (i * 7) % cells.length / cells.length));
    }
    const contents = cells.map(c => c.content).sort();
    expect(contents).toEqual([...HERBS].sort());
  });
});

describe('restoreDrawer', () => {
  it('refuses to restore a herb that has not been inspected', () => {
    const cells = createCabinet(HERBS);
    [cells[0].content, cells[1].content] = [cells[1].content, cells[0].content];
    expect(restoreDrawer(cells, 0, 1)).toBe('not-inspected');
    expect(cells[0].content).toBe('赤芍');
  });

  it('restores an inspected misplaced herb into the matching drawer', () => {
    const cells = createCabinet(HERBS);
    [cells[0].content, cells[1].content] = [cells[1].content, cells[0].content];
    cells[0].inspected = true;
    expect(restoreDrawer(cells, 0, 1)).toBe('restored');
    expect(cells[0].content).toBe('白芍');
    expect(cells[1].content).toBe('赤芍');
    expect(misplacedCount(cells)).toBe(0);
  });

  it('rejects a target whose label does not match the herb', () => {
    const cells = createCabinet(HERBS);
    [cells[0].content, cells[2].content] = [cells[2].content, cells[0].content];
    cells[0].inspected = true;
    expect(restoreDrawer(cells, 0, 1)).toBe('wrong-target');
    expect(cells[0].content).toBe('生地');
  });

  it('recognizes restoring an already-home drawer as wasted work', () => {
    const cells = createCabinet(HERBS);
    cells[3].inspected = true;
    expect(restoreDrawer(cells, 3, 0)).toBe('already-home');
    expect(cells[3].content).toBe('熟地');
  });
});
