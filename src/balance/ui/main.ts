import { CARDS } from '../../data/cards';
import type { CardDef, EffectDef, Faction } from '../../engine/types';
import { budgetOf, effectBody, fitStats, levelFor, scoreCard, triggerLabel } from '../score';
import { WEIGHTS } from '../weights';

// 카드 공방: 수치·능력을 손으로 넣으면 점수/레벨이 계산되는 편집기. 점수 로직은 score.ts를 그대로 쓴다.
// when: 능력이 발동하는 시점 (소환 / 연쇄 / 파괴 시 / 충전 시)
type When = 'play' | 'chain' | 'death' | 'charge';
type Fx = { op: string; n: number; a: number; h: number; when: When };
type Draft = {
  id: string; name: string; faction: Faction; race: string; element: string;
  level: number; atk: number; hp: number; upkeep: number; halfLife: number; armor: number; resist: number; charge: number; fx: Fx[]; desc: string; art?: string;
};
type Mode = 'stats' | 'level';

const OP_LABEL: Record<string, string> = {
  entropy: '상대 엔트로피 +', strikeOpposite: '맞은편 적 피해', draw: '드로우', gainPool: '자원 +', healSelf: '체력 회복', buffSelf: '자신 강화 (공/체)',
};
const FACTION_LABEL: Record<Faction, string> = { union: '반응성 연맹', covalent: '결속의 방벽', decay: '붕괴의 교단' };
const WEIGHTS_DEFAULT = structuredClone(WEIGHTS);
// 가중치 항목의 한글 이름과 설명 (경로는 weights.ts 키)
const WEIGHT_INFO: Record<string, [string, string]> = {
  maxLevel: ['최대 레벨', '카드 레벨 상한'],
  atk: ['공격력 1', '공격력 1을 몇 점으로 칠지'],
  hp: ['체력 1', '체력 1을 몇 점으로 칠지'],
  armor: ['방어력 1', '받는 전투 피해 -1의 점수'],
  resist: ['저항 1', '받는 능력·마법 피해 -1의 점수'],
  'op.entropy': ['상대 엔트로피 +1', '엔트로피 1을 올리는 효과의 점수'],
  'op.strikeOpposite': ['맞은편 피해 1', '맞은편 적에게 주는 피해 1의 점수'],
  'op.draw': ['드로우 1장', '카드 1장 드로우의 점수'],
  'op.gainPool': ['자원 +1', '자원 1을 얻는 효과의 점수'],
  'op.healSelf': ['회복 1', '자신 체력 1 회복의 점수'],
  chainFactor: ['연쇄 할인', '연쇄 조건 효과에 곱하는 배율 (1보다 작으면 싸짐)'],
  onDeathFactor: ['파괴 시 할인', '파괴 시 발동 효과에 곱하는 배율'],
  'chargeFactor.1': ['기력 1 배율', '기력 1 카드의 충전 시 효과 배율 (반복 발동이라 1보다 큼)'],
  'chargeFactor.2': ['기력 2 배율', '기력 2 카드의 충전 시 효과 배율'],
  'chargeFactor.3': ['기력 3 배율', '기력 3 카드의 충전 시 효과 배율'],
  'chargeFactor.4': ['기력 4+ 배율', '기력 4 이상 카드의 충전 시 효과 배율'],
  'halfLifeFactor.1': ['반감기 1턴', '반감기 1턴 카드의 스탯 배율'],
  'halfLifeFactor.2': ['반감기 2턴', '반감기 2턴 카드의 스탯 배율'],
  'halfLifeFactor.3': ['반감기 3턴', '반감기 3턴 카드의 스탯 배율'],
  'halfLifeFactor.4': ['반감기 4턴+', '반감기 4턴 이상 카드의 스탯 배율'],
  'budget.base': ['예산 기본값', '예산 = 기본값 + 레벨당 증가 × 레벨'],
  'budget.perLevel': ['레벨당 예산', '레벨이 1 오를 때 늘어나는 점수'],
  upkeepRebate: ['유지비 1당 예산', '유지비 1을 붙이면 늘어나는 예산'],
  maxUpkeep: ['유지비 상한', '카드에 붙일 수 있는 최대 유지비'],
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => n.toFixed(1);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
const ops = () => [...Object.keys(WEIGHTS.op), 'buffSelf'];

let mode: Mode = 'stats';
let d: Draft = { id: 'new_card', name: '새 카드', faction: 'union', race: '알칼리', element: 'Li', level: 1, atk: 1, hp: 2, upkeep: 0, halfLife: 0, armor: 0, resist: 0, charge: 0, fx: [], desc: '' };

const WHEN_TRIGGER: Record<When, EffectDef['trigger']> = { play: 'onPlay', chain: 'onPlay', death: 'onDeath', charge: 'onCharge' };
const fxDef = (f: Fx): EffectDef => ({
  trigger: WHEN_TRIGGER[f.when], op: f.op,
  args: f.op === 'buffSelf' ? { atk: f.a, hp: f.h } as Record<string, number> : { n: f.n },
  ...(f.when === 'chain' ? { chain: true } : {}),
});
const effectDefs = () => d.fx.map(fxDef);
function keywords(): string[] | undefined {
  const kw = [d.halfLife && `halfLife:${d.halfLife}`, d.armor && `armor:${d.armor}`, d.resist && `resist:${d.resist}`, d.charge && `charge:${d.charge}`].filter(Boolean) as string[];
  return kw.length ? kw : undefined;
}
const cardLike = () => ({ level: d.level, atk: d.atk, hp: d.hp, upkeep: d.upkeep, keywords: keywords(), effects: effectDefs() });
const otherPoints = () => scoreCard({ ...cardLike(), atk: 0, hp: 0 }).items.slice(1).reduce((a, b) => a + b.points, 0);

// 편집 후 레벨/수치를 모드에 맞게 다시 맞춘다. pin: 사용자가 방금 직접 바꾼 수치 (레벨 고정 모드에서 유지됨)
function rebalance(pin?: 'atk' | 'hp') {
  if (mode === 'stats') {
    d.level = levelFor(scoreCard(cardLike()).total, d.upkeep);
  } else {
    d.level = clampInt(d.level, 1, WEIGHTS.maxLevel);
    Object.assign(d, fitStats(d.level, d.upkeep, otherPoints(), d.halfLife || undefined, d, pin));
  }
}

function effectText(f: Fx): string {
  const e = fxDef(f);
  return `${triggerLabel(e)}: ${effectBody(e.op, e.args ?? {})}`;
}

// ── 편집 패널 (한 번만 만들고 값만 갱신한다) ──
const factionOpts = (Object.keys(FACTION_LABEL) as Faction[]).map((f) => `<option value="${f}">${FACTION_LABEL[f]}</option>`).join('');
$('#editor').innerHTML = `
  <h2>카드 정보</h2>
  <label>불러오기<select id="load"><option value="">기존 카드…</option>${CARDS.map((c) => `<option value="${c.id}">Lv${c.level} ${c.name}</option>`).join('')}</select></label>
  <label>이름<input data-f="name"></label>
  <label>진영<select data-f="faction">${factionOpts}</select></label>
  <label>종족<input data-f="race" list="races"></label>
  <label>원소<input data-f="element" list="elements"></label>
  <label>코드 id<input data-f="id"></label>
  <datalist id="races">${[...new Set(CARDS.map((c) => c.race))].map((r) => `<option value="${r}">`).join('')}</datalist>
  <datalist id="elements">${[...new Set(CARDS.map((c) => c.element))].map((r) => `<option value="${r}">`).join('')}</datalist>
  <label>일러스트<span class="row"><input type="file" id="artFile" accept="image/*"><button id="artClear" style="flex:none">제거</button></span></label>
  <h2 style="margin-top:14px">능력</h2>
  <div id="fx"></div>
  <button id="addFx" style="width:100%">+ 능력 추가</button>
  <h2 style="margin-top:14px">설명</h2>
  <textarea data-f="desc" rows="3" style="width:100%;resize:vertical" placeholder="카드 설명 (능력 아래에 표시)"></textarea>`;

// 스탯 패널: 입력칸이 있어 한 번만 만들고 값만 갱신한다 (다시 그리면 입력 중 포커스가 사라짐)
$('#side').innerHTML = `
  <section class="slim" id="statBox">
    <h2>스탯</h2>
    <div class="seg">
      <button data-mode="stats">레벨 자동</button>
      <button data-mode="level">레벨 고정</button>
    </div>
    <p class="hint" id="modeHint"></p>
    <div class="eq"><span>레벨</span>=<input type="number" data-f="level" min="1" max="${WEIGHTS.maxLevel}"></div>
    <div class="eq"><span>공격력</span>=<input type="number" data-f="atk" min="0"></div>
    <div class="eq"><span>체력</span>=<input type="number" data-f="hp" min="1"></div>
    <div class="eq" title="받는 전투 피해를 이만큼 줄입니다"><span>방어력</span>=<input type="number" data-f="armor" min="0"><small>전투 피해 −</small></div>
    <div class="eq" title="받는 능력·마법 피해를 이만큼 줄입니다"><span>저항</span>=<input type="number" data-f="resist" min="0"><small>능력 피해 −</small></div>
    <div class="eq" title="내 턴 시작·전투 생존마다 1씩 차고, 다 차면 '충전 시' 능력이 발동합니다 (0이면 없음)"><span>기력</span>=<input type="number" data-f="charge" min="0"><small>차면 충전 발동</small></div>
    <div class="eq"><span>유지비</span>=<input type="number" data-f="upkeep" min="0" max="${WEIGHTS.maxUpkeep}"><small>/턴</small></div>
    <div class="eq"><span>반감기</span>=<select data-f="halfLife"><option value="0">없음</option>${[1, 2, 3, 4].map((n) => `<option value="${n}">${n}턴</option>`).join('')}</select></div>
    <div class="gauge" id="gauge"><i></i></div>
    <div class="verdict" id="verdict"></div>
  </section>
  <div id="sideDyn" style="display:grid;gap:12px"></div>`;

function syncEditor() {
  const set = (f: string, v: string | number) => {
    const el = $<HTMLInputElement>(`[data-f="${f}"]`);
    if (el !== document.activeElement) el.value = String(v);
  };
  (['id', 'name', 'faction', 'race', 'element', 'level', 'atk', 'hp', 'upkeep', 'halfLife', 'armor', 'resist', 'charge', 'desc'] as const).forEach((f) => set(f, d[f]));
  $<HTMLInputElement>('[data-f="level"]').disabled = mode === 'stats';
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#modeHint').textContent = mode === 'stats'
    ? '숫자를 넣으면 필요한 레벨이 자동으로 정해집니다.'
    : '레벨을 정하면 공격력·체력이 예산에 맞춰집니다. 공격력을 바꾸면 체력이, 체력을 바꾸면 공격력이 따라 바뀝니다.';
}

const WHEN_LABEL: Record<When, string> = { play: '소환 시', chain: '연쇄 (이번 턴 연맹 유닛 소환 후)', death: '파괴 시', charge: '충전 시 (기력이 찰 때마다)' };

function renderFx() {
  $('#fx').innerHTML = d.fx.map((f, i) => `
    <div class="fx" data-i="${i}">
      <select data-k="op">${ops().map((o) => `<option value="${o}"${o === f.op ? ' selected' : ''}>${OP_LABEL[o] ?? o}</option>`).join('')}</select>
      ${f.op === 'buffSelf'
        ? `<span class="buff"><input type="number" data-k="a" value="${f.a}" min="0" title="공격력"><input type="number" data-k="h" value="${f.h}" min="0" title="체력"></span>`
        : `<input type="number" data-k="n" value="${f.n}" min="0">`}
      <button data-del="${i}">✕</button>
      <div class="flags">발동
        <select data-k="when">${(Object.entries(WHEN_LABEL) as [When, string][]).map(([w, l]) => `<option value="${w}"${w === f.when ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${f.when === 'charge' && !d.charge ? '<span class="pos">기력이 0이라 발동 안 함</span>' : ''}
      </div>
    </div>`).join('');
}

// ── 미리보기와 점수 패널 ──
function renderPreview() {
  const over = d.level > WEIGHTS.maxLevel;
  const lines = [
    d.halfLife ? `<div class="kw">반감기 ${d.halfLife}</div>` : '',
    ...d.fx.map((f) => `<div>${esc(effectText(f))}</div>`),
    d.desc ? `<div class="desc">${esc(d.desc)}</div>` : '',
  ].join('');
  $('#preview').innerHTML = `
    <h2>미리보기</h2>
    <div class="card ${d.faction}">
      <div class="top"><div class="lv${over ? ' over' : ''}" title="${over ? '최대 레벨 초과' : ''}">${over ? `${WEIGHTS.maxLevel}+` : d.level}</div>
        <div class="nm">${esc(d.name)}</div><div class="el">${esc(d.element)}</div></div>
      <div class="body">
        <div class="stats">
          <div class="stat atk" title="공격력"><small>공격</small>${d.atk}</div>
          <div class="stat hp" title="체력"><small>체력</small>${d.hp}</div>
          ${d.armor ? `<div class="stat arm" title="받는 전투 피해 -${d.armor}"><small>방어</small>${d.armor}</div>` : ''}
          ${d.resist ? `<div class="stat res" title="받는 능력·마법 피해 -${d.resist}"><small>저항</small>${d.resist}</div>` : ''}
          ${d.charge ? `<div class="stat chg" title="기력이 ${d.charge} 차면 충전 시 능력 발동"><small>기력</small>${d.charge}</div>` : ''}
          ${d.upkeep ? `<div class="stat upk" title="턴마다 내는 유지비"><small>유지</small>${d.upkeep}</div>` : ''}
        </div>
        <div class="main">
          <div class="art" id="art" style="${d.art ? `background-image:url(${d.art})` : ''}">
            ${d.art ? '' : `<span class="sym">${esc(d.element)}</span><span class="empty">클릭해서 일러스트 추가</span>`}</div>
          <div class="type"><span>${FACTION_LABEL[d.faction]}</span><span>${esc(d.race)}</span></div>
          <div class="rules">${lines || '<span style="color:#666">능력·설명 없음</span>'}</div>
        </div>
      </div>
    </div>`;
  $('#art').onclick = () => $<HTMLInputElement>('#artFile').click();
}

function tsSnippet(): string {
  const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`;
  const fxs = effectDefs().map((e) => {
    const args = Object.entries(e.args ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `{ trigger: ${q(e.trigger)}, op: ${q(e.op)}, args: { ${args} }${e.chain ? ', chain: true' : ''} }`;
  });
  const text = [d.halfLife ? `반감기 ${d.halfLife}` : '', d.armor ? `방어력 ${d.armor}` : '', d.resist ? `저항 ${d.resist}` : '', d.charge ? `기력 ${d.charge}` : '', ...d.fx.map(effectText), d.desc].filter(Boolean).join('. ');
  const extra = [
    d.upkeep ? `upkeep: ${d.upkeep}` : '',
    keywords() ? `keywords: [${keywords()!.map(q).join(', ')}]` : '',
    fxs.length ? `effects: [${fxs.join(', ')}]` : '',
    text ? `text: ${q(text)}` : '',
  ].filter(Boolean);
  return `u(${[q(d.id), q(d.name), q(d.faction), q(d.race), q(d.element), d.level, d.atk, d.hp].join(', ')}${extra.length ? `,\n    { ${extra.join(', ')} }` : ''}),`;
}

function weightLeaves(o: any, path: string[] = []): string[][] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? weightLeaves(v, [...path, k]) : [[...path, k]]));
}
const getW = (p: string[]) => p.reduce((o: any, k) => o[k], WEIGHTS) as number;
function setW(p: string[], v: number) {
  const o = p.slice(0, -1).reduce((x: any, k) => x[k], WEIGHTS);
  o[p[p.length - 1]] = v;
}

const openKeys = new Set<string>();

function renderSide() {
  const r = scoreCard(cardLike());
  const over = r.diff > 1e-9;
  const cls = over ? 'pos' : r.diff < -1.5 ? 'neg' : 'ok';
  const verdict = d.level > WEIGHTS.maxLevel ? `최대 레벨(${WEIGHTS.maxLevel}) 초과 — 수치나 능력을 줄이세요`
    : over ? `${fmt(r.diff)}점 초과 — 레벨 대비 강함`
    : r.diff < -1.5 ? `${fmt(-r.diff)}점 남음 — 약함` : `레벨에 맞음 (남은 예산 ${fmt(-r.diff)}점)`;
  $('#gauge').className = `gauge${over ? ' over' : ''}`;
  $('#gauge').firstElementChild!.setAttribute('style', `width:${Math.min(100, (r.total / r.budget) * 100)}%`);
  $('#verdict').className = `verdict ${cls}`;
  $('#verdict').textContent = `${fmt(r.total)} / ${fmt(r.budget)}점 · ${verdict}`;

  const rows = [...CARDS].sort((a, b) => a.level - b.level).map((c) => {
    const s = scoreCard(c);
    return `<tr class="click" data-load="${c.id}"><td>${esc(c.name)}</td><td>${c.level}</td>
      <td class="${s.diff > 1.5 ? 'pos' : s.diff < -1.5 ? 'neg' : 'ok'}">${s.diff > 0 ? '+' : ''}${fmt(s.diff)}</td></tr>`;
  }).join('');
  const open = (k: string) => (openKeys.has(k) ? ' open' : '');
  $('#sideDyn').innerHTML = `
    <section class="slim">
      <details data-k="score"${open('score')}><summary>점수 내역</summary>
        <table>${r.items.map((i) => `<tr><td>${esc(i.label)}</td><td>${fmt(i.points)}</td></tr>`).join('')}
          <tr><td>예산 (${WEIGHTS.budget.base} + ${WEIGHTS.budget.perLevel}×레벨${d.upkeep ? ` + ${WEIGHTS.upkeepRebate}×유지비` : ''})</td><td>${fmt(budgetOf(d.level, d.upkeep))}</td></tr></table>
      </details>
      <details data-k="export"${open('export')}><summary>저장 (cards.ts에 붙일 코드)</summary>
        <p class="hint">이 화면은 파일에 직접 저장하지 않습니다. 아래 코드를 복사해 <b>src/data/cards.ts</b>의 CARDS 목록에 붙여 넣으면 게임과 시뮬레이터에 반영됩니다.</p>
        <pre>${esc(tsSnippet())}</pre><button id="copySnippet">코드 복사</button></details>
      <details data-k="audit"${open('audit')}><summary>기존 카드 점검</summary>
        <p class="hint">차이 = 점수 − 예산. +면 레벨 대비 강함. 줄을 누르면 불러옵니다.</p>
        <div class="scroll"><table><tr><th>카드</th><th>Lv</th><th>차이</th></tr>${rows}</table></div></details>
      <details data-k="weights"${open('weights')}><summary>가중치 조정</summary>
        <p class="hint">카드 점수를 매기는 기준입니다. 여기서 바꾼 값은 이 화면에만 적용되고, 확정하려면 복사해서 src/balance/weights.ts에 반영해야 합니다.</p>
        ${weightLeaves(WEIGHTS).map((p) => {
          const [name, help] = WEIGHT_INFO[p.join('.')] ?? [p.join('.'), ''];
          return `<div class="w"><div><b>${name}</b><small>${help}</small></div><input type="number" step="0.1" data-w="${p.join('.')}" value="${getW(p)}"></div>`;
        }).join('')}
        <div class="row" style="margin-top:8px"><button id="copyW">값 복사</button><button id="resetW">초기화</button></div></details>
    </section>`;
}

function render() { syncEditor(); renderFx(); renderPreview(); renderSide(); }
function refresh(pin?: 'atk' | 'hp') { rebalance(pin); syncEditor(); renderPreview(); renderSide(); }

const kwNum = (c: CardDef, key: string) => Number(c.keywords?.find((k) => k.startsWith(key + ':'))?.split(':')[1] ?? 0);

function loadCard(c: CardDef) {
  d = {
    id: c.id, name: c.name, faction: c.faction, race: c.race, element: c.element, level: c.level,
    atk: c.atk, hp: c.hp, upkeep: c.upkeep ?? 0, desc: '',
    halfLife: kwNum(c, 'halfLife'), armor: kwNum(c, 'armor'), resist: kwNum(c, 'resist'), charge: kwNum(c, 'charge'),
    fx: (c.effects ?? []).map((e) => ({
      op: e.op, n: e.args?.n ?? 1, a: e.args?.atk ?? 0, h: e.args?.hp ?? 0,
      when: e.trigger === 'onDeath' ? 'death' : e.trigger === 'onCharge' ? 'charge' : e.chain ? 'chain' : 'play',
    })),
  };
  if (mode === 'stats') rebalance();
  render();
}

// ── 이벤트 ──
const editor = $('main');
editor.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === 'load') { const c = CARDS.find((x) => x.id === el.value); if (c) loadCard(c); el.value = ''; return; }
  if (el.id === 'artFile') {
    const file = el.files?.[0];
    if (file) { const fr = new FileReader(); fr.onload = () => { d.art = String(fr.result); renderPreview(); }; fr.readAsDataURL(file); }
    return;
  }
  const fxRow = el.closest<HTMLElement>('.fx');
  if (fxRow) {
    const f = d.fx[Number(fxRow.dataset.i)];
    const k = el.dataset.k!;
    if (k === 'op') f.op = el.value;
    else if (k === 'when') f.when = el.value as When;
    else (f as any)[k] = clampInt(Number(el.value), 0, 99);
    renderFx();
    refresh();
    return;
  }
  const field = el.dataset.f as keyof Draft | undefined;
  if (!field) return;
  if (['level', 'atk', 'hp', 'upkeep', 'halfLife', 'armor', 'resist', 'charge'].includes(field)) {
    const lo = field === 'hp' || field === 'level' ? 1 : 0;
    const hi = field === 'upkeep' ? WEIGHTS.maxUpkeep : field === 'level' ? WEIGHTS.maxLevel : field === 'halfLife' ? 4 : field === 'armor' || field === 'resist' || field === 'charge' ? 9 : 99;
    (d as any)[field] = clampInt(Number(el.value), lo, hi);
    if (field === 'charge') renderFx(); // '기력 0이라 발동 안 함' 안내 갱신
    refresh(field === 'atk' || field === 'hp' ? field : undefined);
  } else {
    (d as any)[field] = el.value;
    renderPreview();
  }
});
editor.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.f === 'name' || el.dataset.f === 'race' || el.dataset.f === 'element' || el.dataset.f === 'desc') { (d as any)[el.dataset.f] = el.value; renderPreview(); }
});
editor.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.dataset.mode) { mode = t.dataset.mode as Mode; refresh(); }
  else if (t.id === 'addFx') { d.fx.push({ op: 'entropy', n: 1, a: 1, h: 1, when: 'play' }); renderFx(); refresh(); }
  else if (t.dataset.del) { d.fx.splice(Number(t.dataset.del), 1); renderFx(); refresh(); }
  else if (t.id === 'artClear') { d.art = undefined; $<HTMLInputElement>('#artFile').value = ''; renderPreview(); }
});

const side = $('#side');
side.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement);
  const row = t.closest<HTMLElement>('[data-load]');
  if (row) { loadCard(CARDS.find((c) => c.id === row.dataset.load)!); return; }
  if (t.id === 'copySnippet') { navigator.clipboard?.writeText(tsSnippet()); t.textContent = '복사됨 — cards.ts에 붙여 넣으세요'; }
  else if (t.id === 'copyW') { navigator.clipboard?.writeText(JSON.stringify(WEIGHTS, null, 2)); t.textContent = '복사됨'; }
  else if (t.id === 'resetW') { Object.assign(WEIGHTS, structuredClone(WEIGHTS_DEFAULT)); refresh(); }
});
side.addEventListener('toggle', (ev) => {
  const el = ev.target as HTMLDetailsElement;
  if (el.dataset.k) el.open ? openKeys.add(el.dataset.k) : openKeys.delete(el.dataset.k);
}, true);
side.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (!el.dataset.w) return;
  setW(el.dataset.w.split('.'), Number(el.value));
  renderFx();
  refresh();
});

render();
