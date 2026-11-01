import type { CardDef, CardKind } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const KIND_LABEL: Record<CardKind, string> = { unit: '유닛', item: '장비', spell: '주문' };

export const KEYWORD_INFO: Record<string, [string, string]> = {
  halfLife: ['소멸', '소환 후 내 턴이 N번 시작되면 사라진다'],
  charge: ['기력', '내 턴 시작·전투 생존마다 기력 +1, N이 차면 충전 시 효과 발동'],
  armor: ['방어력', '받는 전투 피해 -N'],
  resist: ['저항', '받는 능력·주문 피해 -N'],
};

// 종족 색. 카드 그림·대지·대지 칩이 같은 색을 써서 공명 짝이 한눈에 보인다
export const GROUP_COLOR: Record<string, string> = {
  화염술사: '#f0a33a', 용병: '#d8c050', 폭풍술사: '#7ccf6a', 연금술사: '#e8684a',
  골렘: '#a3adb8', 숲지기: '#58b0f0', 성기사: '#5a7ee6', 수도사: '#3fcab9',
  점술사: '#d07fe0', 광신도: '#9a5cf5', 심연체: '#ef5aa9', 망령: '#86e0f5',
};
export const groupColor = (group: string | undefined) => (group && GROUP_COLOR[group]) || '#888';

const keywordNum = (def: CardDef, key: string) => Number(def.keywords?.find((k) => k.startsWith(key + ':'))?.split(':')[1] ?? 0);

// 왼쪽 세로 수치 한 칸: 숫자 + 작은 이름. 도형 없이 색으로만 구분한다
const stat = (cls: string, n: string | number, label: string, title: string) =>
  `<div class="s ${cls}" title="${title}"><b>${n}</b><small>${label}</small></div>`;

// 카드 앞면. 일러스트가 카드 전체를 채우고, 수치는 왼쪽 세로줄, 이름·능력은 아래쪽에 겹친다.
// 크기는 --cw(카드 폭) 하나로 정하고 안쪽은 전부 em 단위라 어떤 크기로도 그대로 확대된다
export function cardHTML(def: CardDef, o: { cost?: number; cls?: string; attrs?: string; extra?: string } = {}): string {
  const kind = def.kind ?? 'unit';
  const cost = o.cost ?? def.level;
  const plus = kind === 'item' ? '+' : '';
  const armor = keywordNum(def, 'armor'), resist = keywordNum(def, 'resist');
  const stats = kind === 'spell' ? '' : [
    stat('atk', plus + def.atk, '공격', '공격력'),
    stat('hp', plus + def.hp, '체력', '체력'),
    armor ? stat('arm', armor, '방어', `방어력: 받는 전투 피해 -${armor}`) : '',
    resist ? stat('res', resist, '저항', `저항: 받는 능력·주문 피해 -${resist}`) : '',
  ].join('');
  const art = def.art ? ` style="background-image:url('${esc(def.art)}')"` : '';
  return `<div class="card f-${def.faction} k-${kind} ${o.cls ?? ''}" style="--gc:${groupColor(def.race)}" ${o.attrs ?? ''}>
    <div class="c-art${def.art ? ' has-art' : ''}"${art}>${def.art ? '' : `<span class="c-ph">${esc(def.race)}</span>`}</div>
    <div class="c-rail">${stat(`cost${cost < def.level ? ' down' : cost > def.level ? ' up' : ''}`, cost, '비용', `비용 ${cost}`)}<div class="c-stats">${stats}</div></div>
    <div class="c-body">
      <div class="c-name">${esc(def.name)}</div>
      <div class="c-type">${esc(def.race)} · ${KIND_LABEL[kind]}</div>
      ${def.text ? `<div class="c-text">${esc(def.text)}</div>` : ''}
    </div>${o.extra ?? ''}</div>`;
}

export const cardBackHTML = (cls = '', attrs = '') => `<div class="cardback ${cls}" ${attrs}><span>✦</span></div>`;
