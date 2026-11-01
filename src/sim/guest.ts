import { DECK_LIST, DECKS, GUEST_DECKS } from '../data/decks';
import { BALANCE } from '../engine/config';
import { createGame, validateDeck, type DeckSpec } from '../engine/game';
import type { Faction } from '../engine/types';
import { playGame } from './bot';

// 프리셋 덱 측정: 모든 프리셋 덱(종족 덱·객원 덱)의 세 세력 기본 덱 상대 승률.
// 객원 덱은 같은 세력 기본 덱의 승률과 비교하고,
// 남의 색 가산(colorTax)을 바꿔 가며 돌려 적당한 값을 찾는다. 사용: npm run guest -- 200 [--decks: 프리셋 덱만]
const N = Number(process.argv[2] ?? 200);
const factions: Faction[] = ['union', 'covalent', 'decay'];
// 남의 색 아이콘 하나당 비용 가산 후보
const TAXES = [0, 0.5, 1, 1.5];

// 덱 a의 기본 덱 3개 상대 승률 (선후공 교대, 같은 시드)
function rates(a: DeckSpec): number[] {
  return factions.map((f) => {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const aFirst = i % 2 === 0;
      const { state } = playGame(createGame(aFirst ? a : DECKS[f], aFirst ? DECKS[f] : a, i * 7919 + 13));
      if (state.winner === (aFirst ? 0 : 1)) wins++;
    }
    return wins / N;
  });
}

const pct = (v: number) => `${(v * 100).toFixed(0).padStart(3)}%`;
const fmt = (r: number[]) => r.map(pct).join(' ') + `  | 평균 ${pct(r.reduce((a, b) => a + b, 0) / r.length)}`;

for (const g of DECK_LIST) {
  const errors = validateDeck(g.spec);
  if (errors.length) throw new Error(`${g.name}: ${errors.join(', ')}`);
}

console.log(`
== 프리셋 덱 (${N}판씩, vs ${factions.join(' / ')}) ==`);
for (const d of DECK_LIST) console.log(`  ${d.spec.faction.padEnd(9)} ${d.name.padEnd(14)} ${fmt(rates(d.spec))}`);
if (process.argv.includes('--decks')) process.exit(0);

const { colorTax } = BALANCE.deck;
console.log(`\n== 객원 덱 (${N}판씩, vs ${factions.join(' / ')}) ==`);
for (const g of GUEST_DECKS) {
  console.log(`\n${g.name}`);
  console.log(`  ${'기본 덱'.padEnd(16)}  ${fmt(rates(DECKS[g.spec.faction]))}`);
  for (const tax of TAXES) {
    BALANCE.deck.colorTax = tax;
    console.log(`  ${(`색 아이콘당 +${tax}` + (tax === colorTax ? ' (현재)' : '')).padEnd(16)}  ${fmt(rates(g.spec))}`);
  }
  BALANCE.deck.colorTax = colorTax;
}
