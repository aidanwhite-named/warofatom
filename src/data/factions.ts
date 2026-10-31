import type { Faction } from '../engine/types';

export const FACTIONS: Record<Faction, { name: string; en: string; resource: string }> = {
  union: { name: '반응성 연맹', en: 'Reactive Union', resource: '금화' },
  covalent: { name: '결속의 방벽', en: 'Covalent Matrix', resource: '결합력' },
  decay: { name: '붕괴의 교단', en: 'Cult of Decay', resource: '붕괴열' },
};
