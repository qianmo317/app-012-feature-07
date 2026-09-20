import type { GameState, GamePhase, Prescription, WeighResult, LevelConfig, CabinetCell, PullResult, RestoreResult } from '../types';
import { getLevelConfig } from '../levels';
import { generatePrescription, generateReviewQuestion } from '../prescription';
import { judgeWeight, getWeightStatus } from '../weighing';
import { scoreRound } from '../scoring';
import { getRandomHerbs } from '../herbs';
import { createCabinet, pullDrawer, restoreDrawer, misplacedCount } from '../cabinet';
import type { HerbMeta } from '../types';

export type OrganizeAction =
  | 'pull'
  | 'scrambled'
  | 'picked'
  | 'cancel'
  | 'restored'
  | 'done'
  | 'already-home'
  | 'wrong-target'
  | 'not-inspected';

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
  cells: CabinetCell[] = [];
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

  openDrawerIndex: number | null = null;
  organizeSource: number | null = null;
  draggingHerb: string | null = null;
  dragX = 0;
  dragY = 0;
  onScale = false;
  flashIndex: number | null = null;
  flashTime = 0;
  message: string | null = null;
  messageTime = 0;

  startLevel(level: number, endless = false): void {
    this.endless = endless;
    this.state.level = level;
    this.state.expired = false;
    this.levelConfig = getLevelConfig(level);
    this.prescription = generatePrescription(this.levelConfig);
    this.herbs = getRandomHerbs(this.levelConfig.herbCount + (this.levelConfig.hasSimilarHerbs ? 2 : 0), this.levelConfig.hasSimilarHerbs);
    this.cells = createCabinet(this.herbs.map(h => h.name));
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
    this.openDrawerIndex = null;
    this.organizeSource = null;
    this.draggingHerb = null;
    this.flashIndex = null;
    this.flashTime = 0;
    this.message = null;
    this.messageTime = 0;
    this.phase = 'playing';
  }

  tick(now: number): void {
    if (this.phase !== 'playing' && this.phase !== 'weighing' && this.phase !== 'organize') return;
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
      if (this.flashTime <= 0) this.flashIndex = null;
    }
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = null;
    }
  }

  private notify(text: string, seconds = 2): void {
    this.message = text;
    this.messageTime = seconds;
  }

  /** 抓药阶段拉开一格：累计翻找可能把药翻乱，拉错（里面不是处方上要的药）红闪 */
  selectDrawer(index: number): { pull: PullResult; ok: boolean } {
    if (!this.prescription) return { pull: 'disabled', ok: false };
    const pull = pullDrawer(this.cells, index, this.levelConfig.requireOrganize);
    this.openDrawerIndex = index;
    const content = this.cells[index].content;
    const needed = this.prescription.items.find(i => i.herb === content && !this.weighed.has(i.herb));
    if (!needed) {
      this.flashIndex = index;
      this.flashTime = 0.5;
      if (pull === 'scrambled') this.notify('翻找时药被弄乱了，拉开几格认一认吧');
      return { pull, ok: false };
    }
    this.currentHerb = content;
    this.targetGrams = needed.grams;
    this.currentWeight = 0;
    this.phase = 'weighing';
    return { pull, ok: true };
  }

  enterOrganize(): void {
    if (this.phase !== 'playing' || !this.levelConfig.requireOrganize) return;
    this.phase = 'organize';
    this.organizeSource = null;
  }

  exitOrganize(): void {
    if (this.phase !== 'organize') return;
    this.phase = 'playing';
    this.openDrawerIndex = null;
    this.organizeSource = null;
  }

  /**
   * 整理阶段点一格：
   * 没有选中来源时——拉开认药（仍可能翻乱），药在位就只是确认，错位则选中待归位；
   * 已有来源时——再点来源格取消，点其它格尝试归位。
   */
  organizeClick(index: number): OrganizeAction {
    if (this.phase !== 'organize') return 'cancel';

    if (this.organizeSource === null) {
      const wasInspected = this.cells[index].inspected;
      const pull = pullDrawer(this.cells, index, true);
      this.openDrawerIndex = index;
      const cell = this.cells[index];
      if (cell.label === cell.content) {
        if (pull === 'scrambled') {
          this.notify('翻得太勤又乱了一格，得重新认');
          return 'scrambled';
        }
        // 之前已经认过/归位过，再想动它就是白做一趟
        if (wasInspected) {
          this.notify('这格本来就是对的，白做一趟');
          return 'already-home';
        }
        this.notify(`这格是${cell.label}，没放错`);
        return 'pull';
      }
      this.organizeSource = index;
      if (pull === 'scrambled') this.notify('翻找时又弄乱了；先把手里的药归位');
      return pull === 'scrambled' ? 'scrambled' : 'picked';
    }

    if (index === this.organizeSource) {
      this.organizeSource = null;
      return 'cancel';
    }

    const result: RestoreResult = restoreDrawer(this.cells, this.organizeSource, index);
    if (result === 'restored') {
      this.organizeSource = null;
      this.openDrawerIndex = index;
      if (misplacedCount(this.cells) === 0) {
        this.notify('全部归位，药柜整齐了');
        return 'done';
      }
      this.notify('归位一味');
      return 'restored';
    }
    if (result === 'already-home') this.notify('这格本来就是对的，白做一趟');
    else if (result === 'wrong-target') this.notify(`这格写的是${this.cells[index].label}，药名对不上`);
    else this.notify('还没拉开认过，不知道里面是什么');
    return result;
  }

  getOrganizeProgress(): { done: number; total: number } {
    const total = this.cells.length;
    return { done: total - misplacedCount(this.cells), total };
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

    this.currentHerb = null;
    this.currentWeight = 0;
    this.zeroOffset = 0;
    this.openDrawerIndex = null;

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
}
