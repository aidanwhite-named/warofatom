import { effectBody, triggerLabel } from '../balance/score';
import { BASE_CARDS, CARDS, getCard } from '../data/cards';
import { DECK_LIST } from '../data/decks';
import { ASPECT_LABEL, getLand } from '../data/lands';
import { FACTION_RACES, FACTIONS } from '../data/factions';
import { BALANCE } from '../engine/config';
import { FACTION_KINDS, validateDeck, type DeckSpec } from '../engine/game';
import type { CardDef, CardKind, Faction } from '../engine/types';
import { cardHTML, esc, groupColor, KEYWORD_INFO, KIND_LABEL } from './cards';
import { sleep } from './fx';
import { startMatch } from './play';

// 선택한 덱은 브라우저에 기억한다 (저장이 막혀 있으면 기본값)
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

// 계정: 지금은 관리자 한 명뿐. 관리자는 모든 계정의 덱을 보고 쓸 수 있다
type User = { name: string; role: 'admin' | 'player' };
const USER: User = { name: '관리자', role: 'admin' };

// races: 덱의 주력 종족. 세력을 먼저 고르고, 그 안에서 종족 조합으로 덱을 고른다
type DeckEntry = { key: string; name: string; owner: string; races: string[]; spec: DeckSpec };
const FACTION_KEYS = Object.keys(FACTIONS) as Faction[];
const PRESETS: DeckEntry[] = DECK_LIST.map((d) => ({ ...d, owner: 'system' }));
for (const d of PRESETS) { const e = validateDeck(d.spec); if (e.length) console.warn(d.name, e); }
// 내가 만든 덱: 브라우저에 저장한다 (카드 id 목록)
type SavedDeck = { key: string; name: string; faction: Faction; cards: string[] };
const loadSaved = (): SavedDeck[] => { try { return (JSON.parse(store.get('woa.myDecks') ?? '[]') as SavedDeck[]).filter((d) => d.cards.every((id) => { try { getCard(id); return true; } catch { return false; } })); } catch { return []; } };
const saveSaved = (list: SavedDeck[]) => { store.set('woa.myDecks', JSON.stringify(list)); refreshDecks(); };
let ALL_DECKS: DeckEntry[] = [];
function refreshDecks() {
  ALL_DECKS = [...PRESETS, ...loadSaved().map((d): DeckEntry => ({ key: d.key, name: d.name, owner: USER.name, races: [], spec: { faction: d.faction, cards: d.cards } }))];
}
const guestCount = (d: DeckEntry) => d.spec.cards.filter((id) => getCard(id).faction !== d.spec.faction).length;
const raceChips = (races: string[]) => races.map((r) => `<span class="race" style="--gc:${groupColor(r)}">${esc(r)}</span>`).join('');
// 덱 선택 목록 (세력별로 묶음)
const deckOptions = (decks: DeckEntry[], cur: string) => FACTION_KEYS.map((f) => `<optgroup label="${FACTIONS[f].name}">${decks.filter((d) => d.spec.faction === f).map((d) => `<option value="${d.key}" ${d.key === cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`).join('');
const visibleDecks = (u: User) => (u.role === 'admin' ? ALL_DECKS : ALL_DECKS.filter((d) => d.owner === u.name));

const FACTION_INFO: Record<Faction, string> = {
  union: '금화로 싸고 많은 유닛을 연달아 부른다 (연쇄). 주문 카드와, 점령한 대지 둘을 엮는 융합 주문을 쓴다.',
  covalent: '베이스로 신앙을 늘리고, 점령한 대지 2곳마다 유닛이 강해진다(결속). 단단한 유닛과 장비로 후반을 노린다. 적이 버티고 있어도 땅을 지켜 점령한다.',
  decay: '손패와 유닛을 제물로 바쳐 영혼을 얻고 고레벨 유닛을 일찍 꺼낸다. 소멸하는 유닛과 빙의, 저주받은 땅의 타락을 쓴다.',
};

const selectedDeck = () => visibleDecks(USER).find((d) => d.key === store.get('woa.deck')) ?? visibleDecks(USER)[0];

refreshDecks();
const app = document.getElementById('app')!;
let leaveMatch: (() => void) | null = null;
let pending: { mine: DeckEntry; cpu: string } | null = null; // 로비에서 정한 대전 (cpu: 덱 key 또는 'random')

function shell(active: string, body: string) {
  const nav = [['#/', '메인'], ['#/decks', '덱'], ['#/cards', '카드 도감'], ['#/lobby', '대전']];
  return `<div class="shell"><header class="nav">
    <a class="logo" href="#/"><span>✦</span> AETHELGARD</a>
    <nav>${nav.map(([h, l]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <span class="user">${esc(USER.name)}${USER.role === 'admin' ? '<b class="admin">ADMIN</b>' : ''}</span>
  </header><main>${body}</main></div>`;
}

function menuPage() {
  app.innerHTML = shell('#/', `<section class="hero">
    <div class="crest"><i style="--a:-90deg;--c:var(--union)"></i><i style="--a:30deg;--c:var(--covalent)"></i><i style="--a:150deg;--c:var(--decay)"></i><b>✦</b></div>
    <h1>AETHELGARD</h1>
    <p class="dim">마탑 · 기사단 · 교단, 세 세력의 전쟁 · 프로토타입</p>
    <div class="hero-btns">
      <a class="btn primary big" href="#/lobby">대전 시작</a>
      <a class="btn big" href="#/decks">덱 관리</a>
      <a class="btn big" href="#/cards">카드 도감</a>
    </div>
    <p class="dim">사용 중인 덱: <b>${FACTIONS[selectedDeck().spec.faction].short} · ${esc(selectedDeck().name)}</b></p>
  </section>`);
}

function deckTile(d: DeckEntry, on: boolean, actions = true) {
  const defs = d.spec.cards.map(getCard);
  const baseN = defs.filter((c) => c.kind === 'base').length;
  const curve = Array.from({ length: 9 }, (_, i) => defs.filter((c) => c.level === i + 1).length);
  const top = Math.max(...curve);
  const kinds = (k: CardKind) => defs.filter((c) => (c.kind ?? 'unit') === k).length;
  const extra = (['spell', 'item'] as CardKind[]).filter((k) => kinds(k)).map((k) => ` · ${KIND_LABEL[k]} ${kinds(k)}`).join('');
  const guests = guestCount(d);
  const mixed = d.races.length === FACTION_RACES[d.spec.faction].length;
  return `<article class="deck f-${d.spec.faction} ${on ? 'on' : ''}">
    <div class="d-top"><span class="d-fac">${FACTIONS[d.spec.faction].name}</span>${on ? '<span class="tag">사용 중</span>' : ''}${d.owner !== 'system' ? '<span class="tag">내 덱</span>' : ''}</div>
    <h3>${esc(d.name)}</h3>
    <div class="races">${!d.races.length ? '<span class="dim">직접 구성</span>' : mixed ? '<span class="dim">네 종족 혼합</span>' : raceChips(d.races)}${guests ? `<span class="tag guest" title="다른 세력 카드: 색 아이콘 하나당 비용 +1">객원 ${guests}장</span>` : ''}</div>
    <p class="dim">${defs.length}장 · 유닛 ${kinds('unit')}${extra} · 베이스 ${baseN} · 소유자 ${esc(d.owner)}</p>
    <p class="d-info">${FACTION_INFO[d.spec.faction]}</p>
    <div class="curve">${curve.map((n, i) => `<div title="레벨 ${i + 1}: ${n}장"><i style="height:${(n / top) * 100}%"></i><span>${i + 1}</span></div>`).join('')}</div>
    ${actions ? `<div class="row"><a class="btn" href="#/deck/${d.key}">카드 보기</a><a class="btn" href="#/edit/${d.key}">${d.owner === 'system' ? '복사해서 편집' : '편집'}</a><button class="btn primary" data-pick="${d.key}" ${on ? 'disabled' : ''}>${on ? '선택됨' : '이 덱 선택'}</button></div>` : ''}
  </article>`;
}

function bindPick() {
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => { store.set('woa.deck', b.dataset.pick!); route(); }));
}

function decksPage() {
  const admin = USER.role === 'admin';
  const sel = selectedDeck().key;
  app.innerHTML = shell('#/decks', `<div class="page-head"><h2>${admin ? '전체 덱' : '내 덱'}</h2>
      <p class="dim">${admin ? '관리자 권한: 모든 계정의 덱을 보고 대전에 쓸 수 있습니다.' : ''} 대전에 쓸 덱을 선택하거나 직접 꾸려 보세요. 덱은 ${BALANCE.deck.size}~${BALANCE.deck.maxTotal}장이고 베이스 카드는 장수 제한이 없습니다.</p></div>
    ${FACTION_KEYS.map((f) => `<section class="fac-group f-${f}"><h3 class="fac-title">${FACTIONS[f].name} <small class="dim">${FACTIONS[f].motto}</small> <a class="btn small" href="#/edit/new-${f}">＋ 새 덱</a></h3>
      <div class="fac-races">${raceChips(FACTION_RACES[f])}</div>
      <div class="deck-grid">${visibleDecks(USER).filter((d) => d.spec.faction === f).map((d) => deckTile(d, d.key === sel)).join('')}</div></section>`).join('')}`);
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
    <div class="card-grid">${defs.map((c) => `<div class="cell" data-card="${c.id}">${cardHTML(c)}<span class="count">×${counts.get(c.id)}</span>${c.faction !== d.spec.faction ? `<span class="guest-tag" title="${FACTIONS[c.faction].name} 카드: 색 아이콘 하나당 비용 +1">객원</span>` : ''}</div>`).join('')}</div>`);
  bindPick();
  app.querySelector('#play-this')!.addEventListener('click', () => { store.set('woa.deck', d.key); location.hash = '#/lobby'; });
  bindCardCells();
}

// ── 덱 편집 ──
// 카드 풀: 내 세력 카드 전부 + 베이스, 객원으로 쓸 수 있는 다른 세력 카드 (규칙은 validateDeck)
function editPage(arg: string) {
  const src = ALL_DECKS.find((d) => d.key === arg);
  const fresh = arg.startsWith('new-');
  const faction = (fresh ? arg.slice(4) : src?.spec.faction) as Faction | undefined;
  if (!faction || !FACTIONS[faction]) { location.hash = '#/decks'; return; }
  const mine = !!src && src.owner !== 'system';
  const key = mine ? src!.key : `my-${Date.now().toString(36)}`;
  let name = fresh ? '새 덱' : mine ? src!.name : `${src!.name} (복사)`;
  const counts = new Map<string, number>();
  for (const id of src?.spec.cards ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const baseDef = BASE_CARDS.find((c) => c.faction === faction)!;
  const pool = [baseDef, ...CARDS.filter((c) => c.faction === faction), ...CARDS.filter((c) => c.faction !== faction && FACTION_KINDS[faction].includes(c.kind ?? 'unit'))];
  const view = { guests: false, kind: 'all', q: '' };
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  const spec = (): DeckSpec => ({ faction, cards: [...counts].flatMap(([id, n]) => Array<string>(n).fill(id)) });

  app.innerHTML = shell('#/decks', `<div class="page-head"><a href="#/decks" class="back">← 덱 목록</a>
      <h2>${FACTIONS[faction].name} 덱 편집</h2></div>
    <div class="editor">
      <div class="ed-bar">
        <label>덱 이름 <input id="ed-name" value="${esc(name)}" maxlength="24"></label>
        <span id="ed-sum" class="ed-sum"></span>
        <button class="btn primary" id="ed-save">저장</button>
        ${mine ? '<button class="btn" id="ed-del">삭제</button>' : ''}
      </div>
      <ul id="ed-err" class="ed-err"></ul>
      <div class="filters">
        <div class="seg"><button data-g="0" class="on">${FACTIONS[faction].short} 카드</button><button data-g="1">객원 (다른 세력 유닛)</button></div>
        <select id="ed-kind"><option value="all">모든 종류</option>${(Object.keys(KIND_LABEL) as CardKind[]).map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('')}</select>
        <input id="ed-q" placeholder="이름·종족 검색">
      </div>
      <div class="card-grid" id="ed-grid"></div>
    </div>`);

  const sum = app.querySelector('#ed-sum')!, errBox = app.querySelector('#ed-err')!, saveBtn = app.querySelector<HTMLButtonElement>('#ed-save')!;
  const refresh = () => {
    const errors = validateDeck(spec());
    const baseN = counts.get(baseDef.id) ?? 0;
    sum.innerHTML = `<b>${total()}</b> / ${BALANCE.deck.maxTotal}장 (최소 ${BALANCE.deck.size}) · 베이스 <b>${baseN}</b> · 그 밖 ${total() - baseN}`;
    errBox.innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
    saveBtn.disabled = errors.length > 0;
    app.querySelectorAll<HTMLElement>('[data-id]').forEach((cell) => {
      const id = cell.dataset.id!, n = counts.get(id) ?? 0, def = getCard(id);
      cell.querySelector('.count')!.textContent = `×${n}`;
      cell.classList.toggle('in', n > 0);
      cell.querySelector<HTMLButtonElement>('[data-d="-1"]')!.disabled = n === 0;
      cell.querySelector<HTMLButtonElement>('[data-d="1"]')!.disabled = total() >= BALANCE.deck.maxTotal || (def.kind !== 'base' && n >= BALANCE.deck.copies);
    });
  };
  const grid = app.querySelector('#ed-grid')!;
  const draw = () => {
    const q = view.q.trim().toLowerCase();
    const list = pool.filter((c) => (view.guests ? c.faction !== faction : c.faction === faction) &&
      (view.kind === 'all' || (c.kind ?? 'unit') === view.kind) && (!q || [c.name, c.race].some((s) => s.toLowerCase().includes(q))));
    grid.innerHTML = list.length ? list.map((c) => `<div class="cell ed" data-id="${c.id}">${cardHTML(c)}<span class="count"></span>
      <div class="ed-ctrl"><button class="btn small" data-d="-1">−</button><button class="btn small" data-d="1">＋</button></div></div>`).join('') : '<p class="dim">조건에 맞는 카드가 없습니다.</p>';
    grid.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const id = b.closest<HTMLElement>('[data-id]')!.dataset.id!, n = (counts.get(id) ?? 0) + Number(b.dataset.d);
      if (n <= 0) counts.delete(id); else counts.set(id, n);
      refresh();
    }));
    grid.querySelectorAll<HTMLElement>('.cell .card').forEach((c) => c.addEventListener('click', () => openCard(getCard(c.closest<HTMLElement>('[data-id]')!.dataset.id!))));
    refresh();
  };
  app.querySelector<HTMLInputElement>('#ed-name')!.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
  app.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => b.addEventListener('click', () => {
    view.guests = b.dataset.g === '1';
    app.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  app.querySelector<HTMLSelectElement>('#ed-kind')!.addEventListener('change', (e) => { view.kind = (e.target as HTMLSelectElement).value; draw(); });
  app.querySelector<HTMLInputElement>('#ed-q')!.addEventListener('input', (e) => { view.q = (e.target as HTMLInputElement).value; draw(); });
  saveBtn.addEventListener('click', () => {
    const list = loadSaved().filter((d) => d.key !== key);
    list.push({ key, name: name.trim() || '이름 없는 덱', faction, cards: spec().cards });
    saveSaved(list);
    store.set('woa.deck', key);
    location.hash = '#/decks';
  });
  app.querySelector('#ed-del')?.addEventListener('click', () => {
    if (!confirm('이 덱을 삭제할까요?')) return;
    saveSaved(loadSaved().filter((d) => d.key !== key));
    location.hash = '#/decks';
  });
  draw();
}

const filter = { faction: 'all', kind: 'all', level: 0, q: '' };

function cardsPage() {
  const opt = (v: string, l: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  app.innerHTML = shell('#/cards', `<div class="page-head"><h2>카드 도감 <small class="dim">전체 ${CARDS.length}장</small></h2></div>
    <div class="filters">
      <div class="seg">${[['all', '전체'], ...FACTION_KEYS.map((f) => [f, FACTIONS[f].name])].map(([v, l]) => `<button data-fac="${v}" class="${filter.faction === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="f-kind">${opt('all', '모든 종류', filter.kind)}${(Object.keys(KIND_LABEL) as CardKind[]).map((k) => opt(k, KIND_LABEL[k], filter.kind)).join('')}</select>
      <select id="f-level">${opt('0', '모든 레벨', String(filter.level))}${Array.from({ length: 9 }, (_, i) => opt(String(i + 1), `레벨 ${i + 1}`, String(filter.level))).join('')}</select>
      <input id="f-q" placeholder="이름·대지·종족 검색" value="${esc(filter.q)}">
    </div>
    <div class="card-grid" id="grid"></div>`);
  const grid = app.querySelector('#grid')!;
  const draw = () => {
    const q = filter.q.trim().toLowerCase();
    const list = CARDS.filter((c) =>
      (filter.faction === 'all' || c.faction === filter.faction) &&
      (filter.kind === 'all' || (c.kind ?? 'unit') === filter.kind) &&
      (!filter.level || c.level === filter.level) &&
      (!q || [c.name, c.land ? getLand(c.land).name : '', c.race, c.id].some((s) => s.toLowerCase().includes(q))));
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
  const land = c.land ? getLand(c.land) : null;
  const kws = (c.keywords ?? []).map((k) => {
    const [key, n] = k.split(':');
    const info = KEYWORD_INFO[key];
    return `<li><b>${info ? info[0] : key} ${n}</b> — ${info ? info[1].replace('N', n) : ''}</li>`;
  }).join('');
  const fx = (c.effects ?? []).map((e) => `<li><b>${c.kind === 'spell' && e.trigger === 'onPlay' && !e.chain ? '시전' : triggerLabel(e)}</b> — ${effectBody(e.op, e.args ?? {})}</li>`).join('');
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
        ${row('연고 대지', land ? `${esc(land.name)} <span class="dim">(${land.race}의 땅, ${land.tier}등급, ${ASPECT_LABEL[land.aspect]})</span>` : '<span class="dim">없음</span>')}
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
  const opts = deckOptions(visibleDecks(USER), mine.key);
  app.innerHTML = shell('#/lobby', `<div class="page-head"><h2>대전</h2></div>
    <div class="lobby">
      <section class="box"><h3>내 덱</h3><select id="my-deck">${opts}</select><div id="my-tile"></div>
        <p class="dim"><a href="#/decks">덱 관리</a>에서 베이스·카드 구성을 직접 바꿀 수 있습니다.</p>
</section>
      <section class="box"><h3>상대</h3>
        ${admin ? `<label>컴퓨터 덱<select id="cpu-deck"><option value="random">무작위</option>${deckOptions(ALL_DECKS, '')}</select></label>
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
    <div class="crest small"><b>✦</b></div>
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
    case 'edit': return editPage(arg);
    case 'cards': return cardsPage();
    case 'lobby': return lobbyPage();
    case 'play': return playPage();
    default: return menuPage();
  }
}

window.addEventListener('hashchange', route);
route();
