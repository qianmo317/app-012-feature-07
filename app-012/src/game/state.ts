import type { GameState, GamePhase, Prescription, WeighResult, LevelConfig } from '../types';
import { getLevelConfig } from '../levels';
import { generatePrescription, generateReviewQuestion } from '../prescription';
import { judgeWeight, getWeightStatus } from '../weighing';
import { scoreRound } from '../scoring';
import { getRandomHerbs } from '../herbs';
import type { HerbMeta } from '../types';
import {
  CabinetState, RestoreResult,
  createCabinet, openDrawer, identifySlot, restoreSlot,
  findSlot, isOrganized, messyCount,
  ORGANIZE_IDENTIFY_COST, ORGANIZE_RESTORE_COST,
} from '../cabinet';

export class GameManager {
  state: GameState = {
    level: 1,
    score: 0,
    combo: 0,
    queue: 3,
    satisfaction: 100,
    expired: false,
  };

  phase: GamePhase = 'menu';
  endless = false;
  prescription: Prescription | null = null;
  herbs: HerbMeta[] = [];
  currentWeight = 0;
  zeroOffset = 0;
  targetGrams = 0;
  currentHerb: string | null = null;
  weighed = new Set<string>();
  results: WeighResult[] = [];
  packages: Array<{ herb: string; grams: number; decoct: string }> = [];
  reviewQuestion: ReturnType<typeof generateReviewQuestion> = null;
  reviewSelected: number | null = null;
  reviewResult: boolean | null = null;
  levelConfig: LevelConfig = getLevelConfig(1);

  timeLeft: number | null = null;
  timeUsed = 0;
  lastTick = 0;

  drawerOpen = new Set<string>();
  draggingHerb: string | null = null;
  dragX = 0;
  dragY = 0;
  onScale = false;
  flashingDrawer: string | null = null;
  flashTime = 0;

  // 药柜整理：仅 requireOrganize 的关卡启用；整理进度保存在这里，中断后继续
  cabinet: CabinetState | null = null;
  message: string | null = null;
  messageTime = 0;

  setMessage(text: string, seconds = 2.5): void {
    this.message = text;
    this.messageTime = seconds;
  }

  startLevel(level: number, endless = false): void {
    this.endless = endless;
    this.state.level = level;
    this.state.expired = false;
    this.levelConfig = getLevelConfig(level);
    this.herbs = getRandomHerbs(this.levelConfig.herbCount + (this.levelConfig.hasSimilarHerbs ? 2 : 0), this.levelConfig.hasSimilarHerbs);
    this.prescription = generatePrescription(this.levelConfig, this.herbs);
    this.currentWeight = 0;
    this.zeroOffset = 0;
    this.targetGrams = 0;
    this.currentHerb = null;
    this.weighed = new Set();
    this.results = [];
    this.packages = [];
    this.reviewQuestion = null;
    this.reviewSelected = null;
    this.reviewResult = null;
    this.timeLeft = this.levelConfig.timeLimit;
    this.timeUsed = 0;
    this.lastTick = performance.now();
    this.drawerOpen = new Set();
    this.draggingHerb = null;
    this.cabinet = this.levelConfig.requireOrganize ? createCabinet(this.herbs.map(h => h.name)) : null;
    this.message = null;
    this.messageTime = 0;
    this.phase = 'playing';
  }

