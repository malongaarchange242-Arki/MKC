import axios from 'https://cdn.jsdelivr.net/npm/axios@1.6.8/+esm';

const API_BASE = 'https://mkc-backend-kqov.onrender.com';
const PYTHON_BASE = 'https://mkc-5slv.onrender.com/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
});

export const pythonApi = axios.create({
  baseURL: PYTHON_BASE,
  headers: {
    'x-api-key': 'FERI_AD_INTERNAL_KEY'
  }
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
