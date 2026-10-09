import axios from 'axios';
// admin pages call '/tournaments', '/live-score/...', '/teams', '/club/players'
const API = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/cricket` });
export default API;
