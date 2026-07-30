const { randomUUID } = require('crypto');
const { json, loadRecords, saveRecords } = require('./_crmStore');

function ensureSubscriptionFields(record) {
  return {
    ...record,
    unsubscribed: Boolean(record.unsubscribed),
    unsubscribeToken: String(record.unsubscribeToken || '').trim() || randomUUID(),
    unsubscribedAt: record.unsubscribed ? String(record.unsubscribedAt || new Date().toISOString()) : '',
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const records = await loadRecords(event);
      const normalized = records.map((record) => ensureSubscriptionFields(record));
      return json(200, { count: normalized.length, records: normalized });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const records = Array.isArray(payload.records) ? payload.records.map((record) => ensureSubscriptionFields(record)) : [];
      await saveRecords(event, records);
      return json(200, { ok: true, count: records.length });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(500, { error: error.message || 'Failed to handle records' });
  }
};
