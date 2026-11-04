// Precomputes everything the paper shows: per-opener policy statistics,
// lower bounds, the Stratford policy tree, clue entropies and the distance
// distribution. Writes ../data.js. Run: node build/build.js
const fs = require('fs');
const path = require('path');
const S = require('./solver.js');

const raw = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../../data/network.json'), 'utf8'));
const net = S.makeNet(raw);
const N = net.n;
const all = Array.from({ length: N }, (_, i) => i);
const t0 = Date.now();

// Distance distribution over ordered pairs u != v.
const distHist = new Array(40).fill(0);
let diameter = 0;
for (let i = 0; i < N * N; i++) { const d = net.dist[i]; if (d > 0) { distHist[d]++; if (d > diameter) diameter = d; } }

// First-guess ranking over the full hypothesis space.
const first = S.rank(net, all, []);
const firstBy = new Map(first.map(r => [r.station, r]));

// Per-opener policy statistics and a second-order lower bound.
const openers = [];
let stratfordTree = null, kxTree = null;
const stratford = raw.stations.findIndex(s => s.name === 'Stratford');
const kx = raw.stations.findIndex(s => s.name.startsWith("King's Cross"));
for (let o = 0; o < N; o++) {
  const { tree, lengths } = S.policyTree(net, o);
  if (o === stratford) stratfordTree = { tree, lengths: Array.from(lengths) };
  if (o === kx) kxTree = { lengths: Array.from(lengths) };
  const hist = new Array(8).fill(0);
  let sum = 0, worst = 0;
  for (const l of lengths) { hist[l]++; sum += l; if (l > worst) worst = l; }
  // Lower bound for any policy that opens with o (uniform prior):
  // per non-win class B of o's partition, at most one answer is found on
  // guess 2, and at most u3(B) within three guesses, where
  // u3(B) = min(|B|, max_h([h in B] + #non-win classes of B under h)).
  // Everything else needs at least four.
  const part = S.partition(net, o, all);
  let lb = 1; // o itself, found on guess 1
  let classes = 0;
  for (const [k, B] of part) {
    if (S.isWin(k)) continue;
    classes++;
    if (B.length === 1) { lb += 2; continue; }
    const inB = new Uint8Array(N); for (const b of B) inB[b] = 1;
    let best = 0;
    const seen = new Set();
    for (let h = 0; h < N; h++) {
      if (h === o) continue;
      seen.clear();
      let win = 0;
      for (const b of B) { const kk = S.fb(net, h, b); if (S.isWin(kk)) win = 1; else seen.add(kk); }
      const v = win + seen.size;
      if (v > best) best = v;
    }
    const u3 = Math.min(B.length, best);
    lb += 2 * 1 + 3 * (u3 - 1) + 4 * (B.length - u3);
  }
  const r = firstBy.get(o);
  openers.push({
    s: o, mean: sum / N, worst, hist: hist.slice(1, 7),
    left: r.expected, entropy: r.entropy, classes, lb: lb / N,
  });
  if (o % 42 === 0) process.stderr.write(`opener ${o}/${N} ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

// Service-information clues as partitions of V. Mode and line are chosen by
// the game's stable hash over sorted ids; role from degree and line count;
// end distance by multi-source BFS from each line's ends within that line.
const MODE_LABEL = { tube: 'Underground', overground: 'Overground', dlr: 'DLR', elizabeth: 'Elizabeth line' };
const lineIds = i => S.LINES.map((l, j) => [l[0], j]).filter(([, j]) => net.lines[i] & (1 << j)).map(([id]) => id).sort();
const modeOf = i => {
  const modes = [...new Set(S.LINES.filter((_, j) => net.lines[i] & (1 << j)).map(l => l[2]))].sort();
  return MODE_LABEL[S.pickStable(modes, raw.stations[i].name)];
};
const role = i => net.adj[i].length === 1 ? 'terminus' : (lineIds(i).length > 1 ? 'interchange' : 'through');
// Per-line adjacency from edge line masks.
const endDist = Array.from({ length: N }, () => new Map());
for (let l = 0; l < S.LINES.length; l++) {
  const nb = new Map();
  for (const e of raw.edges) if (e.lines & (1 << l)) {
    (nb.get(e.a) || nb.set(e.a, new Set()).get(e.a)).add(e.b);
    (nb.get(e.b) || nb.set(e.b, new Set()).get(e.b)).add(e.a);
  }
  const ends = [...nb].filter(([, s]) => s.size <= 1).map(([v]) => v);
  if (!ends.length) continue;
  const d = new Map(ends.map(v => [v, 0])); const q = [...ends];
  for (let h = 0; h < q.length; h++) { const u = q[h]; for (const v of nb.get(u) || []) if (!d.has(v)) { d.set(v, d.get(u) + 1); q.push(v); } }
  for (const [v, x] of d) endDist[v].set(S.LINES[l][0], x);
}
const lineClue = i => S.pickStable(lineIds(i), raw.stations[i].name);
const endClue = i => { const l = lineClue(i); return endDist[i].has(l) ? endDist[i].get(l) : Math.min(...endDist[i].values()); };
const zoneLabel = i => { const z = raw.stations[i].zones; return z.length ? z.join('&') : 'out'; };
const clueFns = {
  mode: modeOf,
  zone: zoneLabel,
  role,
  line: lineClue,
  end: i => `${lineClue(i)}:${endClue(i)}`,
  letter: i => raw.stations[i].name[0],
};
function entropyOf(labels) {
  const c = new Map(); for (const l of labels) c.set(l, (c.get(l) || 0) + 1);
  let H = 0; for (const v of c.values()) { const p = v / labels.length; H -= p * Math.log2(p); }
  return { H, classes: c.size, counts: Object.fromEntries([...c].sort((a, b) => b[1] - a[1])) };
}
const clues = {};
for (const [k, f] of Object.entries(clueFns)) clues[k] = entropyOf(all.map(f));
// The game labels an interchange whose lines meet in two buildings "Two
// stations, one name" instead of "An interchange"; the solver folds it back
// into interchange. Entropy of the role clue as the game displays it.
const game = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats', 'game.json'), 'utf8'));
const ooi = new Set(game.outOfStationInterchange);
clues.roleShown = entropyOf(all.map(i => role(i) === 'interchange' && ooi.has(raw.stations[i].name) ? 'two-stations' : role(i)));
// Joint entropy of all clues together (what the panel would pin down alone).
clues.joint = entropyOf(all.map(i => Object.values(clueFns).map(f => f(i)).join('|')));
const perStation = all.map(i => ({ mode: modeOf(i), role: role(i), line: lineClue(i), end: endClue(i) }));

// ── Clue-aware results ──
const clue = [all.map(modeOf), all.map(zoneLabel), all.map(role), all.map(lineClue), all.map(i => `${lineClue(i)}:${endClue(i)}`), all.map(i => raw.stations[i].name[0])];
const modeClasses = new Map();
all.forEach(i => { const m = clue[0][i]; (modeClasses.get(m) || modeClasses.set(m, []).get(m)).push(i); });
const clueMean = new Float64Array(N), clueWorst = new Uint8Array(N);
const clueHist = [];
for (let o = 0; o < N; o++) {
  let sum = 0, w = 0; const h = new Array(8).fill(0);
  for (const M of modeClasses.values()) {
    const { lengths } = S.clueTree(net, clue, o, M);
    for (const a of M) { const l = lengths.get(a); sum += l; h[l]++; if (l > w) w = l; }
  }
  clueMean[o] = sum / N; clueWorst[o] = w; clueHist.push(h.slice(1, 7));
  if (o % 84 === 0) process.stderr.write(`clue opener ${o} ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}
openers.forEach(o => { o.cmean = clueMean[o.s]; o.cworst = clueWorst[o.s]; o.chist = clueHist[o.s]; });
// Adaptive policy: opener chosen greedily once the mode is shown.
const adaptive = { lengths: new Array(N).fill(0), byMode: {} };
for (const [m, M] of modeClasses) {
  const o = S.rank(net, M, [])[0].station;
  const { lengths } = S.clueTree(net, clue, o, M);
  for (const a of M) adaptive.lengths[a] = lengths.get(a);
  // Best fixed opener for this mode, mean over the mode's answers.
  let bestO = null;
  for (let g = 0; g < N; g++) {
    const L = S.clueTree(net, clue, g, M).lengths; let s = 0, w = 0;
    for (const a of M) { s += L.get(a); w = Math.max(w, L.get(a)); }
    const r = { s: g, mean: s / M.length, worst: w };
    if (!bestO || r.mean < bestO[0].mean - 1e-12) bestO = [r]; else if (Math.abs(r.mean - bestO[0].mean) < 1e-12) bestO.push(r);
    (adaptive.byMode[m] ||= { all: [] }).all.push(r);
  }
  adaptive.byMode[m].greedy = o;
  adaptive.byMode[m].size = M.length;
  adaptive.byMode[m].means = adaptive.byMode[m].all.map(r => +r.mean.toFixed(4));
  adaptive.byMode[m].worsts = adaptive.byMode[m].all.map(r => r.worst);
  adaptive.byMode[m].top = adaptive.byMode[m].all.sort((a, b) => a.mean - b.mean).slice(0, 5);
  delete adaptive.byMode[m].all;
  // Joint (feedback, zone clue) classes from the best mode opener, for the bound.
}
// ── Bounds ──
// b = most non-win classes any single guess induces on V: answers found by
// guess t are at most 1 + b + ... + b^(t-1).
const bmax = Math.max(...openers.map(o => o.classes));
function fillBound(capsPerDepth, total) { let left = total, s = 0, prev = 0; for (let t = 1; left > 0; t++) { const cap = (capsPerDepth[t - 1] ?? Infinity) - prev; const take = Math.min(left, cap); s += t * take; left -= take; prev += take; } return s / total; }
const infoBound = fillBound([1, 1 + bmax, 1 + bmax + bmax * bmax], N);
// With the mode known and the zone clue arriving with feedback 1: per mode
// class M, at most one answer per joint (feedback, zone) class on guess 2.
let clueBoundSum = 0;
for (const M of modeClasses.values()) {
  let b = 0;
  for (let g = 0; g < N; g++) { const s = new Set(); for (const a of M) { const k = S.fb(net, g, a); if (!S.isWin(k)) s.add(k + '|' + clue[1][a]); } b = Math.max(b, s.size); }
  clueBoundSum += fillBound([1, 1 + b], M.length) * M.length;
}
const clueBound = clueBoundSum / N;
// ── Human efficiency: constant-information survival model ──
// After t-1 wrong guesses the answer is uniform on a set of size n 2^(-b(t-1)),
// so the hazard of solving at guess t is 2^(b(t-1))/n (capped at 1). b is
// fitted by maximum likelihood to the solve distribution, losses censored at 6.
function fitBits(counts, losses) {
  let best = null;
  for (let b = 0.2; b <= 9; b += 0.0005) {
    let ll = 0, surv = 1;
    for (let t = 1; t <= 6; t++) {
      const h = Math.min(1, Math.pow(2, b * (t - 1)) / N);
      const p = surv * h; if ((counts[t - 1] || 0) > 0) ll += counts[t - 1] * Math.log(Math.max(p, 1e-300));
      surv *= (1 - h);
    }
    if (losses > 0) ll += losses * Math.log(Math.max(surv, 1e-300));
    if (!best || ll > best.ll) best = { b, ll };
  }
  // Curvature of the log-likelihood for a standard error.
  return best;
}
const human = {
  daily: { counts: [224, 1256, 1591, 1576, 1193, 1370], losses: 1723 },
  practice: { counts: [32, 391, 637, 666, 554, 714], losses: 1103 },
  solverMap: { counts: openers.find(o => o.s === stratford).hist, losses: 0 },
  solverClues: { counts: [1, 2, 3, 4, 5, 6].map(t => adaptive.lengths.filter(l => l === t).length), losses: 0 },
};
for (const v of Object.values(human)) v.fit = fitBits(v.counts, v.losses);
// Distance from King's Cross to a uniform answer, for comparison with the
// distances players see on their first guess.
const kxDist = new Array(40).fill(0); for (let a = 0; a < N; a++) kxDist[net.dist[kx * N + a]]++;

// ── Behavioural baselines: the solver's per-guess distances ──
function playSeq(answer, opener, useClues) {
  let C = useClues ? all.filter(v => clue[0][v] === clue[0][answer]) : all.slice();
  let g = opener ?? S.rank(net, C, [])[0].station;
  const seq = [], guessed = []; let wrong = 0;
  for (let t = 0; t < 12; t++) {
    const k = S.fb(net, g, answer); seq.push(net.dist[g * N + answer]);
    if (S.isWin(k)) break;
    C = S.partition(net, g, C).get(k); guessed.push(g); wrong++;
    if (useClues && wrong <= 5) C = C.filter(v => clue[wrong][v] === clue[wrong][answer]);
    g = S.rank(net, C, guessed)[0].station;
  }
  return seq;
}
function byGuess(seqs) {
  const out = [];
  for (let t = 0; t < 6; t++) {
    const ds = seqs.filter(s => s.length > t).map(s => s[t]);
    if (!ds.length) break;
    const band = [0, 0, 0, 0, 0]; ds.forEach(d => band[d === 0 ? 0 : d <= 2 ? 1 : d <= 5 ? 2 : d <= 10 ? 3 : 4]++);
    out.push({ t: t + 1, n: ds.length, mean: ds.reduce((a, b) => a + b, 0) / ds.length, band });
  }
  return out;
}
const behaviour = {
  solverMap: byGuess(all.map(a => playSeq(a, stratford, false))),
  solverClues: byGuess(all.map(a => playSeq(a, null, true))),
  tierDifficulty: ['core', 'standard', 'deep', 'never'].map(t => { const ids = all.filter(i => game.tiers[Object.keys(game.tiers)[i]] === t); return { t, n: ids.length, map: ids.reduce((s, i) => s + stratfordTree.lengths[i], 0) / ids.length, clues: ids.reduce((s, i) => s + adaptive.lengths[i], 0) / ids.length }; }),
  kxUniformMean: all.reduce((s, a) => s + net.dist[kx * N + a], 0) / N,
  zoneDifficulty: (() => { const groups = { 'Zone 1': [], 'Zone 2': [], 'Zones 3–4': [], 'Zones 5–6': [], 'Zone 7+ or outside': [] }; const L = stratfordTree.lengths; all.forEach(i => { const z = raw.stations[i].zones[0]; const key = z === 1 ? 'Zone 1' : z === 2 ? 'Zone 2' : z <= 4 ? 'Zones 3–4' : z <= 6 ? 'Zones 5–6' : 'Zone 7+ or outside'; groups[z ? key : 'Zone 7+ or outside'].push(i); }); return Object.entries(groups).map(([k, ids]) => ({ k, n: ids.length, map: ids.reduce((s, i) => s + L[i], 0) / ids.length, clues: ids.reduce((s, i) => s + adaptive.lengths[i], 0) / ids.length })); })(),
};

// Compact tree for the icicle: guess index, class size, children.
function compact(n) { return n.win ? { w: 1 } : { g: n.guess, n: n.size, c: n.children.map(c => c.win ? { w: 1 } : compact(c)) }; }

const out = {
  stations: raw.stations.map(s => [s.name, s.lat, s.lon, s.zones, s.lines]),
  edges: raw.edges.map(e => [e.a, e.b, e.lines]),
  lines: S.LINES,
  diameter, distHist: distHist.slice(0, diameter + 1),
  openers,
  stratford, kx,
  stratfordTree: compact(stratfordTree.tree),
  stratfordLengths: stratfordTree.lengths,
  kxLengths: kxTree.lengths,
  clues, perStation,
  behaviour,
  stats: Object.fromEntries(['daily', 'practice'].map(k => { const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats', k + '-behaviour.json'), 'utf8')); return [k, Object.fromEntries(['kpi', 'funnel', 'guess_distribution', 'duration_distribution', 'time_of_day', 'new_vs_returning', 'win_rate_by_tier', 'stops_away_by_guess', 'stops_bands_by_guess', 'opening_stations', 'share_rate', 'share_method', 'day_n_return', 'returning_players', 'abandoned_games', 'guide_views'].map(q => [q, s[q]]))]; })),
  clue, adaptive, infoBound, clueBound, bmax, human, kxDist: kxDist.slice(0, 35),
  built: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(path.join(__dirname, '..', 'data.js'), 'window.PAPER_DATA=' + JSON.stringify(out) + ';\n');
const best = [...openers].sort((a, b) => a.mean - b.mean);
console.log('time', ((Date.now() - t0) / 1000).toFixed(1), 's');
console.log('best', best.slice(0, 5).map(o => [raw.stations[o.s].name, o.mean.toFixed(3), o.worst, o.lb.toFixed(3), o.classes]));
console.log('worst', best.slice(-3).map(o => [raw.stations[o.s].name, o.mean.toFixed(3), o.lb.toFixed(3)]));
console.log('global LB', Math.min(...openers.map(o => o.lb)).toFixed(4), raw.stations[[...openers].sort((a, b) => a.lb - b.lb)[0].s].name);
console.log('bounds', infoBound.toFixed(3), clueBound.toFixed(3), bmax, 'adaptive mean', (adaptive.lengths.reduce((a, b) => a + b, 0) / N).toFixed(3));
console.log('fits', Object.fromEntries(Object.entries(human).map(([k, v]) => [k, v.fit.b.toFixed(3)])));
console.log('modes', JSON.stringify(Object.fromEntries(Object.entries(adaptive.byMode).map(([m, v]) => [m, { size: v.size, greedy: raw.stations[v.greedy].name, top: v.top.slice(0, 3).map(t => [raw.stations[t.s].name, t.mean.toFixed(3), t.worst]) }]))));
console.log('clues', Object.fromEntries(Object.entries(clues).map(([k, v]) => [k, [v.H.toFixed(3), v.classes]])));
console.log('size', fs.statSync(path.join(__dirname, '..', 'data.js')).size);
