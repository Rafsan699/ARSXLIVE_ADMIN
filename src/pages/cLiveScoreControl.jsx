import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import API from '@/services/capi';

/* =====================================================================
 *  ADDED: Match History + Super Over
 *  (Everything below is new code. The original scoring logic is untouched;
 *   the main component only calls small "log" helpers at a few places.)
 * ===================================================================== */

const SO_BALLS = 6;     // legal balls in a super over
const SO_WICKETS = 2;   // wickets that end a super over innings

// Compact player snapshot used inside the history log
const toPl = (p) => (p && p.name ? {
  key: `${p.name}_${p.dept || ''}_${p.batch || ''}_${p.id || ''}`,
  name: p.name,
  dept: p.dept || '',
  batch: p.batch || '',
  id: p.id || ''
} : null);

// Same parsing the main page uses for "name_dept_batch_id" keys
const plFromKey = (k) => {
  const parts = String(k || '').split('_');
  const [name, dept, batch] = parts;
  const id = parts.slice(3).join('_');
  return {
    name: name || '',
    dept: dept !== 'undefined' ? (dept || '') : '',
    batch: batch !== 'undefined' ? (batch || '') : '',
    id: id !== 'undefined' ? (id || '') : ''
  };
};

const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

// Mirrors the run / extras rules already used by the main scoring buttons
const computeBallOutcome = (runScored, ex) => {
  const r = Number(runScored) || 0;
  let o;
  if (ex.wide) {
    o = { total: 1 + r, bat: 0, extras: 1 + r, extraKind: 'wd', legal: false, faced: false, bowlerRuns: 1 + r, desc: r > 0 ? `${1 + r}Wd` : 'Wd' };
  } else if (ex.noBall) {
    o = { total: 1 + r, bat: r, extras: 1, extraKind: 'nb', legal: false, faced: false, bowlerRuns: 1 + r, desc: r > 0 ? `${r}nb` : 'Nb' };
  } else if (ex.bye) {
    o = { total: r, bat: 0, extras: r, extraKind: 'b', legal: true, faced: true, bowlerRuns: 0, desc: `${r}b` };
  } else if (ex.legBye) {
    o = { total: r, bat: 0, extras: r, extraKind: 'lb', legal: true, faced: true, bowlerRuns: r, desc: `${r}lb` };
  } else {
    o = { total: r, bat: r, extras: 0, extraKind: '', legal: true, faced: true, bowlerRuns: r, desc: String(r) };
  }
  o.swap = r % 2 === 1;
  return o;
};

const BOWLER_CREDIT = ['bowled', 'catch out', 'stumping', 'lbw', 'hit wicket'];

const buildBallRecord = ({ innings, battingTeam, bowlingTeam, legalBefore, striker, nonStriker, bowler, runScored, ex, wk, runsBefore, wicketsBefore }) => {
  const o = computeBallOutcome(runScored, ex);
  let wicket = null;
  if (wk) {
    // same convention as the main page: run-swap is applied first, then the "out" end is replaced
    const postStriker = o.swap ? nonStriker : striker;
    const postNon = o.swap ? striker : nonStriker;
    const out = wk.batterOut === 'striker' ? postStriker : postNon;
    wicket = {
      howOut: wk.howOut,
      batter: toPl(out),
      helper: wk.helper ? String(wk.helper).split('_')[0] : '',
      bowlerCredited: BOWLER_CREDIT.includes(wk.howOut)
    };
  }
  return {
    kind: 'ball',
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    innings, battingTeam, bowlingTeam,
    legalBefore,
    over: Math.floor(legalBefore / 6),
    legal: o.legal,
    striker: toPl(striker),
    nonStriker: toPl(nonStriker),
    bowler: toPl(bowler),
    batRuns: o.bat,
    extraRuns: o.extras,
    extraKind: o.extraKind,
    totalRuns: o.total,
    bowlerRuns: o.bowlerRuns,
    faced: o.faced,
    wicket,
    desc: wicket ? (o.desc === '0' ? 'W' : `${o.desc}+W`) : o.desc,
    scoreAfter: { runs: runsBefore + o.total, wickets: wicketsBefore + (wicket ? 1 : 0) }
  };
};

// Turns the raw ball-by-ball entries of ONE innings into scorecard data
const buildInningsData = (entries) => {
  const batters = new Map();
  const batOrder = [];
  const bowlers = new Map();
  const bowlOrder = [];
  const overMap = new Map();
  const fow = [];
  const extras = { wd: 0, nb: 0, b: 0, lb: 0, pen: 0 };
  let runs = 0, wickets = 0, legalBalls = 0, fours = 0, sixes = 0;

  const getBat = (p) => {
    if (!p) return null;
    if (!batters.has(p.key)) {
      batters.set(p.key, { ...p, runs: 0, balls: 0, fours: 0, sixes: 0, out: null, retired: false });
      batOrder.push(p.key);
    }
    return batters.get(p.key);
  };
  const getBowl = (p) => {
    if (!p) return null;
    if (!bowlers.has(p.key)) {
      bowlers.set(p.key, { ...p, legal: 0, runs: 0, wickets: 0, wd: 0, nb: 0, maidens: 0, overRuns: {} });
      bowlOrder.push(p.key);
    }
    return bowlers.get(p.key);
  };
  const getOver = (i) => {
    if (!overMap.has(i)) overMap.set(i, { over: i, items: [], runs: 0, wickets: 0, legal: 0, bowlers: [], endScore: null });
    return overMap.get(i);
  };

  entries.forEach((e) => {
    if (e.kind === 'retire') {
      const b = getBat(e.player);
      if (b) b.retired = true;
      getBat(e.replacedBy);
      getOver(e.over).items.push(e);
      return;
    }
    if (e.kind === 'adjust') {
      runs += e.runs;
      extras.pen += e.penalty || 0;
      const ov = getOver(e.over);
      ov.runs += e.runs;
      ov.items.push(e);
      ov.endScore = e.scoreAfter;
      return;
    }

    const s = getBat(e.striker);
    getBat(e.nonStriker);
    if (s) {
      if (e.faced) s.balls += 1;
      s.runs += e.batRuns;
      if (e.batRuns === 4) { s.fours += 1; fours += 1; }
      if (e.batRuns === 6) { s.sixes += 1; sixes += 1; }
    }

    runs += e.totalRuns;
    if (e.legal) legalBalls += 1;
    if (e.extraKind) extras[e.extraKind] += e.extraKind === 'nb' ? 1 : e.extraRuns;

    const ov = getOver(e.over);
    const bw = getBowl(e.bowler);
    if (bw) {
      if (e.legal) bw.legal += 1;
      bw.runs += e.bowlerRuns;
      if (e.extraKind === 'wd') bw.wd += 1;
      if (e.extraKind === 'nb') bw.nb += 1;
      const rec = bw.overRuns[e.over] || (bw.overRuns[e.over] = { runs: 0, legal: 0 });
      rec.runs += e.bowlerRuns;
      if (e.legal) rec.legal += 1;
      if (!ov.bowlers.includes(bw.name)) ov.bowlers.push(bw.name);
    }
    ov.items.push(e);
    ov.runs += e.totalRuns;
    if (e.legal) ov.legal += 1;
    ov.endScore = e.scoreAfter;

    if (e.wicket) {
      wickets += 1;
      ov.wickets += 1;
      if (bw && e.wicket.bowlerCredited) bw.wickets += 1;
      const ob = getBat(e.wicket.batter);
      if (ob) ob.out = { howOut: e.wicket.howOut, bowler: e.wicket.bowlerCredited && e.bowler ? e.bowler.name : '', helper: e.wicket.helper };
      fow.push({
        score: e.scoreAfter.runs,
        wkt: e.scoreAfter.wickets,
        batter: e.wicket.batter ? e.wicket.batter.name : '',
        over: `${e.over}.${(e.legalBefore % 6) + (e.legal ? 1 : 0)}`
      });
    }
  });

  bowlers.forEach((bw) => {
    Object.values(bw.overRuns).forEach((o) => { if (o.legal === 6 && o.runs === 0) bw.maidens += 1; });
  });

  const first = entries.find((e) => e.battingTeam) || {};
  return {
    battingTeam: first.battingTeam || '',
    bowlingTeam: first.bowlingTeam || '',
    runs, wickets, legalBalls, fours, sixes,
    extras: { ...extras, total: extras.wd + extras.nb + extras.b + extras.lb + extras.pen },
    batters: batOrder.map((k) => batters.get(k)),
    bowlers: bowlOrder.map((k) => bowlers.get(k)),
    overs: [...overMap.values()].sort((a, b) => a.over - b.over),
    fow,
    getBatter: (key) => batters.get(key),
    getBowler: (key) => bowlers.get(key)
  };
};

const ballLabel = (e) => `${e.over}.${(e.legalBefore % 6) + (e.kind === 'ball' && e.legal ? 1 : 0)}`;

const dismissalText = (b) => {
  if (b.out) {
    const { howOut, bowler, helper } = b.out;
    if (howOut === 'bowled') return `b ${bowler}`;
    if (howOut === 'lbw') return `lbw b ${bowler}`;
    if (howOut === 'catch out') return `c ${helper || 'sub'} b ${bowler}`;
    if (howOut === 'stumping') return `st ${helper || 'wk'} b ${bowler}`;
    if (howOut === 'hit wicket') return `hit wicket b ${bowler}`;
    return `${howOut}${helper ? ` (${helper})` : ''}`;
  }
  return b.retired ? 'retired' : 'not out';
};

const describeBall = (e) => {
  if (e.kind === 'adjust') return `Extra runs added: +${e.runs}${e.penalty ? ` (penalty ${e.penalty})` : ''}`;
  if (e.kind === 'retire') return `${(e.player && e.player.name) || 'Batter'} retired, ${(e.replacedBy && e.replacedBy.name) || 'new batter'} came in`;
  const bw = (e.bowler && e.bowler.name) || 'Bowler';
  const st = (e.striker && e.striker.name) || 'Batter';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let t = `${bw} to ${st}: `;
  if (e.extraKind === 'wd') t += `Wide, ${plural(e.totalRuns, 'run')}`;
  else if (e.extraKind === 'nb') t += `No ball${e.batRuns ? `, ${e.batRuns} off the bat` : ''} (${plural(e.totalRuns, 'run')})`;
  else if (e.extraKind === 'b') t += plural(e.totalRuns, 'bye');
  else if (e.extraKind === 'lb') t += plural(e.totalRuns, 'leg bye');
  else if (e.batRuns === 0) t += 'dot ball';
  else if (e.batRuns === 4) t += 'FOUR';
  else if (e.batRuns === 6) t += 'SIX';
  else t += plural(e.batRuns, 'run');
  if (e.wicket) {
    const w = e.wicket;
    t += ` — WICKET! ${(w.batter && w.batter.name) || 'Batter'} (${w.howOut}${w.helper ? `, ${w.helper}` : ''})`;
  }
  return t;
};

