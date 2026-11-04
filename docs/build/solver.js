// Port of tubele-solver's feedback, ranking and play (src/solver.rs), shared by
// the build script and the page. Tie-breaks match the Rust implementation.

const LINES = [
  ['bakerloo', 'Bakerloo', 'tube'], ['central', 'Central', 'tube'], ['circle', 'Circle', 'tube'],
  ['district', 'District', 'tube'], ['hammersmith-city', 'Hammersmith & City', 'tube'],
  ['jubilee', 'Jubilee', 'tube'], ['metropolitan', 'Metropolitan', 'tube'], ['northern', 'Northern', 'tube'],
  ['piccadilly', 'Piccadilly', 'tube'], ['victoria', 'Victoria', 'tube'], ['waterloo-city', 'Waterloo & City', 'tube'],
  ['dlr', 'DLR', 'dlr'], ['elizabeth', 'Elizabeth', 'elizabeth'], ['liberty', 'Liberty', 'overground'],
  ['lioness', 'Lioness', 'overground'], ['mildmay', 'Mildmay', 'overground'], ['suffragette', 'Suffragette', 'overground'],
  ['weaver', 'Weaver', 'overground'], ['windrush', 'Windrush', 'overground'],
];

function makeNet(data) {
  const n = data.stations.length;
  const adj = Array.from({ length: n }, () => []);
  for (const e of data.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const dist = new Uint8Array(n * n).fill(255);
  const q = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    const o = s * n; dist[o + s] = 0; let h = 0, t = 0; q[t++] = s;
    while (h < t) { const u = q[h++]; const du = dist[o + u]; for (const v of adj[u]) if (dist[o + v] === 255) { dist[o + v] = du + 1; q[t++] = v; } }
  }
  const zones = data.stations.map(s => s.zones);
  const lines = Int32Array.from(data.stations.map(s => s.lines));
  // Zone match precomputed: 0 exact, 1 near, 2 none.
  const zm = new Uint8Array(n * n);
  for (let g = 0; g < n; g++) for (let a = 0; a < n; a++) zm[g * n + a] = zoneMatch(zones[g], zones[a]);
  return { n, stations: data.stations, edges: data.edges, adj, dist, lines, zm };
}

function zoneMatch(G, A) {
  if (G.length === 0 || A.length === 0) return (G.length === 0) === (A.length === 0) ? 0 : 2;
  if (G.some(z => A.includes(z))) return 0;
  if (G.some(z => A.includes(z + 1) || (z > 0 && A.includes(z - 1)))) return 1;
  return 2;
}

// Feedback packed into one integer: stops | zone << 6 | shared << 8.
function fb(net, g, a) {
  const i = g * net.n + a;
  return net.dist[i] | (net.zm[i] << 6) | ((net.lines[g] & net.lines[a]) << 8);
}
const isWin = k => (k & 63) === 0;

function partition(net, g, cands) {
  const m = new Map();
  for (const c of cands) { const k = fb(net, g, c); let b = m.get(k); if (!b) m.set(k, b = []); b.push(c); }
  return m;
}

// Scores every unguessed station against the candidates. Returns all, best first.
function rank(net, cands, guessed) {
  const n = cands.length;
  if (n <= 2) return cands.map(s => ({ station: s, expected: (n - 1) / n, entropy: Math.log2(n), worst: n - 1, couldWin: true, classes: n }));
  const isCand = new Uint8Array(net.n); for (const c of cands) isCand[c] = 1;
  const gset = new Uint8Array(net.n); for (const g of guessed) gset[g] = 1;
  const out = [];
  const counts = new Map();
  for (let g = 0; g < net.n; g++) {
    if (gset[g]) continue;
    counts.clear();
    for (const c of cands) { const k = fb(net, g, c); counts.set(k, (counts.get(k) || 0) + 1); }
    let sq = 0, H = 0, worst = 0;
    for (const [k, c] of counts) { const p = c / n; H -= p * Math.log2(p); if (!isWin(k)) { sq += c * c; if (c > worst) worst = c; } }
    out.push({ station: g, expected: sq / n, entropy: H, worst, couldWin: !!isCand[g], classes: counts.size });
  }
  out.sort((a, b) => a.expected - b.expected || (b.couldWin - a.couldWin) || (b.entropy - a.entropy) || (a.station - b.station));
  return out;
}

// The whole greedy policy from an opener, as a tree. lengths[a] is the number
// of guesses the policy needs when a is the answer.
function policyTree(net, opener) {
  const lengths = new Uint8Array(net.n);
  const all = Array.from({ length: net.n }, (_, i) => i);
  function node(cands, guess, guessed, depth) {
    const part = partition(net, guess, cands);
    const children = [];
    for (const [k, members] of part) {
      if (isWin(k)) { lengths[guess] = depth; children.push({ k, size: 1, win: true }); continue; }
      const next = [...guessed, guess];
      const g2 = rank(net, members, next)[0].station;
      children.push({ k, size: members.length, ...node(members, g2, next, depth + 1) });
    }
    children.sort((a, b) => b.size - a.size);
    return { guess, size: cands.length, children };
  }
  const tree = node(all, opener, [], 1);
  return { tree, lengths };
}

// pickStable from the game: a stable string hash picks one item.
function stableHash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return h; }
function pickStable(items, name) { return items[stableHash(name) % items.length]; }

if (typeof module !== 'undefined') module.exports = { LINES, makeNet, zoneMatch, fb, isWin, partition, rank, policyTree, stableHash, pickStable };

// Clue-aware policy: the answer's mode is known before guess 1, and after the
// w-th wrong guess the w-th clue (1 zone, 2 role, 3 line, 4 end, 5 letter) is
// revealed. clue[j][v] is the label of clue j for station v (clue[0] is mode).
function clueTree(net, clue, opener, members) {
  const lengths = new Map();
  function node(cands, guess, guessed, wrong, depth) {
    const part = partition(net, guess, cands);
    let size = 0;
    const kids = [];
    for (const [k, B] of part) {
      if (isWin(k)) { lengths.set(guess, depth); size += 1; continue; }
      const w = wrong + 1;
      const groups = new Map();
      if (w < clue.length) for (const b of B) { const l = clue[w][b]; (groups.get(l) || groups.set(l, []).get(l)).push(b); }
      else groups.set('', B);
      for (const sub of groups.values()) {
        const next = [...guessed, guess];
        const g2 = rank(net, sub, next)[0].station;
        kids.push(node(sub, g2, next, w, depth + 1));
      }
    }
    return { g: guess, n: cands.length, c: kids, hit: part.has(0) || [...part.keys()].some(isWin) ? 1 : 0 };
  }
  const tree = node(members, opener, [], 0, 1);
  return { tree, lengths };
}
if (typeof module !== 'undefined') module.exports.clueTree = clueTree;
