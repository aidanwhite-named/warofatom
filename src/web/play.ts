import { getCard } from '../data/cards';
import { getElement } from '../data/elements';
import { FACTIONS } from '../data/factions';
import { BALANCE } from '../engine/config';
import { applyAction, costOf, createGame, isLocked, legalActions, levelCap, reducedDamage, type DeckSpec } from '../engine/game';
import { decayGain } from '../engine/resources';
import type { Action, CardDef, EntropyCause, Faction, GameEvent, GameState, PlayerState, Unit } from '../engine/types';
import { LANES } from '../engine/types';
import { chooseAction } from '../sim/bot';
import { cardBackHTML, cardHTML, esc, groupColor } from './cards';
import { anim, Fx, sleep } from './fx';

// 대전 화면. 엔진(applyAction)이 남긴 이벤트 로그를 순서대로 연출한 뒤 새 상태를 그린다.
//   그리기 전 연출: 공격·파괴·엔트로피 등 (이전 화면 위에서)
//   그린 뒤 연출: uid 비교로 새로 생긴 손패·유닛을 이전 위치(덱·손패)에서 날아오게 한다 (FLIP)

export type MatchOpts = { mine: DeckSpec; foe: DeckSpec; myName: string; foeName: string; admin: boolean; onExit(rematch: boolean): void };

type Side = 'me' | 'foe';
type Sel = { k: 'hand'; uid: number } | { k: 'unit'; uid: number; heir?: boolean } | { k: 'el'; picked: number[] } | null;

