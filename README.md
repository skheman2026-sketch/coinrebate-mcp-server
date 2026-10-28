# @coinrebate/mcp-server

> **A crypto MCP server built on exchange referral relationships — not just market data.**

Give your AI agents instant access to **trading fee discounts for new accounts (the rate varies by exchange; each exchange's rules decide eligibility)** on Binance, OKX, Bybit, Bitget, Gate.io, Hyperliquid, and Aster DEX. Zero infrastructure, zero exchange negotiations.

[![npm](https://img.shields.io/npm/v/@coinrebate/mcp-server)](https://www.npmjs.com/package/@coinrebate/mcp-server)
[![License](https://img.shields.io/npm/l/@coinrebate/mcp-server)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io/)

## Why this exists

Other crypto MCP servers (CCXT, Binance, exchange-specific) give you **read-only market data**.

CoinRebate gives your AI agent something different: **each covered exchange's published fees, the cost after the referral discount, and the referral code and signup link** — backed by affiliate agreements with each exchange (the tools return the current code at runtime, so nothing goes stale). The discount applies only to a new account registered through the link, under that exchange's own eligibility rules. CoinRebate may receive a commission from the exchanges it covers.

We set up the referral relationships with the exchanges. You build the AI agent. Your users see what the discount is worth before they decide.

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

## 11 Available Tools (v2.5.1)

| Tool | What it does |
|------|--------------|
| `get_exchange_fees` | Benchmark spot + futures fees from CoinRebate's published fee table (with the date each entry was last updated), plus the fees after the referral discount |
| `compare_fees` | Rank exchanges by lowest effective fee for spot/futures (with country compliance filter) |
| `get_exchange_referral` | Look up the referral code, fee discount and signup link CoinRebate lists for one exchange |
| `get_latest_news` | CoinRebate's latest English-language articles, each with its publication date (use as content source for your agent) |
| `calculate_trading_cost` | Estimate the taker-fee cost of a trading volume with and without the referral discount (yearly figure assumes the volume is monthly) |
| `get_compliant_exchanges` | Country-filtered exchange list (essential for regulatory compliance — built-in GeoIP) |
| `list_tradfi_perps` | List Binance US, HK, KR, and CN stock plus commodity perpetuals from official exchangeInfo data |
| `get_perp_stats` | Read daily, weekly, 30-day, and historical weekly-rank statistics from official Binance klines |
| `check_referral_link` | Checks whether a URL carries CoinRebate's own current referral code (allowlisted exchange hosts only). This is a self-check for CoinRebate links: a link carrying someone else's code is reported as stale_code even though it may be perfectly valid. For a neutral inspection of any exchange link, use inspect_exchange_link. |
| `search_guides` | Searches CoinRebate's published guides by keyword (any language) and returns matching articles with title, one-line description and URL. Read-only; results are informational articles, not referral links. |
| `inspect_exchange_link` | Inspects an exchange sign-up or referral link and reports evidence on five separate points: whether the domain is a verified official domain of a listed exchange, whether it is reachable, whose referral code it carries, how CoinRebate's records list the exchange for a given country, and what rebate (if any) is configured. Unknown items are reported as unknown. It never says a link is safe, never probes unrecognized domains, and never suggests a replacement link. Read-only. |


> **Also available on the hosted endpoint:** `recommend_fee_option` — instead of a table it returns
> a single verdict ("the lowest effective fee for a user in <country> is X"), together with the
> assumptions behind it and what is deliberately not modelled, and abstains when the upstream data
> is unreliable or the top venues are genuinely tied. It is currently exposed only through the remote
> MCP endpoint `https://coinrebate.vip/api/mcp`, which needs no install. It will land in this npm
> package in a later release.

The hosted endpoint exposes all twelve tools. The npm package exposes the eleven tools in the table.

## Bundled Agent Skill

The package includes `skills/coinrebate-fees/SKILL.md` with concise connection, tool-selection,
data-basis, and safety instructions for compatible agent runtimes.

## Compliance — Built In

Every tool that returns exchange recommendations supports an optional `country` parameter (ISO 3166-1 alpha-2). When provided, results are filtered against the CoinRebate compliance matrix.

Example: A user from China asking your agent "where should I trade?" — pass `country: "CN"` to ensure the agent doesn't recommend exchanges that block Chinese users. We programmatically enforce this on `/api/track` redirects too (returns 451 for blocked combinations).

## Real Data Only

This MCP server reads CoinRebate's public REST API (`https://www.coinrebate.vip`, OpenAPI v4.1) at call time. Fee, rebate and compliance data come from `data/exchanges/*.json`: fees are the benchmark rates in CoinRebate's published fee table, each with the date its entry was last updated. The `data_source` / `fetched_at` fields describe an automated CCXT refresh check, not a verification date. **No hardcoded marketing inflation.** This is a 2026-launched platform in growth phase, and we're upfront about that.

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
