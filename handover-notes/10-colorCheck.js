// 색상 토큰 마이그레이션 등가성 검사 (v2 — 양쪽에 같은 추출 함수).
// 파일마다 "색 원자"의 순서열을 뽑아 원본(git HEAD)과 현재를 비교한다.
// 원자 = 헥스 리터럴 ∪ 토큰 클래스(text-mint-500, bg-gray-400 …) ∪ rgb(var(--mint-N)) ∪ MINT_HEX[N] ∪ accent={N}
// 전부 헥스로 정규화. 순서열이 같으면 "같은 자리에 같은 색". 의도된 병합(MERGE)은 양쪽 모두에 적용해 흡수한다.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/playground/MINT_MLP';

const TOKEN = {
  'mint-50': '#F5FBF8', 'mint-100': '#E8F8F5', 'mint-200': '#D4F3EE', 'mint-500': '#3CDBC0',
  'mint-600': '#2AB5A0', 'mint-800': '#1A7A6E', 'mint-900': '#0F4E46',
  kakao: '#FEE500', naver: '#03C75A',
  'gray-400': '#9CA3AF', 'gray-200': '#E5E7EB', 'gray-900': '#111827', 'slate-400': '#94A3B8',
  'red-500': '#EF4444', 'rose-500': '#F43F5E', 'amber-500': '#F59E0B', 'orange-500': '#F97316',
  'yellow-500': '#EAB308', 'yellow-100': '#FEF9C3', 'green-500': '#22C55E', 'sky-500': '#0EA5E9',
  'blue-500': '#3B82F6', 'violet-500': '#8B5CF6', white: '#FFFFFF',
};
const VAR = { 50: '#F5FBF8', 100: '#E8F8F5', 200: '#D4F3EE', 500: '#3CDBC0', 600: '#2AB5A0', 800: '#1A7A6E', 900: '#0F4E46' };
const MERGE = { '#36CFA0': '#3CDBC0', '#2AB58C': '#2AB5A0', '#FFE812': '#FEE500' };
const norm = (h) => { const u = h.toUpperCase(); return MERGE[u] ?? u; };

const tokenRe = new RegExp(`(?<=[a-z]-)(${Object.keys(TOKEN).join('|')})(?=[\\s"'\`/\\]}]|$)`, 'g');
function atoms(src) {
  const found = [];
  const push = (re, fn) => { for (const m of src.matchAll(re)) found.push({ i: m.index, hex: fn(m) }); };
  push(/#[0-9A-Fa-f]{6}\b/g, (m) => norm(m[0]));
  push(/rgb\(var\(--mint-(\d+)\)/g, (m) => VAR[m[1]]);
  push(/MINT_HEX\[(\d+)\]/g, (m) => VAR[m[1]]);
  push(/accent=\{(\d+)\}/g, (m) => VAR[m[1]]);
  push(tokenRe, (m) => TOKEN[m[1]]);
  return found.sort((a, b) => a.i - b.i).map((x) => x.hex);
}

const files = execSync('git ls-files src index.html', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter((f) => /\.(tsx?|css|html)$/.test(f));
let bad = 0, checked = 0, totalAtoms = 0;
for (const f of files) {
  let oldSrc;
  try { oldSrc = execSync(`git show HEAD:${f}`, { cwd: ROOT, encoding: 'utf8' }); } catch { continue; }
  const newPath = path.join(ROOT, f);
  if (!fs.existsSync(newPath)) continue;
  if (f === 'src/index.css') continue; // :root 정의 자체가 바뀌는 파일 — 육안 확인
  const a = atoms(oldSrc), b = atoms(fs.readFileSync(newPath, 'utf8'));
  checked++; totalAtoms += a.length;
  if (a.join(',') !== b.join(',')) {
    bad++;
    console.log(`\n✗ ${f}: 원본 ${a.length}개 vs 현재 ${b.length}개`);
    const n = Math.max(a.length, b.length);
    for (let i = 0, shown = 0; i < n && shown < 6; i++) if (a[i] !== b[i]) { console.log(`   [${i}] ${a[i] ?? '(없음)'} → ${b[i] ?? '(없음)'}`); shown++; }
  }
}
console.log(`\n검사 ${checked}파일 · 색 원자 ${totalAtoms}개 · 불일치 ${bad}파일 (0이어야 통과)`);
process.exitCode = bad ? 1 : 0;
