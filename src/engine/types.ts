export type Faction = 'union' | 'covalent' | 'decay';
export type Trigger = 'onPlay' | 'onDeath';

export type EffectDef = {
  trigger: Trigger;
  op: string; // effects.ts 의 op 테이블 키
  args?: Record<string, number>;
  chain?: boolean; // true면 '연쇄' 조건(이번 턴 연맹 유닛 소환 이력)일 때만 발동
};

export type CardDef = {
  id: string;
  name: string;
  faction: Faction;
  race: string;
  element: string; // 원소 기호
  level: number; // = 비용
  atk: number;
  hp: number;
  keywords?: string[]; // 'halfLife:3' 등
  effects?: EffectDef[];
  text?: string;
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
};

export type PlayerState = {
  faction: Faction;
  entropy: number; // 차오르면 소멸 (MAX_ENTROPY 도달 시 패배)
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  lanes: (Unit | null)[];
  pool: number; // 지금 쓸 수 있는 자원 (금화/결합력/붕괴열)
  lattices: number; // 전장에 놓인 격자 수
  latticePile: number; // 아직 놓지 않은 격자 수 (덱과 별도)
  latticePlayed: boolean;
  unitsPlayedThisTurn: number;
  turns: number; // 내 턴이 시작된 횟수
};

export type GameState = {
  players: [PlayerState, PlayerState];
  active: 0 | 1;
  turn: number; // 전체 턴 수
  winner: 0 | 1 | null;
  rng: number; // 시드 상태
  nextUid: number;
  log: GameEvent[];
};

export type Action =
  | { type: 'play'; uid: number; lane: number }
  | { type: 'lattice' }
  | { type: 'attack'; lane: number }
  | { type: 'decay'; from: 'hand' | 'board'; uid: number }
  | { type: 'endTurn' };

export type EntropyCause = 'natural' | 'attack' | 'effect' | 'fatigue';

export type GameEvent =
  | { t: 'turnStart'; p: 0 | 1; pool: number }
  | { t: 'draw'; p: 0 | 1; cardId: string }
  | { t: 'play'; p: 0 | 1; cardId: string; lane: number }
  | { t: 'lattice'; p: 0 | 1; total: number }
  | { t: 'attack'; p: 0 | 1; lane: number; target: 'unit' | 'entropy'; dmg: number }
  | { t: 'death'; p: 0 | 1; cardId: string; lane: number; reason: 'combat' | 'halfLife' | 'decay' | 'effect' }
  | { t: 'decay'; p: 0 | 1; cardId: string; gain: number }
  | { t: 'entropy'; p: 0 | 1; amount: number; total: number; cause: EntropyCause }
  | { t: 'win'; p: 0 | 1 };

export const LANES = 4;
