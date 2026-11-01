import type { CardDef, EffectDef } from '../engine/types';
import { WEIGHTS as W } from './weights';

export type Breakdown = { label: string; points: number };
export type Score = { items: Breakdown[]; total: number; budget: number; diff: number };

export function budgetOf(level: number, upkeep = 0): number {
  return W.budget.base + W.budget.perLevel * level + W.upkeepRebate * upkeep;
}

function keywordOf(def: Pick<CardDef, 'keywords'>, key: string): number | undefined {
  const kw = def.keywords?.find((k) => k.startsWith(key + ':'));
  return kw ? Number(kw.split(':')[1]) : undefined;
}
const halfLifeOf = (def: Pick<CardDef, 'keywords'>) => keywordOf(def, 'halfLife');

// 능력 한 줄 설명 (카드 문구와 점수표가 같이 쓴다)
export function effectBody(op: string, a: Record<string, number>): string {
  switch (op) {
    case 'entropy': return `상대 엔트로피 +${a.n}`;
    case 'strikeOpposite': return `맞은편 적 ${a.n} 피해`;
    case 'draw': return `${a.n}장 드로우`;
    case 'gainPool': return `자원 +${a.n}`;
    case 'buffSelf': return `+${a.atk ?? 0}/+${a.hp ?? 0}`;
    case 'healSelf': return `체력 ${a.n} 회복`;
    default: return `${op} ${a.n ?? ''}`;
  }
}

export function triggerLabel(e: Pick<EffectDef, 'trigger' | 'chain'>): string {
  return e.trigger === 'onDeath' ? '파괴 시' : e.trigger === 'onCharge' ? '충전 시' : e.chain ? '연쇄' : '소환';
}

function effectPoints(op: string, args: Record<string, number>): number {
  if (op === 'buffSelf') return (args.atk ?? 0) * W.atk + (args.hp ?? 0) * W.hp;
  const w = W.op[op];
  if (w === undefined) throw new Error(`weights.ts에 op '${op}' 가중치가 없다`);
  return w * (args.n ?? 0);
}

// diff = 점수 - 예산. 0 이하면 레벨에 맞는 카드, 양수면 레벨 대비 강하다.
export function scoreCard(def: Pick<CardDef, 'level' | 'atk' | 'hp' | 'upkeep' | 'keywords' | 'effects'>): Score {
  const items: Breakdown[] = [];
  const hl = halfLifeOf(def);
  const stats = def.atk * W.atk + def.hp * W.hp;
  const factor = hl === undefined ? 1 : W.halfLifeFactor[Math.min(hl, 4)] ?? 1;
  items.push({ label: `스탯 ${def.atk}/${def.hp}${hl === undefined ? '' : ` (반감기 ${hl} ×${factor})`}`, points: stats * factor });
  const armor = keywordOf(def, 'armor');
  if (armor) items.push({ label: `방어력 ${armor}`, points: armor * W.armor });
  const resist = keywordOf(def, 'resist');
  if (resist) items.push({ label: `저항 ${resist}`, points: resist * W.resist });
  const charge = keywordOf(def, 'charge');
  for (const e of def.effects ?? []) {
    let pts = effectPoints(e.op, e.args ?? {});
    if (e.chain) pts *= W.chainFactor;
    if (e.trigger === 'onDeath') pts *= W.onDeathFactor;
    if (e.trigger === 'onCharge') pts *= charge ? W.chargeFactor[Math.min(charge, 4)] ?? 0 : 0; // 기력 없으면 발동 안 함
    items.push({ label: `${triggerLabel(e)}: ${effectBody(e.op, e.args ?? {})}`, points: pts });
  }
  const total = items.reduce((a, b) => a + b.points, 0);
  const budget = budgetOf(def.level, def.upkeep ?? 0);
  return { items, total, budget, diff: total - budget };
}

// 예산 안에서 효과 점수를 뺀 나머지로 만들 수 있는 atk/hp 조합 (atk+hp 최대치에 맞춘 것만)
export function statSplits(level: number, upkeep: number, otherPoints: number, hl?: number): { atk: number; hp: number }[] {
  const factor = hl === undefined ? 1 : W.halfLifeFactor[Math.min(hl, 4)] ?? 1;
  const statBudget = Math.floor((budgetOf(level, upkeep) - otherPoints) / factor);
  const out: { atk: number; hp: number }[] = [];
  for (let atk = 0; atk * W.atk <= statBudget; atk++) out.push({ atk, hp: Math.floor((statBudget - atk * W.atk) / W.hp) });
  return out.filter((s) => s.hp >= 1);
}

// 점수 total을 감당하는 가장 낮은 레벨 (최대 레벨을 넘으면 maxLevel+1을 돌려준다)
export function levelFor(total: number, upkeep = 0): number {
  for (let lv = 1; lv <= W.maxLevel; lv++) if (budgetOf(lv, upkeep) >= total - 1e-9) return lv;
  return W.maxLevel + 1;
}

// 레벨을 고정하고 atk/hp를 예산에 맞춘다. pin이 있으면 그 값은 되도록 유지하고 나머지를 맞추고,
// 없으면 현재 atk:hp 비율에 가장 가까운 조합을 고른다.
export function fitStats(
  level: number, upkeep: number, otherPoints: number, hl: number | undefined,
  cur: { atk: number; hp: number }, pin?: 'atk' | 'hp',
): { atk: number; hp: number } {
  const splits = statSplits(level, upkeep, otherPoints, hl);
  if (!splits.length) return { atk: 0, hp: 1 };
  const dist = (s: { atk: number; hp: number }) => pin
    ? Math.abs(s[pin] - cur[pin])
    : Math.abs(s.atk / (s.atk + s.hp) - cur.atk / Math.max(1, cur.atk + cur.hp));
  return splits.reduce((best, s) => (dist(s) < dist(best) ? s : best));
}
