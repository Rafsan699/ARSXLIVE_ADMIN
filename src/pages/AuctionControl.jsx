import React, { useEffect, useMemo, useRef, useState } from 'react';
import API from '../services/capi';

/* Cricket auction - admin console.
   Same flow as the football auction admin (live console, one-tap bids, keyboard keys, player table),
   but in the cricket admin theme: navy #0c2145 / green #3ddc84 / gold #f5c542.
   All styles live in the CSS string below, so nothing else is needed. */

const STEPS = [5, 10, 25, 50];      // quick presets for the bid step (you can type any number)
const STEP_KEY = 'cric-auction-step';
const PAGE = 15;
const FILTERS = [['all', 'All'], ['available', 'Available'], ['live', 'Live'], ['sold', 'Sold'], ['unsold', 'Unsold']];
const money = (n) => (typeof n === 'number' ? n.toLocaleString() : n ?? '-');
const initials = (n = '') => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const errMsg = (e) => e.response?.data?.message || e.message;
const tourName = (t) => t?.tournamentName || t?.name || 'Tournament';
// every team a tournament already knows about (group teams + teams used in its fixtures)
const tourTeams = (t) => {
  const s = new Set();
  (t?.groups || []).forEach((g) => (g.teams || []).forEach((n) => s.add(n)));
  (t?.schedules || []).forEach((m) => { if (m.team1) s.add(m.team1); if (m.team2) s.add(m.team2); });
  return [...s];
};

