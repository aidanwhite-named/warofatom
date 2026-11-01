import type { Faction } from '../engine/types';

// 코드 키(union/covalent/decay)는 내부 이름. 화면에 나오는 이름·설정은 여기서만 정한다
export const FACTIONS: Record<Faction, { name: string; short: string; en: string; resource: string; motto: string }> = {
  union: { name: '잿불 마탑', short: '마탑', en: 'Ember Spire', resource: '금화', motto: '불꽃과 폭풍을 다루는 전투마법사·용병 결사' },
  covalent: { name: '은빛 서약 기사단', short: '기사단', en: 'Order of the Silver Oath', resource: '신앙', motto: '성소를 쌓아 땅을 지키는 성기사·수도사·골렘' },
  decay: { name: '검은 달 교단', short: '교단', en: 'Cult of the Black Moon', resource: '영혼', motto: '제물과 저주로 힘을 얻는 점술사·광신도·망령' },
};

// 세력별 종족 (카드·대지 종족과 같은 이름)
export const FACTION_RACES: Record<Faction, string[]> = {
  union: ['화염술사', '용병', '폭풍술사', '연금술사'],
  covalent: ['골렘', '숲지기', '성기사', '수도사'],
  decay: ['점술사', '광신도', '심연체', '망령'],
};
