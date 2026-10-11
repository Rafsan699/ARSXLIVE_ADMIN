import React, { useEffect, useRef, useState } from 'react';
import API from '../services/capi';

/* =====================================================================
   Admin > Stream
   1. Live video   : paste the YouTube link / video ID / channel ID -> "Go live".
                     The home page switches to the video instantly (socket.io), no reload.
   2. Upcoming     : thumbnail + title + start time shown while nothing is live.
   Everything is responsive: the two cards sit side by side on a desktop and stack on a phone.
   ===================================================================== */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const abs = (u) => (u && u.startsWith('/') ? `${BASE}${u}` : u || '');

const CSS = `
.sc-wrap{max-width:1100px;margin:0 auto;padding:16px;font-family:sans-serif;box-sizing:border-box}
.sc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
@media(max-width:860px){.sc-grid{grid-template-columns:minmax(0,1fr)}}
.sc-box{background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.08);min-width:0}
.sc-box h3{margin:0 0 4px;font-size:18px}
.sc-hint{font-size:12px;color:#64748b;margin:0 0 12px}
.sc-lbl{display:block;font-size:12px;font-weight:700;color:#334155;margin:10px 0 4px}
.sc-in{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #cbd5e1;font-size:16px;background:#fff;color:#0f172a}
.sc-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.sc-btn{padding:11px 16px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;font-size:15px;flex:1 1 auto;min-height:44px}
.sc-btn[disabled]{opacity:.55;cursor:not-allowed}
.sc-16x9{position:relative;width:100%;aspect-ratio:16/9;background:#0b1020;border-radius:10px;overflow:hidden}
.sc-16x9>*{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}
.sc-badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;color:#fff}
.sc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.sc-empty{display:grid;place-items:center;color:#94a3b8;font-size:13px;text-align:center;padding:12px}
`;

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const embedUrl = (l) => (l.channelId
  ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${l.channelId}&rel=0&modestbranding=1`
  : `https://www.youtube-nocookie.com/embed/${l.videoId}?rel=0&modestbranding=1`);

/* shrink the picked image in the browser so it stays well under the server limit */
const resizeImage = (file, maxW = 1280, quality = 0.82) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, maxW / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
  img.src = url;
});

