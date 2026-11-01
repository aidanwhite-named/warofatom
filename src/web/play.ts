import { getCard } from '../data/cards';
import { ASPECT_LABEL, getLand } from '../data/lands';
import { FACTIONS } from '../data/factions';
import { BALANCE } from '../engine/config';
import { applyAction, canAttack, costOf, createGame, foreignTax, isLocked, landHoldValue, legalActions, levelCap, reducedDamage, type DeckSpec } from '../engine/game';
import { decayGain } from '../engine/resources';
import type { Action, CardDef, EntropyCause, Faction, GameEvent, GameState, PlayerState, Unit } from '../engine/types';
import { LANES } from '../engine/types';
import { chooseAction } from '../sim/bot';
import { cardBackHTML, cardHTML, esc, groupColor, termHTML } from './cards';
import { anim, Fx, sleep } from './fx';

// 대전 화면. 엔진(applyAction)이 남긴 이벤트 로그를 순서대로 연출한 뒤 새 상태를 그린다.
//   그리기 전 연출: 공격·파괴·파멸 등 (이전 화면 위에서)
//   그린 뒤 연출: uid 비교로 새로 생긴 손패·유닛을 이전 위치(덱·손패)에서 날아오게 한다 (FLIP)

export type MatchOpts = { mine: DeckSpec; foe: DeckSpec; myName: string; foeName: string; admin: boolean; onExit(rematch: boolean): void };

type Side = 'me' | 'foe';
type Sel = { k: 'hand'; uid: number } | { k: 'unit'; uid: number; heir?: boolean } | { k: 'el'; picked: number[] } | null;

const STAGE_W = 1280, STAGE_H = 760;
const COLOR: Record<Faction, string> = { union: '#ff9d4d', covalent: '#5aa8ff', decay: '#b483ff' };
const ICON: Record<Faction, string> = { union: '🔥', covalent: '✠', decay: '☾' };
const REASON = { combat: '전투', halfLife: '소멸', decay: '제물', effect: '효과', upkeep: '유지비' };
const CAUSE: Record<EntropyCause, string> = { natural: '시간의 흐름', attack: '공격', effect: '효과', fatigue: '덱 고갈', overload: '폭주', idle: '방치', shuffle: '셔플', borrow: '선불 상환', land: '대지' };
const LAND_FX_COLOR = { light: '#ffe9a8', shadow: '#8f7dff', sealed: '#b483ff' };

// 대지 보유 효과 설명 (short: 대지 칸에 쓰는 짧은 글, long: 마우스를 올리면 보이는 글)
function landFx(key: string) {
  const n = landHoldValue(key), aspect = getLand(key).aspect;
  if (aspect === 'light') return { short: `회복 ${n}`, long: `보유 효과: 내 턴 시작마다 다친 내 유닛 중 체력이 가장 낮은 유닛 체력 +${n}` };
  if (aspect === 'shadow') return { short: `피해 ${n}`, long: `보유 효과: 내 턴 시작마다 공격력이 가장 높은 적에게 ${n} 피해 (저항 적용)` };
  return { short: `파멸 +${n}`, long: `보유 효과: 내 턴 시작마다 상대 파멸 +${n}` };
}

export function startMatch(root: HTMLElement, o: MatchOpts): () => void {
  const m = new Match(root, o);
  void m.begin();
  return () => m.dispose();
}

class Match {
  private s: GameState;
  private readonly h: 0 | 1; // 내 플레이어 번호 (0이면 선공)
  private busy = true; // 연출 중이거나 상대 턴
  private ended = false; // 게임 끝
  private done = false; // 화면을 떠남
  private sel: Sel = null;
  private legal: Action[] = [];
  private turnNo = 0;
  private logLines: string[] = [];
  private logOpen = false;
  private reveal = false; // 관리자: 상대 손패 공개
  private flown = new Set<string>(); // 낸 유닛 카드가 이미 연출로 날아간 칸 (그린 뒤 FLIP을 건너뛴다)
  private hurt = new Set<number>(); // 피해를 전투 중에 이미 보여 준 유닛 uid (그린 뒤 피해 숫자를 다시 띄우지 않는다)
  private shown: Partial<Record<Side, number>> = {}; // 자원 칸에 지금 보이는 값 (연출로 센 값)
  private dropRect: { uid: number; rect: DOMRect } | null = null; // 끌어다 놓은 카드의 마지막 위치
  private drag: { uid: number; x0: number; y0: number; ghost?: HTMLElement } | null = null;
  private suppressClick = false;
  private readonly stage: HTMLElement;
  private readonly view: HTMLElement;
  private readonly fx: Fx;

  constructor(root: HTMLElement, private readonly o: MatchOpts) {
    this.h = Math.random() < 0.5 ? 0 : 1;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    this.s = this.h === 0 ? createGame(o.mine, o.foe, seed) : createGame(o.foe, o.mine, seed);
    root.innerHTML = `<div class="stage-wrap"><div class="stage"><div class="view"></div><div class="fx-layer"></div></div></div>`;
    this.stage = root.querySelector('.stage')!;
    this.view = root.querySelector('.view')!;
    this.fx = new Fx(this.stage, root.querySelector('.fx-layer')!);
    window.addEventListener('resize', this.fit);
    window.addEventListener('keydown', this.onKey);
    this.view.addEventListener('click', (e) => this.onClick(e));
    this.view.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.view.addEventListener('mouseover', (e) => this.onHover(e));
    this.fit();
  }

