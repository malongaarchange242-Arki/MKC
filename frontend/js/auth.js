import { api } from './axios.config.js';

export async function login(email, password) {
  const res = await api.post('/auth/login', { email, password });
  // adapt to your backend response shape
  const token = res.data?.access_token || res.data?.session?.access_token || (res.data?.token);
  const user = res.data?.user || res.data?.profile || null;
  if (token) localStorage.setItem('access_token', token);
  if (user) localStorage.setItem('user', JSON.stringify(user));
  return res;
}

export async function register(payload) {
  return api.post('/auth/register', payload);
}

export function logout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

export function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}
