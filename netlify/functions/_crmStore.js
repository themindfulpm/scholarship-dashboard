const { connectLambda, getStore } = require('@netlify/blobs');

function getRuntimeStore(event) {
  connectLambda(event);
  return getStore('crm-automation');
}

async function loadRecords(event) {
  const store = getRuntimeStore(event);
  const payload = await store.get('records', { type: 'json' });
  return payload?.records || [];
}

async function saveRecords(event, records) {
  const store = getRuntimeStore(event);
  await store.setJSON('records', {
    updatedAt: new Date().toISOString(),
    records,
  });
}

async function loadCampaigns(event) {
  const store = getRuntimeStore(event);
  return (await store.get('campaigns', { type: 'json' })) || [];
}

async function saveCampaigns(event, campaigns) {
  const store = getRuntimeStore(event);
  await store.setJSON('campaigns', campaigns);
}

async function loadActivityLog(event) {
  const store = getRuntimeStore(event);
  const payload = await store.get('activity-log', { type: 'json' });
  return Array.isArray(payload) ? payload : [];
}

async function appendActivity(event, entry) {
  const MAX_ITEMS = 200;
  const current = await loadActivityLog(event);
  const nextEntry = {
    timestamp: new Date().toISOString(),
    type: 'info',
    source: 'system',
    message: '',
    ...entry,
  };
  const updated = [nextEntry, ...current].slice(0, MAX_ITEMS);
  const store = getRuntimeStore(event);
  await store.setJSON('activity-log', updated);
  return nextEntry;
}

function readPositiveInt(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return Math.floor(parsed);
}

function getQuotaConfig() {
  return {
    maxPerRun: readPositiveInt(process.env.MAX_EMAILS_PER_RUN, 100),
    maxPerDay: readPositiveInt(process.env.MAX_EMAILS_PER_DAY, 500),
  };
}

async function reserveSendQuota(event, requestedCount, options = {}) {
  const commit = options.commit !== false;
  const store = getRuntimeStore(event);
  const config = getQuotaConfig();
  const payload = (await store.get('email-quota', { type: 'json' })) || {};
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = payload.date === today ? Number(payload.used || 0) : 0;
  const remainingToday = Math.max(0, config.maxPerDay - usedToday);
  const allowedCount = Math.max(0, Math.min(requestedCount, config.maxPerRun, remainingToday));
  const nextUsedToday = usedToday + (commit ? allowedCount : 0);

  if (commit) {
    await store.setJSON('email-quota', {
      date: today,
      used: nextUsedToday,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    requestedCount,
    allowedCount,
    usedToday: nextUsedToday,
    remainingToday,
    maxPerRun: config.maxPerRun,
    maxPerDay: config.maxPerDay,
    limitedByRun: requestedCount > config.maxPerRun,
    limitedByDay: requestedCount > remainingToday,
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function fillEmailTemplate(template, record, senderName, stepNumber = 1, unsubscribeUrl = '') {
  const firstName = String(record.firstName || '').trim() || String(record.name || '').trim().split(' ')[0] || 'there';
  const lastName = String(record.lastName || '').trim() || String(record.name || '').trim().split(' ').slice(1).join(' ');
  const fullName = `${firstName} ${lastName}`.trim() || firstName;
  const company = record.company || 'your team';
  const sender = senderName || 'Your Name';
  const step = String(stepNumber);

  const replaceFields = (text) =>
    String(text)
      .replaceAll('{{name}}', firstName)
      .replaceAll('{{firstName}}', firstName)
      .replaceAll('{{lastName}}', lastName)
      .replaceAll('{{fullName}}', fullName)
      .replaceAll('{{company}}', company)
      .replaceAll('{{sender}}', sender)
      .replaceAll('{{step}}', step)
      .replaceAll('{{unsubscribeUrl}}', unsubscribeUrl || '');

  return {
    subject: replaceFields(template.subject),
    body: replaceFields(template.body),
  };
}

function matchesAudience(record, audience) {
  if (!record.email) return false;
  if (record.unsubscribed) return false;

  switch (audience) {
    case 'lead':
      return record.type === 'lead';
    case 'contact':
      return record.type === 'contact';
    case 'referral':
      return Boolean(record.isReferral);
    case 'converted':
      return record.status === 'converted';
    case 'all':
    default:
      return true;
  }
}

module.exports = {
  loadRecords,
  saveRecords,
  loadCampaigns,
  saveCampaigns,
  loadActivityLog,
  appendActivity,
  reserveSendQuota,
  json,
  fillEmailTemplate,
  matchesAudience,
};
