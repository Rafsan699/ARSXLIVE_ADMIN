import axios from 'axios';
const base = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// admin pages call '/tournaments', '/live-score/...', '/teams', '/club/players'
const API = axios.create({ baseURL: `${base}/api/cricket` });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const loginApi = (password) => axios.post(`${base}/api/admin/login`, { password });
export default API;