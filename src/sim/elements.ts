import { DECKS } from '../data/decks';
import { ELEMENTS } from '../data/elements';
import { BALANCE } from '../engine/config';
import { createGame } from '../engine/game';
import type { Faction } from '../engine/types';
import { playGame } from './bot';

// 원소 타일의 영향 측정. 사용: npm run elements [N]  (N = 진영 조합당 판수)
//   1) 같은 시드로 원소 끔 / 지맥만 끔 / 전부 켬 진영 상성 비교
//   2) 획득 수와 승패의 관계 (상관일 뿐: 이기고 있는 쪽이 레인을 지켜 획득하기도 쉽다)
//   3) 원소별·지맥별: 그 원소가 처음 깔린 판 / 그 계열이 지맥인 판에서 각 진영 승률이 평소보다 얼마나 달라지는지.
//      처음 깔리는 원소와 지맥은 무작위라 승패의 결과가 아니라 원인으로 볼 수 있다 (한 진영만 크게 밀어주는 원소·지맥 찾기)
const N = Number(process.argv[2] ?? 300);
const pairs: [Faction, Faction][] = [['union', 'covalent'], ['union', 'decay'], ['covalent', 'decay']];
const factions: Faction[] = ['union', 'covalent', 'decay'];
const KO: Record<Faction, string> = { union: '연맹', covalent: '방벽', decay: '교단' };
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function play(a: Faction, b: Faction, i: number) {
  const aFirst = i % 2 === 0;
  const start = createGame(aFirst ? DECKS[a] : DECKS[b], aFirst ? DECKS[b] : DECKS[a], i * 7919 + 13);
  const { state } = playGame(start);
  return { state, aSeat: (aFirst ? 0 : 1) as 0 | 1, startTiles: start.tiles.filter((t): t is string => !!t) };
}

function matchups(elements: boolean, leyline: boolean): number[] {
  BALANCE.elements.enabled = elements;
  BALANCE.elements.leyline.enabled = leyline;
  return pairs.map(([a, b]) => {
    let wins = 0;
    for (let i = 0; i < N; i++) { const { state, aSeat } = play(a, b, i); if (state.winner === aSeat) wins++; }
    return wins / N;
  });
}

const off = matchups(false, false);
const noLey = matchups(true, false);
const on = matchups(true, true);
console.log(`\n== 진영 상성: 원소 끔 → 지맥 없이 원소만 → 지맥까지 (${N}판씩, 같은 시드) ==`);
pairs.forEach(([a, b], k) => console.log(`${KO[a]} vs ${KO[b]}: ${pct(off[k])} → ${pct(noLey[k])} → ${pct(on[k])}`));

// 전부 켠 상태로 상세 기록
type Cell = Record<Faction, { n: number; w: number }>;
const games: Record<Faction, number> = { union: 0, covalent: 0, decay: 0 };
const wins: Record<Faction, number> = { union: 0, covalent: 0, decay: 0 };
const zero = () => ({ union: 0, covalent: 0, decay: 0 });
// 진영별 원소 이벤트 횟수 (획득, 연맹 반응, 교단 원소 붕괴, 교단 붕괴 사슬)
const uses: Record<'capture' | 'react' | 'burn' | 'transmute', Record<Faction, number>> = { capture: zero(), react: zero(), burn: zero(), transmute: zero() };
const byTile = new Map<string, Cell>();
const byLeyline = new Map<string, Cell>();
const record = (map: Map<string, Cell>, key: string, f: Faction, won: boolean) => {
  const row = map.get(key) ?? { union: { n: 0, w: 0 }, covalent: { n: 0, w: 0 }, decay: { n: 0, w: 0 } };
  row[f].n++;
  if (won) row[f].w++;
  map.set(key, row);
};
let decided = 0, moreWins = 0;
for (const [a, b] of pairs) {
  for (let i = 0; i < N; i++) {
    const { state, startTiles } = play(a, b, i);
    const counts = [0, 1].map((seat) => state.log.filter((e) => e.t === 'capture' && e.p === seat).length);
    for (const e of state.log) {
      if (e.t === 'capture' || e.t === 'react' || e.t === 'burn' || e.t === 'transmute') uses[e.t][state.players[e.p].faction]++;
    }
    if (counts[0] !== counts[1] && state.winner !== null) { decided++; if (counts[state.winner] > counts[1 - state.winner]) moreWins++; }
    state.players.forEach((pl, seat) => {
      const won = state.winner === seat;
      games[pl.faction]++;
      if (won) wins[pl.faction]++;
      for (const el of startTiles) record(byTile, el, pl.faction, won);
      if (state.leyline) record(byLeyline, state.leyline, pl.faction, won);
    });
  }
}

console.log(`\n== 획득 ==`);
const per = (n: number, f: Faction) => (n / games[f]).toFixed(2);
for (const f of factions) {
  const use = f === 'union' ? `반응 ${per(uses.react[f], f)}회` : f === 'decay' ? `원소 붕괴 ${per(uses.burn[f], f)}회, 붕괴 사슬 ${per(uses.transmute[f], f)}회` : '결합(자동)';
  console.log(`${KO[f]}: 판당 획득 ${per(uses.capture[f], f)}개, ${use}, 승률 ${pct(wins[f] / games[f])}`);
}
console.log(`획득 수가 다른 판에서 더 많이 획득한 쪽의 승률: ${pct(moreWins / Math.max(1, decided))} (${decided}판, 상관관계)`);

// 표: 행마다 각 진영 승률과 그 진영 평균 대비 차이 (%p). ±8%p 이상이면 표시
function printTable(title: string, rows: [string, Cell | undefined][]) {
  console.log(`\n== ${title} (괄호는 그 진영 평균 대비 %p, n = 판수) ==`);
  for (const [label, row] of rows) {
    const cells = factions.map((f) => {
      const c = row?.[f];
      if (!c || c.n < 10) return `${KO[f]}    -           `;
      const d = c.w / c.n - wins[f] / games[f];
      const flag = Math.abs(d) >= 0.08 ? (d > 0 ? ' ▲' : ' ▽') : '  ';
      return `${KO[f]} ${pct(c.w / c.n).padStart(4)}(${d >= 0 ? '+' : ''}${(d * 100).toFixed(0).padStart(2)}, n${c.n})${flag}`;
    });
    console.log(`${label} ${cells.join('  ')}`);
  }
}
const tiles = ELEMENTS.filter((x) => !x.product);
printTable('원소별: 처음 깔린 판에서 각 진영 승률', tiles.map((e) => [`${e.symbol.padEnd(3)} ${e.group.padEnd(6)}`, byTile.get(e.symbol)]));
printTable('지맥별: 그 계열이 지맥인 판에서 각 진영 승률', [...new Set(tiles.map((e) => e.group))].map((g) => [g.padEnd(6), byLeyline.get(g)]));
