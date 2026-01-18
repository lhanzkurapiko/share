const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const total = new Map();
let currentSessionId = 1;
const connectedUsers = new Map(); 

const rateLimit = new Map();
const MAX_REQUESTS_PER_MINUTE = 100;
const RATE_LIMIT_WINDOW = 60000; 

app.use((req, res, next) => {
    let userIp = req.ip || req.connection.remoteAddress;
    userIp = userIp.replace(/^::ffff:/, '').split(':')[0]; 
    
    const userAgent = req.headers['user-agent'] || 'unknown';
    const userId = `${userIp}-${userAgent}`.substring(0, 100); 

    const now = Date.now();
    
    if (!rateLimit.has(userIp)) {
        rateLimit.set(userIp, { count: 1, startTime: now });
    } else {
        const userLimits = rateLimit.get(userIp);
        
        if (now - userLimits.startTime > RATE_LIMIT_WINDOW) {
            userLimits.count = 1;
            userLimits.startTime = now;
        } else if (userLimits.count >= MAX_REQUESTS_PER_MINUTE) {
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please try again later.'
            });
        } else {
            userLimits.count++;
        }
        rateLimit.set(userIp, userLimits);
    }
    
    connectedUsers.set(userId, {
        ip: userIp,
        userAgent: userAgent,
        lastActivity: Date.now(),
        requestCount: (connectedUsers.get(userId)?.requestCount || 0) + 1,
        firstSeen: connectedUsers.get(userId)?.firstSeen || Date.now() 
    });
    
    next();
});

setInterval(() => {
    const now = Date.now();
    let removedRateLimits = 0;
    
    for (const [ip, data] of rateLimit.entries()) {
        if (now - data.startTime > 120000) { 
            rateLimit.delete(ip);
            removedRateLimits++;
        }
    }
    
    if (removedRateLimits > 0) {
        console.log(`🧹 Cleared ${removedRateLimits} expired rate limits`);
    }
}, 60000);

setInterval(() => {
    const now = Date.now();
    let removed = 0;
    
    for (const [userId, user] of connectedUsers.entries()) {
        if (now - user.lastActivity > 120000) {
            connectedUsers.delete(userId);
            removed++;
        }
    }
    
    if (removed > 0) {
        console.log(`🧹 Removed ${removed} inactive users. Active: ${getRealUserCount()}`);
    }
}, 120000);

function getDetailedUserStats() {
    const now = Date.now();
    let activeCount = 0;
    let veryActiveCount = 0;
    const uniqueIPs = new Set();
    let totalRequests = 0;
    
    for (const [userId, user] of connectedUsers.entries()) {
        if (now - user.lastActivity <= 120000) {
            activeCount++;
            uniqueIPs.add(user.ip);
            totalRequests += user.requestCount;
            
            if (now - user.lastActivity <= 30000) {
                veryActiveCount++;
            }
        }
    }
    
    return {
        totalActive: activeCount,
        veryActive: veryActiveCount,
        uniqueIPs: uniqueIPs.size,
        totalTracked: connectedUsers.size,
        totalRequests: totalRequests,
        lastUpdated: now
    };
}

function getRealUserCount() {
    const now = Date.now();
    let activeCount = 0;
    
    for (const [userId, user] of connectedUsers.entries()) {
        if (now - user.lastActivity <= 120000) {
            activeCount++;
        }
    }
    
    return Math.max(1, activeCount); 
}

