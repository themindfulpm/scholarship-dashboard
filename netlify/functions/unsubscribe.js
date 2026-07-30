const { loadRecords, saveRecords, appendActivity } = require('./_crmStore');

function htmlPage(title, message) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
    .wrap { max-width: 640px; margin: 64px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
    h1 { margin-top: 0; font-size: 24px; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Method not allowed',
    };
  }

  const token = String(event.queryStringParameters?.token || '').trim();
  if (!token) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Unsubscribe Link Invalid', 'This unsubscribe link is missing a token. Please use the link directly from your email.'),
    };
  }

  try {
    const records = await loadRecords(event);
    const index = records.findIndex((record) => String(record.unsubscribeToken || '') === token);

    if (index < 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlPage('Subscriber Not Found', 'We could not find a subscriber for this link. You may already be removed or the link may be expired.'),
      };
    }

    const record = records[index];
    if (record.unsubscribed) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlPage('Already Unsubscribed', 'You are already unsubscribed from future newsletter and marketing messages.'),
      };
    }

    const updated = [...records];
    updated[index] = {
      ...record,
      unsubscribed: true,
      unsubscribedAt: new Date().toISOString(),
    };

    await saveRecords(event, updated);
    await appendActivity(event, {
      type: 'info',
      source: 'unsubscribe',
      message: `Unsubscribed ${record.email || 'unknown email'} via public link.`,
      details: {
        recordId: record.id || null,
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Unsubscribed Successfully', 'You have been removed from future newsletter and outreach emails. You can re-subscribe by contacting us directly.'),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Something Went Wrong', error.message || 'Unable to process unsubscribe right now.'),
    };
  }
};
