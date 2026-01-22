const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
app.use(cors());
app.use(express.json());

let notifications = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'REQUEST_STATUS_CHANGED',
    title: 'Request processed',
    message: 'Your request #R-123 has moved to PROCESSING.',
    entity_type: 'request',
    entity_id: 'R-123',
    is_read: false,
    created_at: new Date().toISOString()
  }
];

app.get('/notifications', (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  res.json({
    success: true,
    data: notifications,
    pagination: { page, limit, total: notifications.length }
  });
});

// POST /notifications -> push a new notification (for testing)
app.post('/notifications', (req, res) => {
  const body = req.body || {};
  const id = body.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
  const notif = {
    id,
    type: body.type || 'REQUEST_STATUS_CHANGED',
    title: body.title || 'Test notification',
    message: body.message || 'New test notification',
    entity_type: body.entity_type || 'request',
    entity_id: body.entity_id || null,
    is_read: false,
    created_at: new Date().toISOString()
  };

  // add to front so it's visible on next fetch
  notifications.unshift(notif);

  return res.json({ success: true, data: notif });
});

app.patch('/notifications/:id/read', (req, res) => {
  const id = req.params.id;
  const idx = notifications.findIndex(n => n.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
  notifications[idx].is_read = true;
  res.json({ success: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mock notifications server listening on ${port}`));
