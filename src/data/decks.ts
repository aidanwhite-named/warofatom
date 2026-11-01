import type { DeckSpec } from '../engine/game';
import type { Faction } from '../engine/types';

const x = (n: number, id: string) => Array<string>(n).fill(id);

// 고정 프리셋 덱 (각 24장). 방벽의 격자는 덱이 아닌 별도 더미(config.ts).
export const DECKS: Record<Faction, DeckSpec> = {
  union: {
    faction: 'union',
    cards: [
      ...x(1, 'li_scout'), ...x(1, 'be_shield'), ...x(2, 'na_runner'), ...x(2, 'k_burst'), ...x(1, 'mg_guard'),
      ...x(2, 'ca_builder'), ...x(2, 'f_striker'), ...x(2, 'cl_soldier'), ...x(2, 'o_igniter'),
      ...x(2, 's_brute'), ...x(2, 'br_reactor'), ...x(1, 'cs_detonator'), ...x(1, 'ba_titan'),
      ...x(1, 'rx_combust'), ...x(1, 'rx_neutral'), ...x(1, 'rx_thermite'),
    ],
  },
  covalent: {
    faction: 'covalent',
    cards: [
      ...x(2, 'si_wall'), ...x(2, 'sn_soldier'), ...x(2, 'n_lancer'), ...x(2, 'ni_golem'),
      ...x(1, 'ge_turret'), ...x(2, 'cu_conductor'), ...x(2, 'fe_knight'), ...x(2, 'as_toxin'),
      ...x(2, 'c_diamond'), ...x(2, 'ti_colossus'), ...x(1, 'w_juggernaut'), ...x(1, 'graphene'),
      ...x(1, 'ti_shell'), ...x(1, 'bn_blade'), ...x(1, 'wc_plating'),
    ],
  },
  decay: {
    faction: 'decay',
    cards: [
      ...x(3, 'ne_wisp'), ...x(3, 'ce_acolyte'), ...x(2, 'eu_seer'), ...x(2, 'kr_lamp'),
      ...x(2, 'nd_magnet'), ...x(2, 'rn_mist'), ...x(3, 'th_herald'), ...x(2, 'fl_flicker'),
      ...x(2, 'u_core'), ...x(2, 'pu_reaper'), ...x(1, 'og_titan'),
    ],
  },
};
