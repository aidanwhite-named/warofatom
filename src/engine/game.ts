import { getCard } from '../data/cards';
import { getElement, TILE_POOL } from '../data/elements';
import { BALANCE } from './config';
import { ops } from './effects';
import { decayGain, resourceRules } from './resources';
import { nextRandom, shuffle } from './rng';
import type { Action, CardDef, CardKind, EntropyCause, Faction, GameEvent, GameState, PlayerState, Trigger, Unit } from './types';
import { LANES } from './types';

export type DeckSpec = { faction: Faction; cards: string[] };

// 진영 고유 카드 종류. 표에 없는 종류는 엔진이 거부한다 (교단의 고유 행동은 카드가 아니라 붕괴·계승)
export const FACTION_KINDS: Record<Faction, CardKind[]> = {
  union: ['unit', 'spell'],
  covalent: ['unit', 'item'],
  decay: ['unit'],
};

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
      cardsUsedThisTurn: 0,
      cardsUsedLastTurn: 1, // 첫 턴 드로우는 예전처럼 1장
      cardsDecayedThisTurn: 0,
      turns: 0,
      elements: [],
      capture: Array(LANES).fill(0),
      tech: 0,
    };
  };
  const players: [PlayerState, PlayerState] = [mkPlayer(a), mkPlayer(b)];
  // 원소 타일: 풀을 섞어 레인마다 하나씩 놓고 나머지는 보충용
  let tiles: (string | null)[] = Array(LANES).fill(null);
  let tileBag: string[] = [];
  if (BALANCE.elements.enabled) {
    const [bag, ns] = shuffle(TILE_POOL, rng);
    rng = ns;
    tiles = bag.slice(0, LANES);
    tileBag = bag.slice(LANES);
  }
  // 지맥: 처음 깔린 원소 중 하나의 계열 (판에 지맥 원소가 항상 하나 이상 있도록)
  let leyline: string | null = null;
  if (BALANCE.elements.enabled && BALANCE.elements.leyline.enabled) {
    const [r, ns] = nextRandom(rng);
    rng = ns;
    leyline = getElement(tiles[Math.floor(r * LANES)]!).group;
  }
  const s: GameState = {
    players,
    active: 0,
    turn: 0,
    winner: null,
    rng,
    nextUid,
    log: [],
    tiles,
    tileBag,
    leyline,
  };
  for (let i = 0; i < BALANCE[a.faction].startHand[0]; i++) drawCard(s, 0);
  for (let i = 0; i < BALANCE[b.faction].startHand[1]; i++) drawCard(s, 1);
  s.log = [];
  startTurn(s);
  return s;
}

function emit(s: GameState, e: GameEvent) {
  s.log.push(e);
}