const STAGE_W = 1280, STAGE_H = 760;
const COLOR: Record<Faction, string> = { union: '#ff9d4d', covalent: '#5aa8ff', decay: '#b483ff' };
const ICON: Record<Faction, string> = { union: '⚡', covalent: '⬡', decay: '☢' };
const REASON = { combat: '전투', halfLife: '반감기', decay: '붕괴', effect: '효과', upkeep: '유지비' };
const CAUSE: Record<EntropyCause, string> = { natural: '자연 증가', attack: '공격', effect: '효과', fatigue: '덱 고갈', overload: '과부하', idle: '방치' };
const NATURE = { metal: '금속', nonmetal: '비금속', noble: '비활성' };

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
  private flown = new Set<string>(); // 상대가 낸 유닛 카드가 이미 연출로 날아간 칸
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
      <p>${why ?? (r === 'win' ? `상대 엔트로피 ${foe.entropy}/${max} — 상대가 소멸했습니다` : `내 엔트로피 ${me.entropy}/${max} — 소멸했습니다`)}</p>
      <p class="dim">${this.s.turn}턴 · 내 엔트로피 ${me.entropy} · 상대 엔트로피 ${foe.entropy} · 획득 원소 ${me.elements.length}개</p>
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
        await this.fx.banner(side === 'me' ? '내 턴' : '상대 턴', `턴 ${this.turnNo}`, side, 1150);
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
        } else if (kind !== 'unit' && a?.type === 'play') {
          const card = this.q(`[data-hand="${a.uid}"]`);
          if (card) await this.fx.moveTo(card, slot, 0.4, true, 380);
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
        const tgt = this.q(`[data-slot="${this.other(side)}-${e.lane}"]`);
        if (att && tgt) await this.fx.lunge(att, tgt, e.target === 'unit' ? '#ffd166' : '#ff5d8f');
        const defender = this.s.players[1 - e.p].lanes[e.lane];
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
        const tgt = this.q(`[data-slot="${this.other(side)}-${e.lane}"]`);
        if (!def || !tgt) break;
        const c = this.fx.center(def);
        this.fx.float('반격!', c.x, c.y - 60, 'buff');
        await this.fx.lunge(def, tgt, '#9ec5ff');
        const attacker = this.s.players[1 - e.p].lanes[e.lane];
        const blocked = attacker ? e.dmg - reducedDamage(attacker, e.dmg, 'armor') : 0;
        if (blocked > 0) { const t = this.fx.center(tgt); this.fx.float(`🛡 -${blocked}`, t.x, t.y - 50, 'buff'); }
        break;
      }
      case 'death': {
        const u = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        if (!u || u.dataset.dead) break;
        u.dataset.dead = '1';
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
        this.fx.float('원소 획득!', c.x, c.y - 30, 'buff');
        const chip = this.fx.spawn(`<span class="chip n-${getElement(e.element).nature}">${e.element}</span>`, c.x, c.y, 'flychip');
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
        this.fx.float(e.dmg > BALANCE.elements.react.damage ? '이온 반응!' : '반응!', c.x, c.y - 50, 'buff');
        this.fx.shake(slot, 9);
        await sleep(350);
        break;
      }
      case 'decay': {
        if (a?.type === 'decay' && a.from === 'hand') {
          if (side === 'me') {
            const card = this.q(`[data-hand="${a.uid}"]`);
            if (card) await anim(card, [{ filter: 'none', opacity: 1 }, { filter: 'hue-rotate(90deg) brightness(2) blur(4px)', opacity: 0, transform: `${getComputedStyle(card).transform === 'none' ? '' : getComputedStyle(card).transform} translateY(-40px)` }], { duration: 500, fill: 'forwards' });
          } else {
            const shown = await this.showcase(getCard(e.cardId));
            await anim(shown, [{ filter: 'none', opacity: 1 }, { filter: 'hue-rotate(90deg) brightness(2) blur(6px)', opacity: 0 }], { duration: 500 });
            shown.remove();
          }
        }
        this.floatOn(`[data-res="${side}"]`, `+${e.gain} 붕괴열`, 'buff');
        await sleep(250);
        break;
      }
      case 'burn':
        this.floatOn(`[data-tray="${side}"]`, `${e.element} 붕괴 +${e.gain}`, 'buff');
        await sleep(300);
        break;
      case 'transmute':
        this.floatOn(`[data-tray="${side}"]`, `${e.from}→${e.to}`, 'decay');
        await sleep(300);
        break;
      case 'inherit': {
        const slot = this.q(`[data-slot="${side}-${e.lane}"]`);
        if (!slot) break;
        const c = this.fx.center(slot);
        this.fx.ring(c.x, c.y, '#ffd166', 180);
        this.fx.float('계승', c.x, c.y - 40, 'buff');
        await sleep(350);
        break;
      }
      case 'charge': {
        const u = this.q(`[data-slot="${side}-${e.lane}"] .unit`);
        if (!u) break;
        const c = this.fx.center(u);
        this.fx.ring(c.x, c.y, '#ffe66b', 150);
        this.fx.float('⚡ 충전', c.x, c.y - 40, 'buff');
        await sleep(350);
        break;
      }
      case 'lattice':
        this.floatOn(`[data-res="${side}"]`, '⬡ 격자 +1', 'buff');
        await sleep(250);
        break;
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
        if (dh < 0) { this.fx.float(String(dh), c.x, c.y, 'dmg'); void anim(el, [{ filter: 'brightness(2.5) saturate(0)' }, { filter: 'none' }], { duration: 350 }); }
        if (dh > 0) this.fx.float(`+${dh}`, c.x + 30, c.y, 'heal');
        if (da) this.fx.float(`${da > 0 ? '+' : ''}${da} 공격`, c.x, c.y - 30, da > 0 ? 'buff' : 'dmg');
      });
      if (np.pool !== pp.pool) {
        const res = this.q(`[data-res="${side}"]`);
        if (res) void anim(res, [{ transform: 'scale(1.35)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 400 });
      }
    }
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
      this.sel = this.sel?.k === 'hand' && this.sel.uid === uid ? null : { k: 'hand', uid };
      return this.render();
    }
    const chip = t.closest<HTMLElement>('[data-el]');
    if (chip) return this.onElement(Number(chip.dataset.el));
    const lane = t.closest<HTMLElement>('[data-lane]');
    if (lane) return this.onLane(Number(lane.dataset.lane), lane.dataset.side as Side | 'tile');
    if (this.sel) { this.sel = null; this.render(); }
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
      case 'lattice': return void this.act({ type: 'lattice' });
      case 'decay-hand':
        if (sel?.k === 'hand') void this.act({ type: 'decay', from: 'hand', uid: sel.uid });
        return;
      case 'decay-board':
        if (sel?.k === 'unit') void this.act({ type: 'decay', from: 'board', uid: sel.uid });
        return;
      case 'heir':
        if (sel?.k === 'unit') { this.sel = { ...sel, heir: true }; this.render(); }
        return;
      case 'attack-sel': {
        const lane = sel?.k === 'unit' ? me.lanes.findIndex((u) => u?.uid === sel.uid) : -1;
        if (lane >= 0) void this.act({ type: 'attack', lane });
        return;
      }
      case 'burn':
        if (sel?.k === 'el') void this.act({ type: 'decay', from: 'element', element: me.elements[sel.picked[0]] });
        return;
    }
  }

  private onElement(i: number) {
    const me = this.me(), sym = me.elements[i];
    if (me.faction === 'union') {
      if (getElement(sym).nature === 'noble') return this.toast('비활성 원소는 반응하지 않습니다');
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
      if (this.canAttack(lane)) return void this.act({ type: 'attack', lane });
      this.toast(u.sick ? '이번 턴에 소환된 유닛은 공격할 수 없습니다' : u.atk <= 0 ? '공격력이 없는 유닛입니다' : '이미 공격했습니다');
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

  private canAttack(lane: number) {
    return this.legal.some((a) => a.type === 'attack' && a.lane === lane);
  }

  // 손패 끌어다 놓기. 8px 이상 움직이면 드래그, 아니면 클릭(선택)으로 처리
  private onPointerDown(ev: PointerEvent) {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-hand]');
    if (!card || !this.myTurn() || ev.button !== 0) return;
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
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-preview]');
    if (!el || this.drag) { box.classList.remove('show'); return; }
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

  private unitStatus(u: Unit, def: CardDef) {
    const rows = [
      `현재 ${u.atk} / ${u.hp}`,
      u.sick ? '이번 턴 소환됨 (공격 불가)' : u.attacked ? '이번 턴 공격함' : '',
      u.halfLife !== undefined ? `반감기 ${u.halfLife}턴 남음` : '',
      u.energy !== undefined ? `기력 ${u.energy}` : '',
      u.equipped?.length ? `장착: ${u.equipped.map((id) => getCard(id).name).join(', ')}` : '',
      u.inherited?.length ? `계승: ${u.inherited.map((id) => getCard(id).name).join(', ')}` : '',
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
      case 'lattice': return `${who}: 격자 배치 (총 ${e.total})`;
      case 'attack': return `${who}: ${e.lane + 1}번 레인 공격 → ${e.target === 'unit' ? '유닛' : '엔트로피'} (${e.dmg})`;
      case 'counter': return `${who}: 버텨내고 반격 (${e.dmg})`;
      case 'death': return `${who}의 ${n(e.cardId)} 파괴 (${REASON[e.reason]})`;
      case 'decay': return `${who}: ${n(e.cardId)} 붕괴 → 붕괴열 +${e.gain}`;
      case 'inherit': return `${who}: ${n(e.cardId)}의 능력 계승 (${e.lane + 1}번 레인)`;
      case 'charge': return `${who}의 ${n(e.cardId)} 충전 발동`;
      case 'capture': return `${who}: 원소 ${e.element} 획득 (${e.lane + 1}번 레인)`;
      case 'react': return `${who}: ${e.elements.join(' + ')} 반응 → ${e.lane + 1}번 레인 ${e.dmg} 피해`;
      case 'burn': return `${who}: 원소 ${e.element} 붕괴 → 붕괴열 +${e.gain}`;
      case 'transmute': return `${who}: ${e.from} → ${e.to} 붕괴 사슬`;
      case 'entropy': return `${who} 엔트로피 +${e.amount} (${CAUSE[e.cause]}) → ${e.total}`;
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
    const idle = mine && me.cardsUsedThisTurn === 0 && this.legal.some((a) => a.type === 'play' || (a.type === 'decay' && a.from === 'hand'));
    this.view.innerHTML = `
      <div class="tb-left"><button class="btn ghost" data-act="menu">☰ 나가기</button><button class="btn ghost" data-act="surrender" ${this.ended ? 'disabled' : ''}>🏳 항복</button></div>
      <div class="tb-right">${this.o.admin ? `<button class="btn ghost ${this.reveal ? 'on' : ''}" data-act="reveal" title="관리자 권한">👁 상대 손패</button>` : ''}<button class="btn ghost" data-act="log">📜 기록</button></div>
      ${this.panel('foe', foe)}${this.panel('me', me)}
      <div class="ley-box">${ley ? `<span>지맥</span><b>${esc(ley)}</b><small>이 계열 원소의 공명 ×${BALANCE.elements.leyline.resonanceMult}</small>` : '<small>지맥 없음</small>'}
        <small>남은 원소 ${s.tileBag.length}개</small></div>
      <div class="foe-hand">${this.foeHand(foe)}</div>
      <div class="board ${s.active === this.h ? 'my-turn' : 'foe-turn'}">${lanes}</div>
      ${this.pile('foe', foe)}${this.pile('me', me)}
      <div class="turn-pill ${s.active === this.h ? 'me' : 'foe'}">턴 ${this.turnNo}<b>${s.active === this.h ? '내 턴' : '상대 턴'}</b></div>
      <button class="end-turn ${idle ? 'idle' : onlyEnd ? 'glow' : ''}" data-act="end" ${mine ? '' : 'disabled'} title="${idle ? '낼 수 있는 카드를 한 장도 쓰지 않으면 엔트로피가 오릅니다' : ''}">${mine ? '턴 종료' : s.active === this.h ? '…' : '상대 턴'}${idle ? `<small>방치: 엔트로피 +${BALANCE.hand.idleEntropy}</small>` : ''}</button>
      <div class="hint">${this.hint()}</div>
      <div class="me-hand hand">${this.handHTML(me)}</div>
      <div class="preview"></div>
      <div class="log ${this.logOpen ? 'open' : ''}"><h4>전투 기록</h4><ol>${this.logLines.slice(-150).map((l) => `<li class="${l.startsWith('──') ? 'turn' : ''}">${esc(l)}</li>`).join('')}</ol></div>`;
    const ol = this.q('.log ol');
    if (ol) ol.scrollTop = ol.scrollHeight;
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

  private panel(side: Side, pl: PlayerState) {
    const f = FACTIONS[pl.faction], max = BALANCE.maxEntropy;
    const cap = levelCap(pl);
    const picked = side === 'me' && this.sel?.k === 'el' ? this.sel.picked : [];
    const clickable = side === 'me' && pl.faction !== 'covalent';
    const chips = pl.elements.map((e, i) => {
      const d = getElement(e);
      return `<button class="chip n-${d.nature} ${picked.includes(i) ? 'on' : ''}" style="--gc:${groupColor(d.group)}" data-el="${i}" ${clickable ? '' : 'disabled'} title="${d.name} · ${d.group} · ${d.period}주기 · ${NATURE[d.nature]}${d.decaysTo ? ` · 붕괴 → ${d.decaysTo}` : ''}">${e}</button>`;
    }).join('');
    const canLattice = this.legal.some((a) => a.type === 'lattice');
    const active = this.s.active === (side === 'me' ? this.h : 1 - this.h);
    return `<div class="panel ${side} f-${pl.faction} ${active ? 'active' : ''}" data-panel="${side}">
      <div class="p-head"><div class="avatar">${ICON[pl.faction]}</div>
        <div><div class="p-name">${esc(side === 'me' ? this.o.myName : this.o.foeName)}</div><div class="p-fac">${f.name}</div></div></div>
      <div class="meter ${pl.entropy >= max - 6 ? 'danger' : ''}" data-meter="${side}" title="엔트로피가 ${max}에 닿으면 소멸(패배)">
        <div class="m-fill" style="width:${(pl.entropy / max) * 100}%"></div><span class="m-txt">엔트로피 <b>${pl.entropy}</b> / ${max}</span></div>
      <div class="p-stats">
        <div class="res" data-res="${side}"><small>${f.resource}</small><b>${pl.pool}</b></div>
        ${pl.faction === 'covalent' ? `<div class="res lat"><small>격자</small><b>${pl.lattices}</b><i>더미 ${pl.latticePile}</i></div>` : ''}
        <div class="res tech" title="낼 수 있는 카드 레벨 상한"><small>연구</small><b>${pl.tech || '-'}</b><i>${Number.isFinite(cap) ? `Lv ${cap}까지` : '제한 없음'}</i></div>
      </div>
      <div class="tray" data-tray="${side}">${chips || '<span class="dim">획득한 원소 없음</span>'}</div>
      ${side === 'me' && pl.faction === 'covalent' ? `<button class="btn lattice" data-act="lattice" ${canLattice ? '' : 'disabled'}>⬡ 격자 배치 <small>(남은 ${pl.latticePile})</small></button>` : ''}
    </div>`;
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
    const badges = [
      u.halfLife !== undefined ? `<i title="반감기">⌛${u.halfLife}</i>` : '',
      charge ? `<i title="기력">⚡${u.energy ?? 0}/${charge}</i>` : '',
      kw('armor') ? `<i title="방어력">🛡${kw('armor')}</i>` : '',
      kw('resist') ? `<i title="저항">✧${kw('resist')}</i>` : '',
      u.equipped?.length ? `<i title="장착">⚔${u.equipped.length}</i>` : '',
      u.inherited?.length ? `<i title="계승">♻${u.inherited.length}</i>` : '',
    ].join('');
    const sel = this.sel;
    const cls = [
      side === 'me' && this.canAttack(lane) ? 'ready' : '',
      u.sick ? 'sick' : '',
      sel?.k === 'unit' && sel.uid === u.uid ? 'selected' : '',
    ].join(' ');
    return `<div class="unit f-${def.faction} ${cls}" data-uid="${u.uid}" data-preview="${def.id}">
      <div class="u-art"><span class="u-sym">${esc(def.element)}</span></div>
      <div class="u-name">${esc(def.name)}</div>
      <div class="u-badges">${badges}</div>
      <div class="u-atk ${u.atk > def.atk ? 'up' : ''}">${u.atk}</div>
      <div class="u-hp ${u.hp < baseHp ? 'hurt' : u.hp > baseHp ? 'up' : ''}">${u.hp}</div>
      ${u.sick ? '<div class="zzz">z<span>z</span></div>' : ''}
    </div>`;
  }

  private tile(lane: number) {
    const s = this.s, sym = s.tiles[lane];
    if (!sym) return `<div class="tile empty" data-tile="${lane}" data-lane="${lane}" data-side="tile"><span class="dim">원소 소진</span></div>`;
    const e = getElement(sym);
    const pips = (pl: PlayerState) => {
      const need = BALANCE.elements.captureTurns[pl.faction];
      return Array.from({ length: need }, (_, i) => `<i class="${i < pl.capture[lane] ? 'on' : ''}"></i>`).join('');
    };
    const match = this.selectedTiles().includes(lane);
    return `<div class="tile n-${e.nature} ${e.group === s.leyline ? 'ley' : ''} ${match ? 'match' : ''}" style="--gc:${groupColor(e.group)}" data-tile="${lane}" data-lane="${lane}" data-side="tile"
        title="${e.name} (${sym}) · ${e.group} · ${e.period}주기 · ${NATURE[e.nature]}${e.group === s.leyline ? ' · 지맥' : ''}&#10;레인을 혼자 지킨 채 턴을 ${BALANCE.elements.captureTurns[this.me().faction]}번 시작하면 획득">
      <div class="pips foe">${pips(this.foe())}</div>
      <span class="t-period">${e.period}</span><span class="t-sym">${sym}</span><span class="t-name">${e.name}</span><span class="t-group">${e.group}${e.group === s.leyline ? ' ★' : ''}</span><span class="t-nature">${NATURE[e.nature]}</span>
      <div class="pips me">${pips(this.me())}</div></div>`;
  }

  private pile(side: Side, pl: PlayerState) {
    const n = pl.deck.length;
    return `<div class="pile ${side} ${n <= 3 ? 'low' : ''}" data-pile="${side}">
      <div class="stack" style="--n:${Math.min(n, 6)}">${n ? cardBackHTML() : '<div class="empty-pile">덱 없음<small>드로우마다 엔트로피 +${BALANCE.fatigueEntropy}</small></div>'}</div>
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
      const playable = this.legal.some((a) => a.type === 'play' && a.uid === c.uid);
      const syn = this.synergy(me, def);
      const resonant = syn.discount > 0 || syn.buff > 0;
      const cls = ['hcard', playable ? 'playable' : '', locked ? 'locked' : '', resonant ? 'res' : ''].join(' ');
      const lock = locked ? `<div class="c-lock">🔒<b>Lv ${def.level}</b><small>연구 단계 부족 (지금 Lv ${levelCap(me)}까지)</small></div>` : '';
      const badges = [
        syn.discount > 0 ? `<span title="같은 원소를 가져 비용 -${syn.discount}">공명 −${syn.discount}</span>` : '',
        syn.buff > 0 ? `<span title="같은 계열 원소를 가져 소환 시 +${syn.buff}/+${syn.buff}">+${syn.buff}/+${syn.buff}</span>` : '',
        ...(resonant ? [] : syn.tiles.map((l) => `<span class="soft" title="${l + 1}번 레인의 ${this.s.tiles[l]}을(를) 장악하면 공명">⬡${this.s.tiles[l]}</span>`)),
      ].join('');
      const res = badges ? `<div class="c-res">${badges}</div>` : '';
      const isSel = sel?.k === 'hand' && sel.uid === c.uid;
      return `<div class="hslot ${isSel ? 'selected' : ''}" data-hand="${c.uid}" data-uid="${c.uid}" style="left:${x}px;top:${y}px;--r:${off * 3}deg;--gc:${groupColor(def.race)};z-index:${i + 1}">${cardHTML(def, { cost: syn.cost, cls, extra: lock + res })}</div>`;
    }).join('');
  }

  // 공명: discount = 같은 원소를 가져 비용 할인, buff = 같은 계열 원소를 가져 소환 시 +N/+N,
  //   tiles = 장악하면 이 카드에 공명이 생기는 레인
  private synergy(pl: PlayerState, def: CardDef) {
    const cost = costOf(this.s, pl, def);
    const ownGroup = pl.elements.some((e) => getElement(e).group === def.race);
    const mult = def.race === this.s.leyline ? BALANCE.elements.leyline.resonanceMult : 1;
    const buff = (def.kind ?? 'unit') === 'unit' && ownGroup ? BALANCE.elements.groupBuff * mult : 0;
    const tiles = this.s.tiles.flatMap((t, i) => (t && (t === def.element || getElement(t).group === def.race) ? [i] : []));
    return { cost, discount: def.level - cost, buff, tiles };
  }

  // 선택한 손패 카드와 공명하는 원소 타일 레인
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
        ? kind === 'unit' ? '소환할 빈 칸을 고르세요' : kind === 'item' ? '장착할 내 유닛을 고르세요' : '마법을 쓸 레인을 고르세요'
        : isLocked(me, def) ? '연구 단계가 부족해 낼 수 없습니다' : kind === 'unit' && !me.lanes.includes(null) ? '빈 칸이 없습니다' : kind === 'item' && !me.lanes.some(Boolean) ? '장착할 유닛이 없습니다' : `${res}이(가) 부족합니다`;
      return `<b>${esc(def.name)}</b> <span>${msg}</span>
        ${overload ? `<em>과부하: 내 엔트로피 +${o.entropy}, 비용 -${o.discount}</em>` : ''}
        ${canDecay ? `<button class="btn small decay" data-act="decay-hand">☢ 붕괴 (+${decayGain.hand(def.level)} 붕괴열)</button>` : ''}${cancel}`;
    }
    if (sel?.k === 'unit') {
      const lane = me.lanes.findIndex((u) => u?.uid === sel.uid);
      const u = me.lanes[lane];
      if (!u) return '';
      const def = getCard(u.cardId);
      if (sel.heir) return `<span>능력을 물려받을 내 다른 유닛을 고르세요</span>${cancel}`;
      const others = me.lanes.some((x) => x && x.uid !== u.uid);
      return `<b>${esc(def.name)}</b>
        ${this.canAttack(lane) ? '<button class="btn small primary" data-act="attack-sel">⚔ 공격</button>' : ''}
        <button class="btn small decay" data-act="decay-board">☢ 붕괴 (+${decayGain.board(def.level)})</button>
        ${others ? '<button class="btn small decay" data-act="heir">♻ 계승 붕괴</button>' : ''}${cancel}`;
    }
    if (sel?.k === 'el') {
      if (me.faction === 'decay') return `<b>원소 ${me.elements[sel.picked[0]]}</b><button class="btn small decay" data-act="burn">☢ 원소 붕괴 (+${BALANCE.elements.burnGain} 붕괴열)</button>${cancel}`;
      const r = BALANCE.elements.react;
      if (sel.picked.length < 2) return `<span>반응시킬 원소를 하나 더 고르세요 (${sel.picked.length}/2)</span>${cancel}`;
      if (me.pool < r.cost) return `<span>반응에는 금화 ${r.cost}이(가) 필요합니다</span>${cancel}`;
      return `<span>반응을 일으킬 레인을 고르세요 (금화 ${r.cost} · 피해 ${r.damage}, 금속+비금속이면 +${r.ionBonus})</span>${cancel}`;
    }
    if (this.legal.length === 1) return '<span>할 수 있는 행동이 없습니다. 턴을 종료하세요.</span>';
    return `<span class="dim">카드를 끌어다 놓거나 클릭해서 내세요 · 빛나는 유닛을 클릭하면 공격${me.faction === 'decay' ? ' · 유닛·원소를 클릭하면 붕괴' : me.faction === 'union' ? ' · 원소 2개를 골라 반응' : ''}</span>`;
  }
}
