import { describe, expect, it } from 'vitest';
import { getCard } from '../data/cards';
import { getLand, LANDS } from '../data/lands';
import { DECK_LIST, DECKS } from '../data/decks';
import { applyAction, costOf, createGame, foreignTax, legalActions, validateDeck } from './game';
import { BALANCE } from './config';
import { ops } from './effects';
import { decayGain } from './resources';
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
    const [a, b] = giveHand(s, 0, ['ember_scout', 'flame_runner', 'ember_scout']);
    s = applyAction(s, { type: 'play', uid: a, lane: 0 });
    s = applyAction(s, { type: 'play', uid: b, lane: 1 });
    s = endTurn(endTurn(s));
    expect(s.players[0].hand.length).toBe(1 + 2);
    s.players[0].hand = s.players[0].deck.splice(0, BALANCE.hand.max - 1);
    s.players[0].cardsUsedThisTurn = 3;
    s = endTurn(endTurn(s));
    expect(s.players[0].hand.length).toBe(BALANCE.hand.max);
  });

  it('shuffle redraws the same number of cards for an entropy penalty, once per turn', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    const n = s.players[0].hand.length, total = n + s.players[0].deck.length, e = s.players[0].entropy;
    s = applyAction(s, { type: 'shuffle' });
    expect(s.players[0].hand.length).toBe(n);
    expect(s.players[0].hand.length + s.players[0].deck.length).toBe(total);
    expect(s.players[0].entropy).toBe(e + BALANCE.hand.shuffleEntropy);
    expect(legalActions(s).some((x) => x.type === 'shuffle')).toBe(false);
  });

  it('units attack automatically at end of turn, hitting the nearest enemy before the empty lane', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    const unit = (uid: number, atk: number, hp: number, sick = false) => ({ uid, cardId: 'ember_scout', atk, hp, sick, attacked: false });
    s.players[0].lanes[0] = unit(901, 1, 9);
    s.players[1].lanes[2] = unit(902, 1, 9);
    const e = s.players[1].entropy;
    s = applyAction(s, { type: 'endTurn' });
    expect(s.players[1].lanes[2]!.hp).toBe(8);
    expect(s.players[1].entropy).toBe(e + BALANCE.naturalEntropy); // 직접 공격 없음, 자연 증가만
    expect(s.players[0].lanes[0]!.attacked).toBe(true);
  });

  it('a unit that will attack cannot be sacrificed', () => {
    const s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].lanes[0] = { uid: 903, cardId: 'ember_scout', atk: 1, hp: 1, sick: false, attacked: false };
    s.players[0].lanes[1] = { uid: 904, cardId: 'ember_scout', atk: 1, hp: 1, sick: true, attacked: false };
    expect(() => applyAction(s, { type: 'decay', from: 'board', uid: 903 })).toThrow();
    expect(() => applyAction(s, { type: 'decay', from: 'board', uid: 904 })).not.toThrow();
  });

  it('ending a turn without using a playable card raises own entropy', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].pool = 1;
    giveHand(s, 0, ['ember_scout']);
    const e = s.players[0].entropy;
    s = endTurn(s);
    expect(s.players[0].entropy).toBe(e + BALANCE.hand.idleEntropy);
    s.players[1].pool = 0;
    giveHand(s, 1, ['ember_scout']);
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
    expect(s.players[0].pool).toBe(BALANCE.base.borrow); // 첫 턴 선불
    expect(s.players[1].bases).toBe(0);
  });
});

const giveBases = (s: GameState, p: 0 | 1, n: number) => { s.players[p].bases = n; };

describe('union gold', () => {
  it('income = bases, carries over and earns interest', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    giveBases(s, 0, 3);
    const pools: number[] = [];
    for (let i = 0; i < 3; i++) {
      s = endTurn(endTurn(s));
      pools.push(s.players[0].pool);
    }
    // 첫 턴 선불 1 남음 → 1+3=4 → 4+3+이자1=8 → 8+3+이자2=13 → 상한 12
    expect(pools).toEqual([4, 8, 12]);
  });
});

