const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeProcesses = new Map(); 
const processHistory = [];         

app.get('/total', (req, res) => {
  const data = Array.from(activeProcesses.values()).map((process, index) => ({
    session: index + 1,
    url: process.url,
    count: process.count,
    id: process.id,
    target: process.target,
    status: 'active',
    interval: process.interval || 1
  }));
  res.json(data);
});

app.get('/history', (req, res) => {
  res.json(processHistory);
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  
  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let parsedCookie;
    try {
      parsedCookie = JSON.parse(cookie);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in cookie' });
    }

    const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const processData = {
      id: processId,
      url: url,
      target: parseInt(amount),
      interval: parseInt(interval),
      count: 0,
      status: 'active',
      startTime: new Date().toISOString(),
      timer: null,
      isRunning: true
    };

    activeProcesses.set(processId, processData);

    res.status(200).json({
      status: 200,
      message: 'Boost process started successfully',
      processId: processId,
      session: activeProcesses.size
    });

    startSharingProcess(processId, parsedCookie, url, parseInt(amount), parseInt(interval));
    
  } catch (err) {
    console.error('Error starting process:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.post('/api/stop/:id', (req, res) => {
  const processId = req.params.id;
  const process = activeProcesses.get(processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
 
  if (process.timer) {
    clearInterval(process.timer);
  }
  
  process.status = 'stopped';
  process.endTime = new Date().toISOString();
  processHistory.unshift(process);

  activeProcesses.delete(processId);
  
  res.json({ status: 200, message: 'Process stopped successfully' });
});

async function startSharingProcess(processId, cookie, url, amount, interval) {
  try {
    const cookieString = convertCookieToString(cookie);
    if (!cookieString) {
      throw new Error('Invalid cookie format');
    }
    
    const postId = await getPostID(url);
    if (!postId) {
      throw new Error('Cannot get post ID. URL may be invalid or private.');
    }
    
    const accessToken = await getAccessToken(cookieString);
    if (!accessToken) {
      throw new Error('Cannot get access token. Cookie may be expired.');
    }
    
    const process = activeProcesses.get(processId);
    if (!process) return;
    
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate',
      'connection': 'keep-alive',
      'cookie': cookieString,
      'host': 'graph.facebook.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    let sharedCount = 0;
    let errors = 0;
    const maxErrors = 10;

    const timer = setInterval(async () => {
      if (!process.isRunning || sharedCount >= amount) {
        clearInterval(timer);
        completeProcess(processId, sharedCount, 'completed');
        return;
      }
      
      try {
        const response = await axios.post(
          `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${postId}&published=0&access_token=${accessToken}`,
          {},
          { 
            headers,
            timeout: 10000 
          }
        );
        
        if (response.status === 200) {
          sharedCount++;
          errors = 0; 
    
          if (process) {
            process.count = sharedCount;
            process.lastUpdate = new Date().toISOString();
          }

          if (sharedCount % 10 === 0) {
            console.log(`Process ${processId}: ${sharedCount}/${amount} shares completed`);
          }

          if (sharedCount >= amount) {
            clearInterval(timer);
            completeProcess(processId, sharedCount, 'completed');
          }
        }
      } catch (error) {
        errors++;
        console.log(`Process ${processId}: Share attempt ${sharedCount + 1} failed (Error ${errors}/${maxErrors})`);
  
        if (errors >= maxErrors) {
          console.error(`Process ${processId}: Too many errors, stopping process`);
          clearInterval(timer);
          completeProcess(processId, sharedCount, 'failed');
        }
      }
    }, interval * 1000);

    process.timer = timer;
    process.isRunning = true;

    const timeoutDuration = (amount * interval * 1000) + 30000; // +30 seconds buffer
    setTimeout(() => {
      if (process.isRunning) {
        clearInterval(timer);
        completeProcess(processId, sharedCount, 'timeout');
      }
    }, timeoutDuration);
    
  } catch (error) {
    console.error(`Process ${processId} failed to start:`, error.message);
    completeProcess(processId, 0, 'failed');
  }
}

function completeProcess(processId, count, status) {
  const process = activeProcesses.get(processId);
  if (process) {
    process.status = status;
    process.count = count;
    process.endTime = new Date().toISOString();
    process.isRunning = false;

    processHistory.unshift({...process});

    activeProcesses.delete(processId);
    
    console.log(`Process ${processId} ${status} with ${count} shares`);
  }
}

function convertCookieToString(cookieArray) {
  try {
    if (!Array.isArray(cookieArray)) return null;

    const sbCookie = cookieArray.find(c => c.key === "sb");
    if (!sbCookie) return null;

    return cookieArray
      .map(c => `${c.key}=${c.value}`)
      .join('; ');
  } catch (error) {
    return null;
  }
}

async function getPostID(url) {
  try {
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    );
    return response.data.id;
  } catch (error) {
    console.error('Error getting post ID:', error.message);
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'cookie': cookie,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1'
    };
    
    const response = await axios.get('https://business.facebook.com/content_management', {
      headers,
      timeout: 15000
    });

    const tokenMatch = response.data.match(/"accessToken":\s*"([^"]+)"/);
    if (tokenMatch && tokenMatch[1]) {
      return tokenMatch[1];
    }
    
    return null;
  } catch (error) {
    console.error('Error getting access token:', error.message);
    return null;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║     ShareBoost Server Started!       ║
  ║                                      ║
  ║  📡 Port: ${PORT}                         ║
  ║  🌐 URL: http://localhost:${PORT}        ║
  ║  🕐 Time: ${new Date().toLocaleTimeString()}            ║
  ║                                      ║
  ║  Concurrent processes: SUPPORTED     ║
  ║  Multiple users: SUPPORTED           ║
  ╚══════════════════════════════════════╝
  `);
});
