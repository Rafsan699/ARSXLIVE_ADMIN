import React, { useEffect, useState } from 'react';
import API from '../services/capi';

const box = { background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,.08)' };
const inp = { padding: 9, borderRadius: 6, border: '1px solid #cbd5e1', marginRight: 8, marginBottom: 8 };
const btn = (c = '#2563eb') => ({ padding: '9px 16px', background: c, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', marginRight: 8 });
const empty = { name: '', id: '', dept: '', batch: '' };
const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };
const toForm = (obj, file, field) => {
  const fd = new FormData();
  Object.entries(obj).forEach(([k, v]) => fd.append(k, v ?? ''));
  if (file) fd.append(field, file); // the server uploads it to Cloudinary
  return fd;
};
const pickImage = (e, set, setMsg) => {
  const f = e.target.files && e.target.files[0];
  if (!f) { set(null); return; }
  if (!f.type.startsWith('image/')) { setMsg('Please choose an image file.'); e.target.value = ''; return; }
  if (f.size > 3 * 1024 * 1024) { setMsg('Image must be under 3MB.'); e.target.value = ''; return; }
  set(f);
};
const thumb = (round = true) => ({ width: 34, height: 34, borderRadius: round ? '50%' : 6, objectFit: 'cover', border: '1px solid #cbd5e1', background: '#f1f5f9' });

export default function TeamPlayerManage() {
  const [teams, setTeams] = useState([]);
  const [sel, setSel] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [p, setP] = useState(empty);
  const [bulk, setBulk] = useState('');
  const [msg, setMsg] = useState('');
  const [teamLogo, setTeamLogo] = useState(null);
  const [playerImg, setPlayerImg] = useState(null);
  const [fileKey, setFileKey] = useState(0); // resets the file inputs after saving

  const load = async (keep) => {
    const r = await API.get('/teams');
    setTeams(r.data);
    const id = keep || (sel && sel._id);
    setSel(r.data.find((t) => t._id === id) || null);
  };
  useEffect(() => { load().catch(() => setMsg('Could not load teams (is the server running?)')); }, []);

  const run = async (fn, keep) => {
    try { setMsg(''); await fn(); await load(keep); } catch (e) { setMsg(e.response?.data?.message || e.message); }
  };
  const addTeam = () => run(async () => { const r = await API.post('/teams', toForm({ name: teamName }, teamLogo, 'logo'), cfg); setTeamName(''); setTeamLogo(null); setFileKey((k) => k + 1); setSel({ _id: r.data._id }); }, undefined)
    .then(() => API.get('/teams').then((r) => setSel(r.data.find((t) => t.name === teamName.trim()) || null)));
  const delTeam = (t) => window.confirm(`Delete ${t.name}? Players stay but become unassigned.`) && run(() => API.delete(`/teams/${t._id}`), null);
  const addPlayer = () => run(async () => { await API.post('/club/players', toForm({ ...p, team: sel.name }, playerImg, 'image'), cfg); setP(empty); setPlayerImg(null); setFileKey((k) => k + 1); }, sel._id);
  const changeTeamLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f || !sel) return;
    if (!f.type.startsWith('image/') || f.size > 3 * 1024 * 1024) { setMsg('Choose an image under 3MB.'); return; }
    run(() => API.put(`/teams/${sel._id}`, toForm({ name: sel.name }, f, 'logo'), cfg), sel._id);
  };
  const changePlayerImg = (pl, e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/') || f.size > 3 * 1024 * 1024) { setMsg('Choose an image under 3MB.'); return; }
    // the update route rewrites every field, so send them all along with the new photo
    run(() => API.put(`/club/players/${pl._id}`, toForm({ name: pl.name, id: pl.id || '', dept: pl.dept || pl.department || '', batch: pl.batch || '', team: sel.name }, f, 'image'), cfg), sel._id);
  };
  const delPlayer = (pl) => run(() => API.delete(`/club/players/${pl._id}`), sel._id);
  const addBulk = () => run(async () => {
    const players = bulk.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((a) => a[0])
      .map(([name, id, dept, batch]) => ({ name, id, dept, batch }));
    await API.post('/club/players/bulk', { team: sel.name, players }); setBulk('');
  }, sel._id);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#fff' }}>Teams &amp; Players</h2>
      {msg && <div style={{ ...box, background: '#fee2e2', marginBottom: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) 2fr', gap: 20 }}>
        <div style={box}>
          <b>Add team</b>
          <div style={{ marginTop: 8 }}>
            <input style={inp} placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            <button style={btn('#16a34a')} onClick={addTeam}>Add</button>
            <div style={{ fontSize: 12, color: '#64748b', margin: '2px 0 6px' }}>Team logo (optional):</div>
            <input key={`tl${fileKey}`} type="file" accept="image/*" onChange={(e) => pickImage(e, setTeamLogo, setMsg)} />
          </div>
          {teams.map((t) => (
            <div key={t._id} onClick={() => setSel(t)}
              style={{ padding: 10, marginTop: 6, borderRadius: 8, cursor: 'pointer', background: sel && sel._id === t._id ? '#dbeafe' : '#f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{t.logo ? <img src={t.logo} alt="" style={thumb()} /> : null}<span><b>{t.name}</b> <small>({t.players.length} players)</small></span></span>
              <span onClick={(e) => { e.stopPropagation(); delTeam(t); }} style={{ color: '#dc2626' }}>✕</span>
            </div>
          ))}
          {!teams.length && <p style={{ color: '#64748b' }}>No teams yet.</p>}
        </div>

        <div style={box}>
          {!sel || !sel.name ? <p style={{ color: '#64748b' }}>Select or create a team to manage its players.</p> : (<>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              {sel.logo ? <img src={sel.logo} alt="" style={{ ...thumb(), width: 48, height: 48 }} /> : null}
              <span>{sel.name} — players ({sel.players.length})</span>
            </h3>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 10 }}>
              {sel.logo ? 'Change team logo: ' : 'Upload team logo: '}
              <input type="file" accept="image/*" onChange={changeTeamLogo} />
            </label>
            <div>
              <input style={{ ...inp, width: 170 }} placeholder="Name *" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
              <input style={{ ...inp, width: 90 }} placeholder="ID" value={p.id} onChange={(e) => setP({ ...p, id: e.target.value })} />
              <input style={{ ...inp, width: 110 }} placeholder="Dept" value={p.dept} onChange={(e) => setP({ ...p, dept: e.target.value })} />
              <input style={{ ...inp, width: 80 }} placeholder="Batch" value={p.batch} onChange={(e) => setP({ ...p, batch: e.target.value })} />
              <button style={btn()} onClick={addPlayer}>Add Player</button>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Player photo (optional): <input key={`pi${fileKey}`} type="file" accept="image/*" onChange={(e) => pickImage(e, setPlayerImg, setMsg)} />
              </div>
            </div>
            <details style={{ margin: '6px 0 12px' }}>
              <summary style={{ cursor: 'pointer' }}>Add many at once</summary>
              <textarea rows={5} style={{ ...inp, width: '95%' }} placeholder={'One per line: name, id, dept, batch\nRahim, 2101, CSE, 21'} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <button style={btn('#7c3aed')} onClick={addBulk}>Add All</button>
            </details>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: '#64748b' }}><th>Photo</th><th>Name</th><th>ID</th><th>Dept</th><th>Batch</th><th /></tr></thead>
              <tbody>{sel.players.map((pl) => (
                <tr key={pl._id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 6 }}>
                    <label style={{ cursor: 'pointer' }} title="Click to change photo">
                      {pl.image ? <img src={pl.image} alt="" style={thumb()} /> : <span style={{ ...thumb(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#64748b' }}>+ photo</span>}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => changePlayerImg(pl, e)} />
                    </label>
                  </td>
                  <td style={{ padding: 6 }}>{pl.name}</td><td>{pl.id}</td><td>{pl.dept}</td><td>{pl.batch}</td>
                  <td><span style={{ color: '#dc2626', cursor: 'pointer' }} onClick={() => delPlayer(pl)}>Delete</span></td>
                </tr>))}</tbody>
            </table>
          </>)}
        </div>
      </div>
    </div>
  );
}