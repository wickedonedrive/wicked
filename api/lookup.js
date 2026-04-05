const { createSign } = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { enterId } = req.body;
    if (!enterId) return res.status(400).json({ error: 'Missing enterId' });

    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: 'Auth failed' });

    const spreadsheetId = '1ygiXNdSCktAogi-bQGLZrNmCiWGqHadwTZXsOVvC1kQ';

    // Get all staff data from the sheet
    const sheetsRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A2:D500`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!sheetsRes.ok) {
      return res.status(500).json({ error: 'Failed to read staff sheet' });
    }

    const data = await sheetsRes.json();
    const rows = data.values || [];

    // Find matching ID
    const match = rows.find(row => row[0] && row[0].toString().trim().toLowerCase() === enterId.trim().toLowerCase());

    if (!match) {
      return res.status(404).json({ error: 'ID not found' });
    }

    return res.status(200).json({
      id: match[0],
      name: match[1] || '',
      department: match[2] || '',
      role: match[3] || ''
    });

  } catch (err) {
    console.error('Lookup error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
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
