import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/capi';

const CATEGORIES = [
  { value: 'franchise', label: 'Franchise' },
  { value: 'league', label: 'League' },
  { value: 'group_wise', label: 'Group Wise' }
];
// old tournaments (inter_university etc.) map to a valid category
const normCat = (t) => (CATEGORIES.some((c) => c.value === t?.category) ? t.category : (t?.format === 'group_wise' ? 'group_wise' : 'league'));
const STAGES = ['League', 'Quarter Final', 'Eliminator', 'Qualifier', 'Semi Final', 'Final'];

const CTournamentManage = () => {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState([]);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState('league');
  
  // Selected Tournament & Schedule States
  const [activeTournament, setActiveTournament] = useState(null);
  const [schedules, setSchedules] = useState([]);

  // Teams List State (API থেকে ফেচ করা টিমগুলোর লিস্ট)
  const [availableTeams, setAvailableTeams] = useState([]);

  // Edit Modes State
  const [editingTournamentId, setEditingTournamentId] = useState(null);
  const [editingScheduleId, setEditingScheduleId] = useState(null);

  // Result Modal State for detailed view
  const [selectedMatchResult, setSelectedMatchResult] = useState(null);

  // Tournament Form States
  const [category, setCategory] = useState('league');
  const [tournamentName, setTournamentName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const [teamsCount, setTeamsCount] = useState('');
  const [logo, setLogo] = useState('');
  const [logoFile, setLogoFile] = useState(null); // new image -> uploaded to Cloudinary by the server
  const [logoPreview, setLogoPreview] = useState('');
  // NEW: tournament format (round robin / group wise) + groups
  const [format, setFormat] = useState('round_robin');
  const [oversPerMatch, setOversPerMatch] = useState(20);
  const [groups, setGroups] = useState([]); // [{ name, teams: [teamName] }]
  
  // Schedule Form States
  const [matchNo, setMatchNo] = useState(1);
  const [team1, setTeam1] = useState('');
  const [team2, setTeam2] = useState('');
  const [matchDate, setMatchDate] = useState('');
  const [matchVenue, setMatchVenue] = useState('');
  // NEW: group / stage / overs / batting-first for a match
  const [matchStage, setMatchStage] = useState('League');
  const [matchGroup, setMatchGroup] = useState('');
  const [matchOvers, setMatchOvers] = useState(20);
  const [battingFirst, setBattingFirst] = useState('');

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // 🟨 Tournaments fetch korar function
  const fetchTournaments = async () => {
    try {
      const res = await API.get('/tournaments');
      const data = res.data || [];
      setTournaments(data);
      
      if (activeTournament) {
        const updatedActive = data.find((t) => t._id === activeTournament._id);
        if (updatedActive) {
          setActiveTournament(updatedActive);
          setSchedules(updatedActive.schedules || []);
        }
      }
    } catch (error) {
      console.error('Error fetching tournaments:', error);
    }
  };

  // 🟨 Teams fetch korar function
  const fetchTeams = async () => {
    try {
      const res = await API.get('/teams'); 
      const teamsData = Array.isArray(res.data) ? res.data : (res.data.teams || res.data.data || []);
      setAvailableTeams(teamsData);
    } catch (error) {
      console.error('Error fetching teams with players:', error);
      setAvailableTeams([]);
    }
  };

  useEffect(() => {
    fetchTournaments();
    fetchTeams();
  }, []);

  // 🟨 Nirdishto tournament-er schedule fetch kora
  const fetchSchedules = async (tournamentId) => {
    try {
      const res = await API.get(`/tournaments/${tournamentId}`);
      const fetchedSchedules = res.data.schedules || res.data.tournament?.schedules || [];
      setSchedules(fetchedSchedules);
      setMatchNo(fetchedSchedules.length + 1);
    } catch (error) {
      console.error('Error fetching schedules:', error);
      setSchedules([]);
      setMatchNo(1);
    }
  };

  // 🟨 Tournament select kora
  const handleSelectTournament = (t) => {
    setActiveTournament(t);
    setMatchVenue(t.venue || '');
    setMatchStage('League');
    setMatchGroup('');
    setMatchOvers(t.oversPerMatch || 20);
    setBattingFirst('');
    setEditingScheduleId(null);
    fetchSchedules(t._id);
    setMessage('');
  };

  // 🟨 Tournament create ba update handler
  const handleFormSubmitTournament = async (e) => {
    e.preventDefault();
    if (!category) {
      setMessage('Please select a tournament type/category!');
      return;
    }
    if (format === 'group_wise') {
      if (groups.length < 2) {
        setMessage('Group wise tournament needs at least 2 groups!');
        return;
      }
      const small = groups.find((g) => g.teams.length < 2);
      if (small) {
        setMessage(`${small.name || 'A group'} needs at least 2 teams!`);
        return;
      }
    }

    try {
      setLoading(true);
      const payload = new FormData();
      const fields = {
        category,
        name: tournamentName,
        tournamentName,
        description,
        date,
        venue,
        teamsCount: Number(teamsCount) || (format === 'group_wise' ? groups.reduce((n, g) => n + g.teams.length, 0) : 0),
        format,
        oversPerMatch: Number(oversPerMatch) || 20,
        groups: JSON.stringify(format === 'group_wise' ? groups : [])
      };
      Object.entries(fields).forEach(([k, v]) => payload.append(k, v ?? ''));
      if (logoFile) payload.append('logo', logoFile);      // server uploads it to Cloudinary
      else if (logo) payload.append('logo', logo);         // keep the existing Cloudinary URL
      const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };

      if (editingTournamentId) {
        await API.put(`/tournaments/${editingTournamentId}`, payload, cfg);
        setMessage('Tournament updated successfully!');
      } else {
        await API.post('/tournaments/create', payload, cfg);
        setMessage('Tournament created successfully!');
      }
      
      resetTournamentForm();
      fetchTournaments();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving tournament:', error);
      setMessage(error.response?.data?.message || 'Failed to save tournament.');
    } finally {
      setLoading(false);
    }
  };

  const resetTournamentForm = () => {
    setTournamentName('');
    setDescription('');
    setDate('');
    setVenue('');
    setTeamsCount('');
    setLogo('');
    setLogoFile(null);
    setLogoPreview('');
    setCategory('league');
    setFormat('round_robin');
    setOversPerMatch(20);
    setGroups([]);
    setEditingTournamentId(null);
  };

  // 🟨 Tournament edit mode-e neowa
  const handleEditTournament = (t, e) => {
    e.stopPropagation();
    setEditingTournamentId(t._id);
    const cat = normCat(t);
    setCategory(cat);
    setTournamentName(t.name || t.tournamentName || '');
    setDescription(t.description || '');
    setDate(t.date ? t.date.split('T')[0] : '');
    setVenue(t.venue || '');
    setTeamsCount(t.teamsCount || '');
    setLogo(t.logo || '');
    setLogoFile(null);
    setLogoPreview(t.logo || '');
    setFormat(cat === 'group_wise' ? 'group_wise' : 'round_robin');
    setOversPerMatch(t.oversPerMatch || 20);
    setGroups((t.groups || []).map((g) => ({ name: g.name, teams: [...(g.teams || [])] })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 🟨 Tournament delete kora
  const handleDeleteTournament = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this tournament?')) return;

    try {
      await API.delete(`/tournaments/${id}`);
      setMessage('Tournament deleted successfully!');
      if (activeTournament?._id === id) {
        setActiveTournament(null);
        setSchedules([]);
      }
      fetchTournaments();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error deleting tournament:', error);
      setMessage('Failed to delete tournament.');
    }
  };

  // 🟨 NEW: Format & Group helpers
  const handleFormatChange = (value) => {
    setFormat(value);
    if (value === 'group_wise' && groups.length === 0) {
      setGroups([{ name: 'Group A', teams: [] }, { name: 'Group B', teams: [] }]);
    }
  };

  const handleCategoryChange = (value) => {
    setCategory(value);
    handleFormatChange(value === 'group_wise' ? 'group_wise' : 'round_robin'); // format follows category
  };

  const handleLogoPick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setMessage('Please choose an image file.'); return; }
    if (f.size > 3 * 1024 * 1024) { setMessage('Image must be under 3MB.'); return; }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const addGroup = () => {
    setGroups((prev) => [...prev, { name: `Group ${String.fromCharCode(65 + prev.length)}`, teams: [] }]);
  };

  const removeGroup = (index) => {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  };

  const renameGroup = (index, value) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, name: value } : g)));
  };

  const toggleTeamInGroup = (index, teamName) => {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== index) return g;
        const has = g.teams.includes(teamName);
        return { ...g, teams: has ? g.teams.filter((n) => n !== teamName) : [...g.teams, teamName] };
      })
    );
  };

  // 🟨 Match schedule add ba update handler
  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    if (!activeTournament) return;
    if (!team1 || !team2) {
      setMessage('Please select both Team 1 and Team 2!');
      return;
    }
    if (team1 === team2) {
      setMessage('Team 1 and Team 2 cannot be the same!');
      return;
    }
    if (activeTournament.format === 'group_wise' && matchStage === 'League' && !matchGroup) {
      setMessage('Please select a group for this league match!');
      return;
    }

    try {
      setScheduleLoading(true);
      const schedulePayload = {
        matchNumber: Number(matchNo),
        team1,
        team2,
        date: matchDate,
        venue: matchVenue || activeTournament.venue,
        stage: matchStage,
        group: activeTournament.format === 'group_wise' && matchStage === 'League' ? matchGroup : '',
        matchOvers: Number(matchOvers) || activeTournament.oversPerMatch || 0,
        battingFirst
      };

      if (editingScheduleId) {
        await API.put(`/tournaments/schedules/${editingScheduleId}`, schedulePayload);
        setMessage('Match schedule updated successfully!');
      } else {
        await API.post(`/tournaments/${activeTournament._id}/schedules`, schedulePayload);
        setMessage('Match schedule added successfully!');
      }

      fetchSchedules(activeTournament._id);
      resetScheduleForm();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving schedule:', error);
      setMessage(error.response?.data?.message || 'Failed to save match schedule.');
    } finally {
      setScheduleLoading(false);
    }
  };

  const resetScheduleForm = () => {
    setTeam1('');
    setTeam2('');
    setMatchDate('');
    setBattingFirst('');
    setEditingScheduleId(null);
    setMatchNo(schedules.length + 1);
  };

  // 🟨 Schedule edit mode-e neowa
  const handleEditSchedule = (match, e) => {
    e.stopPropagation();
    setEditingScheduleId(match._id);
    setMatchNo(match.matchNumber || 1);
    setTeam1(match.team1 || '');
    setTeam2(match.team2 || '');
    setMatchDate(match.date ? new Date(match.date).toISOString().slice(0, 16) : '');
    setMatchVenue(match.venue || '');
    setMatchStage(match.stage || 'League');
    setMatchGroup(match.group || '');
    setMatchOvers(match.matchOvers || activeTournament?.oversPerMatch || 20);
    setBattingFirst(match.battingFirst || '');
  };

  // 🟨 Schedule delete kora
  const handleDeleteSchedule = async (scheduleId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure to delete this match schedule?')) return;
    try {
      await API.delete(`/tournaments/schedules/${scheduleId}`);
      setMessage('Schedule deleted successfully!');
      fetchSchedules(activeTournament._id);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error deleting schedule:', error);
      setMessage('Failed to delete schedule.');
    }
  };

  // 🟨 Dynamic match status calculator
  const getDynamicMatchStatus = (match) => {
    if (match.status === 'Completed' || match.result) {
      return { text: 'Finished', bg: '#f1f5f9', color: '#64748b' };
    }
    if (!match.date) return { text: 'Upcoming', bg: '#fef3c7', color: '#d97706' };

    const matchTime = new Date(match.date).getTime();
    const currentTime = new Date().getTime();
    const matchDurationMs = 3 * 60 * 60 * 1000;

    if (currentTime < matchTime) {
      return { text: 'Upcoming', bg: '#e0f2fe', color: '#0284c7' };
    } else if (currentTime >= matchTime && currentTime <= matchTime + matchDurationMs) {
      return { text: 'Ongoing', bg: '#dcfce7', color: '#16a34a' };
    } else {
      return { text: 'Finished', bg: '#f1f5f9', color: '#64748b' };
    }
  };

  // টীমের নাম থেকে শর্ট ইনিশিয়াল বের করার ফাংশন
  const getTeamInitials = (name) => {
    if (!name) return 'TM';
    const words = name.trim().split(' ');
    if (words.length > 1) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const filteredTournaments = tournaments.filter(
    (t) => normCat(t) === selectedCategoryTab
  );

  // 🟨 নিরাপদ টিম ফিল্টারিং লজিক (Fallback সহ যাতে ডেটা না থাকলে সব টিম দেখায়)
  const categoryMatchedTeams = availableTeams.filter((t) => {
    if (!activeTournament) return true;
    
    const teamCategory = t.category || t.tournamentType || t.type || t.tournamentCategory;
    const teamTournamentId = t.tournamentId || t.tournament?._id || t.tournament;
    const teamTournamentName = t.tournamentName || t.tournament?.name;

    // যদি টিমগুলোর সাথে কোনো ক্যাটাগরি বা টুর্নামেন্টের ফিল্ড যুক্ত করা না থাকে, তবে সেগুলোকে ড্রপডাউন থেকে ফিল্টার আউট না করে প্রদর্শন করার সুযোগ দেওয়ার জন্য ডিফল্টভাবে true রাখা যেতে পারে অথবা ম্যাচ করলে রাখা যাবে।
    if (!teamCategory && !teamTournamentId && !teamTournamentName) {
      return true; // যদি ব্যাকএন্ডে ট্যাগ করা না থাকে, তবে সেফটির জন্য দেখাবে
    }

    // ১. যদি টুর্নামেন্ট আইডি ম্যাচ করে
    if (teamTournamentId && activeTournament._id) {
      return String(teamTournamentId) === String(activeTournament._id);
    }
    
    // ২. যদি টুর্নামেন্টের নাম ম্যাচ করে
    if (teamTournamentName && (activeTournament.name || activeTournament.tournamentName)) {
      return teamTournamentName === (activeTournament.name || activeTournament.tournamentName);
    }

    // ৩. যদি ক্যাটাগরি বা টুর্নামেন্ট টাইপ ম্যাচ করে
    if (teamCategory && activeTournament.category) {
      return String(teamCategory).toLowerCase() === String(activeTournament.category).toLowerCase();
    }

    return false;
  });

  // যদি ফিল্টার করার পর কিছু না থাকে, তবে সম্পূর্ণ availableTeams দেখাবে যাতে লিস্ট খালি না হয়ে যায়
  const filteredTeamsForDropdown = categoryMatchedTeams.length > 0 ? categoryMatchedTeams : availableTeams;

  // NEW: group-wise helpers
  const allTeamNames = [...new Set(availableTeams.map((t) => t.teamName || t.name).filter(Boolean))];
  const isGroupWise = activeTournament?.format === 'group_wise';
  const needsGroup = isGroupWise && matchStage === 'League';
  const selectedGroupObj = (activeTournament?.groups || []).find((g) => g.name === matchGroup);

  const playersLabel = (n) => {
    const full = availableTeams.find((t) => (t.teamName || t.name) === n);
    return `${n}${full?.players ? ` (${full.players.length} Players)` : ''}`;
  };

  // League ম্যাচে গ্রুপ সিলেক্ট করলে শুধু ওই গ্রুপের টিম দেখাবে
  const teamOptions = needsGroup
    ? (selectedGroupObj ? selectedGroupObj.teams.map((n) => ({ value: n, label: playersLabel(n) })) : [])
    : filteredTeamsForDropdown.map((t) => {
        const n = t.teamName || t.name;
        return { value: n, label: playersLabel(n) };
      });

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Segoe UI, sans-serif', boxSizing: 'border-box' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '25px', color: '#1e293b', fontWeight: '800' }}>
        Tournament Management Panel
      </h2>

      {message && (
        <div style={{ background: '#d4edda', color: '#155724', padding: '12px', marginBottom: '20px', borderRadius: '8px', textAlign: 'center', fontWeight: '600' }}>
          {message}
        </div>
      )}

      {/* Tournament Form & List Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '25px', marginBottom: '30px' }}>
        
        {/* Form */}
        <div style={{ background: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #f1f5f9', paddingBottom: '8px' }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px' }}>
              {editingTournamentId ? 'Edit Tournament' : 'Create New Tournament'}
            </h3>
            {editingTournamentId && (
              <button 
                onClick={resetTournamentForm}
                style={{ background: '#cbd5e1', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
              >
                Cancel Edit
              </button>
            )}
          </div>
          
          <form onSubmit={handleFormSubmitTournament} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                Select Tournament Type (Category):
              </label>
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#f8fafc' }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label} Tournament</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Tournament Format:</label>
                <div style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#e2e8f0', boxSizing: 'border-box' }}>
                  {format === 'group_wise' ? 'Group Wise (auto)' : 'Round Robin (auto)'}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Overs Per Match:</label>
                <input
                  type="number"
                  min="1"
                  value={oversPerMatch}
                  onChange={(e) => setOversPerMatch(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {format === 'group_wise' && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '700', fontSize: '14px', color: '#334155' }}>Groups & Teams</span>
                  <button
                    type="button"
                    onClick={addGroup}
                    style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    + Add Group
                  </button>
                </div>

                {allTeamNames.length === 0 && (
                  <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>No teams found. Add teams first, then assign them to groups.</p>
                )}

                {groups.map((g, gi) => (
                  <div key={gi} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                      <input
                        type="text"
                        value={g.name}
                        onChange={(e) => renameGroup(gi, e.target.value)}
                        style={{ flex: 1, padding: '7px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: '600' }}
                      />
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{g.teams.length} teams</span>
                      <button
                        type="button"
                        onClick={() => removeGroup(gi)}
                        title="Remove group"
                        style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '5px 8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '700' }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {allTeamNames.map((n) => {
                        const inThis = g.teams.includes(n);
                        const elsewhere = !inThis && groups.some((og, oi) => oi !== gi && og.teams.includes(n));
                        return (
                          <label
                            key={n}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', borderRadius: '999px', fontSize: '12px',
                              border: inThis ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                              background: inThis ? '#eff6ff' : '#f8fafc',
                              color: '#334155',
                              opacity: elsewhere ? 0.4 : 1,
                              cursor: elsewhere ? 'not-allowed' : 'pointer'
                            }}
                            title={elsewhere ? 'Already in another group' : ''}
                          >
                            <input type="checkbox" checked={inThis} disabled={elsewhere} onChange={() => toggleTeamInGroup(gi, n)} />
                            {n}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                Tournament Name:
              </label>
              <input
                type="text"
                placeholder="e.g. Premier University Cup"
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>
                Description:
              </label>
              <textarea
                placeholder="Short details about the tournament..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows="2"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Date:</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Teams Count:</label>
                <input
                  type="number"
                  placeholder="e.g. 8"
                  value={teamsCount}
                  onChange={(e) => setTeamsCount(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>Venue:</label>
              <input
                type="text"
                placeholder="Stadium / Ground Name"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#334155' }}>Logo Image (saved to Cloudinary):</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoPick}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
              {logoPreview && (
                <img src={logoPreview} alt="logo preview" style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #cbd5e1', marginTop: '8px' }} />
              )}
            </div>

            <button 
              type="submit" 
              disabled={loading}
              style={{ 
                background: editingTournamentId ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 
                color: '#fff', 
                border: 'none', 
                padding: '12px', 
                borderRadius: '8px', 
                cursor: loading ? 'not-allowed' : 'pointer', 
                fontWeight: '700', 
                fontSize: '15px',
                marginTop: '5px'
              }}
            >
              {loading ? 'Processing...' : editingTournamentId ? 'Update Tournament' : 'Create Tournament'}
            </button>
          </form>
        </div>

        {/* Tournament List */}
        <div style={{ background: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '15px', color: '#0f172a', fontSize: '18px', borderBottom: '2px solid #f1f5f9', paddingBottom: '8px' }}>
            Tournament Panels & Lists <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'normal' }}>(Click to Manage Schedule)</span>
          </h3>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '15px', flexWrap: 'wrap' }}>
            {CATEGORIES.map((c) => c.value).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryTab(cat)}
                style={{
                  flex: 1,
                  padding: '8px 6px',
                  fontSize: '11px',
                  fontWeight: '700',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: 'none',
                  background: selectedCategoryTab === cat ? '#3b82f6' : '#e2e8f0',
                  color: selectedCategoryTab === cat ? '#fff' : '#334155',
                  textTransform: 'capitalize'
                }}
              >
                {CATEGORIES.find((c) => c.value === cat).label}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: '430px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px', flex: 1 }}>
            {filteredTournaments.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '14px', textAlign: 'center', marginTop: '60px' }}>
                No tournaments found in this category.
              </p>
            ) : (
              filteredTournaments.map((t) => {
                const isSelected = activeTournament?._id === t._id;
                return (
                  <div 
                    key={t._id} 
                    onClick={() => handleSelectTournament(t)}
                    style={{ 
                      background: isSelected ? '#eff6ff' : '#f8fafc', 
                      borderRadius: '10px', 
                      border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                      borderLeft: '5px solid #3b82f6',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      justifyContent: 'space-between',
                      padding: '14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                      {t.logo ? (
                        <img src={t.logo} alt={t.name} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #cbd5e1' }} />
                      ) : (
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#64748b', fontSize: '11px' }}>CUP</div>
                      )}

                      <div>
                        <div style={{ fontWeight: '700', fontSize: '15px', color: '#1e293b' }}>
                          {t.name || t.tournamentName} {isSelected && <span style={{ color: '#2563eb', fontSize: '12px' }}>(Active)</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', fontWeight: '500' }}>
                          📍 {t.venue || 'Venue TBA'}
                        </div>
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ background: t.format === 'group_wise' ? '#ede9fe' : '#dcfce7', color: t.format === 'group_wise' ? '#6d28d9' : '#15803d', padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: '700' }}>
                            {t.format === 'group_wise' ? `Group Wise (${(t.groups || []).length} groups)` : 'Round Robin'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                      <button 
                        onClick={(e) => handleEditTournament(t, e)}
                        title="Edit Tournament"
                        style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={(e) => handleDeleteTournament(t._id, e)}
                        title="Delete Tournament"
                        style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Schedule Management Section */}
      {activeTournament ? (
        <div style={{ background: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', borderTop: '5px solid #0ea5e9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '20px' }}>
                Schedule Management: <span style={{ color: '#2563eb' }}>{activeTournament.name || activeTournament.tournamentName}</span>
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                Click any match card to open the **Live Score Control Panel** with team & player details.
              </p>
            </div>
            <button
              onClick={() => setActiveTournament(null)}
              style={{ background: '#cbd5e1', color: '#334155', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
            >
              Close Panel
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '25px' }}>
            
            {/* Schedule Form */}
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '10px', border: '1px solid #e2e8f0', height: 'fit-content' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h4 style={{ margin: 0, fontSize: '16px', color: '#1e293b' }}>
                  {editingScheduleId ? 'Edit Match Schedule' : 'Add New Match Schedule'}
                </h4>
                {editingScheduleId && (
                  <button 
                    onClick={resetScheduleForm}
                    style={{ background: '#cbd5e1', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
              
              <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Match Sequence / Number:</label>
                  <input 
                    type="number"
                    value={matchNo}
                    onChange={(e) => setMatchNo(e.target.value)}
                    required
                    style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: needsGroup ? '1fr 1fr' : '1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Match Stage:</label>
                    <select
                      value={matchStage}
                      onChange={(e) => { setMatchStage(e.target.value); setTeam1(''); setTeam2(''); }}
                      style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {needsGroup && (
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Group:</label>
                      <select
                        value={matchGroup}
                        onChange={(e) => { setMatchGroup(e.target.value); setTeam1(''); setTeam2(''); setBattingFirst(''); }}
                        required
                        style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                      >
                        <option value="">-- Select Group --</option>
                        {(activeTournament.groups || []).map((g) => (
                          <option key={g._id || g.name} value={g.name}>{g.name} ({g.teams.length} teams)</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {/* টিম ১ ড্রপডাউন */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Select Team 1:</label>
                    <select
                      value={team1}
                      onChange={(e) => setTeam1(e.target.value)}
                      disabled={needsGroup && !matchGroup}
                      required
                      style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                    >
                      <option value="">-- Choose Team 1 --</option>
                      {teamOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* টিম ২ ড্রপডাউন */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Select Team 2:</label>
                    <select
                      value={team2}
                      onChange={(e) => setTeam2(e.target.value)}
                      disabled={needsGroup && !matchGroup}
                      required
                      style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                    >
                      <option value="">-- Choose Team 2 --</option>
                      {teamOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Overs:</label>
                    <input
                      type="number"
                      min="1"
                      value={matchOvers}
                      onChange={(e) => setMatchOvers(e.target.value)}
                      style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Batting First (optional):</label>
                    <select
                      value={battingFirst}
                      onChange={(e) => setBattingFirst(e.target.value)}
                      disabled={!team1 || !team2}
                      style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                    >
                      <option value="">-- After toss --</option>
                      {team1 && <option value={team1}>{team1}</option>}
                      {team2 && <option value={team2}>{team2}</option>}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Match Date & Time:</label>
                  <input 
                    type="datetime-local"
                    value={matchDate}
                    onChange={(e) => setMatchDate(e.target.value)}
                    style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '13px', color: '#334155' }}>Venue:</label>
                  <input 
                    type="text"
                    value={matchVenue}
                    onChange={(e) => setMatchVenue(e.target.value)}
                    placeholder="Ground/Stadium Name"
                    style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={scheduleLoading}
                  style={{ 
                    background: editingScheduleId ? '#f59e0b' : '#0ea5e9', 
                    color: '#fff', 
                    border: 'none', 
                    padding: '10px', 
                    borderRadius: '6px', 
                    cursor: scheduleLoading ? 'not-allowed' : 'pointer', 
                    fontWeight: '700', 
                    fontSize: '14px',
                    marginTop: '5px'
                  }}
                >
                  {scheduleLoading ? 'Processing...' : editingScheduleId ? 'Update Match Schedule' : 'Add Match to Schedule'}
                </button>
              </form>
            </div>

            {/* Schedule List Panel */}
            <div>
              <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#1e293b' }}>
                Match Schedules & Control ({schedules.length})
              </h4>

              <div style={{ maxHeight: '450px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '5px' }}>
                {schedules.length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '14px', textAlign: 'center', marginTop: '60px' }}>
                    No schedules added for this tournament yet.
                  </p>
                ) : (
                  schedules
                    .sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0))
                    .map((match, index) => {
                      const num = match.matchNumber || index + 1;
                      const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
                      const statusInfo = getDynamicMatchStatus(match);
                      
                      const t1Name = match.team1 || 'Team A';
                      const t2Name = match.team2 || 'Team B';

                      return (
                        <div 
                          key={match._id || index}
                          onClick={() => navigate(`/livescore/${match._id}`)}
                          title="Click to control live score"
                          style={{ 
                            background: '#fff', 
                            border: '1px solid #e0e0e0', 
                            borderRadius: '8px', 
                            padding: '15px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            borderLeft: '4px solid #0ea5e9'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#f0fdf4'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#666', marginBottom: '8px', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>
                            <div>
                              <span style={{ background: '#0ea5e9', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', marginRight: '6px' }}>
                                {num}{suffix} Match
                              </span>
                              {match.group && (
                                <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', marginRight: '6px' }}>
                                  {match.group}
                                </span>
                              )}
                              {match.stage && match.stage !== 'League' && (
                                <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', marginRight: '6px' }}>
                                  {match.stage}
                                </span>
                              )}
                              <span>{match.date ? new Date(match.date).toLocaleString() : 'Date TBA'}</span>
                            </div>

                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <button 
                                onClick={(e) => handleEditSchedule(match, e)}
                                title="Edit Schedule"
                                style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', padding: '3px 6px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                ✏️
                              </button>
                              <button 
                                onClick={(e) => handleDeleteSchedule(match._id, e)}
                                title="Delete Schedule"
                                style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '3px 6px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ 
                                width: '28px', height: '28px', borderRadius: '50%', background: '#a5d6a7', color: '#1b5e20', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' 
                              }}>
                                {getTeamInitials(t1Name)}
                              </span>
                              <span style={{ fontWeight: '600', fontSize: '15px', color: '#1e293b' }}>{t1Name}</span>
                            </div>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>
                              {match.team1Score || '0/0'} <span style={{ fontSize: '12px', color: '#64748b' }}>({match.team1Overs || '0.0'})</span>
                            </span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ 
                                width: '28px', height: '28px', borderRadius: '50%', background: '#ffccbc', color: '#bf360c', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' 
                              }}>
                                {getTeamInitials(t2Name)}
                              </span>
                              <span style={{ fontWeight: '600', fontSize: '15px', color: '#1e293b' }}>{t2Name}</span>
                            </div>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>
                              {match.team2Score || '0/0'} <span style={{ fontSize: '12px', color: '#64748b' }}>({match.team2Overs || '0.0'})</span>
                            </span>
                          </div>

                          {match.result || match.outcome?.summary || match.overview ? (
                            <div style={{ fontSize: '13px', color: '#16a34a', fontWeight: '600', marginBottom: '10px' }}>
                              {match.result || match.outcome?.summary || match.overview}
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#d97706', fontWeight: '500', marginBottom: '10px' }}>
                              Match status: {statusInfo.text}
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f1f1', paddingTop: '8px', fontSize: '12px' }}>
                            <span style={{ color: '#64748b', fontWeight: '500' }}>
                              📍 {match.venue || activeTournament.venue || 'Venue TBA'}
                            </span>

                            {match.result || match.outcome?.summary || match.overview ? (
                              <span 
                                onClick={(e) => { e.stopPropagation(); setSelectedMatchResult(match); }}
                                style={{ color: '#2563eb', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                Scoreboard Details
                              </span>
                            ) : (
                              <span style={{ color: '#0ea5e9', fontWeight: '600' }}>
                                Tap to Control &rarr;
                              </span>
                            )}
                          </div>

                        </div>
                      );
                    })
                )}
              </div>
            </div>

          </div>
        </div>
      ) : null}

      {/* Match Result Details Modal */}
      {selectedMatchResult && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '450px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', position: 'relative' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#1e293b', fontSize: '18px' }}>Match Result Details</h3>
            <div style={{ fontSize: '14px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              <div><strong>Match:</strong> {selectedMatchResult.team1} vs {selectedMatchResult.team2}</div>
              <div><strong>Summary / Result:</strong> {selectedMatchResult.result || selectedMatchResult.outcome?.summary || selectedMatchResult.overview || 'No result data recorded.'}</div>
              {selectedMatchResult.group && <div><strong>Group:</strong> {selectedMatchResult.group}</div>}
              {selectedMatchResult.stage && <div><strong>Stage:</strong> {selectedMatchResult.stage}</div>}
              {selectedMatchResult.outcome?.kind && (
                <div>
                  <strong>Point table data:</strong>{' '}
                  {selectedMatchResult.outcome.kind === 'runs' && `${selectedMatchResult.outcome.winner} won by ${selectedMatchResult.outcome.margin} runs`}
                  {selectedMatchResult.outcome.kind === 'wickets' && `${selectedMatchResult.outcome.winner} won by ${selectedMatchResult.outcome.margin} wickets${selectedMatchResult.outcome.ballsLeft ? ` (${selectedMatchResult.outcome.ballsLeft} balls left)` : ''}`}
                  {selectedMatchResult.outcome.kind === 'tie' && 'Tied'}
                  {selectedMatchResult.outcome.kind === 'no_result' && 'No result'}
                </div>
              )}
              <div><strong>Venue:</strong> {selectedMatchResult.venue || 'N/A'}</div>
              <div><strong>Date:</strong> {selectedMatchResult.date ? new Date(selectedMatchResult.date).toLocaleString() : 'N/A'}</div>
            </div>
            <button 
              onClick={() => setSelectedMatchResult(null)}
              style={{ width: '100%', padding: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default CTournamentManage;