// Whoop Integration Backend Server
// This server handles Whoop OAuth and fetches your fitness data

const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration - Add your credentials here
const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID || 'YOUR_CLIENT_ID_HERE';
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://whoop-backend-production.up.railway.app/auth/callback';
const PORT = process.env.PORT || 3000;

// In-memory token storage (use database in production)
let userTokens = {};

// =====================================================
// STEP 1: Initiate Whoop OAuth Login
// =====================================================
app.get('/auth/whoop', (req, res) => {
  console.log('=== Starting Whoop OAuth ===');
  console.log('Client ID:', WHOOP_CLIENT_ID);
  console.log('Redirect URI:', REDIRECT_URI);
  
  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?` +
    `client_id=${WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=read:recovery read:sleep read:workout read:cycles read:body_measurement`;
  
  console.log('Auth URL:', authUrl);
  res.redirect(authUrl);
});

// =====================================================
// STEP 2: Handle OAuth Callback
// =====================================================
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  console.log('=== OAuth Callback Received ===');
  console.log('Code:', code ? 'Present' : 'Missing');
  console.log('Error:', error);
  
  if (error) {
    return res.status(400).send(`OAuth Error: ${error}`);
  }
  
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    // Exchange code for access token using Basic Auth
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    });

    console.log('Exchanging code for token...');
    const basicAuth = Buffer.from(`${WHOOP_CLIENT_ID}:${WHOOP_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await axios.post('https://api.prod.whoop.com/oauth/oauth2/token', 
      params.toString(), 
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    // Store tokens (in production, use database)
    userTokens['default'] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };

    console.log('✅ Successfully authenticated with Whoop!');
    
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Connected to Whoop</title>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; margin: 0;">
          <div style="background: white; padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <h1 style="color: #10b981; font-size: 3em; margin: 0;">✅</h1>
            <h2 style="color: #333; margin: 20px 0;">Connected to Whoop!</h2>
            <p style="color: #666; font-size: 1.1em;">You can close this window and return to your tracker.</p>
            <p style="color: #999; font-size: 0.9em; margin-top: 30px;">Redirecting in 3 seconds...</p>
          </div>
          <script>
            setTimeout(() => {
              window.location.href = 'https://prasish123.github.io/beachbody-tracker/';
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Error exchanging code for token:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
    
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">❌ Authentication Failed</h1>
          <p>Error: ${error.response?.data?.error || error.message}</p>
          <p style="color: #666; font-size: 0.9em;">${error.response?.data?.error_description || ''}</p>
          <button onclick="window.location.href='/auth/whoop'" style="margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">
            Try Again
          </button>
        </body>
      </html>
    `);
  }
});

// =====================================================
// STEP 3: Refresh Access Token
// =====================================================
async function refreshAccessToken() {
  const tokens = userTokens['default'];
  
  if (!tokens) {
    throw new Error('No tokens found. Please authenticate first.');
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    });

    const basicAuth = Buffer.from(`${WHOOP_CLIENT_ID}:${WHOOP_CLIENT_SECRET}`).toString('base64');
    
    const response = await axios.post('https://api.prod.whoop.com/oauth/oauth2/token', 
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    
    userTokens['default'] = {
      accessToken: access_token,
      refreshToken: refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + (expires_in * 1000)
    };

    console.log('✅ Token refreshed successfully');
    return access_token;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw error;
  }
}

// =====================================================
// Helper: Get Valid Access Token
// =====================================================
async function getValidAccessToken() {
  const tokens = userTokens['default'];
  
  if (!tokens) {
    throw new Error('Not authenticated. Please visit /auth/whoop');
  }

  // Check if token is expired or about to expire (within 5 minutes)
  if (Date.now() >= tokens.expiresAt - 300000) {
    console.log('Token expired, refreshing...');
    return await refreshAccessToken();
  }

  return tokens.accessToken;
}

// =====================================================
// STEP 4: Fetch Recovery Data
// =====================================================
app.get('/api/recovery/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/recovery/${date}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = response.data;
    
    res.json({
      date: date,
      recoveryScore: data.score?.recovery_score || null,
      hrv: data.score?.hrv_rmssd || null,
      restingHeartRate: data.score?.resting_heart_rate || null,
      spo2: data.score?.spo2_percentage || null
    });
  } catch (error) {
    console.error('Error fetching recovery:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch recovery data',
      details: error.response?.data || error.message
    });
  }
});

// =====================================================
// STEP 5: Fetch Sleep Data
// =====================================================
app.get('/api/sleep/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/activity/sleep/${date}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = response.data;
    
    res.json({
      date: date,
      sleepPerformance: data.score?.sleep_performance_percentage || null,
      durationMinutes: data.score?.sleep_consistency_percentage || null,
      quality: data.score?.sleep_efficiency_percentage || null,
      deepSleep: data.sleep?.slow_wave_sleep_duration || null,
      remSleep: data.sleep?.rem_sleep_duration || null,
      lightSleep: data.sleep?.light_sleep_duration || null
    });
  } catch (error) {
    console.error('Error fetching sleep:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch sleep data',
      details: error.response?.data || error.message
    });
  }
});

// =====================================================
// STEP 6: Fetch Strain/Cycle Data
// =====================================================
app.get('/api/strain/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/cycle/${date}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = response.data;
    
    res.json({
      date: date,
      strain: data.score?.strain || null,
      kilojoules: data.score?.kilojoule || null,
      averageHeartRate: data.score?.average_heart_rate || null,
      maxHeartRate: data.score?.max_heart_rate || null,
      calories: data.score?.kilojoule ? Math.round(data.score.kilojoule / 4.184) : null
    });
  } catch (error) {
    console.error('Error fetching strain:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch strain data',
      details: error.response?.data || error.message
    });
  }
});

// =====================================================
// STEP 7: Fetch Workout Data
// =====================================================
app.get('/api/workouts/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();

    const response = await axios.get(`https://api.prod.whoop.com/developer/v1/activity/workout`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        start: `${date}T00:00:00.000Z`,
        end: `${date}T23:59:59.999Z`
      }
    });

    const workouts = response.data.records || [];
    
    res.json({
      date: date,
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
  } catch (error) {
    console.error('Error fetching workouts:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch workout data',
      details: error.response?.data || error.message
    });
  }
});

// =====================================================
// STEP 8: Get All Today's Data (Combined)
// =====================================================
app.get('/api/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
    console.log('Fetching today\'s data for:', today);
    
    // Fetch all data in parallel
    const [recovery, sleep, strain, workouts] = await Promise.allSettled([
      axios.get(`https://api.prod.whoop.com/developer/v1/recovery/${today}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }),
      axios.get(`https://api.prod.whoop.com/developer/v1/activity/sleep/${today}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }),
      axios.get(`https://api.prod.whoop.com/developer/v1/cycle/${today}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }),
      axios.get(`https://api.prod.whoop.com/developer/v1/activity/workout`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: {
          start: `${today}T00:00:00.000Z`,
          end: `${today}T23:59:59.999Z`
        }
      })
    ]);

    // Process recovery
    const recoveryData = recovery.status === 'fulfilled' ? {
      recoveryScore: recovery.value.data.score?.recovery_score || null,
      hrv: recovery.value.data.score?.hrv_rmssd || null,
      restingHeartRate: recovery.value.data.score?.resting_heart_rate || null
    } : null;

    // Process sleep
    const sleepData = sleep.status === 'fulfilled' ? {
      sleepPerformance: sleep.value.data.score?.sleep_performance_percentage || null,
      quality: sleep.value.data.score?.sleep_efficiency_percentage || null
    } : null;

    // Process strain
    const strainData = strain.status === 'fulfilled' ? {
      strain: strain.value.data.score?.strain || null,
      calories: strain.value.data.score?.kilojoule ? Math.round(strain.value.data.score.kilojoule / 4.184) : null
    } : null;

    // Process workouts
    const workoutsData = workouts.status === 'fulfilled' ? {
      workouts: (workouts.value.data.records || []).map(w => ({
        duration: Math.round(w.score?.duration / 60)
      }))
    } : null;

    console.log('Successfully fetched data:', {
      recovery: !!recoveryData,
      sleep: !!sleepData,
      strain: !!strainData,
      workouts: !!workoutsData
    });

    res.json({
      date: today,
      recovery: recoveryData,
      sleep: sleepData,
      strain: strainData,
      workouts: workoutsData
    });
  } catch (error) {
    console.error('Error fetching today\'s data:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch data',
      details: error.message
    });
  }
});

