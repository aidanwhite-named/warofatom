import { describe, expect, it } from 'vitest';
import { budgetOf, fitStats, levelFor, scoreCard, statSplits } from './score';

describe('scoreCard', () => {
  it('vanilla stats are 1 point each, discounted effects score less than raw', () => {
    expect(scoreCard({ level: 1, atk: 2, hp: 1 }).total).toBe(3);
    const raw = scoreCard({ level: 3, atk: 0, hp: 0, effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }] }).total;
    const chain = scoreCard({ level: 3, atk: 0, hp: 0, effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }] }).total;
    expect(chain).toBeLessThan(raw);
  });

  it('upkeep raises the budget', () => {
    expect(budgetOf(4, 2)).toBeGreaterThan(budgetOf(4, 0));
  });

  it('splits spend the remaining budget on atk/hp', () => {
    const splits = statSplits(3, 0, 0);
    expect(splits.every((s) => s.atk + s.hp === budgetOf(3))).toBe(true);
  });
});

describe('levelFor / fitStats', () => {
  it('level is the lowest one whose budget covers the score, upkeep lowers it', () => {
    expect(levelFor(budgetOf(4))).toBe(4);
    expect(levelFor(budgetOf(4) + 0.1)).toBe(5);
    expect(levelFor(budgetOf(4), 1)).toBeLessThan(4);
    expect(levelFor(999)).toBeGreaterThan(9);
  });

  it('fitStats keeps the pinned stat and spends the rest of the budget', () => {
    const r = fitStats(4, 0, 0, undefined, { atk: 3, hp: 3 }, 'atk');
    expect(r).toEqual({ atk: 3, hp: budgetOf(4) - 3 });
    const clamped = fitStats(4, 0, 0, undefined, { atk: 99, hp: 1 }, 'atk');
    expect(clamped.atk + clamped.hp).toBe(budgetOf(4));
  });
});
