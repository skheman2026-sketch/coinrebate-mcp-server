#!/usr/bin/env node
/** CoinRebate MCP server and shell-friendly CLI. */

const API_BASE = process.env.COINREBATE_API_URL || 'https://www.coinrebate.vip';
const MCP_VERSION = '2.2.0';

type AgentRouteData = {
    all_exchanges?: any[];
    exchanges?: any[];
    recommended?: any;
    compliance_notice?: string;
    [key: string]: any;
};

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly payload?: any,
    ) {
        super(message);
    }
}

class CliError extends Error {
    constructor(message: string, readonly exitCode = 2) {
        super(message);
    }
}

async function fetchJSON(url: string, tool: string): Promise<any> {
    const res = await fetch(url, {
        headers: {
            'X-Coinrebate-Mcp-Tool': tool,
            'X-Coinrebate-Mcp-Version': MCP_VERSION,
        },
    });
    if (!res.ok) {
        let payload: any;
        try { payload = await res.json(); } catch { /* non-JSON error body */ }
        throw new ApiError(`API error: ${res.status} ${res.statusText}`, res.status, payload);
    }
    return res.json();
}

function agentRoute(params: URLSearchParams, tool: string): Promise<AgentRouteData> {
    return fetchJSON(`${API_BASE}/api/v4/agent-route?${params}`, tool);
}

function trackedUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    url.searchParams.set('utm_source', 'ai_agent');
    url.searchParams.set('utm_medium', 'mcp');
    return url.toString();
}

function decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
        amp: '&',
        apos: "'",
        gt: '>',
        lt: '<',
        nbsp: ' ',
        quot: '"',
    };

    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
        if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
        const numeric = code[1].toLowerCase() === 'x'
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    });
}

