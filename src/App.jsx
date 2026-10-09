import React from 'react';
import { Routes, Route, Navigate, Link, Outlet, useNavigate } from 'react-router-dom';
import CTournamentManage from './pages/cTournamentManage';
import CLiveScoreControl from './pages/cLiveScoreControl';
import AuctionControl from './pages/AuctionControl';
import TeamPlayerManage from './pages/TeamPlayerManage';
import Login from './pages/Login';

function ProtectedLayout() {
  const navigate = useNavigate();
  if (!localStorage.getItem('admin_token')) return <Navigate to="/login" replace />;
  const logout = () => { localStorage.removeItem('admin_token'); navigate('/login'); };

  return (
    <>
      <nav style={{ display: 'flex', gap: 20, padding: '12px 24px', background: '#0a1a38', fontFamily: 'sans-serif' }}>
        <Link to="/admin/teams" style={{ color: '#fff' }}>Teams & Players</Link>
        <Link to="/admin/tournaments" style={{ color: '#fff' }}>Tournaments</Link>
        <Link to="/admin/live" style={{ color: '#fff' }}>Live Control</Link>
        <Link to="/admin/auction" style={{ color: '#fff' }}>Auction</Link>
        <button onClick={logout} style={{ marginLeft: 'auto' }}>Logout</button>
      </nav>
      <Outlet />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/admin/tournaments" replace />} />
        <Route path="/admin/tournaments" element={<CTournamentManage />} />
        <Route path="/admin/live" element={<CLiveScoreControl />} />
        <Route path="/admin/live/:matchId" element={<CLiveScoreControl />} />
        <Route path="/admin/teams" element={<TeamPlayerManage />} />
        <Route path="/admin/auction" element={<AuctionControl />} />
      </Route>
    </Routes>
  );
}