import { CARDS, getCard, registerCard } from '../data/cards';
import { DECK_LIST, DECKS } from '../data/decks';
import { FACTION_RACES } from '../data/factions';
import { createGame, validateDeck, type DeckSpec } from '../engine/game';
import type { CardDef, EffectDef, Faction } from '../engine/types';
import { playGame } from '../sim/bot';
import { WEIGHTS } from './weights';
import { scoreCard, statSplits } from './score';

// 카드 밸런스 도구. 사용: npm run card -- <audit | make ...>
//   audit                         현재 카드 전체의 점수/예산 비교
//   make --level 4 [--atk 4 --hp 5] [--upkeep 1] [--halfLife 3] [--armor 1] [--resist 1] [--charge 2] [--fx entropy:2+chain] [--fx draw:1+death] [--fx healSelf:2+charge]
//     --fx 형식: op:n[+chain][+death][+charge], buffSelf는 buffSelf:atk/hp (예: buffSelf:1/1+chain)
//     --atk, --hp를 생략하면 남은 예산에 맞는 조합을 보여준다.
//   test --id ID | --faction F (make 옵션, --atk --hp 필수) [--race R] [--land L] [--copies 2] [--out 뺄카드] [--n 200]
//     카드를 그 세력 프리셋 덱마다 같은 레벨 카드와 바꿔 넣고 기본 덱 3개 상대 승률 변화를 잰다
const [cmd, ...rest] = process.argv.slice(2);

function parseFx(spec: string): EffectDef {
  const [body, ...flags] = spec.split('+');
  const [op, val] = body.split(':');
  const args: Record<string, number> = op === 'buffSelf'
    ? { atk: Number(val.split('/')[0]), hp: Number(val.split('/')[1]) }
    : { n: Number(val) };
  return { trigger: flags.includes('death') ? 'onDeath' : flags.includes('charge') ? 'onCharge' : 'onPlay', op, args, chain: flags.includes('chain') || undefined };
}

const fmt = (n: number) => n.toFixed(1);

function audit() {
  console.log('id'.padEnd(14), 'Lv', '유지', '점수'.padStart(5), '예산'.padStart(5), '차이'.padStart(5));
  const byLevel = new Map<number, number[]>();
  for (const c of [...CARDS].sort((a, b) => a.level - b.level)) {
    const r = scoreCard(c);
    const flag = r.diff > 1.5 ? ' ▲강함' : r.diff < -1.5 ? ' ▽약함' : '';
    console.log(c.id.padEnd(14), String(c.level).padStart(2), String(c.upkeep ?? 0).padStart(3), fmt(r.total).padStart(7), fmt(r.budget).padStart(5), fmt(r.diff).padStart(5) + flag);
    byLevel.set(c.level, [...(byLevel.get(c.level) ?? []), r.total]);
  }
  console.log('\n레벨별 평균 점수 (예산을 정할 때 참고)');
  for (const [lv, xs] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    console.log(`Lv${lv}: 평균 ${fmt(xs.reduce((a, b) => a + b, 0) / xs.length)}  (예산 ${fmt(scoreCard({ level: lv, atk: 0, hp: 0 }).budget)})`);
  }
}

const optOf = (argv: string[]) => (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? undefined : argv[i + 1]; };

// make·test 공통: 레벨·유지비·키워드·효과 옵션을 카드 모양으로
function specFrom(argv: string[]): Pick<CardDef, 'level' | 'keywords' | 'effects'> & { upkeep: number } {
  const opt = optOf(argv);
  const fxs = argv.flatMap((a, i) => (a === '--fx' ? [parseFx(argv[i + 1])] : []));
  const level = Number(opt('level'));
  if (!level) throw new Error('--level 필요');
  const upkeep = Number(opt('upkeep') ?? 0);
  if (upkeep > WEIGHTS.maxUpkeep) throw new Error(`유지비 상한은 ${WEIGHTS.maxUpkeep}`);
  if (upkeep > level) throw new Error(`유지비는 레벨(${level})을 넘을 수 없다`);
  const hl = opt('halfLife');
  const kw = [hl && `halfLife:${hl}`, opt('armor') && `armor:${opt('armor')}`, opt('resist') && `resist:${opt('resist')}`, opt('charge') && `charge:${opt('charge')}`].filter(Boolean) as string[];
  const keywords = kw.length ? kw : undefined;
  return { level, upkeep, keywords, effects: fxs };
}

function make(argv: string[]) {
  const opt = optOf(argv);
  const base = specFrom(argv);
  const { level, upkeep } = base;
  const hl = opt('halfLife');

  if (opt('atk') === undefined || opt('hp') === undefined) {
    const other = scoreCard({ ...base, atk: 0, hp: 0 }).items.slice(1).reduce((a, b) => a + b.points, 0);
    const splits = statSplits(level, upkeep, other, hl ? Number(hl) : undefined);
    console.log(`Lv${level} 유지비 ${upkeep}: 효과 ${fmt(other)}점 사용, 가능한 공격/체력 조합`);
    console.log(splits.map((s) => `${s.atk}/${s.hp}`).join('  ') || '(예산 초과)');
    return;
  }
  const r = scoreCard({ ...base, atk: Number(opt('atk')), hp: Number(opt('hp')) });
  for (const it of r.items) console.log(`  ${it.label.padEnd(44)} ${fmt(it.points).padStart(6)}`);
  console.log(`  ${'합계'.padEnd(44)} ${fmt(r.total).padStart(6)}  / 예산 ${fmt(r.budget)}`);
  console.log(r.diff > 0.5 ? `→ 예산 ${fmt(r.diff)}점 초과 (레벨 대비 강함)` : r.diff < -1.5 ? `→ 예산 ${fmt(-r.diff)}점 남음 (약함)` : '→ 레벨에 맞음');
}

