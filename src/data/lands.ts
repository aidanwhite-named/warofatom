// 전장 가운데 놓이는 대지 풀. race는 카드 종족과 같은 이름을 쓴다 (공명 판정).
// 종족 12개 × 2곳 = 24곳이라 진영마다 공명 가능한 대지가 8곳씩 같다.
//   aspect: 마탑 융합 주문에 쓰인다 (빛 + 그림자 = 상극 공명, 봉인된 땅은 쓸 수 없다)
//   tier: 대지 등급 (전승 단계: 높은 등급 대지를 얻을수록 고레벨 카드가 열린다)
//   corruptsTo: 저주받은 땅의 타락 사슬 (교단이 가졌을 때만 매 턴 진행)
//   corrupted: 타락으로만 생기는 땅 (대지 풀에는 없음)
export type LandDef = {
  key: string; name: string; race: string;
  tier: number;
  aspect: 'light' | 'shadow' | 'sealed';
  corruptsTo?: string; corrupted?: boolean;
};

export const ASPECT_LABEL: Record<LandDef['aspect'], string> = { light: '빛', shadow: '그림자', sealed: '봉인' };

export const LANDS: LandDef[] = [
  { key: 'ember_hill', name: '잿불 언덕', race: '화염술사', tier: 2, aspect: 'light' },
  { key: 'salt_flame', name: '소금불 해안', race: '화염술사', tier: 3, aspect: 'light' },
  { key: 'iron_gorge', name: '철벽 협곡', race: '용병', tier: 3, aspect: 'light' },
  { key: 'white_quarry', name: '백석 채석장', race: '용병', tier: 4, aspect: 'light' },
  { key: 'thunder_spire', name: '벼락 첨탑', race: '폭풍술사', tier: 2, aspect: 'shadow' },
  { key: 'storm_cliff', name: '폭풍 절벽', race: '폭풍술사', tier: 3, aspect: 'shadow' },
  { key: 'smoke_vale', name: '연기 골짜기', race: '연금술사', tier: 2, aspect: 'shadow' },
  { key: 'sulfur_spring', name: '유황 샘', race: '연금술사', tier: 3, aspect: 'shadow' },
  { key: 'obsidian_pit', name: '흑요석 광산', race: '골렘', tier: 2, aspect: 'shadow' },
  { key: 'giant_forge', name: '거인의 대장간', race: '골렘', tier: 5, aspect: 'light' },
  { key: 'mist_wood', name: '안개 숲', race: '숲지기', tier: 2, aspect: 'shadow' },
  { key: 'firefly_marsh', name: '반딧불 습지', race: '숲지기', tier: 3, aspect: 'shadow' },
  { key: 'steel_bastion', name: '강철 성채', race: '성기사', tier: 4, aspect: 'light' },
  { key: 'bronze_gate', name: '청동 관문', race: '성기사', tier: 4, aspect: 'light' },
  { key: 'crystal_abbey', name: '수정 수도원', race: '수도사', tier: 3, aspect: 'shadow' },
  { key: 'silent_hermitage', name: '고요한 암자', race: '수도사', tier: 2, aspect: 'shadow' },
  { key: 'star_observatory', name: '별점 천문대', race: '점술사', tier: 6, aspect: 'light' },
  { key: 'oracle_well', name: '예언의 우물', race: '점술사', tier: 6, aspect: 'light' },
  { key: 'cursed_tomb', name: '저주받은 왕릉', race: '광신도', tier: 7, aspect: 'light', corruptsTo: 'withered_graves' },
  { key: 'withered_graves', name: '시든 묘역', race: '광신도', tier: 7, aspect: 'light', corruptsTo: 'blight_mine' },
  { key: 'abyss_rift', name: '심연의 균열', race: '심연체', tier: 7, aspect: 'light', corruptsTo: 'broken_star' },
  { key: 'void_gate', name: '공허의 문', race: '심연체', tier: 7, aspect: 'sealed', corruptsTo: 'twisted_altar' },
  { key: 'ghost_beacon', name: '유령 등대', race: '망령', tier: 2, aspect: 'sealed' },
  { key: 'silent_cemetery', name: '침묵의 묘지', race: '망령', tier: 3, aspect: 'sealed' },
  // 타락 사슬: 저주받은 왕릉 → 시든 묘역 → 독광 갱도 → 통곡의 늪 → 잿더미 폐허
  //           공허의 문 → 뒤틀린 제단 → 심연의 균열 → 부서진 성좌 → 잿더미 폐허
  { key: 'blight_mine', name: '독광 갱도', race: '용병', tier: 7, aspect: 'light', corruptsTo: 'wailing_bog', corrupted: true },
  { key: 'wailing_bog', name: '통곡의 늪', race: '망령', tier: 6, aspect: 'sealed', corruptsTo: 'ash_ruins', corrupted: true },
  { key: 'twisted_altar', name: '뒤틀린 제단', race: '심연체', tier: 7, aspect: 'light', corruptsTo: 'abyss_rift', corrupted: true },
  { key: 'broken_star', name: '부서진 성좌', race: '심연체', tier: 7, aspect: 'light', corruptsTo: 'ash_ruins', corrupted: true },
  { key: 'ash_ruins', name: '잿더미 폐허', race: '골렘', tier: 6, aspect: 'light', corrupted: true },
];

export const LAND_POOL = LANDS.filter((l) => !l.corrupted).map((l) => l.key);

const byKey = new Map(LANDS.map((l) => [l.key, l]));

export function getLand(key: string): LandDef {
  const l = byKey.get(key);
  if (!l) throw new Error(`unknown land ${key}`);
  return l;
}
