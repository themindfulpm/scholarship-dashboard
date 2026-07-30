const { json, loadActivityLog } = require('./_crmStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const log = await loadActivityLog(event);
    return json(200, { log });
  } catch (error) {
    return json(500, { error: error.message || 'Failed to load activity log.' });
  }
};
