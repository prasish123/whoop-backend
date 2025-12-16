// whoop-server.js - COMPLETE WITH ALL TEST ENDPOINTS
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
          <p>You can close this window and test endpoints.</p>
          <h3>Test These URLs:</h3>
          <ul style="text-align: left; max-width: 600px; margin: 20px auto;">
            <li><a href="/health" target="_blank">/health</a> - Check auth status</li>
            <li><a href="/api/profile" target="_blank">/api/profile</a> - User profile</li>
            <li><a href="/api/body" target="_blank">/api/body</a> - Body measurements</li>
            <li><a href="/api/cycle-latest" target="_blank">/api/cycle-latest</a> - Latest cycle</li>
            <li><a href="/api/sleep-all" target="_blank">/api/sleep-all</a> - Recent sleep</li>
            <li><a href="/api/workouts-all" target="_blank">/api/workouts-all</a> - Recent workouts</li>
          </ul>
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

// =====================
// TEST ENDPOINTS
// =====================

// 1. User Profile (should ALWAYS work)
app.get('/api/profile', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log('📞 Calling /v2/user/profile/basic');
    
    const response = await axios.get('https://api.prod.whoop.com/v2/user/profile/basic', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    console.log('✅ Profile success:', response.data);
    res.json(response.data);
  } catch (err) {
    console.error('❌ Profile error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// 2. Body Measurements (should work)
app.get('/api/body', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log('📞 Calling /v2/user/measurement/body');
    
    const response = await axios.get('https://api.prod.whoop.com/v2/user/measurement/body', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    console.log('✅ Body measurements success:', response.data);
    res.json(response.data);
  } catch (err) {
    console.error('❌ Body error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// 3. Latest Cycle
app.get('/api/cycle-latest', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log('📞 Calling /v2/cycle (limit 1)');
    
    const response = await axios.get('https://api.prod.whoop.com/v2/cycle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 1 }
    });
    
    console.log('✅ Cycle success:', response.data);
    res.json(response.data);
  } catch (err) {
    console.error('❌ Cycle error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// 4. Recent Sleep
app.get('/api/sleep-all', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log('📞 Calling /v2/activity/sleep (limit 5)');
    
    const response = await axios.get('https://api.prod.whoop.com/v2/activity/sleep', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 5 }
    });
    
    console.log('✅ Sleep success:', response.data);
    res.json(response.data);
  } catch (err) {
    console.error('❌ Sleep error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// 5. Recent Workouts
app.get('/api/workouts-all', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log('📞 Calling /v2/activity/workout (limit 5)');
    
    const response = await axios.get('https://api.prod.whoop.com/v2/activity/workout', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 5 }
    });
    
    console.log('✅ Workout success:', response.data);
    res.json(response.data);
  } catch (err) {
    console.error('❌ Workout error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      status: err.response?.status,
      details: err.response?.data 
    });
  }
});

// =====================
// ACTUAL API ENDPOINTS (for tracker)
// =====================

app.get('/api/recovery/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    
    const cycleResponse = await axios.get('https://api.prod.whoop.com/v2/cycle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { start, end, limit: 1 }
    });

    const cycles = cycleResponse.data.records || [];
    if (cycles.length === 0) {
      return res.status(404).json({ error: 'No cycle data for this date', date });
    }

    const cycleId = cycles[0].id;

    try {
      const recoveryResponse = await axios.get(`https://api.prod.whoop.com/v2/cycle/${cycleId}/recovery`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const recoveryData = recoveryResponse.data;
      
      res.json({
        date,
        recoveryScore: recoveryData.score?.recovery_score || null,
        hrv: recoveryData.score?.hrv_rmssd_milli || null,
        restingHeartRate: recoveryData.score?.resting_heart_rate || null,
        spo2: recoveryData.score?.spo2_percentage || null
      });
    } catch (recoveryErr) {
      if (recoveryErr.response?.status === 404) {
        return res.status(404).json({ error: 'No recovery data for this cycle', date });
      }
      throw recoveryErr;
    }
  } catch (err) {
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch recovery',
      details: err.response?.data || err.message 
    });
  }
});

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
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch strain',
      details: err.response?.data || err.message 
    });
  }
});

app.get('/api/sleep/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    
    const cycleResponse = await axios.get('https://api.prod.whoop.com/v2/cycle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { start, end, limit: 1 }
    });

    const cycles = cycleResponse.data.records || [];
    if (cycles.length === 0) {
      return res.status(404).json({ error: 'No cycle data for this date', date });
    }

    const cycleId = cycles[0].id;

    const sleepResponse = await axios.get(`https://api.prod.whoop.com/v2/cycle/${cycleId}/sleep`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const sleepData = sleepResponse.data;
    
    res.json({
      date,
      sleepPerformance: sleepData.score?.sleep_performance_percentage || null,
      sleepEfficiency: sleepData.score?.sleep_efficiency_percentage || null,
      respiratoryRate: sleepData.score?.respiratory_rate || null
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch sleep',
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
  console.log(`🧪 Test endpoints at /api/profile, /api/body, /api/cycle-latest, etc.`);
});