describe('bases', () => {
  const deckWith = (n: number) => createGame({ faction: 'covalent', cards: [...DECKS.covalent.cards.filter((id) => id !== 'base_covalent').slice(0, 24), ...Array(n).fill('base_covalent')] }, DECKS.union, 1).players[0];

  it('are mixed into the deck, count is chosen per deck', () => {
    const count = (n: number) => { const p = deckWith(n); return [...p.deck, ...p.hand].filter((c) => c.cardId === 'base_covalent').length; };
    expect(count(0)).toBe(0);
    expect(count(5)).toBe(5);
    expect(count(16)).toBe(16);
  });

  it('one placement per turn, unused placements carry over, resource each turn start', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    const [a, b, c, d] = giveHand(s, 0, ['base_covalent', 'base_covalent', 'base_covalent', 'base_covalent']);
    s = applyAction(s, { type: 'base', uid: a });
    expect(() => applyAction(s, { type: 'base', uid: b })).toThrow(); // 1턴: 1장
    expect(s.players[0].bases).toBe(1);
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(BALANCE.base.income);
    s = endTurn(endTurn(s)); // 2턴은 깔지 않고 넘긴다
    s = applyAction(s, { type: 'base', uid: b });
    s = applyAction(s, { type: 'base', uid: c }); // 3턴: 이월된 1회 + 이번 턴 1회
    expect(() => applyAction(s, { type: 'base', uid: d })).toThrow();
    expect(s.players[0].bases).toBe(3);
  });

  it('cannot exceed the board limit', () => {
    const s = createGame(DECKS.covalent, DECKS.union, 1);
    const [a] = giveHand(s, 0, ['base_covalent']);
    s.players[0].bases = BALANCE.base.max;
    expect(() => applyAction(s, { type: 'base', uid: a })).toThrow();
    expect(legalActions(s).some((x) => x.type === 'base')).toBe(false);
  });

  it('cannot be sacrificed, even by the decay faction', () => {
    const s = createGame(DECKS.decay, DECKS.union, 1);
    const [a] = giveHand(s, 0, ['base_decay']);
    expect(() => applyAction(s, { type: 'decay', from: 'hand', uid: a })).toThrow();
    expect(legalActions(s).some((x) => x.type === 'decay')).toBe(false);
  });

  it('first-turn loan: using it costs entropy next turn, not using it does not', () => {
    const used = createGame(DECKS.union, DECKS.union, 1);
    const [a] = giveHand(used, 0, ['ember_scout']);
    let s = applyAction(used, { type: 'play', uid: a, lane: 0 }); // 비용 1 = 선불 전부
    const e = s.players[0].entropy;
    s = endTurn(endTurn(s));
    expect(s.players[0].entropy).toBe(e + BALANCE.naturalEntropy + BALANCE.base.borrowEntropy);

    const idle = createGame(DECKS.union, DECKS.union, 1);
    giveHand(idle, 0, ['base_union']);
    const [b] = idle.players[0].hand.map((c) => c.uid);
    s = applyAction(idle, { type: 'base', uid: b });
    const e2 = s.players[0].entropy;
    s = endTurn(endTurn(s));
    expect(s.players[0].entropy).toBe(e2 + BALANCE.naturalEntropy);
  });

  it('covalent binds units to captured elements (lands × bind, rounded down)', () => {
    const base = getCard('abbey_wall');
    // 수도사가 아닌 대지만 써서 종족 공명이 섞이지 않게 한다
    for (const elements of [['obsidian_pit'], ['obsidian_pit', 'mist_wood']]) {
      const s = createGame(DECKS.covalent, DECKS.union, 1);
      s.players[0].pool = 9;
      s.players[0].elements = elements;
      const [a] = giveHand(s, 0, ['abbey_wall']);
      const u = applyAction(s, { type: 'play', uid: a, lane: 0 }).players[0].lanes[0]!;
      expect(u.atk).toBe(base.atk + Math.floor(elements.length * BALANCE.covalent.bind));
    }
  });
});

describe('covalent resonance', () => {
  it('bonus faith at the base threshold', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    const { resonanceAt, resonanceBonus } = BALANCE.covalent;
    s.players[0].bases = resonanceAt;
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(resonanceAt * BALANCE.base.income + resonanceBonus);
  });
});

