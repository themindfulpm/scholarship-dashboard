const { json, appendActivity, reserveSendQuota, loadRecords } = require('./_crmStore');
const { sendMessages } = require('./_mailClient');

function normalizeMessages(payload) {
  if (Array.isArray(payload.messages)) {
    return payload.messages;
  }

  if (payload.to && payload.subject && payload.body) {
    return [{ to: payload.to, subject: payload.subject, body: payload.body, html: payload.html || '' }];
  }

  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const messages = normalizeMessages(payload).filter((message) => message.to && message.subject && message.body);

    if (messages.length === 0) {
      return json(400, { error: 'No valid messages provided.' });
    }
    const records = await loadRecords(event);
    const unsubscribedEmails = new Set(
      records
        .filter((record) => record.unsubscribed)
        .map((record) => String(record.email || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const deliverableMessages = messages.filter(
      (message) => !unsubscribedEmails.has(String(message.to || '').trim().toLowerCase())
    );
    const skippedUnsubscribed = messages.length - deliverableMessages.length;

    if (deliverableMessages.length === 0) {
      await appendActivity(event, {
        type: 'warning',
        source: 'send-email',
        message: `Send skipped. ${skippedUnsubscribed} recipient(s) unsubscribed.`,
      });
      return json(200, {
        ok: true,
        requested: messages.length,
        sent: 0,
        skipped: messages.length,
        skippedUnsubscribed,
      });
    }

    const quota = await reserveSendQuota(event, deliverableMessages.length);
    if (quota.allowedCount === 0) {
      await appendActivity(event, {
        type: 'warning',
        source: 'send-email',
        message: `Send blocked by cap. Requested ${deliverableMessages.length}, max per run ${quota.maxPerRun}, max per day ${quota.maxPerDay}, used today ${quota.usedToday}.`,
        details: quota,
      });
      return json(429, {
        error: `Email cap reached. Max per run ${quota.maxPerRun}, max per day ${quota.maxPerDay}, used today ${quota.usedToday}.`,
      });
    }

    const approvedMessages = deliverableMessages.slice(0, quota.allowedCount);
    await sendMessages(approvedMessages);

    const skipped = deliverableMessages.length - approvedMessages.length;
    await appendActivity(event, {
      type: 'success',
      source: 'send-email',
      message: `Sent ${approvedMessages.length} email(s).${skipped > 0 ? ` Skipped ${skipped} due to caps.` : ''}${skippedUnsubscribed > 0 ? ` Skipped ${skippedUnsubscribed} unsubscribed.` : ''}`,
      details: {
        requested: messages.length,
        deliverable: deliverableMessages.length,
        sent: approvedMessages.length,
        skipped,
        skippedUnsubscribed,
        quota,
      },
    });

    return json(200, {
      ok: true,
      requested: messages.length,
      deliverable: deliverableMessages.length,
      sent: approvedMessages.length,
      skipped: skipped + skippedUnsubscribed,
      skippedUnsubscribed,
      quota,
    });
  } catch (error) {
    try {
      await appendActivity(event, {
        type: 'error',
        source: 'send-email',
        message: `Send failed: ${error.message || 'Unknown error'}`,
      });
    } catch {
      // If logging fails, still return the original send error.
    }
    return json(500, { error: error.message || 'Email send failed.' });
  }
};
