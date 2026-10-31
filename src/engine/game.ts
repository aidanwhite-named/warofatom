import { getCard } from '../data/cards';
import { BALANCE } from './config';
import { ops } from './effects';
import { decayGain, resourceRules } from './resources';
import { shuffle } from './rng';
import type { Action, CardDef, EntropyCause, Faction, GameEvent, GameState, PlayerState, Trigger, Unit } from './types';
import { LANES } from './types';

export type DeckSpec = { faction: Faction; cards: string[] };

export function createGame(a: DeckSpec, b: DeckSpec, seed = 1): GameState {
  let rng = seed;
  let nextUid = 1;
  const mkPlayer = (spec: DeckSpec): PlayerState => {
    const [deck, ns] = shuffle(
      spec.cards.map((cardId) => ({ uid: nextUid++, cardId })),
      rng,
    );
    rng = ns;
    const cov = spec.faction === 'covalent';
    return {
      faction: spec.faction,
      entropy: 0,
      deck,
      hand: [],
      discard: [],
      lanes: Array(LANES).fill(null),
      pool: 0,
      lattices: cov ? BALANCE.covalent.startLattices : 0,
      latticePile: cov ? BALANCE.covalent.pileSize : 0,
      latticePlayed: false,
      unitsPlayedThisTurn: 0,
      turns: 0,
    };
  };
  const s: GameState = {
    players: [mkPlayer(a), mkPlayer(b)],
    active: 0,
    turn: 0,
    winner: null,
    rng,
    nextUid,
    log: [],
  };
  for (let i = 0; i < BALANCE.startHand[0]; i++) drawCard(s, 0);
  for (let i = 0; i < BALANCE.startHand[1]; i++) drawCard(s, 1);
  s.log = [];
  startTurn(s);
  return s;
}

function emit(s: GameState, e: GameEvent) {
  s.log.push(e);
}

export function drawCard(s: GameState, p: 0 | 1) {
  const pl = s.players[p];
  const c = pl.deck.shift();
  if (!c) {
    addEntropy(s, p, BALANCE.fatigueEntropy, 'fatigue');
    return;
  }
  pl.hand.push(c);
  emit(s, { t: 'draw', p, cardId: c.cardId });
}

// 엔트로피가 최대치에 도달하면 소멸 → 상대 승리
export function addEntropy(s: GameState, p: 0 | 1, amount: number, cause: EntropyCause) {
  if (amount <= 0) return;
  const pl = s.players[p];
  pl.entropy = Math.min(pl.entropy + amount, BALANCE.maxEntropy);
  emit(s, { t: 'entropy', p, amount, total: pl.entropy, cause });
  if (pl.entropy >= BALANCE.maxEntropy && s.winner === null) {
    s.winner = (1 - p) as 0 | 1;
    emit(s, { t: 'win', p: s.winner });
  }
}

export function destroyUnit(s: GameState, p: 0 | 1, lane: number, reason: 'combat' | 'halfLife' | 'decay' | 'effect') {
  const pl = s.players[p];
  const u = pl.lanes[lane];
  if (!u) return;
  pl.lanes[lane] = null;
  pl.discard.push({ uid: u.uid, cardId: u.cardId });
  emit(s, { t: 'death', p, cardId: u.cardId, lane, reason });
  runTrigger(s, p, lane, getCard(u.cardId), 'onDeath', null);
}

function runTrigger(s: GameState, p: 0 | 1, lane: number, def: CardDef, trig: Trigger, unit: Unit | null, chained = false) {
  for (const e of def.effects ?? []) {
    if (e.trigger !== trig) continue;
    if (e.chain && !chained) continue;
    ops[e.op]?.({ s, p, lane, unit }, e.args ?? {});
  }
}

function keywordValue(def: CardDef, key: string): number | undefined {
  const kw = def.keywords?.find((k) => k.startsWith(key + ':'));
  return kw ? Number(kw.split(':')[1]) : undefined;
}

function startTurn(s: GameState) {
  const p = s.active;
  const pl = s.players[p];
  s.turn++;
  pl.turns++;
  pl.latticePlayed = false;
  pl.unitsPlayedThisTurn = 0;
  addEntropy(s, p, BALANCE.naturalEntropy, 'natural');
  if (s.winner !== null) return;
  resourceRules[pl.faction].onTurnStart(pl);
  if (p === 1 && pl.turns === 1) pl.pool += BALANCE.secondPlayerBonus;
  emit(s, { t: 'turnStart', p, pool: pl.pool });
  if (s.turn > 1) drawCard(s, p);
  pl.lanes.forEach((u, lane) => {
    if (!u) return;
    u.sick = false;
    u.attacked = false;
    if (u.halfLife !== undefined && --u.halfLife <= 0) destroyUnit(s, p, lane, 'halfLife');
  });
}

