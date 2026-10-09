import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginApi } from '../services/capi';
export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await loginApi(password);
      localStorage.setItem('admin_token', data.token);
      navigate('/admin/tournaments', { replace: true });
    } catch {
      setError('Password ভুল');
    }
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: '100px auto', fontFamily: 'sans-serif' }}>
      <h2>Admin Login</h2>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Password" style={{ width: '100%', padding: 10, marginBottom: 10 }} />
      <button type="submit" style={{ width: '100%', padding: 10 }}>Login</button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </form>
  );
}