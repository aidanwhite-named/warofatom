import { effectBody, triggerLabel } from '../balance/score';
import { CARDS, getCard } from '../data/cards';
import { DECKS } from '../data/decks';
import { ELEMENTS } from '../data/elements';
import { FACTIONS } from '../data/factions';
import type { DeckSpec } from '../engine/game';
import type { CardDef, CardKind, Faction } from '../engine/types';
import { cardHTML, esc, KEYWORD_INFO, KIND_LABEL } from './cards';
import { sleep } from './fx';
import { startMatch } from './play';

// 계정: 지금은 관리자 한 명뿐. 관리자는 모든 계정의 덱을 보고 쓸 수 있다
type User = { name: string; role: 'admin' | 'player' };
const USER: User = { name: '관리자', role: 'admin' };

type DeckEntry = { key: string; name: string; owner: string; spec: DeckSpec };
const FACTION_KEYS = Object.keys(FACTIONS) as Faction[];
const ALL_DECKS: DeckEntry[] = FACTION_KEYS.map((f) => ({ key: f, name: `${FACTIONS[f].name} 기본 덱`, owner: 'system', spec: DECKS[f] }));
const visibleDecks = (u: User) => (u.role === 'admin' ? ALL_DECKS : ALL_DECKS.filter((d) => d.owner === u.name));

const FACTION_INFO: Record<Faction, string> = {
  union: '금화를 모아 싸고 많은 유닛을 연달아 낸다 (연쇄). 마법 카드와 원소 반응을 쓴다.',
  covalent: '턴마다 격자를 하나씩 쌓아 결합력을 늘리고, 단단한 유닛과 장착 아이템으로 후반을 노린다.',
  decay: '손패와 유닛을 붕괴해 붕괴열을 얻고 고레벨 유닛을 일찍 꺼낸다. 반감기 유닛과 계승을 쓴다.',
};

// 선택한 덱은 브라우저에 기억한다 (저장이 막혀 있으면 기본값)
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};
const selectedDeck = () => visibleDecks(USER).find((d) => d.key === store.get('woa.deck')) ?? visibleDecks(USER)[0];

const app = document.getElementById('app')!;
let leaveMatch: (() => void) | null = null;
let pending: { mine: DeckEntry; cpu: string } | null = null; // 로비에서 정한 대전 (cpu: 덱 key 또는 'random')

function shell(active: string, body: string) {
  const nav = [['#/', '메인'], ['#/decks', '덱'], ['#/cards', '카드 도감'], ['#/lobby', '대전']];
  return `<div class="shell"><header class="nav">
    <a class="logo" href="#/"><span>⚛</span> WAR OF ATOM</a>
    <nav>${nav.map(([h, l]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <span class="user">${esc(USER.name)}${USER.role === 'admin' ? '<b class="admin">ADMIN</b>' : ''}</span>
  </header><main>${body}</main></div>`;
}

function menuPage() {
  app.innerHTML = shell('#/', `<section class="hero">
    <div class="atom"><i style="--a:0deg"></i><i style="--a:60deg"></i><i style="--a:120deg"></i><b></b></div>
    <h1>WAR OF ATOM</h1>
    <p class="dim">원소의 전장 · 프로토타입</p>
    <div class="hero-btns">
      <a class="btn primary big" href="#/lobby">대전 시작</a>
      <a class="btn big" href="#/decks">덱 관리</a>
      <a class="btn big" href="#/cards">카드 도감</a>
    </div>
    <p class="dim">사용 중인 덱: <b>${esc(selectedDeck().name)}</b></p>
  </section>`);
}

