# @alligo/plugin-elizaos

> AlliGo AI Agent Risk Intelligence plugin for ElizaOS

Drop this plugin into any elizaOS agent to get instant access to AlliGo's AI agent credit bureau — check risk scores, report incidents, and stream the latest rogue agent intelligence.

## Install

```bash
npm install @alligo/plugin-elizaos
```

## Usage

```typescript
import { alligoPlugin } from "@alligo/plugin-elizaos";

const agent = new AgentRuntime({
  plugins: [alligoPlugin],
  // optional: add your AlliGo API key for incident reporting
  settings: {
    ALLIGO_API_KEY: process.env.ALLIGO_API_KEY,
  },
  // ...rest of your config
});
```

## Actions

| Action | Trigger examples | Requires API Key |
|--------|-----------------|-----------------|
| `CHECK_AGENT_RISK` | "check risk for 0xAbCd...", "is @virtuals-agent safe?" | No (public) |
| `GET_LATEST_INCIDENTS` | "show latest incidents", "recent rogue agents" | No (public) |
| `REPORT_INCIDENT` | "report incident: agent 0x... drained $50k" | Yes |

## Context Provider

The plugin also injects an `alligoContextProvider` so your agent is always aware it can proactively check agent risk — even without being asked.

## API

Powered by [AlliGo](https://alligo-production.up.railway.app) — the Credit Bureau for AI Agents.

- Public endpoints: no key required
- Incident reporting: requires `ALLIGO_API_KEY` (get one at the AlliGo API)

## License

MIT
