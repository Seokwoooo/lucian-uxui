#!/usr/bin/env node
// lucian-uxui: search and fetch Lucian UX/UI Prompt elements for an AI coding agent.
// Node 18+, no dependencies. Reads the static API at lucianlabs.dev/uxui-prompt/api/v1/,
// falls back to the GitHub mirror, and caches on disk so repeat runs barely touch the network.
//
//   search <words...>       best matches for a UI part ("pricing toggle", "로그인")
//   list [--category slug]  categories, or every element in one category
//   get <id> [<id>...]      full element code (license line, info, <style>, markup, <script>)
//   tokens                  the --ux-* theme tokens and .ux base every element needs
//   info                    data source, version and cache folder
//
// Options: --lang en|ko (default en), --category <slug>, --limit <n>, --out <dir>, --refresh
// Env: LUCIAN_UXUI_BASE (comma-separated sources in order, e.g. a local server), LUCIAN_UXUI_CACHE, LUCIAN_UXUI_TTL (seconds)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = '1.1.0';
const SOURCES = process.env.LUCIAN_UXUI_BASE
  ? process.env.LUCIAN_UXUI_BASE.split(',').map(base => base.trim().replace(/\/+$/, '')).filter(Boolean)
  : ['https://lucianlabs.dev/uxui-prompt/api/v1',
     'https://raw.githubusercontent.com/Seokwoooo/lucian-uxui-prompt/main/api/v1'];
const TTL = (Number(process.env.LUCIAN_UXUI_TTL) || 6 * 3600) * 1000;
const USER_AGENT = `lucian-uxui-skill/${VERSION} (+https://github.com/Seokwoooo/lucian-uxui)`;
const HANGUL = /[ㄱ-ㆎ가-힣]/;

class UsageError extends Error {}

