require("dotenv").config(); // Load .env from project root
const fs = require("fs");
const path = require("path");

const { setMessageHandler, startClient, stopClient } = require("./modules/telegramListener");
const { processMessage } = require("./modules/messageProcessor");
const SolanaTrader = require("./modules/solanaTrader");

// Load config
const configPath = path.resolve(__dirname, "../config/config.json"); // Adjusted path for src directory
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

async function main() {
    console.log("Starting application...");

    // Validate essential configurations
    if (!process.env.TELEGRAM_APP_API_ID) {
        console.error("Error: TELEGRAM_APP_API_ID is not defined in .env file.");
        process.exit(1);
    }
    if (!process.env.TELEGRAM_APP_API_HASH) {
        console.error("Error: TELEGRAM_APP_API_HASH is not defined in .env file.");
        process.exit(1);
    }
    if (!config.telegram_channels || config.telegram_channels.length === 0) {
        console.error("Error: No telegram_channels specified in config/config.json.");
        process.exit(1);
    }

    try {
        // Initialize Solana Trader (Commented out for now as requested)
        const solanaTrader = new SolanaTrader();

        console.log("Initializing Telegram message handler...");
        
        // Set the message handler in the Telegram listener
        // The listener will call this function for messages from tracked channels
        setMessageHandler(async (msg) => {
            try {
                const address = await processMessage(msg);

                if (address !== null) {
                    console.log(`Message for ${address} verified. Proceeding to trading module.`);
                    await solanaTrader.handlePurchase(address, msg);
                }                

            } catch (error) {
                console.error("Error processing message in main handler:", error);
            }
        });

        // Start the Telegram client (this will authenticate and connect)
        await startClient();

        console.log("Application started successfully. Listening for Telegram messages...");
        console.log(`Tracking channels: ${config.telegram_channels.join(", ")}`);

    } catch (error) {
        console.error("Failed to initialize the application:", error);
        process.exit(1);
    }
}

// Ensure proper cleanup on exit
process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await stopClient();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await stopClient();
    process.exit(0);
});

// Start the application
main().catch(error => {
    console.error("Unhandled error in main execution:", error);
    process.exit(1);
});

