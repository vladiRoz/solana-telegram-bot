const bs58 = require('bs58');
const { PublicKey } = require("@solana/web3.js");
const fetch = require('cross-fetch');
const { log } = require("./logger");
const { SOL_MINT, JUPITER_API_BASE } = require("./consts");

// Helper function to convert JSON array private key to base58
function convertPrivateKeyToBase58(privateKeyJson) {
    try {
        // Parse the JSON string if it's a string
        const privateKeyArray = typeof privateKeyJson === 'string' ? JSON.parse(privateKeyJson) : privateKeyJson;
        
        // Convert array to Uint8Array
        const privateKeyBytes = new Uint8Array(privateKeyArray);
        
        // Convert to base58
        return bs58.encode(privateKeyBytes);
    } catch (error) {
        console.error('Error converting private key:', error);
        throw new Error('Failed to convert private key to base58 format');
    }
}

// Get token price using Jupiter API
async function getTokenPrice(tokenAddress, connection) {
    try {
        // Get token decimals first
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenAddress));
        let decimals = 9; // Default
        if (mintInfo.value && mintInfo.value.data.parsed) {
            decimals = mintInfo.value.data.parsed.info.decimals;
        }
        
        // Use same small amount as actual trades (0.001 SOL) to get realistic pricing
        const smallAmountLamports = 1000000; // 0.001 SOL = 1,000,000 lamports
        const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${tokenAddress}&amount=${smallAmountLamports}&slippageBps=300`;
        
        const response = await fetch(quoteUrl);
        const data = await response.json();
        
        if (data.outAmount && data.swapUsdValue) {
            // Convert raw token amount to actual tokens considering decimals
            const tokensReceivedActual = parseFloat(data.outAmount) / Math.pow(10, decimals);
            
            // Calculate price per token: USD value / actual tokens received
            const pricePerToken = parseFloat(data.swapUsdValue) / tokensReceivedActual;
            log(`Price calculated from Jupiter quote (0.001 SOL, ${decimals} decimals): $${pricePerToken.toFixed(8)} USD per token`);
            return pricePerToken.toFixed(10);
        }
        
        log(`No price data found for ${tokenAddress} from Jupiter`);
        return 0;
    } catch (error) {
        log(`Error getting price for ${tokenAddress}: ${error.message}`);
        return 0;
    }
}

module.exports = {
    convertPrivateKeyToBase58,
    getTokenPrice
};