import { BALANCE } from '../engine/config';
import type { DeckSpec } from '../engine/game';
import type { Faction } from '../engine/types';
import { FACTION_RACES } from './factions';

const x = (n: number, id: string) => Array<string>(n).fill(id);

// 고정 프리셋 덱 (각 24장). 기사단의 성소는 덱이 아닌 별도 더미(config.ts).
export const DECKS: Record<Faction, DeckSpec> = {
  union: {
    faction: 'union',
    cards: [
      ...x(1, 'ember_scout'), ...x(1, 'shield_merc'), ...x(2, 'flame_runner'), ...x(2, 'blast_adept'), ...x(1, 'gorge_guard'),
      ...x(2, 'quarry_mason'), ...x(2, 'spark_archer'), ...x(2, 'gale_blade'), ...x(2, 'smoke_igniter'),
      ...x(2, 'sulfur_brute'), ...x(2, 'storm_caller'), ...x(1, 'inferno_master'), ...x(1, 'giant_captain'),
      ...x(1, 'sp_fireball'), ...x(1, 'sp_omen'), ...x(1, 'sp_siege'),
    ],
  },
  covalent: {
    faction: 'covalent',
    cards: [
      ...x(2, 'abbey_wall'), ...x(2, 'forged_soldier'), ...x(2, 'wood_spear'), ...x(2, 'iron_warden'),
      ...x(1, 'abbey_ballista'), ...x(2, 'bronze_preacher'), ...x(2, 'steel_knight'), ...x(2, 'thorn_witch'),
      ...x(2, 'obsidian_golem'), ...x(2, 'bastion_colossus'), ...x(1, 'oath_breaker'), ...x(1, 'elder_colossus'),
      ...x(1, 'it_holy_shield'), ...x(1, 'it_thorn_blade'), ...x(1, 'it_oath_plate'),
    ],
  },
  decay: {
    faction: 'decay',
    cards: [
      ...x(3, 'beacon_wisp'), ...x(3, 'star_acolyte'), ...x(2, 'bone_seer'), ...x(2, 'soul_lantern'),
      ...x(2, 'well_oracle'), ...x(2, 'bog_wraith'), ...x(3, 'grave_herald'), ...x(2, 'rift_flicker'),
      ...x(2, 'tomb_martyr'), ...x(2, 'doom_reaper'), ...x(1, 'void_titan'),
    ],
  },
};

// 프리셋 덱에는 베이스 카드를 BALANCE.base.presetCount장씩 넣는다. 플레이어가 만든 덱은 베이스 장수를 자유롭게 정한다
const withBases = (spec: DeckSpec) => { spec.cards.push(...x(BALANCE.base.presetCount, `base_${spec.faction}`)); };
for (const spec of Object.values(DECKS)) withBases(spec);

// 프리셋 덱 목록. 세력을 고른 뒤 주력 종족(races)으로 덱을 고른다 (docs/rules.md 3-1절)
//   races: 덱의 중심 종족 (그 종족 대지를 점령하면 공명이 몰린다). 기본 덱은 네 종족 혼합
export type PresetDeck = { key: string; name: string; races: string[]; spec: DeckSpec };

