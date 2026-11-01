import type { CardDef, CardKind } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const KIND_LABEL: Record<CardKind, string> = { unit: '유닛', item: '아이템', spell: '마법' };

export const KEYWORD_INFO: Record<string, [string, string]> = {
  halfLife: ['반감기', '소환 후 내 턴이 N번 시작되면 붕괴(파기)된다'],
  charge: ['기력', '내 턴 시작·전투 생존마다 기력 +1, N이 차면 충전 시 효과 발동'],
  armor: ['방어력', '받는 전투 피해 -N'],
  resist: ['저항', '받는 능력·마법 피해 -N'],
};

// 카드 앞면. 크기는 --cw(카드 폭) 하나로 정하고 안쪽은 전부 em 단위라 어떤 크기로도 그대로 확대된다
export function cardHTML(def: CardDef, o: { cost?: number; cls?: string; attrs?: string; extra?: string } = {}): string {
  const kind = def.kind ?? 'unit';
  const cost = o.cost ?? def.level;
  const stats =
    kind === 'spell' ? '' :
    kind === 'item' ? `<div class="c-atk">+${def.atk}</div><div class="c-hp">+${def.hp}</div>` :
    `<div class="c-atk">${def.atk}</div><div class="c-hp">${def.hp}</div>`;
  return `<div class="card f-${def.faction} k-${kind} ${o.cls ?? ''}" ${o.attrs ?? ''}>
    <div class="c-art"><span class="c-sym">${esc(def.element)}</span><span class="c-race">${esc(def.race)}</span></div>
    <div class="c-cost${cost < def.level ? ' down' : ''}">${cost}</div>
    <div class="c-name">${esc(def.name)}</div>
    <div class="c-text">${esc(def.text ?? '')}</div>
    <div class="c-kind">${KIND_LABEL[kind]}</div>${stats}${o.extra ?? ''}</div>`;
}

export const cardBackHTML = (cls = '', attrs = '') => `<div class="cardback ${cls}" ${attrs}><span>⚛</span></div>`;