// 승률 측정: 카드를 그 세력의 프리셋 덱마다 같은 레벨(없으면 가까운 레벨) 카드 --copies장과 바꿔 넣고,
// 세 세력 기본 덱 상대 승률이 얼마나 바뀌는지 같은 시드로 잰다. 점수표가 못 보는 세력 메커니즘과의 상호작용을 잡는 용도
function test(argv: string[]) {
  const opt = optOf(argv);
  const N = Number(opt('n') ?? 200);
  const copies = Number(opt('copies') ?? 2);
  let def: CardDef;
  if (opt('id')) def = getCard(opt('id')!);
  else {
    const faction = opt('faction') as Faction;
    if (!FACTION_RACES[faction]) throw new Error('--faction union|covalent|decay 필요 (기존 카드는 --id)');
    if (opt('atk') === undefined || opt('hp') === undefined) throw new Error('--atk, --hp 필요');
    const land = opt('land');
    def = { id: 'test_card', name: '시험 카드', faction, race: opt('race') ?? '시험', ...(land ? { land } : {}), ...specFrom(argv), atk: Number(opt('atk')), hp: Number(opt('hp')) };
    registerCard(def);
  }
  const s = scoreCard(def);
  console.log(`${def.name} (${def.faction} · ${def.race} · Lv${def.level}): 점수 ${fmt(s.total)} / 예산 ${fmt(s.budget)} (${s.diff >= 0 ? '+' : ''}${fmt(s.diff)})`);
  if (def.kind === 'spell') console.log('※ 주문: 첨탑에 쌓이는 값은 점수표에 없다');
  console.log(`덱마다 ${copies}장 교체, 기본 덱 3개 상대 각 ${N}판 (같은 시드). 평균 변화가 ±3%p를 넘으면 ◀\n`);

  const factions: Faction[] = ['union', 'covalent', 'decay'];
  const rate = (a: DeckSpec, b: DeckSpec) => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const aFirst = i % 2 === 0;
      const { state } = playGame(createGame(aFirst ? a : b, aFirst ? b : a, i * 7919 + 13));
      if (state.winner === (aFirst ? 0 : 1)) w++;
    }
    return w / N;
  };
  const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);
  console.log(`${'덱'.padEnd(18)} 뺀 카드${' '.repeat(18)} vs ${factions.join(' / ')} (전→후)          평균 변화`);
  for (const d of DECK_LIST.filter((d) => d.spec.faction === def.faction)) {
    if (d.spec.cards.includes(def.id)) { console.log(`${d.name.padEnd(18)} (이미 들어 있음)`); continue; }
    // 같은 종류(유닛·주문·장비) → 같은 레벨에 가까운 카드 → 장수가 많은 카드 순으로 뺀다 (--out으로 지정 가능)
    const cards = [...d.spec.cards];
    const kindGap = (id: string) => ((getCard(id).kind ?? 'unit') === (def.kind ?? 'unit') ? 0 : 1);
    const pool = [...new Set(cards)].filter((id) => getCard(id).kind !== 'base')
      .sort((a, b) => kindGap(a) - kindGap(b) || Math.abs(getCard(a).level - def.level) - Math.abs(getCard(b).level - def.level) || cards.filter((x) => x === b).length - cards.filter((x) => x === a).length);
    if (opt('out') && cards.includes(opt('out')!)) pool.unshift(opt('out')!);
    const removed: string[] = [];
    for (const id of pool) while (removed.length < copies && cards.includes(id)) { cards.splice(cards.indexOf(id), 1); removed.push(id); }
    const spec: DeckSpec = { faction: d.spec.faction, cards: cards.concat(Array(copies).fill(def.id)) };
    const errors = validateDeck(spec);
    if (errors.length) { console.log(`${d.name.padEnd(18)} 덱 규칙 위반: ${errors.join(', ')}`); continue; }
    const before = factions.map((f) => rate(d.spec, DECKS[f]));
    const after = factions.map((f) => rate(spec, DECKS[f]));
    const delta = after.reduce((a, b) => a + b, 0) / 3 - before.reduce((a, b) => a + b, 0) / 3;
    const out = [...new Set(removed)].map((id) => `${getCard(id).name}×${removed.filter((x) => x === id).length}`).join(', ');
    const cols = factions.map((_, i) => `${pct(before[i])}→${pct(after[i])}`).join('  ');
    console.log(`${d.name.padEnd(18)} ${out.padEnd(24)} ${cols}   ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%p${Math.abs(delta) > 0.03 ? ' ◀' : ''}`);
  }
}

if (cmd === 'audit') audit();
else if (cmd === 'make') make(rest);
else if (cmd === 'test') test(rest);
else console.log('사용법: npm run card -- audit | make --level N [--atk A --hp H] [--upkeep U] [--halfLife N] [--armor N] [--resist N] [--charge N] [--fx op:n[+chain][+death][+charge]]\n'
  + '       npm run card -- test (--id 카드 | --faction F --level N --atk A --hp H [make 옵션] [--race R] [--land L]) [--copies 2] [--out 뺄카드] [--n 200]');
