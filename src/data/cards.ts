import type { CardDef, CardKind, EffectDef, Faction } from '../engine/types';

// 프로토타입용 임시 카드. 이름·수치 모두 가칭.
// land: 연고 대지 (그 대지를 가지면 비용 공명). null이면 연고 대지 없음
// upkeep: 유지비 = 레벨 중 빈 아이콘 수 (내 턴마다 지불). 빈 아이콘이 많을수록 다른 세력 덱에 객원으로 넣기 쉽다
const u = (
  id: string, name: string, faction: Faction, race: string, land: string | null,
  level: number, atk: number, hp: number,
  extra: { kind?: CardKind; upkeep?: number; keywords?: string[]; effects?: EffectDef[]; text?: string } = {},
): CardDef => ({ id, name, faction, race, ...(land ? { land } : {}), level, atk, hp, ...extra });

export const CARDS: CardDef[] = [
  // ── 잿불 마탑: 싸고 많이, 연쇄 ──
  u('ember_scout', '불씨 척후병', 'union', '화염술사', 'ember_hill', 1, 1, 1),
  u('flame_runner', '화염 돌격병', 'union', '화염술사', 'salt_flame', 1, 2, 1),
  u('blast_adept', '폭염 수련생', 'union', '화염술사', null, 2, 2, 2,
    { effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 }, chain: true }], text: '연쇄: 상대 파멸 +2' }),
  u('gorge_guard', '협곡 경비병', 'union', '용병', 'iron_gorge', 2, 1, 4),
  u('quarry_mason', '채석장 석공', 'union', '용병', 'white_quarry', 3, 2, 4,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '연쇄: 1장 드로우' }),
  u('spark_archer', '번개 사수', 'union', '폭풍술사', 'thunder_spire', 2, 3, 1,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 1 } }], text: '소환: 맞은편 적 1 피해' }),
  u('gale_blade', '돌풍 검사', 'union', '폭풍술사', 'storm_cliff', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'buffSelf', args: { atk: 1, hp: 1 }, chain: true }], text: '연쇄: +1/+1' }),
  u('smoke_igniter', '연기 점화사', 'union', '연금술사', 'smoke_vale', 3, 2, 3,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 }, chain: true }], text: '연쇄: 맞은편 적 2 피해' }),
  u('sulfur_brute', '유황 투사', 'union', '연금술사', 'sulfur_spring', 4, 4, 4),
  u('storm_caller', '폭풍 소환사', 'union', '폭풍술사', null, 5, 4, 5,
    { upkeep: 1, effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 3 } }], text: '소환: 맞은편 적 3 피해' }),
  u('inferno_master', '업화의 대가', 'union', '화염술사', null, 6, 6, 5,
    { effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '소환: 상대 파멸 +2' }),
  u('giant_captain', '거인 용병대장', 'union', '용병', null, 7, 10, 10, { upkeep: 3 }),
  // 주문 (마탑 전용): 고른 레인에 효과만 발동. 폭주로 파멸을 내고 할인 가능
  u('sp_fireball', '화염구', 'union', '연금술사', 'smoke_vale', 2, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '주문: 대상 레인의 적 2 피해' }),
  u('sp_omen', '폭풍의 전조', 'union', '폭풍술사', 'storm_cliff', 3, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }, { trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '주문: 상대 파멸 +2. 연쇄: 1장 드로우' }),
  u('sp_siege', '공성 폭약', 'union', '용병', 'iron_gorge', 4, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 5 } }, { trigger: 'onPlay', op: 'entropy', args: { n: 2 }, chain: true }], text: '주문: 대상 레인의 적 5 피해. 연쇄: 상대 파멸 +2' }),
  // 기본 카드 풀 (덱 구성용 추가 카드)
  u('ash_raider', '잿불 습격자', 'union', '화염술사', null, 2, 3, 2),
  u('flash_burner', '섬광 분신자', 'union', '화염술사', null, 2, 4, 2, { keywords: ['halfLife:2'], text: '소멸 2' }),
  u('shield_merc', '방패 용병', 'union', '용병', null, 2, 1, 2, { keywords: ['armor:1'], text: '방어력 1' }),
  u('flare_merc', '신호탄 사수', 'union', '용병', null, 3, 3, 4,
    { upkeep: 1, effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 }, chain: true }], text: '연쇄: 상대 파멸 +2' }),
  u('blight_miner', '독광 광부', 'union', '용병', 'blight_mine', 5, 6, 5,
    { upkeep: 2, effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '소환: 상대 파멸 +2' }),
  u('cloud_sage', '구름 현자', 'union', '폭풍술사', null, 3, 2, 3,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '연쇄: 1장 드로우' }),
  u('bolt_sniper', '뇌전 저격수', 'union', '폭풍술사', null, 4, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('alembic_keeper', '증류기 관리인', 'union', '연금술사', null, 3, 2, 3,
    { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'entropy', args: { n: 1 } }], text: '기력 2. 충전 시: 상대 파멸 +1' }),
  u('powder_thrower', '화약 투척병', 'union', '연금술사', null, 4, 3, 3,
    { effects: [{ trigger: 'onDeath', op: 'entropy', args: { n: 3 } }], text: '파괴 시: 상대 파멸 +3' }),
  u('poison_brewer', '독약 제조사', 'union', '연금술사', null, 5, 5, 4,
    { keywords: ['halfLife:3'], effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '소멸 3. 소환: 상대 파멸 +2' }),
  // 방어 위주: 공격력은 낮고 체력·방어력이 높아 공격을 받아내고 반격한다
  u('gorge_shieldwall', '협곡 방패벽', 'union', '용병', 'iron_gorge', 3, 1, 4, { keywords: ['armor:1'], text: '방어력 1' }),
  u('alch_bulwark', '연금 방벽술사', 'union', '연금술사', 'sulfur_spring', 4, 1, 5, { keywords: ['armor:1', 'resist:1'], text: '방어력 1. 저항 1' }),
  u('sp_insight', '번뜩이는 통찰', 'union', '폭풍술사', 'storm_cliff', 1, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '주문: 1장 드로우' }),
  u('sp_corrode', '부식 안개', 'union', '연금술사', 'smoke_vale', 2, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }, { trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '주문: 상대 파멸 +2. 연쇄: 1장 드로우' }),
  u('sp_blast', '대폭발', 'union', '화염술사', null, 3, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 5 } }, { trigger: 'onPlay', op: 'entropy', args: { n: 1 }, chain: true }], text: '주문: 대상 레인의 적 5 피해. 연쇄: 상대 파멸 +1' }),
  u('sp_starfall', '유성 낙하', 'union', '용병', 'iron_gorge', 5, 0, 0,
    { kind: 'spell', effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 4 } }, { trigger: 'onPlay', op: 'entropy', args: { n: 3 } }, { trigger: 'onPlay', op: 'draw', args: { n: 1 }, chain: true }], text: '주문: 대상 레인의 적 4 피해, 상대 파멸 +3. 연쇄: 1장 드로우' }),

  // ── 은빛 서약 기사단: 성소(별도 더미) 쌓고 후반 폭발 ──
  u('abbey_wall', '수도원 성벽', 'covalent', '수도사', 'crystal_abbey', 1, 0, 5),
  u('hermit_sentinel', '암자 파수꾼', 'covalent', '수도사', 'silent_hermitage', 2, 2, 3),
  u('wood_spear', '숲지기 창병', 'covalent', '숲지기', 'mist_wood', 2, 3, 2),
  u('abbey_ballista', '수도회 노포', 'covalent', '수도사', null, 3, 2, 5),
  u('thorn_witch', '가시덤불 마녀', 'covalent', '숲지기', null, 4, 3, 4,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('marsh_hunter', '습지 사냥꾼', 'covalent', '숲지기', 'firefly_marsh', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('bronze_preacher', '청동 설교자', 'covalent', '성기사', 'bronze_gate', 4, 3, 4,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '소환: 1장 드로우' }),
  u('steel_knight', '강철 기사', 'covalent', '성기사', 'steel_bastion', 4, 4, 6),
  u('obsidian_golem', '흑요석 골렘', 'covalent', '골렘', 'obsidian_pit', 5, 3, 10, { upkeep: 1 }),
  u('bastion_colossus', '성채 거상', 'covalent', '성기사', null, 6, 6, 8),
  u('oath_breaker', '서약의 파쇄자', 'covalent', '성기사', null, 7, 7, 9),
  u('elder_colossus', '태고의 거신', 'covalent', '골렘', 'obsidian_pit', 8, 8, 9,
    { upkeep: 3, effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 3 } }], text: '소환: 상대 파멸 +3' }),
  // 장비 (기사단 전용): atk/hp는 장착 대상에 더하는 값
  u('it_stone_mail', '돌비늘 갑옷', 'covalent', '골렘', 'obsidian_pit', 2, 0, 4, { kind: 'item', text: '장착: +0/+4' }),
  u('it_thorn_blade', '가시나무 검', 'covalent', '숲지기', 'mist_wood', 2, 3, 1, { kind: 'item', text: '장착: +3/+1' }),
  u('it_oath_plate', '서약의 판금', 'covalent', '성기사', null, 4, 3, 5, { kind: 'item', text: '장착: +3/+5' }),
  // 기본 카드 풀 (덱 구성용 추가 카드): 방어력·기력·회복
  u('forged_soldier', '단조 병정', 'covalent', '골렘', 'giant_forge', 2, 1, 2, { keywords: ['armor:1'], text: '방어력 1' }),
  u('bell_squire', '종지기 종자', 'covalent', '성기사', null, 2, 1, 2,
    { keywords: ['charge:3'], effects: [{ trigger: 'onCharge', op: 'entropy', args: { n: 1 } }], text: '기력 3. 충전 시: 상대 파멸 +1' }),
  u('iron_warden', '철갑 수문장', 'covalent', '성기사', null, 3, 2, 3, { keywords: ['armor:1'], text: '방어력 1' }),
  u('scribe_monk', '필사 수도사', 'covalent', '수도사', null, 3, 2, 2,
    { keywords: ['charge:3'], effects: [{ trigger: 'onCharge', op: 'draw', args: { n: 1 } }], text: '기력 3. 충전 시: 1장 드로우' }),
  u('moss_treant', '이끼 나무정령', 'covalent', '숲지기', null, 3, 1, 3,
    { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'healSelf', args: { n: 2 } }], text: '기력 2. 충전 시: 체력 2 회복' }),
  u('ruin_bulwark', '폐허 수호석', 'covalent', '골렘', 'ash_ruins', 4, 2, 6, { upkeep: 1, keywords: ['armor:1', 'resist:1'], text: '방어력 1. 저항 1' }),
  u('censer_priest', '향로 사제', 'covalent', '성기사', null, 4, 2, 4,
    { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'gainPool', args: { n: 1 } }], text: '기력 2. 충전 시: 자원 +1' }),
  u('oath_lancer', '서약 창기병', 'covalent', '성기사', null, 5, 6, 5, { upkeep: 1, keywords: ['armor:1'], text: '방어력 1' }),
  u('gold_paladin', '황금 성기사', 'covalent', '성기사', null, 6, 3, 5,
    { keywords: ['armor:1', 'charge:2'], effects: [{ trigger: 'onCharge', op: 'healSelf', args: { n: 2 } }], text: '방어력 1. 기력 2. 충전 시: 체력 2 회복' }),
  u('high_inquisitor', '대심문관', 'covalent', '성기사', null, 7, 4, 6,
    { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'entropy', args: { n: 2 } }], text: '기력 2. 충전 시: 상대 파멸 +2' }),
  u('sky_golem', '천공 골렘', 'covalent', '골렘', 'obsidian_pit', 9, 10, 11, { upkeep: 3, keywords: ['armor:1', 'resist:1'], text: '방어력 1. 저항 1' }),
  u('it_ward_cloak', '결계 망토', 'covalent', '골렘', 'ash_ruins', 2, 0, 3, { kind: 'item', keywords: ['resist:2'], text: '장착: +0/+3, 저항 2' }),
  u('it_hawk_eye', '매의 눈', 'covalent', '숲지기', 'mist_wood', 2, 2, 0,
    { kind: 'item', effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '장착: +2/+0. 1장 드로우' }),
  u('it_holy_shield', '성스러운 방패', 'covalent', '성기사', null, 3, 0, 3, { kind: 'item', keywords: ['armor:2'], text: '장착: +0/+3, 방어력 2' }),
  // 방어 위주
  u('abbey_gatekeeper', '수도원 문지기', 'covalent', '수도사', 'crystal_abbey', 3, 1, 4, { keywords: ['armor:1'], text: '방어력 1' }),
  u('rampart_knight', '성벽 수호기사', 'covalent', '성기사', 'bronze_gate', 5, 2, 7, { keywords: ['armor:1'], text: '방어력 1' }),

  // ── 검은 달 교단: 제물로 기습 소환, 소멸 ──
  u('beacon_wisp', '등대 도깨비불', 'decay', '망령', 'ghost_beacon', 1, 1, 2),
  u('star_acolyte', '별점 수련생', 'decay', '점술사', 'star_observatory', 1, 2, 1),
  u('bone_seer', '뼈점술사', 'decay', '점술사', null, 2, 1, 2,
    { effects: [{ trigger: 'onDeath', op: 'draw', args: { n: 1 } }], text: '파괴 시: 1장 드로우' }),
  u('grave_veil', '묘지의 장막', 'decay', '망령', 'silent_cemetery', 2, 2, 3),
  u('well_oracle', '우물의 무녀', 'decay', '점술사', 'oracle_well', 3, 3, 3,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }], text: '소환: 1장 드로우' }),
  u('bog_wraith', '늪의 원령', 'decay', '망령', 'wailing_bog', 3, 2, 4,
    { effects: [{ trigger: 'onDeath', op: 'entropy', args: { n: 2 } }], text: '파괴 시: 상대 파멸 +2' }),
  u('grave_herald', '묘역 전령', 'decay', '광신도', 'withered_graves', 4, 5, 4, { keywords: ['halfLife:3'], text: '소멸 3' }),
  u('rift_flicker', '균열의 섬광', 'decay', '심연체', 'abyss_rift', 5, 6, 5, { keywords: ['halfLife:2'], text: '소멸 2' }),
  u('tomb_martyr', '왕릉의 순교자', 'decay', '광신도', 'cursed_tomb', 6, 7, 6,
    { upkeep: 1, keywords: ['halfLife:3'], effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 2 } }], text: '소멸 3. 소환: 상대 파멸 +2' }),
  u('doom_reaper', '종말의 사신', 'decay', '광신도', null, 7, 8, 6,
    { upkeep: 1, keywords: ['halfLife:2'], effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 4 } }], text: '소멸 2. 소환: 맞은편 적 4 피해' }),
  u('void_titan', '공허의 거신', 'decay', '심연체', 'void_gate', 9, 11, 10, { keywords: ['halfLife:2'], text: '소멸 2' }),
  // 기본 카드 풀 (덱 구성용 추가 카드): 망령은 저항, 광신도·심연체는 소멸
  u('drifting_shade', '떠도는 그림자', 'decay', '망령', null, 1, 1, 1, { keywords: ['resist:1'], text: '저항 1' }),
  u('candle_initiate', '촛불 입문자', 'decay', '점술사', null, 1, 1, 1,
    { effects: [{ trigger: 'onDeath', op: 'strikeOpposite', args: { n: 1 } }], text: '파괴 시: 맞은편 적 1 피해' }),
  u('soul_lantern', '영혼 등불', 'decay', '망령', null, 2, 2, 2, { keywords: ['resist:1'], text: '저항 1' }),
  u('omen_scribe', '징조 서기', 'decay', '점술사', null, 2, 1, 1,
    { keywords: ['charge:3'], effects: [{ trigger: 'onCharge', op: 'draw', args: { n: 1 } }], text: '기력 3. 충전 시: 1장 드로우' }),
  u('frenzied_zealot', '광란의 신도', 'decay', '광신도', null, 2, 3, 2, { keywords: ['halfLife:2'], text: '소멸 2' }),
  u('pale_ghost', '창백한 유령', 'decay', '망령', null, 3, 3, 4, { upkeep: 1, keywords: ['resist:2'], text: '저항 2' }),
  u('curse_weaver', '저주 직조사', 'decay', '점술사', null, 3, 2, 3,
    { effects: [{ trigger: 'onDeath', op: 'strikeOpposite', args: { n: 2 } }], text: '파괴 시: 맞은편 적 2 피해' }),
  u('flagellant', '채찍 고행자', 'decay', '광신도', null, 3, 4, 4, { keywords: ['halfLife:2'], text: '소멸 2' }),
  u('abyss_phantom', '심연의 환영', 'decay', '심연체', null, 3, 4, 3,
    { keywords: ['halfLife:1'], effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소멸 1. 소환: 맞은편 적 2 피해' }),
  u('rune_warden', '룬 수호자', 'decay', '점술사', null, 4, 4, 5, { upkeep: 1, keywords: ['resist:2'], text: '저항 2' }),
  u('moon_oracle', '달의 신탁자', 'decay', '점술사', null, 4, 2, 3,
    { effects: [{ trigger: 'onPlay', op: 'draw', args: { n: 1 } }, { trigger: 'onDeath', op: 'draw', args: { n: 1 } }], text: '소환: 1장 드로우. 파괴 시: 1장 드로우' }),
  u('doom_bellringer', '파멸의 종지기', 'decay', '광신도', null, 4, 3, 3,
    { keywords: ['charge:2'], effects: [{ trigger: 'onCharge', op: 'entropy', args: { n: 1 } }], text: '기력 2. 충전 시: 상대 파멸 +1' }),
  u('fate_hunter', '운명 사냥꾼', 'decay', '점술사', null, 5, 4, 5,
    { effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소환: 맞은편 적 2 피해' }),
  u('cult_raider', '교단 약탈자', 'decay', '광신도', null, 5, 6, 5,
    { keywords: ['halfLife:3'], effects: [{ trigger: 'onDeath', op: 'entropy', args: { n: 1 } }], text: '소멸 3. 파괴 시: 상대 파멸 +1' }),
  u('pyre_keeper', '화형대지기', 'decay', '광신도', null, 6, 7, 5,
    { keywords: ['halfLife:2'], effects: [{ trigger: 'onDeath', op: 'entropy', args: { n: 2 } }], text: '소멸 2. 파괴 시: 상대 파멸 +2' }),
  u('altar_reaper', '제단의 수확자', 'decay', '심연체', 'twisted_altar', 6, 8, 5,
    { keywords: ['halfLife:2'], effects: [{ trigger: 'onPlay', op: 'entropy', args: { n: 1 } }], text: '소멸 2. 소환: 상대 파멸 +1' }),
  u('martyr_bomb', '자폭 순교자', 'decay', '광신도', null, 7, 6, 5,
    { keywords: ['halfLife:2'], effects: [{ trigger: 'onDeath', op: 'strikeOpposite', args: { n: 4 } }, { trigger: 'onDeath', op: 'entropy', args: { n: 2 } }], text: '소멸 2. 파괴 시: 맞은편 적 4 피해, 상대 파멸 +2' }),
  u('void_storm', '공허의 폭풍', 'decay', '심연체', null, 8, 11, 10,
    { upkeep: 2, keywords: ['halfLife:2'], effects: [{ trigger: 'onPlay', op: 'strikeOpposite', args: { n: 2 } }], text: '소멸 2. 소환: 맞은편 적 2 피해' }),
  // 방어 위주: 교단은 방어력 대신 체력과 저항으로 버틴다
  u('bone_bulwark', '뼈 장벽', 'decay', '망령', 'silent_cemetery', 3, 1, 5, { keywords: ['resist:1'], text: '저항 1' }),
  u('crypt_warden', '납골당 수호령', 'decay', '망령', 'ghost_beacon', 4, 2, 6, { keywords: ['resist:1'], text: '저항 1' }),
];

// 베이스 카드: 진영마다 하나. 효과는 같고 이름만 다르다 (카드 도감에는 나오지 않고 덱 구성에서 장수만 고른다)
const base = (faction: Faction, name: string, res: string): CardDef =>
  ({ id: `base_${faction}`, name, faction, race: '베이스', level: 0, atk: 0, hp: 0, kind: 'base', text: `매 턴 시작에 ${res} +1 (설치 횟수는 턴마다 1회 생기고, 안 쓰면 쌓인다)` });
export const BASE_CARDS: CardDef[] = [base('union', '마탑 금고', '금화'), base('covalent', '기사단 성소', '신앙'), base('decay', '교단 제단', '영혼')];

const byId = new Map([...CARDS, ...BASE_CARDS].map((c) => [c.id, c]));

// 도구용 (npm run card -- test): 아직 카드 목록에 없는 시험 카드를 잠시 등록한다
export function registerCard(def: CardDef) {
  byId.set(def.id, def);
}

export function getCard(id: string): CardDef {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}
