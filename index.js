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
const history = new Map(); 

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
    next();
});

app.get('/total', (req, res) => {
    try {
        const data = Array.from(total.values()).map((link, index) => ({
            session: index + 1,
            url: link.url,
            count: link.count,
            id: link.id || `process_${Date.now()}_${index}`,
            target: link.target,
            status: link.status || 'active',
            startTime: link.startTime || new Date().toISOString(),
            interval: link.interval || 1
        }));
        res.json(data);
    } catch (error) {
        console.error('Error in /total:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/history', (req, res) => {
    try {
        const historyData = Array.from(history.values()).map((item, index) => ({
            session: item.session || index + 1,
            url: item.url,
            count: item.count,
            id: item.id,
            target: item.target,
            status: item.status || 'completed',
            startTime: item.startTime,
            endTime: item.endTime,
            interval: item.interval || 1,
            duration: item.duration || 0
        })).sort((a, b) => new Date(b.endTime) - new Date(a.endTime)); 
        
        res.json(historyData);
    } catch (error) {
        console.error('Error in /history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/stats', (req, res) => {
    try {
        const activeProcesses = Array.from(total.values());
        const historyData = Array.from(history.values());
        
        const stats = {
            activeBoosts: activeProcesses.length,
            totalShares: activeProcesses.reduce((sum, p) => sum + (p.count || 0), 0) +
                         historyData.reduce((sum, h) => sum + (h.count || 0), 0),
            successfulShares: historyData
                .filter(h => h.status === 'completed')
                .reduce((sum, h) => sum + (h.count || 0), 0),
            failedShares: historyData
                .filter(h => h.status === 'stopped' || h.status === 'failed')
                .reduce((sum, h) => sum + (h.count || 0), 0),
            totalBoosts: activeProcesses.length + historyData.length,
            avgSpeed: '1.2s', 
            uptime: process.uptime()
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error in /stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/stop/:id', (req, res) => {
    try {
        const { id } = req.params;
        const process = total.get(id);
        
        if (!process) {
            return res.status(404).json({ error: 'Process not found' });
        }

        history.set(id, {
            ...process,
            status: 'stopped',
            endTime: new Date().toISOString(),
            duration: new Date() - new Date(process.startTime)
        });
        
        total.delete(id);

        if (process.timer) {
            clearInterval(process.timer);
        }
        
        res.json({ 
            status: 200, 
            message: 'Process stopped successfully',
            id: id 
        });
    } catch (error) {
        console.error('Error stopping process:', error);
        res.status(500).json({ error: 'Failed to stop process' });
    }
});

app.post('/api/stop-all', (req, res) => {
    try {
        const stoppedProcesses = [];
        
        total.forEach((process, id) => {
            history.set(id, {
                ...process,
                status: 'stopped',
                endTime: new Date().toISOString(),
                duration: new Date() - new Date(process.startTime)
            });

            if (process.timer) {
                clearInterval(process.timer);
            }
            
            stoppedProcesses.push({ id, url: process.url });
        });

        total.clear();
        
        res.json({ 
            status: 200, 
            message: `Stopped ${stoppedProcesses.length} processes`,
            stoppedProcesses: stoppedProcesses 
        });
    } catch (error) {
        console.error('Error stopping all processes:', error);
        res.status(500).json({ error: 'Failed to stop processes' });
    }
});

app.post('/api/clear-history', (req, res) => {
    try {
        const count = history.size;
        history.clear();
        
        res.json({ 
            status: 200, 
            message: `Cleared ${count} history items` 
        });
    } catch (error) {
        console.error('Error clearing history:', error);
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

app.post('/api/submit', async (req, res) => {
    const {
        cookie,
        url,
        amount,
        interval,
    } = req.body;

    if (!cookie || !url || !amount || !interval) {
        return res.status(400).json({
            error: 'Missing required fields: cookie, url, amount, or interval'
        });
    }

    if (amount <= 0) {
        return res.status(400).json({
            error: 'Amount must be greater than 0'
        });
    }

    if (interval < 1 || interval > 60) {
        return res.status(400).json({
            error: 'Interval must be between 1 and 60 seconds'
        });
    }

    try {
        const cookies = await convertCookie(cookie);
        if (!cookies) {
            return res.status(400).json({
                status: 400,
                error: 'Invalid cookies format'
            });
        }

        const processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        share(cookies, url, amount, interval, processId)
            .then(() => {
                console.log(`Process ${processId} completed`);
            })
            .catch(err => {
                console.error(`Process ${processId} failed:`, err.message);

                const failedProcess = total.get(processId);
                if (failedProcess) {
                    history.set(processId, {
                        ...failedProcess,
                        status: 'failed',
                        endTime: new Date().toISOString(),
                        duration: new Date() - new Date(failedProcess.startTime)
                    });
                    total.delete(processId);
                }
            });
      
        res.status(200).json({
            status: 200,
            message: 'Boost process started successfully',
            processId: processId,
            session: total.size + 1
        });

    } catch (err) {
        console.error('Error in /api/submit:', err.message);
        return res.status(500).json({
            status: 500,
            error: err.message || 'Internal server error'
        });
    }
});

async function share(cookies, url, amount, interval, processId) {
    try {
        const id = await getPostID(url);
        const accessToken = await getAccessToken(cookies);
        
        if (!id) {
            throw new Error("Unable to get post ID: Invalid URL, private post, or friends-only content");
        }

        if (!accessToken) {
            throw new Error("Unable to get access token: Invalid or expired cookies");
        }

        const processData = {
            url,
            id,
            count: 0,
            target: amount,
            interval: interval,
            status: 'active',
            startTime: new Date().toISOString(),
            sharedCount: 0,
            lastUpdate: new Date().toISOString()
        };

        total.set(processId, processData);

        const headers = {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate',
            'connection': 'keep-alive',
            'content-length': '0',
            'cookie': cookies,
            'host': 'graph.facebook.com',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        let sharedCount = 0;
        let timer;

        async function sharePost() {
            try {
                const response = await axios.post(
                    `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
                    {},
                    { headers, timeout: 10000 }
                );

                if (response.status === 200) {
                    sharedCount++;
                    total.set(processId, {
                        ...total.get(processId),
                        count: sharedCount,
                        lastUpdate: new Date().toISOString()
                    });

                    if (sharedCount >= amount) {
                        clearInterval(timer);

                        const completedProcess = total.get(processId);
                        if (completedProcess) {
                            history.set(processId, {
                                ...completedProcess,
                                status: 'completed',
                                endTime: new Date().toISOString(),
                                duration: new Date() - new Date(completedProcess.startTime)
                            });
                            total.delete(processId);
                        }
                        
                        console.log(`Process ${processId} completed successfully: ${sharedCount} shares`);
                    }
                }
            } catch (error) {
                console.log(`Share attempt ${sharedCount + 1} failed:`, error.message);

                sharedCount++;
                total.set(processId, {
                    ...total.get(processId),
                    count: sharedCount,
                    lastUpdate: new Date().toISOString()
                });

                if (error.response && error.response.status === 400) {
                    console.error(`Stopping process ${processId} due to 400 error`);
                    clearInterval(timer);
                    
                    const failedProcess = total.get(processId);
                    if (failedProcess) {
                        history.set(processId, {
                            ...failedProcess,
                            status: 'failed',
                            endTime: new Date().toISOString(),
                            duration: new Date() - new Date(failedProcess.startTime)
                        });
                        total.delete(processId);
                    }
                }
            }
        }

        timer = setInterval(sharePost, interval * 1000);

        const process = total.get(processId);
        process.timer = timer;
        total.set(processId, process);

        setTimeout(() => {
            if (timer) {
                clearInterval(timer);
                const timedOutProcess = total.get(processId);
                if (timedOutProcess) {
                    history.set(processId, {
                        ...timedOutProcess,
                        status: 'completed',
                        endTime: new Date().toISOString(),
                        duration: new Date() - new Date(timedOutProcess.startTime)
                    });
                    total.delete(processId);
                    console.log(`Process ${processId} completed via timeout`);
                }
            }
        }, amount * interval * 1000 + 10000);

    } catch (error) {
        console.error('Error in share function:', error.message);
        throw error;
    }
}

async function getPostID(url) {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.post(
                'https://id.traodoisub.com/api.php',
                `link=${encodeURIComponent(url)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                }
            );

            if (response.data && response.data.id) {
                return response.data.id;
            }
            
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        } catch (error) {
            console.log(`Attempt ${attempt} to get post ID failed:`, error.message);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    return null;
}

async function getAccessToken(cookie) {
    try {
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

        const response = await axios.get('https://business.facebook.com/content_management', {
            headers,
            timeout: 15000
        });

        const tokenPatterns = [
            /"accessToken":\s*"([^"]+)"/,
            /accessToken:\s*"([^"]+)"/,
            /access_token=([^&"]+)/,
            /EA[A-Za-z0-9_-]{100,}/
        ];

        for (const pattern of tokenPatterns) {
            const match = response.data.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        return null;
    } catch (error) {
        console.error('Error getting access token:', error.message);
        return null;
    }
}

async function convertCookie(cookie) {
    return new Promise((resolve, reject) => {
        try {
            let cookies;

            if (typeof cookie === 'string') {
                cookies = JSON.parse(cookie);
            } else if (Array.isArray(cookie)) {
                cookies = cookie;
            } else {
                reject("Invalid cookie format: must be JSON string or array");
                return;
            }

            const requiredCookies = ['sb', 'c_user', 'xs'];
            const missingCookies = requiredCookies.filter(key => 
                !cookies.some(c => c.key === key)
            );

            if (missingCookies.length > 0) {
                reject(`Missing required cookies: ${missingCookies.join(', ')}`);
                return;
            }
          
            const cookieString = cookies
                .map(c => `${c.key}=${c.value}`)
                .join('; ');

            resolve(cookieString);
        } catch (error) {
            if (error instanceof SyntaxError) {
                reject("Invalid JSON format in cookie");
            } else {
                reject(`Error processing cookie: ${error.message}`);
            }
        }
    });
}

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({
        status: 500,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════╗
    ║     ShareBoost Server Started!       ║
    ║                                      ║
    ║  📡 Port: ${PORT}                         ║
    ║  🌐 URL: http://localhost:${PORT}        ║
    ║  🕐 Time: ${new Date().toLocaleTimeString()}            ║
    ║                                      ║
    ║  Endpoints:                          ║
    ║  • GET  /total      - Active boosts  ║
    ║  • GET  /history    - History        ║
    ║  • GET  /stats      - Statistics     ║
    ║  • POST /api/submit - Start boost    ║
    ║  • POST /api/stop/:id - Stop boost   ║
    ╚══════════════════════════════════════╝
    `);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Export for testing
module.exports = app;