// 종족 덱: 주력 종족 둘에서 18장 이상, 나머지는 같은 세력의 다른 종족으로 비는 레벨을 메운다 (세력 안은 페널티 없음)
export const RACE_DECKS: PresetDeck[] = [
  {
    key: 'union_fire', name: '화염 폭격', races: ['화염술사', '연금술사'],
    spec: {
      faction: 'union',
      cards: [
        ...x(2, 'ember_scout'), ...x(2, 'flame_runner'), ...x(2, 'blast_adept'), ...x(2, 'ash_raider'), ...x(2, 'flash_burner'),
        ...x(2, 'sp_fireball'), ...x(1, 'sp_corrode'), ...x(2, 'sp_blast'), ...x(2, 'smoke_igniter'), ...x(1, 'alembic_keeper'),
        ...x(2, 'sulfur_brute'), ...x(2, 'powder_thrower'), ...x(1, 'poison_brewer'), ...x(1, 'inferno_master'),
      ],
    },
  },
  {
    key: 'union_storm', name: '폭풍 용병단', races: ['폭풍술사', '용병'],
    spec: {
      faction: 'union',
      cards: [
        ...x(1, 'sp_insight'), ...x(2, 'ember_scout'), ...x(2, 'shield_merc'), ...x(1, 'gorge_guard'), ...x(2, 'spark_archer'), ...x(2, 'gale_blade'),
        ...x(2, 'sulfur_brute'), ...x(2, 'quarry_mason'), ...x(1, 'flare_merc'), ...x(1, 'sp_omen'), ...x(2, 'bolt_sniper'),
        ...x(1, 'sp_siege'), ...x(2, 'storm_caller'), ...x(1, 'blight_miner'), ...x(1, 'sp_starfall'), ...x(1, 'giant_captain'),
      ],
    },
  },
  {
    key: 'covalent_bastion', name: '성채 수호', races: ['성기사', '수도사'],
    spec: {
      faction: 'covalent',
      cards: [
        ...x(2, 'abbey_wall'), ...x(1, 'thorn_witch'), ...x(1, 'forged_soldier'), ...x(3, 'iron_warden'), ...x(1, 'abbey_ballista'),
        ...x(2, 'obsidian_golem'), ...x(2, 'it_holy_shield'), ...x(2, 'bronze_preacher'), ...x(2, 'steel_knight'), ...x(1, 'thorn_witch'),
        ...x(3, 'oath_lancer'), ...x(1, 'it_oath_plate'), ...x(2, 'bastion_colossus'),
        ...x(1, 'oath_breaker'),
      ],
    },
  },
  {
    key: 'covalent_grove', name: '숲과 거인', races: ['숲지기', '골렘'],
    spec: {
      faction: 'covalent',
      cards: [
        ...x(2, 'abbey_wall'), ...x(2, 'forged_soldier'), ...x(3, 'wood_spear'), ...x(2, 'it_thorn_blade'), ...x(1, 'steel_knight'), ...x(2, 'bastion_colossus'), ...x(3, 'marsh_hunter'), ...x(3, 'thorn_witch'), ...x(2, 'ruin_bulwark'),
        ...x(2, 'obsidian_golem'), ...x(1, 'elder_colossus'), ...x(1, 'sky_golem'),
      ],
    },
  },
  {
    key: 'decay_blood', name: '피의 강림', races: ['광신도', '심연체'],
    spec: {
      faction: 'decay',
      cards: [
        ...x(3, 'beacon_wisp'), ...x(2, 'star_acolyte'), ...x(1, 'bone_seer'), ...x(3, 'frenzied_zealot'), ...x(2, 'flagellant'),
        ...x(2, 'abyss_phantom'), ...x(3, 'grave_herald'), ...x(2, 'cult_raider'), ...x(2, 'rift_flicker'), ...x(1, 'tomb_martyr'),
        ...x(1, 'altar_reaper'), ...x(1, 'doom_reaper'), ...x(1, 'void_titan'),
      ],
    },
  },
  {
    key: 'decay_omen', name: '망령 점성술', races: ['점술사', '망령'],
    spec: {
      faction: 'decay',
      cards: [
        ...x(2, 'beacon_wisp'), ...x(1, 'drifting_shade'), ...x(2, 'star_acolyte'), ...x(2, 'bone_seer'),
        ...x(2, 'soul_lantern'), ...x(2, 'grave_herald'), ...x(1, 'doom_reaper'), ...x(1, 'grave_veil'), ...x(2, 'well_oracle'), ...x(2, 'bog_wraith'),
        ...x(1, 'pale_ghost'), ...x(1, 'curse_weaver'), ...x(1, 'rune_warden'), ...x(1, 'moon_oracle'), ...x(1, 'fate_hunter'),
        // 점술사·망령엔 L6 이상이 없어 소멸 대형 유닛을 내는 교단 덱에 밀린다 → 다른 종족 마무리 2장
        ...x(1, 'tomb_martyr'), ...x(1, 'void_titan'),
      ],
    },
  },
];

for (const d of RACE_DECKS) withBases(d.spec);

// 객원 덱 예시: 기본 덱에서 4장을 다른 세력 유닛으로 바꿨다. 남의 색 아이콘만큼 비싸지므로 빈 아이콘(유지비)이 많은 카드를 고른다
export const GUEST_DECKS: PresetDeck[] = [
  {
    key: 'union_guard', name: '마탑 + 망령·골렘 방패', races: ['화염술사', '용병', '폭풍술사', '연금술사'],
    spec: {
      faction: 'union',
      cards: DECKS.union.cards.filter((id) => id !== 'sulfur_brute' && id !== 'smoke_igniter').concat(x(2, 'pale_ghost'), x(2, 'ruin_bulwark')),
    },
  },
  {
    key: 'covalent_vanguard', name: '기사단 + 용병 고용', races: ['골렘', '숲지기', '성기사', '수도사'],
    spec: {
      faction: 'covalent',
      cards: DECKS.covalent.cards.filter((id) => id !== 'bastion_colossus' && id !== 'iron_warden').concat(x(2, 'pale_ghost'), x(2, 'blight_miner')),
    },
  },
  {
    key: 'decay_wall', name: '교단 + 골렘 방벽', races: ['점술사', '광신도', '심연체', '망령'],
    spec: {
      faction: 'decay',
      cards: DECKS.decay.cards.filter((id) => id !== 'bone_seer' && id !== 'soul_lantern').concat(x(2, 'ruin_bulwark'), x(2, 'iron_warden')),
    },
  },
];

// 화면에 나오는 덱 전체: 세력마다 기본(네 종족 혼합) → 종족 덱 → 객원 덱
export const DECK_LIST: PresetDeck[] = (Object.keys(DECKS) as Faction[]).flatMap((f) => [
  { key: f, name: '연합군 (기본)', races: FACTION_RACES[f], spec: DECKS[f] },
  ...RACE_DECKS.filter((d) => d.spec.faction === f),
  ...GUEST_DECKS.filter((d) => d.spec.faction === f),
]);
