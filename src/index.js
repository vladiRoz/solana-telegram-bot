require("dotenv").config(); // Load .env from project root
const fs = require("fs");
const path = require("path");
const { Connection } = require("@solana/web3.js");

const { setMessageHandler, startClient, stopClient } = require("./modules/telegramListener");
const { processMessage } = require("./modules/messageProcessor");
const SolanaTrader = require("./modules/solanaTrader");
const { startTokenMonitoring, stopTokenMonitoring } = require("./modules/tokenMonitoring");
const RugPullMonitoring = require("./modules/rugPullMonitoring");
const { log } = require("./utils/logger");

const configPath = path.resolve(__dirname, "../config/config.json"); // Adjusted path for src directory
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

/**
 * Initialize and start the trading bot application
 * @param {Object} options - Optional configuration overrides for testing
 * @param {Object} options.config - Configuration object override
 * @param {Object} options.connection - Solana connection override
 * @param {Object} options.solanaTrader - SolanaTrader instance override
 * @returns {Promise<Object>} - Returns initialized components for testing
 */
async function initializeApplication(options = {}) {
    const appConfig = options.config || config;

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
    if (!appConfig.telegram_channels || appConfig.telegram_channels.length === 0) {
        log("Error: No telegram_channels specified in config/config.json.");
        process.exit(1);
    }

    try {
        // Validate Solana wallet private key
        if (!process.env.SOLANA_WALLET_PRIVATE_KEY) {
            log("Error: SOLANA_WALLET_PRIVATE_KEY is not set in .env file.");
            process.exit(1);
        }

        const connection = options.connection || new Connection(appConfig.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com", "confirmed");
        log(`Connected to Solana RPC: ${connection.rpcEndpoint}`);

        const solanaTrader = options.solanaTrader || new SolanaTrader(process.env.SOLANA_WALLET_PRIVATE_KEY, connection);
        const rugPullMonitor = new RugPullMonitoring();
        
        // Set global reference for cleanup
        globalRugPullMonitor = rugPullMonitor;

        log("Initializing Telegram message handler...", true);

        // Set the message handler in the Telegram listener
        // The listener will call this function for messages from tracked channels
        setMessageHandler(async (msg) => {
            try {
                const address = await processMessage(msg);

                if (address !== null) {
                    log(`Message for ${address} verified. Proceeding to trading module.`, true);
                    const purchaseResult = await solanaTrader.handlePurchase(address, msg);
                    if (purchaseResult.success) {
                        log("Starting token monitoring", true);
                        
                        // Create action callback to handle both monitoring types
                        const monitoringActionCallback = async (action, actionData) => {
                            try {
                                if (action === "SELL") {
                                    const reason = actionData.reason || "Monitoring triggered";
                                    log(`Monitoring triggered SELL action for ${actionData.tokenAddress}: ${reason}`, true);
                                    
                                    // Stop both monitoring systems before selling
                                    if (actionData.rugPullDetected) {
                                        log("Rug pull detected - stopping all monitoring immediately", true);
                                        rugPullMonitor.stopMonitoring();
                                        stopTokenMonitoring();
                                    }

                                    const sellResult = await solanaTrader.handleSell(actionData.tokenAddress, reason);

                                    if (sellResult.success) {
                                        log(`Sell completed successfully: ${sellResult.message}`, true);
                                        stopTokenMonitoring();
                                        rugPullMonitor.stopMonitoring();
                                    } else {
                                        log(`Sell failed: ${sellResult.message}`, true);

                                        // Stop monitoring if tokens were manually sold (not in wallet)
                                        if (sellResult.message === "No tokens found in wallet") {
                                            log(`Tokens were manually sold. Stopping all monitoring for ${actionData.tokenAddress}`, true);
                                            stopTokenMonitoring();
                                            rugPullMonitor.stopMonitoring();
                                        }
                                    }
                                }
                            } catch (error) {
                                log(`Error handling monitoring action ${action}: ${error.message}`, true);
                            }
                        };

                        // Start token monitoring with unified callback
                        startTokenMonitoring(connection, monitoringActionCallback);
                        
                        // Start rug pull monitoring with unified callback
                        log("Starting rug pull monitoring", true);
                        rugPullMonitor.startMonitoring(address, msg.chat.title, monitoringActionCallback);
                    }
                }

            } catch (error) {
                log("Error processing message in main handler: " + error);
            }
        });

        // Start the Telegram client (this will authenticate and connect)
        await startClient();

        log("Application started successfully. Listening for Telegram messages...");
        log(`Tracking channels: ${appConfig.telegram_channels.join(", ")}`);

        // Return components for testing purposes
        return {
            connection,
            solanaTrader,
            rugPullMonitor,
            config: appConfig
        };

    } catch (error) {
        log("Failed to initialize the application: " + error);
        process.exit(1);
    }
}

async function main() {
    await initializeApplication();
}

// Store rugPullMonitor for cleanup - will be set during initialization
let globalRugPullMonitor = null;

// Ensure proper cleanup on exit
process.on("SIGINT", async () => {
    log("Shutting down...");
    stopTokenMonitoring();
    if (globalRugPullMonitor) {
        globalRugPullMonitor.stopMonitoring();
    }
    await stopClient();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    log("Shutting down...");
    stopTokenMonitoring();
    if (globalRugPullMonitor) {
        globalRugPullMonitor.stopMonitoring();
    }
    await stopClient();
    process.exit(0);
});

// Start the application only if this file is run directly (not required as a module)
if (require.main === module) {
    main().catch(error => {
        log("Unhandled error in main execution: " + error);
        process.exit(1);
    });
}

// Export for testing
module.exports = {
    initializeApplication,
    main
};