function deckTile(d: DeckEntry, on: boolean, actions = true) {
  const defs = d.spec.cards.map(getCard);
  const curve = Array.from({ length: 9 }, (_, i) => defs.filter((c) => c.level === i + 1).length);
  const top = Math.max(...curve);
  const kinds = (k: CardKind) => defs.filter((c) => (c.kind ?? 'unit') === k).length;
  const extra = (['spell', 'item'] as CardKind[]).filter((k) => kinds(k)).map((k) => ` · ${KIND_LABEL[k]} ${kinds(k)}`).join('');
  return `<article class="deck f-${d.spec.faction} ${on ? 'on' : ''}">
    <div class="d-top"><span class="d-fac">${FACTIONS[d.spec.faction].name}</span>${on ? '<span class="tag">사용 중</span>' : ''}</div>
    <h3>${esc(d.name)}</h3>
    <p class="dim">${defs.length}장 · 유닛 ${kinds('unit')}${extra} · 소유자 ${esc(d.owner)}</p>
    <p class="d-info">${FACTION_INFO[d.spec.faction]}</p>
    <div class="curve">${curve.map((n, i) => `<div title="레벨 ${i + 1}: ${n}장"><i style="height:${(n / top) * 100}%"></i><span>${i + 1}</span></div>`).join('')}</div>
    ${actions ? `<div class="row"><a class="btn" href="#/deck/${d.key}">카드 보기</a><button class="btn primary" data-pick="${d.key}" ${on ? 'disabled' : ''}>${on ? '선택됨' : '이 덱 선택'}</button></div>` : ''}
  </article>`;
}

function bindPick() {
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => { store.set('woa.deck', b.dataset.pick!); route(); }));
}

function decksPage() {
  const admin = USER.role === 'admin';
  const sel = selectedDeck().key;
  app.innerHTML = shell('#/decks', `<div class="page-head"><h2>${admin ? '전체 덱' : '내 덱'}</h2>
      <p class="dim">${admin ? '관리자 권한: 모든 계정의 덱을 보고 대전에 쓸 수 있습니다.' : ''} 대전에 쓸 덱을 선택하세요.</p></div>
    <div class="deck-grid">${visibleDecks(USER).map((d) => deckTile(d, d.key === sel)).join('')}</div>`);
  bindPick();
}

