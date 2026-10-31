// 밸런스 수치 모음. 시뮬레이터 돌리면서 여기만 고친다.
export const BALANCE = {
  maxEntropy: 30, // 엔트로피가 여기까지 차면 소멸(패배)
  naturalEntropy: 1, // 내 턴 시작마다 자연 증가
  fatigueEntropy: 2, // 덱이 비었을 때 드로우 대신 증가
  startHand: [4, 6] as const, // 선공/후공 시작 손패
  secondPlayerBonus: 1, // 후공 첫 턴에 자원 +N (선공 이점 보정)

  union: { incomeBase: 2, incomeEvery: 3, incomeMax: 5, interestPer: 4, interestMax: 2, goldCap: 10 },
  covalent: { startLattices: 0, pileSize: 9, resonanceAt: 8, resonanceBonus: 2 },
  decay: { baseStart: 1, baseEvery: 2, decayHandBonus: 0, decayBoardBonus: 2, decayDraw: 1 },
};
