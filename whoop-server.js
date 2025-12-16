// whoop-server.js - COMPLETE FINAL VERSION
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://whoop-backend-production.up.railway.app/auth/callback';
const PORT = process.env.PORT || 3000;

let userTokens = {};

app.get('/auth/whoop', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

  const authUrl =
    'https://api.prod.whoop.com/oauth/oauth2/auth?' +
    `response_type=code` +
    `&client_id=${WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=read:recovery read:sleep read:workout read:cycles read:body_measurement read:profile` +
    `&state=${state}`;

  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const cookieState = req.cookies.oauth_state;

  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');
  if (!state || state !== cookieState) return res.status(400).send('Invalid state');

  res.clearCookie('oauth_state');

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

    console.log('✅ User authenticated successfully');

    res.send(`
      <html>
        <body style="text-align:center; padding:50px; font-family: Arial;">
          <h1 style="color: #10b981;">✅ Whoop Connected!</h1>
          <p>You can close this window and return to your tracker.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Auth error:', err.response?.data || err.message);
    res.status(500).send('OAuth token exchange failed');
  }
});

async function refreshAccessToken() {
  const tokens = userTokens.default;
  if (!tokens) throw new Error('Not authenticated');

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
  if (Date.now() >= tokens.expiresAt - 300000) return refreshAccessToken();
  return tokens.accessToken;
}

// TEST ENDPOINT - User Profile
app.get('/api/profile', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    const response = await axios.get('https://api.prod.whoop.com/v2/user/profile/basic', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Profile error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// Get last 10 recoveries
app.get('/api/recovery-all', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    const response = await axios.get('https://api.prod.whoop.com/v2/recovery', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 10 }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Recovery-all error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// Get recovery by date
app.get('/api/recovery/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    
    const response = await axios.get('https://api.prod.whoop.com/v2/recovery', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { start, end, limit: 1 }
    });

    const records = response.data.records || [];
    if (records.length === 0) {
      return res.status(404).json({ error: 'No recovery data for this date', date });
    }

    const data = records[0];
    res.json({
      date,
      recoveryScore: data.score?.recovery_score || null,
      hrv: data.score?.hrv_rmssd_milli || null,
      restingHeartRate: data.score?.resting_heart_rate || null,
      spo2: data.score?.spo2_percentage || null
    });
  } catch (err) {
    console.error('Recovery error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch recovery',
      status: err.response?.status,
      details: err.response?.data || err.message 
    });
  }
});

// Get strain by date
app.get('/api/strain/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    
    const response = await axios.get('https://api.prod.whoop.com/v2/cycle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { start, end, limit: 1 }
    });

    const records = response.data.records || [];
    if (records.length === 0) {
      return res.status(404).json({ error: 'No cycle data for this date', date });
    }

    const data = records[0];
    res.json({
      date,
      strain: data.score?.strain || null,
      calories: data.score?.kilojoule ? Math.round(data.score.kilojoule / 4.184) : null,
      averageHeartRate: data.score?.average_heart_rate || null,
      maxHeartRate: data.score?.max_heart_rate || null
    });
  } catch (err) {
    console.error('Strain error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch strain',
      status: err.response?.status,
      details: err.response?.data || err.message 
    });
  }
});

// Get sleep by date
app.get('/api/sleep/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    
    const response = await axios.get('https://api.prod.whoop.com/v2/activity/sleep', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { start, end, limit: 1 }
    });

    const records = response.data.records || [];
    if (records.length === 0) {
      return res.status(404).json({ error: 'No sleep data for this date', date });
    }

    const data = records[0];
    res.json({
      date,
      sleepPerformance: data.score?.sleep_performance_percentage || null,
      sleepEfficiency: data.score?.sleep_efficiency_percentage || null,
      respiratoryRate: data.score?.respiratory_rate || null
    });
  } catch (err) {
    console.error('Sleep error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch sleep',
      status: err.response?.status,
      details: err.response?.data || err.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    authenticated: !!userTokens.default,
    tokenExpiry: userTokens.default ? new Date(userTokens.default.expiresAt).toISOString() : null
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ WHOOP backend running on port ${PORT}`);
});