export default function StreamControl() {
  const [stream, setStream] = useState(null);
  const [input, setInput] = useState('');
  const [liveTitle, setLiveTitle] = useState('');
  const [up, setUp] = useState({ title: '', subtitle: '', startsAt: '', link: '' });
  const [thumb, setThumb] = useState(undefined);   // undefined = unchanged, '' = remove, string = new image
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);            // { ok, text }
  const fileRef = useRef(null);

  const fill = (s) => {
    setStream(s);
    setLiveTitle(s.live.title || '');
    setUp({ title: s.upcoming.title || '', subtitle: s.upcoming.subtitle || '', startsAt: toLocalInput(s.upcoming.startsAt), link: s.upcoming.link || '' });
    setThumb(undefined);
    if (fileRef.current) fileRef.current.value = '';
  };

  useEffect(() => {
    API.get('/stream').then((r) => { fill(r.data); setInput(r.data.live.videoId || r.data.live.channelId || ''); })
      .catch(() => setMsg({ ok: false, text: 'Could not load stream settings. Is the server running?' }));
  }, []);

  const run = async (name, fn, okText) => {
    setBusy(name); setMsg(null);
    try { const r = await fn(); fill(r.data); setMsg({ ok: true, text: okText }); return r.data; } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.message || e.message });
      return null;
    } finally { setBusy(''); }
  };

  const goLive = () => run('live', () => API.put('/stream/live', { input, title: liveTitle, enabled: true }), 'Live video is on the website now.');
  const stopLive = () => run('stop', () => API.post('/stream/live/stop'), 'Live video stopped. The website shows the upcoming thumbnail.');
  const saveUpcoming = () => {
    const body = { title: up.title, subtitle: up.subtitle, link: up.link, startsAt: up.startsAt ? new Date(up.startsAt).toISOString() : '' };
    if (thumb !== undefined) body.thumbnail = thumb;
    return run('up', () => API.put('/stream/upcoming', body), 'Upcoming stream saved.');
  };

  const pickFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setMsg({ ok: false, text: 'Please choose an image file.' }); e.target.value = ''; return; }
    try { setThumb(await resizeImage(f)); setMsg(null); } catch (er) { setMsg({ ok: false, text: er.message }); }
  };

  if (!stream && !msg) return <div className="sc-wrap"><style>{CSS}</style><p style={{ color: '#fff' }}>Loading...</p></div>;

  const live = !!(stream && stream.live.enabled);
  const shownThumb = thumb !== undefined ? thumb : abs(stream && stream.upcoming.thumbnail);

  return (
    <div className="sc-wrap">
      <style>{CSS}</style>
      <h2 style={{ color: '#fff', marginTop: 0 }}>Home page video</h2>

      {msg && (
        <div role="status" style={{ background: msg.ok ? '#dcfce7' : '#fee2e2', color: msg.ok ? '#166534' : '#991b1b', padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 14 }}>
          {msg.text}
        </div>
      )}

      <div className="sc-grid">
        {/* ---------------- LIVE ---------------- */}
        <div className="sc-box">
          <div className="sc-top">
            <h3>Live video</h3>
            <span className="sc-badge" style={{ background: live ? '#ef4444' : '#64748b' }}>{live ? 'LIVE on website' : 'Not live'}</span>
          </div>
          <p className="sc-hint">Paste the YouTube link from YouTube Studio. A watch link, youtu.be link, live link, video ID or channel ID (UC...) all work. A channel ID always shows whatever that channel is streaming right now.</p>

          <div className="sc-16x9">
            {live
              ? <iframe title="Live preview" src={embedUrl(stream.live)} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
              : <div className="sc-empty">The live preview appears here after you press Go live.</div>}
          </div>

          <label className="sc-lbl" htmlFor="sc-link">YouTube link, video ID or channel ID</label>
          <input id="sc-link" className="sc-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." inputMode="url" autoCapitalize="off" autoCorrect="off" />

          <label className="sc-lbl" htmlFor="sc-ltitle">Title shown on the website (optional)</label>
          <input id="sc-ltitle" className="sc-in" value={liveTitle} maxLength={140} onChange={(e) => setLiveTitle(e.target.value)} placeholder="Semi-final: Team A vs Team B" />

          <div className="sc-row">
            <button className="sc-btn" style={{ background: '#dc2626' }} disabled={!!busy || !input.trim()} onClick={goLive}>
              {busy === 'live' ? 'Saving...' : live ? 'Update live video' : 'Go live'}
            </button>
            {live && <button className="sc-btn" style={{ background: '#475569' }} disabled={!!busy} onClick={stopLive}>{busy === 'stop' ? 'Stopping...' : 'Stop live'}</button>}
          </div>
        </div>

        {/* ---------------- UPCOMING ---------------- */}
        <div className="sc-box">
          <h3>Upcoming stream</h3>
          <p className="sc-hint">Shown on the home page while nothing is live. When you press Go live, the video replaces it automatically.</p>

          <div className="sc-16x9">
            {shownThumb ? <img src={shownThumb} alt="Thumbnail preview" /> : <div className="sc-empty">No thumbnail yet. The site shows the next fixture instead.</div>}
          </div>

          <label className="sc-lbl" htmlFor="sc-file">Thumbnail (16:9 image, resized automatically)</label>
          <input id="sc-file" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile} style={{ width: '100%', fontSize: 14 }} />
          {shownThumb && <button type="button" onClick={() => { setThumb(''); if (fileRef.current) fileRef.current.value = ''; }} style={{ marginTop: 6, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 0, fontSize: 13 }}>Remove thumbnail</button>}

          <label className="sc-lbl" htmlFor="sc-utitle">Title</label>
          <input id="sc-utitle" className="sc-in" value={up.title} maxLength={140} onChange={(e) => setUp({ ...up, title: e.target.value })} placeholder="Grand Final: Falcons vs Titans" />

          <label className="sc-lbl" htmlFor="sc-usub">Subtitle</label>
          <input id="sc-usub" className="sc-in" value={up.subtitle} maxLength={200} onChange={(e) => setUp({ ...up, subtitle: e.target.value })} placeholder="Tournament name, stage, venue" />

          <label className="sc-lbl" htmlFor="sc-ustart">Start time (shows a countdown)</label>
          <input id="sc-ustart" className="sc-in" type="datetime-local" value={up.startsAt} onChange={(e) => setUp({ ...up, startsAt: e.target.value })} />

          <label className="sc-lbl" htmlFor="sc-ulink">YouTube premiere / stream page link (optional)</label>
          <input id="sc-ulink" className="sc-in" value={up.link} onChange={(e) => setUp({ ...up, link: e.target.value })} placeholder="https://www.youtube.com/watch?v=..." inputMode="url" autoCapitalize="off" />

          <div className="sc-row">
            <button className="sc-btn" style={{ background: '#2563eb' }} disabled={!!busy} onClick={saveUpcoming}>{busy === 'up' ? 'Saving...' : 'Save upcoming stream'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}