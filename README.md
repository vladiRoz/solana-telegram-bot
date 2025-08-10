## Solana Telegram Bot

A simple Node.js bot that listens to specific Telegram channels, extracts Solana token addresses from messages, verifies them, and can automatically trade via Jupiter.

## Overview

- Monitors configured Telegram channels using GramJS (MTProto).
- Extracts Solana token addresses from message text.
- Verifies the address still appears in the most recent channel messages after a short delay (20 seconds) before proceeding.
- Integrates with Jupiter to quote and execute swaps, then monitors price and takes profit based on configuration.
- Logs activity to console and a rotating file.

## Project structure

- `src/index.js`: App entrypoint. Wires the Telegram listener to the message processor and trading module.
- `src/modules/telegramListener.js`: Handles Telegram client auth/session and routes messages from `config.telegram_channels` to the handler.
- `src/modules/messageProcessor.js`: Address extraction and message re-verification logic.
- `src/modules/solanaTrader.js`: Trading via Jupiter (quote, swap, confirmation, monitoring, take-profit, sell).
- `src/utils/logger.js`: Console and file logging with timestamps (Sydney timezone).
- `config/config.json`: Runtime configuration.

## Requirements

- Node.js v18+
- Telegram account and API credentials (API ID and API Hash)
- A Solana wallet private key (JSON array format) if trading

## Install

1) Install dependencies
```
npm install
```

2) Create a `.env` in the project root with:
```
TELEGRAM_APP_API_ID=<your-api-id>
TELEGRAM_APP_API_HASH=<your-api-hash>
# Optional initially; will be printed on first login if absent
TELEGRAM_STRING_SESSION=<session-string>

# Required for trading; JSON array of numbers (secret key)
SOLANA_WALLET_PRIVATE_KEY=[1,2,3,...]
```

3) Configure `config/config.json`:
```json
{
  "telegram_channels": ["calls", "alerts"],
  "solana_rpc_endpoint": "https://api.mainnet-beta.solana.com",
  "trading_settings": {
    "slippage_bps": 2000,
    "compute_unit_price_micro_lamports": 50000,
    "compute_unit_limit": 200000,
    "purchase_amount_sol": 0.2,
    "take_profit_percentage": 70
  },
  "logging": { "show_timestamps": true },
  "excluded_tokens": [
    "Ey2zpSAJ5gVLfYDD5WjccbksJD3E9jPFMPaJ8wxvpump",
    "jZGmEwwaW94iiU32wa6RADgVEhdpQpa6MtGERfJpump",
    "12XvRbmvA3AY8La3brnQGcMR5HBp7Cn3Fxc5kKiQ86FY",
    "5bXVGNnGhCFAK9KPh1S9whFkhVxZy1mREWFbqB499xUP",
    "T1Hf5w9772oCkp8cnhoSdKdfjsKieVGEnDuNJeEpump"
  ]
}
```

## First run / Telegram auth

If `TELEGRAM_STRING_SESSION` is not set, the app will prompt for phone, password, and code, then print a session string to add to `.env`.

Alternatively, you can run the helper script:
```
npm run test-telegram
```
and copy the printed session string into `.env` as `TELEGRAM_STRING_SESSION`.

## Run

```
npm start
```

## How it works

- Address extraction: uses Base58 regex for 32–44 chars and allows an optional trailing `pump`. Messages that contain `dexscreener.com` are ignored.
- Validation: basic length check and base58 decoding (non-`pump` addresses).
- Verification: after detecting an address, the bot waits ~20 seconds, fetches the last messages from the channel, and proceeds only if the same address is still present.
- Trading: fetches quotes and swaps via Jupiter, signs with your wallet, confirms the transaction, tracks price every 10s, and auto-sells on configured take-profit. Prevents re-buying the same token in the same session and respects `excluded_tokens`.

## Logging

- Console output always enabled; timestamps controlled by `config.logging.show_timestamps`.
- File: logs written to `logs/bot-activity.log` when saveToFile is requested by the code path.

## Testing

Run all tests:
```
npm test
```

Run a single test file:
```
npm test -- src/modules/__tests__/messageProcessor.test.js
```

## PM2 (optional)

- Start under PM2:
```
pm2 start npm --name "solana-telegram-bot" -- start
pm2 save
```

- View logs:
```
pm2 logs solana-telegram-bot
```

- Remove the process:
```
pm2 delete solana-telegram-bot
pm2 save
```

## Safety notes

- Real funds are at risk. Start with small amounts and test thoroughly.
- Ensure `SOLANA_WALLET_PRIVATE_KEY` is correct and secured. The project expects a JSON array secret key; it will be converted internally to base58.
- Be mindful of RPC rate limits and Jupiter API availability.

## License

ISC