(function () {
  'use strict';
  const D = window.PAPER_DATA;
  const net = makeNet({
    stations: D.stations.map(([name, lat, lon, zones, lines]) => ({ name, lat, lon, zones, lines })),
    edges: D.edges.map(([a, b, lines]) => ({ a, b, lines })),
  });
  const N = net.n;
  const ALL = d3.range(N);
  const NAME = i => D.stations[i][0];
  const LINE_NAME = j => D.lines[j][1];
  const LINE_MODE = j => D.lines[j][2];
  const linesOf = i => D.lines.map((_, j) => j).filter(j => D.stations[i][4] & (1 << j));
  const modesOf = i => [...new Set(linesOf(i).map(LINE_MODE))];
  const MODE_LABEL = { tube: 'Underground', overground: 'Overground', dlr: 'DLR', elizabeth: 'Elizabeth line' };
  const MODE_SYMBOL = { tube: 't-tube', overground: 't-over', dlr: 't-dlr', elizabeth: 't-liz' };
  const zonesTxt = i => { const z = D.stations[i][3]; return z.length ? 'Zone ' + z.join('/') : 'outside the zones'; };
  const OP = new Map(D.openers.map(o => [o.s, o]));
  const ranked = [...D.openers].sort((a, b) => a.mean - b.mean || a.worst - b.worst || a.s - b.s);
  const rankOf = new Map(ranked.map((o, i) => [o.s, i + 1]));
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const glb = D.openers.reduce((m, o) => (o.lb < m.lb ? o : m));
  const f3 = x => x.toFixed(3), f2 = x => x.toFixed(2), pct = x => (x * 100).toFixed(1) + '%';
  const ord = k => { const s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };
  const byName = name => D.stations.findIndex(s => s[0] === name);
  const log2n = Math.log2(N);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const MONO = 'IBM Plex Mono, ui-monospace, monospace';
  const adMean = d3.mean(D.adaptive.lengths), adWorst = d3.max(D.adaptive.lengths);

  // ── Numbers in the text ──
  const joint = D.clues.joint.counts;
  const kxO = OP.get(D.kx);
  const kxMeanD = d3.sum(D.kxDist.map((c, d) => c * d)) / N;
  const V = {
    built: D.built, n: N, m: D.edges.length, nn: (N * N).toLocaleString('en-GB'), nnk: (N * N).toLocaleString('en-GB'), diam: D.diameter,
    pairs: (N * (N - 1)).toLocaleString('en-GB'),
    'best.mean': f3(best.mean), 'best.name': NAME(best.s), 'best.lb': f3(best.lb), 'best.gap': f3(best.mean - best.lb),
    'best.classes1': best.classes + 1, 'best.left': f2(best.left),
    glb: f3(glb.lb), 'glb.name': NAME(glb.s), 'glb.gap': f3(best.mean - glb.lb),
    'worst.name': NAME(worst.s), 'worst.left': f2(worst.left), spread: f2(worst.mean - best.mean),
    bmax: D.bmax, ib: f3(D.infoBound), logbn: f2(Math.log(N) / Math.log(D.bmax)),
    cb: f3(D.clueBound), 'cb.gap': f3(adMean - D.clueBound), 'ad.mean': f3(adMean), 'ad.worst': adWorst,
    'clue.role': f3(D.clues.role.H), 'clue.roleShown': f3(D.clues.roleShown.H), 'clue.roleGain': f3(D.clues.roleShown.H - D.clues.role.H),
    'clue.joint': f2(D.clues.joint.H), 'clue.unique': Object.values(joint).filter(c => c === 1).length,
    log2n: f2(log2n), 'kx.rank': ord(rankOf.get(D.kx)), 'kx.meand': f2(kxMeanD),
    'hp.b': f2(D.human.practice.fit.b), 'hd.b': f2(D.human.daily.fit.b), 'sm.b': f2(D.human.solverMap.fit.b),
    und: D.adaptive.byMode.Underground.size,
  };
  // ── §8 How people play ──
  // Statistics: pooled two-proportion z-test and Wilson 95% intervals.
  function wilson(k, n) {
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
    return [c - h, c + h];
  }
  function ztest(k1, n1, k2, n2) {
    const p = (k1 + k2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    return (k1 / n1 - k2 / n2) / se;
  }
  const zfmt = z => `z = ${z.toFixed(1)}, ${Math.abs(z) > 3.29 ? 'p < 0.001' : Math.abs(z) > 2.58 ? 'p < 0.01' : Math.abs(z) > 1.96 ? 'p < 0.05' : 'not significant at 0.05'}`;
  function behaviourValues() {
    const SD = D.stats.daily, SP = D.stats.practice;
    const hz = s => s.stops_away_by_guess.map(g => s.stops_bands_by_guess.find(b => b.guess_index === g.guess_index && b.band === 'Correct').guesses / g.guesses);
    const hd = hz(SD), hp = hz(SP);
    const tier = t => SD.win_rate_by_tier.find(x => x.tier === t);
    const core = tier('core'), deep = tier('deep');
    const zd = D.behaviour.zoneDifficulty;
    // Opener quality weighted by use, over the listed openers.
    const ops = SD.opening_stations.map(o => ({ i: byName(o.station), n: o.opens })).filter(o => o.i >= 0);
    const oq = d3.sum(ops, o => o.n * OP.get(o.i).mean) / d3.sum(ops, o => o.n);
    const randomMean = d3.mean(D.openers, o => o.mean);
    const oqpct = D.openers.filter(o => o.mean <= oq).length / N;
    const ab = s => d3.sum(s.abandoned_games, a => a.abandoned) / d3.sum(s.abandoned_games, a => a.started);
    return {
      'b.oq': f3(oq), 'b.oqr': f3(randomMean), 'b.oqpct': pct(oqpct),
      'b.h5d': pct(hd[4]), 'b.h6d': pct(hd[5]), 'b.h5p': pct(hp[4]), 'b.h6p': pct(hp[5]),
      'b.core': pct(core.wins / core.played), 'b.deep': pct(deep.wins / deep.played), 'b.tierz': zfmt(ztest(core.wins, core.played, deep.wins, deep.played)),
      'b.z1': f3(zd[0].map), 'b.zout': f3(zd[zd.length - 1].map),
      'b.tcore': f3(D.behaviour.tierDifficulty[0].map), 'b.tdeep': f3(D.behaviour.tierDifficulty[2].map), 'b.tcorec': f3(D.behaviour.tierDifficulty[0].clues), 'b.tdeepc': f3(D.behaviour.tierDifficulty[2].clues), 'b.tstd': f3(D.behaviour.tierDifficulty[1].map), 'b.ncore': D.behaviour.tierDifficulty[0].n, 'b.ndeep': D.behaviour.tierDifficulty[2].n, 'b.nnever': D.behaviour.tierDifficulty[3].n,
      'b.kxu': f2(D.behaviour.kxUniformMean), 'b.kxgap': f2(D.behaviour.kxUniformMean - 6.07),
      'b.abd': pct(ab(SD)), 'b.abp': pct(ab(SP)),
    };
  }
  Object.assign(V, behaviourValues());
  document.querySelectorAll('[data-v]').forEach(el => el.replaceWith(document.createTextNode(String(V[el.dataset.v] ?? '?'))));
  document.body.normalize();
  const typeset = el => (window.MathJax && MathJax.typesetPromise ? MathJax.typesetPromise(el ? [el] : undefined).catch(() => {}) : null);
  if (window.MathJax && MathJax.startup) MathJax.startup.promise.then(() => typeset());

  // ── Tooltip ──
  const tip = document.getElementById('tip');
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  const stationTip = (i, extra = '') => `<b>${NAME(i)}</b><br>${zonesTxt(i)}<br>${linesOf(i).map(LINE_NAME).join(', ')}${extra}`;

  // ── Shared selection ──
  const listeners = [];
  let selected = best.s;
  const onSelect = fn => listeners.push(fn);
  function select(i) { selected = i; listeners.forEach(fn => fn(i)); }

  // ── Feedback text ──
  const ZONE = ['same zone', 'one zone out', 'different zone'];
  function fbText(k, g) {
    if (isWin(k)) return 'correct';
    const d = k & 63, z = (k >> 6) & 3, sh = k >> 8;
    const shared = linesOf(g).filter(j => sh & (1 << j)).map(LINE_NAME);
    return `${d} stop${d === 1 ? '' : 's'} · ${ZONE[z]} · ${shared.length ? 'shares ' + shared.join(', ') : 'no shared line'}`;
  }

  // ── Projection ──
  const LON0 = -1.0, LON1 = 0.36, LAT0 = 51.385, LAT1 = 51.715, COS = Math.cos(51.5 * Math.PI / 180);
  const MW = 1000, K = MW / ((LON1 - LON0) * COS), MH = Math.round((LAT1 - LAT0) * K);
  const P = D.stations.map(([, lat, lon]) => [(lon - LON0) * COS * K, (LAT1 - lat) * K]);
  const CENTRE = ['Bank', 'Paddington', 'Stratford', 'Brixton', 'Camden Town', 'Canary Wharf'].map(byName);

  // Line adjacency, for trains.
  const lineAdj = D.lines.map(() => new Map());
  D.edges.forEach(([a, b, mask]) => D.lines.forEach((_, j) => {
    if (mask & (1 << j)) { (lineAdj[j].get(a) || lineAdj[j].set(a, []).get(a)).push(b); (lineAdj[j].get(b) || lineAdj[j].set(b, []).get(b)).push(a); }
  }));

  // ── Train animation, shared by every map ──
  const trainSets = [];
  let lastT = 0, running = false;
  function tick(t) {
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    for (const ts of trainSets) if (ts.visible && !ts.paused) ts.advance(dt);
    if (reduceMotion.matches) { running = false; return; }
    requestAnimationFrame(tick);
  }
  function startTrains() { if (!running && !reduceMotion.matches) { running = true; lastT = 0; requestAnimationFrame(tick); } }
  reduceMotion.addEventListener('change', startTrains);

  // ── Map component ──
  let mapCount = 0;
  function makeMap(host, opts = {}) {
    const id = 'm' + (mapCount++);
    const svg = d3.select(host).append('svg').attr('viewBox', `0 0 ${MW} ${MH}`).attr('role', 'img').attr('aria-label', opts.label || 'Map of the network');
    const defs = svg.append('defs');
    defs.append('filter').attr('id', id + 'blur').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%')
      .append('feGaussianBlur').attr('stdDeviation', 9);
    const root = svg.append('g');
    const gUnder = root.append('g');
    const gEdges = root.append('g').attr('fill', 'none');
    const gOver = root.append('g');
    const gSt = root.append('g');
    const gTrains = root.append('g').attr('pointer-events', 'none');
    const gLab = root.append('g').attr('pointer-events', 'none');
    const segs = [];
    D.edges.forEach(([a, b, mask]) => {
      const ls = D.lines.map((_, j) => j).filter(j => mask & (1 << j));
      ls.forEach((j, idx) => segs.push({ a, b, j, off: idx - (ls.length - 1) / 2 }));
    });
    const paths = gEdges.selectAll('path').data(segs).join('path')
      .style('stroke', d => `var(--l${d.j})`).attr('stroke-width', opts.edgeWidth || 1.6).attr('vector-effect', 'non-scaling-stroke').attr('stroke-linecap', 'round');
    const dots = gSt.selectAll('circle').data(ALL).join('circle')
      .attr('cx', i => P[i][0]).attr('cy', i => P[i][1])
      .style('fill', 'var(--panel)').style('stroke', 'var(--ink)').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1)
      .attr('tabindex', -1)
      .on('pointermove', (ev, i) => showTip(stationTip(i, opts.tipExtra ? opts.tipExtra(i) : ''), ev)).on('pointerleave', hideTip)
      .on('click', (ev, i) => (opts.onClick ? opts.onClick(i) : select(i)));
    let k = 1, radius = i => (linesOf(i).length > 1 ? 3.4 : 2.3);
    function geometry() {
      paths.attr('d', d => {
        const [x1, y1] = P[d.a], [x2, y2] = P[d.b];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, o = d.off * 1.8 / k;
        const nx = -(y2 - y1) / len * o, ny = (x2 - x1) / len * o;
        return `M${x1 + nx},${y1 + ny}L${x2 + nx},${y2 + ny}`;
      });
      dots.attr('r', i => radius(i) / Math.sqrt(k));
      gLab.selectAll('text').attr('font-size', 11.5 / k).attr('stroke-width', 3 / k).attr('x', d => P[d.i][0] + 5 / k).attr('y', d => P[d.i][1] - 5 / k);
    }
    const zoom = d3.zoom().scaleExtent([1, 16]).translateExtent([[-40, -40], [MW + 40, MH + 40]])
      .filter(ev => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey || opts.wheel : !ev.button))
      .on('zoom', ev => { root.attr('transform', ev.transform); k = ev.transform.k; geometry(); });
    svg.call(zoom).on('dblclick.zoom', null);
    const tools = d3.select(host).append('div').attr('class', 'maptools');
    const dur = () => (reduceMotion.matches ? 0 : 650);
    const fit = ids => {
      if (!ids.length) return;
      const xs = ids.map(i => P[i][0]), ys = ids.map(i => P[i][1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const s = Math.max(1, Math.min(16, 0.85 / Math.max((x1 - x0 + 40) / MW, (y1 - y0 + 40) / MH)));
      svg.transition().duration(dur()).ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(MW / 2, MH / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    };
    tools.append('button').attr('type', 'button').text('all').attr('aria-label', 'Show the whole network').on('click', () => svg.transition().duration(dur()).call(zoom.transform, d3.zoomIdentity));
    tools.append('button').attr('type', 'button').text('centre').attr('aria-label', 'Zoom to central London').on('click', () => fit(CENTRE));
    if (opts.zones) {
      const zoneVar = i => { const z = D.stations[i][3]; return z.length ? `var(--q${Math.min(7, z[0])})` : 'var(--faint)'; };
      gUnder.attr('filter', `url(#${id}blur)`).style('opacity', 0.45)
        .selectAll('circle').data(ALL).join('circle').attr('cx', i => P[i][0]).attr('cy', i => P[i][1]).attr('r', 26).style('fill', zoneVar);
    }
    // Trains: each runs only on its own line, in that line's colour.
    if (opts.trains) {
      const per = opts.trains;
      const trains = [];
      D.lines.forEach((l, j) => {
        const nodes = [...lineAdj[j].keys()];
        for (let c = 0; c < (j >= 11 ? per + 1 : per); c++) {
          const u = nodes[Math.floor(Math.random() * nodes.length)];
          const nb = lineAdj[j].get(u);
          trains.push({ j, u, v: nb[Math.floor(Math.random() * nb.length)], t: Math.random(), speed: 26 + Math.random() * 14 });
        }
      });
      const uses = gTrains.selectAll('use').data(trains).join('use')
        .attr('href', d => '#' + MODE_SYMBOL[LINE_MODE(d.j)]).attr('width', 44).attr('height', 14).attr('x', -22).attr('y', -7)
        .style('color', d => `var(--l${d.j})`).style('stroke', 'var(--bg)').attr('stroke-width', 1.2);
      const place = () => uses.attr('transform', d => {
        const [x1, y1] = P[d.u], [x2, y2] = P[d.v];
        const x = x1 + (x2 - x1) * d.t, y = y1 + (y2 - y1) * d.t;
        let a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
        let flip = '';
        if (a > 90 || a < -90) { a += 180; flip = ' scale(-1,1)'; }
        return `translate(${x},${y}) rotate(${a}) scale(${0.55 / Math.sqrt(k)})${flip}`;
      });
      const ts = {
        visible: true, paused: false,
        advance(dt) {
          for (const d of trains) {
            const len = Math.hypot(P[d.v][0] - P[d.u][0], P[d.v][1] - P[d.u][1]) || 1;
            d.t += (d.speed * dt) / len;
            while (d.t >= 1) {
              d.t -= 1;
              const nb = lineAdj[d.j].get(d.v);
              const fwd = nb.filter(w => w !== d.u);
              const w = fwd.length ? fwd[Math.floor(Math.random() * fwd.length)] : d.u;
              d.u = d.v; d.v = w;
            }
          }
          place();
        },
      };
      place();
      trainSets.push(ts);
      new IntersectionObserver(es => { ts.visible = es[0].isIntersecting; }).observe(host);
      startTrains();
    }
    geometry();
    const api = {
      svg, root, dots, paths, fit, gOver, gTrains, k: () => k,
      reset() { svg.transition().duration(dur()).call(zoom.transform, d3.zoomIdentity); },
      style(fn, animate) {
        const sel = animate && !reduceMotion.matches ? dots.transition().duration(500).ease(d3.easeCubicOut) : dots;
        sel.style('fill', i => fn(i).fill || 'var(--panel)').style('stroke', i => fn(i).stroke || 'var(--ink)').style('opacity', i => fn(i).opacity ?? 1);
      },
      radius(fn) { radius = fn; geometry(); },
      edgeOpacity(fn, animate) { (animate && !reduceMotion.matches ? paths.transition().duration(500) : paths).style('opacity', d => fn(d)); },
      label(list) {
        gLab.selectAll('text').data(list).join('text')
          .text(d => d.text).style('fill', d => d.color || 'var(--ink)').style('stroke', 'var(--bg)').attr('paint-order', 'stroke')
          .attr('font-family', MONO).attr('font-weight', 600);
        geometry();
      },
      onZoom(fn) { zoom.on('zoom.extra', fn); },
    };
    return api;
  }

  // ── Exhibit 0: hero ──
  const hero = makeMap(document.getElementById('mapHero'), { trains: 2, zones: true, label: 'The whole network with trains running', onClick: select });
  // On narrow screens the hero keeps its height and crops to the centre rather than shrinking.
  d3.select('#mapHero svg').attr('preserveAspectRatio', 'xMidYMid slice');

  // ── Exhibit 1: rolling stock ──
  (function () {
    const host = document.getElementById('stock');
    const count = mode => ALL.filter(i => modesOf(i).includes(mode)).length;
    const lineFor = { tube: 1, dlr: 11, overground: 15, elizabeth: 12 };
    host.innerHTML = [['tube', 'Deep-level Tube stock', 'round-profile cars for small tunnels'], ['dlr', 'DLR articulated car', 'two sections, driverless'], ['overground', 'Overground unit', 'long walk-through suburban train'], ['elizabeth', 'Elizabeth line unit', 'nine cars, raked nose']]
      .map(([m, name, note]) => `<div><svg viewBox="-32 -9 64 18" aria-hidden="true"><use href="#${MODE_SYMBOL[m]}" x="-30" y="-8" width="60" height="16" style="color:var(--l${lineFor[m]})"/></svg><b>${MODE_LABEL[m]}</b><span>${name}: ${note}</span><span>${count(m)} stations · ${D.lines.filter(l => l[2] === m).length} line${D.lines.filter(l => l[2] === m).length === 1 ? '' : 's'}</span></div>`).join('');
  })();

  // ── Exhibit 2: zones ──
  makeMap(document.getElementById('mapZones'), { zones: true, trains: 1, label: 'Zones and lines' });

  // ── Distance helpers ──
  const distRow = s => ALL.map(v => net.dist[s * N + v]);
  const seq7 = (x, max) => Math.max(1, Math.min(7, 1 + Math.floor((x / (max + 1)) * 7)));

  // ── Exhibit 3: distance from one station ──
  const distMap = (function () {
    const sel = document.getElementById('distsrc');
    const order = ALL.slice().sort((a, b) => NAME(a).localeCompare(NAME(b)));
    order.forEach(i => sel.add(new Option(NAME(i), i)));
    const map = makeMap(document.getElementById('mapDist'), { label: 'Distance from the selected station', tipExtra: i => `<br>${net.dist[src * N + i]} stops from ${NAME(src)}` });
    let src = best.s, timer = null;
    function paint(limit = Infinity) {
      const row = distRow(src), max = d3.max(row);
      map.style(i => (i === src ? { fill: 'var(--signal)', stroke: 'var(--ink)' } : row[i] <= limit ? { fill: `var(--q${seq7(row[i], max)})`, stroke: `var(--q${Math.min(7, seq7(row[i], max) + 1)})` } : { fill: 'var(--panel)', stroke: 'var(--faint)', opacity: 0.4 }));
      map.edgeOpacity(d => (row[d.a] <= limit && row[d.b] <= limit ? 0.5 : 0.12));
      map.label([{ i: src, text: NAME(src) }]);
      shells(row);
    }
    function shells(row) {
      const counts = new Array(D.diameter + 1).fill(0); row.forEach(d => counts[d]++);
      const w = 360, h = 150, m = { l: 34, r: 6, t: 8, b: 26 };
      const g = frame('#distshell', w, h, m);
      const max = d3.max(row);
      const x = d3.scaleBand().domain(d3.range(D.diameter + 1)).range([0, w - m.l - m.r]).padding(0.12);
      const y = d3.scaleLinear().domain([0, d3.max(counts)]).nice().range([h - m.t - m.b, 0]);
      g.selectAll('rect').data(counts.map((c, d) => ({ d, c }))).join('rect').attr('x', d => x(d.d)).attr('width', x.bandwidth()).attr('y', d => y(d.c)).attr('height', d => y(0) - y(d.c)).attr('rx', 1.5)
        .style('fill', d => `var(--q${seq7(d.d, max)})`).on('pointermove', (ev, d) => showTip(`<b>${d.d} stops</b><br>${d.c} station${d.c === 1 ? '' : 's'}`, ev)).on('pointerleave', hideTip);
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).tickValues(d3.range(0, D.diameter + 1, 5)));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4));
    }
    function run() {
      clearInterval(timer);
      const row = distRow(src), max = d3.max(row);
      if (reduceMotion.matches) return paint();
      // Breadth-first tree edges, one train per edge per tick.
      const parent = new Int32Array(N).fill(-1); const q = [src]; parent[src] = src;
      for (let h = 0; h < q.length; h++) for (const v of net.adj[q[h]]) if (parent[v] < 0) { parent[v] = q[h]; q.push(v); }
      let t = 0;
      paint(0);
      const step = () => {
        t++;
        const movers = ALL.filter(v => row[v] === t && parent[v] >= 0);
        const lineOn = (a, b) => { const e = D.edges.find(([x, y]) => (x === a && y === b) || (x === b && y === a)); return e ? D.lines.findIndex((_, j) => e[2] & (1 << j)) : 1; };
        map.gTrains.selectAll('use.bfs').data(movers.slice(0, 80), v => v).join('use').attr('class', 'bfs')
          .attr('href', v => '#' + MODE_SYMBOL[LINE_MODE(lineOn(parent[v], v))]).attr('width', 44).attr('height', 14).attr('x', -22).attr('y', -7)
          .style('color', v => `var(--l${lineOn(parent[v], v)})`)
          .attr('transform', v => `translate(${P[parent[v]][0]},${P[parent[v]][1]}) scale(${0.32 / Math.sqrt(map.k())})`)
          .transition().duration(260).ease(d3.easeLinear)
          .attr('transform', v => `translate(${P[v][0]},${P[v][1]}) scale(${0.32 / Math.sqrt(map.k())})`);
        setTimeout(() => paint(t), 260);
        if (t >= max) { clearInterval(timer); setTimeout(() => map.gTrains.selectAll('use.bfs').remove(), 600); }
      };
      timer = setInterval(step, 300);
    }
    sel.value = src;
    sel.onchange = () => select(+sel.value);
    document.getElementById('distplay').onclick = run;
    onSelect(i => { src = i; sel.value = i; clearInterval(timer); map.gTrains.selectAll('use.bfs').remove(); paint(); });
    paint();
    return { paint };
  })();

  // ── Axis helper ──
  function frame(sel, w, h, m) {
    const svg = d3.select(sel).attr('viewBox', `0 0 ${w} ${h}`).style('width', '100%').style('height', 'auto');
    svg.selectAll('*').remove();
    return svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  }

  // ── Exhibit 3b: all pairs ──
  (function () {
    const w = 360, h = 150, m = { l: 40, r: 6, t: 8, b: 26 };
    const g = frame('#disthist', w, h, m);
    const data = D.distHist.map((c, d) => ({ d, c })).filter(x => x.d > 0);
    const x = d3.scaleBand().domain(data.map(d => d.d)).range([0, w - m.l - m.r]).padding(0.12);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.c)]).nice().range([h - m.t - m.b, 0]);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
    g.selectAll('rect').data(data).join('rect').attr('x', d => x(d.d)).attr('width', x.bandwidth()).attr('y', d => y(d.c)).attr('height', d => y(0) - y(d.c)).attr('rx', 1.5)
      .style('fill', 'var(--s1)').on('pointermove', (ev, d) => showTip(`<b>${d.d} stops</b><br>${d.c.toLocaleString('en-GB')} ordered pairs (${pct(d.c / (N * (N - 1)))})`, ev)).on('pointerleave', hideTip);
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).tickValues(data.map(d => d.d).filter(d => d % 5 === 0)));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4, '~s'));
  })();

  // ── Exhibit 4: distance matrix ──
  (function () {
    const cv = document.getElementById('matrix'), ctx = cv.getContext('2d');
    const sel = document.getElementById('matorder');
    function order(kind) {
      const idx = ALL.slice();
      if (kind === 'lon') return idx.sort((a, b) => D.stations[a][2] - D.stations[b][2]);
      if (kind === 'line') return idx.sort((a, b) => (linesOf(a)[0] - linesOf(b)[0]) || (D.stations[a][2] - D.stations[b][2]));
      const s = byName('Bank'), seen = new Uint8Array(N), out = [s]; seen[s] = 1;
      for (let h = 0; h < out.length; h++) for (const v of net.adj[out[h]].slice().sort((a, b) => a - b)) if (!seen[v]) { seen[v] = 1; out.push(v); }
      return out;
    }
    function draw() {
      const o = order(sel.value);
      const ramp = [1, 2, 3, 4, 5, 6, 7].map(i => d3.color(css('--q' + i)) || d3.color('#888'));
      const img = ctx.createImageData(N, N);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const col = ramp[seq7(net.dist[o[r] * N + o[c]], D.diameter) - 1], p = (r * N + c) * 4;
        img.data[p] = col.r; img.data[p + 1] = col.g; img.data[p + 2] = col.b; img.data[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    sel.onchange = draw;
    draw();
    window.__redraw = (window.__redraw || []).concat(draw);
  })();

  // ── Clue helpers ──
  const CLUE_NAMES = ['Mode', 'Fare zone', 'On the network', 'One of its lines', 'From the end of the line', 'First letter'];
  const ROLE = { terminus: 'End of the line', interchange: 'An interchange', through: 'A through station' };
  function clueText(j, v) {
    const c = D.clue[j][v];
    if (j === 1) return c === 'out' ? 'Outside the zones' : (c.includes('&') ? 'Zones ' + c.replace('&', ' & ') : 'Zone ' + c);
    if (j === 2) return ROLE[c];
    if (j === 3) { const l = D.lines.find(x => x[0] === c); return l ? (l[2] === 'dlr' ? l[1] : l[1] + ' line') : c; }
    if (j === 4) { const n = +c.split(':')[1]; return n === 0 ? 'It is the end of the line' : `${n} stop${n === 1 ? '' : 's'}`; }
    return c;
  }

  // ── Exhibit 5: the solver at work ──
  const game = (function () {
    const ansSel = document.getElementById('ans'), opnSel = document.getElementById('opn');
    const order = ALL.slice().sort((a, b) => NAME(a).localeCompare(NAME(b)));
    for (const sel of [ansSel, opnSel]) for (const i of order) sel.add(new Option(NAME(i), i));
    const dl = document.getElementById('stationlist'); dl.innerHTML = order.map(i => `<option value="${NAME(i).replace(/"/g, '&quot;')}">`).join('');
    ansSel.value = byName('Brixton'); opnSel.value = best.s;
    const map = makeMap(document.getElementById('map1'), { label: 'The solver playing one game' });
    let S, clues = false;
    const offBtn = document.getElementById('clu-off'), onBtn = document.getElementById('clu-on');
    function setClues(on) { clues = on; offBtn.setAttribute('aria-pressed', !on); onBtn.setAttribute('aria-pressed', on); reset(); }
    offBtn.onclick = () => setClues(false); onBtn.onclick = () => setClues(true);
    function initial(answer) { return clues ? ALL.filter(v => D.clue[0][v] === D.clue[0][answer]) : ALL.slice(); }
    function statsFor(g, cands) {
      const part = partition(net, g, cands); const n = cands.length;
      let sq = 0, s2 = 0, H = 0, w = 0;
      for (const [k, B] of part) { const p = B.length / n; H -= p * Math.log2(p); s2 += p * p; if (!isWin(k)) { sq += B.length ** 2; w = Math.max(w, B.length); } }
      return { station: g, expected: sq / n, entropy: H, h2: -Math.log2(s2), worst: w, classes: part.size, couldWin: cands.includes(g), part };
    }
    function chooseNext(st) {
      if (!st.obs.length) return st.opener;
      return rank(net, st.cands, st.obs.map(o => o.g))[0].station;
    }
    function advance(st) {
      const g = chooseNext(st);
      const k = fb(net, g, st.answer);
      let after = isWin(k) ? [st.answer] : partition(net, g, st.cands).get(k);
      let wrong = st.obs.filter(o => !isWin(o.k)).length;
      if (!isWin(k) && clues) { wrong++; if (wrong <= 5) after = after.filter(v => D.clue[wrong][v] === D.clue[wrong][st.answer]); }
      st.obs.push({ g, k, before: st.cands.length, after: isWin(k) ? 0 : after.length, cands: st.cands });
      st.cands = after;
      st.done = isWin(k) || st.obs.length >= 10;
    }
    function fresh() { return { answer: +ansSel.value, opener: +opnSel.value, obs: [], cands: initial(+ansSel.value), done: false }; }
    function reset() { S = fresh(); render(true); multiples(); }
    function render(fitView) {
      const alive = new Uint8Array(N); S.cands.forEach(c => (alive[c] = 1));
      const guessed = new Map(S.obs.map(o => [o.g, o]));
      const next = S.done ? null : statsFor(chooseNext(S), S.cands);
      const occurs = next ? fb(net, next.station, S.answer) : -1;
      const drow = next ? distRow(next.station) : null, dmax = drow ? d3.max(S.cands, c => drow[c]) : 1;
      map.style(i => {
        if (S.done && i === S.answer) return { fill: 'var(--signal)', stroke: 'var(--signal)' };
        if (guessed.has(i)) return { fill: 'var(--ink)', stroke: 'var(--ink)' };
        if (alive[i]) {
          const ring = next && fb(net, next.station, i) === occurs;
          return { fill: next ? `var(--q${seq7(drow[i], dmax)})` : 'var(--panel)', stroke: ring ? 'var(--signal)' : 'var(--ink)' };
        }
        return { fill: 'var(--panel)', stroke: 'var(--faint)', opacity: 0.28 };
      }, true);
      map.radius(i => (alive[i] && next && fb(net, next.station, i) === occurs ? 4.6 : linesOf(i).length > 1 ? 3.4 : 2.3));
      map.edgeOpacity(d => (alive[d.a] || alive[d.b] ? 0.9 : 0.16), true);
      const labels = S.obs.map((o, idx) => ({ i: o.g, text: isWin(o.k) ? `★ ${NAME(o.g)}` : `${idx + 1} · ${NAME(o.g)} ${o.k & 63}`, color: isWin(o.k) ? 'var(--signal)' : 'var(--ink)' }));
      if (next) labels.push({ i: next.station, text: `next: ${NAME(next.station)}`, color: 'var(--accent)' });
      if (S.cands.length <= 6 && !S.done) S.cands.forEach(c => labels.push({ i: c, text: NAME(c), color: 'var(--muted)' }));
      map.label(labels);
      if (fitView) { if (S.cands.length < N) map.fit(S.cands); else map.reset(); }
      const n = S.cands.length;
      document.getElementById('s-c').innerHTML = `${n}<small>of ${N}</small>`;
      document.getElementById('s-h').innerHTML = `${Math.log2(n).toFixed(2)}<small>bits</small>`;
      document.getElementById('s-g').textContent = S.done ? `solved in ${S.obs.length}` : NAME(next.station);
      const wrong = S.obs.filter(o => !isWin(o.k)).length;
      document.getElementById('s-p').innerHTML = clues ? CLUE_NAMES.slice(0, Math.min(6, wrong + 1)).map((c, j) => `${c}: <b>${clueText(j, S.answer)}</b>`).join('<br>') : 'off';
      const part1 = d3.select('#part1'); part1.selectAll('*').remove();
      if (next) {
        const part = [...next.part].sort((a, b) => b[1].length - a[1].length);
        const x = d3.scaleLinear().domain([0, n]).range([0, 400]);
        let acc = 0;
        part1.selectAll('rect').data(part).join('rect')
          .attr('x', d => { const v = x(acc); acc += d[1].length; return v; }).attr('y', 4).attr('height', 26)
          .attr('width', d => Math.max(0.6, x(d[1].length) - (x(d[1].length) > 4 ? 1.5 : 0))).attr('rx', 1.5)
          .style('fill', d => (d[0] === occurs ? 'var(--signal)' : isWin(d[0]) ? 'var(--s3)' : 'var(--faint)'))
          .on('pointermove', (ev, d) => showTip(`<b>${d[1].length} station${d[1].length === 1 ? '' : 's'}</b><br>${fbText(d[0], next.station)}${d[1].length <= 8 ? '<br>' + d[1].map(NAME).join(', ') : ''}`, ev))
          .on('pointerleave', hideTip);
        part1.append('text').attr('x', 0).attr('y', 43).attr('font-size', 10.5).attr('font-family', MONO).style('fill', 'var(--muted)')
          .text(`${part.length} blocks · largest ${part[0][1].length} · red: the block that occurs`);
        liveMath('live1', next, n);
      } else {
        document.getElementById('live1').innerHTML = `<span class="mono" style="color:var(--muted)">Solved: ${S.obs.length} guesses.</span>`;
        runHome();
      }
      document.getElementById('log').innerHTML = S.obs.map((o, i) =>
        `<tr><td>${i + 1}</td><td>${NAME(o.g)}</td><td>${fbText(o.k, o.g)}</td><td class="n">${isWin(o.k) ? '—' : o.after}</td><td class="n">${isWin(o.k) ? '' : Math.log2(o.before / Math.max(1, o.after)).toFixed(2)}</td></tr>`).join('');
      document.getElementById('step').disabled = S.done;
      document.getElementById('play').disabled = S.done;
      sandbox();
    }
    // Once solved, a train runs the shortest path from each earlier guess to the answer.
    function runHome() {
      map.gTrains.selectAll('*').remove();
      S.obs.filter(o => !isWin(o.k)).forEach((o, idx) => {
        const parent = new Int32Array(N).fill(-1); const q = [S.answer]; parent[S.answer] = S.answer;
        for (let h = 0; h < q.length; h++) for (const v of net.adj[q[h]]) if (parent[v] < 0) { parent[v] = q[h]; q.push(v); }
        const path = [o.g]; while (path[path.length - 1] !== S.answer) path.push(parent[path[path.length - 1]]);
        map.gOver.append('path').attr('d', 'M' + path.map(v => P[v].join(',')).join('L')).attr('fill', 'none').style('stroke', 'var(--signal)').attr('stroke-width', 2).attr('stroke-dasharray', '4 3').attr('vector-effect', 'non-scaling-stroke').attr('class', 'home');
        if (reduceMotion.matches) return;
        const use = map.gTrains.append('use').attr('href', '#t-tube').attr('width', 44).attr('height', 14).attr('x', -22).attr('y', -7).style('color', 'var(--signal)');
        let i = 0;
        const hop = () => {
          if (i >= path.length - 1) return;
          const a = P[path[i]], b = P[path[i + 1]];
          let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, flip = '';
          if (ang > 90 || ang < -90) { ang += 180; flip = ' scale(-1,1)'; }
          const s = 0.36 / Math.sqrt(map.k());
          use.attr('transform', `translate(${a[0]},${a[1]}) rotate(${ang}) scale(${s})${flip}`)
            .transition().delay(idx * 200).duration(260).ease(d3.easeLinear).attr('transform', `translate(${b[0]},${b[1]}) rotate(${ang}) scale(${s})${flip}`)
            .on('end', () => { i++; hop(); });
        };
        hop();
      });
    }
    function liveMath(id, r, n) {
      const el = document.getElementById(id);
      const win = r.couldWin ? 1 : 0;
      el.innerHTML = `$$\\mathbb{E}|C'| = ${n}\\cdot 2^{-${r.h2.toFixed(3)}} - \\tfrac{${win}}{${n}} = ${r.expected.toFixed(3)},\\quad H_1 = ${r.entropy.toFixed(3)},\\ H_2 = ${r.h2.toFixed(3)}\\ \\text{bits},\\quad \\text{worst} = ${r.worst}$$`;
      typeset(el);
    }
    function step() { if (!S.done) { map.gOver.selectAll('.home').remove(); advance(S); render(true); } }
    let playing = null;
    function play() {
      if (playing) { clearTimeout(playing); playing = null; document.getElementById('play').textContent = 'play'; return; }
      document.getElementById('play').textContent = 'pause';
      const go = () => { if (S.done) { playing = null; document.getElementById('play').textContent = 'play'; return; } step(); playing = setTimeout(go, reduceMotion.matches ? 200 : 1100); };
      go();
    }
    document.getElementById('step').onclick = step;
    document.getElementById('play').onclick = play;
    document.getElementById('reset').onclick = () => { map.gOver.selectAll('.home').remove(); map.gTrains.selectAll('*').remove(); reset(); };
    document.getElementById('ans-rand').onclick = () => { ansSel.value = Math.floor(Math.random() * N); reset(); };
    ansSel.onchange = reset; opnSel.onchange = reset;
    onSelect(i => { opnSel.value = i; map.gOver.selectAll('.home').remove(); map.gTrains.selectAll('*').remove(); reset(); });

    // Exhibit 6: sandbox.
    const yours = document.getElementById('yours');
    yours.addEventListener('input', sandbox);
    function sandbox() {
      const t = document.getElementById('sandtable');
      if (S.done) { t.innerHTML = '<tbody><tr><td>The game in Exhibit 5 is solved; reset it to compare guesses.</td></tr></tbody>'; document.getElementById('live2').innerHTML = ''; return; }
      const solver = statsFor(chooseNext(S), S.cands);
      const g = byName(yours.value.trim());
      const rows = [['solver: ' + NAME(solver.station), solver]];
      if (g >= 0) rows.push(['yours: ' + NAME(g), statsFor(g, S.cands)]);
      t.innerHTML = `<thead><tr><th>guess</th><th class="n">E|C′|</th><th class="n">H₁</th><th class="n">H₂</th><th class="n">worst</th><th class="n">blocks</th><th>could win</th></tr></thead><tbody>` +
        rows.map(([l, r]) => `<tr><td>${l}</td><td class="n">${r.expected.toFixed(3)}</td><td class="n">${r.entropy.toFixed(3)}</td><td class="n">${r.h2.toFixed(3)}</td><td class="n">${r.worst}</td><td class="n">${r.classes}</td><td>${r.couldWin ? 'yes' : 'no'}</td></tr>`).join('') + '</tbody>';
      if (g >= 0) liveMath('live2', rows[1][1], S.cands.length); else document.getElementById('live2').innerHTML = '';
    }

    // Exhibit 7: small multiples of the whole game.
    function multiples() {
      const st = fresh(); while (!st.done) advance(st);
      const host = document.getElementById('multiples'); host.innerHTML = '';
      const scrub = document.getElementById('multscrub'); scrub.max = st.obs.length - 1; scrub.value = 0;
      const ink = d3.color(css('--ink')), faint = d3.color(css('--faint')), sig = d3.color(css('--signal'));
      st.obs.forEach((o, i) => {
        const fig = document.createElement('figure');
        const cv = document.createElement('canvas'); cv.width = 400; cv.height = Math.round(400 * MH / MW);
        const ctx = cv.getContext('2d'); const sx = cv.width / MW;
        ctx.strokeStyle = faint.formatRgb(); ctx.lineWidth = 0.8;
        ctx.beginPath(); D.edges.forEach(([a, b]) => { ctx.moveTo(P[a][0] * sx, P[a][1] * sx); ctx.lineTo(P[b][0] * sx, P[b][1] * sx); }); ctx.stroke();
        const alive = new Set(o.cands);
        ctx.fillStyle = ink.formatRgb();
        o.cands.forEach(v => { ctx.beginPath(); ctx.arc(P[v][0] * sx, P[v][1] * sx, alive.size > 60 ? 1.3 : 2.4, 0, 7); ctx.fill(); });
        ctx.fillStyle = sig.formatRgb(); ctx.beginPath(); ctx.arc(P[o.g][0] * sx, P[o.g][1] * sx, 4.5, 0, 7); ctx.fill();
        cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Before guess ${i + 1}: ${o.cands.length} candidates`);
        fig.append(cv);
        const cap = document.createElement('figcaption');
        cap.textContent = `guess ${i + 1}: ${NAME(o.g)} · ${o.before} → ${isWin(o.k) ? 'solved' : o.after}`;
        fig.append(cap); host.append(fig);
      });
      const mark = () => { [...host.children].forEach((f, i) => f.classList.toggle('on', i === +scrub.value)); document.getElementById('multlabel').textContent = `${+scrub.value + 1} of ${st.obs.length}`; };
      scrub.oninput = mark; mark();
    }
    window.__redraw = (window.__redraw || []).concat(multiples);
    reset();
    return { reset };
  })();

  // ── Exhibit 8: policy tree icicle ──
  (function () {
    const sel = document.getElementById('treeop');
    for (const o of ranked) sel.add(new Option(`${NAME(o.s)} (${f3(o.mean)})`, o.s));
    sel.value = best.s;
    function treeFor(s) {
      if (s === D.stratford) return D.stratfordTree;
      const { tree } = policyTree(net, s);
      const compact = n => (n.win ? { w: 1 } : { g: n.guess, n: n.size, c: n.children.map(c => (c.win ? { w: 1 } : compact(c))) });
      return compact(tree);
    }
    function draw() {
      const t = treeFor(+sel.value);
      const root = d3.hierarchy(t, d => (d.c ? d.c.filter(c => !c.w) : null)).sum(d => (d.c ? d.c.filter(c => c.w).length : 0));
      const depth = root.height + 1;
      const w = 1000, colW = w / (depth + 0.4), h = Math.max(520, N * 1.35);
      d3.partition().size([h, colW * depth])(root);
      const svg = d3.select('#icicle').attr('viewBox', `0 0 ${w} ${h + 22}`).style('width', '100%').style('min-width', '640px').style('height', 'auto');
      svg.selectAll('*').remove();
      for (let c = 0; c < depth; c++) svg.append('text').attr('x', c * colW + 4).attr('y', 12).style('fill', 'var(--muted)').text(`guess ${c + 1}`);
      const g = svg.append('g').attr('transform', 'translate(0,20)');
      const nodes = root.descendants();
      const cell = g.selectAll('g').data(nodes).join('g').attr('transform', d => `translate(${d.y0},${d.x0})`);
      cell.append('rect').attr('width', d => Math.max(0, d.y1 - d.y0 - 2)).attr('height', d => Math.max(0.5, d.x1 - d.x0 - (d.x1 - d.x0 > 3 ? 1 : 0)))
        .attr('rx', 1.5).style('fill', d => `var(--q${Math.min(7, 2 + d.depth)})`).style('opacity', 0.92)
        .on('pointermove', (ev, d) => showTip(`<b>guess ${d.depth + 1}: ${NAME(d.data.g)}</b><br>${d.data.n} candidate${d.data.n === 1 ? '' : 's'} reach this node`, ev))
        .on('pointerleave', hideTip).on('click', (ev, d) => select(d.data.g));
      cell.filter(d => d.x1 - d.x0 > 11).append('text').attr('x', 4).attr('y', d => Math.min(12, (d.x1 - d.x0) / 2 + 4))
        .style('fill', d => (d.depth >= 3 ? 'var(--bg)' : 'var(--ink)')).text(d => `${NAME(d.data.g)} · ${d.data.n}`);
      const unit = h / N;
      g.selectAll('rect.hit').data(nodes.filter(d => d.data.c && d.data.c.some(c => c.w))).join('rect').attr('class', 'hit')
        .attr('x', d => d.y1 - 2).attr('y', d => d.x1 - Math.max(0.8, unit)).attr('width', 6).attr('height', Math.max(0.8, unit)).style('fill', 'var(--signal)');
      const o = OP.get(+sel.value);
      document.getElementById('tree-note').textContent = `mean ${f3(o.mean)} · worst ${o.worst} · LB ${f3(o.lb)} · ${o.classes + 1} first-guess blocks`;
    }
    sel.onchange = draw;
    onSelect(i => { sel.value = i; draw(); });
    draw();
  })();

  // ── Heat scales ──
  function heatScale(values) { return d3.scaleQuantize().domain(d3.extent(values)).range([1, 2, 3, 4, 5, 6, 7]); }
  function legend(el, q, label, fmt = f2) {
    const th = q.thresholds(), dom = q.domain();
    el.innerHTML = `<span>${label}</span>` + [1, 2, 3, 4, 5, 6, 7].map((b, i) => `<span><i class="swatch" style="background:var(--q${b})"></i>${fmt(i ? th[i - 1] : dom[0])}</span>`).join('') + `<span>to ${fmt(dom[1])}</span>`;
  }
  function toggle(a, b, fn) {
    const A = document.getElementById(a), B = document.getElementById(b);
    const set = v => { A.setAttribute('aria-pressed', !v); B.setAttribute('aria-pressed', v); fn(v); };
    A.onclick = () => set(false); B.onclick = () => set(true);
  }

  // ── Exhibit 10: opener heatmap and explorer ──
  (function () {
    let withClues = false, cur = best.s;
    const map = makeMap(document.getElementById('map2'), { label: 'Mean guesses by opener', tipExtra: i => `<br>mean ${f3(OP.get(i).mean)} map only · ${f3(OP.get(i).cmean)} with panel` });
    function paint() {
      const val = i => (withClues ? OP.get(i).cmean : OP.get(i).mean);
      const q = heatScale(ALL.map(val));
      legend(document.getElementById('heatlegend'), q, 'mean guesses:');
      map.style(i => (i === cur ? { fill: 'var(--signal)', stroke: 'var(--ink)' } : { fill: `var(--q${q(val(i))})`, stroke: `var(--q${Math.min(7, q(val(i)) + 1)})` }), true);
      map.edgeOpacity(() => 0.3);
      map.label([{ i: cur, text: NAME(cur) }]);
      detail(cur);
    }
    function detail(i) {
      const o = OP.get(i);
      const hist = withClues ? o.chist : o.hist;
      const part = [...partition(net, i, ALL)].filter(([k]) => !isWin(k)).map(([, B]) => B.length).sort((a, b) => b - a);
      const s2 = part.reduce((a, b) => a + (b / N) ** 2, 1 / N ** 2);
      const el = document.getElementById('opdetail');
      el.innerHTML = `
        <div class="panel-title">opener</div>
        <div style="font:800 1.4rem/1.15 var(--display);font-stretch:85%">${NAME(i)}</div>
        <div style="font:.76rem var(--mono);color:var(--muted);margin:.2rem 0 .7rem">${zonesTxt(i)} · ${linesOf(i).map(LINE_NAME).join(', ')}</div>
        <div class="stats">
          <div class="stat"><div class="k">mean · rank</div><div class="v">${f3(withClues ? o.cmean : o.mean)}<small>${ord(rankOf.get(i))} map only</small></div></div>
          <div class="stat"><div class="k">worst · LB</div><div class="v">${withClues ? o.cworst : o.worst}<small>LB ${f3(o.lb)}</small></div></div>
          <div class="stat"><div class="k">E|C′| after guess 1</div><div class="v">${f2(o.left)}</div></div>
          <div class="stat"><div class="k">H₁ · H₂ · blocks</div><div class="v" style="font-size:1rem">${o.entropy.toFixed(2)} · ${(-Math.log2(s2)).toFixed(2)}<small>${o.classes + 1}</small></div></div>
        </div>
        <div class="panel-title">guesses needed over all answers${withClues ? ', with panel' : ''}</div><svg id="ophist"></svg>
        <div class="panel-title">first-guess block sizes, largest first</div><svg id="oppart"></svg>`;
      const hw = 360, hh = 120, hm = { l: 30, r: 6, t: 12, b: 22 };
      const g = frame('#ophist', hw, hh, hm);
      const xs = d3.scaleBand().domain([1, 2, 3, 4, 5, 6]).range([0, hw - hm.l - hm.r]).padding(0.2);
      const ys = d3.scaleLinear().domain([0, N * 0.8]).range([hh - hm.t - hm.b, 0]);
      const data = hist.map((c, k) => ({ k: k + 1, c }));
      g.selectAll('rect').data(data).join('rect').attr('x', d => xs(d.k)).attr('width', xs.bandwidth()).attr('y', ys(0)).attr('height', 0).attr('rx', 2).style('fill', withClues ? 'var(--s4)' : 'var(--s1)')
        .on('pointermove', (ev, d) => showTip(`<b>${d.k} guess${d.k === 1 ? '' : 'es'}</b><br>${d.c} answers (${pct(d.c / N)})`, ev)).on('pointerleave', hideTip)
        .transition().duration(reduceMotion.matches ? 0 : 450).ease(d3.easeCubicOut).attr('y', d => ys(d.c)).attr('height', d => ys(0) - ys(d.c));
      g.selectAll('text.v').data(data).join('text').attr('class', 'v').attr('x', d => xs(d.k) + xs.bandwidth() / 2).attr('y', d => ys(d.c) - 3).attr('text-anchor', 'middle').attr('font-size', 10).attr('font-family', MONO).style('fill', 'var(--ink-2)').text(d => (d.c ? d.c : ''));
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ys(0)})`).call(d3.axisBottom(xs));
      const pw = 360, ph = 90, pm = { l: 30, r: 6, t: 6, b: 18 };
      const gp = frame('#oppart', pw, ph, pm);
      const xp = d3.scaleBand().domain(d3.range(part.length)).range([0, pw - pm.l - pm.r]).padding(0.15);
      const yp = d3.scaleLinear().domain([0, d3.max(part)]).nice().range([ph - pm.t - pm.b, 0]);
      gp.selectAll('rect').data(part).join('rect').attr('x', (d, k) => xp(k)).attr('width', Math.max(0.5, xp.bandwidth())).attr('y', d => yp(d)).attr('height', d => yp(0) - yp(d)).style('fill', 'var(--s2)')
        .on('pointermove', (ev, d) => showTip(`a block of ${d} station${d === 1 ? '' : 's'}`, ev)).on('pointerleave', hideTip);
      gp.append('g').attr('class', 'axis').call(d3.axisLeft(yp).ticks(3));
      gp.append('text').attr('x', pw - pm.l - pm.r).attr('y', ph - pm.t - 4).attr('text-anchor', 'end').attr('font-size', 10).attr('font-family', MONO).style('fill', 'var(--muted)').text(`${part.length} blocks plus the win`);
    }
    toggle('heat-map', 'heat-clue', v => { withClues = v; paint(); });
    onSelect(i => { cur = i; paint(); });
    paint();
  })();

  // ── Exhibit 11: every opener, sortable and filterable ──
  (function () {
    const t = document.getElementById('optable');
    const cols = [
      ['rank', o => rankOf.get(o.s), 'n'], ['opener', o => NAME(o.s), ''], ['zones', o => D.stations[o.s][3].join('/') || 'out', ''],
      ['modes', o => modesOf(o.s).map(m => MODE_LABEL[m]).join(', '), ''], ['lines', o => linesOf(o.s).length, 'n'],
      ['mean', o => o.mean, 'n', f3], ['worst', o => o.worst, 'n'], ['≤2', o => (o.hist[0] + o.hist[1]) / N, 'n', pct], ['≤3', o => (o.hist[0] + o.hist[1] + o.hist[2]) / N, 'n', pct],
      ['E|C′|', o => o.left, 'n', f2], ['H₁', o => o.entropy, 'n', f2], ['LB', o => o.lb, 'n', f3], ['panel mean', o => o.cmean, 'n', f3], ['panel worst', o => o.cworst, 'n'],
    ];
    let sortCol = 0, dir = 1;
    const filt = document.getElementById('opfilter'), modeSel = document.getElementById('opmode');
    function draw() {
      const q = filt.value.trim().toLowerCase(), m = modeSel.value;
      const rows = D.openers.filter(o => (!q || NAME(o.s).toLowerCase().includes(q)) && (!m || modesOf(o.s).includes(m)))
        .sort((a, b) => { const x = cols[sortCol][1](a), y = cols[sortCol][1](b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      t.innerHTML = `<thead><tr>${cols.map((c, i) => `<th class="th-sort ${c[2]}" tabindex="0" data-i="${i}" aria-sort="${i === sortCol ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${c[0]}</th>`).join('')}</tr></thead><tbody>` +
        rows.map(o => `<tr data-s="${o.s}" class="${o.s === selected ? 'sel' : ''}" style="cursor:pointer">${cols.map(c => `<td class="${c[2]}">${(c[3] || (x => x))(c[1](o))}</td>`).join('')}</tr>`).join('') + '</tbody>';
      t.querySelectorAll('th').forEach(th => {
        const go = () => { const i = +th.dataset.i; if (i === sortCol) dir = -dir; else { sortCol = i; dir = 1; } draw(); };
        th.onclick = go; th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      });
      t.querySelectorAll('tbody tr').forEach(tr => (tr.onclick = () => select(+tr.dataset.s)));
    }
    filt.oninput = draw; modeSel.onchange = draw;
    onSelect(() => draw());
    draw();
  })();

  // ── Exhibit 12: best opener for each mode shown ──
  (function () {
    const modes = ['Underground', 'Overground', 'DLR', 'Elizabeth line'];
    let cur = 'Underground';
    const map = makeMap(document.getElementById('mapMode'), { label: 'Best opener by mode', tipExtra: i => `<br>opening here against ${cur} answers: ${f3(D.adaptive.byMode[cur].means[i])}` });
    const host = document.getElementById('modebtns');
    host.innerHTML = modes.map(m => `<button type="button" data-m="${m}" aria-pressed="${m === cur}">${m}</button>`).join('');
    host.querySelectorAll('button').forEach(b => (b.onclick = () => { cur = b.dataset.m; host.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); paint(); }));
    function paint() {
      const M = D.adaptive.byMode[cur], inMode = new Uint8Array(N);
      ALL.forEach(i => { if (D.clue[0][i] === cur) inMode[i] = 1; });
      const q = heatScale(M.means);
      const top = M.top[0].s;
      map.style(i => (i === top ? { fill: 'var(--signal)', stroke: 'var(--ink)' } : inMode[i] ? { fill: `var(--q${q(M.means[i])})`, stroke: 'var(--ink)' } : { fill: `var(--q${q(M.means[i])})`, stroke: 'var(--faint)', opacity: 0.35 }), true);
      map.radius(i => (inMode[i] ? 4 : 2.2));
      map.edgeOpacity(d => (inMode[d.a] && inMode[d.b] ? 0.9 : 0.15), true);
      map.label(M.top.slice(0, 3).map((t, k) => ({ i: t.s, text: `${k + 1}. ${NAME(t.s)} ${f3(t.mean)}`, color: k ? 'var(--ink-2)' : 'var(--signal)' })));
      document.getElementById('modedetail').innerHTML = `<div class="panel-title">${cur}</div>
        <p style="font-size:.92rem">${M.size} answers show this mode. Best fixed opener: <b>${NAME(top)}</b>, ${f3(M.top[0].mean)} guesses (worst ${M.top[0].worst}). The greedy choice once the mode is shown is ${NAME(M.greedy)}.</p>
        <table><thead><tr><th>opener</th><th class="n">mean</th><th class="n">worst</th></tr></thead><tbody>${M.top.map(t => `<tr><td>${NAME(t.s)}</td><td class="n">${f3(t.mean)}</td><td class="n">${t.worst}</td></tr>`).join('')}</tbody></table>
        <div class="legend" id="modelegend" style="margin-top:.6rem"></div>`;
      legend(document.getElementById('modelegend'), q, 'mean:');
    }
    paint();
    // Reference implementation's results, for comparison.
    document.getElementById('modeopen').innerHTML = `<thead><tr><th>mode shown</th><th class="n">answers</th><th>best opener, this page</th><th class="n">mean</th><th>best opener, reference solver</th><th class="n">mean</th></tr></thead><tbody>` +
      [['Underground', "King's Cross St. Pancras", '2.294'], ['Overground', 'Clapham Junction', '2.237'], ['DLR', 'Devons Road', '2.268'], ['Elizabeth line', 'Brentwood, Chadwell Heath, Forest Gate and seven others, tied', '2.032']]
        .map(([m, r, rm]) => { const M = D.adaptive.byMode[m]; const ties = M.top.filter(t => Math.abs(t.mean - M.top[0].mean) < 1e-9); return `<tr><td>${m}</td><td class="n">${M.size}</td><td>${ties.map(t => NAME(t.s)).join(', ')}</td><td class="n">${f3(M.top[0].mean)}</td><td>${r}</td><td class="n">${rm}</td></tr>`; }).join('') + '</tbody>';
  })();

  // ── Exhibit 13: which answers are hard ──
  (function () {
    let withClues = false;
    const map = makeMap(document.getElementById('mapDiff'), { label: 'Guesses needed for each answer', tipExtra: i => `<br>found on guess ${D.stratfordLengths[i]} map only, ${D.adaptive.lengths[i]} with panel` });
    function paint() {
      const L = withClues ? D.adaptive.lengths : D.stratfordLengths;
      const col = l => `var(--q${Math.min(7, 1 + (l - 1) * 2)})`;
      map.style(i => ({ fill: col(L[i]), stroke: `var(--q${Math.min(7, 2 + (L[i] - 1) * 2)})` }), true);
      map.radius(i => 1.8 + L[i] * 0.8);
      map.edgeOpacity(() => 0.3);
      const counts = [1, 2, 3, 4, 5].map(l => L.filter(x => x === l).length);
      document.getElementById('difflegend').innerHTML = '<span>found on guess:</span>' + counts.map((c, k) => (c ? `<span><i class="swatch" style="background:${col(k + 1)}"></i>${k + 1} (${c})</span>` : '')).join('');
    }
    toggle('diff-map', 'diff-clue', v => { withClues = v; paint(); });
    paint();
  })();

  // ── Modes and lines ──
  (function () {
    const L = D.stratfordLengths;
    const modeMask = mode => D.lines.reduce((m, l, j) => (l[2] === mode ? m | (1 << j) : m), 0);
    document.getElementById('modetable').innerHTML = `<thead><tr><th>mode served</th><th class="n">stations</th><th class="n">mean, map only</th><th class="n">need 4+</th><th class="n">mean, with panel</th><th>best opener served only by this mode</th><th class="n">its mean</th></tr></thead><tbody>` +
      ['tube', 'overground', 'dlr', 'elizabeth'].map(mode => {
        const mm = modeMask(mode);
        const st = ALL.filter(i => D.stations[i][4] & mm);
        const only = ranked.find(o => (D.stations[o.s][4] & ~mm) === 0);
        return `<tr><td>${MODE_LABEL[mode]}</td><td class="n">${st.length}</td><td class="n">${f3(d3.mean(st, i => L[i]))}</td><td class="n">${pct(st.filter(i => L[i] >= 4).length / st.length)}</td><td class="n">${f3(d3.mean(st, i => D.adaptive.lengths[i]))}</td><td>${NAME(only.s)}</td><td class="n">${f3(only.mean)}</td></tr>`;
      }).join('') + '</tbody>';
    const data = D.lines.map((l, j) => {
      const st = ALL.filter(i => D.stations[i][4] & (1 << j));
      return { j, name: l[1], n: st.length, mean: d3.mean(st, i => L[i]), cmean: d3.mean(st, i => D.adaptive.lengths[i]) };
    }).sort((a, b) => a.mean - b.mean);
    const w = 640, rowH = 22, m = { l: 150, r: 60, t: 8, b: 30 }, h = m.t + m.b + rowH * data.length;
    const g = frame('#linechart', w, h, m);
    const x = d3.scaleLinear().domain([1.8, 3.2]).range([0, w - m.l - m.r]);
    const y = d3.scaleBand().domain(data.map(d => d.name)).range([0, rowH * data.length]).padding(0.3);
    g.append('g').attr('class', 'grid').attr('transform', `translate(0,${rowH * data.length})`).call(d3.axisBottom(x).ticks(7).tickSize(-rowH * data.length).tickFormat('')).call(s => s.select('.domain').remove());
    const row = g.selectAll('g.r').data(data).join('g').attr('class', 'r').attr('transform', d => `translate(0,${y(d.name)})`);
    row.append('line').attr('x1', d => x(d.cmean)).attr('x2', d => x(d.mean)).attr('y1', y.bandwidth() / 2).attr('y2', y.bandwidth() / 2).style('stroke', 'var(--faint)').attr('stroke-width', 2);
    row.append('circle').attr('cx', d => x(d.cmean)).attr('cy', y.bandwidth() / 2).attr('r', 4).style('fill', 'var(--panel)').style('stroke', d => `var(--l${d.j})`).attr('stroke-width', 2);
    row.append('circle').attr('cx', d => x(d.mean)).attr('cy', y.bandwidth() / 2).attr('r', 5.5).style('fill', d => `var(--l${d.j})`).style('stroke', 'var(--panel)').attr('stroke-width', 2)
      .on('pointermove', (ev, d) => showTip(`<b>${d.name}</b><br>${d.n} stations<br>map only ${f3(d.mean)} · with panel ${f3(d.cmean)}`, ev)).on('pointerleave', hideTip);
    row.append('text').attr('x', -10).attr('y', y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('font-size', 11.5).attr('font-family', MONO).style('fill', 'var(--ink)').text(d => d.name);
    row.append('text').attr('x', d => x(d.mean) + 10).attr('y', y.bandwidth() / 2 + 4).attr('font-size', 10.5).attr('font-family', MONO).style('fill', 'var(--ink-2)').text(d => f2(d.mean));
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${rowH * data.length})`).call(d3.axisBottom(x).ticks(7));
    g.append('text').attr('x', 0).attr('y', rowH * data.length + 26).attr('font-size', 10).attr('font-family', MONO).style('fill', 'var(--muted)').text('filled: map only · hollow: with panel · mean guesses');
  })();

  // ── Clue tables ──
  (function () {
    const C = D.clues;
    const rows = [['Mode', 'before guess 1', C.mode], ['Fare zone', 'after 1 wrong guess', C.zone], ['On the network', 'after 2', C.role], ['One of its lines', 'after 3', C.line], ['From the end of the line', 'after 4', C.end], ['First letter', 'after 5', C.letter], ['All six together', '', C.joint]];
    document.getElementById('cluetable').innerHTML = `<thead><tr><th>clue κ</th><th>shown</th><th class="n">values</th><th class="n">I(κ;A) = H(κ), bits</th><th class="n">largest class</th><th class="n">share of log₂ n</th></tr></thead><tbody>` +
      rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="n">${c.classes}</td><td class="n">${c.H.toFixed(3)}</td><td class="n">${Math.max(...Object.values(c.counts))}</td><td class="n">${pct(c.H / log2n)}</td></tr>`).join('') + '</tbody>';
    const adH = [1, 2, 3, 4, 5].map(l => D.adaptive.lengths.filter(x => x === l).length);
    document.getElementById('cluegain').innerHTML = `<thead><tr><th>policy</th><th class="n">1</th><th class="n">2</th><th class="n">3</th><th class="n">4</th><th class="n">5</th><th class="n">mean</th><th class="n">worst</th></tr></thead><tbody>
      <tr><td>map only, opening ${NAME(best.s)} (both implementations)</td>${best.hist.slice(0, 5).map(c => `<td class="n">${c}</td>`).join('')}<td class="n">${f3(best.mean)}</td><td class="n">${best.worst}</td></tr>
      <tr><td>with panel, reference solver (<code>tubele-solver bench</code>)</td><td class="n">4</td><td class="n">302</td><td class="n">113</td><td class="n">1</td><td class="n">0</td><td class="n">2.264</td><td class="n">4</td></tr>
      <tr><td>with panel, this page's port</td>${adH.map(c => `<td class="n">${c}</td>`).join('')}<td class="n">${f3(adMean)}</td><td class="n">${adWorst}</td></tr></tbody>`;
  })();

  // ── Exhibit 15: where people start ──
  (function () {
    const opens = {
      daily: [["King's Cross St. Pancras", 2336, 6.07], ['Liverpool Street', 484, 5.32], ['Bank', 422, 4.79], ['Baker Street', 398, 5.82], ['Oxford Circus', 357, 5.18], ['Victoria', 282, 5.67], ['Tottenham Court Road', 277, 4.82], ['Paddington', 241, 5.17], ['Waterloo', 222, 4.62], ['Euston', 204, 5.96], ['Stratford', 149, 5.35], ['Whitechapel', 141, 4.70]],
      practice: [["King's Cross St. Pancras", 1422, 7.62], ['Highbury & Islington', 180, 7.94], ['Bank', 157, 7.55], ['Liverpool Street', 156, 7.86], ['Gospel Oak', 144, 10.25], ['Clapham Junction', 140, 12.33], ['Stratford', 133, 6.65], ['Paddington', 108, 8.8], ['Canary Wharf', 99, 5.22], ['Tottenham Court Road', 92, 7.6], ['Baker Street', 74, 8.91], ['Waterloo', 68, 8.4]],
    };
    let kind = 'daily';
    const map = makeMap(document.getElementById('mapHuman'), { label: 'Where players open, over opener quality', tipExtra: i => `<br>solver mean from here ${f3(OP.get(i).mean)} (${ord(rankOf.get(i))})` });
    const q = heatScale(ALL.map(i => OP.get(i).mean));
    map.style(i => ({ fill: `var(--q${q(OP.get(i).mean)})`, stroke: `var(--q${Math.min(7, q(OP.get(i).mean) + 1)})` }));
    map.edgeOpacity(() => 0.3);
    const r = d3.scaleSqrt().domain([0, 2336]).range([0, 34]);
    function paint() {
      const data = opens[kind].map(([n, c, d]) => ({ i: byName(n), c, d })).filter(x => x.i >= 0);
      const k = map.k();
      map.gOver.selectAll('circle.b').data(data, d => d.i).join(
        e => e.append('circle').attr('class', 'b').attr('r', 0),
        u => u, x => x.transition().duration(300).attr('r', 0).remove())
        .attr('cx', d => P[d.i][0]).attr('cy', d => P[d.i][1]).style('fill', 'var(--signal)').style('fill-opacity', 0.22).style('stroke', 'var(--signal)').attr('stroke-width', 1.2).attr('vector-effect', 'non-scaling-stroke')
        .on('pointermove', (ev, d) => showTip(`<b>${NAME(d.i)}</b><br>${d.c.toLocaleString('en-GB')} ${kind} opens · first reading ${d.d} stops on average<br>solver: ${ord(rankOf.get(d.i))} best opener, ${f3(OP.get(d.i).mean)} guesses; uniform answer averages ${f2(d3.mean(ALL, a => net.dist[d.i * N + a]))} stops`, ev))
        .on('pointerleave', hideTip)
        .transition().duration(reduceMotion.matches ? 0 : 600).ease(d3.easeCubicOut).attr('r', d => r(d.c) / Math.sqrt(k));
      map.label(data.slice(0, 4).map(d => ({ i: d.i, text: `${NAME(d.i)} ${d.c.toLocaleString('en-GB')}` })));
    }
    map.onZoom(() => map.gOver.selectAll('circle.b').attr('r', d => r(d.c) / Math.sqrt(map.k())));
    toggle('hum-daily', 'hum-prac', v => { kind = v ? 'practice' : 'daily'; paint(); });
    paint();
    map.fit(CENTRE);
  })();

  // ── Exhibit 16: how many guesses ──
  (function () {
    const cats = ['1', '2', '3', '4', '5', '6', 'X'];
    const series = [
      { key: 'Solver, map only', v: [...best.hist, 0], tot: N, c: 'var(--s1)' },
      { key: 'Players, daily', v: [224, 1256, 1591, 1576, 1193, 1370, 1723], tot: 8933, c: 'var(--s2)' },
      { key: 'Players, practice', v: [32, 391, 637, 666, 554, 714, 1103], tot: 4097, c: 'var(--s3)' },
      { key: 'Solver, with panel (reference)', v: [4, 302, 113, 1, 0, 0, 0], tot: 420, c: 'var(--s4)' },
    ];
    document.getElementById('hvmlegend').innerHTML = series.map(s => `<span><i class="swatch" style="background:${s.c}"></i>${s.key}</span>`).join('');
    const w = 760, h = 300, m = { l: 44, r: 10, t: 12, b: 34 };
    const g = frame('#hvm', w, h, m);
    const x0 = d3.scaleBand().domain(cats).range([0, w - m.l - m.r]).paddingInner(0.22);
    const x1 = d3.scaleBand().domain(series.map(s => s.key)).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, 0.75]).range([h - m.t - m.b, 0]);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
    const grp = g.selectAll('g.c').data(cats).join('g').attr('class', 'c').attr('transform', c => `translate(${x0(c)},0)`);
    grp.selectAll('rect').data((c, ci) => series.map(s => ({ s, c, p: s.v[ci] / s.tot, n: s.v[ci] }))).join('rect')
      .attr('x', d => x1(d.s.key)).attr('width', x1.bandwidth()).attr('y', d => y(d.p)).attr('height', d => y(0) - y(d.p)).attr('rx', 2).style('fill', d => d.s.c)
      .on('pointermove', (ev, d) => showTip(`<b>${d.s.key}</b><br>${d.c === 'X' ? 'lost' : d.c + ' guess' + (d.c === '1' ? '' : 'es')}: ${pct(d.p)} (${d.n.toLocaleString('en-GB')} games)`, ev)).on('pointerleave', hideTip);
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x0));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5, '.0%'));
    document.getElementById('hvmtable').innerHTML = `<thead><tr><th></th>${cats.map(c => `<th class="n">${c}</th>`).join('')}<th class="n">games</th></tr></thead><tbody>` +
      series.map(s => `<tr><td>${s.key}</td>${s.v.map(v => `<td class="n">${pct(v / s.tot)}</td>`).join('')}<td class="n">${s.tot.toLocaleString('en-GB')}</td></tr>`).join('') + '</tbody>';
  })();

  // ── Exhibit 17: the first reading ──
  (function () {
    const human = [226, 465, 708, 1105, 1275, 1169, 818, 841, 662, 487, 417, 300, 324, 213, 191, 103, 109, 54, 19, 17, 14];
    const hTot = d3.sum(human) + 33;
    const series = [
      { key: 'Players, daily, all openers', v: human.map(c => c / hTot), c: 'var(--s2)' },
      { key: "King's Cross against a uniform answer", v: D.kxDist.slice(0, 21).map(c => c / N), c: 'var(--s1)' },
    ];
    document.getElementById('firstlegend').innerHTML = series.map(s => `<span><i class="swatch" style="background:${s.c}"></i>${s.key}</span>`).join('') + '<span>21 stops and over omitted</span>';
    const w = 760, h = 240, m = { l: 44, r: 10, t: 10, b: 34 };
    const g = frame('#firstdist', w, h, m);
    const x = d3.scaleLinear().domain([0, 20]).range([0, w - m.l - m.r]);
    const y = d3.scaleLinear().domain([0, 0.16]).range([h - m.t - m.b, 0]);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
    series.forEach(s => {
      g.append('path').datum(s.v).attr('fill', 'none').style('stroke', s.c).attr('stroke-width', 2).attr('d', d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX));
      g.selectAll(null).data(s.v).join('circle').attr('cx', (d, i) => x(i)).attr('cy', d => y(d)).attr('r', 4).style('fill', s.c).style('stroke', 'var(--panel)').attr('stroke-width', 2)
        .on('pointermove', (ev, d) => showTip(`<b>${s.key}</b><br>${s.v.indexOf(d)} stops: ${pct(d)}`, ev)).on('pointerleave', hideTip);
    });
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(10));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4, '.0%'));
    g.append('text').attr('x', (w - m.l - m.r) / 2).attr('y', h - m.t - 4).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-family', MONO).style('fill', 'var(--muted)').text('stops shown after the first guess');
  })();

  // ── Proposition 4 table: information per guess ──
  (function () {
    const rows = [['Players, daily', D.human.daily], ['Players, practice', D.human.practice], ['Solver, map only', D.human.solverMap], ['Solver, with panel (port)', D.human.solverClues]];
    function predicted(b) {
      let surv = 1; const out = [];
      for (let t = 1; t <= 6; t++) { const h = Math.min(1, Math.pow(2, b * (t - 1)) / N); out.push(surv * h); surv *= 1 - h; }
      out.push(surv); return out;
    }
    document.getElementById('bitstable').innerHTML = `<thead><tr><th>population</th><th class="n">b̂ (bits/guess)</th><th class="n">log₂n / E[T | win]</th><th>observed 1–6, X</th><th>fitted 1–6, X</th></tr></thead><tbody>` +
      rows.map(([label, h]) => {
        const tot = d3.sum(h.counts) + h.losses, wins = d3.sum(h.counts);
        const mean = d3.sum(h.counts.map((c, i) => c * (i + 1))) / wins;
        const obs = [...h.counts, h.losses].map(c => (c / tot * 100).toFixed(0)).join(' ');
        const fit = predicted(h.fit.b).map(p => (p * 100).toFixed(0)).join(' ');
        return `<tr><td>${label}</td><td class="n">${h.fit.b.toFixed(2)}</td><td class="n">${(log2n / mean).toFixed(2)}</td><td class="mono">${obs}</td><td class="mono">${fit}</td></tr>`;
      }).join('') + '</tbody>';
  })();

  // ── §8 exhibits ──
  (function () {
    const SD = D.stats.daily, SP = D.stats.practice, B = D.behaviour;
    const SER = { map: ['Solver, map only', 'var(--s1)'], daily: ['Players, daily', 'var(--s2)'], prac: ['Players, practice', 'var(--s3)'], clue: ['Solver, with panel', 'var(--s4)'] };
    const legendHtml = keys => keys.map(k => `<span><i class="swatch" style="background:${SER[k][1]}"></i>${SER[k][0]}</span>`).join('');
    const firstGuesses = s => s.stops_away_by_guess[0].guesses;
    const correctAt = (s, t) => s.stops_bands_by_guess.find(b => b.guess_index === t && b.band === 'Correct').guesses;
    const madeAt = (s, t) => s.stops_away_by_guess.find(g => g.guess_index === t).guesses;
    const fmtN = x => x.toLocaleString('en-GB');
    const txt = (sel, x, y, s, o = {}) => sel.append('text').attr('x', x).attr('y', y).attr('font-size', o.size || 10.5).attr('font-family', MONO).attr('text-anchor', o.anchor || 'start').style('fill', o.fill || 'var(--muted)').text(s);

    // Exhibit 18: concentration of openers.
    (function () {
      let kind = 'daily';
      function draw() {
        const S = kind === 'daily' ? SD : SP, tot = firstGuesses(S);
        const rows = S.opening_stations.map(o => ({ i: byName(o.station), n: o.opens, d: o.avg_stops })).filter(r => r.i >= 0);
        const w = 900, rowH = 21, m = { l: 190, r: 20, t: 26, b: 30 }, h = m.t + m.b + rowH * rows.length;
        const g = frame('#concchart', w, h, m);
        const pw = (w - m.l - m.r) * 0.58, gap = 40, qw = (w - m.l - m.r) - pw - gap;
        const y = d3.scaleBand().domain(rows.map(r => r.i)).range([0, rowH * rows.length]).padding(0.25);
        const x = d3.scaleLinear().domain([0, d3.max(rows, r => r.n / tot) * 1.08]).range([0, pw]);
        const x2 = d3.scaleLinear().domain([2.6, 3.2]).range([pw + gap, pw + gap + qw]);
        txt(g, 0, -10, 'share of first guesses'); txt(g, pw + gap, -10, 'solver mean guesses from this opener');
        g.append('g').attr('class', 'grid').attr('transform', `translate(0,${rowH * rows.length})`).call(d3.axisBottom(x).ticks(5).tickSize(-rowH * rows.length).tickFormat('')).call(s => s.select('.domain').remove());
        g.selectAll('rect').data(rows).join('rect').attr('x', 0).attr('y', r => y(r.i)).attr('height', y.bandwidth()).attr('rx', 2).style('fill', kind === 'daily' ? 'var(--s2)' : 'var(--s3)')
          .attr('width', 0).on('pointermove', (ev, r) => showTip(`<b>${NAME(r.i)}</b><br>${fmtN(r.n)} opens, ${pct(r.n / tot)} of first guesses<br>${(r.n / tot * N).toFixed(0)}× a uniform share<br>first reading ${r.d} stops on average`, ev)).on('pointerleave', hideTip)
          .transition().duration(reduceMotion.matches ? 0 : 500).attr('width', r => x(r.n / tot));
        g.selectAll('text.lab').data(rows).join('text').attr('class', 'lab').attr('x', -8).attr('y', r => y(r.i) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('font-size', 11).attr('font-family', MONO).style('fill', 'var(--ink)').text(r => NAME(r.i));
        g.selectAll('text.val').data(rows).join('text').attr('class', 'val').attr('x', r => x(r.n / tot) + 5).attr('y', r => y(r.i) + y.bandwidth() / 2 + 4).attr('font-size', 10).attr('font-family', MONO).style('fill', 'var(--ink-2)').text(r => pct(r.n / tot));
        g.append('line').attr('x1', x2(best.mean)).attr('x2', x2(best.mean)).attr('y1', 0).attr('y2', rowH * rows.length).style('stroke', 'var(--faint)').attr('stroke-dasharray', '3 3');
        g.append('line').attr('x1', x2(d3.mean(D.openers, o => o.mean))).attr('x2', x2(d3.mean(D.openers, o => o.mean))).attr('y1', 0).attr('y2', rowH * rows.length).style('stroke', 'var(--muted)').attr('stroke-dasharray', '1 3');
        txt(g, x2(best.mean), rowH * rows.length + 24, 'best', { anchor: 'middle' }); txt(g, x2(d3.mean(D.openers, o => o.mean)), rowH * rows.length + 24, 'random', { anchor: 'middle' });
        g.selectAll('circle').data(rows).join('circle').attr('cx', r => x2(OP.get(r.i).mean)).attr('cy', r => y(r.i) + y.bandwidth() / 2).attr('r', 5).style('fill', 'var(--ink)').style('stroke', 'var(--panel)').attr('stroke-width', 2)
          .on('pointermove', (ev, r) => showTip(`<b>${NAME(r.i)}</b><br>solver mean ${f3(OP.get(r.i).mean)}, ${ord(rankOf.get(r.i))} of ${N}`, ev)).on('pointerleave', hideTip).on('click', (ev, r) => select(r.i));
        g.append('g').attr('class', 'axis').attr('transform', `translate(${0},${rowH * rows.length})`).call(d3.axisBottom(x).ticks(5, '.0%'));
        g.append('g').attr('class', 'axis').attr('transform', `translate(0,${rowH * rows.length})`).call(d3.axisBottom(x2).ticks(4));
        document.getElementById('conctable').innerHTML = `<thead><tr><th>opener</th><th class="n">opens</th><th class="n">share</th><th class="n">first reading</th><th class="n">solver mean</th><th class="n">solver rank</th></tr></thead><tbody>` +
          rows.map(r => `<tr><td>${NAME(r.i)}</td><td class="n">${fmtN(r.n)}</td><td class="n">${pct(r.n / tot)}</td><td class="n">${r.d}</td><td class="n">${f3(OP.get(r.i).mean)}</td><td class="n">${rankOf.get(r.i)}</td></tr>`).join('') + '</tbody>';
      }
      toggle('conc-daily', 'conc-prac', v => { kind = v ? 'practice' : 'daily'; draw(); });
      draw();
      const cr = (S, k) => d3.sum(S.opening_stations.slice(0, k), o => o.opens) / firstGuesses(S);
      const kxD = SD.opening_stations[0].opens / firstGuesses(SD), kxP = SP.opening_stations[0].opens / firstGuesses(SP);
      document.getElementById('b1-text').innerHTML = `Of ${fmtN(firstGuesses(SD))} daily first guesses, King's Cross St. Pancras accounts for ${fmtN(SD.opening_stations[0].opens)}, or ${pct(kxD)}: ${(kxD * N).toFixed(0)} times the share a uniform choice would give it. The five most common openers take ${pct(cr(SD, 5))} of first guesses and the fifteen listed take ${pct(cr(SD, 15))}, where a uniform choice over 420 stations would give fifteen stations 3.6%. Practice is less concentrated but still dominated by the same station (${pct(kxP)}; top fifteen ${pct(cr(SP, 15))}), and its list adds two Overground stations the daily list lacks, Gospel Oak and Clapham Junction, the second of which is the solver's best opener once the panel shows <em>Overground</em>.`;
    })();

    // Exhibit 19: distance by guess index.
    (function () {
      const series = [
        { k: 'daily', v: SD.stops_away_by_guess.map(g => ({ t: g.guess_index, y: g.avg_stops, n: g.guesses })) },
        { k: 'prac', v: SP.stops_away_by_guess.map(g => ({ t: g.guess_index, y: g.avg_stops, n: g.guesses })) },
        { k: 'map', v: B.solverMap.map(g => ({ t: g.t, y: g.mean, n: g.n })) },
        { k: 'clue', v: B.solverClues.map(g => ({ t: g.t, y: g.mean, n: g.n })) },
      ];
      document.getElementById('dglegend').innerHTML = legendHtml(['map', 'daily', 'prac', 'clue']);
      const w = 760, h = 280, m = { l: 44, r: 16, t: 12, b: 36 };
      const g = frame('#dgchart', w, h, m);
      const x = d3.scaleLinear().domain([1, 6]).range([0, w - m.l - m.r]);
      const y = d3.scaleLinear().domain([0, 10]).range([h - m.t - m.b, 0]);
      g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
      series.forEach(s => {
        g.append('path').datum(s.v).attr('fill', 'none').style('stroke', SER[s.k][1]).attr('stroke-width', 2).attr('d', d3.line().x(d => x(d.t)).y(d => y(d.y)));
        g.selectAll(null).data(s.v).join('circle').attr('cx', d => x(d.t)).attr('cy', d => y(d.y)).attr('r', 4.5).style('fill', SER[s.k][1]).style('stroke', 'var(--panel)').attr('stroke-width', 2)
          .on('pointermove', (ev, d) => showTip(`<b>${SER[s.k][0]}</b><br>guess ${d.t}: ${d.y.toFixed(2)} stops on average<br>${fmtN(d.n)} guesses`, ev)).on('pointerleave', hideTip);
      });
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => `guess ${d}`));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5));
      txt(g, -38, -2, 'stops');
    })();

    // Exhibit 20: hazard of solving.
    (function () {
      const model = (b, t) => Math.min(1, Math.pow(2, b * (t - 1)) / N);
      const human = (S, k, fit) => ({ k, fit, v: [1, 2, 3, 4, 5, 6].map(t => { const c = correctAt(S, t), n = madeAt(S, t); return { t, y: c / n, ci: wilson(c, n), c, n }; }) });
      const series = [human(SD, 'daily', D.human.daily.fit.b), human(SP, 'prac', D.human.practice.fit.b),
        { k: 'map', v: B.solverMap.map(g => ({ t: g.t, y: g.band[0] / g.n, ci: wilson(g.band[0], g.n), c: g.band[0], n: g.n })) },
        { k: 'clue', v: B.solverClues.map(g => ({ t: g.t, y: g.band[0] / g.n, ci: wilson(g.band[0], g.n), c: g.band[0], n: g.n })) }];
      document.getElementById('hzlegend').innerHTML = legendHtml(['map', 'daily', 'prac', 'clue']) + '<span>dashed: fitted constant-information model</span>';
      const w = 760, h = 280, m = { l: 44, r: 16, t: 12, b: 36 };
      const g = frame('#hzchart', w, h, m);
      const x = d3.scaleLinear().domain([0.8, 6.2]).range([0, w - m.l - m.r]);
      const y = d3.scaleLinear().domain([0, 1]).range([h - m.t - m.b, 0]);
      g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
      series.forEach(s => {
        if (s.fit) g.append('path').datum([1, 2, 3, 4, 5, 6]).attr('fill', 'none').style('stroke', SER[s.k][1]).attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4').attr('d', d3.line().x(t => x(t)).y(t => y(model(s.fit, t))));
        g.append('path').datum(s.v).attr('fill', 'none').style('stroke', SER[s.k][1]).attr('stroke-width', 2).attr('d', d3.line().x(d => x(d.t)).y(d => y(d.y)));
        g.selectAll(null).data(s.v).join('line').attr('x1', d => x(d.t)).attr('x2', d => x(d.t)).attr('y1', d => y(d.ci[0])).attr('y2', d => y(d.ci[1])).style('stroke', SER[s.k][1]).attr('stroke-width', 2);
        g.selectAll(null).data(s.v).join('circle').attr('cx', d => x(d.t)).attr('cy', d => y(d.y)).attr('r', 4.5).style('fill', SER[s.k][1]).style('stroke', 'var(--panel)').attr('stroke-width', 2)
          .on('pointermove', (ev, d) => showTip(`<b>${SER[s.k][0]}</b><br>guess ${d.t}: ${pct(d.y)} solve (${fmtN(d.c)} of ${fmtN(d.n)})<br>95% interval ${pct(d.ci[0])}–${pct(d.ci[1])}${s.fit ? `<br>model: ${pct(model(s.fit, d.t))}` : ''}`, ev)).on('pointerleave', hideTip);
      });
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => `guess ${d}`));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5, '.0%'));
      const hd = series[0].v, hp = series[1].v, sm = series[2].v;
      document.getElementById('b2-text').innerHTML = `The hazard makes the same point more sharply. A player who extracted a constant amount of information per guess would see the hazard rise geometrically, as the dashed curves do. Daily players' hazard rises from ${pct(hd[0].y)} to ${pct(hd[3].y)} by the fourth guess and then stalls: ${pct(hd[4].y)} on the fifth, a rise of ${(100 * (hd[4].y - hd[3].y)).toFixed(1)} points, before jumping to ${pct(hd[5].y)} on the sixth (§8.3). Practice players stall earlier and lower (${pct(hp[3].y)}, ${pct(hp[4].y)}). The plateau means that, for the players still in the game after three guesses, a further guess adds almost no information, which is what one would see if those players were guessing near their last reading rather than combining all of them. The fitted model misses the observed curves in a consistent direction, under-predicting solves on guesses 2 to 4 and over-predicting them on guess 6, so no constant rate describes human play: people extract most per guess early in a game and least late, while the solver's hazard rises steeply because its later guesses are made against a version space it has kept exactly. The solver's hazard is ${pct(sm[1].y)} on its second guess and ${pct(sm[2].y)} on its third.`;
    })();

    // Exhibit 21: distance bands.
    (function () {
      let kind = 'daily';
      const BANDS = ['Correct', '1-2 stops', '3-5 stops', '6-10 stops', '11+ stops'];
      const COL = ['var(--s3)', 'var(--q6)', 'var(--q4)', 'var(--q3)', 'var(--q2)'];
      document.getElementById('bandslegend').innerHTML = BANDS.map((b, i) => `<span><i class="swatch" style="background:${COL[i]}"></i>${b}</span>`).join('');
      function rowsFor(k) {
        if (k === 'solver') return B.solverMap.map(g => ({ t: g.t, n: g.n, v: g.band }));
        const S = k === 'daily' ? SD : SP;
        return [1, 2, 3, 4, 5, 6].map(t => ({ t, n: madeAt(S, t), v: BANDS.map(b => S.stops_bands_by_guess.find(x => x.guess_index === t && x.band === b).guesses) }));
      }
      function draw() {
        const rows = rowsFor(kind);
        const w = 760, h = 250, m = { l: 44, r: 10, t: 10, b: 34 };
        const g = frame('#bandschart', w, h, m);
        const x = d3.scaleBand().domain([1, 2, 3, 4, 5, 6]).range([0, w - m.l - m.r]).padding(0.25);
        const y = d3.scaleLinear().domain([0, 1]).range([h - m.t - m.b, 0]);
        rows.forEach(r => {
          let acc = 0;
          r.v.forEach((c, i) => {
            const p = c / r.n;
            g.append('rect').attr('x', x(r.t)).attr('width', x.bandwidth()).attr('y', y(acc + p) + 1).attr('height', Math.max(0, y(acc) - y(acc + p) - 2)).attr('rx', 2).style('fill', COL[i])
              .on('pointermove', ev => showTip(`<b>guess ${r.t}: ${BANDS[i]}</b><br>${pct(p)} (${fmtN(c)} of ${fmtN(r.n)} guesses)`, ev)).on('pointerleave', hideTip);
            acc += p;
          });
        });
        g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).tickFormat(d => `guess ${d}`));
        g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5, '.0%'));
      }
      const btns = ['bands-daily', 'bands-prac', 'bands-solver'].map(id => document.getElementById(id));
      btns.forEach((b, i) => (b.onclick = () => { kind = ['daily', 'practice', 'solver'][i]; btns.forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); }));
      draw();
      const far = S => { let f = 0, n = 0; for (let t = 3; t <= 6; t++) { f += S.stops_bands_by_guess.find(x => x.guess_index === t && x.band === '11+ stops').guesses; n += madeAt(S, t); } return f / n; };
      const sf = d3.sum(B.solverMap.filter(g => g.t >= 3), g => g.band[4]) / d3.sum(B.solverMap.filter(g => g.t >= 3), g => g.n);
      document.getElementById('b2b-text').innerHTML = `From the third guess on, ${pct(far(SD))} of daily guesses and ${pct(far(SP))} of practice guesses are 11 or more stops from the answer; for the solver the figure is ${pct(sf)}. A guess that far away after two readings is almost never consistent with them, because consistent candidates cluster within the intersection of two metric spheres (Lemma 2). The data cannot show which guesses were inconsistent, since no individual game is recorded, but the share of late guesses landing in the far band puts a floor under how often earlier feedback was ignored or misread.`;
    })();

    // Exhibit 22: forest plot.
    (function () {
      const nv = SD.new_vs_returning, ret = nv.find(c => c.cohort === 'Returning player'), fst = nv.find(c => c.cohort === 'First ever game');
      const T = t => SD.win_rate_by_tier.find(x => x.tier === t);
      const shareW = SD.share_rate.find(s => s.outcome === 'Won'), shareL = SD.share_rate.find(s => s.outcome === 'Lost');
      const kw = c => Math.round(c.win_pct / 100 * c.games);
      const rows = [
        { g: 'B5 learning', l: 'returning players', k: kw(ret), n: ret.games },
        { g: '', l: 'first ever game', k: kw(fst), n: fst.games },
        { g: 'B4 familiarity', l: 'core tier', k: T('core').wins, n: T('core').played },
        { g: '', l: 'standard tier', k: T('standard').wins, n: T('standard').played },
        { g: '', l: 'deep tier', k: T('deep').wins, n: T('deep').played },
        { g: 'B6 effort', l: 'daily', k: SD.kpi[0].wins, n: SD.kpi[0].finished },
        { g: '', l: 'practice', k: SP.kpi[0].wins, n: SP.kpi[0].finished },
        { g: 'B7 sharing', l: 'after a win', k: shareW.shared, n: shareW.finished },
        { g: '', l: 'after a loss', k: shareL.shared, n: shareL.finished },
      ].map(r => ({ ...r, p: r.k / r.n, ci: wilson(r.k, r.n) }));
      const w = 820, rowH = 26, m = { l: 360, r: 70, t: 10, b: 30 }, h = m.t + m.b + rowH * rows.length;
      const g = frame('#forest', w, h, m);
      const x = d3.scaleLinear().domain([0, 1]).range([0, w - m.l - m.r]);
      g.append('g').attr('class', 'grid').attr('transform', `translate(0,${rowH * rows.length})`).call(d3.axisBottom(x).ticks(10).tickSize(-rowH * rows.length).tickFormat('')).call(s => s.select('.domain').remove());
      g.append('line').attr('x1', x(SD.kpi[0].win_pct / 100)).attr('x2', x(SD.kpi[0].win_pct / 100)).attr('y1', 0).attr('y2', rowH * rows.length).style('stroke', 'var(--muted)').attr('stroke-dasharray', '4 3');
      rows.forEach((r, i) => {
        const cy = i * rowH + rowH / 2;
        if (r.g) txt(g, -m.l + 4, cy + 4, r.g, { fill: 'var(--ink)', size: 11 });
        txt(g, -10, cy + 4, `${r.l} (n = ${fmtN(r.n)})`, { anchor: 'end', size: 10.5 });
        g.append('line').attr('x1', x(r.ci[0])).attr('x2', x(r.ci[1])).attr('y1', cy).attr('y2', cy).style('stroke', 'var(--ink-2)').attr('stroke-width', 2);
        g.append('rect').attr('x', x(r.p) - 5).attr('y', cy - 5).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', 'var(--accent)')
          .on('pointermove', ev => showTip(`<b>${r.l}</b><br>${pct(r.p)} (${fmtN(r.k)} of ${fmtN(r.n)})<br>95% interval ${pct(r.ci[0])}–${pct(r.ci[1])}`, ev)).on('pointerleave', hideTip);
        txt(g, w - m.l - m.r + 8, cy + 4, pct(r.p), { fill: 'var(--ink)' });
      });
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${rowH * rows.length})`).call(d3.axisBottom(x).ticks(10, '.0%'));
      const z1 = ztest(rows[0].k, rows[0].n, rows[1].k, rows[1].n);
      document.getElementById('b5-text').innerHTML = `Returning players win ${pct(rows[0].p)} of daily games against ${pct(rows[1].p)} for a first ever game, a difference of ${(100 * (rows[0].p - rows[1].p)).toFixed(1)} points (${zfmt(z1)}), yet they use almost the same number of guesses when they win (${ret.avg_guesses} against ${fst.avg_guesses}). Experience therefore shows up as fewer losses, not as faster wins: returning players are better at finishing within six guesses but not at extracting more per guess. The comparison cannot separate learning from selection, since players who did well on their first day are more likely to return, so B5 is supported only in its weak form.`;
      const zs = ztest(shareW.shared, shareW.finished, shareL.shared, shareL.finished);
      const reach6 = madeAt(SD, 6) / SD.kpi[0].started;
      const methods = SD.share_method, mt = d3.sum(methods, m => m.uses);
      document.getElementById('b7-text').innerHTML = `Daily players share ${pct(shareW.shared / shareW.finished)} of wins and ${pct(shareL.shared / shareL.finished)} of losses (${zfmt(zs)}), a ratio of ${(shareW.shared / shareW.finished / (shareL.shared / shareL.finished)).toFixed(2)}; in practice the rates are ${pct(SP.share_rate.find(s => s.outcome === 'Won').share_pct / 100)} and ${pct(SP.share_rate.find(s => s.outcome === 'Lost').share_pct / 100)}. B7 holds, but losses are still shared often: one loss in seven is posted. The system share sheet carries ${pct(methods[0].uses / mt)} of shares. The loss tail is long. ${pct(reach6)} of daily games started reach a sixth guess, and ${pct(SD.guess_distribution.find(x => x.guesses === 6).pct / 100)} of finished games are won on it; the solver never needs a fifth guess with the panel and needed one for a single answer on the map alone.`;
    })();

    // Exhibit 23: return.
    (function () {
      const ret = SD.day_n_return.filter(d => d.day_n >= 1);
      let w = 420, h = 220, m = { l: 40, r: 10, t: 10, b: 30 };
      let g = frame('#returnchart', w, h, m);
      let x = d3.scaleLinear().domain([1, d3.max(ret, d => d.day_n)]).range([0, w - m.l - m.r]);
      let y = d3.scaleLinear().domain([0, 0.14]).range([h - m.t - m.b, 0]);
      g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
      g.append('path').datum(ret).attr('fill', 'none').style('stroke', 'var(--s2)').attr('stroke-width', 2).attr('d', d3.line().x(d => x(d.day_n)).y(d => y(d.pct_of_cohort / 100)));
      g.selectAll(null).data(ret).join('circle').attr('cx', d => x(d.day_n)).attr('cy', d => y(d.pct_of_cohort / 100)).attr('r', 3).style('fill', 'var(--s2)')
        .on('pointermove', (ev, d) => showTip(`day ${d.day_n}: ${d.pct_of_cohort}% of the cohort played`, ev)).on('pointerleave', hideTip);
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(6));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4, '.0%'));
      txt(g, (w - m.l - m.r) / 2, h - m.t - 2, 'days after first play', { anchor: 'middle' });
      const rp = SD.returning_players;
      g = frame('#dayschart', w, h, m);
      x = d3.scaleLinear().domain([1, d3.max(rp, d => d.days_played) + 1]).range([0, w - m.l - m.r]);
      y = d3.scaleLog().domain([1, d3.max(rp, d => d.devices)]).range([h - m.t - m.b, 0]);
      g.selectAll('rect').data(rp).join('rect').attr('x', d => x(d.days_played)).attr('width', Math.max(1.5, x(2) - x(1) - 1)).attr('y', d => y(d.devices)).attr('height', d => y(1) - y(d.devices) + 0.5).style('fill', 'var(--s2)')
        .on('pointermove', (ev, d) => showTip(`${d.devices} device${d.devices === 1 ? '' : 's'} played on ${d.days_played} day${d.days_played === 1 ? '' : 's'}`, ev)).on('pointerleave', hideTip);
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(1)})`).call(d3.axisBottom(x).ticks(6));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4, '~s'));
      txt(g, (w - m.l - m.r) / 2, h - m.t - 2, 'days played', { anchor: 'middle' });
      const devs = d3.sum(rp, d => d.devices), once = rp.find(d => d.days_played === 1).devices;
      document.getElementById('b5b-text').innerHTML = `Retention is low and its tail is long. ${pct(ret[0].pct_of_cohort / 100)} of a day's new players return the next day, falling to about 4% a month later; ${pct(once / devs)} of devices have played on one day only, while a few have played on more than eighty. The players who return are a small, committed minority, which is consistent with the selection reading of B5: the returning cohort is not a random sample of first-day players.`;
    })();

    // Exhibit 24: the day, and duration.
    (function () {
      const tod = S => { const tot = d3.sum(S.time_of_day, d => d.finished); return S.time_of_day.map(d => ({ h: d.hour, p: d.finished / tot, n: d.finished })); };
      const series = [{ k: 'daily', v: tod(SD) }, { k: 'prac', v: tod(SP) }];
      const size = 300, R = 120, r0 = 30;
      const svg = d3.select('#clockchart').attr('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`).style('width', '100%').style('height', 'auto');
      svg.selectAll('*').remove();
      const rad = d3.scaleLinear().domain([0, 0.1]).range([r0, R]);
      [0.025, 0.05, 0.075, 0.1].forEach(t => { svg.append('circle').attr('r', rad(t)).style('fill', 'none').style('stroke', 'var(--rule)'); svg.append('text').attr('x', Math.sin(0.55) * rad(t) + 2).attr('y', -Math.cos(0.55) * rad(t) - 2).attr('font-size', 8).attr('font-family', MONO).style('fill', 'var(--muted)').text(pct(t)); });
      [0, 6, 12, 18].forEach(hh => { const a = hh / 24 * 2 * Math.PI; svg.append('text').attr('x', Math.sin(a) * (R + 14)).attr('y', -Math.cos(a) * (R + 14) + 3).attr('text-anchor', 'middle').attr('font-size', 9).attr('font-family', MONO).style('fill', 'var(--muted)').text(`${String(hh).padStart(2, '0')}:00`); });
      series.forEach(s => {
        const pts = [...s.v, s.v[0]];
        svg.append('path').datum(pts).attr('d', d3.lineRadial().angle(d => (d.h + 0.5) / 24 * 2 * Math.PI).radius(d => rad(d.p)).curve(d3.curveCardinalClosed)).style('fill', SER[s.k][1]).style('fill-opacity', 0.15).style('stroke', SER[s.k][1]).attr('stroke-width', 2);
        svg.selectAll(null).data(s.v).join('circle').attr('cx', d => Math.sin((d.h + 0.5) / 24 * 2 * Math.PI) * rad(d.p)).attr('cy', d => -Math.cos((d.h + 0.5) / 24 * 2 * Math.PI) * rad(d.p)).attr('r', 3).style('fill', SER[s.k][1])
          .on('pointermove', (ev, d) => showTip(`<b>${SER[s.k][0]}</b><br>${String(d.h).padStart(2, '0')}:00–${String(d.h).padStart(2, '0')}:59: ${pct(d.p)} (${fmtN(d.n)} games)`, ev)).on('pointerleave', hideTip);
      });
      d3.select('#ex-clock .fig').selectAll('.legend').data([0]).join('div').attr('class', 'legend').lower().html(legendHtml(['daily', 'prac']));
      const bands = SD.duration_distribution.map(d => d.band);
      const dur = S => { const t = d3.sum(S.duration_distribution, d => d.games); return S.duration_distribution.map(d => d.games / t); };
      const dd = dur(SD), dp = dur(SP);
      const w = 420, h = 260, m = { l: 40, r: 10, t: 24, b: 44 };
      const g = frame('#durchart', w, h, m);
      const x0 = d3.scaleBand().domain(bands).range([0, w - m.l - m.r]).padding(0.2);
      const x1 = d3.scaleBand().domain(['daily', 'prac']).range([0, x0.bandwidth()]).padding(0.08);
      const y = d3.scaleLinear().domain([0, 0.35]).range([h - m.t - m.b, 0]);
      g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat('')).call(s => s.select('.domain').remove());
      bands.forEach((b, i) => [['daily', dd[i]], ['prac', dp[i]]].forEach(([k, p]) => g.append('rect').attr('x', x0(b) + x1(k)).attr('width', x1.bandwidth()).attr('y', y(p)).attr('height', y(0) - y(p)).attr('rx', 2).style('fill', SER[k][1])
        .on('pointermove', ev => showTip(`<b>${SER[k][0]}</b><br>${b}: ${pct(p)}`, ev)).on('pointerleave', hideTip)));
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x0)).selectAll('text').attr('transform', 'rotate(-20)').attr('text-anchor', 'end');
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4, '.0%'));
      txt(g, 0, -10, 'share of finished games by duration');
      const peak = series[0].v.reduce((a, b) => (b.p > a.p ? b : a));
      const morning = d3.sum(series[0].v.filter(d => d.h >= 7 && d.h <= 9), d => d.p);
      const ppeak = series[1].v.reduce((a, b) => (b.p > a.p ? b : a));
      const zdp = ztest(SD.kpi[0].wins, SD.kpi[0].finished, SP.kpi[0].wins, SP.kpi[0].finished);
      document.getElementById('b6-text').innerHTML = `Daily play peaks at ${String(peak.h).padStart(2, '0')}:00 London time, and the three hours from 07:00 to 09:59 hold ${pct(morning)} of daily games, the shape of a morning commute; a second spike at midnight (${pct(series[0].v[0].p)}) is players starting the new puzzle as it is released. Practice play has no morning peak and is spread through the afternoon and evening, peaking at ${String(ppeak.h).padStart(2, '0')}:00. B6's first half holds. Practice games are also quicker, ${SP.kpi[0].avg_seconds} seconds on average against ${SD.kpi[0].avg_seconds} for daily games, with ${pct(dp[0] + dp[1])} finished within a minute against ${pct(dd[0] + dd[1])}, and are won less often (${pct(SP.kpi[0].wins / SP.kpi[0].finished)} against ${pct(SD.kpi[0].wins / SD.kpi[0].finished)}, ${zfmt(zdp)}). Less time per game is consistent with less care, but practice answers are also uniformly drawn and therefore further from the centre (§8.4), so the lower win rate has two causes the data cannot separate.`;
    })();

    // Zone difficulty table.
    document.getElementById('zonetable').innerHTML = `<thead><tr><th>answers in</th><th class="n">stations</th><th class="n">solver, map only</th><th class="n">solver, with panel</th></tr></thead><tbody>` +
      B.zoneDifficulty.map(z => `<tr><td>${z.k}</td><td class="n">${z.n}</td><td class="n">${f3(z.map)}</td><td class="n">${f3(z.clues)}</td></tr>`).join('') + '</tbody>';
  })();

  // Redraw canvas figures when the theme changes.
  const redraw = () => (window.__redraw || []).forEach(f => f());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
