import { describe, expect, it } from 'vitest';
import { getCard } from '../data/cards';
import { ELEMENTS, getElement } from '../data/elements';
import { DECKS } from '../data/decks';
import { applyAction, createGame, legalActions } from './game';
import { BALANCE } from './config';
import { ops } from './effects';
import type { CardDef, GameState } from './types';

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

describe('hand', () => {
  it('draws as many cards as were used last turn, up to the hand limit', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].pool = 10;
    const [a, b] = giveHand(s, 0, ['li_scout', 'na_runner', 'li_scout']);
    s = applyAction(s, { type: 'play', uid: a, lane: 0 });
    s = applyAction(s, { type: 'play', uid: b, lane: 1 });
    s = endTurn(endTurn(s));
    expect(s.players[0].hand.length).toBe(1 + 2);
    s.players[0].hand = s.players[0].deck.splice(0, BALANCE.hand.max - 1);
    s.players[0].cardsUsedThisTurn = 3;
    s = endTurn(endTurn(s));
    expect(s.players[0].hand.length).toBe(BALANCE.hand.max);
  });

  it('ending a turn without using a playable card raises own entropy', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].pool = 1;
    giveHand(s, 0, ['li_scout']);
    const e = s.players[0].entropy;
    s = endTurn(s);
    expect(s.players[0].entropy).toBe(e + BALANCE.hand.idleEntropy);
    s.players[1].pool = 0;
    giveHand(s, 1, ['li_scout']);
    const e1 = s.players[1].entropy;
    s = endTurn(s);
    expect(s.players[1].entropy).toBe(e1); // 낼 수 있는 카드가 없으면 페널티 없음
  });
});

describe('setup', () => {
  it('deals starting hands and starts player 0 turn', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 7);
    expect(s.players[0].hand).toHaveLength(BALANCE.union.startHand[0]);
    expect(s.players[1].hand).toHaveLength(BALANCE.covalent.startHand[1]);
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

  it('attacker strikes first: a killed defender does not counter, a survivor does', () => {
    const s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].lanes[0] = { uid: 900, cardId: 'na_runner', atk: 3, hp: 2, sick: false, attacked: false };
    s.players[1].lanes[0] = { uid: 901, cardId: 'li_scout', atk: 5, hp: 3, sick: false, attacked: false };
    s.players[0].lanes[1] = { uid: 902, cardId: 'na_runner', atk: 2, hp: 4, sick: false, attacked: false };
    s.players[1].lanes[1] = { uid: 903, cardId: 'li_scout', atk: 3, hp: 3, sick: false, attacked: false };
    let t = applyAction(s, { type: 'attack', lane: 0 });
    expect(t.players[1].lanes[0]).toBeNull();
    expect(t.players[0].lanes[0]?.hp).toBe(2); // 대상이 쓰러져 반격 없음
    t = applyAction(t, { type: 'attack', lane: 1 });
    expect(t.players[1].lanes[1]?.hp).toBe(1);
    expect(t.players[0].lanes[1]?.hp).toBe(1); // 버틴 대상이 반격
    expect(t.log.some((e) => e.t === 'counter')).toBe(true);
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

  it('board decay with heir: onPlay effect fires again from heir lane, onDeath effect is inherited', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].pool = 20;
    const [pu, rn] = giveHand(s, 0, ['pu_reaper', 'rn_mist']); // 소환: 맞은편 4 피해 / 파괴 시: 상대 엔트로피 +2
    s = applyAction(s, { type: 'play', uid: pu, lane: 0 });
    s = applyAction(s, { type: 'play', uid: rn, lane: 1 });
    s = applyAction(s, { type: 'decay', from: 'board', uid: rn, heir: pu });
    expect(s.players[0].lanes[0]?.inherited).toEqual(['rn_mist']);
    const ent = s.players[1].entropy;
    s = applyAction(s, { type: 'decay', from: 'board', uid: pu });
    expect(s.players[1].entropy).toBe(ent + 2); // 물려받은 라돈의 파괴 시 효과

    let t = createGame(DECKS.decay, DECKS.union, 1);
    t.players[0].pool = 20;
    const [pu2, ne] = giveHand(t, 0, ['pu_reaper', 'ne_wisp']);
    t = applyAction(t, { type: 'play', uid: ne, lane: 1 });
    t = applyAction(t, { type: 'play', uid: pu2, lane: 0 });
    t.players[1].lanes[1] = { uid: 998, cardId: 's_brute', atk: 4, hp: 4, sick: false, attacked: false };
    t = applyAction(t, { type: 'decay', from: 'board', uid: pu2, heir: ne });
    expect(t.players[1].lanes[1]).toBeNull(); // 플루토늄의 소환 효과가 네온 자리(1번 레인)에서 다시 발동
    expect(() => applyAction(t, { type: 'decay', from: 'board', uid: ne, heir: ne })).toThrow();
  });
});

