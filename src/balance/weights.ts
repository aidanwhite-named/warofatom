// 카드 점수 가중치와 레벨별 예산. 시뮬레이터 결과를 보고 여기만 고친다.
// 진영 공통. 초기값은 현재 카드(src/data/cards.ts)를 `npm run card -- audit`로 역산한 것이라 아직 시뮬레이션 검증 전이다.
export const WEIGHTS = {
  maxLevel: 9,

  atk: 1,
  hp: 1,
  armor: 2, // 방어력 1: 받는 전투 피해 -1 (전투가 잦아 체력 1보다 비싸게)
  resist: 1, // 저항 1: 받는 효과·주문 피해 -1

  // op별 인자 1당 점수
  // entropy·draw는 `npm run calibrate -- 300`으로 낮췄다 (entropy 1.5 → 시뮬 0.9, draw 2.5 → 시뮬 −0.1).
  // 드로우는 '사용한 만큼 드로우 + 손패 6장' 규칙 때문에 추가 드로우가 거의 쓸모없다. 0이 아닌 건 표본 오차와 덱 압축 여지를 남긴 것
  op: {
    entropy: 1, // 상대 파멸 +n
    strikeOpposite: 1.2, // 맞은편 적 n 피해 (시뮬 1.1, 그대로)
    draw: 0.5, // n장 드로우
    gainPool: 2, // 자원 +n
    healSelf: 0.8, // 자신 체력 n 회복 (다쳤을 때만 쓸모 있어 체력보다 싸게)
  } as Record<string, number>,
  chainFactor: 0.6, // 연쇄 조건이 붙은 효과의 할인
  onDeathFactor: 0.7, // 파괴 시 효과의 할인
  // 기력 N 유닛의 충전 시 효과에 곱한다. 살아 있는 동안 반복 발동하므로 N이 작을수록 1보다 크다
  chargeFactor: { 1: 2.5, 2: 1.5, 3: 1, 4: 0.7 } as Record<number, number>,

  // 소멸 N이면 스탯 점수에 곱한다 (짧을수록 크게 할인)
  //   교단 덱에서 영구 유닛과 같은 승률이 나오는 소멸 유닛 스탯을 `npm run card -- test`로 쟀다 (300판):
  //   L5 영구 6/5 ≈ 소멸 2 스탯 합 ~24 → 0.5, L4 영구 5/4 ≈ 소멸 3 스탯 합 ~12 → 0.75. 소멸 1·4는 측정 없이 이어 붙인 값
  //   (이전 0.6 / 0.85 / 0.9 / 0.95)
  halfLifeFactor: { 1: 0.35, 2: 0.5, 3: 0.75, 4: 0.85 } as Record<number, number>,

  // 레벨 N 카드의 예산 = base + perLevel * N
  budget: { base: 1, perLevel: 2 },

  // 유지비 1당 예산 보너스와 상한. 유지비가 있으면 같은 레벨에서 더 강한 카드를 만들 수 있다. 유지비는 레벨(아이콘 수)을 넘을 수 없다.
  upkeepRebate: 1.5, // 레벨 1칸(예산 2)보다 작게: 유지비 1이 붙은 Lv N 카드는 유지비 없는 Lv N보다 강하고 Lv N+1보다 약하다
  maxUpkeep: 3,
};
