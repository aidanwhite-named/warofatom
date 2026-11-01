// 연출 헬퍼. Web Animations API를 Promise로 감싸고, 좌표는 무대(1280×760) 기준으로 바꿔 쓴다
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function anim(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  return el.animate(keyframes, { easing: 'ease-out', ...opts }).finished.then(() => undefined, () => undefined);
}

export type Box = { x: number; y: number; w: number; h: number };

export class Fx {
  constructor(private readonly stage: HTMLElement, readonly layer: HTMLElement) {}

  // 화면 좌표 → 무대 좌표 (무대는 화면 크기에 맞춰 scale 되어 있다)
  local(r: DOMRect): Box {
    const s = this.stage.getBoundingClientRect();
    const k = s.width / this.stage.offsetWidth;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  }

  center(el: Element) {
    const b = this.local(el.getBoundingClientRect());
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  // (x, y)를 중심으로 연출 요소를 띄운다
  spawn(html: string, x: number, y: number, cls = ''): HTMLElement {
    const d = document.createElement('div');
    d.className = `fx-item ${cls}`;
    d.innerHTML = html;
    this.layer.append(d);
    d.style.left = `${x - d.offsetWidth / 2}px`;
    d.style.top = `${y - d.offsetHeight / 2}px`;
    return d;
  }

  // 떠오르는 숫자·글자 (기다리지 않는다)
  float(text: string, x: number, y: number, cls: string) {
    const d = this.spawn(text, x, y, `float ${cls}`);
    void anim(d, [
      { transform: 'translateY(0) scale(.5)', opacity: 0 },
      { transform: 'translateY(-14px) scale(1.25)', opacity: 1, offset: 0.2 },
      { transform: 'translateY(-60px) scale(1)', opacity: 0 },
    ], { duration: 1200 }).then(() => d.remove());
  }

  ring(x: number, y: number, color: string, size = 160) {
    const d = this.spawn('', x, y, 'ring');
    d.style.setProperty('--c', color);
    void anim(d, [
      { transform: 'scale(.2)', opacity: 1 },
      { transform: `scale(${size / 40})`, opacity: 0 },
    ], { duration: 600 }).then(() => d.remove());
  }

  sparks(x: number, y: number, color: string, n = 14, dist = 70) {
    for (let i = 0; i < n; i++) {
      const d = this.spawn('', x, y, 'spark');
      d.style.setProperty('--c', color);
      const a = Math.random() * Math.PI * 2, r = dist * (0.5 + Math.random());
      void anim(d, [
        { transform: 'translate(0,0) scale(1.2)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(.2)`, opacity: 0 },
      ], { duration: 500 + Math.random() * 300 }).then(() => d.remove());
    }
  }

  shake(el: Element | null, px = 6) {
    if (!el) return;
    void anim(el, [0, 1, 2, 3, 4, 5].map((i) => ({ transform: i === 5 ? 'translate(0,0)' : `translate(${(i % 2 ? -1 : 1) * px}px, ${(i % 3 - 1) * px * 0.5}px)` })), { duration: 320, easing: 'linear' });
  }

  // el을 target 중심으로 옮긴다. 끝난 자리에 그대로 남는다 (fill forwards)
  async moveTo(el: HTMLElement, target: Element, scale = 1, fade = false, ms = 450) {
    const a = this.center(el), b = this.center(target);
    const base = getComputedStyle(el).transform;
    const t0 = base === 'none' ? '' : ` ${base}`;
    await anim(el, [
      { transform: `translate(0px, 0px)${t0} scale(1)`, opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px)${t0} scale(${scale})`, opacity: fade ? 0 : 1 },
    ], { duration: ms, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
  }

  // FLIP: 방금 그려진 el을 이전 위치(from)에서 지금 자리로 날아오게 한다
  async flip(el: HTMLElement, from: DOMRect, ms = 450, delay = 0) {
    const f = this.local(from), t = this.local(el.getBoundingClientRect());
    const dx = f.x + f.w / 2 - (t.x + t.w / 2), dy = f.y + f.h / 2 - (t.y + t.h / 2), k = f.w / t.w;
    const base = getComputedStyle(el).transform;
    const b = base === 'none' ? '' : ` ${base}`;
    await anim(el, [
      { transform: `translate(${dx}px, ${dy}px) scale(${k})${b}` },
      { transform: `translate(0px, 0px) scale(1)${b}` },
    ], { duration: ms, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' });
  }

  // 공격: 뒤로 살짝 물러났다가 대상 쪽으로 돌진하고 돌아온다. 부딪히는 순간 onHit
  async lunge(el: HTMLElement, target: Element, color: string) {
    const a = this.center(el), b = this.center(target);
    const dx = b.x - a.x, dy = b.y - a.y;
    el.style.zIndex = '30';
    const go = anim(el, [
      { transform: 'translate(0px, 0px) scale(1)' },
      { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.08)`, offset: 0.35 },
      { transform: `translate(${dx * 0.62}px, ${dy * 0.62}px) scale(1.12)`, offset: 0.6 },
      { transform: 'translate(0px, 0px) scale(1)' },
    ], { duration: 640, easing: 'ease-in-out' });
    await sleep(380);
    const hx = a.x + dx * 0.8, hy = a.y + dy * 0.8;
    this.ring(hx, hy, color, 120);
    this.sparks(hx, hy, color, 16, 80);
    this.shake(target, 8);
    await go;
    el.style.zIndex = '';
  }

  // 두 점 사이의 번개/광선
  async beam(from: Element, to: Element, color: string) {
    const a = this.center(from), b = this.center(to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = document.createElement('div');
    d.className = 'fx-item beam';
    d.style.cssText = `left:${a.x}px;top:${a.y - 4}px;width:${len}px;--c:${color};transform:rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
    this.layer.append(d);
    await anim(d, [{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: 0.4 }, { clipPath: 'inset(0 0 0 0)', opacity: 0 }], { duration: 520 });
    d.remove();
  }

  // 빛 구슬이 from에서 to로 날아간다
  async orb(from: Element, to: Element, color: string) {
    const a = this.center(from);
    const d = this.spawn('', a.x, a.y, 'orb');
    d.style.setProperty('--c', color);
    await this.moveTo(d, to, 0.6, false, 420);
    const b = this.center(to);
    this.sparks(b.x, b.y, color, 10, 50);
    d.remove();
  }

  // 숫자 칸(el)의 값을 from에서 to로 세어 올리며(내리며) 통통 튀게 한다
  async count(el: HTMLElement | null, from: number, to: number, ms = 520) {
    if (!el) return;
    el.textContent = String(from);
    void anim(el, [{ transform: 'scale(1)', filter: 'none' }, { transform: 'scale(1.5)', filter: 'brightness(2)', offset: 0.35 }, { transform: 'scale(1)', filter: 'none' }], { duration: ms + 200 });
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        el.textContent = String(Math.round(from + (to - from) * k));
        if (k < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }

  // el을 빛나게 한 뒤 작아지며 target 쪽으로 빨려 들어가게 하고, 그 뒤를 영혼 구슬 여러 개가 줄지어 따라간다 (제물).
  // 다 들어가면 target이 고리와 빛으로 한 번 크게 번쩍인다
  async absorb(el: HTMLElement, target: HTMLElement, color: string, ms = 520) {
    await anim(el, [{ filter: 'none' }, { filter: `brightness(1.8) drop-shadow(0 0 14px ${color})` }], { duration: 220, fill: 'forwards' });
    const from = this.center(el);
    const wisps = [0, 1, 2, 3].map((i) => sleep(ms * 0.2 + i * 110).then(async () => {
      const d = this.spawn('', from.x + (Math.random() - 0.5) * 40, from.y + (Math.random() - 0.5) * 40, 'orb');
      d.style.setProperty('--c', color);
      await this.moveTo(d, target, 0.5, false, 380);
      d.remove();
    }));
    await Promise.all([this.moveTo(el, target, 0.18, true, ms), ...wisps]);
    const b = this.center(target);
    this.ring(b.x, b.y, color, 170);
    this.sparks(b.x, b.y, color, 18, 70);
    void anim(target, [{ boxShadow: `0 0 0 0 ${color}00` }, { boxShadow: `0 0 26px 8px ${color}`, offset: 0.3 }, { boxShadow: `0 0 0 0 ${color}00` }], { duration: 800 });
  }

  async banner(title: string, sub: string, cls: string, ms = 1100) {
    const d = document.createElement('div');
    d.className = `banner ${cls}`;
    d.innerHTML = `<b>${title}</b><small>${sub}</small>`;
    this.layer.append(d);
    await anim(d, [
      { opacity: 0, transform: 'translate(-50%, -50%) scaleX(.2)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scaleX(1)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%, -50%) scaleX(1)', offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' },
    ], { duration: ms });
    d.remove();
  }
}
