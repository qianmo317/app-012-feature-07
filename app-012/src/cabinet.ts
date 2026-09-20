import type { CabinetCell, PullResult, RestoreResult } from './types';

/** 同一格累计拉开达到此次数后，再次翻找就可能变乱 */
export const SCRAMBLE_PULL_THRESHOLD = 3;
/** 达到阈值后每次拉开触发变乱的概率 */
export const SCRAMBLE_CHANCE = 0.5;

export function createCabinet(herbs: string[]): CabinetCell[] {
  return herbs.map(name => ({ label: name, content: name, pulls: 0, inspected: false }));
}

/**
 * 拉开一格辨认里面的药。
 * - 每拉一次累计 pulls；累计超过阈值后按概率与另一格交换内容（药被翻乱）。
 * - 交换后两格都要重新拉开辨认；没被翻乱时，本次拉开的格子标记为已认。
 * enabled=false 的关卡柜子永远不会乱，保持开局摆放。
 */
export function pullDrawer(
  cells: CabinetCell[],
  index: number,
  enabled: boolean,
  random: () => number = Math.random,
): PullResult {
  const cell = cells[index];
  if (!cell) return 'disabled';
  cell.pulls++;

  if (enabled && cell.pulls > SCRAMBLE_PULL_THRESHOLD && random() < SCRAMBLE_CHANCE) {
    const others = cells.map((_, i) => i).filter(i => i !== index);
    const target = others[Math.floor(random() * others.length)];
    const from = cell.content;
    cell.content = cells[target].content;
    cells[target].content = from;
    // 被动交换的格子位置没变，但内容换了，之前认过也不算数
    cells[target].inspected = false;
    cell.inspected = true;
    return 'scrambled';
  }

  cell.inspected = true;
  return 'normal';
}

/** 错位的格子数；为 0 即药柜整理完毕 */
export function misplacedCount(cells: CabinetCell[]): number {
  return cells.reduce((n, c) => n + (c.label === c.content ? 0 : 1), 0);
}

/**
 * 把选中格（source，必须已拉开认过药）的药归到标签格 target。
 * - restored：归位成功（交换两格内容，使 source 的药回到自己名字的格）
 * - already-home：这格本来就是对的，再归一次是白做
 * - wrong-target：目标格标签与手里的药对不上
 * - not-inspected：还没拉开认过，不知道里面是什么
 */
export function restoreDrawer(cells: CabinetCell[], source: number, target: number): RestoreResult {
  const from = cells[source];
  if (!from || !cells[target] || source === target) return 'wrong-target';
  if (!from.inspected) return 'not-inspected';
  if (from.label === from.content) return 'already-home';
  if (cells[target].label !== from.content) return 'wrong-target';

  const to = cells[target];
  const tmp = from.content;
  from.content = to.content;
  to.content = tmp;
  from.inspected = true;
  to.inspected = true;
  return 'restored';
}