describe('combat', () => {
  it('summoning sickness, entropy hit on empty lane, simultaneous trade', () => {
    let s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].pool = 5;
    const [na] = giveHand(s, 0, ['flame_runner']);
    s = applyAction(s, { type: 'play', uid: na, lane: 0 });
    expect(() => applyAction(s, { type: 'attack', lane: 0 })).toThrow();
    s = endTurn(s);
    s = endTurn(s);
    const before = s.players[1].entropy;
    s = applyAction(s, { type: 'attack', lane: 0 });
    expect(s.players[1].entropy).toBe(before + 2);

    s = endTurn(s);
    s.players[1].pool = 5;
    const [mg] = giveHand(s, 1, ['gorge_guard']);
    s = applyAction(s, { type: 'play', uid: mg, lane: 0 });
    s = endTurn(s);
    s = applyAction(s, { type: 'attack', lane: 0 });
    // 나트륨 2/1 vs 마그네슘 1/4 → 나트륨 사망, 마그네슘 hp 2
    expect(s.players[0].lanes[0]).toBeNull();
    expect(s.players[1].lanes[0]?.hp).toBe(2);
  });

  it('attacker strikes first: a killed defender does not counter, a survivor does', () => {
    const s = createGame(DECKS.union, DECKS.union, 1);
    s.players[0].lanes[0] = { uid: 900, cardId: 'flame_runner', atk: 3, hp: 2, sick: false, attacked: false };
    s.players[1].lanes[0] = { uid: 901, cardId: 'ember_scout', atk: 5, hp: 3, sick: false, attacked: false };
    s.players[0].lanes[1] = { uid: 902, cardId: 'flame_runner', atk: 2, hp: 4, sick: false, attacked: false };
    s.players[1].lanes[1] = { uid: 903, cardId: 'ember_scout', atk: 3, hp: 3, sick: false, attacked: false };
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
    s.players[0].lanes[1] = { uid: 999, cardId: 'flame_runner', atk: 2, hp: 1, sick: false, attacked: false };
    s = applyAction(s, { type: 'attack', lane: 1 });
    expect(s.winner).toBe(0);
    expect(legalActions(s)).toEqual([]);
  });
});

describe('deck building (객원)', () => {
  it('every preset deck is legal', () => {
    for (const d of DECK_LIST) expect(validateDeck(d.spec), d.name).toEqual([]);
  });

  it('rejects wrong size, too many copies, too many guests and guest spells/items', () => {
    const base = DECKS.covalent.cards;
    expect(validateDeck({ faction: 'covalent', cards: base.slice(0, 10) })).toHaveLength(1);
    expect(validateDeck({ faction: 'covalent', cards: [...base, ...Array(2).fill('base_covalent')] })).toHaveLength(1); // 41장
    const copies = [...base.slice(0, 20), ...Array(4).fill('abbey_wall')];
    expect(validateDeck({ faction: 'covalent', cards: [...base.slice(0, 20), ...Array(20).fill('base_covalent')] })).toEqual([]); // 베이스는 장수 제한 없음
    expect(validateDeck({ faction: 'covalent', cards: copies }).some((e) => e.includes('같은 카드'))).toBe(true);
    const extra = ['ash_raider', 'ash_raider', 'ash_raider', 'spark_archer', 'spark_archer', 'spark_archer', 'gale_blade'].slice(0, BALANCE.deck.guestMax + 1);
    const guests = [...base.slice(0, 30 - extra.length), ...extra];
    expect(validateDeck({ faction: 'covalent', cards: guests }).some((e) => e.includes('객원 카드는'))).toBe(true);
    const spell = [...base.slice(0, 23), 'sp_fireball'];
    expect(validateDeck({ faction: 'covalent', cards: spell }).some((e) => e.includes('종류'))).toBe(true);
  });

  it('a guest card pays the color tax unless a land of its faction is held', () => {
    const s = createGame(DECKS.covalent, DECKS.union, 1);
    const pl = s.players[0];
    const def = getCard('ash_raider');
    expect(foreignTax(pl, def)).toBeGreaterThan(0);
    expect(costOf(s, pl, def)).toBe(def.level + foreignTax(pl, def));
    pl.pool = 10;
    const [g] = giveHand(s, 0, ['ash_raider']);
    const ent = pl.entropy;
    expect(applyAction(s, { type: 'play', uid: g, lane: 0 }).players[0].entropy).toBe(ent); // 파멸 벌칙은 없다

    const t = createGame(DECKS.covalent, DECKS.union, 1);
    t.players[0].elements = ['ember_hill']; // 화염술사의 대지: 현지 협력
    expect(foreignTax(t.players[0], def)).toBe(0);
  });

  it('a guest union unit loses its chain', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.players[0].pool = 10;
    const [a, b] = giveHand(s, 0, ['wood_spear', 'blast_adept']);
    s = applyAction(s, { type: 'play', uid: a, lane: 0 });
    s = applyAction(s, { type: 'play', uid: b, lane: 1 });
    expect(s.players[1].entropy).toBe(0);
  });
});

