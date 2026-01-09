const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const nodemailer = require('nodemailer');

(async function run() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM || process.env.MAIL_FROM || 'no-reply@example.com';
  const to = user || process.env.TEST_EMAIL || '';

  if (!host) {
    console.error('SMTP_HOST not set in environment. Aborting.');
    process.exit(1);
  }
  if (!to) {
    console.error('No recipient address available (set SMTP_USER or TEST_EMAIL). Aborting.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false }
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: 'Test email - Notifications config',
      text: 'This is a test email sent from send_test_notification.js to verify SMTP settings.'
    });

    console.log('Message sent:', info && info.messageId ? info.messageId : info);
    process.exit(0);
  } catch (err) {
    console.error('Failed to send test email:', err);
    process.exit(1);
  }
})();
