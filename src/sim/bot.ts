import { getCard } from '../data/cards';
import { applyAction } from '../engine/game';
import type { Action, GameState } from '../engine/types';

// 단순 탐욕 봇: 진영 자원 규칙을 '대충 합리적으로' 쓰는 수준. 밸런스 경향 확인용.
export function chooseAction(s: GameState): Action {
  const p = s.active;
  const me = s.players[p];
  const foe = s.players[1 - p];
  const hand = me.hand.map((c) => ({ c, def: getCard(c.cardId) }));
  const emptyLanes = me.lanes.flatMap((u, i) => (u ? [] : [i]));

  // 1. 격자 배치
  if (me.faction === 'covalent' && !me.latticePlayed && me.latticePile > 0) return { type: 'lattice' };

  // 2. 붕괴의 교단: 고레벨 카드를 내기 위해 저레벨(≤3) 손패 붕괴. 손패 2장은 남긴다.
  if (me.faction === 'decay' && emptyLanes.length) {
    const units = [...hand].sort((a, b) => b.def.level - a.def.level);
    const target = units[0];
    if (target && target.def.level >= 4 && target.def.level > me.pool) {
      const fuel = units.slice(1).filter((h) => h.def.level <= 3).sort((a, b) => a.def.level - b.def.level);
      let total = me.pool, used = 0;
      for (const h of fuel) { if (total >= target.def.level) break; total += h.def.level + 1; used++; }
      if (total >= target.def.level && hand.length - 1 - used >= 2) return { type: 'decay', from: 'hand', uid: fuel[0].c.uid };
    }
  }

  // 3. 낼 수 있는 가장 높은 레벨 유닛 소환 (가장 위협적인 적 맞은편에)
  if (emptyLanes.length) {
    const best = hand
      .filter((h) => h.def.level <= me.pool)
      .sort((a, b) => b.def.level - a.def.level)[0];
    if (best) {
      const lane = emptyLanes.sort((a, b) => (foe.lanes[b]?.atk ?? -1) - (foe.lanes[a]?.atk ?? -1))[0];
      return { type: 'play', uid: best.c.uid, lane };
    }
  }

  // 4. 공격: 빈 레인이면 상대 엔트로피, 유닛이면 손해 안 보는 교환만
  for (let lane = 0; lane < me.lanes.length; lane++) {
    const u = me.lanes[lane];
    if (!u || u.sick || u.attacked || u.atk <= 0) continue;
    const t = foe.lanes[lane];
    if (!t || t.hp <= u.atk || u.hp > t.atk) return { type: 'attack', lane };
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
