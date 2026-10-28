// v2 직원 페이지 빌드: head.html 틀에 css/*.css, js/*.js 를 이름 순서대로 한 파일로 넣어요.
//   node v2/staff-src/build.mjs          -> v2/staff.html
//   node v2/staff-src/build.mjs --dev    -> .ui-design/v2-dev/staff.html (dev/harness.js 포함, assets 복사)
//   node v2/staff-src/build.mjs --dev --out <이름>  -> .ui-design/v2-dev/<이름>/staff.html (작업자끼리 안 겹치게)
//   ... --only 10,11   js 는 00~04 와 이 번호로 시작하는 파일만 (다른 작업자가 고치는 중인 파일 빼기). css 는 전부
// Node 18+ 기본 모듈만 써요.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const V2 = join(SRC, '..');
const ROOT = join(V2, '..');
const DEV = process.argv.includes('--dev');
const HARNESS_MARK = '__V2_DEV_HARNESS__';
const outIdx = process.argv.indexOf('--out');
const OUT_NAME = outIdx > 0 ? process.argv[outIdx + 1] : null;
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? String(process.argv[onlyIdx + 1] || '').split(',').filter(Boolean) : null;

const fail = msg => { console.error(`build failed: ${msg}`); process.exit(1); };
if (onlyIdx > 0 && (!DEV || !ONLY.length)) fail('--only <prefix,…> works only with --dev');
if (outIdx > 0 && (!DEV || !/^[a-z0-9-]+$/.test(OUT_NAME || ''))) fail('--out <name> works only with --dev, name = [a-z0-9-]');
const list = (dir, ext) => readdirSync(join(SRC, dir)).filter(f => f.endsWith(ext)).sort();
const read = p => readFileSync(join(SRC, p), 'utf8');

// 정적 import 줄 (동적 import('…') 는 해당 안 됨)
const IMPORT_RE = /^[ \t]*import\s+(?:[\w*{][^;'"]*\s+from\s+)?['"][^'"]+['"]\s*;?[ \t]*$/gm;
const AsyncFunction = (async () => {}).constructor;

// 파일 하나가 블록 하나({ … })인지: 'if(0) 본문 else;' 가 문법상 맞으려면 본문이 문장 하나여야 해요.
function checkBlock(name, body) {
  const lead = body.replace(/^(?:\s+|\/\/[^\n]*\n?|\/\*[\s\S]*?\*\/)*/, '');
  if (!lead.startsWith('{')) fail(`${name}: must be wrapped in one block { … } (found code outside a block)`);
  try { new AsyncFunction(`'use strict';if(0)${body}\nelse;`); }
  catch (e) { fail(`${name}: must be exactly one block { … } with nothing outside it (${e.message})`); }
}

const head = read('head.html');
if (!head.includes('<!--STYLE-->') || !head.includes('<!--SCRIPT-->')) fail('head.html needs <!--STYLE--> and <!--SCRIPT--> markers');

// CSS
const cssFiles = list('css', '.css');
if (!cssFiles.length) fail('no css files');
const css = cssFiles.map(f => {
  const t = read(join('css', f));
  if (/<\/style/i.test(t)) fail(`css/${f}: contains </style`);
  return `/* ── css/${f} ── */\n${t.trim()}\n`;
}).join('\n');

// JS
const jsFiles = list('js', '.js').filter(f => !ONLY || /^0\d-/.test(f) || ONLY.some(p => f.startsWith(p)));
if (!jsFiles.length) fail('no js files');
const entries = [];
for (const f of jsFiles) {
  entries.push({ name: `js/${f}`, text: read(join('js', f)) });
  if (DEV && f === '01-api.js') {
    if (!existsSync(join(SRC, 'dev', 'harness.js'))) fail('dev/harness.js missing');
    entries.push({ name: 'dev/harness.js', text: read(join('dev', 'harness.js')) });
  }
}
if (DEV && !entries.some(e => e.name === 'dev/harness.js')) fail('js/01-api.js missing, nowhere to inject the harness');

const imports = [];
const importFiles = [];
const parts = entries.map(({ name, text }) => {
  if (/<\/script/i.test(text)) fail(`${name}: contains </script`);
  const found = text.match(IMPORT_RE) || [];
  let body = text;
  if (found.length) {
    importFiles.push(name);
    if (name !== 'js/00-config.js') fail(`${name}: only js/00-config.js may have an import line`);
    imports.push(...found.map(s => s.trim()));
    body = text.replace(IMPORT_RE, '');
  }
  if (name !== 'dev/harness.js' && body.includes(HARNESS_MARK)) fail(`${name}: contains the dev harness marker`);
  checkBlock(name, body);
  return `// ── ${name} ──\n${body.trim()}\n`;
});
if (importFiles.length > 1) fail(`more than one file has an import: ${importFiles.join(', ')}`);
if (imports.length !== 1) fail(`expected exactly one import line in js/00-config.js, found ${imports.length}`);

const js = `${imports[0]}\n\n${parts.join('\n')}`;
const banner = `<!-- BUILD OUTPUT${DEV ? ' (DEV, writes stubbed)' : ''}: do not edit. Source: v2/staff-src, then run node v2/staff-src/build.mjs${DEV ? ' --dev' : ''} -->\n`;
const html = banner + head
  .replace('<!--STYLE-->', () => `<style>\n${css}</style>`)
  .replace('<!--SCRIPT-->', () => `<script type="module">\n${js}</script>`);

if (!DEV && html.includes(HARNESS_MARK)) fail('dev harness would end up in the production output');
if (DEV && !html.includes(HARNESS_MARK)) fail('dev output is missing the harness');

let out;
if (DEV) {
  const dir = join(ROOT, '.ui-design', 'v2-dev', ...(OUT_NAME ? [OUT_NAME] : []));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const f of readdirSync(join(V2, 'assets'))) copyFileSync(join(V2, 'assets', f), join(dir, 'assets', f));
  out = join(dir, 'staff.html');
} else {
  out = join(V2, 'staff.html');
}
writeFileSync(out, html);
console.log(`built ${out.slice(ROOT.length + 1)} (${(html.length / 1024).toFixed(1)} KB, ${cssFiles.length} css, ${entries.length} js${DEV ? ', dev harness' : ''})`);