// 손패가 가득 차 있으면 드로우하지 않는다 (카드는 덱에 남는다)
export function drawCard(s: GameState, p: 0 | 1) {
  const pl = s.players[p];
  if (pl.hand.length >= BALANCE.hand.max) return;
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

export function destroyUnit(s: GameState, p: 0 | 1, lane: number, reason: 'combat' | 'halfLife' | 'decay' | 'effect' | 'upkeep') {
  const pl = s.players[p];
  const u = pl.lanes[lane];
  if (!u) return;
  pl.lanes[lane] = null;
  pl.discard.push({ uid: u.uid, cardId: u.cardId });
  emit(s, { t: 'death', p, cardId: u.cardId, lane, reason });
  runTrigger(s, p, lane, getCard(u.cardId), 'onDeath', null);
  for (const id of u.inherited ?? []) runTrigger(s, p, lane, getCard(id), 'onDeath', null);
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

// 방어력(armor)은 전투 피해를, 저항(resist)은 효과·마법 피해를 N만큼 줄인다 (최소 0). 장착 아이템의 키워드도 더한다
export function reducedDamage(u: Unit, dmg: number, key: 'armor' | 'resist'): number {
  const total = [u.cardId, ...(u.equipped ?? [])].reduce((a, id) => a + (keywordValue(getCard(id), key) ?? 0), 0);
  return Math.max(0, dmg - total);
}

// 공명 배율: 지맥 계열이면 resonanceMult배
function resonance(s: GameState, group: string): number {
  return group === s.leyline ? BALANCE.elements.leyline.resonanceMult : 1;
}

// 카드 비용: 같은 원소를 획득했으면 공명 할인 (최소 1)
export function costOf(s: GameState, pl: PlayerState, def: CardDef): number {
  if (!pl.elements.includes(def.element)) return def.level;
  return Math.max(1, def.level - BALANCE.elements.costDiscount * resonance(s, getElement(def.element).group));
}

// 주기 테크트리: 낼 수 있는 카드 레벨 상한 (진영별 기본값)
export function levelCap(pl: PlayerState): number {
  const t = BALANCE.elements.tech;
  if (!BALANCE.elements.enabled || !t.enabled) return Infinity;
  return Math.max(t.baseLevel[pl.faction], pl.tech + t.periodOffset);
}

export function isLocked(pl: PlayerState, def: CardDef): boolean {
  return def.level > levelCap(pl);
}

// 원소를 얻으면 연구 단계 갱신
function gainElement(pl: PlayerState, element: string) {
  pl.elements.push(element);
  pl.tech = Math.max(pl.tech, getElement(element).period);
}

// 레인 장악: 내 유닛만 있는 레인에서 내 턴을 captureTurns번 연속 시작하면 그 원소를 가져오고, 빈자리는 보충한다
function captureTiles(s: GameState, p: 0 | 1) {
  const pl = s.players[p];
  const foe = s.players[1 - p];
  s.tiles.forEach((element, lane) => {
    if (!element) return;
    if (!pl.lanes[lane] || (foe.lanes[lane] && !BALANCE.elements.contest[pl.faction])) { pl.capture[lane] = 0; return; }
    if (++pl.capture[lane] < BALANCE.elements.captureTurns[pl.faction]) return;
    gainElement(pl, element);
    pl.capture[lane] = 0;
    foe.capture[lane] = 0;
    s.tiles[lane] = s.tileBag.shift() ?? null;
    emit(s, { t: 'capture', p, lane, element });
    if (pl.faction === 'covalent') for (let i = 0; i < BALANCE.elements.bondDraw; i++) drawCard(s, p);
  });
}

// 교단 붕괴 사슬: 가진 방사성 원소가 매 턴 한 단계씩 붕괴하고, 그때마다 상대 엔트로피 증가
function transmute(s: GameState, p: 0 | 1) {
  const pl = s.players[p];
  pl.elements = pl.elements.map((from) => {
    const to = getElement(from).decaysTo;
    if (!to) return from;
    emit(s, { t: 'transmute', p, from, to });
    pl.tech = Math.max(pl.tech, getElement(to).period);
    addEntropy(s, (1 - p) as 0 | 1, BALANCE.elements.chainEntropy, 'effect');
    return to;
  });
}

// 가진 원소 하나를 꺼낸다 (없으면 예외)
function takeElement(pl: PlayerState, element: string) {
  const i = pl.elements.indexOf(element);
  if (i < 0) throw new Error(`element ${element} not owned`);
  pl.elements.splice(i, 1);
}

// 연맹 반응 피해: 기본 + 금속·비금속 짝이면 이온 반응 보너스. 비활성 원소는 반응하지 않는다
export function reactDamage(a: string, b: string): number {
  const na = getElement(a).nature, nb = getElement(b).nature;
  if (na === 'noble' || nb === 'noble') throw new Error('noble elements do not react');
  const r = BALANCE.elements.react;
  return r.damage + (na !== nb ? r.ionBonus : 0);
}

// 기력: charge:N 유닛은 기력이 N 모일 때마다 onCharge 효과를 발동하고 0으로 돌아간다
function gainEnergy(s: GameState, p: 0 | 1, lane: number) {
  const u = s.players[p].lanes[lane];
  if (!u) return;
  const def = getCard(u.cardId);
  const need = keywordValue(def, 'charge');
  if (!need) return;
  u.energy = (u.energy ?? 0) + 1;
  if (u.energy < need) return;
  u.energy = 0;
  emit(s, { t: 'charge', p, cardId: u.cardId, lane });
  runTrigger(s, p, lane, def, 'onCharge', u);
}

function startTurn(s: GameState) {
  const p = s.active;
  const pl = s.players[p];
  s.turn++;
  pl.turns++;
  pl.latticePlayed = false;
  pl.unitsPlayedThisTurn = 0;
  pl.cardsUsedLastTurn = pl.cardsUsedThisTurn;
  pl.cardsUsedThisTurn = 0;
  pl.cardsDecayedThisTurn = 0;
  addEntropy(s, p, BALANCE.naturalEntropy, 'natural');
  if (s.winner !== null) return;
  resourceRules[pl.faction].onTurnStart(pl);
  if (p === 1 && pl.turns === 1) pl.pool += BALANCE[pl.faction].secondPool;
  emit(s, { t: 'turnStart', p, pool: pl.pool });
  // 지난 턴 사용한 만큼 드로우 (손패 상한까지)
  if (s.turn > 1) for (let i = 0; i < pl.cardsUsedLastTurn; i++) drawCard(s, p);
  pl.lanes.forEach((u, lane) => {
    if (!u) return;
    u.sick = false;
    u.attacked = false;
    if (u.halfLife !== undefined && --u.halfLife <= 0) destroyUnit(s, p, lane, 'halfLife');
    // 유지비: 레인 순서대로 지불, 자원이 모자라면 그 유닛은 파괴
    const upkeep = pl.lanes[lane] ? getCard(u.cardId).upkeep ?? 0 : 0;
    if (upkeep > 0) {
      if (pl.pool >= upkeep) pl.pool -= upkeep;
      else destroyUnit(s, p, lane, 'upkeep');
    }
    gainEnergy(s, p, lane);
  });
  if (pl.faction === 'decay') transmute(s, p);
  captureTiles(s, p);
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
      const kind = def.kind ?? 'unit';
      if (lane < 0 || lane >= LANES) throw new Error('bad lane');
      if (!FACTION_KINDS[pl.faction].includes(kind)) throw new Error(`${pl.faction} cannot play ${kind}`);
      if (isLocked(pl, def)) throw new Error('card locked by tech');
      if (kind === 'unit' && pl.lanes[lane]) throw new Error('lane occupied');
      if (kind === 'item' && !pl.lanes[lane]) throw new Error('no unit to equip');
      // 과부하(연맹 마법 전용): 내 엔트로피를 올리는 대신 비용 할인
      const o = BALANCE.union.overload;
      if (action.overload && kind !== 'spell') throw new Error('only spells can overload');
      const cost = Math.max(0, costOf(s, pl, def) - (action.overload ? o.discount : 0));
      if (pl.pool < cost) throw new Error('not enough resource');
      pl.pool -= cost;
      pl.hand.splice(idx, 1);
      pl.cardsUsedThisTurn++;
      const chained = def.faction === 'union' && pl.unitsPlayedThisTurn > 0;
      emit(s, { t: 'play', p, cardId: def.id, lane });
      if (action.overload) addEntropy(s, p, o.entropy, 'overload');
      if (kind === 'unit') {
        // 계열 공명: 이 카드 종족과 같은 계열 원소를 가졌으면 +N/+N
        const buff = pl.elements.some((e) => getElement(e).group === def.race) ? BALANCE.elements.groupBuff * resonance(s, def.race) : 0;
        const unit: Unit = { uid: inst.uid, cardId: def.id, atk: def.atk + buff, hp: def.hp + buff, sick: true, attacked: false, halfLife: keywordValue(def, 'halfLife') };
        pl.lanes[lane] = unit;
        pl.unitsPlayedThisTurn++;
        runTrigger(s, p, lane, def, 'onPlay', unit, chained);
      } else if (kind === 'item') {
        // 장착: 유닛에 스탯을 더한다. 유닛이 죽으면 장비도 같이 사라진다
        const target = pl.lanes[lane]!;
        target.atk += def.atk;
        target.hp += def.hp;
        target.equipped = [...(target.equipped ?? []), def.id];
        pl.discard.push(inst);
        runTrigger(s, p, lane, def, 'onPlay', target);
      } else {
        // 마법: 고른 레인에서 효과만 발동하고 버림 더미로
        pl.discard.push(inst);
        runTrigger(s, p, lane, def, 'onPlay', null, chained);
      }
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
        // 공격자가 먼저 친다. 대상이 쓰러지면 끝, 버텨내면 반격한다
        const foeP = (1 - p) as 0 | 1;
        emit(s, { t: 'attack', p, lane: action.lane, target: 'unit', dmg: u.atk });
        target.hp -= reducedDamage(target, u.atk, 'armor');
        if (target.hp <= 0) destroyUnit(s, foeP, action.lane, 'combat');
        else if (target.atk > 0) {
          emit(s, { t: 'counter', p: foeP, lane: action.lane, dmg: target.atk });
          u.hp -= reducedDamage(u, target.atk, 'armor');
          if (u.hp <= 0) destroyUnit(s, p, action.lane, 'combat');
        }
        // 전투에서 살아남은 쪽은 기력 +1
        gainEnergy(s, p, action.lane);
        gainEnergy(s, (1 - p) as 0 | 1, action.lane);
      } else {
        // 막을 유닛이 없으면 공격력만큼 상대 엔트로피 증가
        emit(s, { t: 'attack', p, lane: action.lane, target: 'entropy', dmg: u.atk });
        addEntropy(s, (1 - p) as 0 | 1, u.atk, 'attack');
      }
      break;
    }
    case 'decay': {
      if (pl.faction !== 'decay') throw new Error('only decay faction can decay');
      if (action.from === 'element') {
        takeElement(pl, action.element);
        pl.pool += BALANCE.elements.burnGain;
        emit(s, { t: 'burn', p, element: action.element, gain: BALANCE.elements.burnGain });
        break;
      }
      let cardId: string;
      let gain: number;
      if (action.from === 'hand') {
        const idx = pl.hand.findIndex((c) => c.uid === action.uid);
        if (idx < 0) throw new Error('card not in hand');
        const [c] = pl.hand.splice(idx, 1);
        if (pl.cardsDecayedThisTurn++ < BALANCE.hand.decayCounts) pl.cardsUsedThisTurn++;
        pl.discard.push(c);
        cardId = c.cardId;
        gain = decayGain.hand(getCard(cardId).level);
      } else {
        const lane = pl.lanes.findIndex((u) => u?.uid === action.uid);
        if (lane < 0) throw new Error('unit not on board');
        cardId = pl.lanes[lane]!.cardId;
        gain = decayGain.board(getCard(cardId).level);
        // 계승: 다른 내 유닛이 붕괴한 유닛의 효과를 물려받는다. 소환 시 효과는 그 자리에서 다시 발동
        const heirLane = action.heir === undefined ? -1 : pl.lanes.findIndex((h) => h?.uid === action.heir);
        if (action.heir !== undefined && (heirLane < 0 || heirLane === lane)) throw new Error('bad heir');
        destroyUnit(s, p, lane, 'decay');
        const heir = heirLane < 0 ? null : pl.lanes[heirLane];
        if (heir) {
          heir.inherited = [...(heir.inherited ?? []), cardId];
          emit(s, { t: 'inherit', p, cardId, lane: heirLane });
          runTrigger(s, p, heirLane, getCard(cardId), 'onPlay', heir);
        }
      }
      pl.pool += gain;
      emit(s, { t: 'decay', p, cardId, gain });
      for (let i = 0; i < BALANCE.decay.decayDraw; i++) drawCard(s, p);
      break;
    }
    case 'react': {
      if (pl.faction !== 'union') throw new Error('only union can react');
      if (action.lane < 0 || action.lane >= LANES) throw new Error('bad lane');
      const dmg = reactDamage(action.a, action.b);
      if (pl.pool < BALANCE.elements.react.cost) throw new Error('not enough resource');
      pl.pool -= BALANCE.elements.react.cost;
      takeElement(pl, action.a);
      takeElement(pl, action.b);
      emit(s, { t: 'react', p, lane: action.lane, elements: [action.a, action.b], dmg });
      ops.strikeOpposite({ s, p, lane: action.lane, unit: null }, { n: dmg });
      addEntropy(s, (1 - p) as 0 | 1, BALANCE.elements.react.entropy, 'effect');
      break;
    }
    case 'endTurn': {
      // 쓸 수 있는 카드가 있었는데 한 장도 쓰지 않았으면 엔트로피 페널티
      if (pl.cardsUsedThisTurn === 0 && canUseCard(s)) addEntropy(s, p, BALANCE.hand.idleEntropy, 'idle');
      if (s.winner !== null) break;
      s.active = (1 - p) as 0 | 1;
      startTurn(s);
      break;
    }
  }
  return s;
}