/* ---------- arguments ---------- */
function parseArgs(argv) {
  const opts = { lang: 'en', limit: 10, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      return argv[++i];
    };
    if (a.startsWith('--lang')) opts.lang = value();
    else if (a.startsWith('--category') || a === '-c') opts.category = value();
    else if (a.startsWith('--limit') || a === '-n') opts.limit = Math.max(1, Math.min(100, parseInt(value(), 10) || 10));
    else if (a.startsWith('--out')) opts.out = value();
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`);
    else opts.words.push(a);
  }
  if (!['en', 'ko'].includes(opts.lang)) throw new UsageError('--lang must be en or ko');
  opts.command = opts.words.shift();
  return opts;
}

/* ---------- cache: survives across runs, never required ---------- */
const CACHE_DIRS = [
  process.env.LUCIAN_UXUI_CACHE,
  process.env.XDG_CACHE_HOME && path.join(process.env.XDG_CACHE_HOME, 'lucian-uxui'),
  path.join(os.homedir(), '.cache', 'lucian-uxui'),
  path.join(os.tmpdir(), 'lucian-uxui')
].filter(Boolean);
// Probe with a real write: sandboxes (Codex, for one) can deny writes that access() still allows.
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch { return false; }
}
const cacheDir = CACHE_DIRS.find(writable) || null;
// A folder this run cannot write, such as a read-only home in a sandbox, may still hold an earlier cache.
const readDirs = [cacheDir, ...CACHE_DIRS.filter(dir => dir !== cacheDir && fs.existsSync(dir))].filter(Boolean);
const cachePath = name => cacheDir && path.join(cacheDir, name);
function readCache(name) {
  for (const dir of readDirs) {
    try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch {}
  }
  return null;
}
// A cached file and its metadata must come from the same folder.
function readCachedPair(name) {
  for (const dir of readDirs) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, name + '.meta.json'), 'utf8')); } catch {}
      return { text, meta };
    } catch {}
  }
  return { text: null, meta: null };
}
// Write through a temp file so parallel agents never read half a file.
function writeCache(name, text) {
  if (!cacheDir) return;
  try {
    const file = cachePath(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {}
}

/* ---------- network: timeout, one retry, then the mirror ---------- */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchOnce(url, headers) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(12000) });
  if (res.status === 304) return { status: 304 };
  if (res.ok) return { status: 200, text: await res.text(), etag: res.headers.get('etag') };
  const retryAfter = Math.min(5, Number(res.headers.get('retry-after')) || 0);
  const err = new Error(`HTTP ${res.status} for ${url}`);
  err.retryable = res.status === 429 || res.status >= 500;
  err.wait = retryAfter * 1000;
  err.notFound = res.status === 404;
  throw err;
}
// A source that failed (blocked, rate-limited, down) is tried last for a few minutes,
// so a blocked site is not hit again on every call while the mirror serves instead.
const COOLDOWN = 10 * 60 * 1000;
let health = null;
function sourceHealth() {
  if (!health) { try { health = JSON.parse(readCache('sources.json')) || {}; } catch { health = {}; } }
  return health;
}
function markSource(base, ok) {
  const h = sourceHealth();
  if (ok ? !h[base] : (h[base] || 0) > Date.now()) return;
  if (ok) delete h[base]; else h[base] = Date.now() + COOLDOWN;
  writeCache('sources.json', JSON.stringify(h));
}
async function download(rel, { etag, source } = {}) {
  const h = sourceHealth(), now = Date.now();
  const preferred = source && SOURCES.includes(source) ? [source, ...SOURCES.filter(s => s !== source)] : SOURCES;
  const order = [...preferred.filter(s => !(h[s] > now)), ...preferred.filter(s => h[s] > now)];
  const errors = [];
  let missing = 0;
  for (const base of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // A conditional request only makes sense against the source that issued the ETag.
        const result = await fetchOnce(`${base}/${rel}`, etag && base === source ? { 'if-none-match': etag } : {});
        markSource(base, true);
        return { ...result, source: base };
      } catch (err) {
        errors.push(String(err.message).startsWith('HTTP') ? err.message : `${base}/${rel}: ${err.cause?.code || err.name || err.message}`);
        if (err.notFound) { missing++; break; }
        if (attempt === 1 || err.retryable === false) { markSource(base, false); break; }
        await sleep(err.wait || 400 + Math.random() * 600);
      }
    }
  }
  const err = new Error(errors.join('\n  '));
  if (missing === order.length) err.notFound = true;
  else err.offline = true;
  throw err;
}

// Fetch a file that changes between releases (catalog, tokens): fresh cache → use it;
// stale → revalidate with ETag; network down → use the stale copy and say so.
async function cachedText(rel, { refresh } = {}) {
  const name = rel.replace(/\//g, '_');
  const { text: cached, meta } = readCachedPair(name);
  if (cached && meta && !refresh && Date.now() - meta.fetchedAt < TTL) return { text: cached, meta };
  try {
    const res = await download(rel, cached && meta ? { etag: meta.etag, source: meta.source } : {});
    if (res.status === 304 && cached) {
      const next = { ...meta, fetchedAt: Date.now() };
      writeCache(name + '.meta.json', JSON.stringify(next));
      return { text: cached, meta: next };
    }
    const next = { etag: res.etag, source: res.source, fetchedAt: Date.now() };
    writeCache(name, res.text);
    writeCache(name + '.meta.json', JSON.stringify(next));
    return { text: res.text, meta: next };
  } catch (err) {
    if (cached) {
      process.stderr.write(`lucian-uxui: network unavailable, using cached ${rel} from ${new Date(meta?.fetchedAt || 0).toISOString()}\n`);
      return { text: cached, meta: meta || {} };
    }
    throw err;
  }
}

/* ---------- catalog ---------- */
async function loadCatalog(lang, opts) {
  const { text, meta } = await cachedText(`${lang}/catalog.tsv`, opts);
  const lines = text.split('\n').filter(line => line && !line.startsWith('#'));
  const header = lines.shift().split('\t');
  const items = lines.map(line => {
    const cells = line.split('\t');
    const item = Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
    item.tags = item.tags ? item.tags.split(' ') : [];
    return item;
  });
  const version = (text.match(/version=(\w+)/) || [])[1] || '';
  return { items, byId: new Map(items.map(item => [item.id, item])), version, source: meta.source };
}
// Accepts 55, 055, #055 or a gallery link such as https://lucianlabs.dev/uxui-prompt/#055.
const normalizeId = raw => {
  const digits = (String(raw).trim().match(/(?:^|#)(\d{1,6})$/) || [])[1];
  if (!digits) throw new UsageError(`"${raw}" is not an element ID (use numbers like 050 or a gallery link)`);
  return digits.replace(/^0+(?=\d)/, '').padStart(3, '0');
};

/* ---------- search ---------- */
const SYNONYMS = {
  switch: ['toggle'], toggle: ['switch'], modal: ['dialog', 'sheet'], dialog: ['modal'], popup: ['dialog', 'popover'],
  spinner: ['loading', 'loader'], loader: ['loading', 'progress'], progress: ['loading'], skeleton: ['loading'],
  login: ['sign-in', 'signin', 'auth'], signin: ['login', 'auth'], signup: ['sign-up', 'register', 'auth'], register: ['signup'],
  password: ['auth', 'login'], otp: ['code', 'verification'], toast: ['notification', 'alert', 'snackbar'],
  notification: ['toast', 'alert'], alert: ['toast', 'notification'], snackbar: ['toast'],
  dropdown: ['menu', 'select'], select: ['dropdown', 'picker'], picker: ['select'], nav: ['menu', 'tabs', 'navigation'],
  navigation: ['nav', 'menu', 'tabs'], navbar: ['nav', 'menu'], sidebar: ['nav', 'menu'], tabs: ['tab'], tab: ['tabs'],
  cta: ['button'], btn: ['button'], chart: ['graph', 'analytics'], graph: ['chart'], stats: ['chart', 'analytics', 'metric'],
  dashboard: ['chart', 'analytics', 'widget', 'metric'], kpi: ['metric', 'chart'], kanban: ['board', 'task'],
  todo: ['task', 'checklist'], calendar: ['schedule', 'date'], date: ['calendar'], schedule: ['calendar'],
  upload: ['file', 'drop'], search: ['input', 'filter'], form: ['input'], textarea: ['input', 'editor'],
  slider: ['range'], range: ['slider'], rating: ['star'], pricing: ['price', 'plan', 'billing', 'toggle'],
  price: ['pricing'], cart: ['checkout', 'shop'], checkout: ['payment', 'cart'], empty: ['empty-state', 'no-results'],
  error: ['404', 'empty'], '404': ['error'], card: ['cards'], editor: ['document', 'text'], table: ['data', 'grid'],
  chat: ['message'], message: ['chat'], accordion: ['faq', 'collapse', 'disclosure'], faq: ['accordion'],
  tooltip: ['hint', 'popover'], copy: ['clipboard'], share: ['social'], like: ['heart', 'favorite'], theme: ['dark', 'night', 'day'],
  dark: ['night', 'theme'], light: ['day', 'theme'], mode: ['theme'], hero: ['button', 'card'], landing: ['button', 'card'],
  newsletter: ['subscribe', 'email'], subscribe: ['newsletter'], testimonial: ['card', 'quote'], profile: ['card', 'avatar']
};
// Tags are English in both catalogs, so Korean UI words are mapped onto them as well.
const KO_SYNONYMS = [
  ['회원가입', ['signup', 'sign-up', 'register', 'onboarding']], ['가입', ['signup', 'sign-up']], ['로그인', ['login', 'sign-in', 'auth']],
  ['비밀번호', ['password']], ['인증', ['otp', 'verification', 'auth']], ['버튼', ['button']], ['토글', ['toggle', 'switch']],
  ['스위치', ['switch', 'toggle']], ['체크박스', ['checkbox']], ['요금', ['pricing', 'price', 'plan']], ['가격', ['pricing', 'price']],
  ['결제', ['checkout', 'payment', 'billing']], ['장바구니', ['cart']], ['메뉴', ['menu', 'nav']], ['탭', ['tabs', 'tab']],
  ['드롭다운', ['dropdown', 'select', 'menu']], ['검색', ['search']], ['입력', ['input', 'field']], ['태그', ['tags', 'chips']],
  ['슬라이더', ['slider', 'range']], ['별점', ['rating', 'star']], ['카드', ['card']], ['모달', ['dialog', 'modal']],
  ['팝업', ['dialog', 'popover']], ['툴팁', ['tooltip']], ['알림', ['toast', 'notification', 'alert']], ['토스트', ['toast']],
  ['로딩', ['loading', 'spinner', 'skeleton']], ['진행', ['progress', 'loading']], ['빈 화면', ['empty-state', 'empty']],
  ['오류', ['error', '404']], ['에러', ['error', '404']], ['차트', ['chart', 'graph']], ['그래프', ['chart', 'graph']],
  ['대시보드', ['dashboard', 'kpi', 'chart', 'widget']], ['위젯', ['widget']], ['칸반', ['kanban', 'board', 'task']],
  ['할 일', ['todo', 'task', 'checklist']], ['할일', ['todo', 'task', 'checklist']], ['투두', ['todo', 'checklist']],
  ['달력', ['calendar', 'date']], ['캘린더', ['calendar', 'date']], ['일정', ['calendar', 'schedule', 'gantt']], ['날짜', ['date', 'calendar']],
  ['다크', ['dark', 'theme', 'night']], ['테마', ['theme', 'dark']], ['설정', ['settings', 'toggle']], ['업로드', ['upload', 'file']],
  ['파일', ['file', 'upload']], ['복사', ['copy', 'clipboard']], ['공유', ['share']], ['좋아요', ['like', 'heart']],
  ['뉴스레터', ['newsletter', 'subscribe', 'email']], ['구독', ['subscribe', 'newsletter']], ['자주 묻는', ['faq', 'accordion']],
  ['아코디언', ['accordion']], ['단계', ['stepper', 'wizard', 'steps']], ['온보딩', ['onboarding']], ['에디터', ['editor']],
  ['편집', ['editor', 'edit']], ['테이블', ['table']], ['채팅', ['chat', 'message']], ['메시지', ['message', 'chat']],
  ['프로필', ['profile', 'avatar']], ['지도', ['map']], ['타임라인', ['timeline']]
];
// Hyphenated words also count as their parts ("read-state" matches "state").
function terms(text) {
  const out = [];
  for (const word of String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) || []) {
    out.push(word);
    if (word.includes('-')) out.push(...word.split('-'));
  }
  return out;
}
// English matches whole words or prefixes ("switch" → "switches", but not "board" → "clipboard");
// Korean also matches inside compounds ("가입" in "회원가입"), from two syllables up.
function hit(t, word) {
  if (t === word) return 1;
  if (HANGUL.test(word)) return word.length >= 2 && t.includes(word) ? 0.8 : 0;
  return word.length >= 3 && t.startsWith(word) ? 0.6 : 0;
}
function scoreItem(item, words, extra) {
  const fields = [
    [terms(item.title).concat(extra ? terms(extra.title) : []), 4],
    [item.tags.flatMap(terms), 4],
    [terms(item.category + ' ' + item.cat).concat(extra ? terms(extra.category) : []), 3],
    [terms(item.summary).concat(extra ? terms(extra.summary) : []), 1]
  ];
  let score = 0, matched = 0;
  for (const { word, weight } of words) {
    let best = 0;
    for (const [list, w] of fields) for (const t of list) best = Math.max(best, hit(t, word) * w);
    if (best) { score += best * weight; if (weight === 1) matched++; }
  }
  return { score: score + matched * 2, matched };
}
async function search(opts) {
  const query = opts.words.join(' ').trim();
  if (!query) throw new UsageError('search needs keywords, e.g. search "pricing toggle"');
  const catalog = await loadCatalog(opts.lang, opts);
  // Search the other language's titles and summaries too, so either language finds either catalog.
  const other = await loadCatalog(opts.lang === 'ko' ? 'en' : 'ko', opts).catch(() => null);
  const base = terms(query);
  const words = base.map(word => ({ word, weight: 1 }));
  const add = (word, weight) => { if (!words.some(w => w.word === word)) words.push({ word, weight }); };
  const lower = query.toLowerCase();
  for (const [ko, en] of KO_SYNONYMS) if (lower.includes(ko)) en.forEach(word => add(word, 0.8));
  for (const word of base) for (const alt of SYNONYMS[word] || []) add(alt, 0.5);
  const results = catalog.items
    .filter(item => !opts.category || item.cat === opts.category)
    .map(item => ({ item, ...scoreItem(item, words, other && other.byId.get(item.id)) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, opts.limit);
  if (!results.length) {
    console.log(`No match for "${query}". Try broader words, or browse: list` + (opts.category ? ` --category ${opts.category}` : ''));
    return;
  }
  console.log(`# ${results.length} of ${catalog.items.length} elements for "${query}" (lang=${opts.lang}) · get <id> for the code`);
  for (const { item } of results) console.log(row(item, 180));
}
const clip = (text, n) => text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text;
const row = (item, n) => `${item.id}  ${item.title}  [${item.cat} · ${item.shape}]  ${clip(item.summary, n)}`;

