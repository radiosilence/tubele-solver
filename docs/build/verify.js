const fs=require('fs'),vm=require('vm'),path=require('path');
// Checks every number the prose of body.html states by hand (rather than
// through a data-v span) against data.js and the dashboard exports.
// Run after build.js: node build/verify.js. Exits non-zero on any mismatch.
const docs=path.join(__dirname,'..');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(docs,'data.js'),'utf8'),ctx);const D=ctx.window.PAPER_DATA;
const SD=JSON.parse(fs.readFileSync(path.join(docs,'build/stats/daily-behaviour.json')));const SP=JSON.parse(fs.readFileSync(path.join(docs,'build/stats/practice-behaviour.json')));
const N=D.stations.length, log2n=Math.log2(N);
let bad=0;const ck=(label,got,claim,tol)=>{const ok=Math.abs(got-claim)<=tol;if(!ok)bad++;console.log((ok?'ok  ':'FAIL')+' '+label+': claim '+claim+', actual '+(+got.toFixed(4)));};
const name=i=>D.stations[i][0];
ck('stations',N,420,0); ck('lines',D.lines.length,19,0);
const k=SD.kpi[0],kp=SP.kpi[0];
ck('daily finished',k.finished,8933,0);ck('practice finished',kp.finished,4097,0);ck('total',k.finished+kp.finished,13030,0);
ck('daily win%',100*k.wins/k.finished,80.7,0.05);ck('practice win%',100*kp.wins/kp.finished,73.1,0.05);
ck('daily avg guesses',k.avg_guesses,3.88,0);ck('practice avg',kp.avg_guesses,4.16,0);
ck('daily started',k.started,9550,0);ck('practice started',kp.started,4522,0);
ck('bits/guess daily win',log2n/3.88,2.2,0.06);ck('bits/guess practice win',log2n/4.16,2.1,0.01);
const adm=D.adaptive.lengths.reduce((a,b)=>a+b,0)/N;
ck('solver panel (port) bits',log2n/adm,3.9,0.05);ck('solver panel (ref 2.264) bits',log2n/2.264,3.9,0.06);
ck('ratio low',Math.min(log2n/adm,log2n/2.264)/(log2n/3.88),1.7,0.05);ck('ratio high',Math.max(log2n/adm,log2n/2.264)/(log2n/4.16),1.9,0.05);
const gd=SD.guess_distribution;ck('daily 2nd-guess win share of finished %',gd.find(x=>x.guesses===2).games/k.finished*100,14,0.5);
// fitted model mass at guess 2
const fit=D.human.daily.fit.b;ck('fitted daily P(win at 2) %',100*(1-1/N)*Math.pow(2,fit)/N,1,0.6);
const sa=SD.stops_away_by_guess.map(g=>g.avg_stops),sp=SP.stops_away_by_guess.map(g=>g.avg_stops);
[6.22,5.24,4.31,3.53,3.55,3.07].forEach((c,i)=>ck('daily dist g'+(i+1),sa[i],c,0));
ck('practice dist g1',sp[0],8.84,0);ck('practice dist g6',sp[5],4.98,0);console.log('     practice dists',sp.join(' '));
const od=SD.opening_distance;const om=od.reduce((s,r)=>s+r.stops_away*r.guesses,0)/od.reduce((s,r)=>s+r.guesses,0);
ck('first reading mean, all openers (opening_distance)',om,6.22,0.005);
const kxd=SD.opening_stations.find(o=>o.station.startsWith("King's Cross"));ck('KX daily first reading',kxd.avg_stops,6.07,0);
const kxp=SP.opening_stations.find(o=>o.station.startsWith("King's Cross"));ck('KX practice first reading',kxp.avg_stops,7.62,0);
const tier=t=>SD.win_rate_by_tier.find(x=>x.tier===t);ck('core avg',tier('core').avg_guesses,3.74,0);ck('deep avg',tier('deep').avg_guesses,4.42,0);
const sm=D.behaviour.solverMap;console.log('     solverMap means',sm.map(g=>g.mean.toFixed(2)).join(' '),'solverClues',D.behaviour.solverClues.map(g=>g.mean.toFixed(2)).join(' '));
ck('solver 2nd-guess dist',sm[1].mean,5.7,0.05);ck('solver 3rd-guess dist',sm[2].mean,0.3,0.05);
const H=D.clues;ck('letter bits',H.letter.H,4.10,0.005);ck('line bits',H.line.H,3.95,0.005);ck('end bits',H.end.H,7.25,0.005);ck('end|line',H.end.H-H.line.H,3.3,0.05);ck('mode bits',H.mode.H,1.5,0.05);
const st=D.openers.find(o=>o.s===D.stratford);ck('Stratford blocks (~150)',st.classes,150,5);ck('first reading, all openers (Exhibit 17)',om,6.22,0.005);ck('Stratford mean',st.mean,2.71,0.005);ck('panel mean ~2.25 (port)',adm,2.25,0.015);
ck('uniform share %',100/N,0.24,0.005);
// blocks after first guess: share under ten, largest
console.log('     port panel worst',Math.max(...D.adaptive.lengths),' hist',[1,2,3,4,5].map(t=>D.adaptive.lengths.filter(l=>l===t).length).join(' '));
ck('panel share on guess 2 (port) %',100*D.adaptive.lengths.filter(l=>l===2).length/N,74,1.5);
const dr=SD.day_n_return;console.log('     day_n_return sample',JSON.stringify(dr.slice(0,3)),JSON.stringify(dr.slice(-3)));
const rp=SD.returning_players;console.log('     returning_players tail',JSON.stringify(rp.slice(-4)));
const tod=SP.time_of_day.map(h=>h.finished);console.log('     practice by hour',tod.join(' '));
const sz=D.stratfordTree.c.filter(x=>!x.w).map(x=>x.n||1);ck('blocks after Stratford under ten ("mostly") share',sz.filter(v=>v<10).length/sz.length,0.94,0.01);
ck('panel worst (port) <= 4',Math.max(...D.adaptive.lengths),3,0);
console.log(bad?bad+' FAIL':'all ok');process.exit(bad?1:0);
