const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeProcesses = new Map();
const processHistory = [];
const userSessions = new Map(); 

const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; 
const MAX_REQUESTS_PER_WINDOW = 10;

function cleanupStuckProcesses() {
  const now = Date.now();
  const stuckThreshold = 10 * 60 * 1000; 
  
  for (const [processId, process] of activeProcesses.entries()) {
    try {
      const startTime = new Date(process.startTime).getTime();
      const age = now - startTime;
      
      if (age > stuckThreshold) {
        console.warn(`🔄 Cleaning up stuck process: ${processId} (Age: ${Math.round(age/1000)}s)`);
        safeCompleteProcess(processId, process.count, 'timeout_cleanup');
      }
    } catch (error) {
      console.error(`❌ Error cleaning up process ${processId}:`, error.message);
    }
  }
}

setInterval(cleanupStuckProcesses, 5 * 60 * 1000);

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, { count: 1, startTime: now });
    return next();
  }
  
  const window = rateLimit.get(ip);
  
  if (now - window.startTime > RATE_LIMIT_WINDOW) {
    // Reset window
    window.count = 1;
    window.startTime = now;
    return next();
  }
  
  window.count++;
  
  if (window.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.' 
    });
  }
  
  next();
}

function broadcastUpdate(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending WebSocket message:', error.message);
      }
    }
  });
}

