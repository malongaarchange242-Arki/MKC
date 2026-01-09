import { api } from './axios.config.js';

export async function getNotifications() {
  return api.get('/notifications').then(r => r.data);
}

export async function markAsRead(id) {
  return api.patch(`/notifications/${id}/read`).then(r => r.data);
}
