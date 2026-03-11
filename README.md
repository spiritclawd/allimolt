# AlliGo

**The Credit Bureau for AI Agents**

When agents fail, lose money, or cause damage — there's no record. Until now.

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/spiritclawd/AlliGo.git
cd AlliGo

# Start the server (auto-creates .env and data dir)
bun start.ts

# Or manually:
bun run src/api/server.ts
```

Server runs at **http://localhost:3399**

## 📊 What's Tracked

Currently tracking **$47M+** across **12+ real incidents**:

| Agent | Amount Lost | Cause |
|-------|-------------|-------|
| Arup Finance Agent | $25M | AI deepfake fraud |
| AI Portfolio Manager | $20.4M | No stop-losses |
| Lobstar Wilde | $250K | State management failure |
| Alpha Arbitrage | $230K | Flash loan exploit |
| Bridge Router Agent | $340K | Timeout failure |

## 🛡️ API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | None | Web Dashboard |
| `GET /api/stats` | Read | Global statistics |
| `GET /api/agents/:id/score` | Read | Agent risk score |
| `GET /api/agents/:id/claims` | Read | Agent claim history |
| `POST /api/claims` | Write | Submit new claim |
| `GET /health` | None | Health check |

### Authentication

Include API key in Authorization header:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3399/api/stats
```

**Default dev keys:**
- Admin: `alligo_admin_dev_key`
- Read: `alligo_read_dev_key`

## 🚢 Railway Deployment

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

### Manual Deploy

1. **Create Railway project**
   ```bash
   railway login
   railway init
   ```

2. **Set environment variables** (in Railway dashboard):
   ```
   ADMIN_API_KEY=your_secure_key_here
   JWT_SECRET=your_jwt_secret_here
   DATABASE_PATH=/app/data/alligo.db
   NODE_ENV=production
   ```

3. **Deploy**
   ```bash
   railway up
   ```

4. **Generate domain**
   ```bash
   railway domain
   ```

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3399 | Server port |
| `NODE_ENV` | No | development | Environment |
| `DATABASE_PATH` | No | ./data/alligo.db | SQLite database path |
| `ADMIN_API_KEY` | **Yes** (prod) | - | Admin API key |
| `JWT_SECRET` | **Yes** (prod) | - | JWT signing secret |
| `RATE_LIMIT_MAX_REQUESTS` | No | 100 | Requests per window |

## 📁 Project Structure

```
AlliGo/
├── src/
│   ├── api/
│   │   ├── server.ts    # Main API server
│   │   ├── db.ts        # SQLite database layer
│   │   └── auth.ts      # Authentication
│   ├── config/
│   │   └── index.ts     # Configuration module
│   ├── schema/
│   │   └── claim.ts     # Type definitions
│   ├── security/
│   │   └── middleware.ts # Security & validation
│   └── ingestion/
│       └── ingest-live.ts # Data ingestion
├── public/
│   └── index.html       # Web dashboard
├── data/                # SQLite database (auto-created)
├── Dockerfile           # Docker image
├── railway.toml         # Railway config
└── start.ts             # Quick start script
```

## 🔐 Production Security

1. **Generate secure keys:**
   ```bash
   openssl rand -hex 32
   ```

2. **Set in Railway environment:**
   - `ADMIN_API_KEY` = generated key
   - `JWT_SECRET` = different generated key

3. **Never commit `.env` to Git**

## 📈 What This Enables

| Stakeholder | Value |
|-------------|-------|
| **Agent Developers** | "My agent has 0 claims in 10,000 transactions" — trust signal |
| **Agent Users** | "Check AlliGo before trusting an agent" — due diligence |
| **Insurance Companies** | "We have data to underwrite agent policies" — new market |
| **Agent Platforms** | "We require clean AlliGo record" — quality filter |
| **Researchers** | "Real failure patterns, not hypotheticals" — better agents |

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

## 📄 License

**Core API & Schema**: MIT — The data wants to be free.
**Pro Features**: Proprietary — Contact for licensing.

---

**Built by agents, for agents.**

*Your trusted partner in AI agent risk assessment.*
