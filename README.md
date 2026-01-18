# FB Share Pro 🚀

**Professional Facebook Sharing Tool with Real User Tracking**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Active Users](https://img.shields.io/badge/Active%20Users-Real%20Tracking-brightgreen.svg)]()
[![Multi User](https://img.shields.io/badge/Multi%20User-Supported-success.svg)]()

## ✨ Features

### 🎯 Core Features
- **Automated Facebook Sharing** - Share posts automatically with custom intervals
- **No Limit Sharing** - Share unlimited posts with any target amount
- **Real-time Progress Monitoring** - Live progress tracking with beautiful UI
- **Session Management** - Start, stop, and monitor multiple sharing sessions
- **Complete History** - Track all past sharing sessions with detailed statistics

### 👥 Advanced User Tracking
- **Real Active Users** - Track actual active users (not dummy counters)
- **IP-based Identification** - Unique user identification by IP + User Agent
- **Activity Heartbeat** - Automatic user activity tracking every 30 seconds
- **Rate Limiting** - Prevent abuse with 100 requests/minute per IP limit
- **Detailed User Analytics** - View active, very active, and unique user counts

### 📊 User Statistics Dashboard
- **Live User Count** - Real-time display of active users
- **Very Active Users** - Users active in last 30 seconds
- **Unique IP Tracking** - Count distinct user IP addresses
- **Request Statistics** - Total requests made by all users
- **Detailed User List** - View all users with IP, user agent, and status

### 🛡️ Security Features
- **Rate Limiting Protection** - Prevent DDoS and spam attacks
- **Cookie Validation** - Secure cookie format validation
- **Session Isolation** - Each user session runs independently
- **Auto Cleanup** - Automatic removal of inactive users (2 minutes)
- **Safety Timeouts** - Automatic session timeouts for long-running processes

## 🚀 Quick Start

### Prerequisites
- Node.js 18 or higher
- NPM or Yarn
- Facebook account with valid cookies

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/fb-share-pro.git
cd fb-share-pro
```

2. **Install dependencies**
```bash
npm install
```

3. **Start the server**
```bash
npm start
```

4. **Access the application**
```
Open your browser and navigate to: http://localhost:5000
```

## 📖 User Guide

### Step 1: Get Facebook Cookies
1. Download Kiwi Browser from [here](https://kiwi-browser.en.uptodown.com/android/download)
2. Open the browser and login to Facebook
3. Install "C3C FBSTATE" extension
4. Click the extension and copy your appstate/cookies

### Step 2: Start Sharing
1. Paste cookies in JSON format
2. Enter Facebook post URL
3. Set target shares (no limit)
4. Set interval (1 second recommended)
5. Click "Start Sharing Process"

### Step 3: Monitor Progress
- View live progress bar
- Check current shares count
- See time remaining
- Monitor multiple sessions simultaneously

## 🏗️ Project Structure

```
fb-share-pro/
├── server.js              # Main backend server
├── public/               # Frontend files
│   └── index.html        # Main application
├── package.json          # Dependencies
└── README.md            # This file
```

## 🔧 Backend API Endpoints

### Core Endpoints
- `POST /api/submit` - Start new sharing session
- `GET /progress/:id` - Get session progress
- `POST /stop/:id` - Stop a session
- `GET /total` - Get all sessions history
- `DELETE /clear` - Clear all sessions

### User Tracking Endpoints
- `GET /users` - Get active user count and statistics
- `GET /users/detailed` - Get detailed user list
- `POST /api/activity` - Send user activity heartbeat
- `GET /health` - Server health check

## 🎨 Frontend Features

### Responsive Design
- Mobile-first responsive design
- Beautiful gradient UI
- Smooth animations and transitions
- Dark/Light theme ready

### Real-time Updates
- Live progress updates every second
- User count updates every 10 seconds
- Automatic session monitoring
- Toast notifications for important events

### User Interface Sections
1. **Dashboard** - Main sharing form
2. **Live Progress** - Real-time progress monitoring
3. **History** - Past sharing sessions
4. **Guide** - Step-by-step instructions
5. **Multi Users** - User statistics and management
6. **User Statistics** - Detailed analytics dashboard

## 🔒 Security Implementation

### Rate Limiting
- 100 requests per minute per IP
- Automatic cleanup of old rate limit data
- 429 Too Many Requests response

### User Validation
- IP address validation and parsing
- User agent tracking
- Activity timestamp validation
- Automatic cleanup of inactive users

### Session Security
- Independent session timers
- Safety timeouts for long processes
- Error handling and recovery
- Automatic cleanup on completion

## 📈 Performance Features

### Efficient Tracking
- Minimal memory usage for user tracking
- Efficient Map data structures
- Regular cleanup of inactive data
- Optimized polling intervals

### Scalability
- Supports unlimited concurrent users
- Multiple simultaneous sharing sessions
- Efficient request handling
- Horizontal scaling ready

## 🚦 Rate Limiting Details

```javascript
// Configuration
MAX_REQUESTS_PER_MINUTE = 100
RATE_LIMIT_WINDOW = 60000 // 1 minute
INACTIVE_USER_TIMEOUT = 120000 // 2 minutes

// User is considered active if:
// lastActivity <= 120000ms (2 minutes)

// User is considered very active if:
// lastActivity <= 30000ms (30 seconds)
```

## 🛠️ Development

### Environment Variables
```bash
PORT=5000                   # Server port
NODE_ENV=production        # Environment
```

### Running in Development
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

## 📊 User Statistics Data Model

```javascript
{
  activeUsers: Number,      // Users active in last 2 minutes
  veryActiveUsers: Number,  // Users active in last 30 seconds
  uniqueIPs: Number,        // Distinct IP addresses
  totalConnections: Number, // Total connections tracked
  totalRequests: Number,    // Total requests made
  activeSessions: Number,   // Active sharing sessions
  updatedAt: ISOString      // Last update timestamp
}
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## ⚠️ Important Notes

### Legal Disclaimer
⚠️ **This tool is for educational purposes only.** Use at your own risk. The developers are not responsible for any account restrictions or bans resulting from the use of this tool.

### Best Practices
1. Use reasonable sharing intervals (≥1 second)
2. Monitor your sessions regularly
3. Keep your cookies secure
4. Don't share your cookies with others
5. Respect Facebook's terms of service

### Limitations
- Requires valid Facebook cookies
- Post must be publicly accessible or visible to your account
- Rate limiting by Facebook may occur with excessive sharing
- Dependent on Facebook's API stability

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Facebook Graph API for sharing functionality
- Kiwi Browser for cookie extraction
- All contributors and testers
- Open source community for inspiration

## 🆘 Support

For issues, questions, or suggestions:
1. Check the [Guide section](http://localhost:5000/#guide) in the app
2. Open an issue on GitHub
3. Review existing issues for solutions

## 📱 Compatibility

- **Browsers**: Chrome, Firefox, Safari, Edge (latest versions)
- **Mobile**: Responsive design works on all mobile devices
- **OS**: Windows, macOS, Linux, Android, iOS
- **Node.js**: Version 18 or higher required

---

**Made with ❤️ by ARI**

⭐ **Star this repo if you found it useful!** ⭐
