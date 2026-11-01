import { BALANCE } from './config';
import type { Faction, PlayerState } from './types';

// 진영별 자원 규칙. 수치는 config.ts, 설명은 docs/rules.md 5절.
type ResourceRule = { onTurnStart(p: PlayerState): void };

export const resourceRules: Record<Faction, ResourceRule> = {
  union: {
    onTurnStart(p) {
      const b = BALANCE.union;
      const income = p.bases * BALANCE.base.income;
      const interest = Math.min(Math.floor(p.pool / b.interestPer), b.interestMax);
      p.pool = Math.min(p.pool + income + interest, b.goldCap);
    },
  },
  covalent: {
    onTurnStart(p) {
      const b = BALANCE.covalent;
      // 결합: 가진 대지도 성소처럼 신앙을 낸다
      p.pool = p.bases * BALANCE.base.income + (p.bases >= b.resonanceAt ? b.resonanceBonus : 0) + p.elements.length * BALANCE.elements.bondPool;
    },
  },
  decay: {
    onTurnStart(p) {
      p.pool = p.bases * BALANCE.base.income;
    },
  },
};

export const decayGain = {
  hand: (level: number) => level + BALANCE.decay.decayHandBonus,
  board: (level: number) => level + BALANCE.decay.decayBoardBonus,
};
