// Singleton for managing token trading state
class TokenState {
    constructor() {
        if (TokenState.instance) {
            return TokenState.instance;
        }
        
        // Initialize state
        this.purchasedToken = null; // {tokenAddress, purchaseTime, messageTime, purchasePrice, tokenAmount, solAmount}
        this.priceHistory = []; // Array of {timestamp, price} objects for the current token
        this.sold_tokens = []; // In-memory list of sold tokens for this session
        this.lastLogTime = 0;
        
        TokenState.instance = this;
    }

    // Getters
    getPurchasedToken() {
        return this.purchasedToken;
    }

    getPriceHistory() {
        return this.priceHistory;
    }

    getSoldTokens() {
        return this.sold_tokens;
    }

    getLastLogTime() {
        return this.lastLogTime;
    }

    // Setters
    setPurchasedToken(token) {
        this.purchasedToken = token;
    }

    setPriceHistory(history) {
        this.priceHistory = history;
    }

    setLastLogTime(time) {
        this.lastLogTime = time;
    }

    // Utility methods
    addToSoldTokens(tokenAddress) {
        if (!this.sold_tokens.includes(tokenAddress)) {
            this.sold_tokens.push(tokenAddress);
        }
    }

    addPriceToHistory(priceEntry) {
        this.priceHistory.push(priceEntry);
        
        // Keep only last 2 hours of data (720 entries at 10-second intervals)
        if (this.priceHistory.length > 720) {
            this.priceHistory = this.priceHistory.slice(-720);
        }
    }

    clearPurchasedToken() {
        this.purchasedToken = null;
        this.priceHistory = [];
    }

    hasPurchasedToken() {
        return this.purchasedToken !== null;
    }

    isTokenSold(tokenAddress) {
        return this.sold_tokens.includes(tokenAddress);
    }

    getCurrentTokenAddress() {
        return this.purchasedToken ? this.purchasedToken.tokenAddress : null;
    }
}

// Create and export singleton instance
const tokenState = new TokenState();
module.exports = tokenState;