export function applyAction(state: GameState, action: Action): GameState {
  if (state.winner !== null) throw new Error('game over');
  const s = structuredClone(state);
  const p = s.active;
  const pl = s.players[p];
  const foe = s.players[1 - p];

  switch (action.type) {
    case 'play': {
      const idx = pl.hand.findIndex((c) => c.uid === action.uid);
      if (idx < 0) throw new Error('card not in hand');
      const inst = pl.hand[idx];
      const def = getCard(inst.cardId);
      const lane = action.lane;
      if (lane < 0 || lane >= LANES) throw new Error('bad lane');
      if (pl.lanes[lane]) throw new Error('lane occupied');
      if (pl.pool < def.level) throw new Error('not enough resource');
      pl.pool -= def.level;
      pl.hand.splice(idx, 1);
      const unit: Unit = { uid: inst.uid, cardId: def.id, atk: def.atk, hp: def.hp, sick: true, attacked: false, halfLife: keywordValue(def, 'halfLife') };
      pl.lanes[lane] = unit;
      const chained = def.faction === 'union' && pl.unitsPlayedThisTurn > 0;
      pl.unitsPlayedThisTurn++;
      emit(s, { t: 'play', p, cardId: def.id, lane });
      runTrigger(s, p, lane, def, 'onPlay', unit, chained);
      break;
    }
    case 'lattice': {
      if (pl.faction !== 'covalent') throw new Error('only covalent can place lattice');
      if (pl.latticePlayed) throw new Error('lattice already placed this turn');
      if (pl.latticePile <= 0) throw new Error('no lattice left');
      pl.latticePile--;
      pl.lattices++;
      pl.latticePlayed = true;
      emit(s, { t: 'lattice', p, total: pl.lattices });
      break;
    }
    case 'attack': {
      const u = pl.lanes[action.lane];
      if (!u) throw new Error('no unit in lane');
      if (u.sick || u.attacked) throw new Error('unit cannot attack');
      u.attacked = true;
      const target = foe.lanes[action.lane];
      if (target) {
        emit(s, { t: 'attack', p, lane: action.lane, target: 'unit', dmg: u.atk });
        target.hp -= u.atk;
        u.hp -= target.atk;
        if (target.hp <= 0) destroyUnit(s, (1 - p) as 0 | 1, action.lane, 'combat');
        if (u.hp <= 0) destroyUnit(s, p, action.lane, 'combat');
      } else {
        // 막을 유닛이 없으면 공격력만큼 상대 엔트로피 증가
        emit(s, { t: 'attack', p, lane: action.lane, target: 'entropy', dmg: u.atk });
        addEntropy(s, (1 - p) as 0 | 1, u.atk, 'attack');
      }
      break;
    }
    case 'decay': {
      if (pl.faction !== 'decay') throw new Error('only decay faction can decay');
      let cardId: string;
      let gain: number;
      if (action.from === 'hand') {
        const idx = pl.hand.findIndex((c) => c.uid === action.uid);
        if (idx < 0) throw new Error('card not in hand');
        const [c] = pl.hand.splice(idx, 1);
        pl.discard.push(c);
        cardId = c.cardId;
        gain = decayGain.hand(getCard(cardId).level);
      } else {
        const lane = pl.lanes.findIndex((u) => u?.uid === action.uid);
        if (lane < 0) throw new Error('unit not on board');
        cardId = pl.lanes[lane]!.cardId;
        gain = decayGain.board(getCard(cardId).level);
        destroyUnit(s, p, lane, 'decay');
      }
      pl.pool += gain;
      emit(s, { t: 'decay', p, cardId, gain });
      for (let i = 0; i < BALANCE.decay.decayDraw; i++) drawCard(s, p);
      break;
    }
    case 'endTurn': {
      s.active = (1 - p) as 0 | 1;
      startTurn(s);
      break;
    }
  }
  return s;
}

export function legalActions(s: GameState): Action[] {
  if (s.winner !== null) return [];
  const pl = s.players[s.active];
  const out: Action[] = [{ type: 'endTurn' }];
  if (pl.faction === 'covalent' && !pl.latticePlayed && pl.latticePile > 0) out.push({ type: 'lattice' });
  const emptyLanes = pl.lanes.flatMap((u, i) => (u ? [] : [i]));
  for (const c of pl.hand) {
    if (getCard(c.cardId).level <= pl.pool) {
      for (const lane of emptyLanes) out.push({ type: 'play', uid: c.uid, lane });
    }
    if (pl.faction === 'decay') out.push({ type: 'decay', from: 'hand', uid: c.uid });
  }
  pl.lanes.forEach((u, lane) => {
    if (!u) return;
    if (!u.sick && !u.attacked && u.atk > 0) out.push({ type: 'attack', lane });
    if (pl.faction === 'decay') out.push({ type: 'decay', from: 'board', uid: u.uid });
  });
  return out;
}
