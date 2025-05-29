require("dotenv").config({ path: "../../../.env" });
const SolanaTrader = require("../solanaTrader");
const { log } = require("../../utils/logger");
const { Connection, PublicKey } = require("@solana/web3.js");

const tokenAddress = "676YgDtdAekpjYwNvLSLFPkBooVxBqJVpgxxoHJPpump";

// Helper function to check actual token balance
async function checkTokenBalance(connection, walletPublicKey, tokenMintAddress) {
    try {
        // Get all token accounts for the wallet
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            walletPublicKey,
            { mint: new PublicKey(tokenMintAddress) }
        );
        
        log(`tokenAccounts ${tokenAccounts}`);
        
        if (tokenAccounts.value.length === 0) {
            log("No token accounts found for this token");
            return 0;
        }
        
        let totalBalance = 0;
        for (const account of tokenAccounts.value) {
            const balance = account.account.data.parsed.info.tokenAmount.amount;
            const decimals = account.account.data.parsed.info.tokenAmount.decimals;
            log(`Token account: ${account.pubkey.toString()}, Balance: ${balance}, Decimals: ${decimals}`);
            totalBalance += parseInt(balance);
        }
        
        log(`Total token balance: ${totalBalance}`);
        return totalBalance;
    } catch (error) {
        log(`Error checking token balance: ${error.message}`);
        return 0;
    }
}

async function testHandleSell() {
    log("Starting handleSell test...");

    try {
        // Initialize Solana Trader
        const solanaTrader = new SolanaTrader();
        
        // Check actual token balance before setting mock data
        const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
        const walletPublicKey = solanaTrader.wallet.publicKey;
        
        log(`Checking actual token balance for wallet: ${walletPublicKey.toString()}`);
        const actualBalance = await checkTokenBalance(connection, walletPublicKey, tokenAddress);
        
        const mockToken = {
            tokenAddress: tokenAddress,
            purchaseTime: new Date().toISOString(),
            messageTime: new Date().toISOString(),
            purchasePrice: 0.000001, // Mock price
            tokenAmount: actualBalance > 0 ? actualBalance : 1000, // Use actual balance if available
            solAmount: 0.001 // 0.001 SOL spent
        };

        log(`Using token amount: ${mockToken.tokenAmount} (actual balance: ${actualBalance})`);

        // Set the mock purchased token using the new method
        solanaTrader.setPurchasedToken(mockToken);
        
        // Verify the token was set correctly
        const currentToken = solanaTrader.getPurchasedTokenObject();
        log(`Current purchased token: ${JSON.stringify(currentToken, null, 2)}`);
        
        // Test selling the mock token
        const result2 = await solanaTrader.handleSell(tokenAddress, "Test - Mock sell");
        log(`Sell result: ${JSON.stringify(result2, null, 2)}`);

        // Test case 3: Verify token was cleared after sell
        log("\n=== Test Case 3: Verify token cleared after sell ===");
        const tokenAfterSell = solanaTrader.getPurchasedTokenObject();
        log(`Token after sell: ${tokenAfterSell}`);
        log(`Has token after sell: ${solanaTrader.hasToken()}`);

    } catch (error) {
        log(`Test error: ${error.message}`);
        log(`Full error: ${JSON.stringify(error, null, 2)}`);
    }
}

// Main test execution
async function runAllTests() {
    log("=".repeat(60));
    log("STARTING HANDLE SELL TESTS");
    log("=".repeat(60));
    
    await testHandleSell();
    
    log("\n" + "=".repeat(60));
    log("TESTS COMPLETED");
    log("=".repeat(60));
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        log(`Test execution failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    testHandleSell,
    runAllTests
}; 