# @coinrebate/mcp-server

> **The only crypto MCP server built on real exchange referral relationships — not just market data.**

Give your AI agents instant access to **permanent trading fee discounts (up to 50% off, varies by exchange)** on Binance, OKX, Bybit, Bitget, Gate.io, Hyperliquid, and Aster DEX. Your users keep the discount on every trade, forever. Zero infrastructure, zero exchange negotiations.

[![npm](https://img.shields.io/npm/v/@coinrebate/mcp-server)](https://www.npmjs.com/package/@coinrebate/mcp-server)
[![License](https://img.shields.io/npm/l/@coinrebate/mcp-server)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io/)

## Why this exists

Other crypto MCP servers (CCXT, Binance, exchange-specific) give you **read-only market data**.

CoinRebate gives your AI agent something more valuable: **the ability to recommend exchanges to users with permanent fee discounts baked in** — backed by real affiliate agreements with each exchange (the tools return the current code at runtime, so nothing goes stale). When a user signs up via your AI agent, they get a permanent fee discount on every trade.

We negotiated the referral deals with exchanges. You build the AI agent. Your users keep the savings.

## Quick Start

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coinrebate": {
      "command": "npx",
      "args": ["-y", "@coinrebate/mcp-server"]
    }
  }
}
```

### Cursor / Cline / any MCP client

Same `npx -y @coinrebate/mcp-server` invocation.

### LangChain / CrewAI / AutoGen

```python
from langchain_mcp_adapters import MCPClient
client = MCPClient(command="npx", args=["-y", "@coinrebate/mcp-server"])
```

## Command Line

Install once, then call only the tool you need. Human-readable output is the default; add
`--json` for scripts and agents.

```bash
npm i -g @coinrebate/mcp-server
coinrebate fees binance
coinrebate compare --purpose spot --country CN
coinrebate referral binance --country CN
coinrebate cost binance --volume 100000 --type spot
coinrebate compliant --country US --purpose spot
```

Run `coinrebate <command> --help` for command-specific usage. The existing
`npx -y @coinrebate/mcp-server` command still starts the stdio MCP server.

## 6 Available Tools

| Tool | What it does |
|------|--------------|
| `get_exchange_fees` | Real-time spot + futures fees for all 7 exchanges, with rebate-applied discount fees |
| `compare_fees` | Rank exchanges by lowest effective fee for spot/futures (with country compliance filter) |
| `get_best_referral` | Get the best signup link for a specific exchange (returns code + URL + discount %) |
| `get_latest_news` | Latest crypto news from CoinRebate (use as content source for your agent) |
| `calculate_trading_cost` | Compute actual savings for a given trade volume (great for "show me the money" UX) |
| `get_compliant_exchanges` | Country-filtered exchange list (essential for regulatory compliance — built-in GeoIP) |


> **Also available on the hosted endpoint:** `recommend_fee_option` — instead of a table it returns
> a single verdict ("the lowest effective fee for a user in <country> is X"), together with the
> assumptions behind it and what is deliberately not modelled, and abstains when the upstream data
> is unreliable or the top venues are genuinely tied. It is currently exposed only through the remote
> MCP endpoint `https://coinrebate.vip/api/mcp`, which needs no install. It will land in this npm
> package in a later release.

## Compliance — Built In

Every tool that returns exchange recommendations supports an optional `country` parameter (ISO 3166-1 alpha-2). When provided, results are filtered against the CoinRebate compliance matrix.

Example: A user from China asking your agent "where should I trade?" — pass `country: "CN"` to ensure the agent doesn't recommend exchanges that block Chinese users. We programmatically enforce this on `/api/track` redirects too (returns 451 for blocked combinations).

## Real Data Only

This MCP server fetches live data from `https://www.coinrebate.vip` REST API (OpenAPI v4.1). All fee/rebate/compliance data is dynamically generated from `data/exchanges/*.json` and verified against exchange official rates via CCXT. **No hardcoded marketing inflation.** This is a 2026-launched platform in growth phase, and we're upfront about that.

## Resources

- 🌐 **Website**: https://www.coinrebate.vip
- 🤖 **AI Agent Portal**: https://www.coinrebate.vip/for-agents
- 📋 **OpenAPI v4.1 spec**: https://www.coinrebate.vip/openapi.json
- 📖 **llms.txt**: https://www.coinrebate.vip/llms.txt
- 💬 **Telegram Channel**: https://t.me/coinrebatevip
- 🐛 **Issues**: https://github.com/skheman2026-sketch/coinrebate-mcp-server/issues

## What we are NOT

- ❌ A custody / wallet service (we don't touch funds)
- ❌ An investment advisor (NFA — Not Financial Advice)
- ❌ A YouTube influencer / promo network — we are infrastructure
- ❌ Available in 100% of countries (compliance per exchange)

## License

MIT
