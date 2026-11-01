import { getCard } from '../data/cards';
import { FACTION_RACES } from '../data/factions';
import { getLand, LAND_POOL } from '../data/lands';
import { BALANCE } from './config';
import { ops } from './effects';
import { decayGain, resourceRules } from './resources';
import { nextRandom, shuffle } from './rng';
import type { Action, CardDef, CardKind, EntropyCause, Faction, GameEvent, GameState, PlayerState, Trigger, Unit } from './types';
import { LANES } from './types';

export type DeckSpec = { faction: Faction; cards: string[] }; // 베이스 카드(base_<진영>)도 cards에 들어간다

// 진영 고유 카드 종류. 표에 없는 종류는 엔진이 거부한다 (교단의 고유 행동은 카드가 아니라 제물·빙의)
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
    return {
      faction: spec.faction,
      entropy: 0,
      deck,
      hand: [],
      discard: [],
      lanes: Array(LANES).fill(null),
      pool: 0,
      bases: 0,
      basesPlaced: 0,
      borrowed: false,
      unitsPlayedThisTurn: 0,
      cardsUsedThisTurn: 0,
      cardsUsedLastTurn: 1, // 첫 턴 드로우는 예전처럼 1장
      shuffledThisTurn: false,
      cardsDecayedThisTurn: 0,
      turns: 0,
      spire: 0,
      elements: [],
      capture: Array(LANES).fill(0),
      tech: 0,
    };
  };
  const players: [PlayerState, PlayerState] = [mkPlayer(a), mkPlayer(b)];
  // 대지: 풀을 섞어 레인마다 하나씩 놓고 나머지는 보충용
  let tiles: (string | null)[] = Array(LANES).fill(null);
  let tileBag: string[] = [];
  if (BALANCE.elements.enabled) {
    const [bag, ns] = shuffle(LAND_POOL, rng);
    rng = ns;
    tiles = bag.slice(0, LANES);
    tileBag = bag.slice(LANES);
  }
  // 지맥: 처음 깔린 대지 중 하나의 종족 (판에 지맥 대지가 항상 하나 이상 있도록)
  let leyline: string | null = null;
  if (BALANCE.elements.enabled && BALANCE.elements.leyline.enabled) {
    const [r, ns] = nextRandom(rng);
    rng = ns;
    leyline = getLand(tiles[Math.floor(r * LANES)]!).race;
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

// 파멸이 최대치에 도달하면 패배 → 상대 승리
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

// 공명 배율: 지맥 종족이면 resonanceMult배
function resonance(s: GameState, group: string): number {
  return group === s.leyline ? BALANCE.elements.leyline.resonanceMult : 1;
}

// 레벨 = 색 아이콘 + 빈 아이콘(유지비). 색 아이콘은 그 세력의 힘, 빈 아이콘은 어느 세력 자원으로도 같은 값
export function colorIcons(def: CardDef): number {
  return def.level - (def.upkeep ?? 0);
}

// 객원 가산: 내 세력이 아닌 카드는 남의 색 아이콘 하나당 비용 +colorTax.
// 그 카드 세력의 대지를 하나라도 가졌으면 현지 협력으로 가산 없음
export function foreignTax(pl: PlayerState, def: CardDef): number {
  if (def.faction === pl.faction) return 0;
  if (BALANCE.deck.guestWaiver && pl.elements.some((e) => FACTION_RACES[def.faction].includes(getLand(e).race))) return 0;
  return Math.ceil(colorIcons(def) * BALANCE.deck.colorTax);
}

// 카드 비용: 레벨 + 객원 가산, 연고 대지를 점령했으면 공명 할인 (최소 1)
export function costOf(s: GameState, pl: PlayerState, def: CardDef): number {
  const base = def.level + foreignTax(pl, def);
  if (!def.land || !pl.elements.includes(def.land)) return base;
  return Math.max(1, base - BALANCE.elements.costDiscount * resonance(s, getLand(def.land).race));
}

// 덱 구성 규칙 위반 목록 (빈 배열이면 통과). docs/rules.md 3-1절
export function validateDeck(spec: DeckSpec): string[] {
  const d = BALANCE.deck;
  const errors: string[] = [];
  if (spec.cards.length < d.size || spec.cards.length > d.maxTotal) errors.push(`덱은 ${d.size}~${d.maxTotal}장이어야 한다 (지금 ${spec.cards.length}장)`);
  const counts = new Map<string, number>();
  for (const id of spec.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const def = getCard(id);
    const kind = def.kind ?? 'unit';
    if (kind !== 'base' && n > d.copies) errors.push(`${def.name}: 같은 카드는 ${d.copies}장까지 (지금 ${n}장)`);
    if (def.faction !== spec.faction && !FACTION_KINDS[spec.faction].includes(kind)) errors.push(`${def.name}: 객원으로 쓸 수 없는 종류`);
  }
  const guests = spec.cards.filter((id) => getCard(id).faction !== spec.faction).length;
  if (guests > d.guestMax) errors.push(`객원 카드는 ${d.guestMax}장까지 (지금 ${guests}장)`);
  return errors;
}

// 전승 테크트리: 낼 수 있는 카드 레벨 상한 (진영별 기본값)
export function levelCap(pl: PlayerState): number {
  const t = BALANCE.elements.tech;
  if (!BALANCE.elements.enabled || !t.enabled) return Infinity;
  const sp = BALANCE.union.spire;
  const spire = sp.enabled ? Math.floor(pl.spire / sp.techPer) : 0;
  return Math.max(t.baseLevel[pl.faction] + spire, pl.tech + t.periodOffset);
}

// 마탑 첨탑: 주문·융합 주문으로 층을 쌓는다 (최대 max층)
function raiseSpire(s: GameState, p: 0 | 1, n: number) {
  const pl = s.players[p], sp = BALANCE.union.spire;
  if (!sp.enabled || pl.faction !== 'union' || pl.spire >= sp.max) return;
  pl.spire = Math.min(sp.max, pl.spire + n);
  emit(s, { t: 'spire', p, floors: pl.spire });
}

// 첨탑 잔불 포격: 공격력이 가장 높은 적 유닛에게 floor(층/bombardPer) 피해 (저항 적용)
function bombard(s: GameState, p: 0 | 1) {
  const sp = BALANCE.union.spire;
  const dmg = sp.enabled ? Math.floor(s.players[p].spire / sp.bombardPer) : 0;
  const foe = s.players[1 - p];
  const lane = foe.lanes.reduce<number | null>((best, u, i) => (u && (best === null || u.atk > foe.lanes[best]!.atk) ? i : best), null);
  if (dmg <= 0 || lane === null) return;
  emit(s, { t: 'bombard', p, lane, dmg });
  ops.strikeOpposite({ s, p, lane, unit: null }, { n: dmg });
}

export function isLocked(pl: PlayerState, def: CardDef): boolean {
  return def.level > levelCap(pl);
}

// 대지를 얻으면 전승 단계 갱신
function gainElement(pl: PlayerState, element: string) {
  pl.elements.push(element);
  pl.tech = Math.max(pl.tech, getLand(element).tier);
}

// 레인 점령: 내 유닛만 있는 레인에서 내 턴을 captureTurns번 연속 시작하면 그 대지를 가져오고, 빈자리는 보충한다
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

// 교단 타락 사슬: 가진 저주받은 땅이 매 턴 한 단계씩 타락하고, 그때마다 상대 파멸 증가
function transmute(s: GameState, p: 0 | 1) {
  const pl = s.players[p];
  pl.elements = pl.elements.map((from) => {
    const to = getLand(from).corruptsTo;
    if (!to) return from;
    emit(s, { t: 'transmute', p, from, to });
    pl.tech = Math.max(pl.tech, getLand(to).tier);
    addEntropy(s, (1 - p) as 0 | 1, BALANCE.elements.chainEntropy, 'effect');
    return to;
  });
}

// 가진 대지 하나를 꺼낸다 (없으면 예외)
function takeElement(pl: PlayerState, element: string) {
  const i = pl.elements.indexOf(element);
  if (i < 0) throw new Error(`element ${element} not owned`);
  pl.elements.splice(i, 1);
}

// 마탑 융합 주문 피해: 기본 + 빛·그림자 짝이면 상극 공명 보너스. 봉인된 땅은 쓸 수 없다
export function reactDamage(a: string, b: string): number {
  const na = getLand(a).aspect, nb = getLand(b).aspect;
  if (na === 'sealed' || nb === 'sealed') throw new Error('sealed lands cannot be fused');
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
  pl.basesPlaced = 0;
  pl.unitsPlayedThisTurn = 0;
  pl.cardsUsedLastTurn = pl.cardsUsedThisTurn;
  pl.cardsUsedThisTurn = 0;
  pl.cardsDecayedThisTurn = 0;
  pl.shuffledThisTurn = false;
  addEntropy(s, p, BALANCE.naturalEntropy, 'natural');
  if (pl.borrowed) { pl.borrowed = false; addEntropy(s, p, BALANCE.base.borrowEntropy, 'borrow'); }
  if (s.winner !== null) return;
  resourceRules[pl.faction].onTurnStart(pl);
  if (pl.turns === 1) pl.pool += BALANCE.base.borrow;
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
  if (pl.faction === 'union') bombard(s, p);
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
      // 폭주(마탑 주문 전용): 내 파멸을 올리는 대신 비용 할인
      const o = BALANCE.union.overload;
      if (action.overload && kind !== 'spell') throw new Error('only spells can overload');
      const cost = Math.max(0, costOf(s, pl, def) - (action.overload ? o.discount : 0));
      if (pl.pool < cost) throw new Error('not enough resource');
      pl.pool -= cost;
      pl.hand.splice(idx, 1);
      pl.cardsUsedThisTurn++;
      // 연쇄는 마탑 덱의 마탑 카드만 (객원으로 빌려 온 마탑 유닛은 연쇄가 죽는다)
      const chained = pl.faction === 'union' && def.faction === 'union' && pl.unitsPlayedThisTurn > 0;
      emit(s, { t: 'play', p, cardId: def.id, lane });
      if (action.overload) addEntropy(s, p, o.entropy, 'overload');
      if (kind === 'unit') {
        // 종족 공명: 이 카드 종족의 대지를 가졌으면 +N/+N
        const buff = pl.elements.some((e) => getLand(e).race === def.race) ? BALANCE.elements.groupBuff * resonance(s, def.race) : 0;
        // 기사단 결속: 점령한 대지 하나당 +N/+N
        const bind = pl.faction === 'covalent' ? Math.floor(pl.elements.length * BALANCE.covalent.bind) : 0;
        const unit: Unit = { uid: inst.uid, cardId: def.id, atk: def.atk + buff + bind, hp: def.hp + buff + bind, sick: true, attacked: false, halfLife: keywordValue(def, 'halfLife') };
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
        // 주문: 고른 레인에서 효과만 발동하고 버림 더미로
        pl.discard.push(inst);
        runTrigger(s, p, lane, def, 'onPlay', null, chained);
        raiseSpire(s, p, BALANCE.union.spire.perSpell + (action.overload ? BALANCE.union.spire.overloadBonus : 0));
      }
      break;
    }
    case 'base': {
      const idx = pl.hand.findIndex((c) => c.uid === action.uid);
      if (idx < 0 || getCard(pl.hand[idx].cardId).kind !== 'base') throw new Error('not a base card in hand');
      if (!canPlaceBase(pl)) throw new Error('cannot place more bases this turn');
      pl.discard.push(...pl.hand.splice(idx, 1));
      pl.bases++;
      pl.basesPlaced++;
      pl.cardsUsedThisTurn++;
      emit(s, { t: 'base', p, total: pl.bases });
      break;
    }
    case 'attack': {
      if (!pl.lanes[action.lane]) throw new Error('no unit in lane');
      if (!canAttack(pl.lanes[action.lane]!)) throw new Error('unit cannot attack');
      attackWith(s, p, action.lane);
      break;
    }
    case 'decay': {
      if (pl.faction !== 'decay') throw new Error('only decay faction can decay');
      if (action.from === 'hand' && getCard(pl.hand.find((c) => c.uid === action.uid)?.cardId ?? '').kind === 'base') throw new Error('bases cannot be sacrificed');
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
        if (canAttack(pl.lanes[lane]!)) throw new Error('attacking unit cannot be sacrificed');
        cardId = pl.lanes[lane]!.cardId;
        gain = decayGain.board(getCard(cardId).level);
        // 빙의: 다른 내 유닛이 제물로 바친 유닛의 효과를 물려받는다. 소환 시 효과는 그 자리에서 다시 발동
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
      raiseSpire(s, p, BALANCE.union.spire.perReact);
      break;
    }
    case 'shuffle': {
      if (pl.shuffledThisTurn || pl.hand.length === 0) throw new Error('cannot shuffle');
      const n = pl.hand.length;
      const [bag, ns] = shuffle([...pl.deck, ...pl.hand], s.rng);
      s.rng = ns;
      pl.deck = bag;
      pl.hand = [];
      pl.shuffledThisTurn = true;
      emit(s, { t: 'shuffle', p, n });
      addEntropy(s, p, BALANCE.hand.shuffleEntropy, 'shuffle');
      if (s.winner !== null) break;
      for (let i = 0; i < n; i++) drawCard(s, p);
      break;
    }
    case 'endTurn': {
      // 첫 턴에 당겨 쓴 자원이 있으면 다음 턴 시작에 파멸 (아래 공격·방치 처리보다 먼저 기록)
      if (pl.turns === 1 && pl.pool < BALANCE.base.borrow) pl.borrowed = true;
      // 공격할 수 있는 유닛은 레인 순서대로 자동 공격
      for (let lane = 0; lane < LANES && s.winner === null; lane++) {
        const u = pl.lanes[lane];
        if (u && canAttack(u)) attackWith(s, p, lane);
      }
      if (s.winner !== null) break;
      // 쓸 수 있는 카드가 있었는데 한 장도 쓰지 않았으면 파멸 페널티
      if (pl.cardsUsedThisTurn === 0 && canUseCard(s)) addEntropy(s, p, BALANCE.hand.idleEntropy, 'idle');
      if (s.winner !== null) break;
      s.active = (1 - p) as 0 | 1;
      startTurn(s);
      break;
    }
  }
  return s;
}

