const { json, appendActivity } = require('./_crmStore');
const { verifyTransport } = require('./_mailClient');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    await verifyTransport();
    await appendActivity(event, {
      type: 'success',
      source: 'smtp-health',
      message: 'SMTP health check passed.',
    });
    return json(200, { ok: true, message: 'SMTP connection verified.' });
  } catch (error) {
    await appendActivity(event, {
      type: 'error',
      source: 'smtp-health',
      message: `SMTP health check failed: ${error.message || 'Unknown error'}`,
    });
    return json(500, { error: error.message || 'SMTP health check failed.' });
  }
};
