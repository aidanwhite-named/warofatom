// 전장 가운데 놓이는 원소 타일 풀. group은 카드 종족(race)과 같은 이름을 쓴다 (공명 판정).
// 종족 12개 × 2종 = 24종이라 진영마다 공명 가능한 원소가 8종씩 같다.
//   nature: 연맹 반응에 쓰인다 (금속 + 비금속 = 이온 반응, 비활성은 반응 불가)
//   decaysTo: 방사성 원소의 붕괴 사슬 (교단이 가졌을 때만 매 턴 진행)
//   product: 붕괴로만 생기는 원소 (타일 풀에는 없음)
export type ElementDef = {
  symbol: string; name: string; group: string;
  nature: 'metal' | 'nonmetal' | 'noble';
  decaysTo?: string; product?: boolean;
};

export const ELEMENTS: ElementDef[] = [
  { symbol: 'Li', name: '리튬', group: '알칼리', nature: 'metal' },
  { symbol: 'Na', name: '나트륨', group: '알칼리', nature: 'metal' },
  { symbol: 'Mg', name: '마그네슘', group: '알칼리토', nature: 'metal' },
  { symbol: 'Ca', name: '칼슘', group: '알칼리토', nature: 'metal' },
  { symbol: 'F', name: '플루오린', group: '할로겐', nature: 'nonmetal' },
  { symbol: 'Cl', name: '염소', group: '할로겐', nature: 'nonmetal' },
  { symbol: 'O', name: '산소', group: '칼코겐', nature: 'nonmetal' },
  { symbol: 'S', name: '황', group: '칼코겐', nature: 'nonmetal' },
  { symbol: 'C', name: '탄소', group: '탄소족', nature: 'nonmetal' },
  { symbol: 'Sn', name: '주석', group: '탄소족', nature: 'metal' },
  { symbol: 'N', name: '질소', group: '질소족', nature: 'nonmetal' },
  { symbol: 'P', name: '인', group: '질소족', nature: 'nonmetal' },
  { symbol: 'Fe', name: '철', group: '전이금속', nature: 'metal' },
  { symbol: 'Cu', name: '구리', group: '전이금속', nature: 'metal' },
  { symbol: 'Si', name: '규소', group: '준금속', nature: 'nonmetal' },
  { symbol: 'B', name: '붕소', group: '준금속', nature: 'nonmetal' },
  { symbol: 'Ce', name: '세륨', group: '란타넘족', nature: 'metal' },
  { symbol: 'Nd', name: '네오디뮴', group: '란타넘족', nature: 'metal' },
  { symbol: 'U', name: '우라늄', group: '악티늄족', nature: 'metal', decaysTo: 'Th' },
  { symbol: 'Th', name: '토륨', group: '악티늄족', nature: 'metal', decaysTo: 'Ra' },
  { symbol: 'Fl', name: '플레로븀', group: '초중원소', nature: 'metal', decaysTo: 'Cn' },
  { symbol: 'Og', name: '오가네손', group: '초중원소', nature: 'noble', decaysTo: 'Lv' },
  { symbol: 'Ne', name: '네온', group: '비활성기체', nature: 'noble' },
  { symbol: 'Ar', name: '아르곤', group: '비활성기체', nature: 'noble' },
  // 붕괴 생성물: U → Th → Ra → Rn → Pb, Og → Lv → Fl → Cn → Pb
  { symbol: 'Ra', name: '라듐', group: '알칼리토', nature: 'metal', decaysTo: 'Rn', product: true },
  { symbol: 'Rn', name: '라돈', group: '비활성기체', nature: 'noble', decaysTo: 'Pb', product: true },
  { symbol: 'Lv', name: '리버모륨', group: '초중원소', nature: 'metal', decaysTo: 'Fl', product: true },
  { symbol: 'Cn', name: '코페르니슘', group: '초중원소', nature: 'metal', decaysTo: 'Pb', product: true },
  { symbol: 'Pb', name: '납', group: '탄소족', nature: 'metal', product: true },
];

export const TILE_POOL = ELEMENTS.filter((e) => !e.product).map((e) => e.symbol);

const bySymbol = new Map(ELEMENTS.map((e) => [e.symbol, e]));

export function getElement(symbol: string): ElementDef {
  const e = bySymbol.get(symbol);
  if (!e) throw new Error(`unknown element ${symbol}`);
  return e;
}
