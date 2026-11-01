// 밸런스 수치 모음. 시뮬레이터 돌리면서 여기만 고친다.
export const BALANCE = {
  maxEntropy: 40, // 파멸이 여기까지 차면 패배. 손패 규칙(idle 페널티·선타 전투)로 판이 빨라져 30 → 40
  naturalEntropy: 1, // 내 턴 시작마다 자연 증가
  fatigueEntropy: 2, // 덱이 비었을 때 드로우 대신 증가
  // 손패: 최대 max장. 내 턴 시작에 지난 턴 사용한 장수만큼 드로우 (손패에서 낸 카드 + 손패 제물)
  //   idleEntropy: 쓸 수 있는 카드가 있는데 한 장도 사용하지 않고 턴을 끝내면 내 파멸 +N
  //   decayCounts: 교단 손패 제물 중 턴당 몇 장까지 '사용'으로 셀지 (많이 셀수록 제물 순환이 빨라진다)
  hand: { max: 6, idleEntropy: 1, decayCounts: 1 },
  // 덱 구성 (docs/rules.md 3-1절). 주 세력 1개를 정하고, 다른 세력 카드는 '객원'으로 넣는다
  //   size: 덱 장수, copies: 같은 카드 최대 장수
  //   레벨 = 색 아이콘 (레벨 - 유지비) + 빈 아이콘 (유지비). 빈 아이콘은 어느 세력이든 같은 값이라 객원으로 쓰기 쉽다
  //   guestMax: 객원 카드 최대 장수, colorTax: 객원 카드의 남의 색 아이콘 하나당 비용 +N (올림, 공명 할인 전)
  //   guestWaiver: 그 카드 세력의 대지를 하나라도 가졌으면 남의 색 가산 없음 (현지 협력)
  //   객원은 유닛만 (주문·장비는 세력 고유 방식이라 FACTION_KINDS가 막는다), 연쇄는 마탑 덱에서만 발동
  deck: { size: 24, copies: 3, guestMax: 6, colorTax: 1, guestWaiver: true },
  // 선후공 보정은 진영마다 가치가 달라서 진영별로 둔다
  //   startHand: [선공, 후공] 시작 손패, secondPool: 후공 첫 턴 자원 +N
  // overload: 마탑 주문을 낼 때 내 파멸 +entropy 대신 비용 -discount (선택)
  union: { incomeBase: 2, incomeEvery: 3, incomeMax: 5, interestPer: 4, interestMax: 2, goldCap: 10, startHand: [2, 6], secondPool: 1, overload: { entropy: 6, discount: 1 } },
  covalent: { startLattices: 0, pileSize: 11, resonanceAt: 8, resonanceBonus: 2, startHand: [4, 6], secondPool: 1 },
  // 대지 (docs/rules.md 2-1절). enabled=false면 대지 없이 진행 (비교 측정용)
  //   captureTurns: 레인을 혼자 지킨 채 내 턴을 몇 번 시작해야 획득하는지 (진영별)
  //   contest: true인 진영은 맞은편에 적이 있어도 내 유닛이 버티면 점령이 진행된다 (기사단: 성소로 붙잡는다)
  //   costDiscount: 같은 대지 카드 비용 감소, groupBuff: 같은 종족 유닛 소환 시 +N/+N
  //   진영별 사용법 — react: 마탑 융합 주문 (대지 2개 + 금화 cost 소모, 대상 레인 피해 + 상대 파멸, 빛+그림자면 피해 +ionBonus)
  //   bondPool: 기사단이 가진 대지 1개당 턴 시작 신앙 +N, bondDraw: 기사단이 대지를 획득할 때 N장 드로우
  //   burnGain: 교단 대지 제물 시 영혼 +N, chainEntropy: 교단 저주받은 땅이 한 단계 타락할 때마다 상대 파멸 +N
  //   leyline: 지맥 (2-3절). 처음 깔린 대지 중 하나의 종족이 이번 판 지맥 — 그 종족 대지의 공명이 resonanceMult배
  //   tech: 전승 테크트리 (2-4절). 낼 수 있는 레벨 상한 = max(진영별 baseLevel, 지금까지 획득한 대지의 최고 등급 + periodOffset)
  elements: {
    enabled: true, captureTurns: { union: 2, covalent: 2, decay: 2 }, contest: { union: false, covalent: true, decay: false },
    costDiscount: 1, groupBuff: 1,
    react: { damage: 3, ionBonus: 1, entropy: 1, cost: 2 }, bondPool: 1, bondDraw: 1, burnGain: 2, chainEntropy: 1,
    leyline: { enabled: true, resonanceMult: 2 },
    tech: { enabled: true, baseLevel: { union: 5, covalent: 5, decay: 9 }, periodOffset: 2 }, // 교단은 타락으로 높은 등급의 땅을 직접 만들어 제한 없음
  },
  decay: { baseStart: 1, baseEvery: 3, decayHandBonus: 0, decayBoardBonus: 0, decayDraw: 0, startHand: [5, 5], secondPool: 0 },
};
