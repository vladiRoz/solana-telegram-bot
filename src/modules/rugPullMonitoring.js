const { log } = require("../utils/logger");
const tokenState = require("../utils/tokenState");
const { getLastMessage } = require("./telegramListener");
const { extractSolanaAddresses } = require("./messageProcessor");

class RugPullMonitoring {
    constructor() {
        this.monitoringInterval = null;
        this.monitoringStartTime = null;
        this.monitoredToken = null;
        this.chatTitle = null;
        this.isActive = false;
    }

    /**
     * Start monitoring for rug pull by checking if the message with token address gets deleted
     * @param {string} tokenAddress - The token address to monitor
     * @param {string} chatTitle - The chat title where the message was posted
     * @param {Function} actionCallback - Callback function to handle sell action
     */
    startMonitoring(tokenAddress, chatTitle, actionCallback) {
        if (this.isActive) {
            log('Rug pull monitoring is already active. Stopping previous monitoring.', true);
            this.stopMonitoring();
        }

        this.monitoredToken = tokenAddress;
        this.chatTitle = chatTitle;
        this.monitoringStartTime = Date.now();
        this.isActive = true;

        log(`Starting rug pull monitoring for token ${tokenAddress} in chat ${chatTitle}`, true);
        log(`Will monitor for 5 minutes (300 seconds), checking every 2 seconds`, true);

        // Check every 2 seconds
        this.monitoringInterval = setInterval(async () => {
            try {
                await this.checkForRugPull(actionCallback);
            } catch (error) {
                log(`Error during rug pull check: ${error.message}`, true);
            }
        }, 2000); // 2 seconds interval

        // Auto-stop after 5 minutes
        setTimeout(() => {
            if (this.isActive) {
                log(`Rug pull monitoring completed for ${tokenAddress} after 5 minutes - no rug pull detected`, true);
                this.stopMonitoring();
            }
        }, 300000); // 5 minutes = 300,000 milliseconds
    }

    /**
     * Check if the message with the token address has been deleted (rug pull indicator)
     * @param {Function} actionCallback - Callback function to handle sell action
     */
    async checkForRugPull(actionCallback) {
        if (!this.isActive || !this.monitoredToken || !this.chatTitle) {
            return;
        }

        const currentTime = Date.now();
        const elapsed = (currentTime - this.monitoringStartTime) / 1000;

        // Log progress every 30 seconds
        if (Math.floor(elapsed) % 30 === 0 && Math.floor(elapsed) !== 0) {
            log(`Rug pull monitoring: ${Math.floor(elapsed)}s elapsed, still monitoring ${this.monitoredToken}`, true);
        }

        try {
            // Get the last messages from the chat
            const lastMessages = await getLastMessage(this.chatTitle);

            if (!lastMessages || lastMessages.length === 0) {
                log(`Could not retrieve messages from ${this.chatTitle}. This might indicate message deletion or chat issues.`, true);
                await this.handleRugPull(actionCallback, "Chat messages unavailable - possible deletion");
                return;
            }

            // Extract token addresses from all recent messages
            const recentAddresses = lastMessages
                .map(msg => extractSolanaAddresses(msg))
                .filter(addr => addr !== null);

            log(`Rug pull check: Found ${recentAddresses.length} token addresses in recent messages`, false);

            // Check if our monitored token address is still present
            if (!recentAddresses.includes(this.monitoredToken)) {
                log(`RUG PULL DETECTED! Token ${this.monitoredToken} address no longer found in recent messages from ${this.chatTitle}`, true);
                await this.handleRugPull(actionCallback, "Message with token address was deleted");
                return;
            }

            log(`Token ${this.monitoredToken} still present in chat messages - no rug pull detected yet`, false);

        } catch (error) {
            log(`Error checking for rug pull: ${error.message}`, true);
            
            // If we can't access the chat, treat this as suspicious
            if (error.message.includes('chat') || error.message.includes('access')) {
                await this.handleRugPull(actionCallback, "Unable to access chat - possible restriction");
            }
        }
    }

    /**
     * Handle detected rug pull by triggering immediate sell
     * @param {Function} actionCallback - Callback function to handle sell action
     * @param {string} reason - Reason for the rug pull detection
     */
    async handleRugPull(actionCallback, reason) {
        if (!this.isActive) {
            return;
        }

        // Store token address before stopping monitoring (which sets it to null)
        const tokenAddress = this.monitoredToken;

        log(`URGENT: Rug pull detected for ${tokenAddress}. Reason: ${reason}`, true);
        log(`Triggering immediate sell to minimize losses...`, true);

        // Stop monitoring as we've detected the issue
        this.stopMonitoring();

        // Trigger the sell action through callback
        if (actionCallback && typeof actionCallback === 'function') {
            actionCallback('SELL', {
                tokenAddress: tokenAddress,
                reason: `RUG PULL PROTECTION: ${reason}`,
                urgent: true,
                rugPullDetected: true
            });
        } else {
            log('No action callback provided - cannot execute sell!', true);
        }
    }

    /**
     * Stop rug pull monitoring
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        if (this.isActive) {
            log(`Rug pull monitoring stopped for token ${this.monitoredToken || 'unknown'}`, true);
        }

        this.isActive = false;
        this.monitoredToken = null;
        this.chatTitle = null;
        this.monitoringStartTime = null;
    }

    /**
     * Get current monitoring status
     * @returns {Object} Status object with monitoring details
     */
    getStatus() {
        if (!this.isActive) {
            return {
                active: false,
                token: null,
                chat: null,
                elapsed: 0,
                remaining: 0
            };
        }

        const elapsed = this.monitoringStartTime ? (Date.now() - this.monitoringStartTime) / 1000 : 0;
        const remaining = Math.max(0, 300 - elapsed); // 300 seconds = 5 minutes

        return {
            active: true,
            token: this.monitoredToken,
            chat: this.chatTitle,
            elapsed: Math.floor(elapsed),
            remaining: Math.floor(remaining)
        };
    }

    /**
     * Check if monitoring is currently active
     * @returns {boolean} True if monitoring is active
     */
    isMonitoringActive() {
        return this.isActive;
    }
}

module.exports = RugPullMonitoring;

