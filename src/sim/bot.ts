import { getCard } from '../data/cards';
import { BALANCE } from '../engine/config';
import { getLand } from '../data/lands';
import { applyAction, canAttack, canPlaceBase, costOf, isLocked, reactDamage, reducedDamage } from '../engine/game';
import { resourceRules } from '../engine/resources';
import type { Action, CardDef, GameState, PlayerState } from '../engine/types';
import { WEIGHTS } from '../balance/weights';

// 유지비 유닛을 내도 다음 턴 시작에 판 위 유지비를 모두 낼 수 있는지 (못 내면 그 유닛이 파괴된다)
function canKeep(me: PlayerState, upkeep: number, cost: number): boolean {
  if (!upkeep) return true;
  const next = structuredClone(me);
  next.pool -= cost;
  next.turns++;
  resourceRules[me.faction].onTurnStart(next);
  const total = me.lanes.reduce((a, u) => a + (u ? getCard(u.cardId).upkeep ?? 0 : 0), upkeep);
  return next.pool >= total;
}

// 빙의로 얻는 가치 (카드 점수표 가중치 기준): 상속자 레인에서 다시 터지는 소환 시 효과 + 상속자가 물려받는 파괴 시 효과
//   맞은편 피해는 상속자 맞은편에 적이 있을 때만, 드로우는 손패에 자리가 있을 때만 센다. 연쇄 효과는 빙의로 발동하지 않는다
function inheritValue(me: PlayerState, foe: PlayerState, def: CardDef, heirLane: number): number {
  let v = 0;
  for (const e of def.effects ?? []) {
    if (e.chain) continue;
    const n = e.args?.n ?? 0;
    if (e.trigger === 'onDeath') v += n * (WEIGHTS.op[e.op] ?? 0) * WEIGHTS.onDeathFactor;
    if (e.trigger !== 'onPlay') continue;
    if (e.op === 'strikeOpposite') {
      const t = foe.lanes[heirLane];
      if (t) v += Math.min(reducedDamage(t, n, 'resist'), t.hp) * WEIGHTS.op.strikeOpposite;
    } else if (e.op === 'draw') v += Math.min(n, BALANCE.hand.max - me.hand.length) * WEIGHTS.op.draw;
    else if (e.op === 'buffSelf') v += (e.args?.atk ?? 0) + (e.args?.hp ?? 0);
    else v += n * (WEIGHTS.op[e.op] ?? 0);
  }
  return v;
}

