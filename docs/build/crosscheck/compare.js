// Compares the dump written by dump.rs (from tubele-rs, an independent Rust
// port of the game) with the model this paper analyses: distances and zone
// matches for every ordered pair, and all six clues for every station.
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = require('../solver.js');
const docs = path.join(__dirname, '..', '..');
const raw = JSON.parse(fs.readFileSync(path.join(docs, '..', 'data', 'network.json'), 'utf8'));
const net = S.makeNet(raw), N = net.n;
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(docs, 'data.js'), 'utf8'), ctx);
const D = ctx.window.PAPER_DATA;
const ooi = new Set(JSON.parse(fs.readFileSync(path.join(docs, 'build', 'stats', 'game.json'), 'utf8')).outOfStationInterchange);
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const C = lines.filter(l => l[0] === 'C').map(l => l.split('\t')), F = lines.filter(l => l[0] === 'F').map(l => l.slice(2).split(','));
const bad = [];
if (C.length !== N || F.length !== N) bad.push(`expected ${N} stations, got ${C.length} and ${F.length}`);
C.forEach(([, name, mode, zone, role, line, end, letter], i) => {
  const mine = D.clue[2][i] === 'interchange' && ooi.has(name) ? 'two-stations' : D.clue[2][i];
  const pairs = [['name', name, raw.stations[i].name], ['mode', mode, D.clue[0][i]], ['zone', zone, D.clue[1][i]], ['role', role, mine], ['line', line, D.clue[3][i]], ['end', `${line}:${end}`, D.clue[4][i]], ['letter', letter, D.clue[5][i]]];
  for (const [k, a, b] of pairs) if (a !== b) bad.push(`${k} at ${name}: ${a} vs ${b}`);
});
let dist = 0, zone = 0;
for (let g = 0; g < N; g++) for (let a = 0; a < N; a++) {
  const cell = F[g][a];
  if (+cell.slice(0, -1) !== net.dist[g * N + a]) dist++;
  if (cell.slice(-1) !== 'enx'[S.zoneMatch(raw.stations[g].zones, raw.stations[a].zones)]) zone++;
}
if (dist) bad.push(`${dist} distance mismatches`);
if (zone) bad.push(`${zone} zone mismatches`);
console.log(`${N} stations, ${N * N} ordered pairs`);
if (bad.length) { console.log(bad.slice(0, 40).join('\n')); process.exit(1); }
console.log('tubele-rs agrees on every distance, zone match and clue');
