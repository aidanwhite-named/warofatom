import { BALANCE } from './config';
import type { Faction, PlayerState } from './types';

// 진영별 자원 규칙. 수치는 config.ts, 설명은 docs/rules.md 5절.
type ResourceRule = { onTurnStart(p: PlayerState): void };

export const resourceRules: Record<Faction, ResourceRule> = {
  union: {
    onTurnStart(p) {
      const b = BALANCE.union;
      const income = Math.min(b.incomeBase + Math.floor(p.turns / b.incomeEvery), b.incomeMax);
      const interest = Math.min(Math.floor(p.pool / b.interestPer), b.interestMax);
      p.pool = Math.min(p.pool + income + interest, b.goldCap);
    },
  },
  covalent: {
    onTurnStart(p) {
      const b = BALANCE.covalent;
      p.pool = p.lattices + (p.lattices >= b.resonanceAt ? b.resonanceBonus : 0);
    },
  },
  decay: {
    onTurnStart(p) {
      p.pool = BALANCE.decay.baseStart + Math.floor(p.turns / BALANCE.decay.baseEvery);
    },
  },
};

export const decayGain = {
  hand: (level: number) => level + BALANCE.decay.decayHandBonus,
  board: (level: number) => level + BALANCE.decay.decayBoardBonus,
};
