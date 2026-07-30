const { randomUUID } = require('crypto');
const { json, loadCampaigns, saveCampaigns } = require('./_crmStore');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const campaigns = await loadCampaigns(event);
      return json(200, { campaigns });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const payload = JSON.parse(event.body || '{}');
    const campaigns = await loadCampaigns(event);

    if (payload.action === 'create') {
      const campaign = payload.campaign || {};
      const intervalDays = Number(campaign.intervalDays) || 3;
      const totalSteps = Number(campaign.totalSteps) || 3;
      const startAt = new Date(campaign.startAt || new Date().toISOString()).toISOString();

      campaigns.unshift({
        id: randomUUID(),
        name: campaign.name || 'Untitled campaign',
        audience: campaign.audience || 'all',
        testEmail: campaign.testEmail || '',
        templateKey: campaign.templateKey || 'followup',
        templateSubject: campaign.templateSubject || '',
        templateBody: campaign.templateBody || '',
        senderName: campaign.senderName || 'Your Name',
        intervalDays,
        totalSteps,
        sentSteps: 0,
        status: 'active',
        startAt,
        nextRunAt: startAt,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
      });

      await saveCampaigns(event, campaigns);
      return json(200, { ok: true, campaigns });
    }

    if (payload.action === 'pause' || payload.action === 'resume') {
      const status = payload.action === 'pause' ? 'paused' : 'active';
      const updated = campaigns.map((campaign) =>
        campaign.id === payload.campaignId ? { ...campaign, status } : campaign
      );
      await saveCampaigns(event, updated);
      return json(200, { ok: true, campaigns: updated });
    }

    if (payload.action === 'delete') {
      const updated = campaigns.filter((campaign) => campaign.id !== payload.campaignId);
      await saveCampaigns(event, updated);
      return json(200, { ok: true, campaigns: updated });
    }

    if (payload.action === 'cancel-all-active') {
      const updated = campaigns.map((campaign) =>
        campaign.status === 'active'
          ? {
              ...campaign,
              status: 'paused',
            }
          : campaign
      );
      await saveCampaigns(event, updated);
      return json(200, { ok: true, campaigns: updated });
    }

    return json(400, { error: 'Unsupported action.' });
  } catch (error) {
    return json(500, { error: error.message || 'Campaign request failed.' });
  }
};
