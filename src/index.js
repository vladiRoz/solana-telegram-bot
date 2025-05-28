require("dotenv").config(); // Load .env from project root
const fs = require("fs");
const path = require("path");

const { setMessageHandler, startClient, stopClient } = require("./modules/telegramListener");
const { processMessage } = require("./modules/messageProcessor");
const SolanaTrader = require("./modules/solanaTrader");
const { log } = require("./utils/logger");

// Load config
const configPath = path.resolve(__dirname, "../config/config.json"); // Adjusted path for src directory
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// from config
// "VIP Paid Channel 🔐",
// "TangerineTrip"

async function main() {
    log("Starting application...");

    // Validate essential configurations
    if (!process.env.TELEGRAM_APP_API_ID) {
        log("Error: TELEGRAM_APP_API_ID is not defined in .env file.");
        process.exit(1);
    }
    if (!process.env.TELEGRAM_APP_API_HASH) {
        log("Error: TELEGRAM_APP_API_HASH is not defined in .env file.");
        process.exit(1);
    }
    if (!config.telegram_channels || config.telegram_channels.length === 0) {
        log("Error: No telegram_channels specified in config/config.json.");
        process.exit(1);
    }

    try {
        // Initialize Solana Trader
        const solanaTrader = new SolanaTrader();

        // Start token monitoring
        await solanaTrader.startTokenMonitoring();
        log("Token monitoring started successfully");

        log("Initializing Telegram message handler...");
        
        // Set the message handler in the Telegram listener
        // The listener will call this function for messages from tracked channels
        setMessageHandler(async (msg) => {
            try {
                const address = await processMessage(msg);

                if (address !== null) {
                    log(`Message for ${address} verified. Proceeding to trading module.`);
                    await solanaTrader.handlePurchase(address, msg);
                }                

            } catch (error) {
                log("Error processing message in main handler: " + error);
            }
        });

        // Start the Telegram client (this will authenticate and connect)
        await startClient();

        log("Application started successfully. Listening for Telegram messages...");
        log(`Tracking channels: ${config.telegram_channels.join(", ")}`);

    } catch (error) {
        log("Failed to initialize the application: " + error);
        process.exit(1);
    }
}

// Ensure proper cleanup on exit
process.on("SIGINT", async () => {
    log("Shutting down...");
    await stopClient();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    log("Shutting down...");
    await stopClient();
    process.exit(0);
});

// Start the application
main().catch(error => {
    log("Unhandled error in main execution: " + error);
    process.exit(1);
});

