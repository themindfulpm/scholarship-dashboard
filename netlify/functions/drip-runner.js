const { sendMessages } = require('./_mailClient');
const {
  json,
  loadCampaigns,
  saveCampaigns,
  loadRecords,
  fillEmailTemplate,
  matchesAudience,
  appendActivity,
  reserveSendQuota,
} = require('./_crmStore');

const EMAIL_TEMPLATES = {
  intro: {
    subject: 'Quick intro from {{company}}',
    body:
      'Hi {{name}},\n\nI wanted to connect and see if we can support your current priorities at {{company}}.\n\nIf helpful, I can share a short overview and a few next steps.\n\nBest,\n{{sender}}',
  },
  followup: {
    subject: 'Following up on our conversation',
    body:
      'Hi {{name}},\n\nFollowing up on my earlier note. If this is still relevant, I would love to schedule 15 minutes this week.\n\nBest,\n{{sender}}',
  },
  converted: {
    subject: 'Welcome aboard, {{name}}',
    body:
      'Hi {{name}},\n\nThank you for moving forward with us. We are excited to support your team at {{company}}.\n\nI will follow up with next steps shortly.\n\nBest,\n{{sender}}',
  },
};

function addDays(isoDate, days) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function inferPublicBaseUrl(event) {
  const configured = String(process.env.PUBLIC_SITE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  const host = event.headers?.host;
  if (!host) return '';
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`;
}

function buildUnsubscribeUrl(baseUrl, recipient) {
  const token = String(recipient.unsubscribeToken || '').trim();
  if (!baseUrl || !token) return '';
  return `${baseUrl}/.netlify/functions/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function runCampaigns(event, options = {}) {
  const forceRun = Boolean(options.forceRun);
  const now = new Date();
  const publicBaseUrl = inferPublicBaseUrl(event);
  const [campaigns, records] = await Promise.all([loadCampaigns(event), loadRecords(event)]);
  let sentCount = 0;
  let dueCampaigns = 0;
  let skippedNotDue = 0;
  let skippedInactive = 0;
  let skippedCompleted = 0;
  let skippedByCap = 0;

  const updatedCampaigns = [];

  for (const campaign of campaigns) {
    if (campaign.status !== 'active') {
      skippedInactive += 1;
      updatedCampaigns.push(campaign);
      continue;
    }

    if (!forceRun && (!campaign.nextRunAt || new Date(campaign.nextRunAt) > now)) {
      skippedNotDue += 1;
      updatedCampaigns.push(campaign);
      continue;
    }

    if (campaign.sentSteps >= campaign.totalSteps) {
      skippedCompleted += 1;
      updatedCampaigns.push({ ...campaign, status: 'completed' });
      continue;
    }

    dueCampaigns += 1;

    let recipients;
    if (campaign.testEmail) {
      const lowerTestEmail = String(campaign.testEmail).trim().toLowerCase();
      const matched = records.find(
        (record) => String(record.email || '').trim().toLowerCase() === lowerTestEmail
      );
      recipients = [
        matched || {
          email: campaign.testEmail,
          firstName: 'Test',
          lastName: 'Recipient',
          company: 'your team',
        },
      ];
    } else {
      recipients = records.filter((record) => matchesAudience(record, campaign.audience));
    }
    const fallbackTemplate = EMAIL_TEMPLATES[campaign.templateKey] || EMAIL_TEMPLATES.followup;
    const template = {
      subject: campaign.templateSubject || fallbackTemplate.subject,
      body: campaign.templateBody || fallbackTemplate.body,
    };

    const outboundMessages = [];

    for (const recipient of recipients) {
      const stepNumber = campaign.sentSteps + 1;
      const rendered = fillEmailTemplate(
        template,
        recipient,
        campaign.senderName,
        stepNumber,
        buildUnsubscribeUrl(publicBaseUrl, recipient)
      );
      outboundMessages.push({
        to: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
      });
    }

    const previewQuota = await reserveSendQuota(event, outboundMessages.length, { commit: false });
    if (previewQuota.allowedCount < outboundMessages.length) {
      skippedByCap += 1;
      updatedCampaigns.push(campaign);
      await appendActivity(event, {
        type: 'warning',
        source: 'drip-runner',
        message: `Campaign "${campaign.name}" skipped due to caps. Needed ${outboundMessages.length}, allowed ${previewQuota.allowedCount}.`,
        details: {
          campaignId: campaign.id,
          quota: previewQuota,
        },
      });
      continue;
    }

    await reserveSendQuota(event, outboundMessages.length);

    await sendMessages(outboundMessages);
    sentCount += outboundMessages.length;

    await appendActivity(event, {
      type: 'success',
      source: 'drip-runner',
      message: `Campaign "${campaign.name}" sent step ${campaign.sentSteps + 1} to ${outboundMessages.length} recipient(s).`,
      details: {
        campaignId: campaign.id,
        sent: outboundMessages.length,
      },
    });

    const nextStep = campaign.sentSteps + 1;
    const done = nextStep >= campaign.totalSteps;

    updatedCampaigns.push({
      ...campaign,
      sentSteps: nextStep,
      lastRunAt: now.toISOString(),
      nextRunAt: done ? null : addDays(now.toISOString(), campaign.intervalDays),
      status: done ? 'completed' : campaign.status,
    });
  }

  await saveCampaigns(event, updatedCampaigns);

  return {
    processedCampaigns: campaigns.length,
    dueCampaigns,
    sentCount,
    skippedNotDue,
    skippedInactive,
    skippedCompleted,
    skippedByCap,
  };
}

exports.handler = async (event) => {
  try {
    const payload = event?.body ? JSON.parse(event.body) : {};
    const result = await runCampaigns(event, { forceRun: payload?.trigger === 'manual' });
    await appendActivity(event, {
      type: 'info',
      source: 'drip-runner',
      message: `Runner finished. Processed ${result.processedCampaigns}, due ${result.dueCampaigns}, sent ${result.sentCount}.`,
      details: result,
    });
    return json(200, { ok: true, ...result });
  } catch (error) {
    try {
      await appendActivity(event, {
        type: 'error',
        source: 'drip-runner',
        message: `Runner failed: ${error.message || 'Unknown error'}`,
      });
    } catch {
      // Ignore logging errors in error path.
    }
    return json(500, { error: error.message || 'Drip runner failed.' });
  }
};

exports.config = {
  // Netlify cron runs in UTC. 02:00 and 11:00 UTC match 9:00 PM and 6:00 AM EST.
  schedule: '0 2,11 * * *',
};
