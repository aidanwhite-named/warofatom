import { DECKS } from '../data/decks';
import { createGame } from '../engine/game';
import type { Faction } from '../engine/types';
import { playGame } from './bot';

const N = Number(process.argv[2] ?? 500);
const factions: Faction[] = ['union', 'covalent', 'decay'];
const TURNS = 10;

const curveSum: Record<Faction, number[]> = { union: [], covalent: [], decay: [] };
const curveCnt: Record<Faction, number[]> = { union: [], covalent: [], decay: [] };

console.log(`\n== 진영 상성 (${N}판 × 선후공 교대, 행 기준 승률) ==`);
for (const a of factions) {
  const row: string[] = [];
  for (const b of factions) {
    let wins = 0, turns = 0, firstWins = 0;
    for (let i = 0; i < N; i++) {
      const aFirst = i % 2 === 0;
      const s = createGame(aFirst ? DECKS[a] : DECKS[b], aFirst ? DECKS[b] : DECKS[a], i * 7919 + 13);
      const { state, curve } = playGame(s);
      const aSeat = aFirst ? 0 : 1;
      if (state.winner === aSeat) wins++;
      if (state.winner === 0) firstWins++;
      turns += state.turn;
      ([0, 1] as const).forEach((seat) => {
        const f = state.players[seat].faction;
        for (let k = 0; k < TURNS; k++) {
          if (k >= state.players[seat].turns) break;
          curveSum[f][k] = (curveSum[f][k] ?? 0) + (curve[seat][k] ?? 0);
          curveCnt[f][k] = (curveCnt[f][k] ?? 0) + 1;
        }
      });
    }
    row.push(`${b.padEnd(8)} ${((wins / N) * 100).toFixed(0).padStart(3)}% (평균 ${(turns / N).toFixed(1)}턴, 선공승 ${((firstWins / N) * 100).toFixed(0)}%)`);
  }
  console.log(`${a.padEnd(8)} vs  ${row.join('  |  ')}`);
}

console.log(`\n== 템포 곡선: 내 N번째 턴에 소환한 최고 레벨 (평균) ==`);
console.log('turn     ' + Array.from({ length: TURNS }, (_, i) => String(i + 1).padStart(5)).join(''));
for (const f of factions) {
  const vals = Array.from({ length: TURNS }, (_, k) => (curveCnt[f][k] ? curveSum[f][k] / curveCnt[f][k] : 0));
  console.log(f.padEnd(9) + vals.map((v) => v.toFixed(1).padStart(5)).join(''));
}
