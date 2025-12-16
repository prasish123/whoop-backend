const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  'https://whoop-backend-production.up.railway.app/auth/callback';
const PORT = process.env.PORT || 3000;

// In-memory token storage
let userTokens = {};

// =======================
// AUTH START
// =======================
app.get('/auth/whoop', (req, res) => {
  const authUrl =
    'https://api.prod.whoop.com/oauth/oauth2/auth?' +
    `response_type=code` +
    `&client_id=${WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=read:recovery read:sleep read:workout read:cycles read:body_measurement`;

  res.redirect(authUrl);
});

// =======================
// AUTH CALLBACK
// =======================
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) return res.status(400).send(error);
  if (!code) return res.status(400).send('Missing code');

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    userTokens.default = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000
    };

    res.send('WHOOP connected. You may close this window.');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

// =======================
// TOKEN HELPERS
// =======================
async function refreshAccessToken() {
  const tokens = userTokens.default;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: WHOOP_CLIENT_ID,
    client_secret: WHOOP_CLIENT_SECRET
  });

  const response = await axios.post(
    'https://api.prod.whoop.com/oauth/oauth2/token',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  userTokens.default = {
    accessToken: access_token,
    refreshToken: refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + expires_in * 1000
  };

  return access_token;
}

async function getValidAccessToken() {
  const tokens = userTokens.default;
  if (!tokens) throw new Error('Not authenticated');

  if (Date.now() >= tokens.expiresAt - 300000) {
    return refreshAccessToken();
  }

  return tokens.accessToken;
}

// =======================
// API
// =======================
app.get('/api/today', async (req, res) => {
  try {
    const token = await getValidAccessToken();
    const today = new Date().toISOString().split('T')[0];

    const response = await axios.get(
      `https://api.prod.whoop.com/developer/v1/recovery/${today}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

// =======================
// HEALTH
// =======================
app.get('/health', (req, res) => {
  res.json({ ok: true, authenticated: !!userTokens.default });
});

// =======================
// START SERVER
// =======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WHOOP backend running on port ${PORT}`);
});
