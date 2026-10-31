import type { GameState, Unit } from './types';
import { addEntropy, destroyUnit, drawCard } from './game';

export type EffectCtx = { s: GameState; p: 0 | 1; lane: number; unit: Unit | null };
type Op = (ctx: EffectCtx, args: Record<string, number>) => void;

// 효과 op 테이블. 카드 데이터의 effects[].op 가 여기 키를 가리킨다.
export const ops: Record<string, Op> = {
  // 상대 엔트로피 증가
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
    foe.hp -= n;
    if (foe.hp <= 0) destroyUnit(s, (1 - p) as 0 | 1, lane, 'effect');
  },
  gainPool({ s, p }, { n }) {
    s.players[p].pool += n;
  },
};
