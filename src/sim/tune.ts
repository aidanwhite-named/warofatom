import { DECKS } from '../data/decks';
import { BALANCE } from '../engine/config';
import { createGame } from '../engine/game';
import type { Faction } from '../engine/types';
import { playGame } from './bot';

// 밸런스 후보 여러 개를 빠르게 비교. 사용: npm run tune
type Patch = (b: typeof BALANCE) => void;
const base = structuredClone(BALANCE);
const candidates: Record<string, Patch> = {
  current: () => {},
  draw0: (b) => { b.decay.decayDraw = 0; },
  draw0_start0: (b) => { b.decay.decayDraw = 0; b.decay.baseStart = 0; },
  draw0_every3_start2: (b) => { b.decay.decayDraw = 0; b.decay.baseEvery = 3; b.decay.baseStart = 2; },
  draw0_every3_board4: (b) => { b.decay.decayDraw = 0; b.decay.baseEvery = 3; b.decay.decayBoardBonus = 4; },
  draw0_lat1: (b) => { b.decay.decayDraw = 0; b.covalent.startLattices = 1; },
  draw0_lat1_pile8: (b) => { b.decay.decayDraw = 0; b.covalent.startLattices = 1; b.covalent.pileSize = 8; },
  draw0_lat1_res0: (b) => { b.decay.decayDraw = 0; b.covalent.startLattices = 1; b.covalent.resonanceBonus = 0; },
  draw0_start0_lat1_res0: (b) => { b.decay.decayDraw = 0; b.decay.baseStart = 0; b.covalent.startLattices = 1; b.covalent.resonanceBonus = 0; },
};

const N = Number(process.argv[2] ?? 150);
const pairs: [Faction, Faction][] = [['union', 'covalent'], ['union', 'decay'], ['covalent', 'decay']];
for (const [name, patch] of Object.entries(candidates)) {
  Object.assign(BALANCE, structuredClone(base));
  patch(BALANCE);
  const out: string[] = [];
  let firstWins = 0, games = 0;
  for (const [a, b] of pairs) {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const aFirst = i % 2 === 0;
      const { state } = playGame(createGame(aFirst ? DECKS[a] : DECKS[b], aFirst ? DECKS[b] : DECKS[a], i * 7919 + 13));
      if (state.winner === (aFirst ? 0 : 1)) wins++;
      if (state.winner === 0) firstWins++;
      games++;
    }
    out.push(`${a[0]}>${b[0]} ${((wins / N) * 100).toFixed(0)}%`);
  }
  console.log(name.padEnd(28), out.join('  '), ` 선공승 ${((firstWins / games) * 100).toFixed(0)}%`);
}