  dispose() {
    this.done = true;
    window.removeEventListener('resize', this.fit);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  // 시작: 빈 손으로 그린 뒤 동전 던지기 → 시작 손패를 덱에서 나눠 준다 → 첫 턴 표시
  async begin() {
    const real = this.s;
    const pre = structuredClone(real);
    for (const p of pre.players) { p.deck = [...p.hand, ...p.deck]; p.hand = []; }
    this.s = pre;
    this.render();
    await this.fx.banner(this.h === 0 ? '선공' : '후공', this.h === 0 ? '동전 던지기 결과: 당신이 먼저 시작합니다' : '동전 던지기 결과: 상대가 먼저 시작합니다', 'coin', 1600);
    if (this.done) return;
    await this.transition(real, []);
    for (const e of real.log) await this.playEvent(e);
    await this.afterStep();
  }

  private readonly fit = () => {
    this.stage.style.setProperty('--k', String(Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H)));
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.sel) { this.sel = null; this.render(); }
  };

  private me() { return this.s.players[this.h]; }
  private foe() { return this.s.players[1 - this.h]; }
  private side(p: 0 | 1): Side { return p === this.h ? 'me' : 'foe'; }
  private other(side: Side): Side { return side === 'me' ? 'foe' : 'me'; }
  private myTurn() { return !this.busy && !this.ended && !this.done && this.s.active === this.h && this.s.winner === null; }
  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.view.querySelector<T>(sel); }

  // ── 진행 ──

  private async act(a: Action) {
    if (!this.myTurn()) return;
    await this.step(a);
    await this.afterStep();
  }

  private async step(a: Action): Promise<boolean> {
    let next: GameState;
    try { next = applyAction(this.s, a); } catch (err) { this.toast((err as Error).message); return false; }
    this.busy = true;
    this.sel = null;
    this.render();
    await this.transition(next, next.log.slice(this.s.log.length), a);
    if (next.winner !== null) await this.finish(next.winner === this.h ? 'win' : 'lose');
    return true;
  }

  // 상대(컴퓨터) 턴을 끝까지 돌리고 내 턴이 되면 입력을 연다
  private async afterStep() {
    let guard = 0;
    while (!this.done && !this.ended && this.s.winner === null && this.s.active !== this.h && guard++ < 300) {
      await sleep(650);
      if (this.done || this.ended) return;
      let a: Action;
      try { a = chooseAction(this.s); } catch { a = { type: 'endTurn' }; }
      if (!(await this.step(a)) && !(await this.step({ type: 'endTurn' }))) return;
    }
    if (this.done || this.ended || this.s.winner !== null) return;
    this.busy = false;
    this.render();
  }

  private async transition(next: GameState, events: GameEvent[], a?: Action) {
    for (const e of events) {
      if (this.done) return;
      await this.playEvent(e, a);
    }
    const rects = new Map<number, DOMRect>();
    this.view.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => rects.set(Number(el.dataset.uid), el.getBoundingClientRect()));
    if (this.dropRect) { rects.set(this.dropRect.uid, this.dropRect.rect); this.dropRect = null; }
    const prev = this.s;
    this.s = next;
    this.render();
    await this.afterRender(prev, rects);
  }

  private async finish(r: 'win' | 'lose', why?: string) {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    this.sel = null;
    this.render();
    const me = this.me(), foe = this.foe(), max = BALANCE.maxEntropy;
    const loser = this.q(`[data-panel="${r === 'win' ? 'foe' : 'me'}"]`);
    if (loser) {
      const c = this.fx.center(loser);
      this.fx.ring(c.x, c.y, '#ff5d5d', 300);
      this.fx.sparks(c.x, c.y, '#ff5d5d', 30, 160);
      void anim(loser, [{ filter: 'none' }, { filter: 'grayscale(1) brightness(.5)' }], { duration: 900, fill: 'forwards' });
    }
    await sleep(700);
    const el = document.createElement('div');
    el.className = `result ${r}`;
    el.innerHTML = `<div class="r-box">
      <h1>${r === 'win' ? '승리' : '패배'}</h1>
      <p>${why ?? (r === 'win' ? `상대 파멸 ${foe.entropy}/${max} — 상대 세력이 무너졌습니다` : `내 파멸 ${me.entropy}/${max} — 세력이 무너졌습니다`)}</p>
      <p class="dim">${this.s.turn}턴 · 내 파멸 ${me.entropy} · 상대 파멸 ${foe.entropy} · 점령한 대지 ${me.elements.length}곳</p>
      <div class="r-btns"><button class="btn primary big" data-act="rematch">다시 하기</button><button class="btn big" data-act="to-menu">메뉴로</button></div></div>`;
    el.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.onButton(b.dataset.act!);
    });
    this.fx.layer.append(el);
    await anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  }

  // ── 연출: 그리기 전 (이전 화면 위에서) ──

  private async playEvent(e: GameEvent, a?: Action) {
    this.log(this.describe(e));
    const side = this.side(e.p);
    switch (e.t) {
      case 'turnStart': {
        this.turnNo++;
        this.sel = null;
        const pill = this.q('.turn-pill');
        if (pill) pill.innerHTML = `턴 ${this.turnNo}<b>${side === 'me' ? '내 턴' : '상대 턴'}</b>`;
        // 첫 턴 시작 이벤트는 이미 시작 자원이 들어간 상태 위에서 연출되므로 0에서 센다
        const prev = this.turnNo === 1 ? 0 : this.s.players[e.p].pool;
        await Promise.all([
          this.fx.banner(side === 'me' ? '내 턴' : '상대 턴', `턴 ${this.turnNo}`, side, 1150),
          sleep(450).then(() => this.income(side, this.s.players[e.p], prev, e.pool)),
        ]);
        break;
      }
      case 'entropy': {
        const meter = this.q(`[data-meter="${side}"]`);
        if (!meter) break;
        meter.querySelector<HTMLElement>('.m-fill')!.style.width = `${(e.total / BALANCE.maxEntropy) * 100}%`;
        meter.querySelector('b')!.textContent = String(e.total);
        meter.classList.toggle('danger', e.total >= BALANCE.maxEntropy - 6);
        const c = this.fx.center(meter);
        const big = e.cause !== 'natural';
        this.fx.float(`+${e.amount}`, c.x, c.y - 6, `ent ${e.cause}`);
        if (big) { this.fx.shake(this.q(`[data-panel="${side}"]`), 7); this.fx.sparks(c.x, c.y, '#ff5d8f', 10, 60); }
        await sleep(big ? 520 : 260);
        break;
      }
      case 'play': {
        const def = getCard(e.cardId);
        const kind = def.kind ?? 'unit';
        const slot = this.q(`[data-slot="${kind === 'spell' ? this.other(side) : side}-${e.lane}"]`)!;
        if (side === 'foe') {
          const shown = await this.showcase(def);
          await this.fx.moveTo(shown, slot, kind === 'unit' ? 0.56 : 0.3, kind !== 'unit', 420);
          shown.remove();
          if (kind === 'unit') this.flown.add(`foe-${e.lane}`);
        } else if (a?.type === 'play') {
          const card = this.q(`[data-hand="${a.uid}"]`);
          const drop = this.dropRect?.uid === a.uid ? this.dropRect.rect : null;
          if (card && drop) {
            // 끌어다 놓았다: 손패 자리의 원본은 감추고, 유닛은 그린 뒤 놓은 자리에서 FLIP. 마법·아이템은 놓은 자리에서 날린다
            card.style.visibility = 'hidden';
            if (kind !== 'unit') {
              const b = this.fx.local(drop);
              const fly = this.fx.spawn(cardHTML(def), b.x + b.w / 2, b.y + b.h / 2, 'ghost');
              await this.fx.moveTo(fly, slot, 0.4, true, 380);
              fly.remove();
            }
          } else if (card && kind === 'unit') {
            // 클릭으로 냈다: 손패에서 빈 칸으로 날아간다 (그린 뒤 FLIP은 건너뛴다)
            const k = (slot.getBoundingClientRect().height * 0.93) / card.getBoundingClientRect().height;
            card.style.zIndex = '60';
            await this.fx.moveTo(card, slot, k, false, 380);
            this.flown.add(`me-${e.lane}`);
          } else if (card) await this.fx.moveTo(card, slot, 0.4, true, 380);
        }
        const c = this.fx.center(slot);
        if (kind === 'spell') {
          this.fx.ring(c.x, c.y, COLOR.union, 260);
          this.fx.sparks(c.x, c.y, '#ffd27a', 24, 120);
          this.fx.shake(slot, 9);
          await sleep(350);
        } else if (kind === 'item') {
          this.fx.ring(c.x, c.y, '#9fe1ff', 180);
          this.fx.float('장착!', c.x, c.y - 40, 'buff');
          await sleep(300);
        }
        break;
      }
      case 'attack': {
        const att = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        const tgt = this.q(`[data-slot="${this.other(side)}-${e.at}"]`);
        if (att && tgt) await this.fx.lunge(att, tgt, e.target === 'unit' ? '#ffd166' : '#ff5d8f');
        const defender = this.s.players[1 - e.p].lanes[e.at];
        if (e.target === 'unit' && defender && tgt) {
          const blocked = e.dmg - reducedDamage(defender, e.dmg, 'armor');
          if (blocked > 0) { const c = this.fx.center(tgt); this.fx.float(`🛡 -${blocked}`, c.x, c.y - 50, 'buff'); }
        }
        const meter = this.q(`[data-meter="${this.other(side)}"]`);
        if (e.target === 'entropy' && tgt && meter) await this.fx.orb(tgt, meter, '#ff5d8f');
        break;
      }
      case 'counter': {
        // 공격을 버텨낸 유닛이 되받아친다
        const def = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        const tgt = this.q(`[data-slot="${this.other(side)}-${e.at}"]`);
        if (!def || !tgt) break;
        const c = this.fx.center(def);
        this.fx.float('반격!', c.x, c.y - 60, 'buff');
        await this.fx.lunge(def, tgt, '#9ec5ff');
        const attacker = this.s.players[1 - e.p].lanes[e.at];
        const blocked = attacker ? e.dmg - reducedDamage(attacker, e.dmg, 'armor') : 0;
        if (blocked > 0) { const t = this.fx.center(tgt); this.fx.float(`🛡 -${blocked}`, t.x, t.y - 50, 'buff'); }
        break;
      }
      case 'damage': {
        // 맞는 순간 체력 숫자를 깎는다 (다음 공격·사망 연출 전에 보이도록)
        const u = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        if (!u || u.dataset.dead || e.dmg <= 0) break;
        this.hurt.add(Number(u.dataset.uid));
        const hp = u.querySelector<HTMLElement>('.s.hp');
        if (hp) { hp.querySelector('b')!.textContent = String(Math.max(0, e.hp)); hp.classList.remove('up'); hp.classList.add('hurt'); }
        const c = this.fx.center(u);
        this.fx.float(`-${e.dmg}`, c.x, c.y, 'dmg');
        this.fx.shake(u, 6);
        await anim(u, [{ filter: 'brightness(2.5) saturate(0)' }, { filter: 'none' }], { duration: 300 });
        break;
      }
      case 'death': {
        const u = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        if (!u || u.dataset.dead) break;
        u.dataset.dead = '1';
        const res = this.q(`[data-res="${side}"]`);
        if (e.reason === 'decay' && res) {
          // 제물로 바친 유닛은 영혼이 되어 자원 칸으로 빨려 들어간다 (소멸하는 교단 유닛은 턴 시작에 자동으로)
          if (a?.type !== 'decay') { const c = this.fx.center(u); this.fx.float('소멸 → 제물', c.x, c.y - 50, 'decay'); await sleep(350); }
          await this.fx.absorb(u, res, COLOR.decay);
          break;
        }
        const c = this.fx.center(u);
        const color = e.reason === 'decay' || e.reason === 'halfLife' ? '#b483ff' : '#ff8a6b';
        this.fx.sparks(c.x, c.y, color, 22, 90);
        await anim(u, [
          { transform: 'scale(1) rotate(0deg)', filter: 'none', opacity: 1 },
          { transform: 'scale(1.12) rotate(-3deg)', filter: 'brightness(2.2)', opacity: 1, offset: 0.3 },
          { transform: 'scale(.6) rotate(8deg)', filter: 'brightness(.4) blur(3px)', opacity: 0 },
        ], { duration: 520, fill: 'forwards' });
        break;
      }
      case 'capture': {
        const tile = this.q(`[data-tile="${e.lane}"]`), tray = this.q(`[data-tray="${side}"]`);
        if (!tile || !tray) break;
        const c = this.fx.center(tile);
        this.fx.ring(c.x, c.y, '#7dffcf', 200);
        this.fx.float('대지 점령!', c.x, c.y - 30, 'buff');
        const land = getLand(e.element);
        const chip = this.fx.spawn(`<span class="chip a-${land.aspect}" style="--gc:${groupColor(land.race)}">${esc(land.name)}</span>`, c.x, c.y, 'flychip');
        await anim(tile, [{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 300 });
        await this.fx.moveTo(chip, tray, 1, false, 600);
        chip.remove();
        break;
      }
      case 'react': {
        const tray = this.q(`[data-tray="${side}"]`), slot = this.q(`[data-slot="${this.other(side)}-${e.lane}"]`);
        if (!tray || !slot) break;
        await this.fx.beam(tray, slot, '#ffe66b');
        const c = this.fx.center(slot);
        this.fx.ring(c.x, c.y, '#ffe66b', 220);
        this.fx.sparks(c.x, c.y, '#ffe66b', 20, 110);
        this.fx.float(e.dmg > BALANCE.elements.react.damage ? '상극 융합!' : '융합 주문!', c.x, c.y - 50, 'buff');
        this.fx.shake(slot, 9);
        await sleep(350);
        break;
      }
      case 'decay': {
        const res = this.q(`[data-res="${side}"]`);
        if (a?.type === 'decay' && a.from === 'hand' && res) {
          if (side === 'me') {
            const card = this.q(`[data-hand="${a.uid}"]`);
            if (card) await this.fx.absorb(card, res, COLOR.decay);
          } else {
            const shown = await this.showcase(getCard(e.cardId));
            await this.fx.absorb(shown, res, COLOR.decay);
            shown.remove();
          }
        }
        await this.gainPool(side, e.p, e.gain, e.auto ? `${getCard(e.cardId).name} 소멸 제물` : '제물');
        break;
      }
      case 'burn': {
        const pl = this.s.players[e.p];
        const chip = this.q(`[data-tray="${side}"] [data-el="${pl.elements.indexOf(e.element)}"]`);
        const res = this.q(`[data-res="${side}"]`);
        if (chip && res) await this.fx.absorb(chip, res, COLOR.decay);
        await this.gainPool(side, e.p, e.gain, `${getLand(e.element).name} 제물`);
        break;
      }
      case 'land': {
        // 대지 보유 효과: 칩에서 대상(회복할 내 유닛 · 맞을 적 · 상대 파멸)으로 빛줄기
        const land = getLand(e.element), color = LAND_FX_COLOR[land.aspect];
        const chip = this.q(`[data-tray="${side}"] [data-el="${this.s.players[e.p].elements.indexOf(e.element)}"]`) ?? this.q(`[data-tray="${side}"]`);
        const to = e.lane === null ? this.q(`[data-meter="${this.other(side)}"]`) : this.q(`[data-slot="${land.aspect === 'light' ? side : this.other(side)}-${e.lane}"]`);
        if (!chip || !to) break;
        const c = this.fx.center(chip);
        this.fx.float(`${land.name}<small>${landFx(e.element).short}</small>`, c.x, c.y - 16, 'income lat');
        if (e.lane === null) await this.fx.orb(chip, to, color);
        else await this.fx.beam(chip, to, color);
        break;
      }
      case 'transmute':
        this.floatOn(`[data-tray="${side}"]`, `타락: ${getLand(e.to).name}`, 'decay');
        await sleep(300);
        break;
      case 'inherit': {
        const slot = this.q(`[data-slot="${side}-${e.lane}"]`);
        if (!slot) break;
        const c = this.fx.center(slot);
        this.fx.ring(c.x, c.y, '#ffd166', 180);
        this.fx.float('빙의', c.x, c.y - 40, 'buff');
        await sleep(350);
        break;
      }
      case 'charge': {
        const u = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        if (!u) break;
        const c = this.fx.center(u);
        this.fx.ring(c.x, c.y, '#ffe66b', 150);
        this.fx.float('충전', c.x, c.y - 40, 'buff');
        await sleep(350);
        break;
      }
      case 'base': {
        const box = this.q(`[data-lat="${side}"]`);
        if (!box) break;
        const from = side === 'me' ? this.q('.hand') : this.q(`[data-panel="${side}"] .avatar`);
        if (from) await this.fx.orb(from, box, '#9fe1ff');
        const c = this.fx.center(box);
        this.fx.ring(c.x, c.y, '#9fe1ff', 140);
        this.fx.float(`+1 베이스<small>다음 턴부터 ${FACTIONS[this.s.players[e.p].faction].resource} +${BALANCE.base.income}</small>`, c.x, c.y - 10, 'income lat');
        await this.fx.count(box.querySelector('b'), e.total - 1, e.total, 300);
        await sleep(250);
        break;
      }
      case 'draw':
      case 'win':
        break;
    }
  }

  private floatOn(sel: string, text: string, cls: string) {
    const el = this.q(sel);
    if (!el) return;
    const c = this.fx.center(el);
    this.fx.float(text, c.x, c.y - 10, cls);
  }

  // 턴 시작 자원: 마탑 금화는 이월 + 수입 + 이자, 기사단 신앙·교단 영혼은 새로 채워진다
  private async income(side: Side, pl: PlayerState, prev: number, next: number) {
    const res = this.q(`[data-res="${side}"]`);
    if (!res) return;
    const name = FACTIONS[pl.faction].resource, c = this.fx.center(res);
    let text: string;
    if (pl.faction === 'union') {
      const interest = Math.min(Math.floor(prev / BALANCE.union.interestPer), BALANCE.union.interestMax);
      const gain = next - prev;
      const parts = [`수입 ${gain - Math.min(interest, gain)}`, interest > 0 && gain > 0 ? `이자 ${Math.min(interest, gain)}` : ''].filter(Boolean);
      text = `${gain >= 0 ? '+' : ''}${gain} ${name}<small>${gain > 0 ? parts.join(' · ') : '최대 보유량'}</small>`;
    } else {
      const b = BALANCE.covalent, lands = pl.faction === 'covalent' ? pl.elements.length * BALANCE.elements.bondPool : 0, bonus = pl.faction === 'covalent' && pl.bases >= b.resonanceAt ? b.resonanceBonus : 0;
      const base = pl.bases * BALANCE.base.income + lands + bonus;
      const why = [
        `베이스 ${pl.bases}${lands ? ` + 대지 ${lands}` : ''}${bonus ? ` + 공명 ${bonus}` : ''}`,
        next > base ? `${pl.turns === 1 ? '첫 턴 선불/후공' : '보너스'} +${next - base}` : '',
      ].filter(Boolean).join(' · ');
      text = `${next > 0 ? `+${next} ${name}` : `${name} 0`}<small>${why}</small>`;
      if (prev > 0) this.fx.float(`남은 ${prev} 소멸`, c.x, c.y + 30, 'lost');
    }
    this.fx.float(text, c.x, c.y - 10, `income ${pl.faction}`);
    this.fx.ring(c.x, c.y, COLOR[pl.faction], 120);
    this.shown[side] = next;
    await this.fx.count(res.querySelector('b'), pl.faction === 'union' ? prev : 0, next);
  }

  private async gainPool(side: Side, p: 0 | 1, gain: number, why: string) {
    const res = this.q(`[data-res="${side}"]`);
    const from = this.shown[side] ?? this.s.players[p].pool;
    this.shown[side] = from + gain;
    if (!res) return;
    const c = this.fx.center(res);
    this.fx.sparks(c.x, c.y, COLOR.decay, 14, 60);
    this.fx.float(`+${gain} 영혼<small>${esc(why)}</small>`, c.x, c.y - 10, 'income decay');
    await this.fx.count(res.querySelector('b'), from, from + gain, 420);
  }

  // 상대가 낸 카드를 화면 가운데에 크게 보여준다
  private async showcase(def: CardDef): Promise<HTMLElement> {
    const el = this.fx.spawn(cardHTML(def, { cls: 'big' }), STAGE_W / 2, 312, 'showcase');
    await anim(el, [{ transform: 'translateY(-160px) scale(.3)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    await sleep(750);
    return el;
  }

  // ── 연출: 그린 뒤 (새로 생긴 손패·유닛, 수치 변화) ──

  private async afterRender(prev: GameState, rects: Map<number, DOMRect>) {
    const jobs: Promise<void>[] = [];
    for (const side of ['me', 'foe'] as Side[]) {
      const pi = side === 'me' ? this.h : 1 - this.h;
      const pp = prev.players[pi], np = this.s.players[pi];
      // 드로우: 덱에서 손패로
      const pile = this.q(`[data-pile="${side}"] .stack`);
      const had = new Set(pp.hand.map((c) => c.uid));
      let k = 0;
      for (const c of np.hand) {
        if (had.has(c.uid)) continue;
        const el = this.q(`.${side}-hand [data-uid="${c.uid}"]`);
        if (el && pile) jobs.push(this.fx.flip(el, pile.getBoundingClientRect(), 520, k++ * 140));
      }
      // 소환·수치 변화
      const before = new Map(pp.lanes.filter((u): u is Unit => !!u).map((u) => [u.uid, u]));
      np.lanes.forEach((u, lane) => {
        if (!u) return;
        const el = this.q(`[data-slot="${side}-${lane}"] .unit`);
        if (!el) return;
        const old = before.get(u.uid);
        if (!old) { jobs.push(this.summon(el, side, lane, rects.get(u.uid))); return; }
        const c = this.fx.center(el);
        const dh = u.hp - old.hp, da = u.atk - old.atk;
        if (dh < 0 && !this.hurt.has(u.uid)) { this.fx.float(String(dh), c.x, c.y, 'dmg'); void anim(el, [{ filter: 'brightness(2.5) saturate(0)' }, { filter: 'none' }], { duration: 350 }); }
        if (dh > 0) this.fx.float(`+${dh}`, c.x + 30, c.y, 'heal');
        if (da) this.fx.float(`${da > 0 ? '+' : ''}${da} 공격`, c.x, c.y - 30, da > 0 ? 'buff' : 'dmg');
      });
      // 자원 변화 (턴 시작·제물 연출에서 이미 센 몫은 빼고)
      const from = this.shown[side] ?? pp.pool;
      this.shown[side] = np.pool;
      if (np.pool !== from) {
        const res = this.q(`[data-res="${side}"]`);
        if (res) {
          if (np.pool < from) { const c = this.fx.center(res); this.fx.float(`${np.pool - from}`, c.x, c.y - 10, 'spend'); }
          void this.fx.count(res.querySelector<HTMLElement>('b'), from, np.pool, 360);
        }
      }
    }
    this.hurt.clear();
    await Promise.all(jobs);
  }

  private async summon(el: HTMLElement, side: Side, lane: number, from?: DOMRect) {
    const key = `${side}-${lane}`;
    if (from && !this.flown.has(key)) await this.fx.flip(el, from, 380);
    this.flown.delete(key);
    await anim(el, [
      { transform: 'translateY(-34px) scale(1.4)', filter: 'brightness(1.8)', opacity: 0.6 },
      { transform: 'translateY(0) scale(1)', filter: 'none', opacity: 1 },
    ], { duration: 230, easing: 'cubic-bezier(.7,0,1,1)' });
    const unit = this.s.players[side === 'me' ? this.h : 1 - this.h].lanes[lane];
    if (!unit) return;
    const def = getCard(unit.cardId);
    const c = this.fx.center(el);
    this.fx.ring(c.x, c.y + 20, COLOR[def.faction], def.level >= 5 ? 260 : 150);
    this.fx.sparks(c.x, c.y + 40, COLOR[def.faction], def.level >= 5 ? 24 : 12, 90);
    if (def.level >= 5) this.fx.shake(this.q('.board'), 10);
  }

  // ── 입력 ──

  private onClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLElement>('[data-act]');
    if (btn) return this.onButton(btn.dataset.act!);
    if (this.suppressClick) return;
    if (!this.myTurn()) return;
    const hand = t.closest<HTMLElement>('[data-hand]');
    if (hand) {
      const uid = Number(hand.dataset.hand);
      const base = this.legal.find((a) => a.type === 'base' && a.uid === uid);
      if (base) return void this.act(base);
      if (this.isBase(uid)) return this.toast(this.me().bases >= BALANCE.base.max ? '베이스는 최대 12개까지 깔 수 있습니다' : '남은 베이스 설치 횟수가 없습니다 (내 턴마다 1회씩 생깁니다)');
      this.sel = this.sel?.k === 'hand' && this.sel.uid === uid ? null : { k: 'hand', uid };
      return this.render();
    }
    const chip = t.closest<HTMLElement>('[data-el]');
    if (chip) return this.onElement(Number(chip.dataset.el));
    const lane = t.closest<HTMLElement>('[data-lane]');
    if (lane) return this.onLane(Number(lane.dataset.lane), lane.dataset.side as Side | 'tile');
    if (this.sel) { this.sel = null; this.render(); }
  }

  private isBase(uid: number) {
    const c = this.me().hand.find((x) => x.uid === uid);
    return !!c && getCard(c.cardId).kind === 'base';
  }

  private onButton(act: string) {
    const me = this.me(), sel = this.sel;
    switch (act) {
      case 'end': return void this.act({ type: 'endTurn' });
      case 'cancel': this.sel = null; return this.render();
      case 'log':
        this.logOpen = !this.logOpen;
        return void this.q('.log')?.classList.toggle('open', this.logOpen);
      case 'reveal': this.reveal = !this.reveal; return this.render();
      case 'menu':
        if (this.ended || confirm('게임을 나가시겠습니까? 진행 중인 게임은 패배로 처리됩니다.')) this.o.onExit(false);
        return;
      case 'surrender':
        if (!this.ended && confirm('항복하시겠습니까?')) void this.finish('lose', '항복했습니다');
        return;
      case 'rematch': return this.o.onExit(true);
      case 'to-menu': return this.o.onExit(false);
      case 'shuffle': return void this.act({ type: 'shuffle' });
      case 'decay-hand':
        if (sel?.k === 'hand') void this.act({ type: 'decay', from: 'hand', uid: sel.uid });
        return;
      case 'decay-board':
        if (sel?.k === 'unit') void this.act({ type: 'decay', from: 'board', uid: sel.uid });
        return;
      case 'heir':
        if (sel?.k === 'unit') { this.sel = { ...sel, heir: true }; this.render(); }
        return;
      case 'burn':
        if (sel?.k === 'el') void this.act({ type: 'decay', from: 'element', element: me.elements[sel.picked[0]] });
        return;
    }
  }

  private onElement(i: number) {
    const me = this.me(), sym = me.elements[i];
    if (me.faction === 'union') {
      if (getLand(sym).aspect === 'sealed') return this.toast('봉인된 땅은 융합 주문에 쓸 수 없습니다');
      const picked = this.sel?.k === 'el' ? [...this.sel.picked] : [];
      const at = picked.indexOf(i);
      if (at >= 0) picked.splice(at, 1);
      else { if (picked.length === 2) picked.shift(); picked.push(i); }
      this.sel = picked.length ? { k: 'el', picked } : null;
    } else if (me.faction === 'decay') {
      this.sel = this.sel?.k === 'el' && this.sel.picked[0] === i ? null : { k: 'el', picked: [i] };
    } else return;
    this.render();
  }

  private onLane(lane: number, side: Side | 'tile') {
    const me = this.me(), sel = this.sel;
    if (sel?.k === 'hand') {
      const a = this.playAt(sel.uid, lane, side);
      if (a) return void this.act(a);
    }
    if (sel?.k === 'unit' && sel.heir) {
      const heir = me.lanes[lane];
      if (side === 'me' && heir && heir.uid !== sel.uid) return void this.act({ type: 'decay', from: 'board', uid: sel.uid, heir: heir.uid });
    }
    if (sel?.k === 'el' && sel.picked.length === 2) {
      const a = this.reactAt(lane);
      if (a) return void this.act(a);
    }
    const u = me.lanes[lane];
    if (side === 'me' && u) {
      if (me.faction === 'decay') {
        this.sel = sel?.k === 'unit' && sel.uid === u.uid ? null : { k: 'unit', uid: u.uid };
        return this.render();
      }
    }
    if (sel) { this.sel = null; this.render(); }
  }

  // 손패 카드를 그 레인에 내는 합법 행동 (유닛·아이템은 내 칸, 마법은 어느 칸이든)
  private playAt(uid: number, lane: number, side?: string): Action | undefined {
    const c = this.me().hand.find((x) => x.uid === uid);
    if (!c) return;
    if ((getCard(c.cardId).kind ?? 'unit') !== 'spell' && side !== 'me') return;
    const plays = this.legal.filter((a) => a.type === 'play' && a.uid === uid && a.lane === lane);
    return plays.find((a) => a.type === 'play' && !a.overload) ?? plays[0];
  }

  private reactAt(lane: number): Action | undefined {
    if (this.sel?.k !== 'el' || this.sel.picked.length !== 2) return;
    const [a, b] = this.sel.picked.map((i) => this.me().elements[i]);
    return this.legal.find((x) => x.type === 'react' && x.lane === lane && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  }

  // 손패 끌어다 놓기. 8px 이상 움직이면 드래그, 아니면 클릭(선택)으로 처리
  private onPointerDown(ev: PointerEvent) {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-hand]');
    if (!card || !this.myTurn() || ev.button !== 0 || this.isBase(Number(card.dataset.hand))) return;
    this.drag = { uid: Number(card.dataset.hand), x0: ev.clientX, y0: ev.clientY };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { once: true });
  }

  private readonly onMove = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 8) return;
      this.sel = { k: 'hand', uid: d.uid };
      this.render();
      const c = this.me().hand.find((x) => x.uid === d.uid)!;
      d.ghost = this.fx.spawn(cardHTML(getCard(c.cardId), { cost: costOf(this.s, this.me(), getCard(c.cardId)) }), 0, 0, 'ghost');
    }
    const p = this.fx.local(new DOMRect(ev.clientX, ev.clientY, 0, 0));
    d.ghost.style.left = `${p.x - d.ghost.offsetWidth / 2}px`;
    d.ghost.style.top = `${p.y - d.ghost.offsetHeight / 2}px`;
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-lane]');
    this.view.querySelectorAll('.hover-drop').forEach((x) => x.classList.remove('hover-drop'));
    if (hit && this.playAt(d.uid, Number(hit.dataset.lane), hit.dataset.side)) hit.classList.add('hover-drop');
  };

  private readonly onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', this.onMove);
    const d = this.drag;
    this.drag = null;
    if (!d?.ghost) return;
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    const rect = d.ghost.getBoundingClientRect();
    d.ghost.remove();
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-lane]');
    const a = hit ? this.playAt(d.uid, Number(hit.dataset.lane), hit.dataset.side) : undefined;
    if (a) { this.dropRect = { uid: d.uid, rect }; void this.act(a); } else this.render();
  };

  // 전장 유닛에 마우스를 올리면 카드 전체와 현재 상태를 보여준다
  private onHover(ev: MouseEvent) {
    const box = this.q('.preview');
    if (!box) return;
    // 미리보기 안의 용어(연쇄·폭주)에 마우스를 올린 동안은 패널을 그대로 둔다
    if ((ev.target as HTMLElement).closest('.preview')) return;
    const handEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-hand]');
    if (handEl && !this.drag && this.showHand(Number(handEl.dataset.hand))) return;
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-preview]');
    if (!el || this.drag) { if (this.drag || !this.showSelected()) box.classList.remove('show'); return; }
    const def = getCard(el.dataset.preview!);
    const uid = Number(el.dataset.uid);
    const u = [...this.me().lanes, ...this.foe().lanes].find((x) => x?.uid === uid);
    box.innerHTML = cardHTML(def, { cls: 'big' }) + (u ? this.unitStatus(u, def) : '');
    const r = this.fx.local(el.getBoundingClientRect());
    const left = r.x + r.w + 250 > STAGE_W ? r.x - 246 : r.x + r.w + 12;
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(46, Math.min(r.y - 30, STAGE_H - 420))}px`;
    box.classList.add('show');
  }

  private showHand(uid: number): boolean {
    const box = this.q('.preview'), c = this.me().hand.find((x) => x.uid === uid);
    if (!box || !c) return false;
    box.innerHTML = cardHTML(getCard(c.cardId), { cls: 'big' });
    box.style.left = `${STAGE_W - 250}px`;
    box.style.top = '250px';
    box.classList.add('show');
    return true;
  }

  // 선택한 손패 카드는 마우스를 옮겨도 우측에 남겨, 용어 설명에 마우스를 가져갈 수 있게 한다
  private showSelected(): boolean {
    return this.sel?.k === 'hand' && this.showHand(this.sel.uid);
  }

  private unitStatus(u: Unit, def: CardDef) {
    const rows = [
      `현재 ${u.atk} / ${u.hp}`,
      u.sick ? '이번 턴 소환됨 (공격 불가)' : u.attacked ? '이번 턴 공격함' : u.atk > 0 ? '턴 종료 시 자동 공격' : '',
      u.halfLife !== undefined ? `소멸까지 ${u.halfLife}턴` : '',
      u.energy !== undefined ? `기력 ${u.energy}` : '',
      u.equipped?.length ? `장착: ${u.equipped.map((id) => getCard(id).name).join(', ')}` : '',
      u.inherited?.length ? `빙의: ${u.inherited.map((id) => getCard(id).name).join(', ')}` : '',
    ].filter(Boolean);
    return `<div class="status"><b>${esc(def.name)}</b>${rows.map((r) => `<div>${esc(r)}</div>`).join('')}</div>`;
  }

  private toast(msg: string) {
    const t = this.fx.spawn(esc(msg), STAGE_W / 2, 500, 'toast');
    void anim(t, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none', offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1800 }).then(() => t.remove());
  }

  private log(line: string) {
    this.logLines.push(line);
    const ol = this.q('.log ol');
    if (!ol) return;
    const li = document.createElement('li');
    li.textContent = line;
    if (line.startsWith('──')) li.className = 'turn';
    ol.append(li);
    ol.scrollTop = ol.scrollHeight;
  }

  private describe(e: GameEvent): string {
    const who = e.p === this.h ? '나' : '상대';
    const n = (id: string) => getCard(id).name;
    switch (e.t) {
      case 'turnStart': return `── ${who}의 턴 (자원 ${e.pool})`;
      case 'draw': return e.p === this.h ? `드로우: ${n(e.cardId)}` : '상대가 카드를 뽑음';
      case 'play': return `${who}: ${n(e.cardId)} → ${e.lane + 1}번 레인`;
      case 'base': return `${who}: 베이스 설치 (총 ${e.total})`;
      case 'attack': return `${who}: ${e.lane + 1}번 레인 공격 → ${e.target === 'unit' ? `${e.at + 1}번 레인 유닛` : '파멸'} (${e.dmg})`;
      case 'counter': return `${who}: 버텨내고 반격 (${e.dmg})`;
      case 'damage': return `${who}의 ${e.lane + 1}번 레인 유닛 ${e.dmg} 피해 → 체력 ${Math.max(0, e.hp)}`;
      case 'death': return `${who}의 ${n(e.cardId)} 파괴 (${REASON[e.reason]})`;
      case 'shuffle': return `${who}: 손패 ${e.n}장을 덱에 섞고 다시 뽑음`;
      case 'decay': return `${who}: ${n(e.cardId)} ${e.auto ? '소멸 → 자동 제물' : '제물'} → 영혼 +${e.gain}`;
      case 'inherit': return `${who}: ${n(e.cardId)}의 혼이 빙의 (${e.lane + 1}번 레인)`;
      case 'charge': return `${who}의 ${n(e.cardId)} 충전 발동`;
      case 'capture': return `${who}: ${getLand(e.element).name} 점령 (${e.lane + 1}번 레인)`;
      case 'react': return `${who}: ${e.elements.map((k) => getLand(k).name).join(' + ')} 융합 주문 → ${e.lane + 1}번 레인 ${e.dmg} 피해`;
      case 'burn': return `${who}: ${getLand(e.element).name} 제물 → 영혼 +${e.gain}`;
      case 'transmute': return `${who}: ${getLand(e.from).name} → ${getLand(e.to).name} 타락`;
      case 'spire': return `${who}: 첨탑 ${e.floors}층`;
      case 'bombard': return `${who}: 첨탑 잔불 포격 → ${e.lane + 1}번 레인 ${e.dmg} 피해`;
      case 'land': return `${who}: ${getLand(e.element).name} 보유 효과 (${landFx(e.element).short}${e.lane === null ? '' : `, ${e.lane + 1}번 레인`})`;
      case 'entropy': return `${who} 파멸 +${e.amount} (${CAUSE[e.cause]}) → ${e.total}`;
      case 'win': return `${who} 승리`;
    }
  }

  // ── 그리기 ──

  private render() {
    if (this.done) return;
    const s = this.s, me = this.me(), foe = this.foe();
    const mine = this.myTurn();
    this.legal = mine ? legalActions(s) : [];
    const marks = this.marks();
    const lanes = Array.from({ length: LANES }, (_, i) => `<div class="lane" style="left:${i * 180}px">
      ${this.slot('foe', foe, i, marks)}${this.tile(i)}${this.slot('me', me, i, marks)}</div>`).join('');
    const ley = s.leyline;
    const onlyEnd = mine && this.legal.length === 1;
    const idle = mine && me.cardsUsedThisTurn === 0 && this.legal.some((a) => a.type === 'play' || a.type === 'base' || (a.type === 'decay' && a.from === 'hand'));
    this.view.innerHTML = `
      <div class="tb-left"><button class="btn ghost" data-act="menu">☰ 나가기</button><button class="btn ghost" data-act="surrender" ${this.ended ? 'disabled' : ''}>🏳 항복</button></div>
      <div class="tb-right">${this.o.admin ? `<button class="btn ghost ${this.reveal ? 'on' : ''}" data-act="reveal" title="관리자 권한">👁 상대 손패</button>` : ''}<button class="btn ghost" data-act="log">📜 기록</button></div>
      ${this.panel('foe', foe)}${this.panel('me', me)}
      <div class="ley-box">${ley ? `<span>지맥</span><b>${esc(ley)}</b><small>이 종족 대지의 공명 ×${BALANCE.elements.leyline.resonanceMult}</small>` : '<small>지맥 없음</small>'}
        <small>남은 대지 ${s.tileBag.length}곳</small></div>
      <div class="foe-hand">${this.foeHand(foe)}</div>
      <div class="board ${s.active === this.h ? 'my-turn' : 'foe-turn'}">${lanes}</div>
      ${this.pile('foe', foe)}${this.pile('me', me)}
      <div class="turn-pill ${s.active === this.h ? 'me' : 'foe'}">턴 ${this.turnNo}<b>${s.active === this.h ? '내 턴' : '상대 턴'}</b></div>
      <button class="end-turn ${idle ? 'idle' : onlyEnd ? 'glow' : ''}" data-act="end" ${mine ? '' : 'disabled'}>${mine ? '턴 종료' : s.active === this.h ? '…' : '상대 턴'}</button>
      <div class="hint">${this.hint()}</div>
      <button class="btn small shuffle" data-act="shuffle" ${mine && !me.shuffledThisTurn && me.hand.length ? '' : 'disabled'} title="손패 전부를 덱에 섞고 같은 장수를 다시 뽑습니다. 턴당 1번, 내 파멸 +${BALANCE.hand.shuffleEntropy}">🔀 손패 셔플 <small>파멸 +${BALANCE.hand.shuffleEntropy}</small></button>
      <div class="me-hand hand">${this.handHTML(me)}</div>
      <div class="preview"></div>
      <div class="log ${this.logOpen ? 'open' : ''}"><h4>전투 기록</h4><ol>${this.logLines.slice(-150).map((l) => `<li class="${l.startsWith('──') ? 'turn' : ''}">${esc(l)}</li>`).join('')}</ol></div>`;
    const ol = this.q('.log ol');
    if (ol) ol.scrollTop = ol.scrollHeight;
    this.showSelected();
  }

  // 지금 선택에 따라 놓을 수 있는 칸 ('me-2' 형식)
  private marks(): Set<string> {
    const t = new Set<string>();
    const me = this.me(), sel = this.sel;
    if (sel?.k === 'hand') {
      const c = me.hand.find((x) => x.uid === sel.uid);
      const spell = c && getCard(c.cardId).kind === 'spell';
      for (const a of this.legal) if (a.type === 'play' && a.uid === sel.uid) t.add(`${spell ? 'foe' : 'me'}-${a.lane}`);
    } else if (sel?.k === 'unit' && sel.heir) {
      me.lanes.forEach((u, i) => { if (u && u.uid !== sel.uid) t.add(`me-${i}`); });
    } else if (sel?.k === 'el' && sel.picked.length === 2) {
      for (let i = 0; i < LANES; i++) if (this.reactAt(i)) t.add(`foe-${i}`);
    }
    return t;
  }

  private spireTip(pl: PlayerState) {
    const sp = BALANCE.union.spire;
    return `첨탑 ${pl.spire}층 (최대 ${sp.max})