// 지금 손패에서 낼(또는 붕괴할) 수 있는 카드가 있는지
function canUseCard(s: GameState): boolean {
  return legalActions(s).some((a) => a.type === 'play' || (a.type === 'decay' && a.from === 'hand'));
}

export function legalActions(s: GameState): Action[] {
  if (s.winner !== null) return [];
  const pl = s.players[s.active];
  const out: Action[] = [{ type: 'endTurn' }];
  if (pl.faction === 'covalent' && !pl.latticePlayed && pl.latticePile > 0) out.push({ type: 'lattice' });
  const emptyLanes = pl.lanes.flatMap((u, i) => (u ? [] : [i]));
  const unitLanes = pl.lanes.flatMap((u, i) => (u ? [i] : []));
  const o = BALANCE.union.overload;
  for (const c of pl.hand) {
    const def = getCard(c.cardId);
    const kind = def.kind ?? 'unit';
    const lanes = kind === 'unit' ? emptyLanes : kind === 'item' ? unitLanes : Array.from({ length: LANES }, (_, i) => i);
    const cost = costOf(s, pl, def);
    if (isLocked(pl, def)) { if (pl.faction === 'decay') out.push({ type: 'decay', from: 'hand', uid: c.uid }); continue; }
    if (cost <= pl.pool) for (const lane of lanes) out.push({ type: 'play', uid: c.uid, lane });
    if (kind === 'spell' && cost > pl.pool && cost - o.discount <= pl.pool) {
      for (const lane of lanes) out.push({ type: 'play', uid: c.uid, lane, overload: true });
    }
    if (pl.faction === 'decay') out.push({ type: 'decay', from: 'hand', uid: c.uid });
  }
  pl.lanes.forEach((u, lane) => {
    if (!u) return;
    if (!u.sick && !u.attacked && u.atk > 0) out.push({ type: 'attack', lane });
    if (pl.faction === 'decay') {
      out.push({ type: 'decay', from: 'board', uid: u.uid });
      for (const h of pl.lanes) if (h && h !== u) out.push({ type: 'decay', from: 'board', uid: u.uid, heir: h.uid });
    }
  });
  if (pl.faction === 'decay') for (const element of new Set(pl.elements)) out.push({ type: 'decay', from: 'element', element });
  if (pl.faction === 'union' && pl.pool >= BALANCE.elements.react.cost) {
    const reactive = pl.elements.filter((e) => getElement(e).nature !== 'noble');
    for (let i = 0; i < reactive.length; i++) for (let j = i + 1; j < reactive.length; j++) {
      for (let lane = 0; lane < LANES; lane++) out.push({ type: 'react', lane, a: reactive[i], b: reactive[j] });
    }
  }
  return out;
}
