// 코드 이름은 초기 설계(원소 세계관)에서 남은 내부 이름이고, 화면·문서는 판타지 세계관 이름을 쓴다 (docs/rules.md 0절 용어표)
//   union = 잿불 마탑, covalent = 은빛 서약 기사단, decay = 검은 달 교단
//   entropy = 파멸, elements/tiles = 대지, lattice = 성소, decay 행동 = 제물, halfLife = 소멸, react = 융합 주문
export type Faction = 'union' | 'covalent' | 'decay';
export type Trigger = 'onPlay' | 'onDeath' | 'onCharge'; // onCharge: 기력(charge:N)이 다 찰 때마다

export type EffectDef = {
  trigger: Trigger;
  op: string; // effects.ts 의 op 테이블 키
  args?: Record<string, number>;
  chain?: boolean; // true면 '연쇄' 조건(이번 턴 마탑 유닛 소환 이력)일 때만 발동
};

export type CardKind = 'unit' | 'item' | 'spell';

export type CardDef = {
  id: string;
  name: string;
  faction: Faction;
  race: string;
  land?: string; // 연고 대지 키 (가지면 비용 공명). 없는 카드도 있다
  level: number; // = 소환 비용
  upkeep?: number; // 내 턴 시작마다 지불하는 유지비 (못 내면 파괴)
  atk: number;
  hp: number;
  kind?: CardKind; // 없으면 유닛. 아이템은 장착 대상에 atk/hp를 더한다. 진영별 허용은 game.ts FACTION_KINDS
  keywords?: string[]; // 'halfLife:3' 등
  effects?: EffectDef[];
  text?: string;
  art?: string; // 일러스트 이미지 경로 (없으면 종족 색 그라데이션)
};

export type CardInstance = { uid: number; cardId: string };

export type Unit = {
  uid: number;
  cardId: string;
  atk: number;
  hp: number;
  sick: boolean; // 이번 턴 소환됨
  attacked: boolean;
  halfLife?: number; // 남은 턴 수
  energy?: number; // 모인 기력 (charge:N 키워드가 있는 유닛만)
  inherited?: string[]; // 교단 빙의로 물려받은 카드 id (그 카드의 파괴 시 효과도 발동)
  equipped?: string[]; // 기사단 장비 카드 id
};

export type PlayerState = {
  faction: Faction;
  entropy: number; // 파멸. 차오르면 패배 (maxEntropy 도달 시)
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  lanes: (Unit | null)[];
  pool: number; // 지금 쓸 수 있는 자원 (금화/신앙/영혼)
  lattices: number; // 전장에 세운 성소 수
  latticePile: number; // 아직 세우지 않은 성소 수 (덱과 별도)
  latticePlayed: boolean;
  unitsPlayedThisTurn: number;
  cardsUsedThisTurn: number; // 손패에서 사용한 장수 (다음 턴 시작에 이만큼 드로우)
  cardsUsedLastTurn: number;
  cardsDecayedThisTurn: number; // 손패 제물 장수 (BALANCE.hand.decayCounts까지만 사용으로 센다)
  turns: number; // 내 턴이 시작된 횟수
  elements: string[]; // 점령한 대지 키
  capture: number[]; // 레인별 점령 게이지
  tech: number; // 전승 단계 = 지금까지 점령한 대지의 최고 등급 (대지를 써도 내려가지 않음)
};

export type GameState = {
  players: [PlayerState, PlayerState];
  active: 0 | 1;
  turn: number; // 전체 턴 수
  winner: 0 | 1 | null;
  rng: number; // 시드 상태
  nextUid: number;
  tiles: (string | null)[]; // 레인 가운데 놓인 대지 키
  tileBag: string[]; // 아직 나오지 않은 대지 (점령되면 여기서 채운다)
  leyline: string | null; // 이번 판 지맥 종족 (대지 race)
  log: GameEvent[];
};

export type Action =
  | { type: 'play'; uid: number; lane: number; overload?: boolean } // lane: 유닛은 빈 칸, 아이템은 내 유닛 칸, 마법은 대상 레인
  | { type: 'lattice' }
  | { type: 'attack'; lane: number }
  | { type: 'decay'; from: 'hand' | 'board'; uid: number; heir?: number } // 제물. heir: 유닛 제물 시 빙의할 내 유닛 uid
  | { type: 'decay'; from: 'element'; element: string } // 교단: 가진 대지를 제물로 바쳐 영혼
  | { type: 'react'; lane: number; a: string; b: string } // 마탑: 가진 대지 2개로 융합 주문
  | { type: 'endTurn' };

export type EntropyCause = 'natural' | 'attack' | 'effect' | 'fatigue' | 'overload' | 'idle';

export type GameEvent =
  | { t: 'turnStart'; p: 0 | 1; pool: number }
  | { t: 'draw'; p: 0 | 1; cardId: string }
  | { t: 'play'; p: 0 | 1; cardId: string; lane: number }
  | { t: 'lattice'; p: 0 | 1; total: number }
  | { t: 'attack'; p: 0 | 1; lane: number; target: 'unit' | 'entropy'; dmg: number }
  | { t: 'counter'; p: 0 | 1; lane: number; dmg: number } // 공격을 버틴 유닛의 반격 (p = 반격한 쪽)
  | { t: 'death'; p: 0 | 1; cardId: string; lane: number; reason: 'combat' | 'halfLife' | 'decay' | 'effect' | 'upkeep' }
  | { t: 'decay'; p: 0 | 1; cardId: string; gain: number }
  | { t: 'inherit'; p: 0 | 1; cardId: string; lane: number }
  | { t: 'charge'; p: 0 | 1; cardId: string; lane: number }
  | { t: 'capture'; p: 0 | 1; lane: number; element: string }
  | { t: 'react'; p: 0 | 1; lane: number; elements: [string, string]; dmg: number }
  | { t: 'burn'; p: 0 | 1; element: string; gain: number }
  | { t: 'transmute'; p: 0 | 1; from: string; to: string }
  | { t: 'entropy'; p: 0 | 1; amount: number; total: number; cause: EntropyCause }
  | { t: 'win'; p: 0 | 1 };

export const LANES = 4;