// =====================================================
// Health Check
// =====================================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    authenticated: !!userTokens['default'],
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// Start Server
// =====================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ========================================
  🚀 Whoop Integration Server Running!
  ========================================
  
  Server: https://whoop-backend-production.up.railway.app
  
  📝 Setup Steps:
  1. Visit: https://whoop-backend-production.up.railway.app/auth/whoop
  2. Login with your Whoop account
  3. Authorize the app
  4. Start fetching data!
  
  📊 Available Endpoints:
  - GET /auth/whoop              - Start OAuth flow
  - GET /api/recovery/:date      - Recovery score, HRV, RHR
  - GET /api/sleep/:date         - Sleep performance & quality
  - GET /api/strain/:date        - Daily strain & calories
  - GET /api/workouts/:date      - Workout details
  - GET /api/today               - All today's data combined
  - GET /health                  - Server health check
  
  ⚙️  Configuration:
  - Client ID: ${WHOOP_CLIENT_ID ? WHOOP_CLIENT_ID.substring(0, 10) + '...' : 'NOT SET'}
  - Client Secret: ${WHOOP_CLIENT_SECRET && WHOOP_CLIENT_SECRET !== 'YOUR_CLIENT_SECRET_HERE' ? '***SET***' : 'NOT SET'}
  - Redirect URI: ${REDIRECT_URI}
  
  ========================================
  `);
});
