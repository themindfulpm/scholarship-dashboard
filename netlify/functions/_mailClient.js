const nodemailer = require('nodemailer');

function readRequired(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function isSecure(port, override) {
  if (typeof override === 'string' && override.length > 0) {
    return ['1', 'true', 'yes'].includes(override.toLowerCase());
  }
  return String(port) === '465';
}

function createTransport() {
  const host = readRequired('SMTP_HOST');
  const port = Number(readRequired('SMTP_PORT'));
  const user = readRequired('SMTP_USER');
  const pass = readRequired('SMTP_PASS');
  const secure = isSecure(port, process.env.SMTP_SECURE);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

async function verifyTransport() {
  const transport = createTransport();
  await transport.verify();
}

async function sendMessages(messages) {
  const fromEmail = readRequired('EMAIL_FROM');
  const transport = createTransport();

  for (const message of messages) {
    await transport.sendMail({
      to: message.to,
      from: fromEmail,
      subject: message.subject,
      text: message.body,
      html: message.html || undefined,
    });
  }
}

module.exports = {
  sendMessages,
  verifyTransport,
};
