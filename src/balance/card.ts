import { CARDS } from '../data/cards';
import type { CardDef, EffectDef } from '../engine/types';
import { WEIGHTS } from './weights';
import { scoreCard, statSplits } from './score';

// 카드 밸런스 도구. 사용: npm run card -- <audit | make ...>
//   audit                         현재 카드 전체의 점수/예산 비교
//   make --level 4 [--atk 4 --hp 5] [--upkeep 1] [--halfLife 3] [--armor 1] [--resist 1] [--charge 2] [--fx entropy:2+chain] [--fx draw:1+death] [--fx healSelf:2+charge]
//     --fx 형식: op:n[+chain][+death][+charge], buffSelf는 buffSelf:atk/hp (예: buffSelf:1/1+chain)
//     --atk, --hp를 생략하면 남은 예산에 맞는 조합을 보여준다.
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

function make(argv: string[]) {
  const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? undefined : argv[i + 1]; };
  const fxs = argv.flatMap((a, i) => (a === '--fx' ? [parseFx(argv[i + 1])] : []));
  const level = Number(opt('level'));
  if (!level) throw new Error('--level 필요');
  const upkeep = Number(opt('upkeep') ?? 0);
  if (upkeep > WEIGHTS.maxUpkeep) throw new Error(`유지비 상한은 ${WEIGHTS.maxUpkeep}`);
  const hl = opt('halfLife');
  const kw = [hl && `halfLife:${hl}`, opt('armor') && `armor:${opt('armor')}`, opt('resist') && `resist:${opt('resist')}`, opt('charge') && `charge:${opt('charge')}`].filter(Boolean) as string[];
  const keywords = kw.length ? kw : undefined;
  const base: Pick<CardDef, 'level' | 'upkeep' | 'keywords' | 'effects'> = { level, upkeep, keywords, effects: fxs };

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

if (cmd === 'audit') audit();
else if (cmd === 'make') make(rest);
else console.log('사용법: npm run card -- audit | make --level N [--atk A --hp H] [--upkeep U] [--halfLife N] [--armor N] [--resist N] [--charge N] [--fx op:n[+chain][+death][+charge]]');
