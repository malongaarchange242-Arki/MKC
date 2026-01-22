import { api } from './axios.config.js';

export async function listUsers() {
  return api.get('/admin/users');
}

export async function promoteUser(userId, role) {
  return api.patch(`/admin/users/${userId}/role`, { role });
}

export async function generateFERI(requestId) {
  return api.post(`/admin/requests/${requestId}/generate-feri`);
}

export async function generateAD(requestId) {
  return api.post(`/admin/requests/${requestId}/generate-ad`);
}
