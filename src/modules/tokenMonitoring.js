const { getTokenPrice } = require("../utils/utils");
const { log } = require("../utils/logger");
const { PRICE_CHECK_INTERVAL } = require("../utils/consts");
const tokenState = require("../utils/tokenState");

// Load config
const fs = require("fs");
const path = require("path");
const configPath = path.resolve(__dirname, "../../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Store the monitoring interval ID
let monitoringInterval = null;

/**
 * Gets price at a specific time in the past
 * @param {number} minutesAgo - Minutes ago to get price for
 * @returns {number} Price at that time, or 0 if not available
 */
function getPriceAtTime(minutesAgo) {
    const priceHistory = tokenState.getPriceHistory();
    
    if (priceHistory.length === 0) {
        return 0;
    }

    const now = Date.now();
    const targetTime = new Date(now - minutesAgo * 60 * 1000);
    const oldestHistoryTime = new Date(priceHistory[0].timestamp);

    // Check if we have enough history to even look back this far.
    // If the oldest data point is more recent than our target time, we don't have data for that period.
    if (oldestHistoryTime > targetTime) {
        log(`Not enough price history to get price for ${minutesAgo}m ago. Oldest data is from ${oldestHistoryTime.toISOString()}`);
        return 0;
    }

    // Find the closest price entry to the target time
    let closest = priceHistory[0];
    let minDiff = Math.abs(new Date(closest.timestamp) - targetTime);
    
    for (const entry of priceHistory) {
        const diff = Math.abs(new Date(entry.timestamp) - targetTime);
        if (diff < minDiff) {
            minDiff = diff;
            closest = entry;
        }
    }
    
    return closest.price;
}

/**
 * Decides whether to sell based on price history and current price
 * @param {number} currentPrice - Current token price
 * @param {number} capital - Capital amount
 * @returns {object} Sell decision object
 */
function decideSell(currentPrice, capital) {
    const purchasedToken = tokenState.getPurchasedToken();
    const priceHistory = tokenState.getPriceHistory();
    
    if (!purchasedToken || priceHistory.length === 0) {
        return { sellAt: "no data", returnRate: 0, finalCapital: 0 };
    }

    // Get prices at different time intervals
    const price5m = getPriceAtTime(5);
    const price10m = getPriceAtTime(10);
    const price20m = getPriceAtTime(20);
    
    // Calculate return rates compared to purchase price
    const purchasePrice = purchasedToken.purchasePrice;
    const r5 = price5m > 0 ? currentPrice / price5m : 0;
    const r10 = price10m > 0 ? currentPrice / price10m : 0;
    const r20 = price20m > 0 ? currentPrice / price20m : 0;
    const rCurrent = purchasePrice > 0 ? currentPrice / purchasePrice : 0;

    log(`Price tracking - Current: ${currentPrice}, Purchase: ${purchasePrice}, 5m: ${price5m}, 10m: ${price10m}, 20m: ${price20m}`);
    log(`Return rates - Current: ${rCurrent.toFixed(2)}x, 5m: ${r5.toFixed(2)}x, 10m: ${r10.toFixed(2)}x, 20m: ${r20.toFixed(2)}x`);

    // Rule 3: Sell at 10m if it's dropping compared to 5m
    if (r10 < r5 && r10 > 0) {
        return { sellAt: "10m (drop detected)", returnRate: r10, finalCapital: capital * r10 };
    }

    // Rule 4: Sell at 10m if 20m shows further drop
    if (r20 < r10 && r10 > 0) {
        return { sellAt: "10m (pre-20m drop)", returnRate: r10, finalCapital: capital * r10 };
    }

    // No sell condition met
    return { sellAt: "hold", returnRate: rCurrent, finalCapital: capital * rCurrent };
}

/**
 * Starts token monitoring and returns action recommendations
 * @param {Connection} connection - Solana connection object
 * @param {Function} actionCallback - Callback function to handle actions (SELL, HOLD)
 */
function startTokenMonitoring(connection, actionCallback) {
    log('Starting token monitoring...', true);
    
    // Clear any existing interval
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
    }
    
    monitoringInterval = setInterval(async () => {
        try {
            const purchasedToken = tokenState.getPurchasedToken();
            
            if (purchasedToken) {
                const currentPrice = await getTokenPrice(purchasedToken.tokenAddress, connection);

                const currentTime = Date.now();
                const lastLogTime = tokenState.getLastLogTime();
                
                if (currentTime - (lastLogTime || 0) > 120000) { // Log every 2 minutes
                    log(`startTokenMonitoring - Current price: $${currentPrice} USD per token`, true);
                    tokenState.setLastLogTime(currentTime);
                }
                
                if (currentPrice === 0) return;

                // Add current price to history
                const now = new Date(currentTime).toISOString();
                tokenState.addPriceToHistory({
                    timestamp: now,
                    price: currentPrice
                });

                // Quick sell check: take profit percentage
                const takeProfitRatio = 1 + (config.trading_settings.take_profit_percentage / 100);
                const priceRatio = currentPrice / purchasedToken.purchasePrice;
                
                if (priceRatio >= takeProfitRatio) {
                    const reason = `Take profit - ${config.trading_settings.take_profit_percentage}% gain`;
                    log(`Take profit triggered for ${purchasedToken.tokenAddress} - ${config.trading_settings.take_profit_percentage}%+ gain detected (${((priceRatio - 1) * 100).toFixed(2)}%)`, true);
                    
                    // Call the action callback with SELL action
                    if (actionCallback) {
                        actionCallback("SELL", {
                            tokenAddress: purchasedToken.tokenAddress,
                            reason: reason,
                            currentPrice: currentPrice,
                            profitPercent: ((priceRatio - 1) * 100).toFixed(2)
                        });
                    }
                    return;
                }

                // Strategic sell check using tracked price history
                // const sellDecision = decideSell(currentPrice, purchasedToken.solAmount);
                
                // if (sellDecision.sellAt !== "hold") {
                //     const reason = `Strategic sell - ${sellDecision.sellAt}`;
                //     log(`Strategic sell triggered for ${purchasedToken.tokenAddress} - ${sellDecision.sellAt} (${((sellDecision.returnRate - 1) * 100).toFixed(2)}% return)`, true);
                //     
                //     // Call the action callback with SELL action
                //     if (actionCallback) {
                //         actionCallback("SELL", {
                //             tokenAddress: purchasedToken.tokenAddress,
                //             reason: reason,
                //             currentPrice: currentPrice,
                //             returnRate: sellDecision.returnRate
                //         });
                //     }
                //     return;
                // }
                
                // No action needed - continue monitoring
                if (actionCallback) {
                    actionCallback("HOLD", {
                        tokenAddress: purchasedToken.tokenAddress,
                        currentPrice: currentPrice
                    });
                }
            }
        } catch (error) {
            log(`Error in token monitoring: ${error.message}`, true);
        }
    }, PRICE_CHECK_INTERVAL);
}

/**
 * Stops token monitoring
 */
function stopTokenMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        log('Token monitoring stopped', true);
    }
}

module.exports = {
    startTokenMonitoring,
    stopTokenMonitoring,
    getPriceAtTime,
    decideSell
};