const CSS = `
.cac{--bg:#0c2145;--bg2:#12294f;--line:#1c3566;--ink:#fff;--mut:#9fb3d6;--g:#3ddc84;--gold:#f5c542;--red:#ff6b6b;--deep:#06101f;max-width:1100px;margin:0 auto;padding:24px 16px 64px;display:grid;gap:18px;color:var(--ink);box-sizing:border-box}
.cac *,.cac *::before,.cac *::after{box-sizing:border-box}
.cac h1,.cac h2,.cac h3,.cac p,.cac dl,.cac dd,.cac dt{margin:0}
.cac-h1{font-family:'Barlow Condensed',sans-serif;font-size:44px;line-height:1;font-weight:700}
.cac-h2{font-family:'Barlow Condensed',sans-serif;font-size:24px;line-height:1.1;font-weight:700}
.cac-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px}
.cac-tag{display:inline-block;margin-left:10px;font-family:system-ui,sans-serif;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:rgba(61,220,132,.15);color:var(--g);vertical-align:middle}
.cac-stats{display:flex;flex-wrap:wrap;gap:8px}
.cac-stat{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:6px 14px}
.cac-stat dt{font-size:11px;color:var(--mut)}
.cac-stat dd{font-weight:700;font-size:16px;line-height:1.25}
.cac-toast{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:600;border:1px solid}
.cac-toast.ok{background:rgba(61,220,132,.12);color:#8af0b5;border-color:rgba(61,220,132,.4)}
.cac-toast.err{background:rgba(255,107,107,.12);color:#ffb3b3;border-color:rgba(255,107,107,.45)}
.cac-toast button{all:unset;cursor:pointer;font-size:20px;line-height:1;padding:0 4px}
.cac-card{background:var(--bg);border:1px solid var(--line);border-radius:16px;box-shadow:0 16px 40px -28px rgba(0,0,0,.8)}
.cac-pad{padding:18px 20px}
.cac-live{padding:20px}
.cac-live.on{background:linear-gradient(135deg,#0c2145,#0f3a52);border-color:rgba(61,220,132,.45);box-shadow:0 0 0 1px rgba(61,220,132,.25),0 24px 60px -24px rgba(0,0,0,.9)}
@media(min-width:1024px){.cac-live{position:sticky;top:10px;z-index:20}}
.cac-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.cac-between{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.cac-name{font-family:'Barlow Condensed',sans-serif;font-size:36px;line-height:1;font-weight:700}
.cac-sub{font-size:14px;color:var(--mut);margin-top:4px}
.cac-bidno{font-family:'Barlow Condensed',sans-serif;font-size:60px;line-height:1;font-weight:700;color:var(--g);text-align:right}
.cac-bidwho{font-size:13px;color:var(--mut);text-align:right}
.cac-step{font-size:13px;font-weight:600;color:var(--mut);margin:18px 0 8px}
.cac-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 18px;border-radius:10px;border:1px solid transparent;font:inherit;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap;transition:filter .15s,transform .05s}
.cac-btn:hover:not(:disabled){filter:brightness(1.1)}
.cac-btn:active:not(:disabled){transform:translateY(1px)}
.cac-btn:disabled{opacity:.4;cursor:not-allowed}
.cac-btn:focus-visible,.cac-chip:focus-visible,.cac-in:focus-visible,.cac-tab:focus-visible,.cac-pick:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.cac-btn.pri{background:var(--g);color:var(--deep)}
.cac-btn.gold{background:var(--gold);color:var(--deep)}
.cac-btn.ok{background:var(--g);color:var(--deep);height:48px;padding:0 24px}
.cac-btn.bad{background:rgba(255,107,107,.15);color:#ffb3b3;border-color:rgba(255,107,107,.55);height:48px;padding:0 24px}
.cac-btn.line{background:transparent;color:var(--ink);border-color:rgba(255,255,255,.35)}
.cac-btn.sm{height:34px;padding:0 12px;font-size:13px}
.cac-btn.dng{background:transparent;color:var(--red);border-color:rgba(255,107,107,.4)}
.cac-stepbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:18px}
.cac-stepbar label{font-size:13px;font-weight:700;color:var(--mut);margin-right:2px}
.cac-stepin{width:96px;font-weight:700}
.cac-tbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:8px}
.cac-tb{display:flex;align-items:center;gap:10px;min-height:70px;padding:8px 14px 8px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#fff;font:inherit;text-align:left;cursor:pointer;transition:background .12s,border-color .12s,transform .05s}
.cac-tb:hover:not(:disabled){background:rgba(61,220,132,.2);border-color:var(--g)}
.cac-tb:active:not(:disabled){transform:scale(.98)}
.cac-tb:disabled{opacity:.45;cursor:not-allowed}
.cac-tb:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.cac-tb.lead{opacity:1;border-color:var(--gold);background:rgba(245,197,66,.14)}
.cac-tb b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cac-tb small{display:block;font-size:11px;font-weight:600;color:var(--mut)}
.cac-tb.lead small{color:var(--gold)}
.cac-tb .amt{margin-left:auto;font-family:'Barlow Condensed',sans-serif;font-size:28px;line-height:1;font-weight:700;color:var(--g)}
.cac-tb.lead .amt{color:var(--gold);font-size:22px}
.cac-ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
.cac-btn.undo{max-width:100%}
.cac-kbd{padding:0 6px;border-radius:6px;border:1px solid currentColor;font-size:11px;font-weight:700;opacity:.7;line-height:18px}
.cac-chip{display:inline-flex;align-items:center;gap:8px;min-height:46px;padding:4px 14px 4px 8px;border-radius:12px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer;text-align:left}
.cac-chip:hover:not(:disabled){background:rgba(255,255,255,.16)}
.cac-chip:disabled{opacity:.4;cursor:not-allowed}
.cac-chip.on{background:var(--g);color:var(--deep);border-color:var(--g)}
.cac-chip small{display:block;font-size:11px;font-weight:600;opacity:.75}
.cac-num{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;background:rgba(255,255,255,.18);font-size:11px;font-weight:800;flex:none}
.cac-chip.on .cac-num{background:rgba(6,16,31,.2)}
.cac-lead{font-size:11px;padding:1px 6px;border-radius:6px;background:var(--gold);color:var(--deep);font-weight:800}
.cac-in{display:block;height:42px;width:100%;min-width:0;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--deep);color:#fff;font:inherit;font-size:14px}
.cac-in.w{width:140px}
.cac-or{font-size:13px;color:var(--mut)}
.cac-close{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.14)}
.cac-hint{font-size:12px;color:var(--mut);margin-left:auto}
.cac-hist{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;font-size:12px;color:var(--mut)}
.cac-hist span{padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.08)}
.cac-hist span:first-child{background:rgba(61,220,132,.18);color:var(--g);font-weight:700}
.cac-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
.cac-tabs{display:flex;gap:8px;overflow-x:auto}
.cac-tab{flex:none;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--mut);font:inherit;font-size:14px;font-weight:700;cursor:pointer}
.cac-tab:hover{background:rgba(255,255,255,.07)}
.cac-tab.on{background:var(--g);border-color:var(--g);color:var(--deep)}
.cac-tab small{font-size:12px;padding:0 6px;border-radius:6px;background:rgba(255,255,255,.12)}
.cac-tab.on small{background:rgba(6,16,31,.2)}
.cac-search{margin-left:auto;width:260px;max-width:100%}
.cac-scroll{overflow-x:auto}
.cac-table{width:100%;border-collapse:collapse;font-size:14px}
.cac-table th{text-align:left;font-size:12px;font-weight:600;color:var(--mut);padding:12px;border-bottom:1px solid var(--line);white-space:nowrap}
.cac-table td{padding:10px 12px;border-bottom:1px solid #15305c;vertical-align:middle}
.cac-table tr:last-child td{border-bottom:0}
.cac-table tr.live td{background:rgba(245,197,66,.1)}
.cac-table th:first-child,.cac-table td:first-child{padding-left:20px}
.cac-table th:last-child,.cac-table td:last-child{padding-right:20px}
.cac-who{display:flex;align-items:center;gap:12px;min-width:170px}
.cac-who b{display:block}
.cac-who span{display:block;font-size:12px;color:var(--mut)}
.cac-thumb{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--line)}
.cac-thumb.lg{width:68px;height:68px}
.cac-ini{display:grid;place-items:center;background:linear-gradient(135deg,#1c3566,#0f3a52);color:var(--g);font-size:13px;font-weight:800}
.cac-badge{display:inline-block;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;text-transform:capitalize}
.cac-badge.available{background:rgba(255,255,255,.1);color:#dbe6ff}
.cac-badge.live{background:rgba(255,107,107,.2);color:#ffb3b3}
.cac-badge.sold{background:rgba(61,220,132,.18);color:var(--g)}
.cac-badge.unsold{background:rgba(148,163,184,.2);color:#cbd5e1}
.cac-acts{display:flex;justify-content:flex-end;gap:6px}
.cac-none{padding:44px 20px;text-align:center;color:var(--mut)}
.cac-more{padding:14px;text-align:center;border-top:1px solid var(--line)}
.cac-fold{all:unset;box-sizing:border-box;width:100%;display:flex;justify-content:space-between;align-items:center;padding:16px 20px;cursor:pointer;color:#fff}
.cac-fold:focus-visible{outline:3px solid var(--gold);outline-offset:-3px;border-radius:16px}
.cac-fold span:last-child{font-size:14px;font-weight:700;color:var(--g)}
.cac-form{padding:4px 20px 20px;border-top:1px solid var(--line)}
.cac-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:14px}
.cac-grid label{display:block;min-width:0;font-size:13px;font-weight:600;color:var(--mut)}
.cac-grid label .cac-in{margin-top:6px}
.cac-note{font-size:12px;color:var(--mut)}
.cac-picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin-top:10px}
.cac-pick{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);background:var(--deep);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer;text-align:left}
.cac-pick:hover{border-color:var(--g)}
.cac-pick.on{border-color:var(--g);background:rgba(61,220,132,.12)}
.cac-pick small{display:block;font-size:11px;font-weight:600;color:var(--mut)}
.cac-box{width:20px;height:20px;border-radius:6px;border:2px solid var(--mut);flex:none;display:grid;place-items:center;font-size:13px;color:var(--deep)}
.cac-pick.on .cac-box{background:var(--g);border-color:var(--g)}
.cac-teams{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.cac-team{padding:14px 16px}
.cac-team.lead{border-color:var(--gold);box-shadow:0 0 0 1px rgba(245,197,66,.4)}
.cac-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.1);margin:10px 0 8px;overflow:hidden}
.cac-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--g),var(--gold))}
.cac-buys{margin-top:8px;font-size:12px;color:var(--mut);display:grid;gap:2px;max-height:110px;overflow:auto}
.cac-buys div{display:flex;justify-content:space-between;gap:8px}
.cac-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--mut);cursor:pointer}
.cac-check input{width:18px;height:18px;accent-color:var(--g)}
@media(max-width:640px){.cac-h1{font-size:36px}.cac-bidno{font-size:46px;text-align:left}.cac-bidwho{text-align:left}.cac-search{width:100%;margin-left:0}.cac-hint{margin-left:0}}
@media(prefers-reduced-motion:reduce){.cac-btn,.cac-tb{transition:none}}
`;

