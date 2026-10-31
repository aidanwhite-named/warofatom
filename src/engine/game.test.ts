import { describe, expect, it } from 'vitest';
import { DECKS } from '../data/decks';
import { applyAction, createGame, legalActions } from './game';
import { BALANCE } from './config';
import type { GameState } from './types';

// 손패를 원하는 카드로 바꿔 끼우는 테스트 헬퍼
function giveHand(s: GameState, p: 0 | 1, ids: string[]) {
  s.players[p].hand = ids.map((cardId) => ({ uid: s.nextUid++, cardId }));
  return s.players[p].hand.map((c) => c.uid);
}

const endTurn = (s: GameState) => applyAction(s, { type: 'endTurn' });

describe('entropy', () => {
  it('rises naturally each own turn start', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    expect(s.players[0].entropy).toBe(BALANCE.naturalEntropy);
    expect(s.players[1].entropy).toBe(0);
    s = endTurn(s);
    expect(s.players[1].entropy).toBe(BALANCE.naturalEntropy);
  });
});

describe('setup', () => {
  it('deals starting hands and starts player 0 turn', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 7);
    expect(s.players[0].hand).toHaveLength(BALANCE.startHand[0]);
    expect(s.players[1].hand).toHaveLength(BALANCE.startHand[1]);
    expect(s.players[0].pool).toBe(BALANCE.union.incomeBase);
    expect(s.players[1].lattices).toBe(BALANCE.covalent.startLattices);
  });
});

describe('union gold', () => {
  it('carries over and earns interest', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    const pools: number[] = [];
    for (let i = 0; i < 4; i++) {
      pools.push(s.players[0].pool);
      s = endTurn(endTurn(s));
    }
    // 수입 2,2,3,3 / 이자: 4금화당 +1 / 상한 10
    expect(pools).toEqual([2, 4, 8, 10]);
  });
});

describe('covalent lattice', () => {
  it('one lattice per turn from separate pile, pool resets to lattice count', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s = applyAction(s, { type: 'lattice' });
    expect(() => applyAction(s, { type: 'lattice' })).toThrow();
    expect(s.players[0].latticePile).toBe(BALANCE.covalent.pileSize - 1);
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(BALANCE.covalent.startLattices + 1);
  });

  it('resonance bonus at threshold', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    const { resonanceAt, resonanceBonus } = BALANCE.covalent;
    s.players[0].lattices = resonanceAt;
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(resonanceAt + resonanceBonus);
  });
});

describe('combat', () => {
  it('summoning sickness, entropy hit on empty lane, simultaneous trade', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].pool = 5;
    const [na] = giveHand(s, 0, ['na_runner']);
    s = applyAction(s, { type: 'play', uid: na, lane: 0 });
    expect(() => applyAction(s, { type: 'attack', lane: 0 })).toThrow();
    s = endTurn(s);
    s = endTurn(s);
    const before = s.players[1].entropy;
    s = applyAction(s, { type: 'attack', lane: 0 });
    expect(s.players[1].entropy).toBe(before + 2);

    s = endTurn(s);
    s.players[1].pool = 5;
    const [mg] = giveHand(s, 1, ['mg_guard']);
    s = applyAction(s, { type: 'play', uid: mg, lane: 0 });
    s = endTurn(s);
    s = applyAction(s, { type: 'attack', lane: 0 });
    // 나트륨 2/1 vs 마그네슘 1/4 → 나트륨 사망, 마그네슘 hp 2
    expect(s.players[0].lanes[0]).toBeNull();
    expect(s.players[1].lanes[0]?.hp).toBe(2);
  });

  it('wins when opponent entropy fills up', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[1].entropy = BALANCE.maxEntropy - 2;
    s.players[0].lanes[1] = { uid: 999, cardId: 'na_runner', atk: 2, hp: 1, sick: false, attacked: false };
    s = applyAction(s, { type: 'attack', lane: 1 });
    expect(s.winner).toBe(0);
    expect(legalActions(s)).toEqual([]);
  });
});

describe('union chain', () => {
  it('triggers only on the second unit of the turn', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 10;
    const [k1, k2] = giveHand(s, 0, ['k_burst', 'k_burst']);
    s = applyAction(s, { type: 'play', uid: k1, lane: 0 });
    expect(s.players[1].entropy).toBe(0);
    s = applyAction(s, { type: 'play', uid: k2, lane: 1 });
    expect(s.players[1].entropy).toBe(2);
  });
});

describe('decay faction', () => {
  it('decays hand card for burst summon', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    const [og, th, fl] = giveHand(s, 0, ['og_titan', 'th_herald', 'fl_flicker']);
    const pool0 = s.players[0].pool;
    s = applyAction(s, { type: 'decay', from: 'hand', uid: th }); // 토륨 L4
    expect(s.players[0].pool).toBe(pool0 + 4 + BALANCE.decay.decayHandBonus);
    s = applyAction(s, { type: 'decay', from: 'hand', uid: fl }); // +6
    s = applyAction(s, { type: 'play', uid: og, lane: 2 });
    expect(s.players[0].lanes[2]?.atk).toBe(11);
  });

  it('half-life unit collapses after N own turns', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].pool = 9;
    const [fl] = giveHand(s, 0, ['fl_flicker']); // 반감기 2
    s = applyAction(s, { type: 'play', uid: fl, lane: 0 });
    s = endTurn(endTurn(s));
    expect(s.players[0].lanes[0]).not.toBeNull();
    s = endTurn(endTurn(s));
    expect(s.players[0].lanes[0]).toBeNull();
  });
});