describe('upkeep', () => {
  it('is paid from the pool at turn start, and a unit that cannot be paid is destroyed', () => {
    const card = getCard('li_scout');
    card.upkeep = 3;
    try {
      const base = createGame(DECKS.union, DECKS.covalent, 1);
      const withUnit = (pool: number) => {
        const s = structuredClone(base);
        s.players[0].lanes[0] = { uid: 999, cardId: 'li_scout', atk: 1, hp: 1, sick: false, attacked: false };
        s.players[0].pool = pool;
        return endTurn(endTurn(s)).players[0];
      };
      const paid = withUnit(4); // 4 + 수입 2 + 이자 1 - 유지비 3
      expect(paid.lanes[0]).not.toBeNull();
      expect(paid.pool).toBe(4);
      const broke = withUnit(0); // 수입 2로는 유지비 3을 못 냄 → 파괴, 자원은 그대로
      expect(broke.lanes[0]).toBeNull();
      expect(broke.pool).toBe(2);
    } finally {
      delete card.upkeep;
    }
  });
});

describe('faction card kinds', () => {
  it('covalent equips items onto own units; other factions cannot', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.players[0].pool = 10;
    const [b, armor] = giveHand(s, 0, ['b_sentinel', 'cnt_armor']);
    expect(() => applyAction(s, { type: 'play', uid: armor, lane: 0 })).toThrow(); // 빈 칸에는 장착 불가
    s = applyAction(s, { type: 'play', uid: b, lane: 0 });
    s = applyAction(s, { type: 'play', uid: armor, lane: 0 });
    expect(s.players[0].lanes[0]).toMatchObject({ atk: 2, hp: 7, equipped: ['cnt_armor'] });

    const t = createGame(DECKS.decay, DECKS.union, 1);
    t.players[0].pool = 10;
    const [ne, armor2] = giveHand(t, 0, ['ne_wisp', 'cnt_armor']);
    const t2 = applyAction(t, { type: 'play', uid: ne, lane: 0 });
    expect(() => applyAction(t2, { type: 'play', uid: armor2, lane: 0 })).toThrow();
  });

  it('union spells hit the chosen lane and can overload (own entropy for discount)', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 1; // 연소 반응 L2, 과부하 할인 1
    const [rx] = giveHand(s, 0, ['rx_combust']);
    s.players[1].lanes[2] = { uid: 998, cardId: 'n_lancer', atk: 3, hp: 2, sick: false, attacked: false };
    expect(() => applyAction(s, { type: 'play', uid: rx, lane: 2 })).toThrow();
    const ent = s.players[0].entropy;
    s = applyAction(s, { type: 'play', uid: rx, lane: 2, overload: true });
    expect(s.players[1].lanes[2]).toBeNull();
    expect(s.players[0].pool).toBe(0);
    expect(s.players[0].entropy).toBe(ent + BALANCE.union.overload.entropy);
    expect(s.players[0].lanes[2]).toBeNull(); // 마법은 전장에 남지 않는다

    const t = createGame(DECKS.covalent, DECKS.union, 1);
    t.players[0].pool = 10;
    const [rx2] = giveHand(t, 0, ['rx_combust']);
    expect(() => applyAction(t, { type: 'play', uid: rx2, lane: 0 })).toThrow();
  });
});

