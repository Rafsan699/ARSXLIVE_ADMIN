import React from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import CTournamentManage from './pages/cTournamentManage';
import CLiveScoreControl from './pages/cLiveScoreControl';
import AuctionControl from './pages/AuctionControl';
import TeamPlayerManage from './pages/TeamPlayerManage';

export default function App() {
  return (
    <>
      <nav style={{ display: 'flex', gap: 20, padding: '12px 24px', background: '#0a1a38', fontFamily: 'sans-serif' }}>
        <Link to="/admin/teams" style={{ color: '#fff' }}>Teams & Players</Link>
        <Link to="/admin/tournaments" style={{ color: '#fff' }}>Tournaments</Link>
        <Link to="/admin/live" style={{ color: '#fff' }}>Live Control</Link>
        <Link to="/admin/auction" style={{ color: '#fff' }}>Auction</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/tournaments" replace />} />
        <Route path="/admin/tournaments" element={<CTournamentManage />} />
        <Route path="/admin/live" element={<CLiveScoreControl />} />
        <Route path="/admin/live/:matchId" element={<CLiveScoreControl />} />
        <Route path="/admin/teams" element={<TeamPlayerManage />} />
        <Route path="/admin/auction" element={<AuctionControl />} />
      </Routes>
    </>
  );
}
