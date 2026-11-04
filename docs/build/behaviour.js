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
      'b.kxu': f2(D.behaviour.kxUniformMean), 'b.kxgap': f2(D.behaviour.kxUniformMean - 6.07),
      'b.abd': pct(ab(SD)), 'b.abp': pct(ab(SP)),
    };
  }
