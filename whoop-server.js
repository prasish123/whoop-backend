// whoop-server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// =======================
// CONFIGURATION
// =======================
const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://whoop-backend-production.up.railway.app/auth/callback';
const PORT = process.env.PORT || 3000;

// In-memory storage
let userTokens = {};
let oauthStateStore = {}; // temporary state storage for CSRF protection

// =======================
// STEP 1: Initiate OAuth
// =======================
app.get('/auth/whoop', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStateStore[state] = Date.now(); // store temporarily

  const authUrl =
    'https://api.prod.whoop.com/oauth/oauth2/auth?' +
    `response_type=code` +
    `&client_id=${WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=read:recovery read:sleep read:workout read:cycles read:body_measurement` +
    `&state=${state}`;

  res.redirect(authUrl);
});

// =======================
// STEP 2: OAuth Callback
// =======================
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');
  if (!state || !oauthStateStore[state]) return res.status(400).send('Invalid state');

  delete oauthStateStore[state]; // cleanup used state

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

    res.send('✅ WHOOP connected successfully');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('OAuth token exchange failed');
  }
});

// =======================
// TOKEN HELPERS
// =======================
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

  if (Date.now() >= tokens.expiresAt - 300000) { // refresh 5 mins before expiry
    return refreshAccessToken();
  }

  return tokens.accessToken;
}

// =======================
// API ENDPOINTS
// =======================

// Today's Recovery Data
app.get('/api/recovery/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/recovery/${date}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = response.data;

    res.json({
      date,
      recoveryScore: data.score?.recovery_score || null,
      hrv: data.score?.hrv_rmssd || null,
      restingHeartRate: data.score?.resting_heart_rate || null,
      spo2: data.score?.spo2_percentage || null
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'Failed to fetch recovery', details: err.response?.data || err.message });
  }
});

// Sleep Data
app.get('/api/sleep/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/activity/sleep/${date}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = response.data;

    res.json({
      date,
      sleepPerformance: data.score?.sleep_performance_percentage || null,
      quality: data.score?.sleep_efficiency_percentage || null,
      deepSleep: data.sleep?.slow_wave_sleep_duration || null,
      remSleep: data.sleep?.rem_sleep_duration || null,
      lightSleep: data.sleep?.light_sleep_duration || null
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'Failed to fetch sleep', details: err.response?.data || err.message });
  }
});

// Strain Data
app.get('/api/strain/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/cycle/${date}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = response.data;

    res.json({
      date,
      strain: data.score?.strain || null,
      calories: data.score?.kilojoule ? Math.round(data.score.kilojoule / 4.184) : null,
      averageHeartRate: data.score?.average_heart_rate || null,
      maxHeartRate: data.score?.max_heart_rate || null
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'Failed to fetch strain', details: err.response?.data || err.message });
  }
});

// Workouts
app.get('/api/workouts/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/activity/workout`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`
      }
    });

    const workouts = response.data.records || [];

    res.json({
      date,
      workouts: workouts.map(w => ({
        id: w.id,
        sportId: w.sport_id,
        duration: Math.round(w.score?.duration / 60),
        strain: w.score?.strain || null,
        averageHeartRate: w.score?.average_heart_rate || null,
        calories: w.score?.kilojoule ? Math.round(w.score.kilojoule / 4.184) : null,
        startTime: w.start
      }))
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: 'Failed to fetch workouts', details: err.response?.data || err.message });
  }
});

// Combined Today Endpoint
app.get('/api/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const [recovery, sleep, strain, workouts] = await Promise.allSettled([
      axios.get(`https://api.prod.whoop.com/developer/v1/recovery/${today}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get(`https://api.prod.whoop.com/developer/v1/activity/sleep/${today}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get(`https://api.prod.whoop.com/developer/v1/cycle/${today}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get(`https://api.prod.whoop.com/developer/v1/activity/workout`, { headers: { Authorization: `Bearer ${accessToken}` }, params: { start: `${today}T00:00:00.000Z`, end: `${today}T23:59:59.999Z` } })
    ]);

    res.json({
      date: today,
      recovery: recovery.status === 'fulfilled' ? recovery.value.data : null,
      sleep: sleep.status === 'fulfilled' ? sleep.value.data : null,
      strain: strain.status === 'fulfilled' ? strain.value.data : null,
      workouts: workouts.status === 'fulfilled' ? workouts.value.data : null
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch today\'s data', details: err.message });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ ok: true, authenticated: !!userTokens.default });
});

// =======================
// START SERVER
// =======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WHOOP backend running on port ${PORT}`);
});
