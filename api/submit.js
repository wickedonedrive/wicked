const { createSign } = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { enterId, startTime, completionTime, confirmed } = req.body;

    if (!enterId) return res.status(400).json({ error: 'Missing enterId' });

    const token = await getAccessToken();
    if (!token) {
      console.error('Failed to get access token');
      return res.status(500).json({ error: 'Auth failed' });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Get current data to find next empty row
    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const getData = await getRes.json();
    const nextRow = (getData.values ? getData.values.length : 1) + 1;

    // Write only to columns A-E on that specific row, leaving F and G untouched
    const writeRange = `Sheet1!A${nextRow}:E${nextRow}`;

    const sheetsRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[
            enterId || '',
            startTime || new Date().toISOString(),
            completionTime || new Date().toISOString(),
            confirmed || 'Yes',
            'Signed'
          ]],
        }),
      }
    );

    if (!sheetsRes.ok) {
      const errBody = await sheetsRes.text();
      console.error('Sheets API error:', sheetsRes.status, errBody);
      return res.status(500).json({ error: 'Failed to write to sheet', detail: errBody });
    }

    return res.status(200).json({ status: 'success' });

  } catch (err) {
    console.error('Handler error:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};

async function getAccessToken() {
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    console.error('Failed to parse service account JSON:', e.message);
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    sub: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;

  let signature;
  try {
    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    sign.end();
    signature = base64url(sign.sign(credentials.private_key));
  } catch (e) {
    console.error('Signing error:', e.message);
    return null;
  }

  const jwt = `${signingInput}.${signature}`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token response:', JSON.stringify(tokenData));
      return null;
    }
    return tokenData.access_token;
  } catch (e) {
    console.error('Token fetch error:', e.message);
    return null;
  }
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
