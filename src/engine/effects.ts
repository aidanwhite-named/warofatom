import type { GameState, Unit } from './types';
import { addEntropy, destroyUnit, drawCard, maxHp, reducedDamage } from './game';

export type EffectCtx = { s: GameState; p: 0 | 1; lane: number; unit: Unit | null };
type Op = (ctx: EffectCtx, args: Record<string, number>) => void;

// 효과 op 테이블. 카드 데이터의 effects[].op 가 여기 키를 가리킨다.
export const ops: Record<string, Op> = {
  // 상대 파멸 증가
  entropy({ s, p }, { n }) {
    addEntropy(s, (1 - p) as 0 | 1, n, 'effect');
  },
  draw({ s, p }, { n }) {
    for (let i = 0; i < n; i++) drawCard(s, p);
  },
  buffSelf({ unit }, { atk = 0, hp = 0 }) {
    if (!unit) return;
    unit.atk += atk;
    unit.hp += hp;
  },
  // 같은 레인 맞은편 적 유닛에게 피해
  strikeOpposite({ s, p, lane }, { n }) {
    const foe = s.players[1 - p].lanes[lane];
    if (!foe) return;
    const dmg = reducedDamage(foe, n, 'resist');
    foe.hp -= dmg;
    s.log.push({ t: 'damage', p: (1 - p) as 0 | 1, lane, dmg, hp: foe.hp });
    if (foe.hp <= 0) destroyUnit(s, (1 - p) as 0 | 1, lane, 'effect');
  },
  // 자신 체력 회복. 상한은 카드 체력 + 장착 장비 체력 (강화로 이미 넘었으면 그대로)
  healSelf({ unit }, { n }) {
    if (!unit) return;
    const cap = maxHp(unit);
    if (unit.hp < cap) unit.hp = Math.min(cap, unit.hp + n);
  },
  gainPool({ s, p }, { n }) {
    s.players[p].pool += n;
  },
};