function safeCompleteProcess(processId, count, status) {
  try {
    const process = activeProcesses.get(processId);
    if (!process) {
      const inHistory = processHistory.find(p => p.id === processId);
      if (!inHistory) {
        console.warn(`⚠️ Process ${processId} not found in active or history`);
      }
      return;
    }

    if (process.timer) {
      clearInterval(process.timer);
      process.timer = null;
    }

    if (process.timeoutId) {
      clearTimeout(process.timeoutId);
      process.timeoutId = null;
    }

    process.status = status;
    process.count = count;
    process.endTime = new Date().toISOString();
    process.isRunning = false;
    process.completed = true;
    process.duration = Date.now() - new Date(process.startTime).getTime();

    const historyEntry = JSON.parse(JSON.stringify(process));
    processHistory.unshift(historyEntry);

    if (processHistory.length > 100) {
      processHistory.length = 100;
    }

    activeProcesses.delete(processId);

    if (process.userId) {
      const userSession = userSessions.get(process.userId);
      if (userSession) {
        userSession.activeCount = (userSession.activeCount || 0) - 1;
        if (userSession.activeCount < 0) userSession.activeCount = 0;
      }
    }
    
    console.log(`✅ Process ${processId} ${status} with ${count}/${process.target} shares (Duration: ${Math.round(process.duration/1000)}s)`);

    broadcastUpdate('process_completed', {
      processId,
      status,
      count,
      target: process.target,
      duration: process.duration
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Error completing process ${processId}:`, error);
    return false;
  }
}

function convertCookieToString(cookieArray) {
  try {
    if (!Array.isArray(cookieArray)) {
      throw new Error('Cookie must be an array');
    }
    
    const validCookies = cookieArray.filter(c => 
      c && typeof c === 'object' && c.key && c.value
    );
    
    if (validCookies.length === 0) {
      throw new Error('No valid cookies found');
    }
    
    return validCookies
      .map(c => `${encodeURIComponent(c.key)}=${encodeURIComponent(c.value)}`)
      .join('; ');
  } catch (error) {
    console.error('Cookie conversion error:', error.message);
    return null;
  }
}

async function getPostID(url) {
  try {
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000,
        maxRedirects: 5
      }
    );
    
    if (response.data && response.data.id) {
      return response.data.id;
    } else {
      throw new Error('Invalid response from post ID service');
    }
  } catch (error) {
    console.error('❌ Error getting post ID:', error.message);

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && !lastPart.includes('?')) {
          console.log(`🔄 Using fallback post ID: ${lastPart}`);
          return lastPart;
        }
      }
    } catch (e) {
    }
    
    return null;
  }
}

async function getAccessToken(cookieString) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'cookie': cookieString,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
      'cache-control': 'no-cache',
      'pragma': 'no-cache'
    };
    
    const response = await axios.get('https://business.facebook.com/content_management', {
      headers,
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    const patterns = [
      /"accessToken":\s*"([^"]+)"/,
      /access_token=([^&"]+)/,
      /"token":\s*"([^"]+)"/
    ];
    
    for (const pattern of patterns) {
      const match = response.data.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    console.warn('⚠️ Access token not found in response');
    return null;
  } catch (error) {
    console.error('❌ Error getting access token:', error.message);

    try {
      const retryResponse = await axios.get('https://www.facebook.com/adsmanager/manage/campaigns', {
        headers: {
          'cookie': cookieString,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });
      
      const match = retryResponse.data.match(/"accessToken":\s*"([^"]+)"/);
      if (match && match[1]) return match[1];
    } catch (retryError) {
      console.error('❌ Retry failed:', retryError.message);
    }
    
    return null;
  }
}

async function startSharingProcess(processId, cookie, url, amount, interval, userId = 'anonymous') {
  let sharedCount = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;
  let process = null;
  let timer = null;
  
  try {
    process = activeProcesses.get(processId);
    if (!process) {
      throw new Error('Process not initialized');
    }

    const cookieString = convertCookieToString(cookie);
    if (!cookieString) {
      throw new Error('Invalid cookie format');
    }

    console.log(`🔄 Process ${processId}: Getting post ID...`);
    const postId = await getPostID(url);
    if (!postId) {
      throw new Error('Cannot get post ID. Check URL or try again.');
    }

    console.log(`🔄 Process ${processId}: Getting access token...`);
    const accessToken = await getAccessToken(cookieString);
    if (!accessToken) {
      throw new Error('Cannot get access token. Cookie may be expired.');
    }
    
    console.log(`✅ Process ${processId}: Initialization complete. Starting shares...`);
    
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.9',
      'connection': 'keep-alive',
      'cookie': cookieString,
      'host': 'graph.facebook.com',
      'origin': 'https://www.facebook.com',
      'referer': 'https://www.facebook.com/',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest'
    };

    timer = setInterval(async () => {
      if (!process || !process.isRunning) {
        if (timer) clearInterval(timer);
        return;
      }
      
      if (sharedCount >= amount) {
        clearInterval(timer);
        safeCompleteProcess(processId, sharedCount, 'completed');
        return;
      }
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(`❌ Process ${processId}: Too many consecutive errors (${consecutiveErrors})`);
        clearInterval(timer);
        safeCompleteProcess(processId, sharedCount, 'failed');
        return;
      }
      
      try {
        const shareUrl = `https://graph.facebook.com/v18.0/me/feed`;
        const postData = {
          link: `https://www.facebook.com/${postId}`,
          published: false,
          access_token: accessToken
        };
        
        const response = await axios.post(shareUrl, postData, {
          headers,
          timeout: 10000,
          validateStatus: (status) => status < 500
        });
        
        if (response.status === 200 && response.data && response.data.id) {
          sharedCount++;
          consecutiveErrors = 0;

          if (process) {
            process.count = sharedCount;
            process.lastUpdate = new Date().toISOString();
            process.progress = Math.min(100, (sharedCount / amount * 100));
          }
        
          if (sharedCount % 10 === 0 || amount <= 10) {
            console.log(`📈 Process ${processId}: ${sharedCount}/${amount} shares (${process.progress.toFixed(1)}%)`);

            broadcastUpdate('progress_update', {
              processId,
              count: sharedCount,
              target: amount,
              progress: process.progress
            });
          }

          if (sharedCount >= amount) {
            clearInterval(timer);
            safeCompleteProcess(processId, sharedCount, 'completed');
          }
        } else {
          consecutiveErrors++;
          console.warn(`⚠️ Process ${processId}: Share attempt ${sharedCount + 1} failed (Status: ${response.status})`);
        }
      } catch (error) {
        consecutiveErrors++;
        
        if (error.response) {
          const status = error.response.status;
          if (status === 400 || status === 403) {
            console.error(`❌ Process ${processId}: Authentication error (${status}). Stopping.`);
            clearInterval(timer);
            safeCompleteProcess(processId, sharedCount, 'auth_error');
            return;
          }
        }
        
        console.warn(`⚠️ Process ${processId}: Share attempt ${sharedCount + 1} failed (Error ${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        if (consecutiveErrors >= 2) {
          const backoffTime = Math.min(interval * 1000 * Math.pow(2, consecutiveErrors - 1), 30000);
          console.log(`⏳ Process ${processId}: Backing off for ${backoffTime}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }, interval * 1000);

    if (process) {
      process.timer = timer;
    }

    const estimatedTime = (amount * interval * 1000) + 60000; // +60 seconds buffer
    const timeoutId = setTimeout(() => {
      if (process && process.isRunning) {
        console.warn(`⏰ Process ${processId}: Timeout after ${Math.round(estimatedTime/1000)}s`);
        if (timer) clearInterval(timer);
        safeCompleteProcess(processId, sharedCount, 'timeout');
      }
    }, estimatedTime);
    
    if (process) {
      process.timeoutId = timeoutId;
    }
    
  } catch (error) {
    console.error(`❌ Process ${processId} failed to start:`, error.message);

    if (timer) clearInterval(timer);
    safeCompleteProcess(processId, 0, 'failed');
  }
}

wss.on('connection', (ws) => {
  console.log('🔗 New WebSocket connection');

  const initialData = {
    type: 'initial',
    data: {
      active: Array.from(activeProcesses.values()),
      history: processHistory.slice(0, 20),
      stats: {
        totalActive: activeProcesses.size,
        totalHistory: processHistory.length,
        uptime: process.uptime()
      }
    }
  };
  
  try {
    ws.send(JSON.stringify(initialData));
  } catch (error) {
    console.error('Error sending initial data:', error.message);
  }
  
  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: {
      activeProcesses: activeProcesses.size,
      processHistory: processHistory.length,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    }
  });
});