// 베이스는 한 턴에 내 턴 번호만큼까지 깔 수 있다 (1턴 1장, 2턴 2장 …). 판 위 최대 BALANCE.base.max개
export function canPlaceBase(pl: PlayerState): boolean {
  return pl.basesPlaced < pl.turns && pl.bases < BALANCE.base.max;
}

// 공격할 수 있는 유닛은 턴 종료 때 반드시 공격한다 (직접 공격 버튼 없음)
export function canAttack(u: Unit): boolean {
  return !u.sick && !u.attacked && u.atk > 0;
}

// 공격 대상 레인: 맞은편에 적이 있으면 그 칸, 없으면 가장 가까운 적 유닛, 적이 하나도 없으면 null(파멸 직접 공격)
function targetLane(foe: PlayerState, lane: number): number | null {
  let best: number | null = null;
  foe.lanes.forEach((t, i) => {
    if (t && (best === null || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
  });
  return best;
}

function attackWith(s: GameState, p: 0 | 1, lane: number) {
  const pl = s.players[p], foe = s.players[1 - p];
  const u = pl.lanes[lane]!;
  u.attacked = true;
  const at = targetLane(foe, lane);
  const target = at === null ? null : foe.lanes[at]!;
  if (target && at !== null) {
    // 공격자가 먼저 친다. 대상이 쓰러지면 끝, 버텨내면 반격한다
    const foeP = (1 - p) as 0 | 1;
    emit(s, { t: 'attack', p, lane, at, target: 'unit', dmg: u.atk });
    target.hp -= reducedDamage(target, u.atk, 'armor');
    if (target.hp <= 0) destroyUnit(s, foeP, at, 'combat');
    else if (target.atk > 0) {
      emit(s, { t: 'counter', p: foeP, lane: at, at: lane, dmg: target.atk });
      u.hp -= reducedDamage(u, target.atk, 'armor');
      if (u.hp <= 0) destroyUnit(s, p, lane, 'combat');
    }
    // 전투에서 살아남은 쪽은 기력 +1
    gainEnergy(s, p, lane);
    gainEnergy(s, foeP, at);
  } else {
    // 막을 유닛이 하나도 없으면 공격력만큼 상대 파멸 증가
    emit(s, { t: 'attack', p, lane, at: lane, target: 'entropy', dmg: u.atk });
    addEntropy(s, (1 - p) as 0 | 1, u.atk, 'attack');
  }
}

// 지금 손패에서 낼(또는 제물로 바칠) 수 있는 카드가 있는지
function canUseCard(s: GameState): boolean {
  return legalActions(s).some((a) => a.type === 'play' || a.type === 'base' || (a.type === 'decay' && a.from === 'hand'));
}

export function legalActions(s: GameState): Action[] {
  if (s.winner !== null) return [];
  const pl = s.players[s.active];
  const out: Action[] = [{ type: 'endTurn' }];
  if (!pl.shuffledThisTurn && pl.hand.length > 0) out.push({ type: 'shuffle' });
  const emptyLanes = pl.lanes.flatMap((u, i) => (u ? [] : [i]));
  const unitLanes = pl.lanes.flatMap((u, i) => (u ? [i] : []));
  const o = BALANCE.union.overload;
  for (const c of pl.hand) {
    const def = getCard(c.cardId);
    const kind = def.kind ?? 'unit';
    if (kind === 'base') {
      if (canPlaceBase(pl)) out.push({ type: 'base', uid: c.uid });
      continue;
    }
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
    if (pl.faction === 'decay' && !canAttack(u)) {
      out.push({ type: 'decay', from: 'board', uid: u.uid });
      for (const h of pl.lanes) if (h && h !== u) out.push({ type: 'decay', from: 'board', uid: u.uid, heir: h.uid });
    }
  });
  if (pl.faction === 'decay') for (const element of new Set(pl.elements)) out.push({ type: 'decay', from: 'element', element });
  if (pl.faction === 'union' && pl.pool >= BALANCE.elements.react.cost) {
    const reactive = pl.elements.filter((e) => getLand(e).aspect !== 'sealed');
    for (let i = 0; i < reactive.length; i++) for (let j = i + 1; j < reactive.length; j++) {
      for (let lane = 0; lane < LANES; lane++) out.push({ type: 'react', lane, a: reactive[i], b: reactive[j] });
    }
  }
  return out;
}