function deckPage(key: string) {
  const d = visibleDecks(USER).find((x) => x.key === key);
  if (!d) { location.hash = '#/decks'; return; }
  const counts = new Map<string, number>();
  for (const id of d.spec.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  const defs = [...counts.keys()].map(getCard).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const on = selectedDeck().key === d.key;
  app.innerHTML = shell('#/decks', `<div class="page-head">
      <a href="#/decks" class="back">← 덱 목록</a>
      <h2>${esc(d.name)} <small class="dim">${d.spec.cards.length}장</small></h2>
      <p class="d-info">${FACTION_INFO[d.spec.faction]}</p>
      <div class="row narrow"><button class="btn primary" data-pick="${d.key}" ${on ? 'disabled' : ''}>${on ? '사용 중인 덱' : '이 덱 선택'}</button>
      <button class="btn" id="play-this">이 덱으로 대전</button></div></div>
    <div class="card-grid">${defs.map((c) => `<div class="cell" data-card="${c.id}">${cardHTML(c)}<span class="count">×${counts.get(c.id)}</span></div>`).join('')}</div>`);
  bindPick();
  app.querySelector('#play-this')!.addEventListener('click', () => { store.set('woa.deck', d.key); location.hash = '#/lobby'; });
  bindCardCells();
}

const filter = { faction: 'all', kind: 'all', level: 0, q: '' };

function cardsPage() {
  const opt = (v: string, l: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  app.innerHTML = shell('#/cards', `<div class="page-head"><h2>카드 도감 <small class="dim">전체 ${CARDS.length}장</small></h2></div>
    <div class="filters">
      <div class="seg">${[['all', '전체'], ...FACTION_KEYS.map((f) => [f, FACTIONS[f].name])].map(([v, l]) => `<button data-fac="${v}" class="${filter.faction === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="f-kind">${opt('all', '모든 종류', filter.kind)}${(Object.keys(KIND_LABEL) as CardKind[]).map((k) => opt(k, KIND_LABEL[k], filter.kind)).join('')}</select>
      <select id="f-level">${opt('0', '모든 레벨', String(filter.level))}${Array.from({ length: 9 }, (_, i) => opt(String(i + 1), `레벨 ${i + 1}`, String(filter.level))).join('')}</select>
      <input id="f-q" placeholder="이름·원소·종족 검색" value="${esc(filter.q)}">
    </div>
    <div class="card-grid" id="grid"></div>`);
  const grid = app.querySelector('#grid')!;
  const draw = () => {
    const q = filter.q.trim().toLowerCase();
    const list = CARDS.filter((c) =>
      (filter.faction === 'all' || c.faction === filter.faction) &&
      (filter.kind === 'all' || (c.kind ?? 'unit') === filter.kind) &&
      (!filter.level || c.level === filter.level) &&
      (!q || [c.name, c.element, c.race, c.id].some((s) => s.toLowerCase().includes(q))));
    grid.innerHTML = list.length ? list.map((c) => `<div class="cell" data-card="${c.id}">${cardHTML(c)}</div>`).join('') : '<p class="dim">조건에 맞는 카드가 없습니다.</p>';
    bindCardCells();
  };
  app.querySelectorAll<HTMLElement>('[data-fac]').forEach((b) => b.addEventListener('click', () => {
    filter.faction = b.dataset.fac!;
    app.querySelectorAll('[data-fac]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  app.querySelector<HTMLSelectElement>('#f-kind')!.addEventListener('change', (e) => { filter.kind = (e.target as HTMLSelectElement).value; draw(); });
  app.querySelector<HTMLSelectElement>('#f-level')!.addEventListener('change', (e) => { filter.level = Number((e.target as HTMLSelectElement).value); draw(); });
  app.querySelector<HTMLInputElement>('#f-q')!.addEventListener('input', (e) => { filter.q = (e.target as HTMLInputElement).value; draw(); });
  draw();
}

function bindCardCells() {
  app.querySelectorAll<HTMLElement>('[data-card]').forEach((c) => c.addEventListener('click', () => openCard(getCard(c.dataset.card!))));
}

// 카드 한 장 크게 보기
function openCard(c: CardDef) {
  const el = ELEMENTS.find((e) => e.symbol === c.element);
  const kws = (c.keywords ?? []).map((k) => {
    const [key, n] = k.split(':');
    const info = KEYWORD_INFO[key];
    return `<li><b>${info ? info[0] : key} ${n}</b> — ${info ? info[1].replace('N', n) : ''}</li>`;
  }).join('');
  const fx = (c.effects ?? []).map((e) => `<li><b>${c.kind === 'spell' && e.trigger === 'onPlay' && !e.chain ? '사용' : triggerLabel(e)}</b> — ${effectBody(e.op, e.args ?? {})}</li>`).join('');
  const inDecks = ALL_DECKS.map((d) => [d, d.spec.cards.filter((x) => x === c.id).length] as const).filter(([, n]) => n > 0);
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box">
    <button class="x" aria-label="닫기">✕</button>
    <div class="modal-card">${cardHTML(c, { cls: 'big' })}</div>
    <div class="modal-info">
      <h2>${esc(c.name)}</h2><p class="dim">${esc(c.id)}</p>
      <table>
        ${row('진영', FACTIONS[c.faction].name)}
        ${row('종류', KIND_LABEL[c.kind ?? 'unit'])}
        ${row('레벨 / 비용', `${c.level}`)}
        ${c.kind === 'spell' ? '' : row(c.kind === 'item' ? '장착 보너스' : '공격 / 체력', `${c.atk} / ${c.hp}`)}
        ${row('종족', esc(c.race))}
        ${row('원소', `${esc(c.element)}${el ? ` (${el.name}, ${el.period}주기, ${el.group})` : ''}`)}
        ${c.upkeep ? row('유지비', String(c.upkeep)) : ''}
      </table>
      ${kws ? `<h4>키워드</h4><ul>${kws}</ul>` : ''}
      ${fx ? `<h4>능력</h4><ul>${fx}</ul>` : ''}
      <h4>수록 덱</h4>
      <p>${inDecks.length ? inDecks.map(([d, n]) => `${esc(d.name)} ×${n}`).join('<br>') : '<span class="dim">기본 덱에 없음 (카드 풀 전용)</span>'}</p>
    </div></div>`;
  const close = () => { m.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  m.addEventListener('click', (e) => { if (e.target === m || (e.target as HTMLElement).closest('.x')) close(); });
  window.addEventListener('keydown', onKey);
  document.body.append(m);
}

function lobbyPage() {
  const admin = USER.role === 'admin';
  const mine = selectedDeck();
  const opts = visibleDecks(USER).map((d) => `<option value="${d.key}" ${d.key === mine.key ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  app.innerHTML = shell('#/lobby', `<div class="page-head"><h2>대전</h2></div>
    <div class="lobby">
      <section class="box"><h3>내 덱</h3><select id="my-deck">${opts}</select><div id="my-tile"></div></section>
      <section class="box"><h3>상대</h3>
        ${admin ? `<label>컴퓨터 덱<select id="cpu-deck"><option value="random">무작위</option>${ALL_DECKS.map((d) => `<option value="${d.key}">${esc(d.name)}</option>`).join('')}</select></label>
        <p class="dim">관리자는 컴퓨터가 쓸 덱을 직접 고를 수 있습니다.</p>` : ''}
        <p class="dim">대전 찾기로 온라인 상대를 찾고, 상대가 없으면 컴퓨터와 대전합니다. 선공·후공은 동전 던지기로 정합니다.</p>
        <div class="lobby-btns"><button class="btn primary big" id="find">대전 찾기</button><button class="btn big" id="cpu">컴퓨터와 바로 대전</button></div>
      </section>
    </div>`);
  const tile = () => { app.querySelector('#my-tile')!.innerHTML = deckTile(selectedDeck(), true, false); };
  app.querySelector<HTMLSelectElement>('#my-deck')!.addEventListener('change', (e) => { store.set('woa.deck', (e.target as HTMLSelectElement).value); tile(); });
  tile();
  const go = () => {
    pending = { mine: selectedDeck(), cpu: app.querySelector<HTMLSelectElement>('#cpu-deck')?.value ?? 'random' };
    location.hash = '#/play';
  };
  app.querySelector('#cpu')!.addEventListener('click', go);
  app.querySelector('#find')!.addEventListener('click', () => void matchmaking(go));
}

// 대전 찾기. 아직 온라인 서버가 없어서 잠시 찾은 뒤 컴퓨터 대전으로 넘어간다
async function matchmaking(go: () => void) {
  const ov = document.createElement('div');
  ov.className = 'modal mm';
  ov.innerHTML = `<div class="mm-box">
    <div class="atom small"><i style="--a:0deg"></i><i style="--a:60deg"></i><i style="--a:120deg"></i><b></b></div>
    <h3>상대를 찾는 중…</h3><p class="dim" id="mm-t">0초</p><button class="btn" id="mm-x">취소</button></div>`;
  document.body.append(ov);
  let cancelled = false;
  ov.querySelector('#mm-x')!.addEventListener('click', () => { cancelled = true; ov.remove(); });
  for (let t = 1; t <= 3 && !cancelled; t++) { await sleep(1000); ov.querySelector('#mm-t')!.textContent = `${t}초`; }
  if (cancelled) return;
  ov.querySelector('h3')!.textContent = '대기 중인 상대가 없습니다';
  ov.querySelector('#mm-t')!.textContent = '온라인 대전 서버가 아직 없어 컴퓨터(AI)와 대전합니다';
  ov.querySelector('#mm-x')!.remove();
  await sleep(1500);
  ov.remove();
  if (!cancelled) go();
}

function playPage() {
  if (!pending) { location.hash = '#/lobby'; return; }
  const { mine, cpu } = pending;
  const foe = cpu === 'random' ? ALL_DECKS[Math.floor(Math.random() * ALL_DECKS.length)] : ALL_DECKS.find((d) => d.key === cpu)!;
  app.innerHTML = '';
  leaveMatch = startMatch(app, {
    mine: mine.spec, foe: foe.spec, myName: USER.name, foeName: '컴퓨터', admin: USER.role === 'admin',
    onExit(rematch) {
      if (rematch) { leaveMatch?.(); playPage(); } else location.hash = '#/';
    },
  });
}

function route() {
  leaveMatch?.();
  leaveMatch = null;
  document.querySelectorAll('.modal').forEach((m) => m.remove());
  const [page, arg] = location.hash.replace(/^#\/?/, '').split('/');
  switch (page) {
    case 'decks': return decksPage();
    case 'deck': return deckPage(arg);
    case 'cards': return cardsPage();
    case 'lobby': return lobbyPage();
    case 'play': return playPage();
    default: return menuPage();
  }
}

window.addEventListener('hashchange', route);
route();