주문 +${sp.perSpell}층 (폭주 +${sp.perSpell + sp.overloadBonus}층), 융합 주문 +${sp.perReact}층. 내려가지 않습니다
턴 시작마다 공격력이 가장 높은 적 유닛에게 ${Math.floor(pl.spire / sp.bombardPer)} 피해 (${sp.bombardPer}층당 1)
전승 기본 상한 +${Math.floor(pl.spire / sp.techPer)} (${sp.techPer}층당 1)`;
  }

  private panel(side: Side, pl: PlayerState) {
    const f = FACTIONS[pl.faction], max = BALANCE.maxEntropy;
    const cap = levelCap(pl);
    const picked = side === 'me' && this.sel?.k === 'el' ? this.sel.picked : [];
    const clickable = side === 'me' && pl.faction !== 'covalent';
    const chips = pl.elements.map((e, i) => {
      const d = getLand(e);
      return `<button class="chip a-${d.aspect} ${picked.includes(i) ? 'on' : ''}" style="--gc:${groupColor(d.race)}" data-el="${i}" ${clickable ? '' : 'disabled'} title="${d.name} · ${d.race} · ${d.tier}등급 · ${ASPECT_LABEL[d.aspect]}${d.corruptsTo ? ` · 타락 → ${getLand(d.corruptsTo).name}` : ''}&#10;${landFx(e).long}">${d.name}</button>`;
    }).join('');
    const active = this.s.active === (side === 'me' ? this.h : 1 - this.h);
    return `<div class="panel ${side} f-${pl.faction} ${active ? 'active' : ''}" data-panel="${side}">
      <div class="p-head"><div class="avatar">${ICON[pl.faction]}</div>
        <div><div class="p-name">${esc(side === 'me' ? this.o.myName : this.o.foeName)}</div><div class="p-fac">${f.name}</div></div></div>
      <div class="meter ${pl.entropy >= max - 6 ? 'danger' : ''}" data-meter="${side}" title="파멸이 ${max}에 닿으면 패배">
        <div class="m-fill" style="width:${(pl.entropy / max) * 100}%"></div><span class="m-txt">파멸 <b>${pl.entropy}</b> / ${max}</span></div>
      <div class="p-stats">
        <div class="res" data-res="${side}" data-tip="${esc(this.resTip(pl))}"><small>${f.resource}</small><b>${pl.pool}</b></div>
        <div class="res lat" data-lat="${side}" data-tip="${esc(`베이스 ${pl.bases}개 (최대 ${BALANCE.base.max})\n베이스 하나당 매 턴 시작에 ${f.resource} +${BALANCE.base.income}\n설치 횟수는 내 턴마다 ${BALANCE.base.perTurn}회씩 생기고, 안 쓰면 다음 턴으로 쌓입니다 (지금 ${pl.baseRights}회)\n자원은 다음 턴부터 반영되고, 제물로 바칠 수 없습니다`)}"><small>베이스</small><b>${pl.bases}</b><i>설치 ${pl.baseRights}회</i></div>
        ${pl.faction === 'union' ? `<div class="res lat" data-tip="${esc(this.spireTip(pl))}"><small>첨탑</small><b>${pl.spire}</b><i>최대 ${BALANCE.union.spire.max}</i></div>` : ''}
        <div class="res tech" title="낼 수 있는 카드 레벨 상한"><small>전승</small><b>${pl.tech || '-'}</b><i>${Number.isFinite(cap) ? `Lv ${cap}까지` : '제한 없음'}</i></div>
      </div>
      <div class="tray" data-tray="${side}">${chips || '<span class="dim">점령한 대지 없음</span>'}</div>
    </div>`;
  }

  // 자원 칸 설명 (마우스를 올리면 보인다). 수치는 resources.ts 규칙과 같다
  private resTip(pl: PlayerState): string {
    const inc = BALANCE.base.income, first = pl.turns <= 1 ? `\n첫 턴에는 선불로 ${BALANCE.base.borrow}을(를) 당겨 쓸 수 있고, 쓰면 다음 턴 시작에 파멸 +${BALANCE.base.borrowEntropy}` : '';
    if (pl.faction === 'union') {
      const b = BALANCE.union;
      const interest = Math.min(Math.floor(pl.pool / b.interestPer), b.interestMax);
      return `금화 — 쓰고 남은 금화는 다음 턴으로 이월됩니다\n턴 시작 수입 = 베이스 ${pl.bases} × ${inc}\n이자: 남은 금화 ${b.interestPer}당 +1 (최대 ${b.interestMax}) → 지금 +${interest}\n최대 보유 ${b.goldCap}${first}`;
    }
    if (pl.faction === 'covalent') {
      const b = BALANCE.covalent, lands = pl.elements.length * BALANCE.elements.bondPool;
      const bond = BALANCE.elements.bondPool > 0;
      return `신앙 = 베이스 수${bond ? ' + 점령한 대지 수' : ''}\n지금: 베이스 ${pl.bases}${bond ? ` + 대지 ${lands}` : ''}${pl.bases >= b.resonanceAt ? ` + 공명 ${b.resonanceBonus}` : ''} (베이스 ${b.resonanceAt}개 이상이면 +${b.resonanceBonus})\n매 턴 시작에 다시 채워지며, 남은 신앙은 이월되지 않습니다${first}`;
    }
    return `영혼 = 베이스 수 + 이번 턴 제물\n지금: 베이스 ${pl.bases} × ${inc}\n손패·유닛·대지를 제물로 바치면 영혼을 얻습니다 (베이스는 제물 불가)\n매 턴 시작에 베이스 수로 돌아가며, 남은 영혼은 이월되지 않습니다${first}`;
  }

  private slot(side: Side, pl: PlayerState, lane: number, marks: Set<string>) {
    const u = pl.lanes[lane];
    const key = `${side}-${lane}`;
    return `<div class="slot ${side} ${marks.has(key) ? 'target' : ''}" data-slot="${key}" data-lane="${lane}" data-side="${side}">${u ? this.unitHTML(u, side, lane) : ''}</div>`;
  }

  private unitHTML(u: Unit, side: Side, lane: number) {
    const def = getCard(u.cardId);
    const kw = (key: string) => [u.cardId, ...(u.equipped ?? [])].reduce((a, id) => a + Number(getCard(id).keywords?.find((k) => k.startsWith(key + ':'))?.split(':')[1] ?? 0), 0);
    const baseHp = [u.cardId, ...(u.equipped ?? [])].reduce((a, id) => a + getCard(id).hp, 0);
    const charge = Number(def.keywords?.find((k) => k.startsWith('charge:'))?.split(':')[1] ?? 0);
    // 소멸: 마지막 턴이면 다음 내 턴 시작에 사라진다 (교단은 자동 제물)
    const owner = side === 'me' ? this.me() : this.foe();
    const hlLast = u.halfLife === 1 ? (owner.faction === 'decay' ? '다음 턴 제물' : '다음 턴 소멸') : '';
    const badges = [
      u.halfLife !== undefined ? `<i class="hl-badge" title="소멸까지 남은 내 턴 수${owner.faction === 'decay' ? ' (사라질 때 자동 제물: 영혼 +레벨의 절반)' : ''}">⏳ ${hlLast || `소멸 ${u.halfLife}턴`}</i>` : '',
      charge ? `<i title="기력">기력 ${u.energy ?? 0}/${charge}</i>` : '',
      u.equipped?.length ? `<i title="장비">장비 ${u.equipped.length}</i>` : '',
      u.inherited?.length ? `<i title="빙의">빙의 ${u.inherited.length}</i>` : '',
      kw('resist') ? `<i class="kw-res" title="저항: 받는 능력·주문 피해 -${kw('resist')}">저항 +${kw('resist')}</i>` : '',
    ].join('');
    const stat = (cls: string, n: number, label: string) => `<div class="s ${cls}"><b>${n}</b><small>${label}</small></div>`;
    const sel = this.sel;
    const cls = [
      side === 'me' && canAttack(u) ? 'ready' : '',
      u.sick ? 'sick' : '',
      u.halfLife !== undefined ? 'hl' : '',
      hlLast ? 'hl-last' : '',
      sel?.k === 'unit' && sel.uid === u.uid ? 'selected' : '',
    ].join(' ');
    const art = def.art ? ` style="background-image:url('${esc(def.art)}')"` : '';
    return `<div class="unit f-${def.faction} ${cls}" style="--gc:${groupColor(def.race)}" data-uid="${u.uid}" data-preview="${def.id}">
      <div class="u-art"${art}></div>
      <div class="u-rail">${stat(`atk ${u.atk > def.atk ? 'up' : ''}`, u.atk, '공격')}${stat('arm', kw('armor'), '방어')}${stat(`hp ${u.hp < baseHp ? 'hurt' : u.hp > baseHp ? 'up' : ''}`, u.hp, '체력')}</div>
      <div class="u-name">${esc(def.name)}</div>
      <div class="u-badges">${badges}</div>
      ${u.sick ? '<div class="zzz">z<span>z</span></div>' : ''}
    </div>`;
  }

  private tile(lane: number) {
    const s = this.s, sym = s.tiles[lane];
    if (!sym) return `<div class="tile empty" data-tile="${lane}" data-lane="${lane}" data-side="tile"><span class="dim">대지 소진</span></div>`;
    const e = getLand(sym);
    const pips = (pl: PlayerState) => {
      const need = BALANCE.elements.captureTurns[pl.faction];
      return Array.from({ length: need }, (_, i) => `<i class="${i < pl.capture[lane] ? 'on' : ''}"></i>`).join('');
    };
    const match = this.selectedTiles().includes(lane);
    return `<div class="tile a-${e.aspect} ${e.race === s.leyline ? 'ley' : ''} ${match ? 'match' : ''}" style="--gc:${groupColor(e.race)}" data-tile="${lane}" data-lane="${lane}" data-side="tile"
        title="${e.name} · ${e.race}의 땅 · ${e.tier}등급 · ${ASPECT_LABEL[e.aspect]}${e.race === s.leyline ? ' · 지맥' : ''}&#10;레인을 혼자 지킨 채 턴을 ${BALANCE.elements.captureTurns[this.me().faction]}번 시작하면 점령&#10;${landFx(sym).long}">
      <div class="pips foe">${pips(this.foe())}</div>
      <span class="t-tier">${e.tier}등급</span><span class="t-name">${e.name}</span><span class="t-group">${e.race}${e.race === s.leyline ? ' ★' : ''}</span><span class="t-aspect">${ASPECT_LABEL[e.aspect]} · ${landFx(sym).short}</span>
      <div class="pips me">${pips(this.me())}</div></div>`;
  }

  private pile(side: Side, pl: PlayerState) {
    const n = pl.deck.length;
    return `<div class="pile ${side} ${n <= 3 ? 'low' : ''}" data-pile="${side}">
      <div class="stack" style="--n:${Math.min(n, 6)}">${n ? cardBackHTML() : '<div class="empty-pile">덱 없음<small>드로우마다 파멸 +${BALANCE.fatigueEntropy}</small></div>'}</div>
      <div class="p-cnt"><b>${n}</b><span>덱</span></div>
      <div class="p-sub">손패 ${pl.hand.length}/${BALANCE.hand.max} · 버림 ${pl.discard.length}${side === 'me' ? `<br>이번 턴 사용 ${pl.cardsUsedThisTurn}장 → 다음 턴 ${Math.min(pl.cardsUsedThisTurn, BALANCE.hand.max - pl.hand.length)}장 드로우` : ''}</div></div>`;
  }

  private foeHand(foe: PlayerState) {
    const n = foe.hand.length, gap = Math.min(46, 420 / Math.max(1, n));
    return foe.hand.map((c, i) => {
      const x = 360 - ((n - 1) * gap) / 2 + i * gap, r = (i - (n - 1) / 2) * -3;
      const style = `left:${x - 32}px;--r:${r}deg`;
      return this.reveal && this.o.admin
        ? cardHTML(getCard(c.cardId), { cls: 'fcard', attrs: `data-uid="${c.uid}" data-preview="${c.cardId}" style="${style}"` })
        : cardBackHTML('fcard', `data-uid="${c.uid}" style="${style}"`);
    }).join('');
  }

  private handHTML(me: PlayerState) {
    const n = me.hand.length, W = 712, CW = 116;
    const gap = n > 1 ? Math.min(104, (W - CW - 40) / (n - 1)) : 0;
    const sel = this.sel;
    return me.hand.map((c, i) => {
      const def = getCard(c.cardId);
      const mid = (n - 1) / 2, off = i - mid;
      const x = W / 2 - CW / 2 + off * gap, y = 8 + off * off * 2.2;
      const locked = isLocked(me, def);
      const playable = this.legal.some((a) => (a.type === 'play' || a.type === 'base') && a.uid === c.uid);
      const syn = this.synergy(me, def);
      const resonant = syn.discount > 0 || syn.buff > 0;
      const cls = ['hcard', playable ? 'playable' : '', locked ? 'locked' : '', resonant ? 'res' : ''].join(' ');
      const lock = locked ? `<div class="c-lock">🔒<b>Lv ${def.level}</b><small>전승 단계 부족 (지금 Lv ${levelCap(me)}까지)</small></div>` : '';
      const tax = foreignTax(me, def);
      const guest = tax > 0
        ? `<span class="guest" title="${FACTIONS[def.faction].name} 카드: 남의 색 아이콘 하나당 비용 +${BALANCE.deck.colorTax} (${FACTIONS[def.faction].short} 대지를 하나라도 가지면 없음)">남의 색 +${tax}</span>` : '';
      const badges = [
        guest,
        syn.discount > 0 ? `<span title="연고 대지를 가져 비용 -${syn.discount}">공명 −${syn.discount}</span>` : '',
        syn.buff > 0 ? `<span title="같은 종족의 대지를 가져 소환 시 +${syn.buff}/+${syn.buff}">+${syn.buff}/+${syn.buff}</span>` : '',
        ...(resonant ? [] : syn.tiles.map((l) => `<span class="soft" title="${l + 1}번 레인의 ${getLand(this.s.tiles[l]!).name}을(를) 점령하면 공명">${l + 1}번 대지</span>`)),
      ].join('');
      const res = badges ? `<div class="c-res">${badges}</div>` : '';
      const isSel = sel?.k === 'hand' && sel.uid === c.uid;
      return `<div class="hslot ${isSel ? 'selected' : ''}" data-hand="${c.uid}" data-uid="${c.uid}" style="left:${x}px;top:${y}px;--r:${off * 3}deg;--gc:${groupColor(def.race)};z-index:${i + 1}">${cardHTML(def, { cost: syn.cost, cls, extra: lock + res })}</div>`;
    }).join('');
  }

  // 공명: discount = 연고 대지를 가져 비용 할인, buff = 같은 종족의 대지를 가져 소환 시 +N/+N,
  //   tiles = 장악하면 이 카드에 공명이 생기는 레인
  private synergy(pl: PlayerState, def: CardDef) {
    const cost = costOf(this.s, pl, def);
    const ownGroup = pl.elements.some((e) => getLand(e).race === def.race);
    const mult = def.race === this.s.leyline ? BALANCE.elements.leyline.resonanceMult : 1;
    const buff = (def.kind ?? 'unit') === 'unit' && ownGroup ? BALANCE.elements.groupBuff * mult : 0;
    const tiles = this.s.tiles.flatMap((t, i) => (t && (t === def.land || getLand(t).race === def.race) ? [i] : []));
    return { cost, discount: def.level + foreignTax(pl, def) - cost, buff, tiles };
  }

  // 선택한 손패 카드와 공명하는 대지 레인
  private selectedTiles(): number[] {
    const sel = this.sel;
    if (sel?.k !== 'hand') return [];
    const c = this.me().hand.find((x) => x.uid === sel.uid);
    return c ? this.synergy(this.me(), getCard(c.cardId)).tiles : [];
  }

  private hint(): string {
    if (this.ended) return '';
    if (this.s.active !== this.h) return `<span class="thinking">상대가 생각 중<i>.</i><i>.</i><i>.</i></span>`;
    if (!this.myTurn()) return '';
    const me = this.me(), sel = this.sel, res = FACTIONS[me.faction].resource;
    const cancel = '<button class="btn small ghost" data-act="cancel">취소 (Esc)</button>';
    if (sel?.k === 'hand') {
      const c = me.hand.find((x) => x.uid === sel.uid);
      if (!c) return '';
      const def = getCard(c.cardId), kind = def.kind ?? 'unit';
      const plays = this.legal.filter((a) => a.type === 'play' && a.uid === sel.uid);
      const overload = plays.length > 0 && plays.every((a) => a.type === 'play' && a.overload);
      const canDecay = this.legal.some((a) => a.type === 'decay' && a.from === 'hand' && a.uid === sel.uid);
      const o = BALANCE.union.overload;
      const msg = plays.length
        ? kind === 'unit' ? '소환할 빈 칸을 고르세요' : kind === 'item' ? '장착할 내 유닛을 고르세요' : '주문을 쓸 레인을 고르세요'
        : isLocked(me, def) ? '전승 단계가 부족해 낼 수 없습니다' : kind === 'unit' && !me.lanes.includes(null) ? '빈 칸이 없습니다' : kind === 'item' && !me.lanes.some(Boolean) ? '장착할 유닛이 없습니다' : `${res}이(가) 부족합니다`;
      return `<b>${esc(def.name)}</b> <span>${msg}</span>
        ${overload ? `<em>${termHTML('폭주')}: 내 파멸 +${o.entropy}, 비용 -${o.discount}</em>` : ''}
        ${canDecay ? `<button class="btn small decay" data-act="decay-hand">☾ 제물 (+${decayGain.hand(def.level)} 영혼)</button>` : ''}${cancel}`;
    }
    if (sel?.k === 'unit') {
      const lane = me.lanes.findIndex((u) => u?.uid === sel.uid);
      const u = me.lanes[lane];
      if (!u) return '';
      const def = getCard(u.cardId);
      if (sel.heir) return `<span>혼이 빙의할 내 다른 유닛을 고르세요</span>${cancel}`;
      const others = me.lanes.some((x) => x && x.uid !== u.uid);
      return `<b>${esc(def.name)}</b>
        ${canAttack(u) ? '<span>턴을 끝내면 자동으로 공격합니다 (공격할 유닛은 제물로 바칠 수 없음)</span>' : `<button class="btn small decay" data-act="decay-board">☾ 제물 (+${decayGain.board(def.level)} 영혼)</button>
        ${others ? '<button class="btn small decay" data-act="heir">☾ 빙의 제물</button>' : ''}`}${cancel}`;
    }
    if (sel?.k === 'el') {
      if (me.faction === 'decay') return `<b>${getLand(me.elements[sel.picked[0]]).name}</b><button class="btn small decay" data-act="burn">☾ 대지 제물 (+${BALANCE.elements.burnGain} 영혼)</button>${cancel}`;
      const r = BALANCE.elements.react;
      if (sel.picked.length < 2) return `<span>융합할 대지를 하나 더 고르세요 (${sel.picked.length}/2)</span>${cancel}`;
      if (me.pool < r.cost) return `<span>융합 주문에는 금화 ${r.cost}이(가) 필요합니다</span>${cancel}`;
      return `<span>융합 주문을 쓸 레인을 고르세요 (금화 ${r.cost} · 피해 ${r.damage}, 빛+그림자면 +${r.ionBonus})</span>${cancel}`;
    }
    if (this.legal.length === 1) return '<span>할 수 있는 행동이 없습니다. 턴을 종료하세요.</span>';
    return `<span class="dim">카드를 끌어다 놓거나 클릭해서 내세요 (베이스는 클릭) · 공격할 수 있는 유닛은 턴 종료 때 자동 공격${me.faction === 'decay' ? ' · 유닛·대지를 클릭하면 제물' : me.faction === 'union' ? ' · 대지 2곳을 골라 융합 주문' : ''}</span>`;
  }
}