/* ---------- list ---------- */
async function list(opts) {
  const catalog = await loadCatalog(opts.lang, opts);
  const category = opts.category || opts.words[0];
  if (!category) {
    const counts = new Map();
    for (const item of catalog.items) {
      const entry = counts.get(item.cat) || { label: item.category, count: 0 };
      entry.count++;
      counts.set(item.cat, entry);
    }
    console.log(`# ${catalog.items.length} elements in ${counts.size} categories (lang=${opts.lang}) · list --category <slug>`);
    for (const [slug, { label, count }] of counts) console.log(`${slug.padEnd(28)} ${String(count).padStart(4)}  ${label}`);
    return;
  }
  const items = catalog.items.filter(item => item.cat === category);
  if (!items.length) throw new UsageError(`No category "${category}". Run list to see the slugs.`);
  console.log(`# ${items.length} elements in ${category} (lang=${opts.lang}) · get <id> for the code`);
  for (const item of items) console.log(row(item, 120));
}

/* ---------- get ---------- */
async function getOne(id, catalog, opts) {
  const item = catalog.byId.get(id);
  if (!item) throw new UsageError(`No element ${id}. Search first; IDs come from search or list.`);
  const name = `${opts.lang}/e/${id}-${item.hash}.txt`;
  let text = !opts.refresh && readCache(name.replace(/\//g, '_'));
  if (!text) {
    const res = await download(`${opts.lang}/e/${id}.txt`, { source: catalog.source });
    text = res.text;
    // Only cache under the catalog's hash when the bytes match it; a mismatch means a release is in flight.
    if (crypto.createHash('sha256').update(text).digest('hex').startsWith(item.hash)) writeCache(name.replace(/\//g, '_'), text);
  }
  return { item, text };
}
async function get(opts) {
  if (!opts.words.length) throw new UsageError('get needs element IDs, e.g. get 050 112');
  const ids = [...new Set(opts.words.flatMap(w => w.split(',')).filter(Boolean).map(normalizeId))];
  if (ids.length > 8) throw new UsageError('get at most 8 elements at a time; port a few, then fetch more');
  const catalog = await loadCatalog(opts.lang, opts);
  const results = await Promise.all(ids.map(id => getOne(id, catalog, opts)));
  if (opts.out) {
    fs.mkdirSync(opts.out, { recursive: true });
    for (const { item, text } of results) {
      const file = path.join(opts.out, `lucian-${item.id}.html`);
      fs.writeFileSync(file, text);
      console.log(`${file}  ${item.title}`);
    }
    return;
  }
  process.stdout.write(results.map(r => r.text).join('\n'));
}

/* ---------- tokens / info ---------- */
async function tokens(opts) {
  const { text } = await cachedText(`${opts.lang}/tokens.css`, opts);
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, text);
    console.log(opts.out);
    return;
  }
  process.stdout.write(text);
}
async function info(opts) {
  const catalog = await loadCatalog(opts.lang, opts);
  console.log([
    `lucian-uxui ${VERSION}`,
    `elements: ${catalog.items.length} (catalog ${catalog.version}, lang=${opts.lang})`,
    `source: ${catalog.source || 'cache'}`,
    `sources: ${SOURCES.join(' , ')}`,
    `cache: ${cacheDir || 'off (no writable folder)'} · ttl ${Math.round(TTL / 1000)}s`,
    `gallery: https://lucianlabs.dev/uxui-prompt/`
  ].join('\n'));
}

const HELP = `lucian-uxui ${VERSION} · Lucian UX/UI Prompt elements for AI coding agents

  search <words...>        best matches for a UI part, e.g. search "pricing toggle"
  list [--category slug]   categories with counts, or every element in a category
  get <id> [<id>...]       element code (up to 8), e.g. get 050 112
  tokens                   --ux-* theme tokens and the .ux base rules
  info                     data source, catalog version, cache folder

  --lang en|ko   element copy language (default en)   --limit n   search results (default 10)
  --out <path>   write files instead of printing      --refresh   ignore the cache
`;

const COMMANDS = { search, find: search, list, ls: list, get, tokens, info };
try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) { process.stdout.write(HELP); process.exit(opts.command || opts.help ? 0 : 2); }
  const run = COMMANDS[opts.command];
  if (!run) throw new UsageError(`Unknown command "${opts.command}"`);
  await run(opts);
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`lucian-uxui: ${err.message}\n`);
    process.exit(2);
  }
  if (err.notFound) {
    process.stderr.write(`lucian-uxui: not found in the element library.\n  ${err.message}\n` +
      'The element may have been renamed or removed. Run with --refresh to reload the catalog, then search again.\n');
    process.exit(4);
  }
  if (err.offline) {
    process.stderr.write(`lucian-uxui: could not reach the element library.\n  ${err.message}\n` +
      'If this runs in a sandbox without network access (for example Codex), allow network access for this command and run it again.\n');
    process.exit(3);
  }
  process.stderr.write(`lucian-uxui: ${err.stack || err}\n`);
  process.exit(1);
}