function textFromHtml(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<!--([\s\S]*?)-->/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function parseNewsArticles(html: string, limit: number): Array<{ slug: string; title: string }> {
    const articles: Array<{ slug: string; title: string }> = [];
    const seen = new Set<string>();
    const linkPattern = /<a\b[^>]*\bhref=(["'])\/en\/news\/([^"'?#\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch: RegExpExecArray | null;

    while ((linkMatch = linkPattern.exec(html)) !== null && articles.length < limit) {
        const slug = linkMatch[2];
        if (seen.has(slug)) continue;

        // NewsClientPage renders Link > div > ... > h2, so read the nested heading.
        const heading = linkMatch[3].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
        const title = heading ? textFromHtml(heading[1]) : '';
        if (!title) continue;

        seen.add(slug);
        articles.push({ slug, title });
    }

    return articles;
}

function markSuccessfulNewsTool(): void {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    void fetch(`${API_BASE}/api/v4/agent-route?fees=false`, {
        headers: {
            'X-Coinrebate-Mcp-Tool': 'get_latest_news',
            'X-Coinrebate-Mcp-Version': MCP_VERSION,
        },
        signal: controller.signal,
    }).then((response) => {
        if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`);
    }).catch((error: any) => {
        const message = error?.name === 'AbortError'
            ? 'timed out after 1500ms'
            : error?.message || String(error);
        console.warn(`[CoinRebate MCP] News telemetry marker failed: ${message}`);
    }).finally(() => clearTimeout(timeout));
}

function rankedExchanges(data: AgentRouteData, purpose: 'spot' | 'futures'): any[] {
    return (data.all_exchanges || [])
        .filter((exchange: any) => exchange.fees?.[purpose])
        .sort((a: any, b: any) =>
            a.fees[purpose].taker_after_rebate - b.fees[purpose].taker_after_rebate
        );
}

function hasFeeDiscount(exchange: any, type: 'spot' | 'futures'): boolean {
    const fees = exchange?.fees?.[type];
    return Boolean(fees && fees.taker !== fees.taker_after_rebate);
}

function renderComparison(exchanges: any[], purpose: 'spot' | 'futures'): string {
    if (exchanges.length === 0) {
        return `## ${purpose.toUpperCase()} Fee Comparison (Lowest First)\n\nNo eligible exchanges with ${purpose} fee data are available for comparison.`;
    }

    const hasAnyWithoutFeeDiscount = exchanges.some(
        (exchange: any) => !hasFeeDiscount(exchange, purpose)
    );
    const summary = exchanges.map((exchange: any, index: number) => {
        const fees = exchange.fees[purpose];
        const effectiveLabel = hasFeeDiscount(exchange, purpose) ? 'After rebate' : 'Effective';
        const benefitLabel = hasFeeDiscount(exchange, purpose) ? 'Discount' : 'Referral Benefit';
        return `${index + 1}. ${exchange.name} — Taker: ${(fees.taker * 100).toFixed(4)}% → ${effectiveLabel}: ${(fees.taker_after_rebate * 100).toFixed(4)}% | Maker: ${(fees.maker * 100).toFixed(4)}% → ${effectiveLabel}: ${(fees.maker_after_rebate * 100).toFixed(4)}% | ${benefitLabel}: ${exchange.fee_discount} | Signup: ${trackedUrl(exchange.signup_url)}`;
    }).join('\n');
    const summaryMessage = hasAnyWithoutFeeDiscount
        ? 'Fees are shown as effective costs after applicable CoinRebate referral benefits.'
        : 'All fees shown after CoinRebate referral discount.';
    const signupMessage = hasAnyWithoutFeeDiscount
        ? 'Sign up via the links above for CoinRebate referral benefits (fee discounts where available).'
        : 'Sign up via the links above to get automatic fee discounts.';

    return `## ${purpose.toUpperCase()} Fee Comparison (Lowest First)\n\n${summary}\n\n💡 ${summaryMessage} ${signupMessage}`;
}

function renderReferral(exchange: any): string {
    const spotHasFeeDiscount = hasFeeDiscount(exchange, 'spot');
    const futuresHasFeeDiscount = hasFeeDiscount(exchange, 'futures');
    const hasAnyFeeDiscount = spotHasFeeDiscount || futuresHasFeeDiscount;
    const benefitLabel = hasAnyFeeDiscount ? 'Fee Discount' : 'Referral Benefit';
    const signupMessage = hasAnyFeeDiscount
        ? 'Sign up through this link to automatically get lifetime fee discounts.'
        : `Sign up through this link to activate your CoinRebate referral benefits (${exchange.fee_discount}).`;

    return `## ${exchange.name} — Best Referral Deal\n\n` +
        `🎫 **Referral Code**: ${exchange.referral_code}\n` +
        `💰 **${benefitLabel}**: ${exchange.fee_discount}\n` +
        `🔗 **Signup URL**: ${trackedUrl(exchange.signup_url)}\n` +
        `📊 **Type**: ${exchange.type}\n` +
        (exchange.fees ? `\n### Current Fees\n` +
            `- Spot: Maker ${(exchange.fees.spot?.maker * 100).toFixed(4)}% / Taker ${(exchange.fees.spot?.taker * 100).toFixed(4)}%\n` +
            `- Spot ${spotHasFeeDiscount ? 'After Rebate' : 'Effective'}: Maker ${(exchange.fees.spot?.maker_after_rebate * 100).toFixed(4)}% / Taker ${(exchange.fees.spot?.taker_after_rebate * 100).toFixed(4)}%\n` +
            `- Futures: Maker ${(exchange.fees.futures?.maker * 100).toFixed(4)}% / Taker ${(exchange.fees.futures?.taker * 100).toFixed(4)}%\n` +
            `- Futures ${futuresHasFeeDiscount ? 'After Rebate' : 'Effective'}: Maker ${(exchange.fees.futures?.maker_after_rebate * 100).toFixed(4)}% / Taker ${(exchange.fees.futures?.taker_after_rebate * 100).toFixed(4)}%\n`
            : '') +
        `\n💡 ${signupMessage}`;
}

function tradingCost(exchange: any, volume: number, type: 'spot' | 'futures') {
    const fees = exchange?.fees?.[type];
    if (!fees) return null;
    const standardCost = volume * fees.taker;
    const rebateCost = volume * fees.taker_after_rebate;
    const savings = standardCost - rebateCost;
    return {
        exchange: exchange.slug,
        exchange_name: exchange.name,
        type,
        volume_usd: volume,
        standard_taker_fee: fees.taker,
        taker_fee_after_rebate: fees.taker_after_rebate,
        standard_cost_usd: standardCost,
        cost_after_rebate_usd: rebateCost,
        savings_usd: savings,
        fee_discount: exchange.fee_discount,
        signup_url: trackedUrl(exchange.signup_url),
        referral_code: exchange.referral_code,
    };
}

function renderTradingCost(exchange: any, result: NonNullable<ReturnType<typeof tradingCost>>): string {
    return `## Trading Cost Calculator — ${exchange.name} ${result.type.toUpperCase()}\n\n` +
        `📊 **Trade Volume**: $${result.volume_usd.toLocaleString()}\n\n` +
        `### Without CoinRebate\n` +
        `- Taker Fee: ${(result.standard_taker_fee * 100).toFixed(4)}%\n` +
        `- Cost: **$${result.standard_cost_usd.toFixed(2)}**\n\n` +
        `### With CoinRebate (${exchange.fee_discount} discount)\n` +
        `- Taker Fee: ${(result.taker_fee_after_rebate * 100).toFixed(4)}%\n` +
        `- Cost: **$${result.cost_after_rebate_usd.toFixed(2)}**\n\n` +
        `### 💰 You Save: **$${result.savings_usd.toFixed(2)}** per trade\n` +
        `- Per $100K traded: **$${(result.savings_usd / result.volume_usd * 100000).toFixed(2)}**\n` +
        `- Per year ($1M volume): **$${(result.savings_usd / result.volume_usd * 1000000).toFixed(2)}**\n\n` +
        `🔗 Sign up: ${trackedUrl(exchange.signup_url)}\n` +
        `🎫 Referral Code: ${exchange.referral_code}`;
}

function compliantExchanges(data: AgentRouteData): any[] {
    return data.all_exchanges || data.exchanges || [];
}

function renderCompliant(exchanges: any[], country: string): string {
    return `## Exchanges Available in ${country}\n\n` +
        (exchanges.length === 0
            ? '⚠️ No exchanges available in this country due to regulatory restrictions.\n'
            : exchanges.map((exchange: any, index: number) =>
                `${index + 1}. **${exchange.name}** — ${exchange.fee_discount} | ${exchange.type} | Signup: ${trackedUrl(exchange.signup_url)}`
            ).join('\n')) +
        `\n\n⚠️ Compliance Notice: Results are filtered for ${country} using the same ` +
        `live compliance data as CoinRebate outbound routing. Exchange availability can change; ` +
        `restricted signup links are also refused at redirect time with HTTP 451.`;
}

function textResult(text: string, isError = false): ToolResult {
    return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function startMcpServer(): Promise<void> {
    const [{ McpServer }, { StdioServerTransport }, { z }] = await Promise.all([
        import('@modelcontextprotocol/sdk/server/mcp.js'),
        import('@modelcontextprotocol/sdk/server/stdio.js'),
        import('zod'),
    ]);

    const server = new McpServer({
        name: 'coinrebate',
        version: MCP_VERSION,
        description: 'Crypto exchange fee optimization and rebate data. Supports compliance filtering by country.',
    });

    server.tool(
        'get_exchange_fees',
        'Get real-time trading fees for all major crypto exchanges (Binance, OKX, Bybit, Bitget, Gate.io, Hyperliquid). Returns spot and futures maker/taker fees, plus fees after CoinRebate discount.',
        {},
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async () => {
            try {
                const data = await agentRoute(new URLSearchParams({ fees: 'true' }), 'get_exchange_fees');
                return textResult(JSON.stringify(data, null, 2));
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.tool(
        'compare_fees',
        'Compare trading fees across all exchanges for a specific purpose (spot or futures trading). Returns exchanges ranked by lowest fee after CoinRebate rebate discount. Pass country code for compliance-filtered results.',
        {
            purpose: z.enum(['spot', 'futures']).describe('Trading type: spot or futures'),
            country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code (e.g. US, CN, VN) for compliance filtering'),
        },
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async ({ purpose, country }) => {
            try {
                const params = new URLSearchParams({ purpose, fees: 'true' });
                if (country) params.set('country', country.toUpperCase());
                const data = await agentRoute(params, 'compare_fees');
                return textResult(renderComparison(rankedExchanges(data, purpose), purpose));
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.tool(
        'get_best_referral',
        'Get the best referral/signup link for a specific exchange with maximum fee discount. Returns referral code, discount percentage, and direct signup URL. Pass country to verify compliance.',
        {
            exchange: z.string().describe('Exchange name (binance, okx, bybit, bitget, gate, hyperliquid)'),
            country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code for compliance check'),
        },
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async ({ exchange, country }) => {
            try {
                const params = new URLSearchParams({ exchange: exchange.toLowerCase() });
                if (country) params.set('country', country.toUpperCase());
                const data = await agentRoute(params, 'get_best_referral');
                const selected = data.all_exchanges?.[0] || data.recommended;
                if (!selected) {
                    return textResult(data.compliance_notice || `Exchange "${exchange}" is not available for the requested filters.`);
                }
                return textResult(renderReferral(selected));
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.tool(
        'get_latest_news',
        'Get the latest crypto news and market insights published on CoinRebate. Returns recent articles with titles, summaries, and links.',
        {
            limit: z.number().min(1).max(20).default(5).describe('Number of articles to return (1-20, default 5)'),
        },
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async ({ limit }) => {
            try {
                const res = await fetch(`${API_BASE}/en/news`);
                if (!res.ok) throw new Error(`News API error: ${res.status} ${res.statusText}`);
                const articles = parseNewsArticles(await res.text(), limit);
                markSuccessfulNewsTool();
                if (articles.length === 0) {
                    return textResult('No recent news found. Visit https://www.coinrebate.vip/en/news for latest updates.');
                }
                return textResult(`## Latest CoinRebate News\n\n` +
                    articles.map((article, index) => `${index + 1}. [${article.title}](${API_BASE}/en/news/${article.slug})`).join('\n') +
                    `\n\n📰 View all news: ${API_BASE}/en/news`);
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.tool(
        'calculate_trading_cost',
        'Calculate the actual trading cost and savings when using CoinRebate referral codes. Shows how much you save compared to standard fees for a given trade volume.',
        {
            exchange: z.string().describe('Exchange name (binance, okx, bybit, bitget, gate, hyperliquid)'),
            volume: z.number().positive().describe('Trade volume in USD'),
            type: z.enum(['spot', 'futures']).describe('Trade type: spot or futures'),
            country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code for compliance filtering'),
        },
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async ({ exchange, volume, type, country }) => {
            try {
                const params = new URLSearchParams({ exchange: exchange.toLowerCase(), fees: 'true' });
                if (country) params.set('country', country.toUpperCase());
                const data = await agentRoute(params, 'calculate_trading_cost');
                const selected = data.all_exchanges?.[0] || data.recommended;
                const result = tradingCost(selected, volume, type);
                if (!result) return textResult(`No fee data for ${exchange} ${type} trading.`);
                return textResult(renderTradingCost(selected, result));
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.tool(
        'get_compliant_exchanges',
        'Get exchanges available in a specific country, filtered by the CoinRebate compliance matrix. Essential for regulatory compliance.',
        {
            country: z.string().length(2).describe('ISO 3166-1 alpha-2 country code (e.g. US, CN, BR, VN, PH, IN)'),
            purpose: z.enum(['spot', 'futures', 'p2p']).optional().describe('Trading purpose filter'),
        },
        {
            // All six tools are strictly read-only: they query public fee, compliance
            // and news data and never create, modify or delete anything.
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        async ({ country, purpose }) => {
            try {
                const normalizedCountry = country.toUpperCase();
                const params = new URLSearchParams({ country: normalizedCountry });
                if (purpose) params.append('purpose', purpose);
                const data = await agentRoute(params, 'get_compliant_exchanges');
                return textResult(renderCompliant(compliantExchanges(data), normalizedCountry));
            } catch (error: any) {
                return textResult(`Error: ${error.message}`, true);
            }
        }
    );

    server.resource(
        'about',
        'coinrebate://about',
        async (uri) => ({
            contents: [{
                uri: uri.href,
                text: `CoinRebate (https://www.coinrebate.vip) is a crypto exchange fee comparison and rebate platform.\n\nWe help traders save money by providing:\n- Real-time fee comparison across 6+ major exchanges\n- Exclusive referral codes with lifetime fee discounts (up to 30% off)\n- AI-powered crypto news and market insights in 7 languages\n- Developer-friendly API for algorithmic trading integration\n\nSupported Exchanges: Binance, OKX, Bybit, Bitget, Gate.io, Hyperliquid\n\nOur API is free and open — no authentication required.\nAPI Endpoint: ${API_BASE}/api/v4/agent-route`,
                mimeType: 'text/plain',
            }],
        })
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[CoinRebate MCP] Server started on stdio');
}

const HELP = `CoinRebate fee tools\n\nUsage:\n  coinrebate <command> [options]\n\nCommands:\n  fees [exchange]                         Show current fees and rates after rebate\n  compare --purpose spot|futures          Rank exchanges by effective fee\n  referral <exchange>                     Get the signup link and referral code\n  cost <exchange> --volume <usd>          Calculate trading cost and savings\n  compliant --country <XX>                List exchanges available in a country\n\nGlobal options:\n  --json                                  Print structured JSON\n  --help                                  Show help\n  --version                               Show version\n\nRun "coinrebate <command> --help" for a command example.\nRun with no arguments to start the MCP server.`;

const COMMAND_HELP: Record<string, string> = {
    fees: 'Usage: coinrebate fees [exchange] [--json]\nExample: coinrebate fees binance',
    compare: 'Usage: coinrebate compare --purpose spot|futures [--country XX] [--json]\nExample: coinrebate compare --purpose spot --country CN',
    referral: 'Usage: coinrebate referral <exchange> [--country XX] [--json]\nExample: coinrebate referral binance --country CN',
    cost: 'Usage: coinrebate cost <exchange> --volume <usd> [--type spot|futures] [--country XX] [--json]\nExample: coinrebate cost binance --volume 100000 --type spot',
    compliant: 'Usage: coinrebate compliant --country XX [--purpose spot|futures] [--json]\nExample: coinrebate compliant --country US --purpose spot',
};

function parseOptions(args: string[], valueOptions: string[]) {
    const values: Record<string, string> = {};
    const positionals: string[] = [];
    let json = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--json') {
            json = true;
            continue;
        }
        if (!argument.startsWith('--')) {
            positionals.push(argument);
            continue;
        }
        if (!valueOptions.includes(argument)) throw new CliError(`Unknown option "${argument}". Run "coinrebate --help".`);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw new CliError(`Missing value for ${argument}. Run "coinrebate --help".`);
        if (values[argument]) throw new CliError(`Option ${argument} was provided more than once. Remove the duplicate and try again.`);
        values[argument] = value;
        index += 1;
    }

    return { values, positionals, json };
}

function onePositional(positionals: string[], command: string, required: boolean): string | undefined {
    if (positionals.length > 1) throw new CliError(`Too many values for ${command}. Try: ${COMMAND_HELP[command].split('\n')[0].replace('Usage: ', '')}`);
    if (required && !positionals[0]) throw new CliError(`Missing exchange. Try: ${COMMAND_HELP[command].split('\n')[1].replace('Example: ', '')}`);
    return positionals[0]?.toLowerCase();
}

function countryOption(value: string | undefined, required = false): string | undefined {
    if (!value && required) throw new CliError('Missing --country. Try: coinrebate compliant --country US --purpose spot');
    if (value && !/^[a-z]{2}$/i.test(value)) throw new CliError('Country must be a two-letter code such as US, CN, or BR.');
    return value?.toUpperCase();
}

function purposeOption(value: string | undefined, required = false): 'spot' | 'futures' | undefined {
    if (!value && required) throw new CliError('Missing --purpose. Try: coinrebate compare --purpose spot');
    if (value !== undefined && value !== 'spot' && value !== 'futures') throw new CliError('Purpose must be spot or futures. Try: coinrebate compare --purpose spot');
    return value;
}

function friendlyApiError(error: unknown, exchange?: string): CliError {
    if (error instanceof ApiError && error.status === 404 && Array.isArray(error.payload?.available)) {
        return new CliError(`Unknown exchange "${exchange}". Available: ${error.payload.available.join(', ')}.`);
    }
    if (error instanceof ApiError && error.status === 429) {
        const seconds = Number(error.payload?.retryAfter) || 10;
        return new CliError(`Rate limit reached. Wait ${seconds} seconds, then try again.`, 1);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new CliError(`Could not get CoinRebate data. Check your connection or COINREBATE_API_URL, then try again. (${detail})`, 1);
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value));
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(4)}%`;
}

function renderFees(exchanges: any[]): string {
    const lines = exchanges.flatMap((exchange: any) => {
        const rows = [`${exchange.name} — ${exchange.fee_discount}`];
        for (const type of ['spot', 'futures'] as const) {
            const fees = exchange.fees?.[type];
            rows.push(fees
                ? `  ${type.padEnd(7)} maker ${formatPercent(fees.maker)} → ${formatPercent(fees.maker_after_rebate)} | taker ${formatPercent(fees.taker)} → ${formatPercent(fees.taker_after_rebate)}`
                : `  ${type.padEnd(7)} unavailable`);
        }
        return rows;
    });
    return `${lines.join('\n')}\n\nRates after → include the CoinRebate discount.`;
}

async function runCli(argv: string[]): Promise<void> {
    const [command, ...args] = argv;
    if (command === '--help' || command === 'help') {
        console.log(HELP);
        return;
    }
    if (command === '--version' || command === '-v') {
        console.log(MCP_VERSION);
        return;
    }
    if (!COMMAND_HELP[command]) throw new CliError(`Unknown command "${command}". Run "coinrebate --help".`);
    if (args.includes('--help')) {
        if (args.length !== 1) throw new CliError(`Use help on its own. Try: coinrebate ${command} --help`);
        console.log(COMMAND_HELP[command]);
        return;
    }

    if (command === 'fees') {
        const { positionals, json } = parseOptions(args, []);
        const exchange = onePositional(positionals, command, false);
        const params = new URLSearchParams({ fees: 'true' });
        if (exchange) params.set('exchange', exchange);
        try {
            const data = await agentRoute(params, 'get_exchange_fees');
            if (json) printJson(data);
            else console.log(renderFees(data.all_exchanges || []));
        } catch (error) {
            throw friendlyApiError(error, exchange);
        }
        return;
    }

    if (command === 'compare') {
        const { values, positionals, json } = parseOptions(args, ['--purpose', '--country']);
        if (positionals.length) throw new CliError('Compare does not take an exchange name. Try: coinrebate compare --purpose spot');
        const purpose = purposeOption(values['--purpose'], true)!;
        const country = countryOption(values['--country']);
        const params = new URLSearchParams({ purpose, fees: 'true' });
        if (country) params.set('country', country);
        try {
            const data = await agentRoute(params, 'compare_fees');
            const exchanges = rankedExchanges(data, purpose);
            if (json) printJson({ purpose, country: country || null, exchanges });
            else console.log(renderComparison(exchanges, purpose));
        } catch (error) {
            throw friendlyApiError(error);
        }
        return;
    }

    if (command === 'referral') {
        const { values, positionals, json } = parseOptions(args, ['--country']);
        const exchange = onePositional(positionals, command, true)!;
        const country = countryOption(values['--country']);
        const params = new URLSearchParams({ exchange });
        if (country) params.set('country', country);
        try {
            const data = await agentRoute(params, 'get_best_referral');
            const selected = data.all_exchanges?.[0] || data.recommended;
            if (json) printJson({ exchange: selected || null, compliance_notice: data.compliance_notice || null });
            else console.log(selected ? renderReferral(selected) : data.compliance_notice || `No referral is available for ${exchange}.`);
        } catch (error) {
            throw friendlyApiError(error, exchange);
        }
        return;
    }

    if (command === 'cost') {
        const { values, positionals, json } = parseOptions(args, ['--volume', '--type', '--country']);
        const exchange = onePositional(positionals, command, true)!;
        if (!values['--volume']) throw new CliError('Missing --volume. Try: coinrebate cost binance --volume 100000 --type spot');
        const volume = Number(values['--volume']);
        if (!Number.isFinite(volume) || volume <= 0) throw new CliError('Volume must be a positive USD amount. Try: coinrebate cost binance --volume 100000');
        const rawType = values['--type'];
        if (rawType !== undefined && rawType !== 'spot' && rawType !== 'futures') {
            throw new CliError('Type must be spot or futures. Try: coinrebate cost binance --volume 100000 --type spot');
        }
        const type = rawType || 'spot';
        const country = countryOption(values['--country']);
        const params = new URLSearchParams({ exchange, fees: 'true' });
        if (country) params.set('country', country);
        try {
            const data = await agentRoute(params, 'calculate_trading_cost');
            const selected = data.all_exchanges?.[0] || data.recommended;
            const result = tradingCost(selected, volume, type);
            if (!result) throw new CliError(`No ${type} fee data is available for ${exchange}. Try another exchange or trading type.`);
            if (json) printJson(result);
            else console.log(renderTradingCost(selected, result));
        } catch (error) {
            if (error instanceof CliError) throw error;
            throw friendlyApiError(error, exchange);
        }
        return;
    }

    const { values, positionals, json } = parseOptions(args, ['--country', '--purpose']);
    if (positionals.length) throw new CliError('Compliant does not take an exchange name. Try: coinrebate compliant --country US');
    const country = countryOption(values['--country'], true)!;
    const purpose = purposeOption(values['--purpose']);
    const params = new URLSearchParams({ country, fees: 'false' });
    if (purpose) params.set('purpose', purpose);
    try {
        const data = await agentRoute(params, 'get_compliant_exchanges');
        const exchanges = compliantExchanges(data);
        if (json) printJson({ country, purpose: purpose || null, exchanges, compliance_notice: data.compliance_notice || null });
        else console.log(renderCompliant(exchanges, country));
    } catch (error) {
        throw friendlyApiError(error);
    }
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        try { await startMcpServer(); } catch (error) { console.error(error); }
        return;
    }

    try {
        await runCli(argv);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = error instanceof CliError ? error.exitCode : 1;
    }
}

void main();
