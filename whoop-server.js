// whoop-server.js - CORRECT V2 API IMPLEMENTATION
// Recovery data is accessed through CYCLES, not directly
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

// CORRECT IMPLEMENTATION: Get recovery via cycle
app.get('/api/recovery/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    console.log('📅 Getting cycle for date:', date);
    
    // Step 1: Get cycle for the date
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

    const cycle = cycles[0];
    const cycleId = cycle.id;
    
    console.log('✅ Found cycle ID:', cycleId);

    // Step 2: Get recovery for the cycle
    try {
      const recoveryResponse = await axios.get(`https://api.prod.whoop.com/v2/cycle/${cycleId}/recovery`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const recoveryData = recoveryResponse.data;
      
      res.json({
        date,
        cycleId: cycleId,
        recoveryScore: recoveryData.score?.recovery_score || null,
        hrv: recoveryData.score?.hrv_rmssd_milli || null,
        restingHeartRate: recoveryData.score?.resting_heart_rate || null,
        spo2: recoveryData.score?.spo2_percentage || null,
        skinTemp: recoveryData.score?.skin_temp_celsius || null,
        userCalibrating: recoveryData.score?.user_calibrating || false
      });
    } catch (recoveryErr) {
      // Cycle exists but no recovery yet (user didn't wear strap previous night)
      if (recoveryErr.response?.status === 404) {
        return res.status(404).json({ 
          error: 'No recovery data for this cycle', 
          date,
          cycleId,
          message: 'User may not have worn strap during sleep' 
        });
      }
      throw recoveryErr;
    }
  } catch (err) {
    console.error('❌ Recovery error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch recovery',
      details: err.response?.data || err.message 
    });
  }
});

// Get sleep via cycle
app.get('/api/sleep/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    console.log('📅 Getting sleep for date:', date);
    
    // Get cycle for the date
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

    // Get sleep for the cycle
    const sleepResponse = await axios.get(`https://api.prod.whoop.com/v2/cycle/${cycleId}/sleep`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const sleepData = sleepResponse.data;
    
    res.json({
      date,
      sleepPerformance: sleepData.score?.sleep_performance_percentage || null,
      sleepEfficiency: sleepData.score?.sleep_efficiency_percentage || null,
      sleepConsistency: sleepData.score?.sleep_consistency_percentage || null,
      respiratoryRate: sleepData.score?.respiratory_rate || null
    });
  } catch (err) {
    console.error('❌ Sleep error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch sleep',
      details: err.response?.data || err.message 
    });
  }
});

// Get strain (cycle data directly)
app.get('/api/strain/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    console.log('📅 Getting strain for date:', date);
    
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
    console.error('❌ Strain error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Failed to fetch strain',
      details: err.response?.data || err.message 
    });
  }
});

// Test endpoint - get latest cycle
app.get('/api/cycle-latest', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    
    const response = await axios.get('https://api.prod.whoop.com/v2/cycle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 1 }
    });

    res.json(response.data);
  } catch (err) {
    console.error('Cycle error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      error: err.message,
      details: err.response?.data 
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
  console.log(`✅ WHOOP backend (CORRECT V2 implementation) running on port ${PORT}`);
});
