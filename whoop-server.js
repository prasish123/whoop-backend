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
  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?` +
    `client_id=${WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=read:recovery read:sleep read:workout read:cycles read:body_measurement`;
  
  console.log('Redirecting to Whoop OAuth:', authUrl);
  res.redirect(authUrl);
});

// =====================================================
// STEP 2: Handle OAuth Callback
// =====================================================
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://api.prod.whoop.com/oauth/oauth2/token', {
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    });

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
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1 style="color: #10b981;">✅ Connected to Whoop!</h1>
          <p>You can close this window and return to your tracker.</p>
          <script>
            setTimeout(() => {
              window.location.href = '${REDIRECT_URI.replace('/auth/callback', '')}';
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
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
    const response = await axios.post('https://api.prod.whoop.com/oauth/oauth2/token', {
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    });

    const { access_token, refresh_token, expires_in } = response.data;
    
    userTokens['default'] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };

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
    res.status(500).json({ error: 'Failed to fetch recovery data' });
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
    res.status(500).json({ error: 'Failed to fetch sleep data' });
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
    res.status(500).json({ error: 'Failed to fetch strain data' });
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
        duration: Math.round(w.score?.duration / 60), // Convert to minutes
        strain: w.score?.strain || null,
        averageHeartRate: w.score?.average_heart_rate || null,
        calories: w.score?.kilojoule ? Math.round(w.score.kilojoule / 4.184) : null,
        startTime: w.start
      }))
    });
  } catch (error) {
    console.error('Error fetching workouts:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch workout data' });
  }
});

// =====================================================
// STEP 8: Get All Today's Data (Combined)
// =====================================================
app.get('/api/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const accessToken = await getValidAccessToken();
    
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

    res.json({
      date: today,
      recovery: recoveryData,
      sleep: sleepData,
      strain: strainData,
      workouts: workoutsData
    });
  } catch (error) {
    console.error('Error fetching today\'s data:', error.message);
    res.status(500).json({ error: 'Failed to fetch data' });
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
  - GET /api/recovery/:date    - Recovery score, HRV, RHR
  - GET /api/sleep/:date        - Sleep performance & quality
  - GET /api/strain/:date       - Daily strain & calories
  - GET /api/workouts/:date     - Workout details
  - GET /api/today              - All today's data combined
  
  ⚙️  Configuration:
  - Client ID: ${WHOOP_CLIENT_ID.substring(0, 10)}...
  - Redirect URI: ${REDIRECT_URI}
  
  ========================================
  `);
});
