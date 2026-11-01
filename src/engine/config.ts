// 밸런스 수치 모음. 시뮬레이터 돌리면서 여기만 고친다.
export const BALANCE = {
  maxEntropy: 30, // 엔트로피가 여기까지 차면 소멸(패배)
  naturalEntropy: 1, // 내 턴 시작마다 자연 증가
  fatigueEntropy: 2, // 덱이 비었을 때 드로우 대신 증가
  // 선후공 보정은 진영마다 가치가 달라서 진영별로 둔다
  //   startHand: [선공, 후공] 시작 손패, secondPool: 후공 첫 턴 자원 +N
  // overload: 연맹 마법을 낼 때 내 엔트로피 +entropy 대신 비용 -discount (선택)
  union: { incomeBase: 2, incomeEvery: 3, incomeMax: 5, interestPer: 4, interestMax: 2, goldCap: 10, startHand: [3, 6], secondPool: 1, overload: { entropy: 6, discount: 1 } },
  covalent: { startLattices: 0, pileSize: 11, resonanceAt: 8, resonanceBonus: 2, startHand: [4, 6], secondPool: 1 },
  // 원소 타일 (docs/rules.md 2-1절). enabled=false면 원소 없이 진행 (비교 측정용)
  //   captureTurns: 레인을 혼자 지킨 채 내 턴을 몇 번 시작해야 획득하는지 (진영별)
  //   contest: true인 진영은 맞은편에 적이 있어도 내 유닛이 버티면 장악이 진행된다 (방벽: 격자로 붙잡는다)
  //   costDiscount: 같은 원소 카드 비용 감소, groupBuff: 같은 계열 유닛 소환 시 +N/+N
  //   진영별 사용법 — react: 연맹 반응 (원소 2개 + 금화 cost 소모, 대상 레인 피해 + 상대 엔트로피, 금속+비금속이면 피해 +ionBonus)
  //   bondPool: 방벽이 가진 원소 1개당 턴 시작 결합력 +N, bondDraw: 방벽이 원소를 획득할 때 N장 드로우
  //   burnGain: 교단 원소 붕괴 시 붕괴열 +N, chainEntropy: 교단 방사성 원소가 한 단계 붕괴할 때마다 상대 엔트로피 +N
  //   leyline: 지맥 (2-3절). 처음 깔린 원소 중 하나의 계열이 이번 판 지맥 — 그 계열 원소의 공명이 resonanceMult배
  //   tech: 주기 테크트리 (2-4절). 낼 수 있는 레벨 상한 = max(진영별 baseLevel, 지금까지 획득한 원소의 최고 주기 + periodOffset)
  elements: {
    enabled: true, captureTurns: { union: 2, covalent: 2, decay: 2 }, contest: { union: false, covalent: true, decay: false },
    costDiscount: 1, groupBuff: 1,
    react: { damage: 3, ionBonus: 1, entropy: 1, cost: 3 }, bondPool: 1, bondDraw: 1, burnGain: 2, chainEntropy: 1,
    leyline: { enabled: true, resonanceMult: 2 },
    tech: { enabled: true, baseLevel: { union: 5, covalent: 5, decay: 9 }, periodOffset: 2 }, // 교단은 붕괴로 무거운 원소를 직접 만들어 제한 없음
  },
  decay: { baseStart: 1, baseEvery: 3, decayHandBonus: 0, decayBoardBonus: 2, decayDraw: 0, startHand: [5, 5], secondPool: 0 },
};