/* ---------- small UI pieces ---------- */
const thStyle = { padding: '6px 8px', textAlign: 'left', fontSize: '12px', color: '#334155', background: '#e2e8f0', whiteSpace: 'nowrap' };
const tdStyle = { padding: '6px 8px', fontSize: '13px', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const numTh = { ...thStyle, textAlign: 'right' };
const numTd = { ...tdStyle, textAlign: 'right' };

const BallChip = ({ e }) => {
  let d = e.desc;
  let bg = '#e2e8f0';
  if (e.kind === 'adjust') { d = `+${e.runs}`; bg = '#8b5cf6'; }
  else if (e.kind === 'retire') { d = 'Ret'; bg = '#64748b'; }
  else if (e.wicket) bg = '#ef4444';
  else if (e.batRuns === 4 || e.batRuns === 6) bg = '#0284c7';
  else if (e.extraKind) bg = '#f59e0b';
  return (
    <span style={{ minWidth: '30px', height: '30px', padding: '0 6px', boxSizing: 'border-box', borderRadius: '15px', background: bg, color: bg === '#e2e8f0' ? '#1e293b' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>
      {d}
    </span>
  );
};

const PlayerCell = ({ p }) => (
  <span>
    <strong>{p.name}</strong>
    {(p.batch || p.dept) && (
      <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '6px' }}>
        {[p.batch && `B:${p.batch}`, p.dept].filter(Boolean).join(' | ')}
      </span>
    )}
  </span>
);

const rr = (runs, balls) => (balls > 0 ? ((runs / balls) * 6).toFixed(2) : '0.00');

/* ---------- Full match history overlay ---------- */
const MatchHistoryModal = ({ log, meta, team1, team2, onClose }) => {
  const [tab, setTab] = useState('summary');
  const [view, setView] = useState('scorecard');

  const inningsList = useMemo(() => {
    const names = [];
    log.forEach((e) => { if (!names.includes(e.innings)) names.push(e.innings); });
    return names.map((name) => ({ name, ...buildInningsData(log.filter((e) => e.innings === name)) }));
  }, [log]);

  const active = inningsList.find((i) => i.name === tab);
  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => { setTab(id); setView('scorecard'); }}
      style={{ padding: '8px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', background: tab === id ? '#0284c7' : '#e2e8f0', color: tab === id ? '#fff' : '#334155' }}
    >
      {label}
    </button>
  );

  const renderSummary = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#0f172a' }}>{team1} vs {team2}</div>
        <div style={{ fontSize: '13px', color: '#475569', marginTop: '6px', lineHeight: 1.7 }}>
          {meta.tossWinner && <div>Toss: {meta.tossWinner} won and chose to {meta.tossDecision === 'bowl' ? 'bowl' : 'bat'} first</div>}
          {meta.totalOvers && <div>Format: {meta.totalOvers} overs per innings{meta.playersPerTeam ? `, ${meta.playersPerTeam} players per team` : ''}</div>}
          <div>Result: <strong style={{ color: '#166534' }}>{meta.result || 'Match in progress / no result yet'}</strong></div>
        </div>
      </div>

      {inningsList.map((inn) => {
        const topBat = [...inn.batters].sort((a, b) => b.runs - a.runs)[0];
        const topBowl = [...inn.bowlers].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
        return (
          <div key={inn.name} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ color: '#0f172a' }}>{inn.name}</strong>
              <strong style={{ color: '#0284c7' }}>{inn.runs}/{inn.wickets} ({fmtOvers(inn.legalBalls)} ov)</strong>
            </div>
            <div style={{ fontSize: '13px', color: '#475569', marginTop: '6px', lineHeight: 1.7 }}>
              <div>Run rate: {rr(inn.runs, inn.legalBalls)} | Fours: {inn.fours} | Sixes: {inn.sixes} | Extras: {inn.extras.total}</div>
              {topBat && <div>Top scorer: {topBat.name} {topBat.runs} ({topBat.balls})</div>}
              {topBowl && <div>Best bowler: {topBowl.name} {topBowl.wickets}/{topBowl.runs} ({fmtOvers(topBowl.legal)} ov)</div>}
            </div>
          </div>
        );
      })}

      {meta.superOvers && meta.superOvers.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '14px' }}>
          <strong style={{ color: '#92400e' }}>Super Over</strong>
          {meta.superOvers.map((s, i) => (
            <div key={i} style={{ fontSize: '13px', color: '#78350f', marginTop: '6px' }}>
              Round {s.round}: {s.batFirst} {s.scores[0] ? `${s.scores[0].runs}/${s.scores[0].wickets}` : '-'} vs {s.batSecond} {s.scores[1] ? `${s.scores[1].runs}/${s.scores[1].wickets}` : '-'} — {s.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderScorecard = (inn) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: '#0f172a', color: '#fff', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>{inn.battingTeam} batting vs {inn.bowlingTeam}</div>
        <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
          {inn.runs}/{inn.wickets} <span style={{ fontSize: '15px', color: '#cbd5e1' }}>({fmtOvers(inn.legalBalls)} ov)</span>
        </div>
        <div style={{ fontSize: '13px', color: '#cbd5e1' }}>RR {rr(inn.runs, inn.legalBalls)} | 4s: {inn.fours} | 6s: {inn.sixes}</div>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Batter</th><th style={thStyle}>How out</th>
              <th style={numTh}>R</th><th style={numTh}>B</th><th style={numTh}>4s</th><th style={numTh}>6s</th><th style={numTh}>SR</th>
            </tr>
          </thead>
          <tbody>
            {inn.batters.map((b) => (
              <tr key={b.key}>
                <td style={tdStyle}><PlayerCell p={b} /></td>
                <td style={{ ...tdStyle, color: b.out ? '#b91c1c' : '#166534' }}>{dismissalText(b)}</td>
                <td style={{ ...numTd, fontWeight: 'bold' }}>{b.runs}</td>
                <td style={numTd}>{b.balls}</td>
                <td style={numTd}>{b.fours}</td>
                <td style={numTd}>{b.sixes}</td>
                <td style={numTd}>{b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0'}</td>
              </tr>
            ))}
            <tr>
              <td style={tdStyle}><strong>Extras</strong></td>
              <td style={tdStyle} colSpan={6}>
                {inn.extras.total} (wd {inn.extras.wd}, nb {inn.extras.nb}, b {inn.extras.b}, lb {inn.extras.lb}, pen {inn.extras.pen})
              </td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td style={tdStyle}><strong>Total</strong></td>
              <td style={tdStyle} colSpan={6}><strong>{inn.runs}/{inn.wickets} in {fmtOvers(inn.legalBalls)} overs</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Bowler</th>
              <th style={numTh}>O</th><th style={numTh}>M</th><th style={numTh}>R</th><th style={numTh}>W</th>
              <th style={numTh}>Eco</th><th style={numTh}>Wd</th><th style={numTh}>Nb</th>
            </tr>
          </thead>
          <tbody>
            {inn.bowlers.map((b) => (
              <tr key={b.key}>
                <td style={tdStyle}><PlayerCell p={b} /></td>
                <td style={numTd}>{fmtOvers(b.legal)}</td>
                <td style={numTd}>{b.maidens}</td>
                <td style={numTd}>{b.runs}</td>
                <td style={{ ...numTd, fontWeight: 'bold' }}>{b.wickets}</td>
                <td style={numTd}>{rr(b.runs, b.legal)}</td>
                <td style={numTd}>{b.wd}</td>
                <td style={numTd}>{b.nb}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inn.fow.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', fontSize: '13px', color: '#334155', lineHeight: 1.8 }}>
          <strong>Fall of wickets: </strong>
          {inn.fow.map((f, i) => (
            <span key={i}>{f.score}-{f.wkt} ({f.batter}, {f.over} ov){i < inn.fow.length - 1 ? ', ' : ''}</span>
          ))}
        </div>
      )}
    </div>
  );

  const renderOvers = (inn) => (
    <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Over</th><th style={thStyle}>Bowler</th><th style={thStyle}>Balls</th>
            <th style={numTh}>Runs</th><th style={numTh}>Wkts</th><th style={numTh}>Score</th>
          </tr>
        </thead>
        <tbody>
          {inn.overs.map((ov) => (
            <tr key={ov.over}>
              <td style={{ ...tdStyle, fontWeight: 'bold' }}>{ov.over + 1}</td>
              <td style={tdStyle}>{ov.bowlers.join(', ') || '-'}</td>
              <td style={{ ...tdStyle, whiteSpace: 'normal' }}>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {ov.items.map((e) => <BallChip key={e.id} e={e} />)}
                </div>
              </td>
              <td style={{ ...numTd, fontWeight: 'bold' }}>{ov.runs}</td>
              <td style={numTd}>{ov.wickets}</td>
              <td style={numTd}>{ov.endScore ? `${ov.endScore.runs}/${ov.endScore.wickets}` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderBalls = (inn) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {inn.overs.map((ov) => (
        <div key={ov.over} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ background: '#f1f5f9', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>
            <span>Over {ov.over + 1} — {ov.bowlers.join(', ') || '-'}</span>
            <span>{ov.runs} runs{ov.wickets ? `, ${ov.wickets} wkt` : ''}</span>
          </div>
          {ov.items.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderTop: '1px solid #f1f5f9', fontSize: '13px' }}>
              <span style={{ width: '34px', color: '#64748b', fontWeight: 'bold' }}>{ballLabel(e)}</span>
              <BallChip e={e} />
              <span style={{ color: e.wicket ? '#b91c1c' : '#1e293b' }}>{describeBall(e)}</span>
              {e.scoreAfter && <span style={{ marginLeft: 'auto', color: '#64748b' }}>{e.scoreAfter.runs}/{e.scoreAfter.wickets}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 1200, overflowY: 'auto', fontFamily: 'Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h2 style={{ margin: 0, color: '#1e293b' }}>📜 Match History — {team1} vs {team2}</h2>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
            Close
          </button>
        </div>

        {log.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#475569' }}>
            No history yet. Every ball scored from now on will be recorded here.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {tabBtn('summary', 'Summary')}
              {inningsList.map((i) => tabBtn(i.name, i.name))}
            </div>

            {tab === 'summary' && renderSummary()}

            {active && (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  {[['scorecard', 'Scorecard'], ['overs', 'Over by Over'], ['balls', 'Ball by Ball']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setView(id)}
                      style={{ padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', border: '1px solid #0284c7', background: view === id ? '#0284c7' : '#fff', color: view === id ? '#fff' : '#0284c7' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {view === 'scorecard' && renderScorecard(active)}
                {view === 'overs' && renderOvers(active)}
                {view === 'balls' && renderBalls(active)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/* ---------- Super Over scoring overlay ---------- */
const WK_DEFAULT = { howOut: 'bowled', didCross: 'no', helper: '', batterOut: 'striker', newBatter: '' };
const EX_DEFAULT = { wide: false, noBall: false, bye: false, legBye: false, wicket: false };

const SuperOverPanel = ({ so, setSo, squads, allKeys, ballLog, setBallLog, getLabel, onSync, onFinish, onNextRound, onOpenHistory, onClose }) => {
  const [ex, setEx] = useState(EX_DEFAULT);
  const [sel, setSel] = useState({ striker: '', non: '', bowler: '' });
  const [pending, setPending] = useState(null);
  const [wk, setWk] = useState(WK_DEFAULT);
  const [undoStack, setUndoStack] = useState([]);

  const idx = so.phase === 'setup1' || so.phase === 'play1' ? 0 : 1;
  const batTeam = idx === 0 ? so.batFirst : so.batSecond;
  const bowlTeam = idx === 0 ? so.batSecond : so.batFirst;
  const inningsName = `Super Over ${so.round} · ${batTeam}`;
  const inPlay = so.phase === 'play1' || so.phase === 'play2';
  const isSetup = so.phase === 'setup1' || so.phase === 'setup2';

  const data = useMemo(() => buildInningsData(ballLog.filter((e) => e.innings === inningsName)), [ballLog, inningsName]);
  const target = so.scores[0] ? so.scores[0].runs + 1 : 0;

  const batSquad = squads[batTeam] && squads[batTeam].length ? squads[batTeam] : allKeys;
  const bowlSquad = squads[bowlTeam] && squads[bowlTeam].length ? squads[bowlTeam] : allKeys;

  const sKey = so.striker ? toPl(so.striker).key : '';
  const nKey = so.nonStriker ? toPl(so.nonStriker).key : '';
  const bKey = so.bowler ? toPl(so.bowler).key : '';
  const sStat = data.getBatter(sKey) || { runs: 0, balls: 0, fours: 0, sixes: 0 };
  const nStat = data.getBatter(nKey) || { runs: 0, balls: 0, fours: 0, sixes: 0 };
  const bStat = data.getBowler(bKey) || { legal: 0, runs: 0, wickets: 0 };

  const unavailable = new Set([sKey, nKey, ...data.batters.filter((b) => b.out).map((b) => b.key)]);
  const newBatterOptions = batSquad.filter((k) => !unavailable.has(k));

  const endsAfter = (o, isWk) => {
    const runs2 = data.runs + o.total;
    const wkts2 = data.wickets + (isWk ? 1 : 0);
    const legal2 = data.legalBalls + (o.legal ? 1 : 0);
    return wkts2 >= SO_WICKETS || legal2 >= SO_BALLS || (idx === 1 && runs2 >= target);
  };

  const compact = (s, cur) => ({
    round: s.round, phase: s.phase, batFirst: s.batFirst, batSecond: s.batSecond,
    scores: s.scores, tied: s.tied, result: s.result, current: cur
  });

  const startInnings = () => {
    if (!sel.striker || !sel.non || !sel.bowler) { alert('Select striker, non-striker and bowler!'); return; }
    if (sel.striker === sel.non) { alert('Striker and non-striker must be different players!'); return; }
    setUndoStack([]);
    setSo({ ...so, phase: idx === 0 ? 'play1' : 'play2', striker: plFromKey(sel.striker), nonStriker: plFromKey(sel.non), bowler: plFromKey(sel.bowler) });
    setSel({ striker: '', non: '', bowler: '' });
    onSync({ matchStatus: 'Ongoing', superOver: compact({ ...so, phase: idx === 0 ? 'play1' : 'play2' }, { team: batTeam, runs: 0, wickets: 0, overs: '0.0', target: idx === 1 ? target : 0 }) });
  };

  const scoreBall = (runScored, exSnap, wkInfo) => {
    const o = computeBallOutcome(runScored, exSnap);
    const rec = buildBallRecord({
      innings: inningsName, battingTeam: batTeam, bowlingTeam: bowlTeam,
      legalBefore: data.legalBalls,
      striker: so.striker, nonStriker: so.nonStriker, bowler: so.bowler,
      runScored, ex: exSnap, wk: wkInfo,
      runsBefore: data.runs, wicketsBefore: data.wickets
    });
    const runs2 = rec.scoreAfter.runs;
    const wkts2 = rec.scoreAfter.wickets;
    const legal2 = data.legalBalls + (o.legal ? 1 : 0);
    const over = wkts2 >= SO_WICKETS || legal2 >= SO_BALLS || (idx === 1 && runs2 >= target);

    let s = so.striker;
    let n = so.nonStriker;
    if (o.swap) { const t = s; s = n; n = t; }
    if (wkInfo && !over) {
      const nb = plFromKey(wkInfo.newBatter);
      if (wkInfo.batterOut === 'striker') s = nb; else n = nb;
      if (wkInfo.didCross === 'yes') { const t = s; s = n; n = t; }
    }

    setUndoStack((prev) => [...prev, { so, logLen: ballLog.length }]);
    setBallLog((prev) => [...prev, rec]);
    setEx(EX_DEFAULT);

    const cur = { runs: runs2, wickets: wkts2, balls: legal2 };
    let next = { ...so, striker: s, nonStriker: n };
    let finished = null;

    if (over) {
      const scores = [...so.scores];
      scores[idx] = cur;
      if (idx === 0) {
        next = { ...next, scores, phase: 'setup2' };
      } else {
        const r1 = so.scores[0].runs;
        let message;
        let tied = false;
        if (runs2 > r1) message = `${batTeam} won the match via Super Over by ${SO_WICKETS - wkts2} wicket(s)! 🏆`;
        else if (runs2 < r1) message = `${bowlTeam} won the match via Super Over by ${r1 - runs2} run(s)! 🏆`;
        else { tied = true; message = 'Super Over Tied! 🤝'; }
        next = { ...next, scores, phase: 'done', tied, result: message };
        finished = { message, tied };
      }
    }

    setSo(next);
    onSync({ matchStatus: 'Ongoing', superOver: compact(next, { team: batTeam, runs: runs2, wickets: wkts2, overs: fmtOvers(legal2), target: idx === 1 ? target : 0 }) });
    if (finished) onFinish(finished.message, finished.tied, next);
  };

  const handleRun = (r) => {
    if (ex.wicket) { setPending({ r, ex: { ...ex } }); return; }
    scoreBall(r, ex, null);
  };

  const submitWicket = (e) => {
    e.preventDefault();
    const o = computeBallOutcome(pending.r, pending.ex);
    if (!endsAfter(o, true) && !wk.newBatter) { alert('Select the new batter!'); return; }
    scoreBall(pending.r, pending.ex, { ...wk });
    setPending(null);
    setWk(WK_DEFAULT);
  };

  const undo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) { alert('Nothing to undo!'); return; }
    setSo(last.so);
    setBallLog((prev) => prev.slice(0, last.logLen));
    setUndoStack((prev) => prev.slice(0, -1));
    setEx(EX_DEFAULT);
  };

  const selectStyle = { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' };
  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 1050, overflowY: 'auto', fontFamily: 'Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ margin: 0, color: '#92400e' }}>⚡ Super Over {so.round}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={onOpenHistory} style={{ padding: '8px 14px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>📜 History</button>
            <button type="button" onClick={onClose} style={{ padding: '8px 14px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Hide</button>
          </div>
        </div>

        <div style={{ ...card, background: '#fffbeb', borderColor: '#fde68a', fontSize: '13px', color: '#78350f', lineHeight: 1.7 }}>
          {so.batFirst} bat first, then {so.batSecond} chase. One over each, {SO_WICKETS} wickets ends the innings.
          {so.scores[0] && <div><strong>{so.batFirst}: {so.scores[0].runs}/{so.scores[0].wickets} ({fmtOvers(so.scores[0].balls)} ov)</strong></div>}
          {so.scores[1] && <div><strong>{so.batSecond}: {so.scores[1].runs}/{so.scores[1].wickets} ({fmtOvers(so.scores[1].balls)} ov)</strong></div>}
        </div>

        {isSetup && (
          <div style={card}>
            <h3 style={{ margin: '0 0 12px 0', color: '#0f172a' }}>
              {idx === 0 ? '1st' : '2nd'} Super Over innings — {batTeam} batting{idx === 1 ? ` (target ${target})` : ''}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Striker ({batTeam}):</label>
                <select value={sel.striker} onChange={(e) => setSel({ ...sel, striker: e.target.value })} style={selectStyle}>
                  <option value="">-- Select Striker --</option>
                  {batSquad.map((k, i) => <option key={i} value={k}>{getLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Non-Striker ({batTeam}):</label>
                <select value={sel.non} onChange={(e) => setSel({ ...sel, non: e.target.value })} style={selectStyle}>
                  <option value="">-- Select Non-Striker --</option>
                  {batSquad.map((k, i) => <option key={i} value={k}>{getLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Bowler ({bowlTeam}):</label>
                <select value={sel.bowler} onChange={(e) => setSel({ ...sel, bowler: e.target.value })} style={selectStyle}>
                  <option value="">-- Select Bowler --</option>
                  {bowlSquad.map((k, i) => <option key={i} value={k}>{getLabel(k)}</option>)}
                </select>
              </div>
            </div>
            <button type="button" onClick={startInnings} style={{ marginTop: '14px', width: '100%', padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              Start {idx === 0 ? '1st' : '2nd'} Super Over innings
            </button>
            {undoStack.length > 0 && (
              <button type="button" onClick={undo} style={{ marginTop: '8px', width: '100%', padding: '10px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                ↩️ Undo last ball
              </button>
            )}
          </div>
        )}

        {inPlay && (
          <>
            <div style={{ background: '#0f172a', color: '#fff', borderRadius: '10px', padding: '18px' }}>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>{batTeam} batting vs {bowlTeam}</div>
              <div style={{ fontSize: '34px', fontWeight: 'bold' }}>
                {data.runs}/{data.wickets} <span style={{ fontSize: '17px', color: '#cbd5e1' }}>({fmtOvers(data.legalBalls)} / 1 Ov)</span>
              </div>
              {idx === 1 && (
                <div style={{ fontSize: '14px', color: '#38bdf8' }}>
                  Target {target} | Need {Math.max(0, target - data.runs)} from {Math.max(0, SO_BALLS - data.legalBalls)} balls
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ color: '#334155' }}>🏏 Batters</strong>
                  <button type="button" onClick={() => setSo({ ...so, striker: so.nonStriker, nonStriker: so.striker })} style={{ padding: '4px 10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>🔄 Swap</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold' }}>
                  <span>* {getLabel(so.striker)}</span><span>{sStat.runs} ({sStat.balls})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  <span>{getLabel(so.nonStriker)}</span><span>{nStat.runs} ({nStat.balls})</span>
                </div>
              </div>
              <div style={card}>
                <strong style={{ color: '#334155' }}>🎯 Bowler</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold', marginTop: '8px' }}>
                  <span>{getLabel(so.bowler)}</span>
                  <span>{fmtOvers(bStat.legal)} Ov | {bStat.runs} R | {bStat.wickets} W</span>
                </div>
              </div>
            </div>

            <div style={{ background: '#f1f5f9', borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>This over:</span>
              {data.overs.length > 0 ? data.overs[0].items.map((e) => <BallChip key={e.id} e={e} />) : <span style={{ fontSize: '12px', color: '#94a3b8' }}>no balls yet</span>}
            </div>

            <div style={card}>
              <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '14px' }}>
                <label><input type="checkbox" checked={ex.wide} onChange={(e) => setEx({ ...ex, wide: e.target.checked })} /> Wide (+1)</label>
                <label><input type="checkbox" checked={ex.noBall} onChange={(e) => setEx({ ...ex, noBall: e.target.checked })} /> No Ball (+1)</label>
                <label><input type="checkbox" checked={ex.bye} onChange={(e) => setEx({ ...ex, bye: e.target.checked })} /> Bye</label>
                <label><input type="checkbox" checked={ex.legBye} onChange={(e) => setEx({ ...ex, legBye: e.target.checked })} /> Leg Bye</label>
                <label><input type="checkbox" checked={ex.wicket} onChange={(e) => setEx({ ...ex, wicket: e.target.checked })} style={{ accentColor: '#ef4444' }} /> <strong style={{ color: '#ef4444' }}>Wicket</strong></label>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                  <button key={r} type="button" onClick={() => handleRun(r)} style={{ padding: '10px 18px', background: r === 4 || r === 6 ? '#0284c7' : '#e2e8f0', color: r === 4 || r === 6 ? '#fff' : '#1e293b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                    {r}
                  </button>
                ))}
                <button type="button" onClick={undo} style={{ padding: '10px 16px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', marginLeft: 'auto' }}>
                  ↩️ Undo
                </button>
              </div>
            </div>
          </>
        )}

        {so.phase === 'done' && (
          <div style={{ ...card, textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 8px 0', color: so.tied ? '#92400e' : '#16a34a' }}>{so.result}</h3>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
              {so.tied && (
                <button type="button" onClick={onNextRound} style={{ padding: '10px 18px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                  ⚡ Start another Super Over
                </button>
              )}
              <button type="button" onClick={onOpenHistory} style={{ padding: '10px 18px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                📜 View full history
              </button>
              <button type="button" onClick={onClose} style={{ padding: '10px 18px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {pending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1060 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '450px', maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#ef4444' }}>⚠️ Wicket Fall Details</h3>
            <form onSubmit={submitWicket} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>How Wicket Fall?</label>
                <select value={wk.howOut} onChange={(e) => setWk({ ...wk, howOut: e.target.value })} style={selectStyle}>
                  <option value="bowled">Bowled</option>
                  <option value="catch out">Catch Out</option>
                  <option value="run out striker">Run Out Striker</option>
                  <option value="run out non-striker">Run Out Non-Striker</option>
                  <option value="stumping">Stumping</option>
                  <option value="lbw">LBW</option>
                  <option value="hit wicket">Hit Wicket</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Which batter out?</label>
                <select value={wk.batterOut} onChange={(e) => setWk({ ...wk, batterOut: e.target.value })} style={selectStyle}>
                  <option value="striker">Striker</option>
                  <option value="non striker">Non Striker</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Who helped? (fielder):</label>
                <select value={wk.helper} onChange={(e) => setWk({ ...wk, helper: e.target.value })} style={selectStyle}>
                  <option value="">-- Select Fielder --</option>
                  {bowlSquad.map((k, i) => <option key={i} value={k}>{getLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Did batsmen cross?</label>
                <select value={wk.didCross} onChange={(e) => setWk({ ...wk, didCross: e.target.value })} style={selectStyle}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              {!endsAfter(computeBallOutcome(pending.r, pending.ex), true) && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>New Batter:</label>
                  <select value={wk.newBatter} onChange={(e) => setWk({ ...wk, newBatter: e.target.value })} style={selectStyle} required>
                    <option value="">-- Select New Batter --</option>
                    {newBatterOptions.map((k, i) => <option key={i} value={k}>{getLabel(k)}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button type="button" onClick={() => { setPending(null); setWk(WK_DEFAULT); }} style={{ flex: 1, padding: '10px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: '10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Confirm Wicket</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const CLiveScoreControl = () => {
  const { matchId: paramMatchId } = useParams();
  const [tournaments, setTournaments] = useState([]);
  
  // 3-Tier Selection States
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState('');

  // Player Management States from /club/players API
  // CHANGED: one pool of all players; each team's own pool is derived below (poolFor)
  const [allPlayersPool, setAllPlayersPool] = useState([]);
  const [filterByTeam, setFilterByTeam] = useState(true); // ON: each team shows its own players (falls back to all if none assigned)
  const [selectedTeam1Players, setSelectedTeam1Players] = useState([]); // Array of checked player identifiers / objects
  const [selectedTeam2Players, setSelectedTeam2Players] = useState([]); // Array of checked player identifiers / objects
  const [showPlayerSelectSection, setShowPlayerSelectSection] = useState(false);

  // Search states for player selection
  const [team1SearchQuery, setTeam1SearchQuery] = useState('');
  const [team2SearchQuery, setTeam2SearchQuery] = useState('');

  // Match Initialization Configuration States
  const [matchStarted, setMatchStarted] = useState(false);
  const [tossWinner, setTossWinner] = useState('');
  const [tossDecision, setTossDecision] = useState('bat'); // bat or bowl
  const [totalOvers, setTotalOvers] = useState(20);
  const [playersPerTeam, setPlayersPerTeam] = useState(11);

  // Live Match Play States
  const [innings, setInnings] = useState('1st Innings');
  const [battingTeam, setBattingTeam] = useState('');
  const [bowlingTeam, setBowlingTeam] = useState('');
  const [runs, setRuns] = useState(0);
  const [wickets, setWickets] = useState(0);
  const [ballsCount, setBallsCount] = useState(0); // Total legal balls bowled
  const [target, setTarget] = useState(0);
  
  // Players Data States
  const [striker, setStriker] = useState({ name: '', runs: 0, balls: 0, fours: 0, sixes: 0 });
  const [nonStriker, setNonStriker] = useState({ name: '', runs: 0, balls: 0, fours: 0, sixes: 0 });
  const [currentBowler, setCurrentBowler] = useState({ name: '', overs: 0, ballsInOver: 0, runsConceded: 0, wickets: 0 });
  
  // Bowlers History List State
  const [bowlersStats, setBowlersStats] = useState([]);

  // History & Advanced Panels
  const [historyStack, setHistoryStack] = useState([]); // For Undo functionality
  const [recentBalls, setRecentBalls] = useState([]); // Last few balls ticker
  const [extrasBreakdown, setExtrasBreakdown] = useState({ wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 });
  const [currentPartnership, setCurrentPartnership] = useState({ runs: 0, balls: 0 });

  // Modals & Popups
  const [showNewBowlerModal, setShowNewBowlerModal] = useState(false);
  const [showInningsBreakModal, setShowInningsBreakModal] = useState(false);
  const [showMoreRunsModal, setShowMoreRunsModal] = useState(false);
  const [moreRunsInput, setMoreRunsInput] = useState({ scored: 0, penalty: 0 });
  
  // Winner Notification Modal State
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [winnerMessage, setWinnerMessage] = useState('');

  // Wicket Modal States
  const [showWicketModal, setShowWicketModal] = useState(false);
  const [pendingBallData, setPendingBallData] = useState(null);
  const [wicketDetails, setWicketDetails] = useState({
    howOut: 'bowled', // bowled, catch out, run out striker, run out non-striker, stumping, lbw, hit wicket
    didCross: 'no',   // yes / no
    helper: '',       // who helped?
    batterOut: 'striker', // striker or non striker
    newBatterName: ''
  });

  // Retire Modal States
  const [showRetireModal, setShowRetireModal] = useState(false);
  const [retireDetails, setRetireDetails] = useState({
    playerToRetire: 'striker', // striker or non-striker
    replacedBy: ''
  });
  
  // Extra checkboxes controller states
  const [extraType, setExtraType] = useState({ wide: false, noBall: false, bye: false, legBye: false, wicket: false, retire: false });

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // ---- ADDED: Match history & Super Over states ----
  const [ballLog, setBallLog] = useState([]);            // every ball / event of the whole match
  const [logLenStack, setLogLenStack] = useState([]);    // keeps history in sync with Undo
  const [historyMeta, setHistoryMeta] = useState({});    // toss, overs, result, super over results
  const [historyLoadedFor, setHistoryLoadedFor] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [soState, setSoState] = useState(null);          // Super Over state (null = none)
  const [showSuperOver, setShowSuperOver] = useState(false);
  const [finishing, setFinishing] = useState(false);   // Finish Match button state
  const [historySync, setHistorySync] = useState({ state: 'idle', at: null, error: '' }); // server sync status of the match history

  // ADDED: RESUME support (coming back to a running match)
  const [liveRestoredFor, setLiveRestoredFor] = useState('');   // live score loaded from the server for this match
  const [historyReadyFor, setHistoryReadyFor] = useState('');   // ball-by-ball history loaded for this match
  const resumeCheckedFor = useRef('');
  const liveMetaRef = useRef({});

  // Fetch tournaments
  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        const response = await API.get('/live-score/tournaments-with-schedules');
        setTournaments(response.data || []);
      } catch (error) {
        console.error('Error fetching tournaments:', error);
      }
    };
    fetchTournaments();
  }, []);

  // Handle URL param matchId
  useEffect(() => {
    if (paramMatchId && tournaments.length > 0) {
      for (let tourn of tournaments) {
        const foundMatch = tourn.schedules?.find(s => s._id === paramMatchId);
        if (foundMatch) {
          setSelectedCategory(tourn.category);
          setSelectedTournamentId(tourn._id);
          setSelectedMatchId(foundMatch._id);
          fetchLiveScoreData(foundMatch._id, foundMatch);
          fetchTeamPlayers(foundMatch.team1, foundMatch.team2);
          setShowPlayerSelectSection(true);
          break;
        }
      }
    }
  }, [paramMatchId, tournaments]);

  // Socket.io Client Setup for Real-time Synchronization
  useEffect(() => {
    if (!selectedMatchId) return;

    const socketUrl = API.defaults.baseURL ? API.defaults.baseURL.replace('/api', '') : window.location.origin;
    const socket = io(socketUrl);

    socket.emit('joinMatch', selectedMatchId);

    socket.on('liveScoreUpdated', (newData) => {
      if (newData && newData.matchId === selectedMatchId) {
        setMatchStarted(newData.matchStarted);
        setRuns(newData.runs || 0);
        setWickets(newData.wickets || 0);
        setBallsCount(newData.ballsCount || 0);
        setTarget(newData.target || 0);
        setInnings(newData.innings || '1st Innings');
        if (newData.battingTeam) setBattingTeam(newData.battingTeam);
        if (newData.bowlingTeam) setBowlingTeam(newData.bowlingTeam);
        if (newData.striker) setStriker(newData.striker);
        if (newData.nonStriker) setNonStriker(newData.nonStriker);
        if (newData.currentBowler) setCurrentBowler(newData.currentBowler);
        if (newData.bowlersStats) setBowlersStats(newData.bowlersStats);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedMatchId]);

  // ---- ADDED: load / save match history (kept per match in this browser) ----
  useEffect(() => {
    if (!selectedMatchId) {
      setBallLog([]);
      setHistoryMeta({});
      setSoState(null);
      setHistoryLoadedFor('');
      setHistoryReadyFor('');
      setLiveRestoredFor('');
      return;
    }
    setHistoryReadyFor('');
    let localLen = 0;
    try {
      const raw = localStorage.getItem(`cricketMatchHistory_${selectedMatchId}`);
      const saved = raw ? JSON.parse(raw) : null;
      localLen = saved && Array.isArray(saved.ballLog) ? saved.ballLog.length : 0;
      setBallLog(saved && Array.isArray(saved.ballLog) ? saved.ballLog : []);
      setHistoryMeta(saved && saved.meta ? saved.meta : {});
      setSoState(saved && saved.so ? saved.so : null);
    } catch (err) {
      setBallLog([]);
      setHistoryMeta({});
      setSoState(null);
    }
    setHistoryLoadedFor(selectedMatchId);

    // ADDED: also look at the copy saved on the server (other browser / cleared storage)
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get(`/live-score/${selectedMatchId}/history`);
        const srv = res.data || {};
        if (cancelled || !Array.isArray(srv.ballLog) || srv.ballLog.length <= localLen) return;
        setBallLog(srv.ballLog);
        setHistoryMeta(srv.meta || {});
        setSoState(srv.so || null);
      } catch (err) {
        console.error('Could not load match history from server:', err);
      } finally {
        if (!cancelled) setHistoryReadyFor(selectedMatchId);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedMatchId]);

  // ADDED: send the match history to the server (so the public/client pages can show it)
  const pushHistory = async (silent = true) => {
    if (!selectedMatchId || !selectedTournamentId) {
      if (!silent) alert('Please select a match first.');
      return;
    }
    if (!ballLog.length) {
      if (!silent) alert('There is no match history to upload yet.');
      return;
    }
    setHistorySync({ state: 'saving', at: null, error: '' });
    try {
      await API.post('/live-score/history', {
        tournamentId: selectedTournamentId,
        matchId: selectedMatchId,
        history: { ballLog, meta: historyMeta, so: soState }
      });
      setHistorySync({ state: 'ok', at: new Date(), error: '' });
      if (!silent) alert(`✅ Match history uploaded to the server (${ballLog.length} entries).`);
    } catch (err) {
      const status = err.response ? err.response.status : 0;
      const msg = status
        ? `Server replied ${status}${err.response.data && err.response.data.message ? `: ${err.response.data.message}` : ''}${status === 404 ? ' (the backend does not have the new /live-score/history route - replace the backend files and restart the server)' : ''}`
        : 'Could not reach the server.';
      console.error('Could not save match history to server:', err);
      setHistorySync({ state: 'error', at: null, error: msg });
      if (!silent) alert(`Could not upload the history.\n${msg}`);
    }
  };

  useEffect(() => {
    if (!selectedMatchId || !selectedTournamentId || historyLoadedFor !== selectedMatchId || ballLog.length === 0) return;
    const t = setTimeout(() => { pushHistory(true); }, 300); // faster so viewers see each ball almost instantly
    return () => clearTimeout(t);
  }, [ballLog, historyMeta, soState, selectedMatchId, selectedTournamentId, historyLoadedFor]);

  useEffect(() => {
    if (!selectedMatchId || historyLoadedFor !== selectedMatchId) return;
    try {
      localStorage.setItem(
        `cricketMatchHistory_${selectedMatchId}`,
        JSON.stringify({ ballLog, meta: historyMeta, so: soState })
      );
    } catch (err) {
      console.error('Could not save match history:', err);
    }
  }, [ballLog, historyMeta, soState, selectedMatchId, historyLoadedFor]);

  // remember the final result text when the result popup opens
  useEffect(() => {
    if (showWinnerModal && selectedMatchId) {
      setHistoryMeta(prev => ({ ...prev, result: winnerMessage }));
    }
  }, [showWinnerModal]);

  const catOf = (t) => (['franchise', 'league', 'group_wise'].includes(t?.category) ? t.category : (t?.format === 'group_wise' ? 'group_wise' : 'league'));
  const categories = [...new Set(tournaments.map(catOf))];
  const filteredTournaments = tournaments.filter(t => !selectedCategory || catOf(t) === selectedCategory);
  const activeTournament = tournaments.find(t => t._id === selectedTournamentId);
  const matchSchedules = activeTournament?.schedules || [];

  // Fetch players from correct backend route (/club/players) and filter flexibly
  const fetchTeamPlayers = async (team1Name, team2Name) => {
    try {
      const res = await API.get('/club/players');
      const allPlayers = res.data || [];

      // টিম ফিল্ড চেক করার প্রয়োজন নেই, তাই পুরো অল-প্লেয়ার্স লিস্টটিই 
      // উভয় টিমের সিলেকশনের জন্য উন্মুক্ত রাখা যেতে পারে, 
      // অথবা আইডি/নেম/ডিপার্টমেন্ট/ব্যাচ দিয়ে ফিল্টার করে নিতে পারেন।
      
      // উদাহরণস্বরূপ, প্লেয়ার অবজেক্টে id, name, dept, batch ভ্যালিড কিনা তা নিশ্চিত করা:
      const validPlayers = allPlayers.filter(p => {
        return p && (p.id || p._id) && p.name;
      });

      setAllPlayersPool(validPlayers);
      setShowPlayerSelectSection(true);
      
    } catch (error) {
      console.error('Error fetching players:', error);
    }
  };

  const handleMatchSelectionChange = (matchId) => {
    setSelectedMatchId(matchId);
    // FIX: clear the previous match's Playing XI so players never pile up across matches
    setSelectedTeam1Players([]);
    setSelectedTeam2Players([]);
    setTeam1SearchQuery('');
    setTeam2SearchQuery('');
    setFilterByTeam(true); // each team shows only its own players
    const match = matchSchedules.find(s => s._id === matchId);
    if (match) {
      setBattingTeam(match.team1 || '');
      setBowlingTeam(match.team2 || '');
      fetchLiveScoreData(matchId, match);
      fetchTeamPlayers(match.team1, match.team2);
      setShowPlayerSelectSection(true);
    }
  };

  const fetchLiveScoreData = async (matchId, matchObj = null) => {
    if (!matchId) return;
    setLiveRestoredFor('');
    resumeCheckedFor.current = '';
    try {
      setLoading(true);
      const match = matchObj || matchSchedules.find(s => s._id === matchId);
      if (match) {
        setBattingTeam(match.team1 || '');
        setBowlingTeam(match.team2 || '');
      }

      const response = await API.get(`/live-score/${matchId}`);
      if (response.data) {
        // ADDED: RESUME - put back everything that was only kept in the page's memory before
        {
          const d = response.data;
          liveMetaRef.current = { result: d.result || '', status: d.matchStatus || '' };
          if (d.matchStarted) {
            const t1 = Array.isArray(d.team1Squad) ? d.team1Squad.filter(Boolean) : [];
            const t2 = Array.isArray(d.team2Squad) ? d.team2Squad.filter(Boolean) : [];
            if (t1.length) setSelectedTeam1Players(t1);   // Playing XI -> player lists in all popups
            if (t2.length) setSelectedTeam2Players(t2);
            if (Number(d.oversLimit) > 0) setTotalOvers(Number(d.oversLimit));
            if (d.tossWinner) setTossWinner(d.tossWinner);
            if (d.tossDecision) setTossDecision(String(d.tossDecision).toLowerCase().startsWith('bowl') ? 'bowl' : 'bat');
            if (d.extras) {
              setExtrasBreakdown({
                wides: Number(d.extras.wides) || 0,
                noBalls: Number(d.extras.noBalls) || 0,
                byes: Number(d.extras.byes) || 0,
                legByes: Number(d.extras.legByes) || 0,
                penalty: Number(d.extras.penalty) || 0
              });
            }
          }
        }
        if (response.data.matchStarted) {
          setMatchStarted(true);
        }
        setRuns(response.data.runs || 0);
        setWickets(response.data.wickets || 0);
        setBallsCount(response.data.ballsCount || 0);
        setTarget(response.data.target || 0);
        setInnings(response.data.innings || '1st Innings');
        if (response.data.battingTeam) setBattingTeam(response.data.battingTeam);
        if (response.data.bowlingTeam) setBowlingTeam(response.data.bowlingTeam);
        if (response.data.striker && response.data.striker.name) setStriker(response.data.striker);
        if (response.data.nonStriker && response.data.nonStriker.name) setNonStriker(response.data.nonStriker);
        if (response.data.currentBowler && response.data.currentBowler.name) setCurrentBowler(response.data.currentBowler);
        if (response.data.bowlersStats) setBowlersStats(response.data.bowlersStats);
      }
    } catch (error) {
      console.error('Error fetching live score:', error);
    } finally {
      setLoading(false);
      setLiveRestoredFor(matchId);
    }
  };

  const formatOversCount = (totalBalls) => {
    const fullOvers = Math.floor(totalBalls / 6);
    const remainingBalls = totalBalls % 6;
    return `${fullOvers}.${remainingBalls}`;
  };

  const calculateCRR = () => {
    if (ballsCount === 0) return '0.00';
    return ((runs / ballsCount) * 6).toFixed(2);
  };

  const calculateRRR = () => {
    if (innings !== '2nd Innings' || target <= runs) return '0.00';
    const totalMatchBalls = totalOvers * 6;
    const remainingBalls = Math.max(0, totalMatchBalls - ballsCount);
    if (remainingBalls === 0) return '0.00';
    const runsNeeded = target - runs;
    return ((runsNeeded / remainingBalls) * 6).toFixed(2);
  };

  // Unique identifier generation combining name, dept, batch, id
  const getPlayerUniqueKey = (player) => {
    if (!player) return '';
    if (typeof player === 'string') return player;
    const name = (player.name || player.playerName || '').trim();
    const batch = (player.batch || '').trim();
    const dept = (player.dept || player.department || '').trim();
    const id = (player.id || player.studentId || player.playerId || '').trim();
    return `${name}_${dept}_${batch}_${id}`;
  };

  const updateBowlersStatsList = (bowlerObj) => {
    if (!bowlerObj.name) return;
    setBowlersStats(prev => {
      const objKey = getPlayerUniqueKey(bowlerObj);
      const existingIndex = prev.findIndex(b => {
        const bKey = getPlayerUniqueKey(b);
        return bKey === objKey || (b.name.toLowerCase() === bowlerObj.name.toLowerCase() && b.dept === bowlerObj.dept && b.batch === bowlerObj.batch && b.id === bowlerObj.id);
      });
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...bowlerObj };
        return updated;
      } else {
        return [...prev, { ...bowlerObj }];
      }
    });
  };

  const autoSaveToServer = async (customPayload = {}) => {
    if (!selectedMatchId || !selectedTournamentId) return;
    try {
      const payload = {
        tournamentId: selectedTournamentId,
        matchId: selectedMatchId,
        matchStarted,
        // ADDED: viewers need these too (before this they were reset on every save)
        oversLimit: totalOvers,
        tossWinner,
        tossDecision,
        extras: {
          ...extrasBreakdown,
          total: (extrasBreakdown.wides || 0) + (extrasBreakdown.noBalls || 0) + (extrasBreakdown.byes || 0) + (extrasBreakdown.legByes || 0) + (extrasBreakdown.penalty || 0)
        },
        battingTeam,
        bowlingTeam,
        runs,
        wickets,
        overs: formatOversCount(ballsCount),
        ballsCount,
        target,
        innings,
        striker,
        nonStriker,
        currentBowler,
        bowlersStats,
        matchStatus: matchStarted ? 'Ongoing' : 'Upcoming',
        ...customPayload
      };
      await API.post('/live-score/update', payload);
    } catch (error) {
      console.error('Auto-save sync error:', error);
    }
  };

  // FIX: viewers were one ball behind (admin 23/1, viewer 19-1) because autoSaveToServer() ran with the
  // OLD state from before the click. Re-save once React has rendered the new score.
  // Skipped after the result is out, so a Completed match is never set back to Ongoing.
  useEffect(() => {
    if (!matchStarted || !selectedMatchId || !selectedTournamentId || !ballsCount) return;
    if (winnerMessage || historyMeta.result || historyMeta.statsSynced) return;
    const t = setTimeout(() => { autoSaveToServer(); }, 250);
    return () => clearTimeout(t);
  }, [runs, wickets, ballsCount, striker, nonStriker, currentBowler, bowlersStats, extrasBreakdown, battingTeam, innings, target]);

  const handleStartMatchConfig = async (e) => {
    e.preventDefault();
    if (!striker.name || !nonStriker.name || !currentBowler.name) {
      alert('Please select Striker, Non-Striker, and Opening Bowler from dropdowns!');
      return;
    }
    if (selectedTeam1Players.length < 2 || selectedTeam2Players.length < 2) {
      alert('Select the Playing XI for BOTH teams first (at least 2 players each).');
      return;
    }
    if (selectedTeam1Players.some(k => selectedTeam2Players.includes(k))) {
      alert('The same player is selected in both teams. Fix the Playing XI first.');
      return;
    }
    if (!openingBatSquad.includes(getPlayerUniqueKey(striker)) || !openingBatSquad.includes(getPlayerUniqueKey(nonStriker))) {
      alert(`Striker and Non-Striker must be from ${tossBatTeam}'s Playing XI.`);
      return;
    }
    if (!openingBowlSquad.includes(getPlayerUniqueKey(currentBowler))) {
      alert(`Opening Bowler must be from ${tossBowlTeam}'s Playing XI.`);
      return;
    }
    
    let currentBatting = battingTeam;
    let currentBowling = bowlingTeam;

    if (tossWinner && tossDecision) {
      const activeMatch = matchSchedules.find(s => s._id === selectedMatchId);
      const t1 = activeMatch?.team1;
      const t2 = activeMatch?.team2;
      const otherTeam = tossWinner === t1 ? t2 : t1;

      if (tossDecision === 'bat') {
        currentBatting = tossWinner;
        currentBowling = otherTeam;
      } else {
        currentBatting = otherTeam;
        currentBowling = tossWinner;
      }
      setBattingTeam(currentBatting);
      setBowlingTeam(currentBowling);
    }

    setBowlersStats([]);
    // ADDED: fresh match -> fresh history
    {
      const m = matchSchedules.find(s => s._id === selectedMatchId);
      setBallLog([]);
      setSoState(null);
      setHistoryMeta({ tossWinner, tossDecision, totalOvers, playersPerTeam, team1: m?.team1 || '', team2: m?.team2 || '' });
    }
    setMatchStarted(true);

    await autoSaveToServer({
      matchStarted: true,
      battingTeam: currentBatting,
      bowlingTeam: currentBowling,
      matchStatus: 'Ongoing',
      selectedTeam1Players,
      selectedTeam2Players
    });

    setMessage('Match started & saved successfully!');
    setTimeout(() => setMessage(''), 3000);
  };

  // ---- ADDED: history logging helpers (do not change any scoring logic) ----
  const logMainBall = (runScored, ex, wk) => {
    const rec = buildBallRecord({
      innings, battingTeam, bowlingTeam,
      legalBefore: ballsCount,
      striker, nonStriker, bowler: currentBowler,
      runScored, ex, wk,
      runsBefore: runs, wicketsBefore: wickets
    });
    setBallLog(prev => [...prev, rec]);
  };

  const logMainEvent = (extra) => {
    setBallLog(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      innings, battingTeam, bowlingTeam,
      legalBefore: ballsCount,
      over: Math.floor(ballsCount / 6),
      ...extra
    }]);
  };

  const saveStateToHistory = () => {
    const currentState = {
      runs, wickets, ballsCount, 
      striker: { ...striker }, 
      nonStriker: { ...nonStriker }, 
      currentBowler: { ...currentBowler },
      bowlersStats: bowlersStats.map(b => ({ ...b })),
      innings, target, 
      recentBalls: [...recentBalls], 
      extrasBreakdown: { ...extrasBreakdown }
    };
    setHistoryStack(prev => [...prev, currentState]);
    setLogLenStack(prev => [...prev, { len: ballLog.length, matchId: selectedMatchId }]); // ADDED
  };

  const handleUndo = async () => {
    if (historyStack.length === 0) {
      alert('No action to undo!');
      return;
    }
    // ADDED: remove the undone ball(s) from the history as well
    const lastLog = logLenStack[logLenStack.length - 1];
    if (lastLog && lastLog.matchId === selectedMatchId) setBallLog(prev => prev.slice(0, lastLog.len));
    setLogLenStack(prev => prev.slice(0, prev.length - 1));

    const previousState = historyStack[historyStack.length - 1];
    setRuns(previousState.runs);
    setWickets(previousState.wickets);
    setBallsCount(previousState.ballsCount);
    setStriker(previousState.striker);
    setNonStriker(previousState.nonStriker);
    setCurrentBowler(previousState.currentBowler);
    if (previousState.bowlersStats) setBowlersStats(previousState.bowlersStats);
    setInnings(previousState.innings);
    setTarget(previousState.target);
    setRecentBalls(previousState.recentBalls);
    setExtrasBreakdown(previousState.extrasBreakdown);
    setHistoryStack(prev => prev.slice(0, prev.length - 1));

    await autoSaveToServer({
      runs: previousState.runs,
      wickets: previousState.wickets,
      ballsCount: previousState.ballsCount,
      overs: formatOversCount(previousState.ballsCount),
      striker: previousState.striker,
      nonStriker: previousState.nonStriker,
      currentBowler: previousState.currentBowler,
      bowlersStats: previousState.bowlersStats || [],
      innings: previousState.innings,
      target: previousState.target,
      matchStatus: 'Ongoing'
    });

    setMessage('Successfully reverted last action (Undo)!');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleSwapBatters = async () => {
    saveStateToHistory();
    const temp = striker;
    setStriker(nonStriker);
    setNonStriker(temp);

    await autoSaveToServer({ striker: nonStriker, nonStriker: temp });
    setMessage('Batters swapped successfully!');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleScoreBall = async (runScored) => {
    saveStateToHistory();

    if (extraType.wicket) {
      setPendingBallData({ runScored, extraType: { ...extraType } });
      setShowWicketModal(true);
      return;
    }

    logMainBall(runScored, extraType, null); // ADDED: history

    let runsToAdd = runScored;
    let isLegalBall = true;
    let extraRunsThisBall = 0;
    let ballDesc = String(runScored);

    let updatedStriker = { ...striker };
    let updatedNonStriker = { ...nonStriker };
    let updatedBowler = { ...currentBowler };

    if (extraType.wide) {
      extraRunsThisBall = 1 + runScored;
      runsToAdd = extraRunsThisBall;
      isLegalBall = false;
      ballDesc = runScored > 0 ? `${extraRunsThisBall}Wd` : 'Wd';
      
      setExtrasBreakdown(prev => ({ ...prev, wides: prev.wides + extraRunsThisBall }));

      if (runScored === 1 || runScored === 3 || runScored === 5) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (extraType.noBall) {
      extraRunsThisBall = 1 + runScored;
      runsToAdd = extraRunsThisBall;
      isLegalBall = false;
      ballDesc = runScored > 0 ? `${runScored}nb` : 'Nb';
      setExtrasBreakdown(prev => ({ ...prev, noBalls: prev.noBalls + 1 }));

      updatedStriker.runs += runScored;
      if (runScored === 4) updatedStriker.fours += 1;
      if (runScored === 6) updatedStriker.sixes += 1;

      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (extraType.bye) {
      extraRunsThisBall = runScored;
      runsToAdd = runScored;
      ballDesc = `${runScored}b`;
      setExtrasBreakdown(prev => ({ ...prev, byes: prev.byes + runScored }));
      
      updatedStriker.balls += 1;

      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (extraType.legBye) {
      extraRunsThisBall = runScored;
      runsToAdd = runScored;
      ballDesc = `${runScored}lb`;
      setExtrasBreakdown(prev => ({ ...prev, legByes: prev.legByes + runScored }));
      
      updatedStriker.balls += 1;
      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else {
      runsToAdd = runScored;
      ballDesc = String(runScored);

      updatedStriker.runs += runScored;
      updatedStriker.balls += 1;
      if (runScored === 4) updatedStriker.fours += 1;
      if (runScored === 6) updatedStriker.sixes += 1;

      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    }

    const newTotalRuns = runs + runsToAdd;
    setRuns(newTotalRuns);

    let newBallsCount = ballsCount;
    if (isLegalBall) {
      newBallsCount = ballsCount + 1;
      setBallsCount(newBallsCount);
      updatedBowler.ballsInOver += 1;
    }

    if (!extraType.bye) {
      updatedBowler.runsConceded += runsToAdd;
    }

    setStriker(updatedStriker);
    setNonStriker(updatedNonStriker);

    updateBowlersStatsList(updatedBowler);
    const updatedRecentBalls = [ballDesc, ...recentBalls.slice(0, 5)];
    setRecentBalls(updatedRecentBalls);

    if (updatedBowler.ballsInOver === 6) {
      updatedBowler.overs += 1;
      updatedBowler.ballsInOver = 0;
      setCurrentBowler(updatedBowler);
      updateBowlersStatsList(updatedBowler);
      
      const temp = updatedStriker;
      setStriker(updatedNonStriker);
      setNonStriker(temp);

      setShowNewBowlerModal(true);
    } else {
      setCurrentBowler(updatedBowler);
    }

    const maxTotalBalls = totalOvers * 6;
    let newInnings = innings;
    let newTarget = target;
    let isMatchFinished = false;
    let resultText = '';

    if (innings === '2nd Innings' && newTotalRuns >= target) {
      resultText = `${battingTeam} won the match by chasing the target! 🏆`;
      setWinnerMessage(resultText);
      setShowWinnerModal(true);
      setMatchStarted(false);
      isMatchFinished = true;
    } else if (newBallsCount >= maxTotalBalls) {
      if (innings === '1st Innings') {
        newTarget = newTotalRuns + 1;
        setTarget(newTarget);
        setShowInningsBreakModal(true);
      } else {
        if (newTotalRuns >= target) {
          resultText = `${battingTeam} won the match! 🏆`;
        } else if (newTotalRuns === target - 1) {
          resultText = `Match Tied! 🤝`;
        } else {
          resultText = `${bowlingTeam} won the match! 🏆`;
        }
        setWinnerMessage(resultText);
        setShowWinnerModal(true);
        setMatchStarted(false);
        isMatchFinished = true;
      }
    }

    await autoSaveToServer({
      runs: newTotalRuns,
      ballsCount: newBallsCount,
      overs: formatOversCount(newBallsCount),
      striker: updatedStriker,
      nonStriker: updatedNonStriker,
      currentBowler: updatedBowler,
      bowlersStats: bowlersStats.map(b => {
        const bKey = getPlayerUniqueKey(b);
        const bowlerKey = getPlayerUniqueKey(updatedBowler);
        return (bKey === bowlerKey || (b.name === updatedBowler.name && b.dept === updatedBowler.dept && b.batch === updatedBowler.batch && b.id === updatedBowler.id)) ? updatedBowler : b;
      }),
      target: newTarget,
      matchStatus: isMatchFinished ? 'Completed' : 'Ongoing',
      ...(isMatchFinished ? { result: resultText } : {})
    });

    setExtraType({ wide: false, noBall: false, bye: false, legBye: false, wicket: false, retire: false });
  };

  const handleWicketSubmit = async (e) => {
    e.preventDefault();
    if (!wicketDetails.newBatterName) {
      alert('Please select new batter name from dropdown!');
      return;
    }

    const runScored = pendingBallData ? pendingBallData.runScored : 0;
    const currentExtraType = pendingBallData ? pendingBallData.extraType : extraType;
    logMainBall(runScored, currentExtraType, wicketDetails); // ADDED: history

    let runsToAdd = runScored;
    let isLegalBall = true;
    let extraRunsThisBall = 0;
    let ballDesc = 'W';

    let updatedStriker = { ...striker };
    let updatedNonStriker = { ...nonStriker };
    let updatedBowler = { ...currentBowler };

    if (currentExtraType.wide) {
      extraRunsThisBall = 1 + runScored;
      runsToAdd = extraRunsThisBall;
      isLegalBall = false;
      ballDesc = runScored > 0 ? `${runScored}Wd+W` : 'Wd+W';
      setExtrasBreakdown(prev => ({ ...prev, wides: prev.wides + extraRunsThisBall }));

      if (runScored === 1 || runScored === 3 || runScored === 5) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (currentExtraType.noBall) {
      extraRunsThisBall = 1 + runScored;
      runsToAdd = extraRunsThisBall;
      isLegalBall = false;
      ballDesc = runScored > 0 ? `${runScored}nb+W` : 'Nb+W';
      setExtrasBreakdown(prev => ({ ...prev, noBalls: prev.noBalls + 1 }));

      updatedStriker.runs += runScored;
      if (runScored === 4) updatedStriker.fours += 1;
      if (runScored === 6) updatedStriker.sixes += 1;

      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (currentExtraType.bye) {
      extraRunsThisBall = runScored;
      runsToAdd = extraRunsThisBall;
      ballDesc = runScored > 0 ? `${runScored}b+W` : 'b+W';
      setExtrasBreakdown(prev => ({ ...prev, byes: prev.byes + runScored }));
      
      updatedStriker.balls += 1;
      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else if (currentExtraType.legBye) {
      extraRunsThisBall = runScored;
      runsToAdd = extraRunsThisBall;
      ballDesc = runScored > 0 ? `${runScored}lb+W` : 'lb+W';
      setExtrasBreakdown(prev => ({ ...prev, legByes: prev.legByes + runScored }));
      
      updatedStriker.balls += 1;
      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    } else {
      runsToAdd = runScored;
      ballDesc = runScored > 0 ? `${runScored}+W` : 'W';

      updatedStriker.runs += runScored;
      updatedStriker.balls += 1;
      if (runScored === 4) updatedStriker.fours += 1;
      if (runScored === 6) updatedStriker.sixes += 1;

      if (runScored % 2 !== 0) {
        const temp = updatedStriker;
        updatedStriker = updatedNonStriker;
        updatedNonStriker = temp;
      }
    }

    const newTotalRuns = runs + runsToAdd;
    const newTotalWickets = wickets + 1;
    setRuns(newTotalRuns);
    setWickets(newTotalWickets);

    let newBallsCount = ballsCount;
    if (isLegalBall) {
      newBallsCount = ballsCount + 1;
      setBallsCount(newBallsCount);
      updatedBowler.ballsInOver += 1;
    }

    if (!currentExtraType.bye) {
      updatedBowler.runsConceded += runsToAdd;
    }
    
    if (['bowled', 'catch out', 'stumping', 'lbw', 'hit wicket'].includes(wicketDetails.howOut)) {
      updatedBowler.wickets += 1;
    }

    setRecentBalls(prev => [ballDesc, ...prev.slice(0, 5)]);

    let currentStrikerRef = { ...updatedStriker };
    let currentNonStrikerRef = { ...updatedNonStriker };

    // FIX: Parse new batter correctly based on structure
    const parsePlayerObjectFromKey = (keyString) => {
      const [name, dept, batch, id] = keyString.split('_');
      return { 
        name: name || '', 
        dept: dept !== 'undefined' ? dept : '', 
        batch: batch !== 'undefined' ? batch : '', 
        id: id !== 'undefined' ? id : '', 
        runs: 0, 
        balls: 0, 
        fours: 0, 
        sixes: 0 
      };
    };

    if (wicketDetails.batterOut === 'striker') {
      currentStrikerRef = parsePlayerObjectFromKey(wicketDetails.newBatterName);
    } else {
      currentNonStrikerRef = parsePlayerObjectFromKey(wicketDetails.newBatterName);
    }

    if (wicketDetails.didCross === 'yes') {
      const temp = currentStrikerRef;
      currentStrikerRef = currentNonStrikerRef;
      currentNonStrikerRef = temp;
    }

    setStriker(currentStrikerRef);
    setNonStriker(currentNonStrikerRef);

    if (updatedBowler.ballsInOver === 6) {
      updatedBowler.overs += 1;
      updatedBowler.ballsInOver = 0;
      setCurrentBowler(updatedBowler);
      updateBowlersStatsList(updatedBowler);
      
      const temp = currentStrikerRef;
      setStriker(currentNonStrikerRef);
      setNonStriker(temp);

      setShowNewBowlerModal(true);
    } else {
      setCurrentBowler(updatedBowler);
      updateBowlersStatsList(updatedBowler);
    }

    setShowWicketModal(false);
    setPendingBallData(null);
    setWicketDetails({
      howOut: 'bowled',
      didCross: 'no',
      helper: '',
      batterOut: 'striker',
      newBatterName: ''
    });
    setExtraType({ wide: false, noBall: false, bye: false, legBye: false, wicket: false, retire: false });

    const maxTotalBalls = totalOvers * 6;
    let newTarget = target;
    let isMatchFinished = false;
    let resultText = '';

    if (innings === '2nd Innings' && newTotalRuns >= target) {
      resultText = `${battingTeam} won the match by chasing the target! 🏆`;
      setWinnerMessage(resultText);
      setShowWinnerModal(true);
      setMatchStarted(false);
      isMatchFinished = true;
    } else if (newBallsCount >= maxTotalBalls || newTotalWickets >= playersPerTeam - 1) {
      if (innings === '1st Innings') {
        newTarget = newTotalRuns + 1;
        setTarget(newTarget);
        setShowInningsBreakModal(true);
      } else {
        if (newTotalRuns >= target) {
          resultText = `${battingTeam} won the match! 🏆`;
        } else if (newTotalRuns === target - 1) {
          resultText = `Match Tied! 🤝`;
        } else {
          resultText = `${bowlingTeam} won the match! 🏆`;
        }
        setWinnerMessage(resultText);
        setShowWinnerModal(true);
        setMatchStarted(false);
        isMatchFinished = true;
      }
    }

    await autoSaveToServer({
      runs: newTotalRuns,
      wickets: newTotalWickets,
      ballsCount: newBallsCount,
      overs: formatOversCount(newBallsCount),
      striker: currentStrikerRef,
      nonStriker: currentNonStrikerRef,
      currentBowler: updatedBowler,
      target: newTarget,
      matchStatus: isMatchFinished ? 'Completed' : 'Ongoing',
      ...(isMatchFinished ? { result: resultText } : {})
    });
  };

  const handleRetireSubmit = async (e) => {
    e.preventDefault();
    if (!retireDetails.replacedBy) {
      alert('Please select replacement batter from dropdown!');
      return;
    }

    saveStateToHistory();
    const [rName, rDept, rBatch, rId] = retireDetails.replacedBy.split('_');
    const newBatterObj = { 
      name: rName || '', 
      dept: rDept !== 'undefined' ? rDept : '', 
      batch: rBatch !== 'undefined' ? rBatch : '', 
      id: rId !== 'undefined' ? rId : '', 
      runs: 0, 
      balls: 0, 
      fours: 0, 
      sixes: 0 
    };

    logMainEvent({ kind: 'retire', player: toPl(retireDetails.playerToRetire === 'striker' ? striker : nonStriker), replacedBy: toPl(newBatterObj) }); // ADDED: history

    let updatedStriker = striker;
    let updatedNonStriker = nonStriker;

    if (retireDetails.playerToRetire === 'striker') {
      updatedStriker = newBatterObj;
      setStriker(newBatterObj);
    } else {
      updatedNonStriker = newBatterObj;
      setNonStriker(newBatterObj);
    }

    setShowRetireModal(false);
    setRetireDetails({ playerToRetire: 'striker', replacedBy: '' });

    await autoSaveToServer({ striker: updatedStriker, nonStriker: updatedNonStriker });
    setMessage('Player retired and synced successfully!');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleMoreRunsSubmit = async (e) => {
    e.preventDefault();
    saveStateToHistory();
    const totalAdded = Number(moreRunsInput.scored) + Number(moreRunsInput.penalty);
    const newRuns = runs + totalAdded;
    const newPenalty = extrasBreakdown.penalty + Number(moreRunsInput.penalty);
    logMainEvent({ kind: 'adjust', runs: totalAdded, penalty: Number(moreRunsInput.penalty), scoreAfter: { runs: newRuns, wickets } }); // ADDED: history

    setRuns(newRuns);
    setExtrasBreakdown(prev => ({ ...prev, penalty: newPenalty }));
    setShowMoreRunsModal(false);
    setMoreRunsInput({ scored: 0, penalty: 0 });

    let isMatchFinished = false;
    let resultText = '';
    if (innings === '2nd Innings' && newRuns >= target) {
      resultText = `${battingTeam} won the match by chasing the target! 🏆`;
      setWinnerMessage(resultText);
      setShowWinnerModal(true);
      setMatchStarted(false);
      isMatchFinished = true;
    }

    await autoSaveToServer({ 
      runs: newRuns, 
      extrasBreakdown: { ...extrasBreakdown, penalty: newPenalty },
      matchStatus: isMatchFinished ? 'Completed' : 'Ongoing',
      ...(isMatchFinished ? { result: resultText } : {})
    });
    setMessage('More runs / penalty added & saved successfully!');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleBroadcastAPI = async () => {
    await autoSaveToServer();
    setMessage('Live score manually broadcasted & synced with server successfully!');
    setTimeout(() => setMessage(''), 4000);
  };

  const activeMatchObj = matchSchedules.find(s => s._id === selectedMatchId);
  const team1Name = activeMatchObj?.team1 || 'Team 1';
  const team2Name = activeMatchObj?.team2 || 'Team 2';

  // ADDED: each team gets its OWN candidate pool (players whose department/team matches the team name).
  // If nobody matches (e.g. franchise teams) or "Show all players" is ticked, the full list is used.
  const poolFor = (teamName) => {
    if (!filterByTeam || !teamName) return allPlayersPool;
    const t = String(teamName).trim().toLowerCase();
    // player.team wins when set; old players without a team fall back to department
    return allPlayersPool.filter(pl => {
      const own = String(pl.team || '').trim().toLowerCase();
      return own ? own === t : [pl.department, pl.dept].some(v => String(v || '').trim().toLowerCase() === t);
    });
  };
  const team1PlayersList = poolFor(team1Name);
  const team2PlayersList = poolFor(team2Name);

  const squadOfTeam = (t) => (t === team1Name ? selectedTeam1Players : selectedTeam2Players);
  // old matches without a saved XI fall back to everyone so a dropdown is never empty
  const hasSelectedXI = selectedTeam1Players.length + selectedTeam2Players.length > 0;
  const allSelectedPlayers = hasSelectedXI
    ? [...selectedTeam1Players, ...selectedTeam2Players]
    : allPlayersPool.map(getPlayerUniqueKey);
  const withFallback = (sq) => (sq.length ? sq : allSelectedPlayers);

  // batting side -> batters, bowling side -> bowlers / fielders
  const currentBattingSquad = withFallback(squadOfTeam(battingTeam));
  const currentBowlingSquad = withFallback(squadOfTeam(bowlingTeam));
  const notAtCrease = (k) => k !== getPlayerUniqueKey(striker) && k !== getPlayerUniqueKey(nonStriker);

  // Before the match starts: who bats / bowls first (decided by the toss)
  const tossBatTeam = (tossWinner && tossDecision)
    ? (tossDecision === 'bat' ? tossWinner : (tossWinner === team1Name ? team2Name : team1Name))
    : team1Name;
  const tossBowlTeam = tossBatTeam === team1Name ? team2Name : team1Name;
  const openingBatSquad = squadOfTeam(tossBatTeam);
  const openingBowlSquad = squadOfTeam(tossBowlTeam);


  // Helper function to format player display label (name, batch, dept, id) safely
  const getPlayerDisplayLabel = (player) => {
    if (!player) return '';
    if (typeof player === 'string') {
      const parts = player.split('_');
      if (parts.length >= 4) {
        const [name, dept, batch, id] = parts;
        const cleanDept = dept && dept !== 'undefined' ? `Dept: ${dept}` : '';
        const cleanBatch = batch && batch !== 'undefined' ? `Batch: ${batch}` : '';
        const cleanId = id && id !== 'undefined' ? `ID: ${id}` : '';
        const details = [cleanBatch, cleanDept, cleanId].filter(Boolean).join(' | ');
        return details ? `${name} (${details})` : name;
      }
      return player;
    }
    const name = player.name || player.playerName || 'Unknown';
    const batch = player.batch ? `Batch: ${player.batch}` : '';
    const dept = player.dept || player.department ? `Dept: ${player.dept || player.department}` : '';
    const id = player.id || player.studentId || player.playerId ? `ID: ${player.id || player.studentId || player.playerId}` : '';
    
    const details = [batch, dept, id].filter(Boolean).join(' | ');
    return details ? `${name} (${details})` : name;
  };

  // Filter players list based on search query for Team 1
  const filteredTeam1List = team1PlayersList.filter(player => {
    // FIX: Fallback to match individual fields if object or string formatting fails
    const nameStr = (player.name || player.playerName || (typeof player === 'string' ? player : '')).toLowerCase();
    const deptStr = (player.dept || player.department || '').toLowerCase();
    const batchStr = (player.batch || '').toLowerCase();
    const idStr = (player.id || player.studentId || player.playerId || '').toLowerCase();
    const query = team1SearchQuery.toLowerCase();
    return nameStr.includes(query) || deptStr.includes(query) || batchStr.includes(query) || idStr.includes(query);
  });

  // Filter players list based on search query for Team 2
  const filteredTeam2List = team2PlayersList.filter(player => {
    const nameStr = (player.name || player.playerName || (typeof player === 'string' ? player : '')).toLowerCase();
    const deptStr = (player.dept || player.department || '').toLowerCase();
    const batchStr = (player.batch || '').toLowerCase();
    const idStr = (player.id || player.studentId || player.playerId || '').toLowerCase();
    const query = team2SearchQuery.toLowerCase();
    return nameStr.includes(query) || deptStr.includes(query) || batchStr.includes(query) || idStr.includes(query);
  });

  // ---- ADDED: RESUME ----
  // Runs once after a match has been re-opened (live score + history both loaded).
  // It brings back the popup the admin was in the middle of when the page was closed.
  useEffect(() => {
    if (!selectedMatchId) return;
    if (liveRestoredFor !== selectedMatchId || historyReadyFor !== selectedMatchId) return;
    if (resumeCheckedFor.current === selectedMatchId) return;
    resumeCheckedFor.current = selectedMatchId;

    if (!matchStarted || liveMetaRef.current.result) return;   // not running (not started yet, or already finished)

    const ppt = Number(historyMeta.playersPerTeam) || playersPerTeam;
    if (Number(historyMeta.playersPerTeam) > 0) setPlayersPerTeam(Number(historyMeta.playersPerTeam));

    // "this over" ticker
    const innLog = ballLog.filter(e => e.innings === innings && e.kind === 'ball');
    if (innLog.length) setRecentBalls(innLog.slice(-6).reverse().map(e => e.desc || ''));

    const maxBalls = Number(totalOvers) * 6;
    if (innings === '1st Innings' && target > 0) {
      // 1st innings was over, the "Start 2nd Innings" popup was still open
      setShowInningsBreakModal(true);
    } else if (ballsCount > 0 && ballsCount % 6 === 0 && ballsCount < maxBalls && wickets < ppt - 1) {
      // an over just ended: if the last legal ball was bowled by the current bowler, the new bowler is not chosen yet
      const lastLegal = [...innLog].reverse().find(e => e.legal);
      if (lastLegal && lastLegal.bowler && lastLegal.bowler.key === getPlayerUniqueKey(currentBowler)) {
        setShowNewBowlerModal(true);
      }
    }

    setMessage('▶ Match resumed - you can continue scoring from where you left.');
    setTimeout(() => setMessage(''), 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRestoredFor, historyReadyFor, selectedMatchId]);

  // remember the last match that was opened here ...
  useEffect(() => {
    if (!selectedMatchId || !selectedTournamentId) return;
    try {
      localStorage.setItem('cricketLastMatch', JSON.stringify({ tournamentId: selectedTournamentId, matchId: selectedMatchId }));
    } catch (e) { /* ignore */ }
  }, [selectedMatchId, selectedTournamentId]);

  // ... and open it again by itself if it is still running (no need to pick category / tournament / match again)
  useEffect(() => {
    if (paramMatchId || selectedMatchId || tournaments.length === 0) return;
    try {
      const saved = JSON.parse(localStorage.getItem('cricketLastMatch') || 'null');
      if (!saved || !saved.matchId) return;
      const tourn = tournaments.find(t => t._id === saved.tournamentId);
      const m = tourn && tourn.schedules ? tourn.schedules.find(x => x._id === saved.matchId) : null;
      if (!m || m.status !== 'Ongoing') return;
      setSelectedCategory(tourn.category);
      setSelectedTournamentId(tourn._id);
      setSelectedMatchId(m._id);
      fetchLiveScoreData(m._id, m);
      fetchTeamPlayers(m.team1, m.team2);
      setShowPlayerSelectSection(true);
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournaments]);

  // ---- ADDED: Super Over control ----
  const canStartSuperOver = (historyMeta.result || '').includes('Tied') && (!soState || soState.phase === 'done');

  const startSuperOver = () => {
    // team that batted 2nd in the match bats first in the Super Over (alternates if tied again)
    const batFirst = soState ? soState.batSecond : battingTeam;
    const batSecond = soState ? soState.batFirst : bowlingTeam;
    setSoState({
      round: soState ? soState.round + 1 : 1,
      phase: 'setup1',
      batFirst, batSecond,
      scores: [null, null],
      tied: false,
      result: '',
      striker: null, nonStriker: null, bowler: null
    });
    setShowWinnerModal(false);
    setShowSuperOver(true);
  };

  const handleSuperOverSync = (extra) => autoSaveToServer(extra);

  // ---- ADDED: Finish match -> update every player's profile stats ----
  const canFinishMatch = !!(historyMeta.result || '') && !(historyMeta.result || '').includes('Tied') && !historyMeta.statsSynced;

  // Per-player totals for this match, built from the ball-by-ball history (Super Over is not counted in career stats)
  const buildPlayerStatsPayload = () => {
    const map = new Map();
    const ensure = (p) => {
      if (!p || !p.name) return null;
      const pp = toPl(p);
      if (!map.has(pp.key)) {
        map.set(pp.key, { id: pp.id, name: pp.name, dept: pp.dept, batch: pp.batch, batted: false, out: false, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, maidens: 0 });
      }
      return map.get(pp.key);
    };

    // everyone in the Playing XI gets a "match played"
    [...selectedTeam1Players, ...selectedTeam2Players].forEach(k => ensure(plFromKey(k)));

    const inningsNames = [];
    ballLog.forEach(e => {
      if (!String(e.innings).startsWith('Super Over') && !inningsNames.includes(e.innings)) inningsNames.push(e.innings);
    });

    inningsNames.forEach(name => {
      const d = buildInningsData(ballLog.filter(e => e.innings === name));
      d.batters.forEach(b => {
        const s = ensure(b);
        if (!s) return;
        s.batted = true;
        s.runs += b.runs;
        s.ballsFaced += b.balls;
        s.fours += b.fours;
        s.sixes += b.sixes;
        if (b.out) s.out = true;
      });
      d.bowlers.forEach(b => {
        const s = ensure(b);
        if (!s) return;
        s.wickets += b.wickets;
        s.ballsBowled += b.legal;
        s.runsConceded += b.runs;
        s.maidens += b.maidens;
      });
    });
    return [...map.values()];
  };

  const handleFinishMatch = async () => {
    if (!selectedMatchId || !selectedTournamentId) return;
    if (!ballLog.length) {
      alert('No ball-by-ball history found for this match, so player stats cannot be calculated.');
      return;
    }
    const players = buildPlayerStatsPayload();
    if (!window.confirm(`Finish the match and add this match's stats to ${players.length} player profile(s)?\nThis can be done only once per match.`)) return;

    setFinishing(true);
    try {
      const res = await API.post('/live-score/finish', {
        tournamentId: selectedTournamentId,
        matchId: selectedMatchId,
        result: historyMeta.result || '',
        players
      });
      const summary = res.data?.summary || {};
      setHistoryMeta(prev => ({ ...prev, statsSynced: true }));
      setShowWinnerModal(false);
      setMessage(`Match finished! Stats updated for ${summary.updatedCount ?? 0} player(s).`);
      setTimeout(() => setMessage(''), 6000);
      const problems = [
        ...(summary.notFound || []).map(p => `Not found: ${p.name} (${[p.batch, p.dept, p.id].filter(Boolean).join(' | ')})`),
        ...(summary.ambiguous || []).map(p => `Ambiguous (more than one match): ${p.name} (${[p.batch, p.dept, p.id].filter(Boolean).join(' | ')})`),
        ...(summary.failed || []).map(p => `Failed: ${p.name}`)
      ];
      if (problems.length) alert(`Some players could not be updated:\n\n${problems.join('\n')}`);
    } catch (err) {
      if (err.response?.status === 409) {
        setHistoryMeta(prev => ({ ...prev, statsSynced: true }));
        setShowWinnerModal(false);
        setMessage('Player stats were already updated for this match.');
        setTimeout(() => setMessage(''), 5000);
      } else {
        console.error('Finish match error:', err);
        alert(err.response?.data?.message || 'Could not update player stats. Please try again.');
      }
    } finally {
      setFinishing(false);
    }
  };

  const handleSuperOverFinish = async (message, tied, finalSo) => {
    setHistoryMeta(prev => ({
      ...prev,
      superOvers: [...(prev.superOvers || []), { round: finalSo.round, message, batFirst: finalSo.batFirst, batSecond: finalSo.batSecond, scores: finalSo.scores }]
    }));
    setWinnerMessage(message);
    setShowWinnerModal(true);
    await autoSaveToServer({
      result: message,
      matchStatus: tied ? 'Ongoing' : 'Completed',
      superOver: { round: finalSo.round, batFirst: finalSo.batFirst, batSecond: finalSo.batSecond, scores: finalSo.scores, tied, result: message }
    });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'Segoe UI, sans-serif' }}>
      <h2 style={{ color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
        🏏 Professional Live Match & Score Control Panel
      </h2>

      {message && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', margin: '15px 0', fontWeight: '600', textAlign: 'center' }}>
          {message}
        </div>
      )}

      {selectedMatchId && (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap', margin: '12px 0' }}>
          {canStartSuperOver && (
            <button type="button" onClick={startSuperOver} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              ⚡ Start Super Over
            </button>
          )}
          {soState && soState.phase !== 'done' && (
            <button type="button" onClick={() => setShowSuperOver(true)} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              ⚡ Resume Super Over
            </button>
          )}
          {ballLog.length > 0 && (
            <button
              type="button"
              onClick={() => pushHistory(false)}
              title={historySync.error || 'Upload the match history to the server so it shows on the public schedule pages'}
              style={{ padding: '8px 16px', background: historySync.state === 'ok' ? '#dcfce7' : historySync.state === 'error' ? '#fee2e2' : '#e0f2fe', color: historySync.state === 'ok' ? '#166534' : historySync.state === 'error' ? '#b91c1c' : '#075985', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {historySync.state === 'saving' ? '☁️ Syncing...' : historySync.state === 'ok' ? `☁️ Synced ${historySync.at.toLocaleTimeString()}` : historySync.state === 'error' ? '⚠️ Not synced - retry' : '☁️ Sync History'}
            </button>
          )}
          {canFinishMatch && (
            <button type="button" onClick={handleFinishMatch} disabled={finishing} style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: finishing ? 'not-allowed' : 'pointer' }}>
              {finishing ? 'Updating players...' : '✅ Finish Match & Update Player Stats'}
            </button>
          )}
          {historyMeta.statsSynced && (
            <span style={{ padding: '8px 12px', background: '#dcfce7', color: '#166534', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px' }}>
              ✔ Player stats updated
            </span>
          )}
          <button type="button" onClick={() => setShowHistoryModal(true)} style={{ padding: '8px 16px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
            📜 History
          </button>
        </div>
      )}

      <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
        
        {/* 3-Tier Selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '20px', background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div>
            <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px', color: '#334155' }}>Tournament Type:</label>
            <select
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setSelectedTournamentId(''); setSelectedMatchId(''); setShowPlayerSelectSection(false); }}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            >
              <option value="">-- All Types --</option>
              {categories.map((cat, idx) => (
                <option key={idx} value={cat}>{cat.replace('_', ' ').toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px', color: '#334155' }}>Tournament Name:</label>
            <select
              value={selectedTournamentId}
              onChange={(e) => { setSelectedTournamentId(e.target.value); setSelectedMatchId(''); setShowPlayerSelectSection(false); }}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            >
              <option value="">-- Select Tournament --</option>
              {filteredTournaments.map((tourn) => (
                <option key={tourn._id} value={tourn._id}>{tourn.tournamentName}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px', color: '#334155' }}>Select Match:</label>
            <select
              value={selectedMatchId}
              onChange={(e) => handleMatchSelectionChange(e.target.value)}
              disabled={!selectedTournamentId}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 'bold' }}
            >
              <option value="">-- Choose Match --</option>
              {matchSchedules.map((match) => (
                <option key={match._id} value={match._id}>
                  Match #{match.matchNumber}: {match.team1} vs {match.team2}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Player Selection Section with Search & Checkboxes for 2 Teams */}
        {selectedMatchId && showPlayerSelectSection && !matchStarted && (
          <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>👥 Select Playing XI for Both Teams (Search by Name, Batch, Dept, ID)</h3>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#475569' }}>
              <input type="checkbox" checked={filterByTeam} onChange={(e) => setFilterByTeam(e.target.checked)} />
              Only show each team's own players (untick to pick from all players)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              
              {/* Team 1 Player Selection */}
              <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#0284c7' }}>{team1Name} Playing XI ({selectedTeam1Players.length} selected)</h4>
                <input
                  type="text"
                  placeholder="🔍 Search Team 1 player (Name, Dept, Batch, ID)..."
                  value={team1SearchQuery}
                  onChange={(e) => setTeam1SearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                />
                <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {filteredTeam1List.length > 0 ? (
                    filteredTeam1List.map((player, idx) => {
                      const pKey = getPlayerUniqueKey(player);
                      const displayLabel = getPlayerDisplayLabel(player);
                      return (
                        <label key={idx} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={selectedTeam1Players.includes(pKey)}
                            disabled={selectedTeam2Players.includes(pKey)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (selectedTeam2Players.includes(pKey)) return;
                                setSelectedTeam1Players(selectedTeam1Players.includes(pKey) ? selectedTeam1Players : [...selectedTeam1Players, pKey]);
                              } else {
                                setSelectedTeam1Players(selectedTeam1Players.filter(k => k !== pKey));
                              }
                            }}
                          />
                          {displayLabel}{selectedTeam2Players.includes(pKey) ? ` — in ${team2Name}` : ''}
                        </label>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>No players found matching search.</span>
                  )}
                </div>
              </div>

              {/* Team 2 Player Selection */}
              <div style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#0284c7' }}>{team2Name} Playing XI ({selectedTeam2Players.length} selected)</h4>
                <input
                  type="text"
                  placeholder="🔍 Search Team 2 player (Name, Dept, Batch, ID)..."
                  value={team2SearchQuery}
                  onChange={(e) => setTeam2SearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                />
                <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {filteredTeam2List.length > 0 ? (
                    filteredTeam2List.map((player, idx) => {
                      const pKey = getPlayerUniqueKey(player);
                      const displayLabel = getPlayerDisplayLabel(player);
                      return (
                        <label key={idx} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={selectedTeam2Players.includes(pKey)}
                            disabled={selectedTeam1Players.includes(pKey)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (selectedTeam1Players.includes(pKey)) return;
                                setSelectedTeam2Players(selectedTeam2Players.includes(pKey) ? selectedTeam2Players : [...selectedTeam2Players, pKey]);
                              } else {
                                setSelectedTeam2Players(selectedTeam2Players.filter(k => k !== pKey));
                              }
                            }}
                          />
                          {displayLabel}{selectedTeam1Players.includes(pKey) ? ` — in ${team1Name}` : ''}
                        </label>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>No players found matching search.</span>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {selectedMatchId && !matchStarted && (
          <form onSubmit={handleStartMatchConfig} style={{ background: '#f1f5f9', padding: '20px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ color: '#0f172a', margin: '0 0 10px 0' }}>⚙️ Match Configuration & Toss Setup</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px' }}>Total Overs per Innings:</label>
                <input type="number" value={totalOvers} onChange={(e) => setTotalOvers(Number(e.target.value))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px' }}>Players per Team:</label>
                <input type="number" value={playersPerTeam} onChange={(e) => setPlayersPerTeam(Number(e.target.value))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px' }}>Toss Winner:</label>
                <select value={tossWinner} onChange={(e) => setTossWinner(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required>
                  <option value="">-- Select Toss Winner --</option>
                  <option value={team1Name}>{team1Name}</option>
                  <option value={team2Name}>{team2Name}</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: '600', fontSize: '12px', marginBottom: '5px' }}>Opted to:</label>
                <select value={tossDecision} onChange={(e) => setTossDecision(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <option value="bat">Batting First</option>
                  <option value="bowl">Bowling First</option>
                </select>
              </div>
            </div>

            <h4 style={{ margin: '10px 0 0 0', color: '#334155' }}>Opening Players Setup (Dropdowns with Name, Dept, Batch, ID):</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600' }}>Striker Batsman:</label>
                <select value={getPlayerUniqueKey(striker)} onChange={(e) => {
                  const pKey = e.target.value;
                  const [name, dept, batch, id] = pKey.split('_');
                  setStriker({ 
                    name: name || '', 
                    dept: dept !== 'undefined' ? dept : '', 
                    batch: batch !== 'undefined' ? batch : '', 
                    id: id !== 'undefined' ? id : '', 
                    runs: 0, 
                    balls: 0, 
                    fours: 0, 
                    sixes: 0 
                  });
                }} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required>
                  <option value="">-- Select Striker --</option>
                  {openingBatSquad.map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600' }}>Non-Striker:</label>
                <select value={getPlayerUniqueKey(nonStriker)} onChange={(e) => {
                  const pKey = e.target.value;
                  const [name, dept, batch, id] = pKey.split('_');
                  setNonStriker({ 
                    name: name || '', 
                    dept: dept !== 'undefined' ? dept : '', 
                    batch: batch !== 'undefined' ? batch : '', 
                    id: id !== 'undefined' ? id : '', 
                    runs: 0, 
                    balls: 0, 
                    fours: 0, 
                    sixes: 0 
                  });
                }} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required>
                  <option value="">-- Select Non-Striker --</option>
                  {openingBatSquad.filter(k => k !== getPlayerUniqueKey(striker)).map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600' }}>Opening Bowler:</label>
                <select value={getPlayerUniqueKey(currentBowler)} onChange={(e) => {
                  const pKey = e.target.value;
                  const [name, dept, batch, id] = pKey.split('_');
                  setCurrentBowler({ 
                    name: name || '', 
                    dept: dept !== 'undefined' ? dept : '', 
                    batch: batch !== 'undefined' ? batch : '', 
                    id: id !== 'undefined' ? id : '', 
                    overs: 0, 
                    ballsInOver: 0, 
                    runsConceded: 0, 
                    wickets: 0 
                  });
                }} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required>
                  <option value="">-- Select Opening Bowler --</option>
                  {openingBowlSquad.map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>
            </div>

            <button type="submit" style={{ padding: '12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
              🚀 Start Professional Match
            </button>
          </form>
        )}

        {selectedMatchId && matchStarted && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '15px', background: '#0f172a', color: '#fff', padding: '20px', borderRadius: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>{innings} ({battingTeam} vs {bowlingTeam})</div>
                <div style={{ fontSize: '36px', fontWeight: 'bold', margin: '5px 0' }}>
                  {runs}/{wickets} <span style={{ fontSize: '18px', color: '#cbd5e1' }}>({formatOversCount(ballsCount)} / {totalOvers} Ov)</span>
                </div>
                {innings === '2nd Innings' && (
                  <div style={{ fontSize: '14px', color: '#38bdf8', marginTop: '5px' }}>
                    Target: {target} | Need {Math.max(0, target - runs)} runs from {totalOvers * 6 - ballsCount} balls
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', borderLeft: '1px solid #334155', paddingLeft: '15px' }}>
                <div style={{ fontSize: '14px', color: '#94a3b8' }}>Current RR (CRR): <strong style={{ color: '#fff' }}>{calculateCRR()}</strong></div>
                {innings === '2nd Innings' && (
                  <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '5px' }}>Req RR (RRR): <strong style={{ color: '#facc15' }}>{calculateRRR()}</strong></div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '5px', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, color: '#334155' }}>🏏 Batters</h4>
                  <button
                    type="button"
                    onClick={handleSwapBatters}
                    style={{ padding: '4px 10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    🔄 Swap
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>
                  <span>* {getPlayerDisplayLabel(striker) || 'Striker'}</span>
                  <span>{striker.runs} ({striker.balls}) | 4s: {striker.fours} | 6s: {striker.sixes} | SR: {striker.balls > 0 ? ((striker.runs / striker.balls) * 100).toFixed(1) : '0.0'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b' }}>
                  <span>{getPlayerDisplayLabel(nonStriker) || 'Non-Striker'}</span>
                  <span>{nonStriker.runs} ({nonStriker.balls}) | 4s: {nonStriker.fours} | 6s: {nonStriker.sixes}</span>
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#334155', borderBottom: '1px solid #cbd5e1', paddingBottom: '5px' }}>🎯 Current Bowler</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold' }}>
                  <span>{getPlayerDisplayLabel(currentBowler) || 'Bowler'}</span>
                  <span>{currentBowler.overs}.{currentBowler.ballsInOver} Ov | {currentBowler.runsConceded} Runs | {currentBowler.wickets} Wkt</span>
                </div>
              </div>
            </div>

            {bowlersStats.length > 0 && (
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#334155', borderBottom: '1px solid #cbd5e1', paddingBottom: '5px' }}>📋 Bowlers Performance History</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#e2e8f0', textAlign: 'left', color: '#334155' }}>
                        <th style={{ padding: '6px' }}>Bowler Name</th>
                        <th style={{ padding: '6px' }}>Overs</th>
                        <th style={{ padding: '6px' }}>Runs</th>
                        <th style={{ padding: '6px' }}>Wickets</th>
                        <th style={{ padding: '6px' }}>Eco</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bowlersStats.map((b, idx) => {
                        const totalOversDec = b.overs + (b.ballsInOver / 6);
                        const eco = totalOversDec > 0 ? (b.runsConceded / totalOversDec).toFixed(2) : '0.00';
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #cbd5e1' }}>
                            <td style={{ padding: '6px', fontWeight: 'bold' }}>{getPlayerDisplayLabel(b)}</td>
                            <td style={{ padding: '6px' }}>{b.overs}.{b.ballsInOver}</td>
                            <td style={{ padding: '6px' }}>{b.runsConceded}</td>
                            <td style={{ padding: '6px' }}>{b.wickets}</td>
                            <td style={{ padding: '6px' }}>{eco}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ background: '#f1f5f9', padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Recent Balls:</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {recentBalls.map((b, idx) => (
                  <span key={idx} style={{ width: '28px', height: '28px', background: b.includes('W') ? '#ef4444' : b.includes('4') || b.includes('6') ? '#0284c7' : '#cbd5e1', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>
                    {b}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#334155' }}>🕹️ Match Controller Options</h4>
              <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '15px' }}>
                <label><input type="checkbox" checked={extraType.wide} onChange={(e) => setExtraType({ ...extraType, wide: e.target.checked })} /> Wide (+1)</label>
                <label><input type="checkbox" checked={extraType.noBall} onChange={(e) => setExtraType({ ...extraType, noBall: e.target.checked })} /> No Ball (+1)</label>
                <label><input type="checkbox" checked={extraType.bye} onChange={(e) => setExtraType({ ...extraType, bye: e.target.checked })} /> Bye</label>
                <label><input type="checkbox" checked={extraType.legBye} onChange={(e) => setExtraType({ ...extraType, legBye: e.target.checked })} /> Leg Bye</label>
                <label><input type="checkbox" checked={extraType.wicket} onChange={(e) => setExtraType({ ...extraType, wicket: e.target.checked })} style={{ accentColor: '#ef4444' }} /> <strong style={{ color: '#ef4444' }}>Wicket</strong></label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                <button type="button" onClick={handleUndo} style={{ padding: '8px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  ↩️ Undo (Back)
                </button>
                <button type="button" onClick={() => setShowRetireModal(true)} style={{ padding: '8px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  🚶‍♂️ Retire
                </button>
                <button type="button" onClick={() => alert(`Partnership: ${currentPartnership.runs} runs (${currentPartnership.balls} balls)`)} style={{ padding: '8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  🤝 Partnerships
                </button>
                <button type="button" onClick={() => alert(`Extras Breakdown -> Wides: ${extrasBreakdown.wides}, No-Balls: ${extrasBreakdown.noBalls}, Byes: ${extrasBreakdown.byes}, Leg Byes: ${extrasBreakdown.legByes}, Penalty: ${extrasBreakdown.penalty}`)} style={{ padding: '8px', background: '#475569', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  📊 Extras Info
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleScoreBall(r)}
                    style={{ padding: '10px 18px', background: r === 4 || r === 6 ? '#0284c7' : '#e2e8f0', color: r === 4 || r === 6 ? '#fff' : '#1e293b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowMoreRunsModal(true)}
                  style={{ padding: '10px 18px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
                >
                  More...
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBroadcastAPI}
              disabled={loading}
              style={{
                padding: '14px',
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '16px'
              }}
            >
              {loading ? 'Broadcasting...' : '🚀 Broadcast Live Score & Update Match'}
            </button>
          </div>
        )}

      </div>

      {showSuperOver && soState && (
        <SuperOverPanel
          so={soState}
          setSo={setSoState}
          squads={{ [team1Name]: selectedTeam1Players, [team2Name]: selectedTeam2Players }}
          allKeys={allSelectedPlayers}
          ballLog={ballLog}
          setBallLog={setBallLog}
          getLabel={getPlayerDisplayLabel}
          onSync={handleSuperOverSync}
          onFinish={handleSuperOverFinish}
          onNextRound={startSuperOver}
          onOpenHistory={() => setShowHistoryModal(true)}
          onClose={() => setShowSuperOver(false)}
        />
      )}

      {showHistoryModal && (
        <MatchHistoryModal
          log={ballLog}
          meta={historyMeta}
          team1={team1Name}
          team2={team2Name}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {showWinnerModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '12px', width: '450px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 10px 0', color: '#16a34a' }}>Match Result</h2>
            <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: '20px 0' }}>{winnerMessage}</p>
            {winnerMessage.includes('Tied') && (
              <button
                type="button"
                onClick={startSuperOver}
                style={{ width: '100%', padding: '12px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px', marginBottom: '10px' }}
              >
                ⚡ Start Super Over
              </button>
            )}
            {!winnerMessage.includes('Tied') && !historyMeta.statsSynced && (
              <button
                type="button"
                onClick={handleFinishMatch}
                disabled={finishing}
                style={{ width: '100%', padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: finishing ? 'not-allowed' : 'pointer', fontSize: '16px', marginBottom: '10px' }}
              >
                {finishing ? 'Updating players...' : '✅ Finish Match & Update Player Stats'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowWinnerModal(false)}
              style={{ width: '100%', padding: '12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' }}
            >
              Close / OK
            </button>
          </div>
        </div>
      )}

      {showWicketModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '450px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#ef4444' }}>⚠️ Wicket Fall Details</h3>
            <form onSubmit={handleWicketSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>How Wicket Fall?</label>
                <select
                  value={wicketDetails.howOut}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, howOut: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="bowled">Bowled</option>
                  <option value="catch out">Catch Out</option>
                  <option value="run out striker">Run Out Striker</option>
                  <option value="run out non-striker">Run Out Non-Striker</option>
                  <option value="stumping">Stumping</option>
                  <option value="lbw">LBW</option>
                  <option value="hit wicket">Hit Wicket</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Did batsmen crossed?</label>
                <select
                  value={wicketDetails.didCross}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, didCross: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Who helped? ( fielder/bowler name ):</label>
                <select
                  value={wicketDetails.helper}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, helper: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="">-- Select Fielder/Bowler --</option>
                  {currentBowlingSquad.map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Which batter out?</label>
                <select
                  value={wicketDetails.batterOut}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, batterOut: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="striker">Striker</option>
                  <option value="non striker">Non Striker</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>New Batter Name:</label>
                <select
                  value={wicketDetails.newBatterName}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, newBatterName: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  required
                >
                  <option value="">-- Select New Batter --</option>
                  {currentBattingSquad.filter(notAtCrease).map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>

              <button
                type="submit"
                style={{ width: '100%', padding: '10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}
              >
                Done / Confirm Wicket
              </button>
            </form>
          </div>
        </div>
      )}

      {showRetireModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#0284c7' }}>🚶‍♂️ Player Retire Setup</h3>
            <form onSubmit={handleRetireSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Select player to retire:</label>
                <select
                  value={retireDetails.playerToRetire}
                  onChange={(e) => setRetireDetails({ ...retireDetails, playerToRetire: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="striker">Striker ({getPlayerDisplayLabel(striker) || 'Striker'})</option>
                  <option value="non-striker">Non-Striker ({getPlayerDisplayLabel(nonStriker) || 'Non-Striker'})</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Replaced by?</label>
                <select
                  value={retireDetails.replacedBy}
                  onChange={(e) => setRetireDetails({ ...retireDetails, replacedBy: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  required
                >
                  <option value="">-- Select Replacement Batter --</option>
                  {currentBattingSquad.filter(notAtCrease).map((pKey, idx) => {
                    return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                  })}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowRetireModal(false)}
                  style={{ flex: 1, padding: '10px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: '10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Confirm Retire
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewBowlerModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3>Over Completed! Select New Bowler</h3>
            <select
              id="newBowlerDropdown"
              style={{ width: '100%', padding: '10px', margin: '15px 0', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            >
              <option value="">-- Select Bowler --</option>
              {currentBowlingSquad.map((pKey, idx) => {
                return <option key={idx} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
              })}
            </select>
            <button
              type="button"
              onClick={async () => {
                const pKey = document.getElementById('newBowlerDropdown').value;
                if (!pKey) return alert('Select bowler from dropdown!');
                
                if (currentBowler.name) {
                  updateBowlersStatsList(currentBowler);
                }

                const [name, dept, batch, id] = pKey.split('_');
                let newBowlerObj;
                const existingBowler = bowlersStats.find(b => {
                  const bKey = getPlayerUniqueKey(b);
                  return bKey === pKey || (b.name.toLowerCase() === name.toLowerCase() && b.dept === dept && b.batch === batch && b.id === id);
                });
                if (existingBowler) {
                  newBowlerObj = { ...existingBowler };
                } else {
                  newBowlerObj = { 
                    name: name || '', 
                    dept: dept !== 'undefined' ? dept : '', 
                    batch: batch !== 'undefined' ? batch : '', 
                    id: id !== 'undefined' ? id : '', 
                    overs: 0, 
                    ballsInOver: 0, 
                    runsConceded: 0, 
                    wickets: 0 
                  };
                }

                setCurrentBowler(newBowlerObj);
                setShowNewBowlerModal(false);

                await autoSaveToServer({ currentBowler: newBowlerObj });
              }}
              style={{ width: '100%', padding: '10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Done / Start Over
            </button>
          </div>
        </div>
      )}

      {showInningsBreakModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '450px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3>1st Innings Completed! 🏆</h3>
            <p style={{ margin: '10px 0', fontSize: '15px' }}>Target for {bowlingTeam}: <strong>{target}</strong></p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left', margin: '15px 0' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>2nd Innings Striker:</label>
              <select id="in2Striker" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <option value="">-- Select Striker --</option>
                {currentBowlingSquad.map((pKey, i) => {
                  return <option key={i} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                })}
              </select>

              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>2nd Innings Non-Striker:</label>
              <select id="in2NonStriker" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <option value="">-- Select Non-Striker --</option>
                {currentBowlingSquad.map((pKey, i) => {
                  return <option key={i} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                })}
              </select>

              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>2nd Innings Opening Bowler:</label>
              <select id="in2Bowler" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <option value="">-- Select Opening Bowler --</option>
                {currentBattingSquad.map((pKey, i) => {
                  return <option key={i} value={pKey}>{getPlayerDisplayLabel(pKey)}</option>;
                })}
              </select>
            </div>

            <button
              type="button"
              onClick={async () => {
                const sKey = document.getElementById('in2Striker').value;
                const nsKey = document.getElementById('in2NonStriker').value;
                const bKey = document.getElementById('in2Bowler').value;

                if (!sKey || !nsKey || !bKey) {
                  alert('Please select all players from dropdowns for 2nd innings!');
                  return;
                }

                const [sName, sDept, sBatch, sId] = sKey.split('_');
                const [nsName, nsDept, nsBatch, nsId] = nsKey.split('_');
                const [bName, bDept, bBatch, bId] = bKey.split('_');

                const newInnings = '2nd Innings';
                const tempTeam = battingTeam;
                const newBattingTeam = bowlingTeam;
                const newBowlingTeam = tempTeam;

                setInnings(newInnings);
                setBattingTeam(newBattingTeam);
                setBowlingTeam(newBowlingTeam);
                setRuns(0);
                setWickets(0);
                setBallsCount(0);
                setBowlersStats([]);

                const newStriker = { 
                  name: sName || '', 
                  dept: sDept !== 'undefined' ? sDept : '', 
                  batch: sBatch !== 'undefined' ? sBatch : '', 
                  id: sId !== 'undefined' ? sId : '', 
                  runs: 0, 
                  balls: 0, 
                  fours: 0, 
                  sixes: 0 
                };
                const newNonStriker = { 
                  name: nsName || '', 
                  dept: nsDept !== 'undefined' ? nsDept : '', 
                  batch: nsBatch !== 'undefined' ? nsBatch : '', 
                  id: nsId !== 'undefined' ? nsId : '', 
                  runs: 0, 
                  balls: 0, 
                  fours: 0, 
                  sixes: 0 
                };
                const newBowler = { 
                  name: bName || '', 
                  dept: bDept !== 'undefined' ? bDept : '', 
                  batch: bBatch !== 'undefined' ? bBatch : '', 
                  id: bId !== 'undefined' ? bId : '', 
                  overs: 0, 
                  ballsInOver: 0, 
                  runsConceded: 0, 
                  wickets: 0 
                };

                setStriker(newStriker);
                setNonStriker(newNonStriker);
                setCurrentBowler(newBowler);
                setShowInningsBreakModal(false);

                await autoSaveToServer({
                  innings: newInnings,
                  battingTeam: newBattingTeam,
                  bowlingTeam: newBowlingTeam,
                  runs: 0,
                  wickets: 0,
                  ballsCount: 0,
                  overs: '0.0',
                  striker: newStriker,
                  nonStriker: newNonStriker,
                  currentBowler: newBowler,
                  bowlersStats: []
                });
              }}
              style={{ width: '100%', padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}
            >
              Start 2nd Innings
            </button>
          </div>
        </div>
      )}

      {showMoreRunsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: '1000' }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', width: '400px' }}>
            <h3>Add Custom / Overthrow Runs</h3>
            <form onSubmit={handleMoreRunsSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Scored Runs (including overthrows):</label>
                <input type="number" value={moreRunsInput.scored} onChange={(e) => setMoreRunsInput({ ...moreRunsInput, scored: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Penalty Run Input:</label>
                <input type="number" value={moreRunsInput.penalty} onChange={(e) => setMoreRunsInput({ ...moreRunsInput, penalty: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} required />
              </div>
              <button type="submit" style={{ padding: '10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                OK / Add Runs
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

Object.assign(CLiveScoreControl, { displayName: 'CLiveScoreControl' });

export default CLiveScoreControl;