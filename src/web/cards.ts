import { BALANCE } from '../engine/config';
import type { CardDef, CardKind } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const KIND_LABEL: Record<CardKind, string> = { unit: '유닛', item: '장비', spell: '주문', base: '베이스' };

export const KEYWORD_INFO: Record<string, [string, string]> = {
  halfLife: ['소멸', '소환 후 내 턴이 N번 시작되면 사라진다. 교단 유닛은 사라질 때 자동으로 제물이 되어 영혼 +레벨의 절반(내림)'],
  charge: ['기력', '내 턴 시작·전투 생존마다 기력 +1, N이 차면 충전 시 효과 발동'],
  armor: ['방어력', '받는 전투 피해 -N'],
  resist: ['저항', '받는 능력·주문 피해 -N'],
};

// 카드 글 속 용어. 마우스를 올리면 설명이 뜬다 (termHTML로 감싼 곳 어디서든)
const ov = BALANCE.union.overload, sp = BALANCE.union.spire;
const TERM_TIP: Record<string, string> = {
  연쇄: '이번 턴에 마탑 유닛을 이미 소환했다면 발동하는 효과입니다. 다른 세력 덱에 객원으로 들어온 마탑 카드는 발동하지 않습니다.',
  폭주: `마탑 주문을 낼 때 고를 수 있는 방식입니다. 비용이 ${ov.discount} 줄어드는 대신 내 파멸이 ${ov.entropy} 늘고, 첨탑이 ${sp.overloadBonus}층 더 오릅니다.`,
  소멸: KEYWORD_INFO.halfLife[1],
  기력: KEYWORD_INFO.charge[1],
  저항: KEYWORD_INFO.resist[1],
};
export const termHTML = (label: string) => `<span class="term" data-tip="${esc(TERM_TIP[label.split(' ')[0]])}">${label}</span>`;

// 용어 설명 말풍선. 카드가 overflow를 자르거나 무대가 확대돼도 안 잘리게 화면 기준으로 띄운다
if (typeof document !== 'undefined') {
  const tip = document.createElement('div');
  tip.className = 'term-tip';
  document.body.append(tip);
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.term[data-tip]');
    if (!t) { tip.classList.remove('show'); return; }
    tip.textContent = t.dataset.tip!;
    const r = t.getBoundingClientRect();
    tip.classList.add('show');
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
  });
}

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
  // 세로줄은 공격·방어·체력 세 칸 (없어도 0). 저항은 능력 피해만 막는 다른 성질이라 능력 글 쪽에 따로 표시한다
  const stats = kind === 'spell' || kind === 'base' ? '' : [
    stat('atk', plus + def.atk, '공격', '공격력'),
    stat('arm', plus + armor, '방어', `방어력: 받는 전투 피해 -${armor}`),
    stat('hp', plus + def.hp, '체력', '체력'),
  ].join('');
  const resTag = `<span class="kw-res term" data-tip="${esc(TERM_TIP['저항'])}">저항 +${resist}</span>`;
  const text = def.text ? esc(def.text).replace(/저항 \d+|연쇄|폭주|소멸|기력/g, (m) => (m.startsWith('저항') ? resTag : termHTML(m))) : '';
  const overload = o.cls?.includes('big') && kind === 'spell' && def.faction === 'union' && !text.includes('폭주');
  const body = [resist && !text.includes('kw-res') ? resTag : '', text, overload ? termHTML('폭주 가능') : ''].filter(Boolean).join(' ');
  const art = def.art ? ` style="background-image:url('${esc(def.art)}')"` : '';
  // 소멸 카드: 테두리가 보라색으로 흩어지고 위쪽에 모래시계 표식
  const hl = keywordNum(def, 'halfLife');
  const hlTag = hl ? `<div class="c-hl term" data-tip="${esc(TERM_TIP['소멸'])}">⏳ 소멸 ${hl}턴</div>` : '';
  return `<div class="card f-${def.faction} k-${kind} ${hl ? 'hl' : ''} ${o.cls ?? ''}" style="--gc:${groupColor(def.race)}" ${o.attrs ?? ''}>
    <div class="c-art${def.art ? ' has-art' : ''}"${art}>${def.art ? '' : `<span class="c-ph">${esc(def.race)}</span>`}</div>${hlTag}
    <div class="c-rail">${stat(`cost${cost < def.level ? ' down' : cost > def.level ? ' up' : ''}`, cost, '비용', `비용 ${cost}`)}<div class="c-stats">${stats}</div></div>
    <div class="c-body">
      <div class="c-name">${esc(def.name)}</div>
      <div class="c-type">${esc(def.race)} · ${KIND_LABEL[kind]}</div>
      ${body ? `<div class="c-text">${body}</div>` : ''}
    </div>${o.extra ?? ''}</div>`;
}

export const cardBackHTML = (cls = '', attrs = '') => `<div class="cardback ${cls}" ${attrs}><span>✦</span></div>`;
