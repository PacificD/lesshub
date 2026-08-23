import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkRoot = resolve(repoRoot, 'benchmark/results')
const testRoot = resolve(repoRoot, 'test-results')
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9)
const outputDir = resolve(output ?? `test-results/dashboard-${stamp}-${randomBytes(4).toString('hex')}`)

async function latestDirectory(root, requiredFiles) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name))
    .map(entry => resolve(root, entry.name))
  const valid = []
  for (const candidate of candidates) {
    if ((await Promise.all(requiredFiles.map(file => stat(resolve(candidate, file)).then(() => true).catch(() => false)))).every(Boolean)) valid.push(candidate)
  }
  return valid.sort().at(-1)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function escScript(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script')
}

const benchmarkDir = await latestDirectory(benchmarkRoot, [
  'environment.json',
  'server-summary.json',
  'browser-summary.json',
  'benchmark-report.md'
])
if (!benchmarkDir) throw new Error('No complete benchmark result found under benchmark/results')
const testDir = await latestDirectory(testRoot, ['test-report.md', 'coverage-summary.json', 'junit.xml'])
if (!testDir) throw new Error('No complete test report found under test-results')

const [environment, server, browser, coverage] = await Promise.all([
  readJson(resolve(benchmarkDir, 'environment.json')),
  readJson(resolve(benchmarkDir, 'server-summary.json')),
  readJson(resolve(benchmarkDir, 'browser-summary.json')),
  readJson(resolve(testDir, 'coverage-summary.json'))
])
const junit = await readFile(resolve(testDir, 'junit.xml'), 'utf8')
const suiteTotals = attribute => [...junit.matchAll(new RegExp(`<testsuite\\b[^>]*\\b${attribute}="(\\d+)"`, 'g'))]
  .reduce((total, match) => total + Number(match[1]), 0)
const tests = suiteTotals('tests')
const failures = suiteTotals('failures')
const errors = suiteTotals('errors')