app.get('/total', (req, res) => {
  try {
    const data = Array.from(activeProcesses.values()).map((process, index) => ({
      session: index + 1,
      url: process.url,
      count: process.count,
      id: process.id,
      target: process.target,
      status: process.status,
      interval: process.interval || 1,
      isRunning: process.isRunning || false,
      startTime: process.startTime,
      lastUpdate: process.lastUpdate || process.startTime,
      progress: process.progress || 0,
      userId: process.userId || 'anonymous',
      estimatedTimeLeft: process.isRunning && process.count > 0 
        ? Math.round(((process.target - process.count) * process.interval))
        : 0
    }));
    
    res.json({
      success: true,
      count: data.length,
      processes: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const filteredHistory = processHistory
      .slice(0, limit)
      .map(process => ({
        ...process,
        successRate: process.target > 0 
          ? Math.round((process.count / process.target) * 100) 
          : 0
      }));
    
    res.json({
      success: true,
      count: filteredHistory.length,
      history: filteredHistory,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.get('/api/status/:id', (req, res) => {
  try {
    const processId = req.params.id;

    let process = activeProcesses.get(processId);
    
    if (process) {
      return res.json({
        success: true,
        status: 'active',
        data: {
          ...process,
          estimatedCompletion: process.isRunning && process.count > 0
            ? new Date(Date.now() + ((process.target - process.count) * process.interval * 1000)).toISOString()
            : null
        }
      });
    }

    const historyProcess = processHistory.find(p => p.id === processId);
    if (historyProcess) {
      return res.json({
        success: true,
        status: 'completed',
        data: historyProcess
      });
    }
    
    res.status(404).json({
      success: false,
      error: 'Process not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/api/submit', rateLimiter, async (req, res) => {
  try {
    const { cookie, url, amount, interval, userId = 'anonymous' } = req.body;
    
    if (!cookie || !url || !amount || !interval) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: cookie, url, amount, interval' 
      });
    }
    
    if (amount > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Amount cannot exceed 1000 shares per process'
      });
    }
    
    if (interval < 1) {
      return res.status(400).json({
        success: false,
        error: 'Interval must be at least 1 second'
      });
    }

    let parsedCookie;
    try {
      parsedCookie = Array.isArray(cookie) ? cookie : JSON.parse(cookie);
    } catch (e) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid cookie format. Must be JSON array' 
      });
    }

    const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const processData = {
      id: processId,
      url: url,
      target: parseInt(amount),
      interval: parseInt(interval),
      count: 0,
      status: 'initializing',
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      isRunning: true,
      timer: null,
      timeoutId: null,
      progress: 0,
      userId: userId
    };

    activeProcesses.set(processId, processData);

    if (!userSessions.has(userId)) {
      userSessions.set(userId, { 
        userId, 
        activeCount: 0, 
        totalProcesses: 0,
        lastActive: new Date().toISOString() 
      });
    }
    
    const userSession = userSessions.get(userId);
    userSession.activeCount++;
    userSession.totalProcesses++;
    userSession.lastActive = new Date().toISOString();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Boost process started successfully',
      processId: processId,
      session: activeProcesses.size,
      estimatedTime: Math.round(amount * interval) + ' seconds',
      monitorUrl: `/api/status/${processId}`
    });

    broadcastUpdate('new_process', {
      processId,
      url,
      target: amount,
      userId
    });

    setTimeout(async () => {
      try {
        processData.status = 'running';
        await startSharingProcess(processId, parsedCookie, url, parseInt(amount), parseInt(interval), userId);
      } catch (error) {
        console.error(`Background process error for ${processId}:`, error);
      }
    }, 100);
    
  } catch (err) {
    console.error('Error starting process:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Internal server error' 
    });
  }
});

