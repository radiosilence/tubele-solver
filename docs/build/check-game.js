// Checks the solver's graph against the one the live game ships, and
// snapshots the game's per-station difficulty tiers and its out-of-station
// interchanges to stats/game.json for build.js.
//
//   node build/check-game.js            fetch https://tubele.app and check
//   node build/check-game.js bundle.js  check a saved copy of the bundle
//
// The game's bundle embeds its stations and edges as JSON.parse(`...`)
// literals and its tiers as an object literal of station id to tier. The
// encoded answer schedule is deliberately left alone. Exits non-zero if the
// graphs differ in any station, zone, line or edge.
const fs = require('fs'), path = require('path');
const S = require('./solver.js');

async function bundle() {
  if (process.argv[2]) return fs.readFileSync(process.argv[2], 'utf8');
  const html = await (await fetch('https://tubele.app/')).text();
  const src = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  return (await fetch('https://tubele.app' + src)).text();
}

// The body of a template literal, unescaped one level, parsed as JSON.
function literalAt(js, from) {
  const i = js.indexOf('`', from) + 1;
  let j = i;
  while (true) { j = js.indexOf('`', j); if (js[j - 1] !== '\\') break; j++; }
  const raw = js.slice(i, j);
  if (raw.includes('${')) throw new Error('template literal has substitutions');
  return JSON.parse(raw.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)));
}

(async () => {
  const js = await bundle();
  const parsed = [...js.matchAll(/JSON\.parse\(`/g)].map(m => literalAt(js, m.index));
  const stations = parsed.find(a => Array.isArray(a) && a[0] && 'zones' in a[0]);
  const edges = parsed.find(a => Array.isArray(a) && a[0] && 'a' in a[0] && 'b' in a[0]);
  const tierObj = js.match(/\{(?:(?:"[^"]+"|[\w$]+):`(?:core|standard|deep|never)`,?){100,}\}/)[0];
  const tiers = Object.fromEntries([...tierObj.matchAll(/(?:"([^"]+)"|([\w$]+)):`(\w+)`/g)].map(m => [m[1] || m[2], m[3]]));

  const net = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'network.json'), 'utf8'));
  const lid = l => { const i = S.LINES.findIndex(x => x[0] === l); if (i < 0) throw new Error('unknown line ' + l); return i; };
  const mask = ls => ls.reduce((a, l) => a | (1 << lid(l)), 0);
  const ours = new Map(net.stations.map((s, i) => [s.name, i]));
  const byId = new Map(stations.map(s => [s.id, s]));
  const problems = [], moved = [];
  if (stations.length !== net.stations.length) problems.push(`station count ${stations.length} vs ${net.stations.length}`);
  stations.forEach((s, gi) => {
    const i = ours.get(s.name);
    if (i === undefined) return problems.push(`missing station ${s.name}`);
    const o = net.stations[i];
    if (i !== gi) problems.push(`order differs at ${s.name}`);
    if (JSON.stringify(s.zones || []) !== JSON.stringify(o.zones)) problems.push(`zones differ at ${s.name}`);
    if (mask(s.lines) !== o.lines) problems.push(`lines differ at ${s.name}`);
    // Coordinates only place stations on maps; feedback never reads them.
    const m = Math.hypot((s.lat - o.lat) * 111320, (s.lon - o.lon) * 111320 * Math.cos(s.lat * Math.PI / 180));
    if (m > 0) moved.push([m, s.name]);
  });
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const theirs = new Map(edges.map(e => [key(ours.get(byId.get(e.a).name), ours.get(byId.get(e.b).name)), mask(e.lines)]));
  const mine = new Map(net.edges.map(e => [key(e.a, e.b), e.lines]));
  for (const [k, l] of theirs) if (!mine.has(k)) problems.push(`edge ${k} only in the game`); else if (mine.get(k) !== l) problems.push(`edge ${k} lines differ`);
  for (const k of mine.keys()) if (!theirs.has(k)) problems.push(`edge ${k} only in the solver`);

  const ordered = Object.fromEntries(net.stations.map(s => { const g = stations.find(x => x.name === s.name); return [g.id, tiers[g.id]]; }));

  const count = {}; for (const t of Object.values(ordered)) count[t] = (count[t] || 0) + 1;
  console.log(`game: ${stations.length} stations, ${edges.length} edges; tiers`, count);
  const ooi = stations.filter(s => s.outOfStationInterchange).map(s => s.name);
  fs.writeFileSync(path.join(__dirname, 'stats', 'game.json'), JSON.stringify({ tiers: ordered, outOfStationInterchange: ooi }, null, 1) + '\n');
  console.log('out-of-station interchanges:', ooi.join(', '));
  if (problems.length) { console.log(problems.length + ' differences:\n' + problems.join('\n')); process.exit(1); }
  moved.sort((a, b) => b[0] - a[0]);
  console.log(`coordinates: ${moved.length} differ, largest ${moved[0] ? moved[0][0].toFixed(0) + ' m (' + moved[0][1] + ')' : '0 m'}`);
  console.log('graphs identical: every station, zone, line and edge');
})();