describe('union chain', () => {
  it('triggers only on the second unit of the turn', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 10;
    const [k1, k2] = giveHand(s, 0, ['blast_adept', 'blast_adept']);
    s = applyAction(s, { type: 'play', uid: k1, lane: 0 });
    expect(s.players[1].entropy).toBe(0);
    s = applyAction(s, { type: 'play', uid: k2, lane: 1 });
    expect(s.players[1].entropy).toBe(2);
  });
});

describe('decay faction', () => {
  it('decays hand card for burst summon', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    const [og, th, fl] = giveHand(s, 0, ['void_titan', 'grave_herald', 'rift_flicker']);
    const pool0 = s.players[0].pool;
    s = applyAction(s, { type: 'decay', from: 'hand', uid: th }); // 토륨 L4
    expect(s.players[0].pool).toBe(pool0 + 4 + BALANCE.decay.decayHandBonus);
    s = applyAction(s, { type: 'decay', from: 'hand', uid: fl }); // +6
    s = applyAction(s, { type: 'play', uid: og, lane: 2 });
    expect(s.players[0].lanes[2]?.atk).toBe(11);
  });

  it('half-life unit collapses after N own turns, sacrificed automatically for soul', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].pool = 9;
    const [fl] = giveHand(s, 0, ['void_titan']); // 소멸 2
    s = applyAction(s, { type: 'play', uid: fl, lane: 0 });
    s = endTurn(endTurn(s));
    expect(s.players[0].lanes[0]).not.toBeNull();
    const before = s.log.length;
    s = endTurn(endTurn(s));
    expect(s.players[0].lanes[0]).toBeNull();
    const fresh = s.log.slice(before);
    expect(fresh.some((e) => e.t === 'death' && e.p === 0 && e.reason === 'decay')).toBe(true);
    const half = Math.floor(decayGain.board(9) / BALANCE.decay.expireDiv); // 9 → 4
    expect(fresh.some((e) => e.t === 'decay' && e.p === 0 && e.auto && e.gain === half)).toBe(true);
    expect(s.players[0].pool).toBeGreaterThanOrEqual(half);
  });

  it('other factions just lose an expiring unit (no sacrifice)', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 9;
    const [fb] = giveHand(s, 0, ['flash_burner']); // 소멸 2
    s = applyAction(s, { type: 'play', uid: fb, lane: 0 });
    s = endTurn(endTurn(endTurn(endTurn(s))));
    expect(s.log.some((e) => e.t === 'death' && e.p === 0 && e.reason === 'halfLife')).toBe(true);
    expect(s.log.some((e) => e.t === 'decay')).toBe(false);
  });

  it('board decay with heir: onPlay effect fires again from heir lane, onDeath effect is inherited', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].pool = 20;
    const [pu, rn] = giveHand(s, 0, ['doom_reaper', 'bog_wraith']); // 소환: 맞은편 4 피해 / 파괴 시: 상대 파멸 +2
    s = applyAction(s, { type: 'play', uid: pu, lane: 0 });
    s = applyAction(s, { type: 'play', uid: rn, lane: 1 });
    s = applyAction(s, { type: 'decay', from: 'board', uid: rn, heir: pu });
    expect(s.players[0].lanes[0]?.inherited).toEqual(['bog_wraith']);
    const ent = s.players[1].entropy;
    s = applyAction(s, { type: 'decay', from: 'board', uid: pu });
    expect(s.players[1].entropy).toBe(ent + 2); // 물려받은 라돈의 파괴 시 효과

    let t = createGame(DECKS.decay, DECKS.union, 1);
    t.players[0].pool = 20;
    const [pu2, ne] = giveHand(t, 0, ['doom_reaper', 'beacon_wisp']);
    t = applyAction(t, { type: 'play', uid: ne, lane: 1 });
    t = applyAction(t, { type: 'play', uid: pu2, lane: 0 });
    t.players[1].lanes[1] = { uid: 998, cardId: 'sulfur_brute', atk: 4, hp: 4, sick: false, attacked: false };
    t = applyAction(t, { type: 'decay', from: 'board', uid: pu2, heir: ne });
    expect(t.players[1].lanes[1]).toBeNull(); // 플루토늄의 소환 효과가 네온 자리(1번 레인)에서 다시 발동
    expect(() => applyAction(t, { type: 'decay', from: 'board', uid: ne, heir: ne })).toThrow();
  });
});