const payload = {
  benchmark: { directory: benchmarkDir.replace(`${repoRoot}/`, ''), environment, server, browser },
  tests: {
    directory: testDir.replace(`${repoRoot}/`, ''),
    total: tests,
    failures,
    errors,
    packages: Object.entries(coverage.packages ?? {}).map(([name, value]) => ({
      name,
      status: value.status,
      lines: value.summary?.total?.lines?.pct ?? null,
      branches: value.summary?.total?.branches?.pct ?? null
    }))
  }
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lesshub / Rendering evidence desk</title>
<style>
:root{color-scheme:light;--paper:oklch(96% .018 82);--paper-deep:oklch(91% .025 78);--ink:oklch(25% .035 55);--muted:oklch(52% .035 62);--line:oklch(82% .04 75);--accent:oklch(62% .17 35);--accent-deep:oklch(43% .12 35);--green:oklch(51% .13 145);--shadow:0 12px 34px rgba(70,45,20,.09);--radius-sm:6px;--radius-md:12px;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--display:"Iowan Old Style",Georgia,serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px}body{margin:0;min-width:320px;background:radial-gradient(circle at 80% -10%,oklch(99% .012 68),transparent 34rem),var(--paper)}a{color:inherit}.shell{max-width:1440px;margin:auto;padding:28px clamp(18px,4vw,64px) 72px}.masthead{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:28px;border-bottom:1px solid var(--line)}.eyebrow{font:700 11px/1.2 var(--mono);letter-spacing:.12em;color:var(--accent-deep);text-transform:uppercase}.title{max-width:720px;margin:14px 0 8px;font:500 clamp(38px,6vw,78px)/.92 var(--display);letter-spacing:-.035em}.lede{max-width:630px;margin:0;color:var(--muted);font-size:16px;line-height:1.55}.stamp{min-width:220px;padding:14px 0 0;text-align:right;font:11px/1.65 var(--mono);color:var(--muted)}.stamp strong{display:block;color:var(--ink);font-size:13px}.status{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:6px 9px;border-radius:999px;background:oklch(89% .045 145);color:var(--green);font:700 11px var(--mono);text-transform:uppercase}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:28px 0;background:var(--line);border:1px solid var(--line)}.kpi{min-height:132px;padding:18px;background:color-mix(in oklab,var(--paper) 80%,white);display:flex;flex-direction:column;justify-content:space-between}.kpi-label{font:11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.kpi-value{font:500 clamp(25px,3vw,39px) var(--display);letter-spacing:-.025em}.kpi-note{font-size:12px;color:var(--muted)}.tabs{display:flex;align-items:center;gap:8px;margin:32px 0 20px;flex-wrap:wrap}.tab{cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted);padding:10px 14px;border-radius:var(--radius-sm);font:700 12px var(--mono);text-transform:uppercase;letter-spacing:.05em;transition:background .16s ease,color .16s ease,transform .16s ease}.tab:hover{color:var(--ink);background:var(--paper-deep)}.tab:active{transform:scale(.97)}.tab[aria-selected=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}.filter{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font:11px var(--mono);text-transform:uppercase}.filter select{border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:9px 10px;border-radius:var(--radius-sm);font:12px var(--mono)}.panel{display:none}.panel.active{display:block}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:30px 0 13px}.section-head h2{margin:0;font:500 30px var(--display);letter-spacing:-.02em}.section-head p{margin:0;color:var(--muted);font-size:13px}.chart-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.sheet{background:color-mix(in oklab,var(--paper) 72%,white);box-shadow:var(--shadow);border:1px solid color-mix(in oklab,var(--line) 75%,transparent);border-radius:var(--radius-md);padding:20px}.sheet-title{margin:0 0 18px;font:700 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.bars{display:grid;gap:15px}.bar-row{display:grid;grid-template-columns:108px 1fr 88px;align-items:center;gap:12px;font-size:13px}.bar-label{font-weight:700}.bar-track{height:14px;background:var(--paper-deep);overflow:hidden;border-radius:3px}.bar-fill{height:100%;min-width:2px;background:var(--accent);border-radius:inherit;transform-origin:left;animation:grow .7s cubic-bezier(.16,1,.3,1) both}.bar-value{text-align:right;font:12px var(--mono);font-variant-numeric:tabular-nums}.legend{display:flex;gap:18px;margin-top:20px;color:var(--muted);font-size:12px}.legend i{display:inline-block;width:9px;height:9px;margin-right:5px;background:var(--accent);border-radius:2px}.metric-stack{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.metric{padding:14px;background:var(--paper-deep);border-radius:var(--radius-sm)}.metric b{display:block;font:22px var(--mono);font-variant-numeric:tabular-nums}.metric span{display:block;margin-top:5px;color:var(--muted);font-size:11px}.table-wrap{overflow:auto;background:color-mix(in oklab,var(--paper) 72%,white);box-shadow:var(--shadow);border:1px solid color-mix(in oklab,var(--line) 75%,transparent);border-radius:var(--radius-md)}table{width:100%;border-collapse:collapse;min-width:680px}th,td{padding:12px 15px;text-align:left;border-bottom:1px solid var(--line);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}th{color:var(--muted);font:10px var(--mono);text-transform:uppercase;letter-spacing:.08em;background:var(--paper-deep)}tr:last-child td{border-bottom:0}td.num{text-align:right;font-family:var(--mono)}.tag{display:inline-flex;padding:4px 7px;border-radius:4px;background:var(--paper-deep);font:10px var(--mono);color:var(--muted)}.tag.good{background:oklch(89% .045 145);color:var(--green)}.tag.control{background:oklch(90% .04 75);color:var(--accent-deep)}.browser-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.browser-card{padding:17px;background:color-mix(in oklab,var(--paper) 72%,white);box-shadow:var(--shadow);border:1px solid color-mix(in oklab,var(--line) 75%,transparent);border-radius:var(--radius-md)}.browser-card h3{margin:0 0 6px;font:500 22px var(--display)}.browser-meta{color:var(--muted);font:10px var(--mono);text-transform:uppercase}.browser-values{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:17px}.browser-values b{display:block;font:16px var(--mono)}.browser-values span{color:var(--muted);font-size:10px}.evidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.checks{display:grid;gap:8px}.check{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;background:var(--paper-deep);border-radius:var(--radius-sm);font-size:13px}.check small{color:var(--muted);font:10px var(--mono)}.coverage{display:grid;gap:10px}.coverage-row{display:grid;grid-template-columns:180px 1fr 52px;align-items:center;gap:10px;font-size:12px}.coverage-track{height:8px;background:var(--paper-deep);border-radius:99px;overflow:hidden}.coverage-fill{height:100%;background:var(--green)}.notes{margin-top:30px;padding:18px 20px;border-top:2px solid var(--accent);background:color-mix(in oklab,var(--paper-deep) 65%,transparent)}.notes h2{margin:0 0 8px;font:500 24px var(--display)}.notes p{max-width:850px;color:var(--muted);font-size:13px;line-height:1.6}.footer{display:flex;justify-content:space-between;gap:20px;margin-top:35px;color:var(--muted);font:10px var(--mono);text-transform:uppercase;letter-spacing:.06em;overflow-wrap:anywhere}.empty{padding:28px;color:var(--muted);text-align:center;font:12px var(--mono)}@keyframes grow{from{transform:scaleX(0)}}@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.chart-grid,.evidence-grid{grid-template-columns:1fr}.browser-grid{grid-template-columns:repeat(2,1fr)}.stamp{text-align:left;padding-top:0}}@media(max-width:600px){.shell{padding:20px 14px 48px}.masthead{display:block}.stamp{margin-top:20px;text-align:left}.kpis{grid-template-columns:1fr 1fr}.kpi{min-height:116px;padding:13px}.kpi-value{font-size:25px}.browser-grid{grid-template-columns:1fr}.bar-row{grid-template-columns:92px 1fr 75px;gap:8px}.filter{margin-left:0;width:100%}.filter select{flex:1}.footer{display:block;line-height:1.8}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
</style>
</head>
<body>
<div class="shell">
<header class="masthead"><div><div class="eyebrow">Lesshub / evidence desk / 01</div><h1 class="title">Rendering performance,<br>without the theater.</h1><p class="lede">A compact comparison of server rendering, browser-visible speed, cache behavior, and test evidence. Read the numbers with their environment attached.</p></div><div class="stamp"><strong id="runStamp">—</strong><span id="environment">—</span><span class="status">evidence complete</span></div></header>
<section class="kpis" id="kpis"></section>
<nav class="tabs" aria-label="Dashboard sections"><button class="tab" aria-selected="true" data-panel="server">Server ledger</button><button class="tab" aria-selected="false" data-panel="browser">Browser view</button><button class="tab" aria-selected="false" data-panel="evidence">Test evidence</button><label class="filter">Strategy <select id="strategyFilter"><option value="all">All strategies</option></select></label></nav>
<main>
<section class="panel active" id="server"><div class="section-head"><div><h2>Warm throughput</h2><p>Complete SSR transactions only. CSR controls stay visible but are never ranked as full pages.</p></div></div><div class="chart-grid"><div class="sheet"><h3 class="sheet-title">Requests / second</h3><div class="bars" id="throughputBars"></div><div class="legend"><span><i></i>measured warm segment</span><span>local machine / quick profile</span></div></div><div class="sheet"><h3 class="sheet-title">Latency signals</h3><div class="metric-stack" id="latencySignals"></div></div></div><div class="section-head"><div><h2>Server segments</h2><p>Cold rows are isolated samples or bursts; they do not report sustained RPS.</p></div></div><div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Strategy</th><th>Cache</th><th>Count</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>RPS</th><th>Read</th></tr></thead><tbody id="serverRows"></tbody></table></div></section>
<section class="panel" id="browser"><div class="section-head"><div><h2>What the browser actually sees</h2><p>Each condition has measured samples. Cache evidence distinguishes network transfer from browser cache hits.</p></div></div><div class="browser-grid" id="browserCards"></div></section>
<section class="panel" id="evidence"><div class="section-head"><div><h2>Evidence, not vibes</h2><p>Correctness gates, test scope, and coverage are shown alongside performance numbers.</p></div></div><div class="evidence-grid"><div class="sheet"><h3 class="sheet-title">Correctness checks</h3><div class="checks" id="checks"></div></div><div class="sheet"><h3 class="sheet-title">Test coverage by workspace</h3><div class="coverage" id="coverage"></div></div></div></section>
</main>
<section class="notes"><h2>How to read this desk</h2><p><strong>Warm</strong> means the relevant page cache was prewarmed before the measured segment. <strong>Cold</strong> means the target key was cleared before each isolated sample or burst. Browser results are local observations, not cross-machine claims. CSR shell, BFF, and combined transactions are controls; use browser product-visible timing for user-facing comparison.</p></section>
<footer class="footer"><span id="sourcePaths">—</span><span>Generated locally / no external assets</span></footer>
</div>
<script>
const DATA=${escScript(payload)};
const fmt=(n,d=2)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(d):'—';
const pct=n=>typeof n==='number'?n.toFixed(1)+'%':'N/A';
const serverResults=DATA.benchmark.server.results||[];
const warm=serverResults.filter(r=>r.scenario==='warm'&&r.comparable&&r.requestsPerSecond!==null);
const strategies=[...new Set(serverResults.map(r=>r.strategy))];
const filter=document.querySelector('#strategyFilter');
strategies.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;filter.append(o)});
function selected(){return filter.value==='all'?serverResults:serverResults.filter(r=>r.strategy===filter.value)}
function renderKpis(){const best=[...warm].sort((a,b)=>b.requestsPerSecond-a.requestsPerSecond)[0];const htmlWarm=warm.find(r=>r.strategy==='html-cache');const visible=(DATA.benchmark.browser.results||[]).filter(r=>r.strategy==='html-cache'&&r.browserCache==='warm'&&r.serverCache==='warm')[0];document.querySelector('#kpis').innerHTML=[['Best warm throughput',best?fmt(best.requestsPerSecond,0)+' RPS':'—',best?.strategy||'complete SSR'],['HTML warm p95',htmlWarm?fmt(htmlWarm.latencyMs.p95)+' ms':'—','server response'],['Warm product visible',visible?fmt(visible.productVisibleMs.p95)+' ms':'—','browser p95'],['Test gate',DATA.tests.failures+DATA.tests.errors===0?DATA.tests.total+'/'+DATA.tests.total:'FAIL','11 workspace scope']].map(([label,value,note])=>'<article class="kpi"><span class="kpi-label">'+label+'</span><b class="kpi-value">'+value+'</b><span class="kpi-note">'+note+'</span></article>').join('')}
function renderServer(){const rows=selected();const bars=warm.filter(r=>filter.value==='all'||r.strategy===filter.value);const max=Math.max(...bars.map(r=>r.requestsPerSecond),1);document.querySelector('#throughputBars').innerHTML=bars.length?bars.map(r=>'<div class="bar-row"><span class="bar-label">'+r.strategy+'</span><span class="bar-track"><span class="bar-fill" style="width:'+Math.max(2,r.requestsPerSecond/max*100)+'%"></span></span><span class="bar-value">'+fmt(r.requestsPerSecond,0)+' RPS</span></div>').join(''):'<div class="empty">No matching warm rows.</div>';const fastest=[...bars].sort((a,b)=>a.latencyMs.p95-b.latencyMs.p95)[0];document.querySelector('#latencySignals').innerHTML=[['Fastest p95',fastest?fmt(fastest.latencyMs.p95)+' ms':'—',fastest?.strategy||''],['Warm rows',bars.length, 'measured segments'],['Cold samples',rows.filter(r=>r.scenario==='cold').reduce((n,r)=>n+r.count,0),'isolated requests'],['Correctness',DATA.benchmark.server.correctness.filter(c=>c.passed).length+'/'+DATA.benchmark.server.correctness.length,'passed assertions']].map(([a,b,c])=>'<div class="metric"><b>'+b+'</b><span>'+a+' · '+c+'</span></div>').join('');document.querySelector('#serverRows').innerHTML=rows.map(r=>'<tr><td><span class="tag '+(r.scenario==='warm'?'good':'control')+'">'+r.scenario+'</span></td><td>'+r.strategy+'</td><td>'+r.cacheCondition+'</td><td class="num">'+r.count+'</td><td class="num">'+fmt(r.latencyMs.p50)+'</td><td class="num">'+fmt(r.latencyMs.p95)+'</td><td class="num">'+fmt(r.latencyMs.p99)+'</td><td class="num">'+(r.requestsPerSecond===null?'N/A':fmt(r.requestsPerSecond,0))+'</td><td><span class="tag '+(r.errors+r.timeouts===0?'good':'')+'">'+(r.errors+r.timeouts===0?'clean':'error')+'</span></td></tr>').join('')||'<tr><td colspan="9" class="empty">No matching rows.</td></tr>'}
function renderBrowser(){const values=(DATA.benchmark.browser.results||[]).filter(r=>filter.value==='all'||r.strategy===filter.value);document.querySelector('#browserCards').innerHTML=values.map(r=>{const evidence=r.cacheEvidence||{};return '<article class="browser-card"><h3>'+r.strategy+'</h3><div class="browser-meta">browser '+r.browserCache+' / server '+r.serverCache+' / '+r.samples+' samples</div><div class="browser-values"><div><b>'+fmt(r.productVisibleMs.p95)+'</b><span>product visible p95 ms</span></div><div><b>'+fmt(r.ttfbMs.p95)+'</b><span>TTFB p95 ms</span></div><div><b>'+fmt(r.jsTransferBytes.p95,0)+'</b><span>JS bytes p95</span></div><div><b>'+fmt(r.cssTransferBytes.p95,0)+'</b><span>CSS bytes p95</span></div></div><div class="browser-meta" style="margin-top:16px;color:var(--green)">'+(evidence.cacheHits!==undefined?evidence.cacheHits+'/'+evidence.assetRequests+' cache hits':'hydration errors '+r.hydrationErrors)+'</div></article>'}).join('')||'<div class="empty">No matching browser conditions.</div>'}
function renderEvidence(){document.querySelector('#checks').innerHTML=(DATA.benchmark.server.correctness||[]).map(c=>'<div class="check"><span>'+c.scenario+'</span><small class="tag '+(c.passed?'good':'')+'">'+(c.passed?'PASS':'FAIL')+'</small></div>').join('');document.querySelector('#coverage').innerHTML=(DATA.tests.packages||[]).map(p=>{const value=p.lines;return '<div class="coverage-row"><span>'+p.name.replace('@lesshub/','')+'</span><span class="coverage-track"><span class="coverage-fill" style="width:'+(value??0)+'%"></span></span><b>'+pct(value)+'</b></div>'}).join('')}
function render(){renderKpis();renderServer();renderBrowser();renderEvidence()}
document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===button));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===button.dataset.panel))}));filter.addEventListener('change',render);document.querySelector('#runStamp').textContent=DATA.benchmark.environment.runId;document.querySelector('#environment').textContent=DATA.benchmark.environment.node+' · '+DATA.benchmark.environment.cpu+' · '+DATA.benchmark.environment.profile;document.querySelector('#sourcePaths').textContent=DATA.benchmark.directory+'  /  '+DATA.tests.directory;render();
</script>
</body></html>`

await mkdir(outputDir, { recursive: true })
const outputPath = resolve(outputDir, 'benchmark-dashboard.html')
await (await import('node:fs/promises')).writeFile(outputPath, html)
console.log(`DASHBOARD_PATH=${outputPath}`)
console.log(`BENCHMARK_SOURCE=${benchmarkDir}`)
console.log(`TEST_SOURCE=${testDir}`)
