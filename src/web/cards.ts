import type { CardDef, CardKind } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const KIND_LABEL: Record<CardKind, string> = { unit: '유닛', item: '아이템', spell: '마법' };

export const KEYWORD_INFO: Record<string, [string, string]> = {
  halfLife: ['반감기', '소환 후 내 턴이 N번 시작되면 붕괴(파기)된다'],
  charge: ['기력', '내 턴 시작·전투 생존마다 기력 +1, N이 차면 충전 시 효과 발동'],
  armor: ['방어력', '받는 전투 피해 -N'],
  resist: ['저항', '받는 능력·마법 피해 -N'],
};

// 원소 계열(= 카드 종족) 색. 카드 그림·원소 타일·원소 칩이 같은 색을 써서 공명 짝이 한눈에 보인다
export const GROUP_COLOR: Record<string, string> = {
  알칼리: '#f0a33a', 알칼리토: '#d8c050', 할로겐: '#7ccf6a', 칼코겐: '#e8684a',
  탄소족: '#a3adb8', 질소족: '#58b0f0', 전이금속: '#5a7ee6', 준금속: '#3fcab9',
  란타넘족: '#d07fe0', 악티늄족: '#9a5cf5', 초중원소: '#ef5aa9', 비활성기체: '#86e0f5',
};
export const groupColor = (group: string | undefined) => (group && GROUP_COLOR[group]) || '#888';

const keywordNum = (def: CardDef, key: string) => Number(def.keywords?.find((k) => k.startsWith(key + ':'))?.split(':')[1] ?? 0);

// 카드 앞면. 크기는 --cw(카드 폭) 하나로 정하고 안쪽은 전부 em 단위라 어떤 크기로도 그대로 확대된다
export function cardHTML(def: CardDef, o: { cost?: number; cls?: string; attrs?: string; extra?: string } = {}): string {
  const kind = def.kind ?? 'unit';
  const cost = o.cost ?? def.level;
  const stats =
    kind === 'spell' ? '' :
    kind === 'item' ? `<div class="c-atk">+${def.atk}</div><div class="c-hp">+${def.hp}</div>` :
    `<div class="c-atk">${def.atk}</div><div class="c-hp">${def.hp}</div>`;
  const armor = keywordNum(def, 'armor'), resist = keywordNum(def, 'resist');
  const guard = armor || resist ? `<div class="c-guard">${armor ? `<i title="방어력: 받는 전투 피해 -${armor}">🛡${armor}</i>` : ''}${resist ? `<i title="저항: 받는 능력·마법 피해 -${resist}">✧${resist}</i>` : ''}</div>` : '';
  return `<div class="card f-${def.faction} k-${kind} ${o.cls ?? ''}" ${o.attrs ?? ''}>
    <div class="c-art" style="--gc:${groupColor(def.race)}"><span class="c-sym">${esc(def.element)}</span><span class="c-race">${esc(def.race)}</span></div>
    <div class="c-cost${cost < def.level ? ' down' : ''}">${cost}</div>
    <div class="c-name">${esc(def.name)}</div>
    <div class="c-text">${esc(def.text ?? '')}</div>
    <div class="c-kind">${KIND_LABEL[kind]}</div>${stats}${guard}${o.extra ?? ''}</div>`;
}

export const cardBackHTML = (cls = '', attrs = '') => `<div class="cardback ${cls}" ${attrs}><span>⚛</span></div>`;