describe('armor / resist', () => {
  // 맞은편에 키워드를 단 유닛을 세워 두고 피해를 준다
  function duel(keywords: string[]) {
    const card = getCard('li_scout');
    const saved = card.keywords;
    card.keywords = keywords;
    try {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = { uid: 900, cardId: 'na_runner', atk: 3, hp: 5, sick: false, attacked: false };
      s.players[1].lanes[0] = { uid: 901, cardId: 'li_scout', atk: 1, hp: 5, sick: false, attacked: false };
      const fought = applyAction(s, { type: 'attack', lane: 0 });
      ops.strikeOpposite({ s, p: 0, lane: 0, unit: null }, { n: 3 });
      return { combat: fought.players[1].lanes[0]!.hp, effect: s.players[1].lanes[0]!.hp, attacker: fought.players[0].lanes[0]!.hp };
    } finally {
      card.keywords = saved;
    }
  }

  it('armor reduces combat damage only', () => {
    expect(duel([])).toEqual({ combat: 2, effect: 2, attacker: 4 });
    expect(duel(['armor:2'])).toEqual({ combat: 4, effect: 2, attacker: 4 });
  });

  it('resist reduces effect damage only, never below 0', () => {
    expect(duel(['resist:2'])).toEqual({ combat: 2, effect: 4, attacker: 4 });
    expect(duel(['armor:9', 'resist:9'])).toEqual({ combat: 5, effect: 5, attacker: 4 });
  });
});

describe('charge (기력)', () => {
  // 카드 정의를 잠시 바꿔 끼우고 원래대로 돌려놓는다
  function withCard<T>(id: string, patch: Partial<CardDef>, fn: () => T): T {
    const card = getCard(id);
    const saved = { ...card };
    Object.assign(card, patch);
    try { return fn(); } finally { Object.keys(patch).forEach((k) => delete (card as any)[k]); Object.assign(card, saved); }
  }
  const unit = (cardId: string, hp: number) => ({ uid: 950, cardId, atk: 1, hp, sick: false, attacked: false });

  it('fills 1 per own turn start and fires onCharge when full, then resets', () => {
    withCard('li_scout', { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'draw', args: { n: 1 } }] }, () => {
      let s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('li_scout', 1);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.energy).toBe(1);
      expect(s.log.some((e) => e.t === 'charge')).toBe(false);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.energy).toBe(0);
      expect(s.log.filter((e) => e.t === 'charge')).toHaveLength(1);
    });
  });

  it('surviving a fight also adds 1', () => {
    withCard('li_scout', { keywords: ['charge:3'] }, () => {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('li_scout', 9);
      s.players[1].lanes[0] = unit('ne_wisp', 9);
      expect(applyAction(s, { type: 'attack', lane: 0 }).players[0].lanes[0]!.energy).toBe(1);
    });
  });

  it('healSelf restores hp up to the card hp', () => {
    withCard('mg_guard', { keywords: ['charge:1'], effects: [{ trigger: 'onCharge', op: 'healSelf', args: { n: 2 } }] }, () => {
      let s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('mg_guard', 1);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.hp).toBe(3);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.hp).toBe(4); // 마그네슘 수호병 체력 4가 상한
    });
  });

  it('equipped items add their armor', () => {
    withCard('cnt_armor', { keywords: ['armor:2'] }, () => {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = { ...unit('na_runner', 5), atk: 3 };
      s.players[1].lanes[0] = { ...unit('b_sentinel', 5), equipped: ['cnt_armor'] };
      expect(applyAction(s, { type: 'attack', lane: 0 }).players[1].lanes[0]!.hp).toBe(4);
    });
  });
});