describe('upkeep', () => {
  it('is paid from the pool at turn start, and a unit that cannot be paid is destroyed', () => {
    const card = getCard('ember_scout');
    card.upkeep = 4;
    try {
      const base = createGame(DECKS.union, DECKS.covalent, 1);
      const withUnit = (pool: number) => {
        const s = structuredClone(base);
        s.players[0].lanes[0] = { uid: 999, cardId: 'ember_scout', atk: 1, hp: 1, sick: false, attacked: false };
        s.players[0].pool = pool;
        s.players[0].bases = 3;
        return endTurn(endTurn(s)).players[0];
      };
      const paid = withUnit(4); // 4 + 베이스 수입 3 + 이자 1 - 유지비 4
      expect(paid.lanes[0]).not.toBeNull();
      expect(paid.pool).toBe(4);
      const broke = withUnit(0); // 수입 3으로는 유지비 4를 못 냄 → 파괴, 자원은 그대로
      expect(broke.lanes[0]).toBeNull();
      expect(broke.pool).toBe(3);
    } finally {
      delete card.upkeep;
    }
  });
});

describe('faction card kinds', () => {
  it('covalent equips items onto own units; other factions cannot', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.players[0].pool = 10;
    const [b, armor] = giveHand(s, 0, ['hermit_sentinel', 'it_stone_mail']);
    expect(() => applyAction(s, { type: 'play', uid: armor, lane: 0 })).toThrow(); // 빈 칸에는 장착 불가
    s = applyAction(s, { type: 'play', uid: b, lane: 0 });
    s = applyAction(s, { type: 'play', uid: armor, lane: 0 });
    expect(s.players[0].lanes[0]).toMatchObject({ atk: 2, hp: 7, equipped: ['it_stone_mail'] });

    const t = createGame(DECKS.decay, DECKS.union, 1);
    t.players[0].pool = 10;
    const [ne, armor2] = giveHand(t, 0, ['beacon_wisp', 'it_stone_mail']);
    const t2 = applyAction(t, { type: 'play', uid: ne, lane: 0 });
    expect(() => applyAction(t2, { type: 'play', uid: armor2, lane: 0 })).toThrow();
  });

  it('union spells hit the chosen lane and can overload (own entropy for discount)', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 1; // 연소 융합 주문 L2, 폭주 할인 1
    const [rx] = giveHand(s, 0, ['sp_fireball']);
    s.players[1].lanes[2] = { uid: 998, cardId: 'wood_spear', atk: 3, hp: 2, sick: false, attacked: false };
    expect(() => applyAction(s, { type: 'play', uid: rx, lane: 2 })).toThrow();
    const ent = s.players[0].entropy;
    s = applyAction(s, { type: 'play', uid: rx, lane: 2, overload: true });
    expect(s.players[1].lanes[2]).toBeNull();
    expect(s.players[0].pool).toBe(0);
    expect(s.players[0].entropy).toBe(ent + BALANCE.union.overload.entropy);
    expect(s.players[0].lanes[2]).toBeNull(); // 주문은 전장에 남지 않는다

    const t = createGame(DECKS.covalent, DECKS.union, 1);
    t.players[0].pool = 10;
    const [rx2] = giveHand(t, 0, ['sp_fireball']);
    expect(() => applyAction(t, { type: 'play', uid: rx2, lane: 0 })).toThrow();
  });
});