  tick(now: number): void {
    if (this.phase !== 'playing' && this.phase !== 'weighing' && this.phase !== 'organizing') return;
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.timeUsed += dt;

    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.handleTimeout();
      }
    }

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flashingDrawer = null;
    }

    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = null;
    }
  }

  selectDrawer(herb: string): boolean {
    if (!this.prescription) return false;
    const needed = this.prescription.items.find(i => i.herb === herb && !this.weighed.has(i.herb));
    if (!needed) {
      this.flashingDrawer = herb;
      this.flashTime = 0.5;
      return false;
    }

    if (this.cabinet) {
      // 拉开一回算一回，拉开多了药柜会变乱
      openDrawer(this.cabinet, herb);
      const slot = this.cabinet.slots[findSlot(this.cabinet, herb)];
      identifySlot(this.cabinet, herb);
      if (slot.content !== slot.label) {
        this.setMessage(`「${herb}」里装的竟是${slot.content}！药柜乱了，按 O 整理`);
        this.flashingDrawer = herb;
        this.flashTime = 0.8;
        return false;
      }
    }

    this.drawerOpen.add(herb);
    this.currentHerb = herb;
    this.targetGrams = needed.grams;
    this.currentWeight = 0;
    this.phase = 'weighing';
    return true;
  }

  // 进出整理模式。整理进度都在 this.cabinet 里，中途回去抓药再回来不丢
  toggleOrganize(): boolean {
    if (!this.cabinet) return false;
    if (this.phase === 'playing') {
      this.phase = 'organizing';
      const messy = messyCount(this.cabinet);
      this.setMessage(
        messy > 0
          ? `整理药柜：点抽屉认药，再点一次归位（有 ${messy} 格对不上）`
          : '整理药柜：点抽屉认药，再点一次归位',
        3.5
      );
      return true;
    }
    if (this.phase === 'organizing') {
      this.phase = 'playing';
      return true;
    }
    return false;
  }

  // 整理模式：拉开认一认这格装的是什么
  identifyDrawer(herb: string): string | null {
    if (this.phase !== 'organizing' || !this.cabinet) return null;
    const content = identifySlot(this.cabinet, herb);
    if (content === null) return null;
    this.spendOrganizeTime(ORGANIZE_IDENTIFY_COST);
    const slot = this.cabinet.slots[findSlot(this.cabinet, herb)];
    this.setMessage(
      slot.content === slot.label
        ? `「${herb}」里正是${content}，没错`
        : `「${herb}」里装的是${content}，对不上！`
    );
    return content;
  }

  // 整理模式：把认过的格子归位；本来就是对的算白做，照样花时间
  restoreDrawer(herb: string): RestoreResult | null {
    if (this.phase !== 'organizing' || !this.cabinet) return null;
    const idx = findSlot(this.cabinet, herb);
    if (idx < 0) return null;
    if (!this.cabinet.slots[idx].identified) {
      this.setMessage('还没拉开认过这格，先认一认再归位');
      return { ok: false, wasted: false, swapped: false };
    }
    const result = restoreSlot(this.cabinet, herb);
    this.spendOrganizeTime(ORGANIZE_RESTORE_COST);
    if (result.wasted) {
      this.setMessage(`「${herb}」本来就是对的，白忙一场`);
    } else if (result.swapped) {
      this.setMessage(
        isOrganized(this.cabinet)
          ? `「${herb}」归位！药柜全整理好了`
          : `「${herb}」归位了`
      );
    }
    return result;
  }

  private spendOrganizeTime(seconds: number): void {
    if (this.timeLeft !== null) {
      this.timeLeft = Math.max(0, this.timeLeft - seconds);
    }
  }

  setWeight(w: number): void {
    this.currentWeight = Math.max(0, w);
  }

  addWeight(delta: number): void {
    this.currentWeight = Math.max(0, parseFloat((this.currentWeight + delta).toFixed(1)));
  }

  tare(): void {
    this.zeroOffset = this.currentWeight;
  }

  confirmWeight(): WeighResult | null {
    if (!this.currentHerb || !this.prescription) return null;
    const result = judgeWeight(this.currentWeight, this.targetGrams, this.levelConfig.tolerance);
    result.herb = this.currentHerb;
    this.results.push(result);

    const status = getWeightStatus(result, this.levelConfig.tolerance);
    const timeLimit = this.levelConfig.timeLimit;
    const breakdown = scoreRound(result, this.levelConfig.tolerance, this.state.combo, this.timeUsed, timeLimit);

    if (status === 'fail') {
      this.state.combo = 0;
    } else {
      this.state.combo++;
      this.state.score += breakdown.total;
      this.weighed.add(this.currentHerb);
      const item = this.prescription.items.find(i => i.herb === this.currentHerb);
      if (item) {
        this.packages.push({ herb: item.herb, grams: this.currentWeight, decoct: item.decoct });
      }
    }

    this.drawerOpen.delete(this.currentHerb);
    this.currentHerb = null;
    this.currentWeight = 0;
    this.zeroOffset = 0;

    if (this.weighed.size >= this.prescription.items.length) {
      this.startReview();
    } else {
      this.phase = 'playing';
    }

    return result;
  }

  startReview(): void {
    if (!this.prescription) return;
    this.reviewQuestion = generateReviewQuestion(this.prescription);
    this.reviewSelected = null;
    this.reviewResult = null;
    this.phase = 'review';
  }

  answerReview(answer: number): boolean {
    if (!this.reviewQuestion || this.reviewSelected !== null) return false;
    this.reviewSelected = answer;
    const correct = answer === this.reviewQuestion.correct;
    this.reviewResult = correct;
    if (!correct) {
      this.state.satisfaction -= 10;
      this.state.combo = 0;
    } else {
      this.state.satisfaction = Math.min(100, this.state.satisfaction + 5);
    }
    setTimeout(() => this.finishLevel(), 1500);
    return correct;
  }

  finishLevel(): void {
    const passed = this.results.every(r => r.ok) && this.state.satisfaction > 0;
    if (passed) {
      this.state.queue = Math.min(10, this.state.queue + 1);
    } else {
      this.state.queue--;
      this.state.satisfaction = Math.max(0, this.state.satisfaction - 20);
    }

    if (this.state.queue <= 0 || this.state.satisfaction <= 0) {
      this.phase = 'gameover';
    } else {
      this.phase = 'result';
    }
  }

  nextLevel(): void {
    this.startLevel(this.state.level + 1, this.endless);
  }

  retryLevel(): void {
    this.startLevel(this.state.level, this.endless);
  }

  handleTimeout(): void {
    this.state.queue--;
    this.state.satisfaction -= 15;
    this.state.combo = 0;
    if (this.state.queue <= 0 || this.state.satisfaction <= 0) {
      this.phase = 'gameover';
    } else {
      this.startLevel(this.state.level, this.endless);
    }
  }

  getTimeLeft(): number | null {
    return this.timeLeft;
  }

  isDrawerOpen(herb: string): boolean {
    return this.drawerOpen.has(herb);
  }
}