describe('element tiles', () => {
  const unit = (uid: number, cardId: string) => ({ uid, cardId, atk: 1, hp: 9, sick: false, attacked: false });

  it('holding a lane alone for captureTurns own turn starts captures its element and refills the tile', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    const tile = s.tiles[0]!;
    const next = s.tileBag[0];
    s.players[0].lanes[0] = unit(990, 'li_scout');
    s = endTurn(endTurn(s));
    expect(s.players[0].capture[0]).toBe(1);
    expect(s.players[0].elements).toEqual([]);
    s = endTurn(endTurn(s));
    expect(s.players[0].elements).toEqual([tile]);
    expect(s.tiles[0]).toBe(next);
    expect(s.log.some((e) => e.t === 'capture' && e.element === tile)).toBe(true);
  });

  it('an enemy unit in the lane resets the gauge', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].lanes[0] = unit(990, 'li_scout');
    s = endTurn(endTurn(s));
    s.players[1].lanes[0] = unit(991, 'si_wall');
    s = endTurn(endTurn(s));
    expect(s.players[0].capture[0]).toBe(0);
    expect(s.players[0].elements).toEqual([]);
  });

  it('owning the same element discounts cost, the same group buffs the unit', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 1);
    s.leyline = null;
    const [mg] = giveHand(s, 0, ['mg_guard']); // 마그네슘 수호병: Lv2 1/4, 알칼리토
    s.players[0].pool = 1;
    expect(() => applyAction(s, { type: 'play', uid: mg, lane: 0 })).toThrow();
    s.players[0].elements = ['Mg'];
    const after = applyAction(s, { type: 'play', uid: mg, lane: 0 });
    expect(after.players[0].pool).toBe(0);
    expect(after.players[0].lanes[0]).toMatchObject({ atk: 2, hp: 5 });
  });
});

describe('faction element use', () => {
  const unit = (uid: number, cardId: string) => ({ uid, cardId, atk: 1, hp: 9, sick: false, attacked: false });

  it('union reacts two elements: lane damage + entropy, metal+nonmetal adds ion bonus, noble cannot react', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[1].lanes[1] = unit(991, 'si_wall');
    s.players[0].elements = ['Na', 'Cl', 'Li', 'Ne'];
    s.players[0].pool = 10;
    const e0 = s.players[1].entropy;
    const r = BALANCE.elements.react;
    const ion = applyAction(s, { type: 'react', lane: 1, a: 'Na', b: 'Cl' });
    expect(ion.players[1].lanes[1]!.hp).toBe(9 - r.damage - r.ionBonus);
    expect(ion.players[1].entropy).toBe(e0 + r.entropy);
    expect(ion.players[0].elements).toEqual(['Li', 'Ne']);
    expect(ion.players[0].pool).toBe(10 - r.cost);
    expect(applyAction(s, { type: 'react', lane: 1, a: 'Na', b: 'Li' }).players[1].lanes[1]!.hp).toBe(9 - r.damage);
    expect(() => applyAction(s, { type: 'react', lane: 1, a: 'Na', b: 'Ne' })).toThrow();
  });

  it('covalent bonds elements: each owned element adds pool at turn start', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.players[0].lattices = 2;
    s.players[0].elements = ['C', 'Fe'];
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(2 + 2 * BALANCE.elements.bondPool);
  });

  it('decay: radioactive elements follow the decay chain and raise enemy entropy; any element can be burned for pool', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].elements = ['U', 'Fe'];
    const e0 = s.players[1].entropy;
    s = endTurn(endTurn(s));
    expect(s.players[0].elements).toEqual(['Th', 'Fe']);
    // 상대(연맹)는 카드를 쓰지 않고 턴을 넘겨 idle 페널티도 받는다
    expect(s.players[1].entropy).toBe(e0 + BALANCE.naturalEntropy + BALANCE.hand.idleEntropy + BALANCE.elements.chainEntropy);
    const pool = s.players[0].pool;
    s = applyAction(s, { type: 'decay', from: 'element', element: 'Fe' });
    expect(s.players[0].pool).toBe(pool + BALANCE.elements.burnGain);
    expect(s.players[0].elements).toEqual(['Th']);
  });
});

