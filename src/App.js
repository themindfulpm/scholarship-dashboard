import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';

const STORAGE_KEY = 'simple-crm-records-v1';
const TEMPLATE_STORAGE_KEY = 'simple-crm-templates-v1';
const STATUS_OPTIONS = ['new', 'qualified', 'converted', 'lost'];
const TYPE_OPTIONS = ['lead', 'contact'];
const IMPORT_MODE_OPTIONS = ['skip', 'merge'];
const API_BASE = '/.netlify/functions';
const MASS_SEND_CONFIRM_THRESHOLD = 25;
const WEEKLY_CHECKLIST_STORAGE_KEY = 'simple-crm-weekly-checklist-v1';
const NEWSLETTER_DRAFT_STORAGE_KEY = 'simple-crm-newsletter-draft-v1';
const KEEP_IN_TOUCH_PATH = '/lets-keep-in-touch.html';
const EST_REFRESH_UTC_HOURS = [2, 11];
const NEWSLETTER_CONNECT_LINKS_DEFAULT = [
  'LinkedIn: https://www.linkedin.com/in/rashida-parrish-atkinson-pmp/',
  'Website: https://mindfulprojectmanager.com/',
  'Email: mailto:rashida.l.parrish@gmail.com',
].join('\n');
const DRIP_AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All contacts with email' },
  { value: 'lead', label: 'Leads only' },
  { value: 'contact', label: 'Contacts only' },
  { value: 'referral', label: 'Referrals only' },
  { value: 'converted', label: 'Converted only' },
];
const CSV_HEADERS = [
  'id',
  'firstName',
  'lastName',
  'name',
  'company',
  'email',
  'phone',
  'type',
  'status',
  'isReferral',
  'referralSource',
  'revenue',
  'notes',
  'unsubscribed',
  'unsubscribeToken',
  'unsubscribedAt',
  'createdAt',
];
const EMAIL_TEMPLATES = {
  intro: {
    label: 'Introduction',
    subject: 'Quick intro from {{company}}',
    body:
      'Hi {{name}},\n\nI wanted to connect and see if we can support your current priorities at {{company}}.\n\nIf helpful, I can share a short overview and a few next steps.\n\nBest,\n{{sender}}',
  },
  followup: {
    label: 'Follow-up',
    subject: 'Following up on our conversation',
    body:
      'Hi {{name}},\n\nFollowing up on my earlier note. If this is still relevant, I would love to schedule 15 minutes this week.\n\nBest,\n{{sender}}',
  },
  converted: {
    label: 'Welcome / Thank You',
    subject: 'Welcome aboard, {{name}}',
    body:
      'Hi {{name}},\n\nThank you for moving forward with us. We are excited to support your team at {{company}}.\n\nI will follow up with next steps shortly.\n\nBest,\n{{sender}}',
  },
};

function getDefaultTemplates() {
  return Object.entries(EMAIL_TEMPLATES).map(([key, value]) => ({
    key,
    label: value.label,
    subject: value.subject,
    body: value.body,
  }));
}

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return getDefaultTemplates();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return getDefaultTemplates();

    const byKey = new Map(parsed.map((template) => [template.key, template]));
    return getDefaultTemplates().map((template) => {
      const stored = byKey.get(template.key);
      return stored
        ? {
            ...template,
            label: stored.label || template.label,
            subject: stored.subject || template.subject,
            body: stored.body || template.body,
          }
        : template;
    });
  } catch {
    return getDefaultTemplates();
  }
}

const defaultForm = {
  firstName: '',
  lastName: '',
  company: '',
  email: '',
  phone: '',
  type: 'lead',
  status: 'new',
  isReferral: false,
  referralSource: '',
  revenue: '',
  notes: '',
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function defaultCampaignForm() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return {
    name: 'New Drip Campaign',
    audience: 'all',
    templateKey: 'followup',
    startAt: local,
    intervalDays: '3',
    totalSteps: '3',
  };
}

function defaultNewsletterForm() {
  const dateLabel = new Date().toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    issueLabel: dateLabel,
    subject: `Weekly Mindful Update - ${dateLabel}`,
    greeting:
      'I am glad you are here. I wanted to share a thoughtful update and a few ways to stay connected this week.',
    whatsNewUpdates:
      '- A fresh weekly reflection is now available.\n- I have been refining resources to make your next step feel clearer and more intentional.',
    upcomingOfferings:
      '- Group mindfulness session this Wednesday\n- Private coaching spots available next week',
    mindfulMoment:
      '- Pause for 60 seconds before your first meeting and take five slow breaths.\n- End your day by naming one thing that felt steady or supportive.',
    closingQuote:
      'Small pauses create spacious days.',
    closingQuoteAttribution: 'A reminder for the week ahead',
    ctaText: 'Schedule your discovery call',
    ctaUrl: 'https://calendly.com/rashida-l-parrish/20-minute-discovery-call',
    connectLinks: NEWSLETTER_CONNECT_LINKS_DEFAULT,
  };
}

function loadNewsletterDraft() {
  try {
    const stored = localStorage.getItem(NEWSLETTER_DRAFT_STORAGE_KEY);
    if (!stored) return defaultNewsletterForm();

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      return defaultNewsletterForm();
    }

    return {
      ...defaultNewsletterForm(),
      ...parsed,
    };
  } catch {
    return defaultNewsletterForm();
  }
}

