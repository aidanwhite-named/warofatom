import { getCard } from '../data/cards';
import { DECKS } from '../data/decks';
import { createGame } from '../engine/game';
import type { CardDef, Faction } from '../engine/types';
import { playGame } from '../sim/bot';
import { budgetOf, scoreCard } from './score';
import { WEIGHTS } from './weights';

// 시뮬레이션으로 weights.ts 점수표를 검증한다. 사용: npm run calibrate [N]
// 카드마다 같은 레벨·같은 예산의 '바닐라'(효과·키워드 없음, 예산을 공격/체력에 다 쓴 카드)로 바꿔 끼우고 승률 변화를 잰다.
//   점수표가 맞다면: 원본과 바닐라의 승률 차이 ≈ 점수 차이(diff) × (스탯 1점의 승률 가치)
//   스탯 1점의 승률 가치는 바닐라에 체력 +1을 준 판과 비교해 모든 카드 평균으로 구한다.
// 모든 변형은 같은 시드로 돌려(paired) 노이즈를 줄인다. N은 상대 진영당 판수.
const N = Number(process.argv[2] ?? 150);
const factions: Faction[] = ['union', 'covalent', 'decay'];

// 진영 f의 다른 두 진영 상대 승률 (선후공 교대)
function winRate(f: Faction): number {
  let wins = 0, games = 0;
  for (const g of factions) {
    if (g === f) continue;
    for (let i = 0; i < N; i++) {
      const fFirst = i % 2 === 0;
      const { state } = playGame(createGame(fFirst ? DECKS[f] : DECKS[g], fFirst ? DECKS[g] : DECKS[f], i * 7919 + 13));
      if (state.winner === (fFirst ? 0 : 1)) wins++;
      games++;
    }
  }
  return wins / games;
}

// 카드 정의를 잠시 바꿔서 승률을 재고 되돌린다 (엔진은 getCard로 매번 정의를 읽는다)
function withCard(def: CardDef, patch: Partial<CardDef>, run: () => number): number {
  const orig = { kind: def.kind, atk: def.atk, hp: def.hp, effects: def.effects, keywords: def.keywords };
  Object.assign(def, patch);
  try { return run(); } finally { Object.assign(def, orig); }
}

// 마법은 스탯이 없으니 같은 예산의 바닐라 '유닛'과 비교한다 (아이템은 바닐라 아이템)
function vanillaOf(def: CardDef): Partial<CardDef> {
  const budget = budgetOf(def.level, def.upkeep ?? 0);
  const atk = def.atk + def.hp > 0 ? Math.round((budget * def.atk) / (def.atk + def.hp)) : Math.ceil(budget / 2);
  const kind = def.kind === 'spell' ? undefined : def.kind;
  return { kind, atk, hp: Math.max(1, budget - atk), effects: undefined, keywords: undefined };
}

type Row = { def: CardDef; copies: number; scoreDiff: number; delta: number; unitDelta: number };
const rows: Row[] = [];
const base: Record<string, number> = {};
for (const f of factions) {
  base[f] = winRate(f);
  const counts = new Map<string, number>();
  for (const id of DECKS[f].cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, copies] of counts) {
    const def = getCard(id);
    const van = vanillaOf(def);
    const wVan = withCard(def, van, () => winRate(f));
    const wVan1 = withCard(def, { ...van, hp: van.hp! + 1 }, () => winRate(f));
    rows.push({ def, copies, scoreDiff: scoreCard(def).diff, delta: (base[f] - wVan) / copies, unitDelta: (wVan1 - wVan) / copies });
    process.stderr.write('.');
  }
}
process.stderr.write('\n');

// 스탯 1점 = 장당 승률 k
const k = rows.reduce((a, r) => a + r.unitDelta, 0) / rows.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%p`;
const fmt = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
console.log(`\n스탯 1점 = 장당 승률 ${pct(k)} (카드 ${rows.length}종 평균, 상대 진영당 ${N}판)`);
if (k <= 0) console.log('⚠ 스탯 1점 가치가 0 이하로 나왔다. N을 늘려서 다시 돌릴 것.');

// sim = 시뮬레이션이 본 점수 차이. 점수표가 맞으면 score와 비슷해야 한다.
const simDiff = (r: Row) => r.delta / k;
console.log('\n카드별 (차이 = sim - score, 양수면 점수표가 이 카드를 과소평가)');
console.log('id'.padEnd(14), '진영'.padEnd(9), '장수', 'score'.padStart(6), 'sim'.padStart(6), '차이'.padStart(6));
for (const r of [...rows].sort((a, b) => Math.abs(simDiff(b) - b.scoreDiff) - Math.abs(simDiff(a) - a.scoreDiff))) {
  const gap = simDiff(r) - r.scoreDiff;
  console.log(r.def.id.padEnd(14), r.def.faction.padEnd(9), String(r.copies).padStart(3), fmt(r.scoreDiff).padStart(7), fmt(simDiff(r)).padStart(6), fmt(gap).padStart(6), Math.abs(gap) > 2 ? ' ◀' : '');
}

// 효과 op별 가중치 제안: 효과 1개짜리, 반감기 없는 카드만 (효과 점수 + 차이) / (n × 할인)
console.log('\n효과 가중치 제안 (효과 1개·반감기 없는 카드 기준)');
const byOp = new Map<string, number[]>();
for (const r of rows) {
  const fx = r.def.effects ?? [];
  if (fx.length !== 1 || r.def.keywords?.length || fx[0].op === 'buffSelf') continue;
  const e = fx[0];
  const mult = (e.args?.n ?? 0) * (e.chain ? WEIGHTS.chainFactor : 1) * (e.trigger === 'onDeath' ? WEIGHTS.onDeathFactor : 1);
  const fxPoints = scoreCard(r.def).items[1].points;
  byOp.set(e.op, [...(byOp.get(e.op) ?? []), (fxPoints + simDiff(r) - r.scoreDiff) / mult]);
}
for (const [op, xs] of byOp) {
  console.log(`${op.padEnd(16)} 현재 ${WEIGHTS.op[op].toFixed(1)}  →  시뮬 ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}  (카드 ${xs.length}종)`);
}

// 진영 요약: 카드 점수가 공정한데도 승률이 기울면 진영 규칙(자원 곡선 등)의 문제
console.log('\n진영 요약');
for (const f of factions) {
  const rs = rows.filter((r) => r.def.faction === f);
  const total = rs.reduce((a, r) => a + r.copies, 0);
  const avg = (sel: (r: Row) => number) => rs.reduce((a, r) => a + sel(r) * r.copies, 0) / total;
  console.log(`${f.padEnd(9)} 승률 ${(base[f] * 100).toFixed(0)}%  덱 평균 score ${fmt(avg((r) => r.scoreDiff))}  sim ${fmt(avg(simDiff))}`);
}