// 단순 탐욕 봇: 진영 자원 규칙을 '대충 합리적으로' 쓰는 수준. 밸런스 경향 확인용.
export function chooseAction(s: GameState): Action {
  const p = s.active;
  const me = s.players[p];
  const foe = s.players[1 - p];
  // locked: 전승 테크트리로 아직 낼 수 없는 카드
  const hand = me.hand.map((c) => { const def = getCard(c.cardId); return { c, def, cost: costOf(s, me, def), locked: isLocked(me, def) }; });
  const emptyLanes = me.lanes.flatMap((u, i) => (u ? [] : [i]));

  // 1. 베이스 배치
  const baseCard = hand.find((h) => h.def.kind === 'base');
  if (baseCard && canPlaceBase(me)) return { type: 'base', uid: baseCard.c.uid };

  // 2. 검은 달 교단: 고레벨 카드를 내기 위해 저레벨(≤3)이나 잠긴 손패 제물. 손패 2장은 남긴다.
  if (me.faction === 'decay' && emptyLanes.length) {
    const units = hand.filter((h) => !h.locked).sort((a, b) => b.def.level - a.def.level);
    const target = units[0];
    // 2-0. 대지 제물 하나로 닿으면 그걸 먼저 쓴다. 저주받은 땅은 타락 사슬로 파멸을 주니 평범한 땅부터
    const stable = me.elements.find((e) => !getLand(e).corruptsTo);
    if (target && stable && target.cost > me.pool && target.cost <= me.pool + BALANCE.elements.burnGain) {
      return { type: 'decay', from: 'element', element: stable };
    }
    if (target && target.def.level >= 4 && target.cost > me.pool) {
      const fuel = hand.filter((h) => h !== target && h.def.kind !== 'base' && (h.def.level <= 3 || h.locked)).sort((a, b) => a.def.level - b.def.level);
      let total = me.pool, used = 0;
      for (const h of fuel) { if (total >= target.cost) break; total += h.def.level + 1; used++; }
      if (total >= target.cost && hand.length - 1 - used >= 2) return { type: 'decay', from: 'hand', uid: fuel[0].c.uid };
    }
  }

  // 3. 낼 수 있는 가장 높은 레벨 유닛 소환 (가장 위협적인 적 맞은편에, 막을 적이 없으면 대지가 놓인 레인에)
  if (emptyLanes.length) {
    const best = hand
      .filter((h) => (h.def.kind ?? 'unit') === 'unit' && !h.locked && h.cost <= me.pool && canKeep(me, h.def.upkeep ?? 0, h.cost))
      .sort((a, b) => b.def.level - a.def.level)[0];
    if (best) {
      // 막을 적이 없으면 대지 레인 > 빈 레인. 대지 중에서는 지맥 종족, 전승 단계를 올려 주는 높은 등급 대지를 우선
      const tileValue = (l: number) => {
        if (!s.tiles[l]) return -1;
        const e = getLand(s.tiles[l]!);
        return -0.5 + (e.race === s.leyline ? 0.1 : 0) + (e.tier > me.tech ? 0.05 : 0);
      };
      const threat = (l: number) => foe.lanes[l]?.atk ?? tileValue(l);
      const lane = emptyLanes.sort((a, b) => threat(b) - threat(a))[0];
      return { type: 'play', uid: best.c.uid, lane };
    }
  }

  // 3-1. 은빛 서약 기사단: 남은 신앙으로 장비을 가장 강한 내 유닛에 장착
  const myLanes = me.lanes.flatMap((u, i) => (u ? [i] : []));
  const item = hand.filter((h) => h.def.kind === 'item' && !h.locked && h.cost <= me.pool).sort((a, b) => b.def.level - a.def.level)[0];
  if (item && myLanes.length) {
    const lane = myLanes.sort((a, b) => me.lanes[b]!.atk + me.lanes[b]!.hp - (me.lanes[a]!.atk + me.lanes[a]!.hp))[0];
    return { type: 'play', uid: item.c.uid, lane };
  }

  // 3-2. 잿불 마탑: 주문. 맞은편 피해는 적 유닛이 있는 레인(공격력 높은 순)에만, 금화가 모자라면 파멸 여유가 있을 때 폭주
  const o = BALANCE.union.overload;
  for (const h of hand.filter((x) => x.def.kind === 'spell' && !x.locked).sort((a, b) => b.def.level - a.def.level)) {
    const overload = h.cost > me.pool;
    if (overload && (h.cost - o.discount > me.pool || me.entropy + o.entropy > BALANCE.maxEntropy - 8)) continue;
    const strikes = h.def.effects?.some((e) => e.op === 'strikeOpposite');
    const foeLanes = foe.lanes.flatMap((u, i) => (u ? [i] : [])).sort((a, b) => foe.lanes[b]!.atk - foe.lanes[a]!.atk);
    if (strikes && !foeLanes.length) continue;
    return { type: 'play', uid: h.c.uid, lane: foeLanes[0] ?? 0, overload: overload || undefined };
  }

  // 3-3. 잿불 마탑: 융합 주문. 대지를 쓰면 공명을 잃으므로 적 유닛을 잡을 수 있거나 대지가 3개 이상일 때만
  if (me.faction === 'union' && me.pool >= BALANCE.elements.react.cost) {
    const reactive = me.elements.filter((e) => getLand(e).aspect !== 'sealed');
    const pairs = reactive.flatMap((a, i) => reactive.slice(i + 1).map((b) => ({ a, b, dmg: reactDamage(a, b) })));
    const pair = pairs.sort((x, y) => y.dmg - x.dmg)[0];
    if (pair) {
      const foeLanes = foe.lanes.flatMap((u, i) => (u ? [i] : [])).sort((a, b) => foe.lanes[b]!.atk - foe.lanes[a]!.atk);
      const kill = foeLanes.find((l) => foe.lanes[l]!.hp <= pair.dmg);
      if (kill !== undefined || me.elements.length >= 3) return { type: 'react', lane: kill ?? foeLanes[0] ?? 0, a: pair.a, b: pair.b };
    }
  }

  // 4. 검은 달 교단: 빙의. 공격할 수 없는(방금 소환한) 효과 유닛을 바쳐 다른 내 유닛에서 소환 시 효과를 다시 발동하고 레벨만큼 영혼을 돌려받는다
  //    효과 가치가 2 이상이고, 돌려받은 영혼으로 손패 유닛을 더 낼 수 있거나 효과 가치가 몸체(공격+체력)보다 클 때만
  if (me.faction === 'decay') {
    let pick: { uid: number; heir: number; value: number } | null = null;
    for (const u of me.lanes) {
      if (!u || canAttack(u)) continue;
      const def = getCard(u.cardId);
      const gain = def.level + BALANCE.decay.decayBoardBonus;
      const spendable = hand.some((h) => (h.def.kind ?? 'unit') === 'unit' && !h.locked && h.cost <= me.pool + gain && canKeep(me, h.def.upkeep ?? 0, h.cost));
      for (let hl = 0; hl < me.lanes.length; hl++) {
        const heir = me.lanes[hl];
        if (!heir || heir === u) continue;
        // 오래 남을 유닛일수록 물려받은 파괴 시 효과를 늦게까지 들고 있다 (소멸 유닛은 조금 깎는다)
        const value = inheritValue(me, foe, def, hl) - (heir.halfLife !== undefined ? 0.5 : 0);
        if (value >= 2 && (spendable || value >= u.atk + u.hp) && (!pick || value > pick.value)) pick = { uid: u.uid, heir: heir.uid, value };
      }
    }
    if (pick) return { type: 'decay', from: 'board', uid: pick.uid, heir: pick.heir };
  }

  // 5. 검은 달 교단: 다음 턴 시작에 소멸로 사라질 유닛은 공격하지 못하는 유닛(방금 소환 등)이면 유닛 제물 (영혼로 3단계를 다시 돈다)
  //    효과가 있는 유닛이면 가장 오래 남을 내 유닛(소멸 없음 우선, 체력 높은 순)에게 빙의
  if (me.faction === 'decay') {
    const expiring = me.lanes.find((u) => u?.halfLife === 1 && !canAttack(u));
    if (expiring) {
      const heir = getCard(expiring.cardId).effects?.length
        ? me.lanes
            .filter((u) => u && u !== expiring)
            .sort((a, b) => (a!.halfLife ?? 99) - (b!.halfLife ?? 99) || a!.hp - b!.hp)
            .at(-1)
        : undefined;
      return { type: 'decay', from: 'board', uid: expiring.uid, heir: heir?.uid };
    }
  }

  return { type: 'endTurn' };
}

export function playGame(s: GameState, maxSteps = 5000) {
  let st = s;
  // 턴별로 낸 최고 레벨 기록 (진영 템포 곡선)
  const curve: [number[], number[]] = [[], []];
  for (let i = 0; i < maxSteps && st.winner === null; i++) {
    const a = chooseAction(st);
    if (a.type === 'play') {
      const pl = st.players[st.active];
      const def = getCard(pl.hand.find((c) => c.uid === a.uid)!.cardId);
      const k = pl.turns - 1;
      curve[st.active][k] = Math.max(curve[st.active][k] ?? 0, def.level);
    }
    st = applyAction(st, a);
  }
  return { state: st, curve };
}