app.post('/api/stop/:id', (req, res) => {
  try {
    const processId = req.params.id;
    const process = activeProcesses.get(processId);
    
    if (!process) {
      const historyProcess = processHistory.find(p => p.id === processId);
      if (historyProcess) {
        return res.json({
          success: true,
          message: 'Process already completed',
          status: historyProcess.status
        });
      }
      
      return res.status(404).json({
        success: false,
        error: 'Process not found'
      });
    }

    const success = safeCompleteProcess(processId, process.count, 'stopped');
    
    if (success) {
      res.json({
        success: true,
        message: 'Process stopped successfully',
        sharesCompleted: process.count
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to stop process'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.delete('/api/history', (req, res) => {
  try {
    const count = processHistory.length;
    processHistory.length = 0;
    
    res.json({
      success: true,
      message: `Cleared ${count} history entries`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const totalShares = processHistory.reduce((sum, p) => sum + p.count, 0);
    const successfulProcesses = processHistory.filter(p => p.status === 'completed').length;
    const failedProcesses = processHistory.filter(p => p.status === 'failed').length;
    
    res.json({
      success: true,
      stats: {
        activeProcesses: activeProcesses.size,
        totalHistory: processHistory.length,
        totalShares,
        successfulProcesses,
        failedProcesses,
        successRate: processHistory.length > 0 
          ? Math.round((successfulProcesses / processHistory.length) * 100) 
          : 0,
        uniqueUsers: userSessions.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║         🚀 ShareBoost Server Started!             ║
  ║                                                   ║
  ║  📡 Port: ${PORT.toString().padEnd(38)} ║
  ║  🌐 URL: http://localhost:${PORT.toString().padEnd(30)} ║
  ║  🕐 Time: ${new Date().toLocaleTimeString().padEnd(32)} ║
  ║                                                   ║
  ║  ✅ Multi-user support: ENABLED                  ║
  ║  ✅ Real-time updates: ENABLED                   ║
  ║  ✅ Rate limiting: ENABLED                       ║
  ║  ✅ Auto cleanup: ENABLED                        ║
  ║  ✅ Error recovery: ENABLED                      ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);
  
  console.log('\n📊 Server Features:');
  console.log('├── WebSocket real-time updates');
  console.log('├── Rate limiting (10 requests/min)');
  console.log('├── Automatic stuck process cleanup');
  console.log('├── Exponential backoff on errors');
  console.log('├── Multi-user session tracking');
  console.log('├── Comprehensive error handling');
  console.log('└── Detailed logging and monitoring\n');
});
