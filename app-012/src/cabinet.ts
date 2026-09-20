// 药柜整理机制（纯逻辑，可单测）
// 抽屉位置固定，拉开次数多了里面的药可能和抽屉上的名字对不上；
// 整理 = 挨个拉开认药（identify）→ 把认出来的药归位（restore）。

export interface CabinetSlot {
  label: string;      // 抽屉上写的名字（固定不动）
  content: string;    // 抽屉里实际装的药
  identified: boolean; // 是否已拉开辨认过
}

export interface CabinetState {
  slots: CabinetSlot[];
  openCounts: number[]; // 每格被拉开的次数（与 slots 同序）
  restored: boolean[];  // 每格是否已成功归位过
  swaps: number;        // 累计发生错位的次数
}

export interface OpenResult {
  opened: boolean;
  swapped: boolean;
}

export interface RestoreResult {
  ok: boolean;      // 操作后这格是对的
  wasted: boolean;  // 白做：这格本来就是对的（含重复归位）
  swapped: boolean; // 本次是否真的发生了对调
}

// 同一格拉开第几回起可能错位
export const MESS_OPEN_THRESHOLD = 2;
// 达到阈值后每次拉开的错位概率
export const MESS_SWAP_PROBABILITY = 0.4;
// 整理动作占用的时间（秒），从关卡剩余时间里扣
export const ORGANIZE_IDENTIFY_COST = 1;
export const ORGANIZE_RESTORE_COST = 2;

export function createCabinet(herbs: string[]): CabinetState {
  return {
    slots: herbs.map(name => ({ label: name, content: name, identified: false })),
    openCounts: herbs.map(() => 0),
    restored: herbs.map(() => false),
    swaps: 0,
  };
}

export function findSlot(state: CabinetState, label: string): number {
  return state.slots.findIndex(s => s.label === label);
}

export function isMessy(state: CabinetState): boolean {
  return state.slots.some(s => s.content !== s.label);
}

export function messyCount(state: CabinetState): number {
  return state.slots.filter(s => s.content !== s.label).length;
}

export function isOrganized(state: CabinetState): boolean {
  return !isMessy(state);
}

// 抓药时拉开抽屉：累计次数，同一格拉开几回后可能和别格对调（药柜变乱）
export function openDrawer(state: CabinetState, label: string, rng: () => number = Math.random): OpenResult {
  const idx = findSlot(state, label);
  if (idx < 0) return { opened: false, swapped: false };

  state.openCounts[idx]++;
  if (state.openCounts[idx] >= MESS_OPEN_THRESHOLD && rng() < MESS_SWAP_PROBABILITY) {
    const others = state.slots.map((_, i) => i).filter(i => i !== idx);
    const j = others[Math.floor(rng() * others.length)];
    const tmp = state.slots[idx].content;
    state.slots[idx].content = state.slots[j].content;
    state.slots[j].content = tmp;
    state.swaps++;
    return { opened: true, swapped: true };
  }
  return { opened: true, swapped: false };
}

// 拉开认一认：返回这格实际装的药，并留下辨认记录
export function identifySlot(state: CabinetState, label: string): string | null {
  const idx = findSlot(state, label);
  if (idx < 0) return null;
  state.slots[idx].identified = true;
  return state.slots[idx].content;
}

// 归位：把写着 label 的格子装上它该装的药（与装着那味药的格子对调）。
// 这格本来就是对的（包括已经归位过一次）则判定为白做，状态不变。
export function restoreSlot(state: CabinetState, label: string): RestoreResult {
  const idx = findSlot(state, label);
  if (idx < 0) return { ok: false, wasted: false, swapped: false };

  const slot = state.slots[idx];
  if (slot.content === slot.label) {
    return { ok: true, wasted: true, swapped: false };
  }

  const j = state.slots.findIndex(s => s.content === slot.label);
  if (j < 0) return { ok: false, wasted: false, swapped: false };

  const tmp = state.slots[idx].content;
  state.slots[idx].content = state.slots[j].content;
  state.slots[j].content = tmp;
  state.restored[idx] = true;
  state.slots[idx].identified = true;
  state.slots[j].identified = true;
  if (state.slots[j].content === state.slots[j].label) {
    state.restored[j] = true;
  }
  return { ok: true, wasted: false, swapped: true };
}
