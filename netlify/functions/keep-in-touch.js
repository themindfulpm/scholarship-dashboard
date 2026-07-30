const { randomUUID } = require('crypto');
const { loadRecords, saveRecords, json, appendActivity } = require('./_crmStore');

function normalize(value) {
  return String(value ?? '').trim();
}

function ensureSubscriptionFields(record) {
  return {
    ...record,
    unsubscribed: Boolean(record.unsubscribed),
    unsubscribeToken: normalize(record.unsubscribeToken) || randomUUID(),
    unsubscribedAt: record.unsubscribed ? normalize(record.unsubscribedAt) || new Date().toISOString() : '',
  };
}

function buildFullName(firstName, lastName) {
  return `${normalize(firstName)} ${normalize(lastName)}`.trim();
}

function mergeKeepInTouchRecord(existing, incoming) {
  const pick = (current, next) => normalize(next) || current;
  return ensureSubscriptionFields({
    ...existing,
    firstName: pick(existing.firstName, incoming.firstName),
    lastName: pick(existing.lastName, incoming.lastName),
    name: pick(existing.name, incoming.name),
    company: pick(existing.company, incoming.company),
    email: pick(existing.email, incoming.email),
    phone: pick(existing.phone, incoming.phone),
    type: 'contact',
    status: existing.status || 'new',
    isReferral: Boolean(existing.isReferral),
    referralSource: existing.referralSource || '',
    notes: incoming.notes || existing.notes || '',
    revenue: Number(existing.revenue) || 0,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const firstName = normalize(payload.firstName);
    const lastName = normalize(payload.lastName);
    const email = normalize(payload.email);
    const phone = normalize(payload.phone);

    if (!firstName || !lastName || !email || !phone) {
      return json(400, { error: 'First name, last name, email, and phone are required.' });
    }

    const incoming = ensureSubscriptionFields({
      id: randomUUID(),
      firstName,
      lastName,
      name: buildFullName(firstName, lastName),
      company: '',
      email,
      phone,
      type: 'contact',
      status: 'new',
      isReferral: false,
      referralSource: '',
      revenue: 0,
      notes: 'Submitted via Lets Keep In Touch form.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const records = await loadRecords(event);
    const emailKey = email.toLowerCase();
    const phoneKey = phone.replace(/\D/g, '');

    const existingIndex = records.findIndex((record) => {
      const recordEmail = normalize(record.email).toLowerCase();
      const recordPhone = normalize(record.phone).replace(/\D/g, '');
      return (emailKey && recordEmail === emailKey) || (phoneKey && recordPhone === phoneKey);
    });

    let updatedRecords;
    if (existingIndex >= 0) {
      const existing = records[existingIndex];
      const merged = mergeKeepInTouchRecord(existing, incoming);
      updatedRecords = [...records];
      updatedRecords[existingIndex] = merged;
    } else {
      updatedRecords = [incoming, ...records];
    }

    await saveRecords(event, updatedRecords);

    try {
      await appendActivity(event, {
        type: 'info',
        source: 'keep-in-touch',
        message: `Keep In Touch form submitted for ${email}.`,
      });
    } catch {
      // Ignore activity log failures for public form submissions.
    }

    return json(200, {
      ok: true,
      message: 'Thank you! You have been added to the mailing list!',
    });
  } catch (error) {
    return json(500, { error: error.message || 'Unable to save contact.' });
  }
};