const Thumb = ({ p, lg }) => (p.image
  ? <img src={p.image} alt="" className={`cac-thumb ${lg ? 'lg' : ''}`} />
  : <span className={`cac-thumb cac-ini ${lg ? 'lg' : ''}`} aria-hidden="true">{initials(p.name)}</span>);
const Kbd = ({ children }) => <span className="cac-kbd">{children}</span>;

export default function AuctionControl() {
  const [a, setA] = useState(null);
  const [tours, setTours] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [registered, setRegistered] = useState([]);   // all registered players (pool preview)
  const [form, setForm] = useState({ name: '', tournamentId: '', budget: 1000, basePrice: 10, onlyUnassigned: false, shuffle: true });
  const [picked, setPicked] = useState([]);           // team names chosen for the auction
  const [showSetup, setShowSetup] = useState(false);
  const [step, setStep] = useState(() => { try { return localStorage.getItem(STEP_KEY) || '10'; } catch (e) { return '10'; } });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const seq = useRef(0);
  const busyRef = useRef(false);

  /* ---------- load ---------- */
  useEffect(() => {
    API.get('/auction').then((r) => setA(r.data || null)).catch((e) => setMsg({ err: errMsg(e) }));
    API.get('/tournaments').then((r) => setTours(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    API.get('/teams').then((r) => setAllTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    API.get('/club/players').then((r) => setRegistered(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  // keep in sync if another admin is also working (skips while an action is running)
  useEffect(() => {
    if (!a?._id) return undefined;
    const id = setInterval(() => {
      const s = seq.current;
      API.get(`/auction/${a._id}`).then((r) => { if (s === seq.current && !busyRef.current) setA(r.data); }).catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [a?._id]);
  useEffect(() => { if (msg?.ok) { const id = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(id); } return undefined; }, [msg]);
  useEffect(() => { setLimit(PAGE); }, [filter, q]);
  useEffect(() => { try { localStorage.setItem(STEP_KEY, step); } catch (e) { /* private mode: ignore */ } }, [step]);

  /* ---------- derived ---------- */
  const idx = a ? a.current.index : -1;
  const live = a && idx >= 0 ? a.players[idx] : null;
  const rows = useMemo(() => (a ? a.players.map((p, i) => ({ ...p, state: i === idx ? 'live' : p.status === 'pending' ? 'available' : p.status })) : []), [a, idx]);
  const left = (t) => t.budget - t.spent;
  const stepN = Math.floor(Number(step));
  const stepOk = stepN >= 1;
  // first bid is at the base price, every next tap adds the step on top of the highest bid
  const nextBid = live ? (a.current.bidder ? a.current.bid + (stepOk ? stepN : 0) : a.current.bid) : 0;
  const stats = {
    total: rows.length,
    available: rows.filter((p) => p.state === 'available').length,
    sold: rows.filter((p) => p.state === 'sold').length,
    unsold: rows.filter((p) => p.state === 'unsold').length,
    spent: a ? a.teams.reduce((s, t) => s + (t.spent || 0), 0) : 0,
  };
  const term = q.trim().toLowerCase();
  const count = (k) => (k === 'all' ? rows.length : rows.filter((p) => p.state === k).length);
  const filtered = rows.filter((p) => (filter === 'all' || p.state === filter) && (!term || p.name?.toLowerCase().includes(term)));
  const shown = filtered.slice(0, limit);

  const tour = tours.find((t) => t._id === form.tournamentId);
  const inTour = new Set(tourTeams(tour));
  const groupOf = (n) => (tour?.groups || []).find((g) => (g.teams || []).includes(n))?.name;
  const poolSize = registered.filter((p) => !form.onlyUnassigned || !p.team).length;

  /* ---------- actions ---------- */
  const act = async (path, body, ok) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); seq.current += 1;
    try {
      const r = await API.post(path, body || {});
      setA(r.data);
      setMsg(ok ? { ok: typeof ok === 'function' ? ok(r.data) : ok } : null);
      return true;
    } catch (e) { setMsg({ err: errMsg(e) }); return false; }
    finally { seq.current += 1; busyRef.current = false; setBusy(false); }
  };
  const on = (p) => `/auction/${a._id}/${p}`;

  const pickTournament = (id) => {
    const t = tours.find((x) => x._id === id);
    setForm((f) => ({ ...f, tournamentId: id }));
    setPicked(tourTeams(t).filter((n) => allTeams.some((x) => x.name === n)));
  };
  const toggleTeam = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const create = async () => {
    if (picked.length < 2) return setMsg({ err: 'Pick at least 2 teams.' });
    if (a && a.status !== 'Completed' && !window.confirm('The current auction is not finished. Create a new one anyway?')) return;
    const okay = await act('/auction/create', {
      name: form.name.trim() || (tour ? `${tourName(tour)} Auction` : 'Player Auction'),
      tournamentId: form.tournamentId, teamNames: picked,
      budget: Number(form.budget), basePrice: Number(form.basePrice),
      onlyUnassigned: form.onlyUnassigned, shuffle: form.shuffle,
    }, 'Auction created. Start the first player.');
    if (okay) setShowSetup(false);
  };

  // ONE tap on a team = one bid (highest bid + step)
  const bidFor = (t) => {
    if (!live || busyRef.current) return;
    if (!stepOk) return setMsg({ err: 'Set the bid step first (1 or more).' });
    if (a.current.bidder === t.name) return setMsg({ err: `${t.name} already has the highest bid.` });
    if (left(t) < nextBid) return setMsg({ err: `${t.name} has only ${money(left(t))} left.` });
    act(on('bid'), { team: t.name, amount: nextBid });
  };
  const undo = () => {
    if (!a || !a.undoCount || busyRef.current) return;
    const label = a.undoLabel;
    act(on('undo'), {}, `Undone: ${label}`);
  };
  const startNext = () => { if (stats.available) act(on('next'), {}, 'Next player is on the block'); };
  const sell = () => {
    if (!live) return;
    if (!a.current.bidder) return setMsg({ err: 'No bid yet. Tap a team to place a bid first.' });
    const who = a.current.bidder; const price = a.current.bid; const name = live.name;
    act(on('sold'), {}, (d) => (d.addedToTeams != null
      ? `${name} sold to ${who} for ${money(price)}. Auction complete: ${d.addedToTeams} players added to their teams.`
      : `${name} sold to ${who} for ${money(price)}`));
  };
  const pass = () => {
    if (!live) return;
    const name = live.name;
    act(on('unsold'), {}, (d) => (d.addedToTeams != null
      ? `${name} unsold. Auction complete: ${d.addedToTeams} players added to their teams.`
      : `${name} marked unsold`));
  };
  const endAuction = () => {
    if (!window.confirm(`End the auction now? ${stats.sold} sold players will be added to their teams.`)) return;
    act(on('finish'), {}, (d) => `Auction ended. ${d.addedToTeams} players added to their teams.`);
  };

  /* ---------- keyboard (ignored while typing) ---------- */
  const keyRef = useRef(null);
  keyRef.current = (ev) => {
    if (ev.altKey || ev.repeat || !a) return;
    const el = ev.target;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable) return;
    const k = ev.key.toUpperCase();
    if (k === 'Z') { ev.preventDefault(); return undo(); }   // Z or Ctrl+Z
    if (ev.ctrlKey || ev.metaKey) return;
    if (!live) { if (k === 'N') startNext(); return; }
    if (/^[1-9]$/.test(k)) { const t = a.teams[Number(k) - 1]; if (t) bidFor(t); }
    else if (k === 'S') sell();
    else if (k === 'U') pass();
  };
  useEffect(() => {
    const h = (ev) => keyRef.current && keyRef.current(ev);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const setupOpen = showSetup || !a;
  const undoBtn = a ? (
    <button onClick={undo} disabled={busy || !a.undoCount} className="cac-btn line undo" title={a.undoLabel ? `Take back: ${a.undoLabel}` : 'Nothing to undo'}>
      <span>↶ Undo</span>{a.undoLabel && <span className="cac-ell" style={{ fontWeight: 600, opacity: 0.8 }}>{a.undoLabel}</span>}<Kbd>Z</Kbd>
    </button>
  ) : null;

  return (
    <div className="cac">
      <style>{CSS}</style>

      {/* ---------- Title + stats ---------- */}
      <div className="cac-top">
        <h1 className="cac-h1">Auction Control{a && <span className="cac-tag">{a.status}</span>}</h1>
        {a && (
          <dl className="cac-stats">
            {[['Players', stats.total], ['Available', stats.available], ['Sold', stats.sold], ['Unsold', stats.unsold], ['Total spent', money(stats.spent)]].map(([l, v]) => (
              <div key={l} className="cac-stat"><dt>{l}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
      </div>

      <div aria-live="polite">
        {msg && (
          <div className={`cac-toast ${msg.err ? 'err' : 'ok'}`}>
            <span>{msg.err || msg.ok}</span>
            <button onClick={() => setMsg(null)} aria-label="Dismiss">×</button>
          </div>
        )}
      </div>

      {/* ---------- New auction (tournament -> teams) ---------- */}
      <section className="cac-card" aria-label="New auction">
        <button className="cac-fold" aria-expanded={setupOpen} onClick={() => setShowSetup(!showSetup)} disabled={!a}>
          <span className="cac-h2">{a ? 'New auction' : 'Create the auction'}</span>
          {a && <span>{setupOpen ? 'Hide' : 'Show form'}</span>}
        </button>
        {setupOpen && (
          <div className="cac-form">
            <div className="cac-grid">
              <label>Tournament
                <select className="cac-in" value={form.tournamentId} onChange={(e) => pickTournament(e.target.value)}>
                  <option value="">None (pick teams by hand)</option>
                  {tours.map((t) => <option key={t._id} value={t._id}>{tourName(t)}</option>)}
                </select>
              </label>
              <label>Auction name<input className="cac-in" value={form.name} placeholder={tour ? `${tourName(tour)} Auction` : 'Player Auction'} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Budget per team<input className="cac-in" type="number" min="1" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></label>
              <label>Base price<input className="cac-in" type="number" min="1" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} /></label>
            </div>

            <div className="cac-between" style={{ marginTop: 18 }}>
              <p className="cac-step" style={{ margin: 0 }}>
                Teams in this auction ({picked.length} picked{tour?.teamsCount ? `, tournament expects ${tour.teamsCount}` : ''})
              </p>
              <div className="cac-row">
                {tour && inTour.size > 0 && <button type="button" className="cac-btn line sm" onClick={() => setPicked(tourTeams(tour).filter((n) => allTeams.some((x) => x.name === n)))}>Tournament teams</button>}
                <button type="button" className="cac-btn line sm" onClick={() => setPicked(allTeams.map((t) => t.name))}>All</button>
                <button type="button" className="cac-btn line sm" onClick={() => setPicked([])}>Clear</button>
              </div>
            </div>
            <div className="cac-picks">
              {allTeams.map((t) => {
                const onx = picked.includes(t.name);
                const grp = groupOf(t.name);
                return (
                  <button type="button" key={t._id} className={`cac-pick ${onx ? 'on' : ''}`} aria-pressed={onx} onClick={() => toggleTeam(t.name)}>
                    <span className="cac-box" aria-hidden="true">{onx ? '✓' : ''}</span>
                    <span style={{ minWidth: 0 }}>
                      {t.name}
                      <small>{(t.players || []).length} players{inTour.has(t.name) ? `, in tournament${grp ? ` (${grp})` : ''}` : ''}</small>
                    </span>
                  </button>
                );
              })}
              {allTeams.length === 0 && <p className="cac-note">No teams yet. Add teams first (Teams &amp; Players page).</p>}
            </div>

            <div className="cac-row" style={{ marginTop: 16, gap: 18 }}>
              <label className="cac-check"><input type="checkbox" checked={form.onlyUnassigned} onChange={(e) => setForm({ ...form, onlyUnassigned: e.target.checked })} />Only players without a team</label>
              <label className="cac-check"><input type="checkbox" checked={form.shuffle} onChange={(e) => setForm({ ...form, shuffle: e.target.checked })} />Random order</label>
            </div>
            <div className="cac-row" style={{ marginTop: 16, gap: 12 }}>
              <button className="cac-btn pri" disabled={busy || picked.length < 2 || poolSize === 0} onClick={create}>Create auction</button>
              <p className="cac-note">{poolSize} players will go into the pool. When the auction ends, every sold player is added to the team that bought him.</p>
            </div>
          </div>
        )}
      </section>

      {a && (<>
        {/* ---------- Live console ---------- */}
        <section aria-label="On the block" className={`cac-card cac-live ${live ? 'on' : ''}`}>
          {!live ? (
            <div className="cac-between">
              <div>
                <h2 className="cac-h2">{a.status === 'Completed' ? 'Auction completed' : 'No player on the block'}</h2>
                <p className="cac-note" style={{ marginTop: 4 }}>
                  {a.status === 'Completed'
                    ? (a.squadsApplied ? `${stats.sold} sold players are now in their teams.` : 'Squads are not saved yet.')
                    : 'Start the next player, or press Start on any player in the list.'}
                </p>
              </div>
              <div className="cac-row">
                {undoBtn}
                <button onClick={startNext} disabled={busy || !stats.available} className="cac-btn pri" style={{ height: 48, padding: '0 24px' }}>
                  Next player <Kbd>N</Kbd>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="cac-between">
                <div className="cac-row" style={{ gap: 16, minWidth: 0 }}>
                  <Thumb p={live} lg />
                  <div style={{ minWidth: 0 }}>
                    <div className="cac-name">{live.name}</div>
                    <p className="cac-sub">{[live.dept, live.batch && `Batch ${live.batch}`, `Base ${money(live.basePrice)}`].filter(Boolean).join(', ')}</p>
                  </div>
                </div>
                <div>
                  <p className="cac-bidwho">{a.current.bidder ? `Highest bid by ${a.current.bidder}` : 'No bids yet'}</p>
                  <p className="cac-bidno">{money(a.current.bid)}</p>
                </div>
              </div>

              <div className="cac-stepbar">
                <label htmlFor="cac-step">Bid step</label>
                <input id="cac-step" type="number" min="1" inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} className="cac-in cac-stepin" aria-describedby="cac-step-note" />
                {STEPS.map((n) => (
                  <button type="button" key={n} onClick={() => setStep(String(n))} className={`cac-btn sm ${stepN === n ? 'gold' : 'line'}`}>{n}</button>
                ))}
                <span id="cac-step-note" className="cac-note">Each tap on a team raises the bid by this amount.</span>
                <span style={{ marginLeft: 'auto' }}>{undoBtn}</span>
              </div>

              <p className="cac-step">{a.current.bidder ? 'Tap a team to outbid' : `Tap a team to bid the base price (${money(a.current.bid)})`}</p>
              <div className="cac-tbs" role="group" aria-label="Bid for a team">
                {a.teams.map((t, i) => {
                  const lead = a.current.bidder === t.name;
                  const cant = left(t) < nextBid;
                  return (
                    <button key={t.name} className={`cac-tb ${lead ? 'lead' : ''}`} disabled={busy || lead || cant || !stepOk} onClick={() => bidFor(t)}
                      title={lead ? 'Highest bidder' : cant ? 'Not enough budget' : `Bid ${money(nextBid)} for ${t.name}`}>
                      {i < 9 && <span className="cac-num">{i + 1}</span>}
                      <span style={{ minWidth: 0 }}>
                        <b>{t.name}</b>
                        <small>{lead ? 'Highest bidder' : cant ? `Only ${money(left(t))} left` : `Left ${money(left(t))}`}</small>
                      </span>
                      <span className="amt">{lead ? '✓' : money(nextBid)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="cac-close">
                <button onClick={sell} disabled={busy || !a.current.bidder} className="cac-btn ok">
                  Sold{a.current.bidder ? ` to ${a.current.bidder}` : ''} <Kbd>S</Kbd>
                </button>
                <button onClick={pass} disabled={busy} className="cac-btn bad">Unsold <Kbd>U</Kbd></button>
                <p className="cac-hint">Keys: 1-9 team bids, S sold, U unsold, Z undo. Every action can be undone.</p>
              </div>
            </>
          )}

          {a.undoLabels && a.undoLabels.length > 0 && (
            <>
              <p className="cac-note" style={{ marginTop: 16 }}>Recent actions (Undo takes back the first one):</p>
              <div className="cac-hist" style={{ marginTop: 6 }} aria-label="Recent actions">
                {a.undoLabels.map((l, i) => <span key={`${i}-${l}`}>{l}</span>)}
              </div>
            </>
          )}
        </section>

        {/* ---------- Teams ---------- */}
        <section aria-label="Teams" className="cac-teams">
          {a.teams.map((t) => {
            const bought = rows.filter((p) => p.state === 'sold' && p.soldTo === t.name);
            return (
              <div key={t.name} className={`cac-card cac-team ${a.current.bidder === t.name ? 'lead' : ''}`}>
                <div className="cac-between" style={{ gap: 8 }}>
                  <b>{t.name}</b>
                  <span className="cac-note">{bought.length} bought</span>
                </div>
                <div className="cac-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (t.spent / (t.budget || 1)) * 100)}%` }} /></div>
                <div className="cac-note">Left <b style={{ color: '#fff' }}>{money(left(t))}</b> / {money(t.budget)}</div>
                {bought.length > 0 && <div className="cac-buys">{bought.map((p) => <div key={p.playerId}><span>{p.name}</span><span>{money(p.soldPrice)}</span></div>)}</div>}
              </div>
            );
          })}
        </section>

        {/* ---------- Player list ---------- */}
        <section className="cac-card" aria-label="Players" style={{ overflow: 'hidden' }}>
          <div className="cac-head">
            <div className="cac-tabs" role="tablist" aria-label="Player status">
              {FILTERS.map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`cac-tab ${filter === k ? 'on' : ''}`}>{l}<small>{count(k)}</small></button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by player name" aria-label="Search players" className="cac-in cac-search" />
          </div>
          <div className="cac-scroll">
            <table className="cac-table">
              <thead><tr><th>Player</th><th>Base</th><th>Status</th><th>Sold to</th><th>Price</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.playerId} className={p.state === 'live' ? 'live' : ''}>
                    <td><div className="cac-who"><Thumb p={p} /><div><b>{p.name}</b><span>{[p.dept, p.batch && `Batch ${p.batch}`].filter(Boolean).join(', ')}</span></div></div></td>
                    <td>{money(p.basePrice)}</td>
                    <td><span className={`cac-badge ${p.state}`}>{p.state}</span></td>
                    <td>{p.soldTo || '-'}</td>
                    <td><b>{p.soldPrice ? money(p.soldPrice) : '-'}</b></td>
                    <td>
                      <div className="cac-acts">
                        {(p.state === 'available' || p.state === 'unsold') && (
                          <button onClick={() => act(on(`start/${p.playerId}`), {}, `${p.name} is on the block`)} disabled={busy || !!live} title={live ? 'Finish the live player first' : undefined} className="cac-btn pri sm">Start</button>
                        )}
                        {(p.state === 'sold' || p.state === 'unsold') && (
                          <button onClick={() => (p.state === 'unsold' || window.confirm(`Reset the sale of ${p.name}? ${p.soldTo} gets ${money(p.soldPrice)} back.`)) && act(on(`reset/${p.playerId}`), {}, p.state === 'sold' ? `${p.name} reset` : `${p.name} is available again`)} disabled={busy} className="cac-btn line sm">{p.state === 'sold' ? 'Reset' : 'Make available'}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="6" className="cac-none">{rows.length === 0 ? 'No players in this auction.' : 'No player matches this filter.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.length > shown.length && (
            <div className="cac-more"><button className="cac-btn line sm" onClick={() => setLimit(limit + PAGE)}>Show more ({filtered.length - shown.length} left)</button></div>
          )}
        </section>

        {/* ---------- End auction ---------- */}
        <section className="cac-card cac-pad" aria-label="End auction">
          <div className="cac-between">
            <div>
              <h2 className="cac-h2">End auction</h2>
              <p className="cac-note" style={{ marginTop: 4 }}>
                {a.squadsApplied && a.status === 'Completed'
                  ? `Done. ${stats.sold} sold players were added to their teams.`
                  : 'The auction closes by itself when no player is left. You can also end it now: every sold player is added to the team that bought him.'}
              </p>
            </div>
            <button onClick={endAuction} disabled={busy || !!live || a.status === 'Completed'} className="cac-btn gold">End &amp; add players to teams</button>
          </div>
        </section>
      </>)}
    </div>
  );
}