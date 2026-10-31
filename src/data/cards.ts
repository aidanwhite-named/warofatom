import type { CardDef, EffectDef, Faction } from '../engine/types';

// 프로토타입용 임시 카드. 이름·수치 모두 가칭.
const u = (
  id: string, name: string, faction: Faction, race: string, element: string,
  level: number, atk: number, hp: number,
  extra: { keywords?: string[]; effects?: EffectDef[]; text?: string } = {},
): CardDef => ({ id, name, faction, race, element, level, atk, hp, ...extra });

export const CARDS: CardDef[] = [
  // ── 반응성 연맹: 싸고 많이, 연쇄 ──
  u('li_scout', '리튬 척후병', 'union', '알칼리', 'Li', 1, 1, 1),
  u('na_runner', '나트륨 돌격병', 'union', '알칼리', 'Na', 1, 2, 1),
  u('k_burst', '칼륨 폭발병', 'union', '알칼리', 'K', 2, 2, 2,
    { effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 }, chain: true }], text: '연쇄: 상대 엔트로피 +2' }),
  u('mg_guard', '마그네슘 수호병', 'union', '알칼리토', 'Mg', 2, 1, 4),
  u('ca_builder', '칼슘 축조가', 'union', '알칼리토', 'Ca', 3, 2, 4,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '연쇄: 1장 드로우' }),
  u('f_striker', '플루오린 저격수', 'union', '할로겐', 'F', 2, 3, 1,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 1 } }], text: '소환: 맞은편 적 1 피해' }),
  u('cl_soldier', '염소 병사', 'union', '할로겐', 'Cl', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'buffSelf', args: { atk: 1, hp: 1 }, chain: true }], text: '연쇄: +1/+1' }),
  u('o_igniter', '산소 점화사', 'union', '칼코겐', 'O', 3, 2, 3,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 }, chain: true }], text: '연쇄: 맞은편 적 2 피해' }),
  u('s_brute', '황 투사', 'union', '칼코겐', 'S', 4, 4, 4),
  u('br_reactor', '브로민 반응로', 'union', '할로겐', 'Br', 5, 4, 5,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 3 } }], text: '소환: 맞은편 적 3 피해' }),
  u('cs_detonator', '세슘 기폭자', 'union', '알칼리', 'Cs', 6, 6, 5,
    { effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '소환: 상대 엔트로피 +2' }),
  u('ba_titan', '바륨 거인', 'union', '알칼리토', 'Ba', 7, 7, 7),

  // ── 결속의 방벽: 격자(별도 더미) 쌓고 후반 폭발 ──
  u('si_wall', '규소 방벽', 'covalent', '준금속', 'Si', 1, 0, 5),
  u('b_sentinel', '붕소 파수꾼', 'covalent', '준금속', 'B', 2, 2, 3),
  u('n_lancer', '질소 창병', 'covalent', '질소족', 'N', 2, 3, 2),
  u('ge_turret', '게르마늄 포대', 'covalent', '준금속', 'Ge', 3, 2, 5),
  u('as_toxin', '비소 독술사', 'covalent', '질소족', 'As', 4, 3, 4,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('p_burner', '인 방화수', 'covalent', '질소족', 'P', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('cu_conductor', '구리 전도사', 'covalent', '전이금속', 'Cu', 4, 3, 4,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '소환: 1장 드로우' }),
  u('fe_knight', '철 기사', 'covalent', '전이금속', 'Fe', 4, 4, 6),
  u('c_diamond', '다이아몬드 골렘', 'covalent', '탄소족', 'C', 5, 3, 9),
  u('ti_colossus', '타이타늄 거상', 'covalent', '전이금속', 'Ti', 6, 6, 8),
  u('w_juggernaut', '텅스텐 파괴자', 'covalent', '전이금속', 'W', 7, 7, 9),
  u('graphene', '그래핀 거신', 'covalent', '탄소족', 'C', 8, 8, 10,
    { effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 3 } }], text: '소환: 상대 엔트로피 +3' }),

  // ── 붕괴의 교단: 붕괴로 기습 소환, 반감기 ──
  u('ne_wisp', '네온 도깨비불', 'decay', '비활성기체', 'Ne', 1, 1, 2),
  u('ce_acolyte', '세륨 수련사제', 'decay', '란타넘족', 'Ce', 1, 2, 1),
  u('eu_seer', '유로퓸 예언자', 'decay', '란타넘족', 'Eu', 2, 1, 2,
    { effects: [{ trigger: 'onDeath', op: 'draw', args: { n: 1 } }], text: '파괴 시: 1장 드로우' }),
  u('ar_veil', '아르곤 장막', 'decay', '비활성기체', 'Ar', 2, 2, 3),
  u('nd_magnet', '네오디뮴 자력사', 'decay', '란타넘족', 'Nd', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '소환: 1장 드로우' }),
  u('rn_mist', '라돈 독무', 'decay', '비활성기체', 'Rn', 3, 2, 4,
    { effects: [{ trigger: 'onDeath', op: 'entropy', args: { n: 2 } }], text: '파괴 시: 상대 엔트로피 +2' }),
  u('th_herald', '토륨 전령', 'decay', '악티늄족', 'Th', 4, 5, 4, { keywords: ['halfLife:3'], text: '반감기 3' }),
  u('fl_flicker', '플레로븀 섬광', 'decay', '초중원소', 'Fl', 5, 6, 5, { keywords: ['halfLife:2'], text: '반감기 2' }),
  u('u_core', '우라늄 노심', 'decay', '악티늄족', 'U', 6, 7, 6,
    { keywords: ['halfLife:3'], effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '반감기 3. 소환: 상대 엔트로피 +2' }),
  u('pu_reaper', '플루토늄 사신', 'decay', '악티늄족', 'Pu', 7, 8, 7,
    { keywords: ['halfLife:2'], effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 4 } }], text: '반감기 2. 소환: 맞은편 적 4 피해' }),
  u('og_titan', '오가네손 거신', 'decay', '초중원소', 'Og', 9, 11, 10, { keywords: ['halfLife:2'], text: '반감기 2' }),
];

const byId = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id: string): CardDef {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}