describe('spire (첨탑)', () => {
  const sp = BALANCE.union.spire;

  it('spells raise the spire (overload adds more), react raises it more, capped at max', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 20;
    const [a, b] = giveHand(s, 0, ['sp_insight', 'sp_insight']);
    s = applyAction(s, { type: 'play', uid: a, lane: 0 });
    expect(s.players[0].spire).toBe(sp.perSpell);
    s = applyAction(s, { type: 'play', uid: b, lane: 0, overload: true });
    expect(s.players[0].spire).toBe(2 * sp.perSpell + sp.overloadBonus);
    s.players[0].elements.push('salt_flame', 'storm_cliff');
    s = applyAction(s, { type: 'react', lane: 0, a: 'salt_flame', b: 'storm_cliff' });
    expect(s.players[0].spire).toBe(Math.min(sp.max, 2 * sp.perSpell + sp.overloadBonus + sp.perReact));
    s.players[0].spire = sp.max;
    const [c] = giveHand(s, 0, ['sp_insight']);
    expect(applyAction(s, { type: 'play', uid: c, lane: 0 }).players[0].spire).toBe(sp.max);
  });

  it('units do not raise the spire, and other factions have none', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].pool = 20;
    const [a] = giveHand(s, 0, ['ember_scout']);
    s = applyAction(s, { type: 'play', uid: a, lane: 0 });
    expect(s.players[0].spire).toBe(0);
  });

  it('bombards the highest-attack enemy unit at turn start, resist applies', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[0].spire = 4 * sp.bombardPer; // 4 피해
    s.players[1].lanes[0] = { uid: 990, cardId: 'abbey_wall', atk: 0, hp: 9, sick: false, attacked: false };
    s.players[1].lanes[3] = { uid: 991, cardId: 'wood_spear', atk: 3, hp: 9, sick: false, attacked: false };
    s = endTurn(endTurn(s));
    expect(s.players[1].lanes[3]!.hp).toBe(9 - 4);
    expect(s.players[1].lanes[0]!.hp).toBe(9);
  });

  it('raises the base level cap by floor(floors / techPer)', () => {
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.leyline = null;
    s.players[0].pool = 20;
    const [ba] = giveHand(s, 0, ['giant_captain']); // L7
    s.players[0].spire = (7 - BALANCE.elements.tech.baseLevel.union) * sp.techPer - 1;
    expect(() => applyAction(s, { type: 'play', uid: ba, lane: 0 })).toThrow('locked');
    s.players[0].spire++;
    expect(applyAction(s, { type: 'play', uid: ba, lane: 0 }).players[0].lanes[0]?.cardId).toBe('giant_captain');
  });
});

describe('armor / resist', () => {
  // 맞은편에 키워드를 단 유닛을 세워 두고 피해를 준다
  function duel(keywords: string[]) {
    const card = getCard('ember_scout');
    const saved = card.keywords;
    card.keywords = keywords;
    try {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = { uid: 900, cardId: 'flame_runner', atk: 3, hp: 5, sick: false, attacked: false };
      s.players[1].lanes[0] = { uid: 901, cardId: 'ember_scout', atk: 1, hp: 5, sick: false, attacked: false };
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
    withCard('ember_scout', { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'draw', args: { n: 1 } }] }, () => {
      let s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('ember_scout', 1);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.energy).toBe(1);
      expect(s.log.some((e) => e.t === 'charge')).toBe(false);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.energy).toBe(0);
      expect(s.log.filter((e) => e.t === 'charge')).toHaveLength(1);
    });
  });

  it('surviving a fight also adds 1', () => {
    withCard('ember_scout', { keywords: ['charge:3'] }, () => {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('ember_scout', 9);
      s.players[1].lanes[0] = unit('beacon_wisp', 9);
      expect(applyAction(s, { type: 'attack', lane: 0 }).players[0].lanes[0]!.energy).toBe(1);
    });
  });

  it('healSelf restores hp up to the card hp', () => {
    withCard('gorge_guard', { keywords: ['charge:1'], effects: [{ trigger: 'onCharge', op: 'healSelf', args: { n: 2 } }] }, () => {
      let s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = unit('gorge_guard', 1);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.hp).toBe(3);
      s = endTurn(endTurn(s));
      expect(s.players[0].lanes[0]!.hp).toBe(4); // 마그네슘 수호병 체력 4가 상한
    });
  });

  it('equipped items add their armor', () => {
    withCard('it_stone_mail', { keywords: ['armor:2'] }, () => {
      const s = createGame(DECKS.union, DECKS.covalent, 1);
      s.players[0].lanes[0] = { ...unit('flame_runner', 5), atk: 3 };
      s.players[1].lanes[0] = { ...unit('hermit_sentinel', 5), equipped: ['it_stone_mail'] };
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
    s.players[0].lanes[0] = unit(990, 'ember_scout');
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
    s.players[0].lanes[0] = unit(990, 'ember_scout');
    s = endTurn(endTurn(s));
    s.players[1].lanes[0] = unit(991, 'abbey_wall');
    s = endTurn(endTurn(s));
    expect(s.players[0].capture[0]).toBe(0);
    expect(s.players[0].elements).toEqual([]);
  });

  it('owning the same element discounts cost, the same group buffs the unit', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 1);
    s.leyline = null;
    const [mg] = giveHand(s, 0, ['gorge_guard']); // 마그네슘 수호병: Lv2 1/4, 알칼리토
    s.players[0].pool = 1;
    expect(() => applyAction(s, { type: 'play', uid: mg, lane: 0 })).toThrow();
    s.players[0].elements = ['iron_gorge'];
    const after = applyAction(s, { type: 'play', uid: mg, lane: 0 });
    expect(after.players[0].pool).toBe(0);
    expect(after.players[0].lanes[0]).toMatchObject({ atk: 2, hp: 5 });
  });
});

