# Solana Telegram Bot

A Node.js application that monitors Telegram channels for Solana token alerts and processes them.

## Overview

This bot connects to Telegram using the MTProto API (via GramJS) to monitor specific channels for messages containing Solana token addresses. When a valid token address is detected, the bot can initiate a purchase on the Solana network (trading functionality currently disabled).

## Setup

### Prerequisites

- Node.js v18+ 
- A Telegram account
- Telegram API credentials (API ID and API Hash)
- Solana wallet (for trading functionality)

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   TELEGRAM_APP_API_ID=<your-api-id>
   TELEGRAM_APP_API_HASH=<your-api-hash>
   SOLANA_WALLET_PRIVATE_KEY=<your-solana-wallet-private-key>
   ```

### Obtaining Telegram API Credentials

1. Visit https://my.telegram.org/auth
2. Log in with your phone number
3. Go to "API development tools"
4. Create a new application
5. Copy the API ID and API Hash to your `.env` file

### First Run

On first run, you'll be prompted to authenticate with your Telegram account:

```
npm run test-telegram
```

This will output a session string to add to your `.env` file:

```
TELEGRAM_STRING_SESSION=<session-string>
```

### Configuration

Edit `config/config.json` to specify which Telegram channels to monitor:

```json
{
  "telegram_channels": [
    "VIP Call",
    "VIP Rose Signal",
    "YourChannelName"
  ],
  "solana_rpc_endpoint": "https://api.mainnet-beta.solana.com",
  "trading_settings": {
    "slippage_bps": 50, 
    "compute_unit_price_micro_lamports": 50000,
    "compute_unit_limit": 200000,
    "purchase_amount_sol": 0.01
  }
}
```

### Running the Bot

```
npm start
```

## Architecture

- `src/index.js` - Main application entry point
- `src/modules/telegramListener.js` - Connects to Telegram using GramJS
- `src/modules/messageProcessor.js` - Processes messages and extracts Solana addresses
- `src/modules/solanaTrader.js` - Handles token purchases (currently disabled)

## License

ISC