describe('covalent element capture', () => {
  it('covalent keeps capturing while an enemy stands opposite, and draws on capture', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.leyline = null;
    s.players[0].lanes[0] = { uid: 990, cardId: 'si_wall', atk: 0, hp: 9, sick: false, attacked: false };
    s.players[1].lanes[0] = { uid: 991, cardId: 'li_scout', atk: 0, hp: 9, sick: false, attacked: false };
    const tile = s.tiles[0]!;
    s = endTurn(endTurn(s));
    s = endTurn(s);
    const hand = s.players[0].hand.length;
    s = endTurn(s);
    expect(s.players[0].elements).toEqual([tile]);
    expect(s.players[0].hand.length).toBe(hand + BALANCE.elements.bondDraw); // 지난 턴 사용 0장 → 턴 드로우 없음, 결합 드로우만
  });
});

describe('leyline (지맥)', () => {
  it('is the group of one of the starting tiles', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(DECKS.union, DECKS.covalent, seed);
      expect(s.tiles.map((e) => getElement(e!).group)).toContain(s.leyline);
    }
  });

  it('multiplies the resonance of its group', () => {
    const l = BALANCE.elements.leyline;
    const t = createGame(DECKS.union, DECKS.covalent, 1);
    t.leyline = '알칼리토';
    t.players[0].elements = ['Mg'];
    t.players[0].pool = 10;
    const [mg] = giveHand(t, 0, ['mg_guard']); // Lv2 1/4 알칼리토
    const after = applyAction(t, { type: 'play', uid: mg, lane: 1 });
    const buff = BALANCE.elements.groupBuff * l.resonanceMult;
    expect(after.players[0].lanes[1]).toMatchObject({ atk: 1 + buff, hp: 4 + buff });
    expect(after.players[0].pool).toBe(10 - Math.max(1, 2 - BALANCE.elements.costDiscount * l.resonanceMult));
  });
});

describe('period tech tree (주기 테크트리)', () => {
  it('caps playable level by the highest period ever captured, and spending elements keeps it', () => {
    const t = BALANCE.elements.tech;
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.leyline = null;
    const [ba] = giveHand(s, 0, ['ba_titan']); // 바륨 거인 L7
    s.players[0].pool = 10;
    expect(t.baseLevel.union).toBeLessThan(7);
    expect(() => applyAction(s, { type: 'play', uid: ba, lane: 0 })).toThrow('locked');
    expect(legalActions(s).some((a) => a.type === 'play' && a.uid === ba)).toBe(false);

    // (7 - offset)주기 원소를 장악으로 얻으면 L7이 열린다
    const sym = ELEMENTS.find((e) => !e.product && e.period === 7 - t.periodOffset)!.symbol;
    s.tiles[1] = sym;
    s.players[0].lanes[1] = { uid: 990, cardId: 'li_scout', atk: 1, hp: 9, sick: false, attacked: false };
    for (let i = 0; i < BALANCE.elements.captureTurns.union; i++) s = endTurn(endTurn(s));
    expect(s.players[0].tech).toBe(7 - t.periodOffset);
    // 반응으로 원소를 써도 연구 단계는 유지
    s.players[0].elements.push('Na');
    s.players[0].pool = 20;
    s = applyAction(s, { type: 'react', lane: 0, a: sym, b: 'Na' });
    expect(s.players[0].elements).not.toContain(sym);
    expect(applyAction(s, { type: 'play', uid: ba, lane: 0 }).players[0].lanes[0]?.cardId).toBe('ba_titan');
  });

  it('decay is not limited (base level covers its whole deck)', () => {
    const s = createGame(DECKS.decay, DECKS.union, 1);
    const [og] = giveHand(s, 0, ['og_titan']); // L9
    s.players[0].pool = 20;
    expect(applyAction(s, { type: 'play', uid: og, lane: 0 }).players[0].lanes[0]?.cardId).toBe('og_titan');
  });
});