describe('faction element use', () => {
  const unit = (uid: number, cardId: string) => ({ uid, cardId, atk: 1, hp: 9, sick: false, attacked: false });

  it('union reacts two elements: lane damage + entropy, metal+nonmetal adds ion bonus, noble cannot react', () => {
    const s = createGame(DECKS.union, DECKS.covalent, 1);
    s.players[1].lanes[1] = unit(991, 'abbey_wall');
    s.players[0].elements = ['salt_flame', 'storm_cliff', 'ember_hill', 'ghost_beacon'];
    s.players[0].pool = 10;
    const e0 = s.players[1].entropy;
    const r = BALANCE.elements.react;
    const ion = applyAction(s, { type: 'react', lane: 1, a: 'salt_flame', b: 'storm_cliff' });
    expect(ion.players[1].lanes[1]!.hp).toBe(9 - r.damage - r.ionBonus);
    expect(ion.players[1].entropy).toBe(e0 + r.entropy);
    expect(ion.players[0].elements).toEqual(['ember_hill', 'ghost_beacon']);
    expect(ion.players[0].pool).toBe(10 - r.cost);
    expect(applyAction(s, { type: 'react', lane: 1, a: 'salt_flame', b: 'ember_hill' }).players[1].lanes[1]!.hp).toBe(9 - r.damage);
    expect(() => applyAction(s, { type: 'react', lane: 1, a: 'salt_flame', b: 'ghost_beacon' })).toThrow();
  });

  it('covalent bonds elements: each owned element adds pool at turn start', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.players[0].bases = 2;
    s.players[0].elements = ['obsidian_pit', 'steel_bastion'];
    s = endTurn(endTurn(s));
    expect(s.players[0].pool).toBe(2 + 2 * BALANCE.elements.bondPool);
  });

  it('decay: radioactive elements follow the decay chain and raise enemy entropy; any element can be burned for pool', () => {
    let s = createGame(DECKS.decay, DECKS.union, 1);
    s.players[0].elements = ['cursed_tomb', 'steel_bastion'];
    const e0 = s.players[1].entropy;
    s = endTurn(endTurn(s));
    expect(s.players[0].elements).toEqual(['withered_graves', 'steel_bastion']);
    // 상대(마탑)는 카드를 쓰지 않고 턴을 넘겨 idle 페널티도 받는다
    expect(s.players[1].entropy).toBe(e0 + BALANCE.naturalEntropy + BALANCE.hand.idleEntropy + BALANCE.elements.chainEntropy);
    const pool = s.players[0].pool;
    s = applyAction(s, { type: 'decay', from: 'element', element: 'steel_bastion' });
    expect(s.players[0].pool).toBe(pool + BALANCE.elements.burnGain);
    expect(s.players[0].elements).toEqual(['withered_graves']);
  });
});

describe('covalent element capture', () => {
  it('covalent keeps capturing while an enemy stands opposite, and draws on capture', () => {
    let s = createGame(DECKS.covalent, DECKS.union, 1);
    s.leyline = null;
    s.players[0].lanes[0] = { uid: 990, cardId: 'abbey_wall', atk: 0, hp: 9, sick: false, attacked: false };
    s.players[1].lanes[0] = { uid: 991, cardId: 'ember_scout', atk: 0, hp: 9, sick: false, attacked: false };
    const tile = s.tiles[0]!;
    s = endTurn(endTurn(s));
    s = endTurn(s);
    s.players[0].hand.splice(0, 2); // 손패가 가득 차면 드로우하지 않으므로 자리를 비운다
    const hand = s.players[0].hand.length;
    s = endTurn(s);
    expect(s.players[0].elements).toEqual([tile]);
    expect(s.players[0].hand.length).toBe(hand + BALANCE.elements.bondDraw); // 지난 턴 사용 0장 → 턴 드로우 없음, 결합 드로우만
  });
});

