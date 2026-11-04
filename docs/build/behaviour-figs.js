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
      document.getElementById('b1-text').innerHTML = `Of ${fmtN(firstGuesses(SD))} daily first guesses, King's Cross St. Pancras accounts for ${fmtN(SD.opening_stations[0].opens)}, or ${pct(kxD)}: ${(kxD * N).toFixed(0)} times the share a uniform choice would give it. The five most common openers take ${pct(cr(SD, 5))} of first guesses and the fifteen listed take ${pct(cr(SD, 15))}, where a uniform choice over 420 stations would give fifteen stations 3.6%. Practice is less concentrated but still dominated by the same station (${pct(kxP)}; top fifteen ${pct(cr(SP, 15))}), and its list admits Overground stations that the daily list does not: Highbury &amp; Islington, Gospel Oak and Clapham Junction, the last of which is the solver's best opener once the panel shows <em>Overground</em>.`;
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
      document.getElementById('b2-text').innerHTML = `The hazard makes the same point more sharply. A player who extracted a constant amount of information per guess would see the hazard rise geometrically, as the dashed curves do. Daily players' hazard rises from ${pct(hd[0].y)} to ${pct(hd[3].y)} by the fourth guess and then stalls: ${pct(hd[4].y)} on the fifth, a rise of ${(100 * (hd[4].y - hd[3].y)).toFixed(1)} points, before jumping to ${pct(hd[5].y)} on the sixth (§8.3). Practice players stall earlier and lower (${pct(hp[3].y)}, ${pct(hp[4].y)}). The plateau means that, for the players still in the game after three guesses, a further guess adds almost no information, which is what one would see if those players were guessing near their last reading rather than combining all of them. The solver's hazard is ${pct(sm[1].y)} on its second guess and ${pct(sm[2].y)} on its third.`;
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
        { g: 'B5 learning: win rate', l: 'returning players', k: kw(ret), n: ret.games },
        { g: '', l: 'first ever game', k: kw(fst), n: fst.games },
        { g: 'B4 familiarity: win rate', l: 'core tier', k: T('core').wins, n: T('core').played },
        { g: '', l: 'standard tier', k: T('standard').wins, n: T('standard').played },
        { g: '', l: 'deep tier', k: T('deep').wins, n: T('deep').played },
        { g: 'B6 effort: win rate', l: 'daily', k: SD.kpi[0].wins, n: SD.kpi[0].finished },
        { g: '', l: 'practice', k: SP.kpi[0].wins, n: SP.kpi[0].finished },
        { g: 'B7 sharing: share rate', l: 'after a win', k: shareW.shared, n: shareW.finished },
        { g: '', l: 'after a loss', k: shareL.shared, n: shareL.finished },
      ].map(r => ({ ...r, p: r.k / r.n, ci: wilson(r.k, r.n) }));
      const w = 760, rowH = 26, m = { l: 330, r: 70, t: 10, b: 30 }, h = m.t + m.b + rowH * rows.length;
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
      [0.025, 0.05, 0.075, 0.1].forEach(t => { svg.append('circle').attr('r', rad(t)).style('fill', 'none').style('stroke', 'var(--rule)'); svg.append('text').attr('x', 3).attr('y', -rad(t) - 2).attr('font-size', 8).attr('font-family', MONO).style('fill', 'var(--muted)').text(pct(t)); });
      [0, 6, 12, 18].forEach(hh => { const a = hh / 24 * 2 * Math.PI; svg.append('text').attr('x', Math.sin(a) * (R + 14)).attr('y', -Math.cos(a) * (R + 14) + 3).attr('text-anchor', 'middle').attr('font-size', 9).attr('font-family', MONO).style('fill', 'var(--muted)').text(`${String(hh).padStart(2, '0')}:00`); });
      series.forEach(s => {
        const pts = [...s.v, s.v[0]];
        svg.append('path').datum(pts).attr('d', d3.lineRadial().angle(d => (d.h + 0.5) / 24 * 2 * Math.PI).radius(d => rad(d.p)).curve(d3.curveCardinalClosed)).style('fill', SER[s.k][1]).style('fill-opacity', 0.15).style('stroke', SER[s.k][1]).attr('stroke-width', 2);
        svg.selectAll(null).data(s.v).join('circle').attr('cx', d => Math.sin((d.h + 0.5) / 24 * 2 * Math.PI) * rad(d.p)).attr('cy', d => -Math.cos((d.h + 0.5) / 24 * 2 * Math.PI) * rad(d.p)).attr('r', 3).style('fill', SER[s.k][1])
          .on('pointermove', (ev, d) => showTip(`<b>${SER[s.k][0]}</b><br>${String(d.h).padStart(2, '0')}:00–${String(d.h).padStart(2, '0')}:59: ${pct(d.p)} (${fmtN(d.n)} games)`, ev)).on('pointerleave', hideTip);
      });
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