function getCurrentWeekKey() {
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function defaultWeeklyChecklist() {
  return {
    weekKey: getCurrentWeekKey(),
    syncContacts: false,
    smtpHealth: false,
    testNewsletter: false,
    reviewNewsletter: false,
    refreshLog: false,
  };
}

function loadWeeklyChecklist() {
  try {
    const stored = localStorage.getItem(WEEKLY_CHECKLIST_STORAGE_KEY);
    if (!stored) return defaultWeeklyChecklist();

    const parsed = JSON.parse(stored);
    const currentWeekKey = getCurrentWeekKey();
    if (!parsed || parsed.weekKey !== currentWeekKey) {
      return defaultWeeklyChecklist();
    }

    return {
      ...defaultWeeklyChecklist(),
      ...parsed,
      weekKey: currentWeekKey,
    };
  } catch {
    return defaultWeeklyChecklist();
  }
}

function escapeCsv(value) {
  const input = String(value ?? '');
  const escaped = input.replace(/"/g, '""');
  return `"${escaped}"`;
}

function toCsv(records) {
  const headerLine = CSV_HEADERS.join(',');
  const dataLines = records.map((record) =>
    CSV_HEADERS.map((header) => escapeCsv(record[header])).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const content = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const mapped = {};
    headers.forEach((header, index) => {
      mapped[header] = values[index] ?? '';
    });
    return mapped;
  });
}

function normalizeImportedRecord(row) {
  const read = (field) => String(row[field] ?? '').trim();
  const firstName = read('firstName') || read('first_name');
  const lastName = read('lastName') || read('last_name');
  const legacyName = read('name');
  const normalizedFirstName = firstName || legacyName.split(' ')[0] || '';
  const normalizedLastName = lastName || legacyName.split(' ').slice(1).join(' ');
  const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim();
  const email = read('email');
  const phone = read('phone');

  if (!normalizedFirstName || (!email && !phone)) {
    return null;
  }

  const type = TYPE_OPTIONS.includes(read('type').toLowerCase()) ? read('type').toLowerCase() : 'lead';
  const status = STATUS_OPTIONS.includes(read('status').toLowerCase()) ? read('status').toLowerCase() : 'new';
  const isReferral = ['true', 'yes', '1'].includes(read('isReferral').toLowerCase());
  const revenueValue = Number(read('revenue'));
  const revenue = Number.isFinite(revenueValue) && revenueValue > 0 ? revenueValue : 0;
  const createdAt = Date.parse(read('createdAt')) ? new Date(read('createdAt')).toISOString() : new Date().toISOString();
  const unsubscribed = ['true', 'yes', '1'].includes(read('unsubscribed').toLowerCase());
  const unsubscribeToken = read('unsubscribeToken') || crypto.randomUUID();
  const unsubscribedAt = unsubscribed
    ? (Date.parse(read('unsubscribedAt')) ? new Date(read('unsubscribedAt')).toISOString() : new Date().toISOString())
    : '';

  return {
    id: read('id') || crypto.randomUUID(),
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    name: fullName,
    company: read('company'),
    email,
    phone,
    type,
    status,
    isReferral,
    referralSource: isReferral ? read('referralSource') : '',
    revenue,
    notes: read('notes'),
    unsubscribed,
    unsubscribeToken,
    unsubscribedAt,
    createdAt,
  };
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

function getDuplicateKey(record) {
  const email = String(record.email ?? '').trim().toLowerCase();
  if (email) return `email:${email}`;

  const phone = normalizePhone(record.phone);
  if (phone) return `phone:${phone}`;

  const firstName = String(record.firstName ?? '').trim().toLowerCase();
  const lastName = String(record.lastName ?? '').trim().toLowerCase();
  const name = `${firstName} ${lastName}`.trim() || String(record.name ?? '').trim().toLowerCase();
  const company = String(record.company ?? '').trim().toLowerCase();
  return `name-company:${name}|${company}`;
}

function mergeRecord(existing, incoming) {
  const pick = (current, next) => {
    const value = String(next ?? '').trim();
    return value ? value : current;
  };

  const incomingRevenue = Number(incoming.revenue);
  const hasIncomingRevenue = Number.isFinite(incomingRevenue) && incomingRevenue > 0;
  const shouldUseIncomingReferral = incoming.isReferral || existing.isReferral;

  return {
    ...existing,
    firstName: pick(existing.firstName, incoming.firstName),
    lastName: pick(existing.lastName, incoming.lastName),
    name: pick(existing.name, incoming.name),
    company: pick(existing.company, incoming.company),
    email: pick(existing.email, incoming.email),
    phone: pick(existing.phone, incoming.phone),
    type: incoming.type || existing.type,
    status: incoming.status || existing.status,
    isReferral: shouldUseIncomingReferral,
    referralSource: shouldUseIncomingReferral
      ? pick(existing.referralSource, incoming.referralSource)
      : '',
    revenue: hasIncomingRevenue ? incomingRevenue : Number(existing.revenue) || 0,
    notes: pick(existing.notes, incoming.notes),
    unsubscribed: Boolean(existing.unsubscribed || incoming.unsubscribed),
    unsubscribeToken: pick(existing.unsubscribeToken, incoming.unsubscribeToken) || crypto.randomUUID(),
    unsubscribedAt: existing.unsubscribedAt || incoming.unsubscribedAt || '',
    createdAt: existing.createdAt,
  };
}

function ensureSubscriptionFields(record) {
  return {
    ...record,
    unsubscribed: Boolean(record.unsubscribed),
    unsubscribeToken: String(record.unsubscribeToken || '').trim() || crypto.randomUUID(),
    unsubscribedAt: record.unsubscribed ? String(record.unsubscribedAt || new Date().toISOString()) : '',
  };
}

function mergeRecordCollections(baseRecords, incomingRecords) {
  const nextRecords = [...baseRecords.map((record) => ensureSubscriptionFields(record))];
  const keyToIndex = new Map();
  let addedCount = 0;
  let mergedCount = 0;

  nextRecords.forEach((record, index) => {
    keyToIndex.set(getDuplicateKey(record), index);
  });

  incomingRecords.forEach((record) => {
    const normalized = ensureSubscriptionFields(record);
    const key = getDuplicateKey(normalized);
    const existingIndex = keyToIndex.get(key);

    if (existingIndex === undefined) {
      nextRecords.push(normalized);
      keyToIndex.set(key, nextRecords.length - 1);
      addedCount += 1;
      return;
    }

    const merged = ensureSubscriptionFields(mergeRecord(nextRecords[existingIndex], normalized));
    nextRecords[existingIndex] = merged;
    mergedCount += 1;

    const mergedKey = getDuplicateKey(merged);
    if (mergedKey !== key) {
      keyToIndex.delete(key);
      keyToIndex.set(mergedKey, existingIndex);
    }
  });

  return {
    records: nextRecords,
    addedCount,
    mergedCount,
  };
}

function deriveNames(record) {
  const existingFirst = String(record.firstName || '').trim();
  const existingLast = String(record.lastName || '').trim();

  if (existingFirst || existingLast) {
    return {
      firstName: existingFirst,
      lastName: existingLast,
      fullName: `${existingFirst} ${existingLast}`.trim(),
    };
  }

  const legacy = String(record.name || '').trim();
  const parts = legacy.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
  };
}

function displayName(record) {
  const names = deriveNames(record);
  return names.fullName || 'Unnamed';
}

function fillEmailTemplate(template, record, senderName, stepNumber = 1) {
  const names = deriveNames(record);
  const name = names.firstName || 'there';
  const fullName = names.fullName || name;
  const company = record.company || 'your team';
  const sender = senderName || 'Your Name';
  const step = String(stepNumber);

  const unsubscribeUrl = record.unsubscribeUrl || '';

  const replaceFields = (text) =>
    String(text)
      .replaceAll('{{name}}', name)
      .replaceAll('{{firstName}}', name)
      .replaceAll('{{lastName}}', names.lastName || '')
      .replaceAll('{{fullName}}', fullName)
      .replaceAll('{{company}}', company)
      .replaceAll('{{sender}}', sender)
      .replaceAll('{{step}}', step)
      .replaceAll('{{unsubscribeUrl}}', unsubscribeUrl);

  return {
    subject: replaceFields(template.subject),
    body: replaceFields(template.body),
    html: template.html ? replaceFields(template.html) : '',
  };
}

function getNextEstRefreshAt(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const nowMs = now.getTime();

  const candidates = [
    Date.UTC(year, month, date, EST_REFRESH_UTC_HOURS[0], 0, 0, 0),
    Date.UTC(year, month, date, EST_REFRESH_UTC_HOURS[1], 0, 0, 0),
    Date.UTC(year, month, date + 1, EST_REFRESH_UTC_HOURS[0], 0, 0, 0),
    Date.UTC(year, month, date + 1, EST_REFRESH_UTC_HOURS[1], 0, 0, 0),
  ];

  const next = candidates.find((candidate) => candidate > nowMs)
    || Date.UTC(year, month, date + 1, EST_REFRESH_UTC_HOURS[0], 0, 0, 0);

  return new Date(next);
}

function App() {
  const fileInputRef = useRef(null);
  const templateEditorRef = useRef(null);
  const estAutoRefreshTimerRef = useRef(null);
  const [records, setRecords] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.map((record) => ensureSubscriptionFields(record)) : [];
    } catch {
      return [];
    }
  });
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [importMode, setImportMode] = useState('skip');
  const [templates, setTemplates] = useState(loadTemplates);
  const [emailTemplateKey, setEmailTemplateKey] = useState('followup');
  const [senderName, setSenderName] = useState('Rashida');
  const [massEmailModal, setMassEmailModal] = useState({
    open: false,
    recipients: [],
    subject: '',
    body: '',
    html: '',
    confirmText: '',
    kind: 'mass',
  });
  const [isSendingMassEmail, setIsSendingMassEmail] = useState(false);
  const [selectedRecipientId, setSelectedRecipientId] = useState('');
  const [campaignMessageDraft, setCampaignMessageDraft] = useState({
    subject: '',
    body: '',
  });
  const [campaignTestRecipientId, setCampaignTestRecipientId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);
  const [campaigns, setCampaigns] = useState([]);
  const [automationStatus, setAutomationStatus] = useState('Click Refresh Campaigns to check connection');
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [loadingActivityLog, setLoadingActivityLog] = useState(false);
  const [checkingSmtp, setCheckingSmtp] = useState(false);
  const [messagingMode, setMessagingMode] = useState('individual');
  const [newsletterForm, setNewsletterForm] = useState(loadNewsletterDraft);
  const [weeklyChecklist, setWeeklyChecklist] = useState(loadWeeklyChecklist);

  const activeCampaignCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === 'active').length,
    [campaigns]
  );

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    []
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    localStorage.setItem(WEEKLY_CHECKLIST_STORAGE_KEY, JSON.stringify(weeklyChecklist));
  }, [weeklyChecklist]);

  useEffect(() => {
    localStorage.setItem(NEWSLETTER_DRAFT_STORAGE_KEY, JSON.stringify(newsletterForm));
  }, [newsletterForm]);

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.key === emailTemplateKey) || templates[0] || null;
  }, [templates, emailTemplateKey]);

  const activeTemplate = useMemo(() => {
    return selectedTemplate
      || templates.find((template) => template.key === 'followup')
      || templates[0]
      || { subject: '', body: '' };
  }, [selectedTemplate, templates]);

  const selectedCampaignTemplate = useMemo(() => {
    return templates.find((template) => template.key === campaignForm.templateKey)
      || templates.find((template) => template.key === 'followup')
      || templates[0]
      || { subject: '', body: '' };
  }, [templates, campaignForm.templateKey]);

  const totals = useMemo(() => {
    const total = records.length;
    const leads = records.filter((r) => r.type === 'lead').length;
    const contacts = records.filter((r) => r.type === 'contact').length;
    const converted = records.filter((r) => r.status === 'converted').length;
    const referrals = records.filter((r) => r.isReferral).length;
    const convertedReferrals = records.filter((r) => r.isReferral && r.status === 'converted').length;
    const revenue = records.reduce((sum, r) => sum + (Number(r.revenue) || 0), 0);

    const conversionRate = total ? (converted / total) * 100 : 0;
    const referralConversionRate = referrals ? (convertedReferrals / referrals) * 100 : 0;

    return {
      total,
      leads,
      contacts,
      converted,
      referrals,
      revenue,
      conversionRate,
      referralConversionRate,
    };
  }, [records]);

  const visibleRecords = useMemo(() => {
    let next = [...records];

    if (filter !== 'all') {
      next = next.filter((record) => record.type === filter);
    }

    const query = searchTerm.trim().toLowerCase();
    if (query) {
      next = next.filter((record) =>
        [
          record.name,
          record.company,
          record.email,
          record.phone,
          record.notes,
          record.referralSource,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      );
    }

    const compare = (a, b) => {
      if (sortBy === 'revenue') {
        return (Number(a.revenue) || 0) - (Number(b.revenue) || 0);
      }

      if (sortBy === 'createdAt') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }

      const valueA = String(a[sortBy] ?? '').toLowerCase();
      const valueB = String(b[sortBy] ?? '').toLowerCase();
      return valueA.localeCompare(valueB);
    };

    next.sort((a, b) => {
      const result = compare(a, b);
      return sortDirection === 'asc' ? result : -result;
    });

    return next;
  }, [filter, records, searchTerm, sortBy, sortDirection]);

  const emailEligibleRecords = useMemo(
    () => records.filter((record) => String(record.email || '').trim() && !record.unsubscribed),
    [records]
  );

  const unsubscribedCount = useMemo(
    () => records.filter((record) => record.unsubscribed).length,
    [records]
  );

  const selectedRecipient = useMemo(
    () => emailEligibleRecords.find((record) => record.id === selectedRecipientId) || null,
    [emailEligibleRecords, selectedRecipientId]
  );

  const selectedCampaignTestRecipient = useMemo(
    () => emailEligibleRecords.find((record) => record.id === campaignTestRecipientId) || null,
    [emailEligibleRecords, campaignTestRecipientId]
  );

  const templatePreviewRecord = useMemo(() => {
    return selectedRecipient
      || visibleRecords.find((record) => record.email)
      || records.find((record) => record.email)
      || records[0]
      || null;
  }, [selectedRecipient, visibleRecords, records]);

  const massEmailPreview = useMemo(() => {
    if (!massEmailModal.open || massEmailModal.recipients.length === 0) {
      return null;
    }

    const firstRecipient = massEmailModal.recipients[0];
    const rendered = fillEmailTemplate(
      { subject: massEmailModal.subject, body: massEmailModal.body },
      {
        ...firstRecipient,
        unsubscribeUrl: buildUnsubscribeUrl(firstRecipient),
      },
      senderName,
      1
    );

    return {
      recipient: firstRecipient,
      subject: rendered.subject,
      body: rendered.body,
    };
  }, [massEmailModal, senderName]);

  function buildUnsubscribeUrl(record) {
    if (!record?.unsubscribeToken) return '';
    const origin = window.location.origin;
    return `${origin}/.netlify/functions/unsubscribe?token=${encodeURIComponent(record.unsubscribeToken)}`;
  }

  function buildKeepInTouchUrl() {
    return `${window.location.origin}${KEEP_IN_TOUCH_PATH}`;
  }

  function buildNewsletterHeaderImageUrl() {
    return `${window.location.origin}/newsletter-header.svg`;
  }

  const buildNewsletterTemplate = () => {
    const keepInTouchUrl = buildKeepInTouchUrl();
    const headerImageUrl = buildNewsletterHeaderImageUrl();
    const connectLinks = String(newsletterForm.connectLinks || '')
      .replaceAll('{{keepInTouchUrl}}', keepInTouchUrl)
      .trim();
    const connectSection = connectLinks
      ? connectLinks.includes('Lets Keep In Touch:')
        ? connectLinks
        : `${connectLinks}\nLets Keep In Touch: ${keepInTouchUrl}`
      : `Lets Keep In Touch: ${keepInTouchUrl}`;

    const greetingText = newsletterForm.greeting || 'I hope your week is unfolding with clarity and ease.';
    const updatesText = newsletterForm.whatsNewUpdates || '-';
    const offeringsText = newsletterForm.upcomingOfferings || '-';
    const mindfulMomentText = newsletterForm.mindfulMoment || '-';
    const closingQuoteText = newsletterForm.closingQuote || 'Small pauses create spacious days.';
    const closingQuoteAttribution = newsletterForm.closingQuoteAttribution || 'A reminder for the week ahead';
    const issueLabel = newsletterForm.issueLabel || new Date().toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const lines = [
      'Hi {{firstName}},',
      '',
      greetingText,
      '',
      'What\'s New / Updates',
      updatesText,
      '',
      'Upcoming Offerings',
      offeringsText,
      '',
      'Mindful Moment',
      mindfulMomentText,
      '',
      'Call To Action',
      `${newsletterForm.ctaText || 'Schedule a discovery call'}: ${newsletterForm.ctaUrl || ''}`,
      '',
      'Connect With Me',
      connectSection,
      '',
      'If you no longer want to receive these emails, unsubscribe here: {{unsubscribeUrl}}',
    ];

    const html = `
      <div style="margin:0;padding:0;background-color:#eef4ef;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${greetingText}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef4ef;margin:0;padding:0;width:100%;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;background-color:#fbfaf5;border:1px solid #d7e6dd;border-radius:28px;overflow:hidden;">
                <tr>
                  <td style="padding:0;background-color:#fbfaf5;">
                    <img src="${headerImageUrl}" alt="The Mindful Project Manager, LLC" width="1200" style="display:block;width:100%;max-width:720px;height:auto;border:0;" />
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 28px 20px;font-family:Arial, Helvetica, sans-serif;color:#1f2937;line-height:1.7;">
                    <div style="margin:0 0 18px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
                      <span style="display:inline-block;color:#6b7280;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">${issueLabel}</span>
                    </div>

                    <p style="margin:0 0 18px;font-size:16px;">Hi {{firstName}},</p>
                    <p style="margin:0 0 22px;font-size:16px;color:#334155;">${greetingText}</p>

                    <div style="margin:0 0 20px;padding:16px 18px;background:linear-gradient(135deg,#f7fbf7 0%,#eef4ef 100%);border:1px solid #dce9e0;border-radius:22px;">
                      <p style="margin:0;font-size:14px;color:#38584f;">A steadier rhythm for the week ahead, with a few updates, upcoming invitations, and one mindful pause to carry with you.</p>
                    </div>

                    <div style="margin:0 0 18px;padding:18px 18px 14px;background-color:#f7fbf7;border:1px solid #dbe9df;border-radius:20px;">
                      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5a766c;">Latest Highlights</p>
                      <h2 style="margin:0 0 10px;font-family:Georgia, 'Times New Roman', serif;font-size:24px;font-style:italic;font-weight:500;color:#21312d;">What's New / Updates</h2>
                      <div style="white-space:pre-line;font-size:15px;color:#334155;">${updatesText}</div>
                    </div>

                    <div style="margin:0 0 18px;padding:18px 18px 14px;background-color:#f3f7f1;border:1px solid #d9e4d5;border-radius:20px;">
                      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5a766c;">Upcoming Invitations</p>
                      <h2 style="margin:0 0 10px;font-family:Georgia, 'Times New Roman', serif;font-size:24px;font-style:italic;font-weight:500;color:#21312d;">Upcoming Offerings</h2>
                      <div style="white-space:pre-line;font-size:15px;color:#334155;">${offeringsText}</div>
                    </div>

                    <div style="margin:0 0 22px;padding:18px 18px 14px;background-color:#f8f4ea;border:1px solid #e7dfcf;border-radius:20px;">
                      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8a6d45;">Pause and Breathe</p>
                      <h2 style="margin:0 0 10px;font-family:Georgia, 'Times New Roman', serif;font-size:24px;font-style:italic;font-weight:500;color:#4a3722;">Mindful Moment</h2>
                      <div style="white-space:pre-line;font-size:15px;color:#4b5563;">${mindfulMomentText}</div>
                    </div>

                    <div style="margin:0 0 22px;padding:22px;border-radius:24px;background:linear-gradient(135deg,#edf5ef 0%,#e5f0e8 100%);border:1px solid #cfddd4;box-shadow:0 12px 28px rgba(76,106,97,0.10);text-align:center;">
                      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5a766c;">A gentle next step</p>
                      <h3 style="margin:0 0 10px;font-family:Georgia, 'Times New Roman', serif;font-size:28px;font-style:italic;font-weight:500;color:#20302c;">${newsletterForm.ctaText || 'Schedule a discovery call'}</h3>
                      <p style="margin:0 0 16px;font-size:15px;color:#455a54;">When you are ready for support, I would be honored to continue the conversation with you.</p>
                      <a href="${newsletterForm.ctaUrl || '#'}" style="display:inline-block;padding:13px 24px;border-radius:999px;background-color:#4e7264;color:#ffffff;text-decoration:none;font-weight:700;box-shadow:0 8px 18px rgba(78,114,100,0.24);">Book your time</a>
                    </div>

                    <div style="margin:0 0 18px;padding:18px 18px 16px;background-color:#fbfcfb;border:1px solid #dbe4dd;border-radius:20px;position:relative;overflow:hidden;">
                      <div style="position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(122,163,143,0.10),transparent 40%);pointer-events:none;"></div>
                      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5a766c;position:relative;">Closing reflection</p>
                      <p style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:18px;font-style:italic;line-height:1.6;color:#2f423c;position:relative;">“${closingQuoteText}”</p>
                      <p style="margin:8px 0 0;font-size:12px;color:#708079;position:relative;">${closingQuoteAttribution}</p>
                    </div>

                    <div style="padding:18px 18px 8px;border-top:1px solid #dbe4dd;">
                      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5a766c;">Stay Connected</p>
                      <div style="white-space:pre-line;font-size:14px;color:#334155;">${connectSection}</div>
                    </div>

                    <p style="margin:22px 0 0;font-size:12px;color:#6b7280;">If you no longer want to receive these emails, unsubscribe here: <a href="{{unsubscribeUrl}}" style="color:#537b6b;">Manage your preferences</a></p>
                    <p style="margin:10px 0 0;font-size:11px;color:#91a19a;">You are receiving this note because you opted in to hear from The Mindful Project Manager, LLC.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;

    return {
      subject: newsletterForm.subject || 'Weekly Newsletter',
      body: lines.join('\n'),
      html,
    };
  };

  const checklistSteps = [
    { key: 'syncContacts', label: 'Sync contacts' },
    { key: 'smtpHealth', label: 'SMTP health check' },
    { key: 'testNewsletter', label: 'Send test newsletter' },
    { key: 'reviewNewsletter', label: 'Open weekly newsletter review' },
    { key: 'refreshLog', label: 'Refresh activity log' },
  ];

  const checklistCompletedCount = checklistSteps.filter((step) => weeklyChecklist[step.key]).length;

  const setChecklistStep = (stepKey, checked = true) => {
    setWeeklyChecklist((current) => ({
      ...current,
      [stepKey]: checked,
    }));
  };

  const resetWeeklyChecklist = () => {
    setWeeklyChecklist(defaultWeeklyChecklist());
    setFeedback('Weekly checklist reset.');
  };

  const runChecklistAction = async (stepKey) => {
    if (stepKey === 'syncContacts') {
      const ok = await syncRecordsForAutomation();
      if (ok) setChecklistStep(stepKey, true);
      return;
    }

    if (stepKey === 'smtpHealth') {
      const ok = await runSmtpHealthCheck();
      if (ok) setChecklistStep(stepKey, true);
      return;
    }

    if (stepKey === 'testNewsletter') {
      const ok = await sendTestNewsletter();
      if (ok) setChecklistStep(stepKey, true);
      return;
    }

    if (stepKey === 'reviewNewsletter') {
      const ok = openWeeklyNewsletterReview();
      if (ok) setChecklistStep(stepKey, true);
      return;
    }

    if (stepKey === 'refreshLog') {
      const ok = await loadActivityLog();
      if (ok) setChecklistStep(stepKey, true);
    }
  };

  const requiresMassSendConfirm = massEmailModal.recipients.length >= MASS_SEND_CONFIRM_THRESHOLD;
  const isMassSendConfirmValid = !requiresMassSendConfirm || massEmailModal.confirmText.trim().toUpperCase() === 'SEND';

  const apiRequest = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    const rawBody = await response.text();
    let payload = {};

    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const fallbackDetail = rawBody && !rawBody.startsWith('<!doctype html')
        ? rawBody.slice(0, 180)
        : '';
      throw new Error(
        payload.error
          || `${response.status} ${response.statusText}${fallbackDetail ? ` - ${fallbackDetail}` : ''}`
      );
    }
    return payload;
  };

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await apiRequest('/drip-campaigns');
      setCampaigns(response.campaigns || []);
      setAutomationStatus('Connected');
    } catch (error) {
      setAutomationStatus('Not connected. Deploy Netlify functions and set env vars.');
      setFeedback(`Automation unavailable: ${error.message}`);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const loadActivityLog = async () => {
    setLoadingActivityLog(true);
    try {
      const response = await apiRequest('/activity-log');
      setActivityLog(response.log || []);
      return true;
    } catch (error) {
      setFeedback(`Could not load activity log: ${error.message}`);
      return false;
    } finally {
      setLoadingActivityLog(false);
    }
  };

  useEffect(() => {
    setCampaignMessageDraft({
      subject: selectedCampaignTemplate.subject || '',
      body: selectedCampaignTemplate.body || '',
    });
  }, [selectedCampaignTemplate]);

  useEffect(() => {
    if (emailEligibleRecords.length === 0) {
      if (selectedRecipientId !== '') {
        setSelectedRecipientId('');
      }
      return;
    }

    const stillExists = emailEligibleRecords.some((record) => record.id === selectedRecipientId);
    if (!stillExists) {
      setSelectedRecipientId(emailEligibleRecords[0].id);
    }
  }, [emailEligibleRecords, selectedRecipientId]);

  useEffect(() => {
    if (emailEligibleRecords.length === 0) {
      if (campaignTestRecipientId !== '') {
        setCampaignTestRecipientId('');
      }
      return;
    }

    const stillExists = emailEligibleRecords.some((record) => record.id === campaignTestRecipientId);
    if (!stillExists) {
      setCampaignTestRecipientId('');
    }
  }, [emailEligibleRecords, campaignTestRecipientId]);

  useEffect(() => {
    loadCampaigns();
    loadActivityLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildMessageForRecord = (record, stepNumber = 1) => {
    const withUnsubscribe = {
      ...record,
      unsubscribeUrl: buildUnsubscribeUrl(record),
    };
    const rendered = fillEmailTemplate(activeTemplate, withUnsubscribe, senderName, stepNumber);
    return {
      to: record.email,
      subject: rendered.subject,
      body: rendered.body,
    };
  };

  const openMassEmailModal = (recipients, options = {}) => {
    setMassEmailModal({
      open: true,
      recipients,
      subject: options.subject ?? activeTemplate.subject ?? '',
      body: options.body ?? activeTemplate.body ?? '',
      html: options.html ?? '',
      confirmText: '',
      kind: options.kind || 'mass',
    });
  };

  const closeMassEmailModal = () => {
    setMassEmailModal((current) => ({
      ...current,
      open: false,
    }));
  };

  const updateTemplateField = (field, value) => {
    setTemplates((current) =>
      current.map((template) =>
        template.key === emailTemplateKey
          ? {
              ...template,
              [field]: value,
            }
          : template
      )
    );
  };

  const resetTemplate = () => {
    const defaults = getDefaultTemplates();
    const next = defaults.find((template) => template.key === emailTemplateKey);
    if (!next) return;

    setTemplates((current) =>
      current.map((template) =>
        template.key === emailTemplateKey
          ? {
              ...template,
              label: next.label,
              subject: next.subject,
              body: next.body,
            }
          : template
      )
    );
    setFeedback(`Template ${emailTemplateKey} reset.`);
  };

  const openDraftEmail = async (record) => {
    if (!record.email) {
      setFeedback('Cannot draft email: this record has no email address.');
      return;
    }

    const result = buildMessageForRecord(record);
    const mailto = `mailto:${encodeURIComponent(record.email)}?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(result.body)}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.body);
      }
    } catch {
      // Clipboard access can fail if browser permissions are not granted.
    }

    window.location.href = mailto;
    setFeedback(`Draft opened for ${displayName(record)}.`);
  };

  const openGmailDraft = (record) => {
    if (!record.email) {
      setFeedback('Cannot open Gmail draft: this record has no email address.');
      return;
    }

    const result = buildMessageForRecord(record);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(record.email)}&su=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(result.body)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
    setFeedback(`Gmail compose opened for ${displayName(record)}.`);
  };

  const sendEmailViaApi = async (record) => {
    if (!record.email) {
      setFeedback('Cannot send email: this record has no email address.');
      return;
    }

    try {
      const result = await apiRequest('/send-email', {
        method: 'POST',
        body: JSON.stringify(buildMessageForRecord(record)),
      });
      setFeedback(`Email sent to ${displayName(record)}. Sent ${result.sent || 0}.`);
      setAutomationStatus('Connected');
      await loadActivityLog();
    } catch (error) {
      setFeedback(`API send failed (${error.message}). Opened draft instead.`);
      await openDraftEmail(record);
    }
  };

  const sendSelectedRecipientApi = async () => {
    if (!selectedRecipient) {
      setFeedback('Select a contact with an email address first.');
      return;
    }
    await sendEmailViaApi(selectedRecipient);
  };

  const draftSelectedRecipient = async () => {
    if (!selectedRecipient) {
      setFeedback('Select a contact with an email address first.');
      return;
    }
    await openDraftEmail(selectedRecipient);
  };

  const gmailSelectedRecipient = () => {
    if (!selectedRecipient) {
      setFeedback('Select a contact with an email address first.');
      return;
    }
    openGmailDraft(selectedRecipient);
  };

  const handleIndividualTemplateChange = (event) => {
    setEmailTemplateKey(event.target.value);
    templateEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sendToAllVisible = async () => {
    const recipients = visibleRecords.filter((record) => record.email && !record.unsubscribed);
    if (recipients.length === 0) {
      setFeedback('No visible subscribed records with email addresses.');
      return;
    }

    try {
      const result = await apiRequest('/send-email', {
        method: 'POST',
        body: JSON.stringify({
          messages: recipients.map((record) => buildMessageForRecord(record)),
        }),
      });
      setFeedback(`Bulk send complete. Sent ${result.sent || 0} of ${result.requested || recipients.length} email(s).`);
      setAutomationStatus('Connected');
      await loadActivityLog();
    } catch (error) {
      setFeedback(`Bulk send failed: ${error.message}`);
    }
  };

  const sendMassEmailToAllContacts = async () => {
    const seenEmails = new Set();
    const recipients = records.filter((record) => {
      const email = String(record.email || '').trim().toLowerCase();
      if (!email) return false;
      if (record.unsubscribed) return false;
      if (seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });

    if (recipients.length === 0) {
      setFeedback('No subscribed records with email addresses were found.');
      return;
    }

    openMassEmailModal(recipients);
  };

  const openWeeklyNewsletterReview = () => {
    const seenEmails = new Set();
    const recipients = records.filter((record) => {
      const email = String(record.email || '').trim().toLowerCase();
      if (!email) return false;
      if (record.unsubscribed) return false;
      if (seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });

    if (recipients.length === 0) {
      setFeedback('No subscribed contacts with email addresses were found.');
      return false;
    }

    const newsletterTemplate = buildNewsletterTemplate();
    openMassEmailModal(recipients, {
      kind: 'newsletter',
      subject: newsletterTemplate.subject,
      body: newsletterTemplate.body,
      html: newsletterTemplate.html,
    });
    return true;
  };

  const sendTestNewsletter = async () => {
    const recipient = selectedRecipient || emailEligibleRecords[0] || null;
    if (!recipient) {
      setFeedback('No subscribed test recipient available. Select a contact with an email first.');
      return false;
    }

    const newsletterTemplate = buildNewsletterTemplate();
    const rendered = fillEmailTemplate(
      newsletterTemplate,
      {
        ...recipient,
        unsubscribeUrl: buildUnsubscribeUrl(recipient),
      },
      senderName,
      1
    );

    try {
      const result = await apiRequest('/send-email', {
        method: 'POST',
        body: JSON.stringify({
          to: recipient.email,
          subject: rendered.subject,
          body: rendered.body,
          html: rendered.html,
        }),
      });
      setFeedback(`Test newsletter sent to ${displayName(recipient)}. Sent ${result.sent || 0}.`);
      setAutomationStatus('Connected');
      await loadActivityLog();
      return true;
    } catch (error) {
      setFeedback(`Test newsletter failed: ${error.message}`);
      return false;
    }
  };

  const applyNewsletterLinkPreset = () => {
    setNewsletterForm((current) => ({
      ...current,
      connectLinks: NEWSLETTER_CONNECT_LINKS_DEFAULT,
    }));
    setFeedback('Newsletter links updated to your preset.');
  };

  const saveNewsletterDraftNow = () => {
    localStorage.setItem(NEWSLETTER_DRAFT_STORAGE_KEY, JSON.stringify(newsletterForm));
    setFeedback('Newsletter draft saved.');
  };

  const resetNewsletterDraft = () => {
    const reset = defaultNewsletterForm();
    setNewsletterForm(reset);
    localStorage.setItem(NEWSLETTER_DRAFT_STORAGE_KEY, JSON.stringify(reset));
    setFeedback('Newsletter draft reset to defaults.');
  };

  const copyKeepInTouchLink = async () => {
    const url = buildKeepInTouchUrl();
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('Lets Keep In Touch link copied to clipboard.');
    } catch {
      setFeedback(`Copy failed. Link: ${url}`);
    }
  };

  const confirmMassEmailSend = async () => {
    const recipients = massEmailModal.recipients;
    if (!recipients || recipients.length === 0) {
      setFeedback('No recipients selected for mass email.');
      return;
    }

    if (requiresMassSendConfirm && !isMassSendConfirmValid) {
      setFeedback('Large send protection: type SEND to confirm this mass email.');
      return;
    }

    const customTemplate = {
      subject: massEmailModal.subject,
      body: massEmailModal.body,
      html: massEmailModal.html || '',
    };

    setIsSendingMassEmail(true);

    try {
      const result = await apiRequest('/send-email', {
        method: 'POST',
        body: JSON.stringify({
          messages: recipients.map((record) => {
            const rendered = fillEmailTemplate(
              customTemplate,
              {
                ...record,
                unsubscribeUrl: buildUnsubscribeUrl(record),
              },
              senderName,
              1
            );
            return {
              to: record.email,
              subject: rendered.subject,
              body: rendered.body,
              html: rendered.html,
            };
          }),
        }),
      });
      setFeedback(`Mass email complete. Sent ${result.sent || 0} of ${result.requested || recipients.length} email(s).`);
      setAutomationStatus('Connected');
      closeMassEmailModal();
      await loadActivityLog();
    } catch (error) {
      setFeedback(`Mass email failed: ${error.message}`);
    } finally {
      setIsSendingMassEmail(false);
    }
  };

  const syncRecordsForAutomation = async () => {
    try {
      const normalizedRecords = records.map((record) => ensureSubscriptionFields(record));
      const remote = await apiRequest('/crm-records');
      const remoteRecords = Array.isArray(remote.records) ? remote.records : [];
      const merged = mergeRecordCollections(remoteRecords, normalizedRecords);

      await apiRequest('/crm-records', {
        method: 'POST',
        body: JSON.stringify({ records: merged.records }),
      });
      setRecords(merged.records);
      setFeedback(`Sync complete. CRM now has ${merged.records.length} records (${merged.addedCount} added, ${merged.mergedCount} merged).`);
      setAutomationStatus('Connected');
      return true;
    } catch (error) {
      setFeedback(`Sync failed: ${error.message}`);
      return false;
    }
  };

  const pullRecordsFromAutomation = async () => {
    try {
      const response = await apiRequest('/crm-records');
      const remoteRecords = Array.isArray(response.records) ? response.records : [];
      const merged = mergeRecordCollections(records, remoteRecords);
      setRecords(merged.records);
      setFeedback(`Pulled ${remoteRecords.length} synced records (${merged.addedCount} added, ${merged.mergedCount} merged).`);
      setAutomationStatus('Connected');
      return true;
    } catch (error) {
      setFeedback(`Pull failed: ${error.message}`);
      return false;
    }
  };

  const runSmtpHealthCheck = async () => {
    setCheckingSmtp(true);
    try {
      const result = await apiRequest('/smtp-health', {
        method: 'POST',
      });
      setFeedback(result.message || 'SMTP connection verified.');
      setAutomationStatus('Connected');
      await loadActivityLog();
      return true;
    } catch (error) {
      setFeedback(`SMTP health check failed: ${error.message}`);
      await loadActivityLog();
      return false;
    } finally {
      setCheckingSmtp(false);
    }
  };

  useEffect(() => {
    const scheduleNextRefresh = () => {
      const nextRunAt = getNextEstRefreshAt();
      const delayMs = Math.max(1000, nextRunAt.getTime() - Date.now());

      estAutoRefreshTimerRef.current = window.setTimeout(async () => {
        try {
          await Promise.all([
            pullRecordsFromAutomation(),
            loadCampaigns(),
            loadActivityLog(),
          ]);
          setFeedback('Auto refresh complete (scheduled for 6:00 AM / 9:00 PM EST).');
        } finally {
          scheduleNextRefresh();
        }
      }, delayMs);
    };

    scheduleNextRefresh();

    return () => {
      if (estAutoRefreshTimerRef.current) {
        window.clearTimeout(estAutoRefreshTimerRef.current);
      }
    };
    // Re-schedule when local records change so pull merges against current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  const createCampaign = async (event) => {
    event.preventDefault();

    try {
      await apiRequest('/drip-campaigns', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          campaign: {
            name: campaignForm.name.trim() || 'Untitled campaign',
            audience: campaignForm.audience,
            templateKey: campaignForm.templateKey,
            startAt: new Date(campaignForm.startAt).toISOString(),
            intervalDays: Number(campaignForm.intervalDays) || 3,
            totalSteps: Number(campaignForm.totalSteps) || 3,
            senderName,
            templateSubject: campaignMessageDraft.subject || selectedCampaignTemplate.subject || '',
            templateBody: campaignMessageDraft.body || selectedCampaignTemplate.body || '',
            testEmail: selectedCampaignTestRecipient?.email || '',
          },
        }),
      });
      setCampaignForm(defaultCampaignForm());
      setCampaignMessageDraft({
        subject: selectedCampaignTemplate.subject || '',
        body: selectedCampaignTemplate.body || '',
      });
      setFeedback('Campaign created.');
      await loadCampaigns();
    } catch (error) {
      setFeedback(`Could not create campaign: ${error.message}`);
    }
  };

  const updateCampaignStatus = async (campaignId, action) => {
    try {
      await apiRequest('/drip-campaigns', {
        method: 'POST',
        body: JSON.stringify({ action, campaignId }),
      });
      await loadCampaigns();
    } catch (error) {
      setFeedback(`Campaign update failed: ${error.message}`);
    }
  };

  const deleteCampaign = async (campaignId) => {
    try {
      await apiRequest('/drip-campaigns', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', campaignId }),
      });
      await loadCampaigns();
    } catch (error) {
      setFeedback(`Delete failed: ${error.message}`);
    }
  };

  const cancelAllActiveCampaigns = async () => {
    if (activeCampaignCount === 0) {
      setFeedback('No active campaigns to cancel.');
      return;
    }

    const confirmed = window.confirm(`Cancel all ${activeCampaignCount} active campaign(s)?`);
    if (!confirmed) return;

    try {
      await apiRequest('/drip-campaigns', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel-all-active' }),
      });
      setFeedback(`Canceled ${activeCampaignCount} active campaign(s).`);
      await loadCampaigns();
    } catch (error) {
      setFeedback(`Cancel all failed: ${error.message}`);
    }
  };

  const runCampaignsNow = async () => {
    try {
      const result = await apiRequest('/drip-runner', {
        method: 'POST',
        body: JSON.stringify({ trigger: 'manual' }),
      });
      setFeedback(
        `Manual run complete. Processed ${result.processedCampaigns || 0} campaign(s), due ${result.dueCampaigns || 0}, sent ${result.sentCount || 0} email(s), skipped not due ${result.skippedNotDue || 0}, skipped by caps ${result.skippedByCap || 0}.`
      );
      await loadCampaigns();
      await loadActivityLog();
    } catch (error) {
      setFeedback(`Manual run failed: ${error.message}`);
    }
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'isReferral' && !checked ? { referralSource: '' } : {}),
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!form.firstName.trim()) return;
    if (!form.email.trim() && !form.phone.trim()) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const existingRecord = editingId ? records.find((record) => record.id === editingId) : null;

    const entry = {
      id: editingId || crypto.randomUUID(),
      firstName,
      lastName,
      name: fullName,
      company: form.company.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      type: form.type,
      status: form.status,
      isReferral: form.isReferral,
      referralSource: form.isReferral ? form.referralSource.trim() : '',
      revenue: Number(form.revenue) || 0,
      notes: form.notes.trim(),
      unsubscribed: Boolean(existingRecord?.unsubscribed),
      unsubscribeToken: existingRecord?.unsubscribeToken || crypto.randomUUID(),
      unsubscribedAt: existingRecord?.unsubscribed ? existingRecord.unsubscribedAt || new Date().toISOString() : '',
      createdAt: editingId
        ? existingRecord?.createdAt || new Date().toISOString()
        : new Date().toISOString(),
    };

    const duplicateInExisting = records.some((record) => {
      if (editingId && record.id === editingId) return false;
      return getDuplicateKey(record) === getDuplicateKey(entry);
    });

    if (duplicateInExisting) {
      setFeedback('Duplicate detected: this record matches an existing contact by email, phone, or name/company.');
      return;
    }

    setRecords((current) => {
      if (editingId) {
        return current.map((record) => (record.id === editingId ? ensureSubscriptionFields(entry) : record));
      }
      return [ensureSubscriptionFields(entry), ...current];
    });

    setFeedback(editingId ? 'Record updated.' : 'Record added.');
    setEditingId(null);
    setForm(defaultForm);
  };

  const editRecord = (record) => {
    const names = deriveNames(record);
    setEditingId(record.id);
    setForm({
      firstName: names.firstName,
      lastName: names.lastName,
      company: record.company || '',
      email: record.email || '',
      phone: record.phone || '',
      type: record.type || 'lead',
      status: record.status || 'new',
      isReferral: Boolean(record.isReferral),
      referralSource: record.referralSource || '',
      revenue: String(record.revenue || ''),
      notes: record.notes || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(defaultForm);
    setFeedback('Edit canceled.');
  };

  const updateStatus = (id, nextStatus) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id
          ? {
              ...record,
              status: nextStatus,
            }
          : record
      )
    );
  };

  const deleteRecord = (id) => {
    setRecords((current) => current.filter((record) => record.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setForm(defaultForm);
    }
    setFeedback('Record deleted.');
  };

  const toggleSubscription = (id) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) return record;
        const nextUnsubscribed = !record.unsubscribed;
        return {
          ...record,
          unsubscribed: nextUnsubscribed,
          unsubscribedAt: nextUnsubscribed ? new Date().toISOString() : '',
          unsubscribeToken: record.unsubscribeToken || crypto.randomUUID(),
        };
      })
    );
  };

  const exportCsv = () => {
    const csv = toCsv(records);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crm-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadImportTemplateCsv = () => {
    const sample = {
      id: '',
      firstName: 'Jane',
      lastName: 'Doe',
      name: 'Jane Doe',
      company: 'Mindful Project Co',
      email: 'jane@example.com',
      phone: '555-0100',
      type: 'lead',
      status: 'new',
      isReferral: 'false',
      referralSource: '',
      revenue: '0',
      notes: 'Imported sample row',
      unsubscribed: 'false',
      unsubscribeToken: '',
      unsubscribedAt: '',
      createdAt: new Date().toISOString(),
    };

    const headerLine = CSV_HEADERS.join(',');
    const sampleLine = CSV_HEADERS.map((header) => escapeCsv(sample[header])).join(',');
    const csv = [headerLine, sampleLine].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'crm-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const startImportCsv = () => {
    fileInputRef.current?.click();
  };

  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsedRows = parseCsvText(text);
    const normalizedRows = parsedRows
      .map((row) => normalizeImportedRecord(row))
      .filter(Boolean);
    const skippedInvalid = parsedRows.length - normalizedRows.length;
    let importedCount = 0;
    let mergedCount = 0;
    let skippedDuplicates = 0;

    setRecords((current) => {
      const nextRecords = [...current];
      const existingKeys = new Set();
      const keyToIndex = new Map();

      nextRecords.forEach((record, index) => {
        const key = getDuplicateKey(record);
        existingKeys.add(key);
        keyToIndex.set(key, index);
      });

      const acceptedRecords = [];

      normalizedRows.forEach((record) => {
        const normalizedRecord = ensureSubscriptionFields(record);
        const key = getDuplicateKey(normalizedRecord);
        if (existingKeys.has(key)) {
          if (importMode === 'merge') {
            const existingIndex = keyToIndex.get(key);
            if (existingIndex !== undefined) {
              const merged = ensureSubscriptionFields(mergeRecord(nextRecords[existingIndex], normalizedRecord));
              nextRecords[existingIndex] = merged;
              mergedCount += 1;

              const mergedKey = getDuplicateKey(merged);
              if (mergedKey !== key) {
                keyToIndex.delete(key);
                existingKeys.delete(key);
                keyToIndex.set(mergedKey, existingIndex);
                existingKeys.add(mergedKey);
              }
            }
            return;
          }
          skippedDuplicates += 1;
          return;
        }
        existingKeys.add(key);
        acceptedRecords.push(normalizedRecord);
        keyToIndex.set(key, nextRecords.length + acceptedRecords.length - 1);
      });

      importedCount = acceptedRecords.length;
      return importedCount > 0 ? [...acceptedRecords, ...nextRecords] : nextRecords;
    });

    setFeedback(
      `Import complete. Added ${importedCount}, merged ${mergedCount}, skipped ${skippedDuplicates} duplicates, skipped ${skippedInvalid} invalid row(s).`
    );

    event.target.value = '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Wordmark</p>
            <h1 className="text-3xl text-slate-900 sm:text-4xl" style={{ fontFamily: 'Georgia, Times New Roman, serif', fontStyle: 'italic', fontWeight: 500 }}>
              The Mindful Project Manager, LLC
            </h1>
            <p className="mt-1 text-sm text-slate-600">Helping you find the power in your pause.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 font-medium text-teal-800">CRM + Newsletter Ops</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-700">{todayLabel}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-8">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-1">
          <h2 className="text-lg font-semibold">{editingId ? 'Edit Record' : 'Add Lead or Contact'}</h2>
          <p className="mb-4 text-sm text-slate-500">Include pertinent contact information and source details.</p>
          {feedback ? (
            <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{feedback}</p>
          ) : null}

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="firstName">First Name</label>
                <input className="w-full rounded border border-slate-300 px-3 py-2" id="firstName" name="firstName" value={form.firstName} onChange={handleChange} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="lastName">Last Name</label>
                <input className="w-full rounded border border-slate-300 px-3 py-2" id="lastName" name="lastName" value={form.lastName} onChange={handleChange} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="company">Company</label>
              <input className="w-full rounded border border-slate-300 px-3 py-2" id="company" name="company" value={form.company} onChange={handleChange} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
                <input className="w-full rounded border border-slate-300 px-3 py-2" id="email" name="email" type="email" value={form.email} onChange={handleChange} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="phone">Phone</label>
                <input className="w-full rounded border border-slate-300 px-3 py-2" id="phone" name="phone" value={form.phone} onChange={handleChange} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="type">Type</label>
                <select className="w-full rounded border border-slate-300 px-3 py-2" id="type" name="type" value={form.type} onChange={handleChange}>
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option[0].toUpperCase()}{option.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="status">Status</label>
                <select className="w-full rounded border border-slate-300 px-3 py-2" id="status" name="status" value={form.status} onChange={handleChange}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option[0].toUpperCase()}{option.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="isReferral">
                <input id="isReferral" name="isReferral" type="checkbox" checked={form.isReferral} onChange={handleChange} />
                Referral
              </label>

              {form.isReferral ? (
                <div className="mt-2">
                  <label className="mb-1 block text-sm font-medium" htmlFor="referralSource">Referral Source</label>
                  <input className="w-full rounded border border-slate-300 px-3 py-2" id="referralSource" name="referralSource" value={form.referralSource} onChange={handleChange} placeholder="Who referred this person?" />
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="revenue">Revenue ($)</label>
              <input className="w-full rounded border border-slate-300 px-3 py-2" id="revenue" name="revenue" type="number" min="0" step="1" value={form.revenue} onChange={handleChange} placeholder="0" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="notes">Notes</label>
              <textarea className="w-full rounded border border-slate-300 px-3 py-2" id="notes" name="notes" rows="3" value={form.notes} onChange={handleChange} />
            </div>

            <div className="flex gap-2">
              <button className="w-full rounded bg-repay-primary px-4 py-2 font-semibold text-white hover:bg-blue-700" type="submit">
                {editingId ? 'Update Record' : 'Save Record'}
              </button>
              {editingId ? (
                <button
                  className="w-full rounded border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={cancelEdit}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-lg bg-white p-4 shadow">
              <p className="text-sm text-slate-500">Total Records</p>
              <p className="text-2xl font-bold">{totals.total}</p>
              <p className="text-xs text-slate-500">Leads: {totals.leads} | Contacts: {totals.contacts}</p>
            </article>
            <article className="rounded-lg bg-white p-4 shadow">
              <p className="text-sm text-slate-500">Conversion Rate</p>
              <p className="text-2xl font-bold text-repay-accent">{totals.conversionRate.toFixed(1)}%</p>
              <p className="text-xs text-slate-500">Converted: {totals.converted}</p>
            </article>
            <article className="rounded-lg bg-white p-4 shadow">
              <p className="text-sm text-slate-500">Referral Conversion</p>
              <p className="text-2xl font-bold text-repay-secondary">{totals.referralConversionRate.toFixed(1)}%</p>
              <p className="text-xs text-slate-500">Referral records: {totals.referrals}</p>
            </article>
            <article className="rounded-lg bg-white p-4 shadow sm:col-span-2 xl:col-span-3">
              <p className="text-sm text-slate-500">Total Revenue</p>
              <p className="text-3xl font-bold">{money.format(totals.revenue)}</p>
            </article>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Automation</h2>
              <span className="rounded bg-slate-100 px-2 py-1 text-xs">API status: {automationStatus}</span>
            </div>
            <p className="mb-3 text-sm text-slate-500">Sync records, send API emails, and schedule drip campaigns.</p>
            <p className="mb-3 text-xs text-slate-500">
              Subscribed contacts: {emailEligibleRecords.length} | Unsubscribed contacts: {unsubscribedCount}
            </p>

            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Weekly Send Checklist ({weeklyChecklist.weekKey})</p>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-white px-2 py-1 text-xs text-slate-600">
                    {checklistCompletedCount}/{checklistSteps.length} complete
                  </span>
                  <button
                    className="rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300"
                    onClick={resetWeeklyChecklist}
                    type="button"
                  >
                    Reset Week
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {checklistSteps.map((step) => (
                  <div key={step.key} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(weeklyChecklist[step.key])}
                        onChange={(event) => setChecklistStep(step.key, event.target.checked)}
                      />
                      {step.label}
                    </label>
                    <button
                      className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      onClick={() => runChecklistAction(step.key)}
                      type="button"
                    >
                      Run
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={syncRecordsForAutomation} type="button">
                Sync Contacts
              </button>
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={pullRecordsFromAutomation} type="button">
                Pull Synced Contacts
              </button>
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={runSmtpHealthCheck} type="button" disabled={checkingSmtp}>
                {checkingSmtp ? 'Checking SMTP...' : 'SMTP Health Check'}
              </button>
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={loadCampaigns} type="button">
                {loadingCampaigns ? 'Refreshing...' : 'Refresh Campaigns'}
              </button>
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={loadActivityLog} type="button">
                {loadingActivityLog ? 'Refreshing Log...' : 'Refresh Activity Log'}
              </button>
              <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={runCampaignsNow} type="button">
                Run Campaigns Now
              </button>
              <button
                className="rounded bg-red-100 px-2 py-1 text-sm font-semibold text-red-800 hover:bg-red-200"
                onClick={cancelAllActiveCampaigns}
                type="button"
              >
                Cancel All Active Campaigns
              </button>
            </div>

            <div className="mb-3 rounded border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold">Messaging Center</p>
              <p className="mb-2 text-xs text-slate-500">
                Use one workflow for individual and mass email actions with shared template and preview controls.
              </p>

              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  className={messagingMode === 'individual' ? 'rounded bg-repay-primary px-2 py-1 text-xs font-semibold text-white' : 'rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300'}
                  onClick={() => setMessagingMode('individual')}
                  type="button"
                >
                  Individual Mode
                </button>
                <button
                  className={messagingMode === 'mass' ? 'rounded bg-repay-primary px-2 py-1 text-xs font-semibold text-white' : 'rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300'}
                  onClick={() => setMessagingMode('mass')}
                  type="button"
                >
                  Mass Mode
                </button>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  className="min-w-[280px] rounded border border-slate-300 px-2 py-1 text-sm"
                  value={selectedRecipientId}
                  onChange={(event) => setSelectedRecipientId(event.target.value)}
                >
                  {emailEligibleRecords.length === 0 ? (
                    <option value="">No contacts with email</option>
                  ) : (
                    emailEligibleRecords.map((record) => (
                      <option key={record.id} value={record.id}>
                        {displayName(record)} - {record.email}
                      </option>
                    ))
                  )}
                </select>
                <label htmlFor="individual-template" className="text-sm text-slate-600">Template:</label>
                <select
                  id="individual-template"
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                  value={emailTemplateKey}
                  onChange={handleIndividualTemplateChange}
                >
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>
              </div>

              {messagingMode === 'individual' ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button className="rounded bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100" onClick={sendSelectedRecipientApi} type="button" disabled={!selectedRecipient}>
                    Send API
                  </button>
                  <button className="rounded bg-indigo-50 px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-100" onClick={draftSelectedRecipient} type="button" disabled={!selectedRecipient}>
                    Draft
                  </button>
                  <button className="rounded bg-emerald-50 px-2 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100" onClick={gmailSelectedRecipient} type="button" disabled={!selectedRecipient}>
                    Gmail
                  </button>
                  <button
                    className="rounded bg-emerald-100 px-2 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-200"
                    onClick={sendTestNewsletter}
                    type="button"
                    disabled={!selectedRecipient}
                  >
                    Send Test Newsletter
                  </button>
                </div>
              ) : (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={sendToAllVisible} type="button">
                    Send To All Visible
                  </button>
                  <button className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300" onClick={sendMassEmailToAllContacts} type="button">
                    Review & Send Mass Email
                  </button>
                  <button className="rounded bg-emerald-100 px-2 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-200" onClick={openWeeklyNewsletterReview} type="button">
                    Review & Send Weekly Newsletter
                  </button>
                </div>
              )}

              {selectedRecipient ? (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  <p>
                    Selected recipient: {displayName(selectedRecipient)} ({selectedRecipient.email})
                  </p>
                  <p className="mt-1"><span className="font-semibold">Subject:</span> {buildMessageForRecord(selectedRecipient).subject}</p>
                  <pre className="mt-1 whitespace-pre-wrap">{buildMessageForRecord(selectedRecipient).body}</pre>
                </div>
              ) : null}

              <div className="mt-3 rounded border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold">Newsletter Composer</p>
                <p className="mb-2 text-xs text-slate-500">
                  Structure includes Greeting, What\'s New / Updates, Upcoming Offerings, Mindful Moment, CTA, and footer connect links.
                </p>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    className="rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300"
                    onClick={applyNewsletterLinkPreset}
                    type="button"
                  >
                    Use My Link Footer
                  </button>
                  <button
                    className="rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300"
                    onClick={saveNewsletterDraftNow}
                    type="button"
                  >
                    Save Draft
                  </button>
                  <button
                    className="rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300"
                    onClick={resetNewsletterDraft}
                    type="button"
                  >
                    Reset Draft
                  </button>
                  <button
                    className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                    onClick={copyKeepInTouchLink}
                    type="button"
                  >
                    Copy Lets Keep In Touch Link
                  </button>
                </div>
                <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Footer Block</p>
                  <p className="mt-1 text-sm text-slate-700">Lets Keep In Touch: {buildKeepInTouchUrl()}</p>
                  <p className="mt-1 text-xs text-slate-500">This footer link is appended automatically to your newsletter and test sends.</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-2"
                    value={newsletterForm.subject}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, subject: event.target.value }))}
                    placeholder="Newsletter subject"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.greeting}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, greeting: event.target.value }))}
                    placeholder="Greeting"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.whatsNewUpdates}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, whatsNewUpdates: event.target.value }))}
                    placeholder="What\'s New / Updates"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.upcomingOfferings}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, upcomingOfferings: event.target.value }))}
                    placeholder="Upcoming offerings"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm md:col-span-2"
                    value={newsletterForm.mindfulMoment}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, mindfulMoment: event.target.value }))}
                    placeholder="Mindful Moment"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.closingQuote}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, closingQuote: event.target.value }))}
                    placeholder="Closing quote"
                  />
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.closingQuoteAttribution}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, closingQuoteAttribution: event.target.value }))}
                    placeholder="Quote attribution"
                  />
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.ctaText}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, ctaText: event.target.value }))}
                    placeholder="CTA text"
                  />
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={newsletterForm.ctaUrl}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, ctaUrl: event.target.value }))}
                    placeholder="CTA URL"
                  />
                  <textarea
                    className="h-24 rounded border border-slate-300 px-2 py-1 text-sm md:col-span-2"
                    value={newsletterForm.connectLinks}
                    onChange={(event) => setNewsletterForm((current) => ({ ...current, connectLinks: event.target.value }))}
                    placeholder="Footer connect links (one per line)"
                  />
                </div>
              </div>
            </div>

            <form className="grid gap-2 rounded border border-slate-200 p-3 md:grid-cols-3" onSubmit={createCampaign}>
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={campaignForm.name}
                onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Campaign name"
              />
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={campaignForm.audience}
                onChange={(event) => setCampaignForm((current) => ({ ...current, audience: event.target.value }))}
              >
                {DRIP_AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={campaignForm.templateKey}
                onChange={(event) => setCampaignForm((current) => ({ ...current, templateKey: event.target.value }))}
              >
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>{template.label}</option>
                ))}
              </select>
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                type="datetime-local"
                value={campaignForm.startAt}
                onChange={(event) => setCampaignForm((current) => ({ ...current, startAt: event.target.value }))}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                type="number"
                min="1"
                value={campaignForm.intervalDays}
                onChange={(event) => setCampaignForm((current) => ({ ...current, intervalDays: event.target.value }))}
                placeholder="Interval days"
              />
              <div className="flex gap-2">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  type="number"
                  min="1"
                  value={campaignForm.totalSteps}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, totalSteps: event.target.value }))}
                  placeholder="Total steps"
                />
                <button className="rounded bg-repay-primary px-3 py-1 text-sm font-semibold text-white" type="submit">
                  Create
                </button>
              </div>

              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-3"
                value={campaignMessageDraft.subject}
                onChange={(event) =>
                  setCampaignMessageDraft((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
                placeholder="Campaign email subject"
              />
              <textarea
                className="h-28 rounded border border-slate-300 px-2 py-1 text-sm md:col-span-3"
                value={campaignMessageDraft.body}
                onChange={(event) =>
                  setCampaignMessageDraft((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                placeholder="Campaign email body"
              />
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm md:col-span-3"
                value={campaignTestRecipientId}
                onChange={(event) => setCampaignTestRecipientId(event.target.value)}
              >
                <option value="">No test override (use audience)</option>
                {emailEligibleRecords.map((record) => (
                  <option key={record.id} value={record.id}>
                    Test to: {displayName(record)} - {record.email}
                  </option>
                ))}
              </select>
              {selectedCampaignTestRecipient ? (
                <p className="text-xs text-amber-700 md:col-span-3">
                  Test mode active: this campaign will only send to {displayName(selectedCampaignTestRecipient)} ({selectedCampaignTestRecipient.email}).
                </p>
              ) : null}
              <p className="text-xs text-slate-500 md:col-span-3">
                Campaign tokens: {'{{name}}'}, {'{{firstName}}'}, {'{{lastName}}'}, {'{{fullName}}'}, {'{{company}}'}, {'{{sender}}'}, {'{{step}}'}, {'{{unsubscribeUrl}}'}
              </p>
            </form>

            {campaigns.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left">
                      <th className="px-2 py-1">Campaign</th>
                      <th className="px-2 py-1">Audience</th>
                      <th className="px-2 py-1">Progress</th>
                      <th className="px-2 py-1">Next Run</th>
                      <th className="px-2 py-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b">
                        <td className="px-2 py-1">{campaign.name}</td>
                        <td className="px-2 py-1">
                          {campaign.testEmail ? (
                            <span className="text-amber-700">Test only ({campaign.testEmail})</span>
                          ) : (
                            <span className="capitalize">{campaign.audience}</span>
                          )}
                        </td>
                        <td className="px-2 py-1">Step {campaign.sentSteps} / {campaign.totalSteps}</td>
                        <td className="px-2 py-1">{campaign.nextRunAt ? new Date(campaign.nextRunAt).toLocaleString() : '-'}</td>
                        <td className="px-2 py-1">
                          <div className="flex gap-2">
                            {campaign.status === 'active' ? (
                              <button className="rounded bg-slate-100 px-2 py-1" type="button" onClick={() => updateCampaignStatus(campaign.id, 'pause')}>
                                Pause
                              </button>
                            ) : (
                              <button className="rounded bg-slate-100 px-2 py-1" type="button" onClick={() => updateCampaignStatus(campaign.id, 'resume')}>
                                Resume
                              </button>
                            )}
                            <button className="rounded bg-red-50 px-2 py-1 text-red-700" type="button" onClick={() => deleteCampaign(campaign.id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No campaigns yet. Create one above and click Refresh Campaigns.</p>
            )}

            <div className="mt-4 rounded border border-slate-200 p-3">
              <h3 className="text-sm font-semibold">Recent Activity</h3>
              {activityLog.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No activity recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {activityLog.slice(0, 15).map((entry, index) => (
                    <li key={`${entry.timestamp || 'time'}-${index}`} className="rounded bg-slate-50 px-2 py-1">
                      <span className="font-medium">[{entry.source || 'system'}]</span> {entry.message || 'No message'}
                      <span className="ml-2 text-slate-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" ref={templateEditorRef}>
            <h2 className="mb-2 text-lg font-semibold">Template Editor</h2>
            <p className="mb-3 text-sm text-slate-500">Edit and review templates used for Draft, Gmail, Send API, and Send To All.</p>

            {selectedTemplate ? (
              <div className="space-y-2">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={selectedTemplate.label}
                  onChange={(event) => updateTemplateField('label', event.target.value)}
                  placeholder="Template label"
                />
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={selectedTemplate.subject}
                  onChange={(event) => updateTemplateField('subject', event.target.value)}
                  placeholder="Subject"
                />
                <textarea
                  className="h-32 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={selectedTemplate.body}
                  onChange={(event) => updateTemplateField('body', event.target.value)}
                />
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Tokens: {'{{name}}'}, {'{{firstName}}'}, {'{{lastName}}'}, {'{{fullName}}'}, {'{{company}}'}, {'{{sender}}'}, {'{{step}}'}, {'{{unsubscribeUrl}}'}</span>
                  <button className="rounded bg-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-300" onClick={resetTemplate} type="button">
                    Reset template
                  </button>
                </div>
                {templatePreviewRecord ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-2 text-sm">
                    <p className="font-semibold">Preview to: {displayName(templatePreviewRecord)}</p>
                    <p className="mt-1"><span className="font-medium">Subject:</span> {buildMessageForRecord(templatePreviewRecord).subject}</p>
                    <pre className="mt-1 whitespace-pre-wrap">{buildMessageForRecord(templatePreviewRecord).body}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Records</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="record-search">Search:</label>
                <input
                  id="record-search"
                  className="rounded border border-slate-300 px-2 py-1"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Name, email, company..."
                  value={searchTerm}
                />

                <label htmlFor="record-filter">View:</label>
                <select
                  id="record-filter"
                  className="rounded border border-slate-300 px-2 py-1"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="lead">Leads</option>
                  <option value="contact">Contacts</option>
                </select>

                <label htmlFor="record-sort">Sort:</label>
                <select
                  id="record-sort"
                  className="rounded border border-slate-300 px-2 py-1"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  <option value="createdAt">Created Date</option>
                  <option value="name">Name</option>
                  <option value="status">Status</option>
                  <option value="revenue">Revenue</option>
                </select>

                <select
                  aria-label="Sort direction"
                  className="rounded border border-slate-300 px-2 py-1"
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value)}
                >
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </select>

                <label htmlFor="email-template">Email template:</label>
                <select
                  id="email-template"
                  className="rounded border border-slate-300 px-2 py-1"
                  value={emailTemplateKey}
                  onChange={(event) => setEmailTemplateKey(event.target.value)}
                >
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>

                <input
                  aria-label="Sender name"
                  className="rounded border border-slate-300 px-2 py-1"
                  onChange={(event) => setSenderName(event.target.value)}
                  placeholder="Sender name"
                  value={senderName}
                />
              </div>
            </div>

            <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold">Data Import and Export</p>
              <p className="mt-1 text-xs text-slate-600">
                Import contacts from CSV, choose duplicate handling, or download a ready-to-use template before importing.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="import-mode" className="text-xs text-slate-600">Import mode:</label>
                <select
                  id="import-mode"
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                  value={importMode}
                  onChange={(event) => setImportMode(event.target.value)}
                >
                  {IMPORT_MODE_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>{mode === 'skip' ? 'Skip duplicates' : 'Merge duplicates'}</option>
                  ))}
                </select>
                <button
                  className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300"
                  onClick={startImportCsv}
                  type="button"
                >
                  Import Contacts CSV
                </button>
                <button
                  className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300"
                  onClick={downloadImportTemplateCsv}
                  type="button"
                >
                  Download Import Template
                </button>
                <button
                  className="rounded bg-slate-200 px-2 py-1 text-sm font-medium hover:bg-slate-300"
                  onClick={exportCsv}
                  type="button"
                >
                  Export Current CSV
                </button>
                <input
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={importCsv}
                  ref={fileInputRef}
                  type="file"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Contact</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Subscription</th>
                    <th className="px-3 py-2 font-semibold">Referral</th>
                    <th className="px-3 py-2 font-semibold">Revenue</th>
                    <th className="px-3 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan="8">
                        No records yet. Add your first lead or contact.
                      </td>
                    </tr>
                  ) : (
                    visibleRecords.map((record) => (
                      <tr className="border-b" key={record.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{displayName(record)}</p>
                          {record.company ? <p className="text-xs text-slate-500">{record.company}</p> : null}
                        </td>
                        <td className="px-3 py-2">
                          <p>{record.email || '-'}</p>
                          <p className="text-xs text-slate-500">{record.phone || '-'}</p>
                        </td>
                        <td className="px-3 py-2 capitalize">{record.type}</td>
                        <td className="px-3 py-2">
                          <select
                            className="rounded border border-slate-300 px-2 py-1"
                            value={record.status}
                            onChange={(event) => updateStatus(record.id, event.target.value)}
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option[0].toUpperCase()}{option.slice(1)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <span className={record.unsubscribed ? 'text-xs text-red-700' : 'text-xs text-emerald-700'}>
                              {record.unsubscribed ? 'Unsubscribed' : 'Subscribed'}
                            </span>
                            {record.email ? (
                              <button
                                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(buildUnsubscribeUrl(record));
                                    setFeedback(`Unsubscribe link copied for ${displayName(record)}.`);
                                  } catch {
                                    setFeedback(`Copy failed. Link: ${buildUnsubscribeUrl(record)}`);
                                  }
                                }}
                                type="button"
                              >
                                Copy Unsub Link
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {record.isReferral ? (
                            <span>
                              Yes{record.referralSource ? ` (${record.referralSource})` : ''}
                            </span>
                          ) : (
                            'No'
                          )}
                        </td>
                        <td className="px-3 py-2">{money.format(record.revenue || 0)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              className="rounded bg-blue-50 px-2 py-1 text-blue-700 hover:bg-blue-100"
                              onClick={() => sendEmailViaApi(record)}
                              type="button"
                            >
                              Send API
                            </button>
                            <button
                              className="rounded bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100"
                              onClick={() => openDraftEmail(record)}
                              type="button"
                            >
                              Draft
                            </button>
                            <button
                              className="rounded bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100"
                              onClick={() => openGmailDraft(record)}
                              type="button"
                            >
                              Gmail
                            </button>
                            <button
                              className="rounded bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
                              onClick={() => editRecord(record)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className={record.unsubscribed ? 'rounded bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100' : 'rounded bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100'}
                              onClick={() => toggleSubscription(record.id)}
                              type="button"
                            >
                              {record.unsubscribed ? 'Re-subscribe' : 'Unsubscribe'}
                            </button>
                            <button
                              className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100"
                              onClick={() => deleteRecord(record.id)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {massEmailModal.open ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4">
          <div className="mx-auto my-6 w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">
              {massEmailModal.kind === 'newsletter' ? 'Review Weekly Newsletter' : 'Review Mass Email'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Sending to {massEmailModal.recipients.length} subscribed contacts. Edit the template below before sending.
            </p>
            {requiresMassSendConfirm ? (
              <p className="mt-1 text-xs text-amber-700">
                Safety check: this is a large send. Type SEND below to unlock the send button.
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              <label className="block text-sm font-medium" htmlFor="mass-email-subject">Subject template</label>
              <input
                id="mass-email-subject"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={massEmailModal.subject}
                onChange={(event) =>
                  setMassEmailModal((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
              />

              <label className="block text-sm font-medium" htmlFor="mass-email-body">Body template</label>
              <textarea
                id="mass-email-body"
                className="h-40 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={massEmailModal.body}
                onChange={(event) =>
                  setMassEmailModal((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-slate-500">
                Tokens available: {'{{name}}'}, {'{{firstName}}'}, {'{{lastName}}'}, {'{{fullName}}'}, {'{{company}}'}, {'{{sender}}'}, {'{{step}}'}, {'{{unsubscribeUrl}}'}
              </p>
              {requiresMassSendConfirm ? (
                <div>
                  <label className="block text-sm font-medium" htmlFor="mass-email-confirm">Type SEND to confirm</label>
                  <input
                    id="mass-email-confirm"
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    value={massEmailModal.confirmText}
                    onChange={(event) =>
                      setMassEmailModal((current) => ({
                        ...current,
                        confirmText: event.target.value,
                      }))
                    }
                    placeholder="SEND"
                  />
                </div>
              ) : null}
            </div>

            {massEmailPreview ? (
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
                <p className="font-medium">Preview for {displayName(massEmailPreview.recipient)}:</p>
                <p className="mt-1"><span className="font-semibold">Subject:</span> {massEmailPreview.subject}</p>
                <pre className="mt-1 whitespace-pre-wrap">{massEmailPreview.body}</pre>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={closeMassEmailModal}
                type="button"
                disabled={isSendingMassEmail}
              >
                Cancel
              </button>
              <button
                className="rounded bg-repay-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={confirmMassEmailSend}
                type="button"
                disabled={isSendingMassEmail || !isMassSendConfirmValid}
              >
                {isSendingMassEmail ? 'Sending...' : `Send ${massEmailModal.recipients.length} Emails`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