describe('land hold effects (대지 보유 효과)', () => {
  it('each owned land fires at my turn start by aspect, strength by tier', () => {
    let s = createGame(DECKS.covalent, DECKS.covalent, 1);
    const unit = (uid: number, cardId: string, atk: number, hp: number) => ({ uid, cardId, atk, hp, sick: false, attacked: false });
    // 빛 강철 성채(4등급) 회복 2, 그림자 흑요석 광산(2등급) 피해 1, 봉인 유령 등대(2등급) 파멸 1 · 공허의 문(7등급) 파멸 2
    s.players[0].elements = ['steel_bastion', 'obsidian_pit', 'ghost_beacon', 'void_gate'];
    s.players[0].lanes[0] = unit(901, 'abbey_wall', 0, 1); // 가장 약한 다친 유닛
    s.players[0].lanes[1] = unit(902, 'abbey_wall', 0, 4);
    s.players[1].lanes[2] = unit(903, 'steel_knight', 5, 6); // 공격력 최고
    s.players[1].lanes[3] = unit(904, 'steel_knight', 1, 6);
    s = endTurn(s);
    s.players[1].lanes.forEach((u) => { if (u) u.attacked = true; }); // 상대 유닛은 공격하지 않게
    s = endTurn(s);
    expect(s.players[0].lanes[0]!.hp).toBe(3);
    expect(s.players[0].lanes[1]!.hp).toBe(4);
    expect(s.players[1].lanes[2]!.hp).toBe(5);
    expect(s.players[1].lanes[3]!.hp).toBe(6);
    expect(s.log.filter((e) => e.t === 'entropy' && e.cause === 'land').map((e) => e.t === 'entropy' && e.amount)).toEqual([1, 2]);
  });
});

describe('leyline (지맥)', () => {
  it('is the group of one of the starting tiles', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(DECKS.union, DECKS.covalent, seed);
      expect(s.tiles.map((e) => getLand(e!).race)).toContain(s.leyline);
    }
  });

  it('multiplies the resonance of its group', () => {
    const l = BALANCE.elements.leyline;
    const t = createGame(DECKS.union, DECKS.covalent, 1);
    t.leyline = '용병';
    t.players[0].elements = ['iron_gorge'];
    t.players[0].pool = 10;
    const [mg] = giveHand(t, 0, ['gorge_guard']); // Lv2 1/4 알칼리토
    const after = applyAction(t, { type: 'play', uid: mg, lane: 1 });
    const buff = BALANCE.elements.groupBuff * l.resonanceMult;
    expect(after.players[0].lanes[1]).toMatchObject({ atk: 1 + buff, hp: 4 + buff });
    expect(after.players[0].pool).toBe(10 - Math.max(1, 2 - BALANCE.elements.costDiscount * l.resonanceMult));
  });
});

describe('period tech tree (전승 테크트리)', () => {
  it('caps playable level by the highest period ever captured, and spending elements keeps it', () => {
    const t = BALANCE.elements.tech;
    let s = createGame(DECKS.union, DECKS.covalent, 1);
    s.leyline = null;
    const [ba] = giveHand(s, 0, ['giant_captain']); // 바륨 거인 L7
    s.players[0].pool = 10;
    expect(t.baseLevel.union).toBeLessThan(7);
    expect(() => applyAction(s, { type: 'play', uid: ba, lane: 0 })).toThrow('locked');
    expect(legalActions(s).some((a) => a.type === 'play' && a.uid === ba)).toBe(false);

    // (7 - offset)등급 대지를 점령으로 얻으면 L7이 열린다
    const sym = LANDS.find((e) => !e.corrupted && e.tier === 7 - t.periodOffset)!.key;
    s.tiles[1] = sym;
    s.players[0].lanes[1] = { uid: 990, cardId: 'ember_scout', atk: 1, hp: 9, sick: false, attacked: false };
    for (let i = 0; i < BALANCE.elements.captureTurns.union; i++) s = endTurn(endTurn(s));
    expect(s.players[0].tech).toBe(7 - t.periodOffset);
    // 융합 주문으로 대지를 써도 전승 단계는 유지
    s.players[0].elements.push('salt_flame');
    s.players[0].pool = 20;
    s = applyAction(s, { type: 'react', lane: 0, a: sym, b: 'salt_flame' });
    expect(s.players[0].elements).not.toContain(sym);
    expect(applyAction(s, { type: 'play', uid: ba, lane: 0 }).players[0].lanes[0]?.cardId).toBe('giant_captain');
  });

  it('decay is not limited (base level covers its whole deck)', () => {
    const s = createGame(DECKS.decay, DECKS.union, 1);
    const [og] = giveHand(s, 0, ['void_titan']); // L9
    s.players[0].pool = 20;
    expect(applyAction(s, { type: 'play', uid: og, lane: 0 }).players[0].lanes[0]?.cardId).toBe('void_titan');
  });
});
