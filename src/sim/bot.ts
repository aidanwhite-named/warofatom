import { getCard } from '../data/cards';
import { BALANCE } from '../engine/config';
import { getLand } from '../data/lands';
import { applyAction, costOf, isLocked, reactDamage, reducedDamage } from '../engine/game';
import { resourceRules } from '../engine/resources';
import type { Action, GameState, PlayerState } from '../engine/types';

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

// 단순 탐욕 봇: 진영 자원 규칙을 '대충 합리적으로' 쓰는 수준. 밸런스 경향 확인용.
export function chooseAction(s: GameState): Action {
  const p = s.active;
  const me = s.players[p];
  const foe = s.players[1 - p];
  // locked: 전승 테크트리로 아직 낼 수 없는 카드
  const hand = me.hand.map((c) => { const def = getCard(c.cardId); return { c, def, cost: costOf(s, me, def), locked: isLocked(me, def) }; });
  const emptyLanes = me.lanes.flatMap((u, i) => (u ? [] : [i]));

  // 1. 성소 배치
  if (me.faction === 'covalent' && !me.latticePlayed && me.latticePile > 0) return { type: 'lattice' };

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
      const fuel = hand.filter((h) => h !== target && (h.def.level <= 3 || h.locked)).sort((a, b) => a.def.level - b.def.level);
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

  // 4. 공격: 빈 레인이면 상대 파멸, 유닛이면 먼저 쳐서 잡거나(반격 없음) 반격을 버틸 때만
  for (let lane = 0; lane < me.lanes.length; lane++) {
    const u = me.lanes[lane];
    if (!u || u.sick || u.attacked || u.atk <= 0) continue;
    const t = foe.lanes[lane];
    if (!t || t.hp <= reducedDamage(t, u.atk, 'armor') || u.hp > reducedDamage(u, t.atk, 'armor')) return { type: 'attack', lane };
  }

  // 5. 검은 달 교단: 다음 턴 시작에 소멸로 사라질 유닛은 공격을 마친 뒤 유닛 제물 (영혼로 3단계를 다시 돈다)
  //    효과가 있는 유닛이면 가장 오래 남을 내 유닛(소멸 없음 우선, 체력 높은 순)에게 빙의
  if (me.faction === 'decay') {
    const expiring = me.lanes.find((u) => u?.halfLife === 1);
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