app.get('/total', (req, res) => {
  try {
    const data = Array.from(total.values()).map((link, index) => ({
      session: index + 1,
      url: link.url,
      count: link.count,
      id: link.id,
      target: link.target,
      status: link.status || 'running',
      startTime: link.startTime || new Date().toISOString(),
      progress: Math.round((link.count / link.target) * 100)
    }));
    
    res.json({
      success: true,
      data: data,
      total: data.length,
      active: data.filter(s => s.status === 'running').length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/progress/:id', (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = total.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    const percent = Math.round((session.count / session.target) * 100);
    const timeLeft = Math.max(0, session.target - session.count);
    
    res.json({
      success: true,
      sessionId: sessionId,
      current: session.count,
      target: session.target,
      percent: percent,
      timeLeft: timeLeft,
      status: session.status || 'running',
      url: session.url,
      message: percent >= 100 ? 'Completed!' : 'Running...'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/stop/:id', (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = total.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    if (session.timer) {
      clearInterval(session.timer);
      console.log(`Stopped timer for session ${sessionId}`);
    }
    
    session.status = 'stopped';
    session.endTime = new Date().toISOString();
    total.set(sessionId, session);
    
    res.json({ 
      success: true,
      status: 200, 
      message: 'Session stopped successfully',
      sessionId: sessionId
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/users', (req, res) => {
  try {
    const stats = getDetailedUserStats(); 
    const activeSessions = Array.from(total.values())
      .filter(s => s.status === 'running');
    
    res.json({ 
      success: true,
      count: stats.totalActive, 
      activeSessions: activeSessions.length,
      realUsers: stats.totalActive,
      veryActiveUsers: stats.veryActive, 
      uniqueIPs: stats.uniqueIPs, 
      totalConnections: stats.totalTracked,
      totalRequests: stats.totalRequests, 
      updatedAt: new Date().toISOString(),
      stats: { 
        activeUsers: stats.totalActive,
        veryActive: stats.veryActive,
        uniqueIPs: stats.uniqueIPs,
        totalTracked: stats.totalTracked
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/users/detailed', (req, res) => {
  try {
    const now = Date.now();
    const activeUsers = [];
    const inactiveUsers = [];
    
    for (const [userId, user] of connectedUsers.entries()) {
        const userData = {
            id: userId.substring(0, 20) + '...',
            ip: user.ip,
            userAgent: user.userAgent.substring(0, 50),
            lastActivity: new Date(user.lastActivity).toLocaleTimeString(),
            firstSeen: new Date(user.firstSeen).toLocaleTimeString(),
            requestCount: user.requestCount,
            isActive: now - user.lastActivity <= 120000,
            lastSeenSeconds: Math.floor((now - user.lastActivity) / 1000)
        };
        
        if (userData.isActive) {
            activeUsers.push(userData);
        } else {
            inactiveUsers.push(userData);
        }
    }
    
    activeUsers.sort((a, b) => b.lastSeenSeconds - a.lastSeenSeconds);
    inactiveUsers.sort((a, b) => b.lastSeenSeconds - a.lastSeenSeconds);
    
    res.json({
        success: true,
        activeUsers: activeUsers,
        inactiveUsers: inactiveUsers,
        totalActive: activeUsers.length,
        totalInactive: inactiveUsers.length,
        totalTracked: connectedUsers.size,
        updatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/clear', (req, res) => {
  try {
    total.clear();
    currentSessionId = 1;
    
    res.json({ 
      success: true,
      message: 'All sessions cleared successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/activity', (req, res) => {
  const { userId } = req.body;
  
  if (userId && connectedUsers.has(userId)) {
    const user = connectedUsers.get(userId);
    user.lastActivity = Date.now();
    connectedUsers.set(userId, user);
  }
  
  res.json({ 
    success: true, 
    activeUsers: getRealUserCount(),
    stats: getDetailedUserStats() 
  });
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  
  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({
      success: false,
      error: 'Missing cookie, url, amount, or interval'
    });
  }
  
  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cookies format'
      });
    }

    const sessionId = currentSessionId++;


    share(cookies, url, amount, interval, sessionId)
      .then(() => {
        console.log(`✅ Session ${sessionId} completed`);
      })
      .catch(err => {
        console.error(`❌ Session ${sessionId} error:`, err.message);
      });
    
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Sharing process started successfully!',
      sessionId: sessionId,
      data: {
        url: url,
        target: amount,
        interval: interval
      }
    });
    
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

async function share(cookies, url, amount, interval, sessionId) {
  try {
    console.log(`🚀 Starting session ${sessionId}: ${url}`);
    
    const id = await getPostID(url);
    const accessToken = await getAccessToken(cookies);
    
    if (!id) {
      throw new Error("Invalid URL: Cannot get post ID");
    }
    
    if (!accessToken) {
      throw new Error("Invalid cookies: Cannot get access token");
    }
    
    total.set(sessionId, {
      url,
      id,
      count: 0,
      target: amount,
      status: 'running',
      startTime: new Date().toISOString(),
      timer: null,
      lastUpdate: new Date().toISOString()
    });
    
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate',
      'connection': 'keep-alive',
      'content-length': '0',
      'cookie': cookies,
      'host': 'graph.facebook.com'
    };
    
    let sharedCount = 0;
    let timer;
    
    async function sharePost() {
      try {
        console.log(`🔄 Session ${sessionId}: Attempting share ${sharedCount + 1}/${amount}`);
        
        const response = await axios.post(
          `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
          {},
          { 
            headers,
            timeout: 10000
          }
        );
        
        if (response.status === 200) {
          const currentSession = total.get(sessionId);
          currentSession.count++;
          currentSession.lastUpdate = new Date().toISOString();
          total.set(sessionId, currentSession);
          sharedCount++;
          
          console.log(`✅ Session ${sessionId}: Successfully shared ${sharedCount}/${amount}`);
          
          if (sharedCount >= amount) {
            console.log(`🎉 Session ${sessionId}: Target reached!`);
            clearInterval(timer);
            currentSession.status = 'completed';
            currentSession.endTime = new Date().toISOString();
            total.set(sessionId, currentSession);
          }
        } else {
          console.warn(`⚠️ Session ${sessionId}: Non-200 response: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Session ${sessionId}: Share error:`, error.message);
        
        if (error.response?.status === 400 || error.response?.status === 403) {
          clearInterval(timer);
          const currentSession = total.get(sessionId);
          currentSession.status = 'failed';
          currentSession.error = error.message;
          currentSession.endTime = new Date().toISOString();
          total.set(sessionId, currentSession);
        }
      }
    }

    timer = setInterval(sharePost, interval * 1000);
    
    const currentSession = total.get(sessionId);
    currentSession.timer = timer;
    total.set(sessionId, currentSession);
    
    const safetyTimeout = setTimeout(() => {
      if (timer) {
        clearInterval(timer);
      }
      const currentSession = total.get(sessionId);
      if (currentSession && currentSession.status === 'running') {
        console.log(`⏰ Session ${sessionId}: Safety timeout reached`);
        currentSession.status = 'timeout';
        currentSession.endTime = new Date().toISOString();
        total.set(sessionId, currentSession);
      }
      clearTimeout(safetyTimeout);
    }, amount * interval * 1000 + 30000); 
    
  } catch (error) {
    console.error(`💥 Session ${sessionId} setup error:`, error.message);
    
    const currentSession = total.get(sessionId);
    if (currentSession) {
      currentSession.status = 'failed';
      currentSession.error = error.message;
      currentSession.endTime = new Date().toISOString();
      total.set(sessionId, currentSession);
    }
  }
}

async function getPostID(url) {
  try {
    console.log(`🔍 Getting Post ID for: ${url}`);
    
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000
      }
    );
    
    if (response.data && response.data.id) {
      console.log(`✅ Got Post ID: ${response.data.id}`);
      return response.data.id;
    }
    
    console.warn('⚠️ No Post ID found in response');
    return null;
  } catch (error) {
    console.error('❌ Error getting Post ID:', error.message);
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    console.log('🔑 Getting Access Token...');
    
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'max-age=0',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
      'sec-ch-ua': '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
    };
    
    const response = await axios.get(
      'https://business.facebook.com/content_management', 
      { 
        headers,
        timeout: 15000 
      }
    );
    
    const tokenMatch = response.data.match(/"accessToken":\s*"([^"]+)"/);
    
    if (tokenMatch && tokenMatch[1]) {
      console.log('✅ Got Access Token');
      return tokenMatch[1];
    }
    
    console.warn('⚠️ Access Token not found in response');
    return null;
  } catch (error) {
    console.error('❌ Error getting Access Token:', error.message);
    return null;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🍪 Processing cookies...');
      
      const cookies = JSON.parse(cookie);
      
      if (!Array.isArray(cookies)) {
        reject("Invalid cookie format: Expected array");
        return;
      }
      
      const sbCookie = cookies.find(c => c.key === "sb");
      
      if (!sbCookie || !sbCookie.value) {
        reject("Invalid cookies: 'sb' cookie not found");
        return;
      }
      
      const sbValue = sbCookie.value;
      const cookieString = `sb=${sbValue}; ${cookies
        .filter(c => c.key !== "sb")
        .map(c => `${c.key}=${c.value}`)
        .join('; ')}`;
      
      console.log('✅ Cookies processed successfully');
      resolve(cookieString);
      
    } catch (error) {
      console.error('❌ Cookie processing error:', error.message);
      reject("Error processing cookies. Please check the format.");
    }
  });
}

app.get('/health', (req, res) => {
  const stats = getDetailedUserStats(); 
  
  res.json({
    success: true,
    status: 'running',
    timestamp: new Date().toISOString(),
    sessions: total.size,
    activeUsers: stats.totalActive, 
    veryActiveUsers: stats.veryActive, 
    uniqueIPs: stats.uniqueIPs, 
    totalRequests: stats.totalRequests, 
    memory: process.memoryUsage(),
    userStats: stats 
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.use((err, req, res, next) => {
  console.error('🚨 Server Error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🌐 Access: http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`👥 Users endpoint: http://localhost:${PORT}/users`);
  console.log(`👤 Detailed users: http://localhost:${PORT}/users/detailed`); 
  console.log(`📋 History endpoint: http://localhost:${PORT}/total`);
  console.log('\n⚡ Ready to share!');
  console.log(`📈 Real active users tracking: ENABLED`);
  console.log(`🛡️ Rate limiting: ENABLED (${MAX_REQUESTS_PER_MINUTE} requests/minute)`);
});
