require("dotenv").config();
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction, ComputeBudgetProgram } = require("@solana/web3.js");
const fetch = require('cross-fetch');
const bs58 = require("bs58");
const fs = require("fs");
const path = require("path");
const { convertPrivateKeyToBase58 } = require("./utils");
const { log } = require("../utils/logger");

// Load config
const configPath = path.resolve(__dirname, "../../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Store purchased token details (only one token at a time)
let purchasedToken = null; // {tokenAddress, purchaseTime, messageTime, purchasePrice, tokenAmount, solAmount}
let priceHistory = []; // Array of {timestamp, price} objects for the current token

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL mint address
const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const PRICE_CHECK_INTERVAL = 10000; // 10 seconds
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

class SolanaTrader {
    constructor() {
        if (!process.env.SOLANA_WALLET_PRIVATE_KEY) {
            throw new Error("SOLANA_WALLET_PRIVATE_KEY is not set in .env file");
        }

        try {
            // Convert the private key from JSON array to base58
            const privateKeyBase58 = convertPrivateKeyToBase58(process.env.SOLANA_WALLET_PRIVATE_KEY);
            
            // Create wallet from base58 private key
            this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
            
            log('Wallet public key: ' + this.wallet.publicKey.toBase58());
        } catch (error) {
            log("Failed to load wallet from private key: " + error.message);
            throw new Error("Invalid SOLANA_WALLET_PRIVATE_KEY. Ensure it is a valid JSON array of numbers.");
        }

        this.connection = new Connection(config.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com", "confirmed");
        log(`Solana Trader initialized. Wallet public key: ${this.wallet.publicKey.toBase58()}`);
        log(`Connected to Solana RPC: ${this.connection.rpcEndpoint}`);
    }

    async handlePurchase(tokenAddress, msg = null) {
        log(`Attempting to handle purchase for token: ${tokenAddress}`);

        if (purchasedToken) {
            log(`Cannot purchase ${tokenAddress}. Already holding token: ${purchasedToken.tokenAddress} since ${purchasedToken.purchaseTime}`);
            return { 
                success: false, 
                message: `Already holding token: ${purchasedToken.tokenAddress}`,
                currentToken: purchasedToken.tokenAddress,
                purchaseTime: purchasedToken.purchaseTime
            };
        }

        const { slippage_bps, purchase_amount_sol, compute_unit_price_micro_lamports, compute_unit_limit } = config.trading_settings;
        const amountToSpendLamports = purchase_amount_sol * LAMPORTS_PER_SOL;

        log(`Attempting to purchase ${tokenAddress} with ${purchase_amount_sol} SOL.`);
        log(`Slippage: ${slippage_bps} bps, Amount (Lamports): ${amountToSpendLamports}`);
        log(`Compute Unit Price (microLamports): ${compute_unit_price_micro_lamports}, Compute Unit Limit: ${compute_unit_limit}`);

        try {
            // Check wallet balance
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

            if (balance < amountToSpendLamports) {
                log(`Insufficient SOL balance to make the purchase. Required: ${amountToSpendLamports}, Available: ${balance}`);
                return { success: false, message: "Insufficient SOL balance" };
            }

            // Get quote from Jupiter
            const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${tokenAddress}&amount=${amountToSpendLamports}&slippageBps=${slippage_bps}`;
            log(`Getting quote from: ${quoteUrl}`);
            
            const quoteResponse = await fetch(quoteUrl);
            const quoteData = await quoteResponse.json();

            log(`Quote response: ${JSON.stringify(quoteData)}`);

            if (quoteData.error || !quoteData.outAmount) {
                log(`No routes found for swapping to ${tokenAddress}. Error: ${quoteData.error || 'Unknown error'}`);
                return { success: false, message: `No swap routes found: ${quoteData.error || 'Unknown error'}` };
            }

            log(`Best route found with price impact: ${quoteData.priceImpactPct}%`);
            log(`Expected output amount: ${quoteData.outAmount}`);

            // Get swap transaction with priority fee settings
            const swapResponse = await fetch(`${JUPITER_API_BASE}/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    // quoteResponse from /quote api
                    quoteResponse: quoteData,
                    // user public key to be used for the swap
                    userPublicKey: this.wallet.publicKey.toString(),
                    // auto wrap and unwrap SOL. default is true
                    wrapAndUnwrapSol: true,
                    // Add dynamic compute limit and priority fee for better success rate
                    // dynamicComputeUnitLimit: true,
                    // prioritizationFeeLamports: {
                    //     priorityLevelWithMaxLamports: {
                    //         maxLamports: 10000000,
                    //         priorityLevel: "veryHigh"
                    //     }
                    // }
                })
            });
            
            const { swapTransaction } = await swapResponse.json();
            
            if (!swapTransaction) {
                log('Failed to get swap transaction');
                return { success: false, message: "Failed to get swap transaction" };
            }

            // Deserialize the transaction
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            log('Transaction deserialized successfully');

            // Sign the transaction - using the correct method from Jupiter docs
            transaction.sign([this.wallet]);
            log('Transaction signed successfully');

            // Get the latest block hash before sending
            const latestBlockHash = await this.connection.getLatestBlockhash();

            // Execute the transaction
            log('Sending transaction...');
            const rawTransaction = transaction.serialize();
            const signature = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });
            
            log(`Transaction sent with signature: ${signature}`);
            
            // Wait for confirmation using the proper method from Jupiter docs
            const confirmation = await this.connection.confirmTransaction({
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                signature: signature
            });

            log(`Purchase transaction confirmed: ${JSON.stringify(confirmation)}`);

            // Check if transaction actually succeeded
            if (confirmation.value.err) {
                log(`Purchase transaction failed with error: ${JSON.stringify(confirmation.value.err)}`);
                return { 
                    success: false, 
                    message: `Purchase transaction failed: ${JSON.stringify(confirmation.value.err)}`,
                    txid: signature,
                    error: confirmation.value.err
                };
            }

            log(`Swap successful! Transaction signature: ${signature}`);
            log(`View transaction: https://solscan.io/tx/${signature}`);
            
            // Get initial price for tracking
            const initialPrice = await this.getTokenPrice(tokenAddress);
            
            // Record the purchase
            const purchaseTime = new Date();
            const messageTime = msg && msg.date ? new Date(msg.date * 1000) : purchaseTime;
            
            purchasedToken = {
                tokenAddress,
                purchaseTime: purchaseTime.toISOString(),
                messageTime: messageTime.toISOString(),
                purchasePrice: initialPrice,
                tokenAmount: quoteData.outAmount,
                solAmount: purchase_amount_sol
            };
            
            // Initialize price history with purchase price
            priceHistory = [{
                timestamp: purchaseTime.toISOString(),
                price: initialPrice
            }];
            
            log(`Token ${tokenAddress} purchased at ${purchaseTime.toISOString()}`);
            log(`Message received at: ${messageTime.toISOString()}`);
            log(`Initial price: ${initialPrice}`);
            
            return { 
                success: true, 
                message: `Successfully purchased ${tokenAddress}`,
                purchaseTime: purchaseTime.toISOString(),
                txid: signature,
                outAmount: quoteData.outAmount
            };

        } catch (error) {
            log(`Error during purchase of ${tokenAddress}: ${error.message || error.toString() || JSON.stringify(error)}`);
            log(`Full error object: ${JSON.stringify(error, null, 2)}`);
            return { 
                success: false, 
                message: `Purchase failed for ${tokenAddress}: ${error.message || error.toString() || 'Unknown error'}` 
            };
        }
    }

    async handleSell(tokenAddress, sellReason = "Manual") {
        log(`Attempting to sell token: ${tokenAddress} (Reason: ${sellReason})`);

        if (!purchasedToken || purchasedToken.tokenAddress !== tokenAddress) {
            log(`Token ${tokenAddress} was not purchased by this bot. Skipping sell.`);
            return { success: false, message: "Token not found in purchase records" };
        }

        const { slippage_bps, compute_unit_price_micro_lamports, compute_unit_limit } = config.trading_settings;

        try {
            // Use the actual token amount from purchase (not floored, keep full precision)
            const tokenAmount = purchasedToken.tokenAmount;
            
            log(`Attempting to sell ${tokenAmount} tokens of ${tokenAddress}`);

            // Get quote for selling token back to SOL
            const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=${tokenAmount}&slippageBps=${slippage_bps}`;
            log(`Getting sell quote from: ${quoteUrl}`);
            
            const quoteResponse = await fetch(quoteUrl);
            const quoteData = await quoteResponse.json();

            log(`Sell quote response: ${JSON.stringify(quoteData)}`);

            if (quoteData.error || !quoteData.outAmount) {
                log(`No routes found for selling ${tokenAddress}. Error: ${quoteData.error || 'Unknown error'}`);
                return { success: false, message: `No sell routes found: ${quoteData.error || 'Unknown error'}` };
            }

            log(`Best sell route found with price impact: ${quoteData.priceImpactPct}%`);
            log(`Sell quote - SOL output: ${quoteData.outAmount / 1000000000} SOL`);

            // Get swap transaction with priority fee settings
            const swapResponse = await fetch(`${JUPITER_API_BASE}/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    // quoteResponse from /quote api
                    quoteResponse: quoteData,
                    // user public key to be used for the swap
                    userPublicKey: this.wallet.publicKey.toString(),
                    // auto wrap and unwrap SOL. default is true
                    wrapAndUnwrapSol: true,
                    // Add dynamic compute limit and priority fee for better success rate
                    dynamicComputeUnitLimit: true,
                    prioritizationFeeLamports: {
                        priorityLevelWithMaxLamports: {
                            maxLamports: 2780000,  // ~$0.50 at current SOL prices
                            priorityLevel: "veryHigh"
                        }
                    }
                })
            });
            
            const { swapTransaction } = await swapResponse.json();
            
            if (!swapTransaction) {
                log('Failed to get sell swap transaction');
                return { success: false, message: "Failed to get sell swap transaction" };
            }

            // Deserialize the transaction
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            log('Sell transaction deserialized successfully');

            // Sign the transaction - using the correct method from Jupiter docs
            transaction.sign([this.wallet]);
            log('Sell transaction signed successfully');

            // Get the latest block hash before sending
            const latestBlockHash = await this.connection.getLatestBlockhash();

            // Execute the sell transaction
            log('Sending sell transaction...');
            const rawTransaction = transaction.serialize();
            const signature = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });
            
            log(`Sell transaction sent with signature: ${signature}`);
            
            // Wait for confirmation using the proper method from Jupiter docs
            const confirmation = await this.connection.confirmTransaction({
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                signature: signature
            });

            log(`Sell transaction confirmed: ${JSON.stringify(confirmation)}`);

            // Check if transaction actually succeeded
            if (confirmation.value.err) {
                log(`Sell transaction failed with error: ${JSON.stringify(confirmation.value.err)}`);
                return { 
                    success: false, 
                    message: `Sell transaction failed: ${JSON.stringify(confirmation.value.err)}`,
                    txid: signature,
                    error: confirmation.value.err
                };
            }

            // Calculate profit/loss
            const solReceived = quoteData.outAmount / 1000000000;
            const profit = solReceived - purchasedToken.solAmount;
            const profitPercent = ((solReceived / purchasedToken.solAmount) - 1) * 100;

            log(`Sell successful! Transaction signature: ${signature}`);
            log(`SOL received: ${solReceived}, Profit: ${profit} SOL (${profitPercent.toFixed(2)}%)`);
            log(`View transaction: https://solscan.io/tx/${signature}`);
            
            // Remove from tracking only if transaction was successful
            purchasedToken = null;
            priceHistory = []; // Clear price history
            
            return { 
                success: true, 
                message: `Successfully sold ${tokenAddress}`,
                txid: signature,
                solReceived,
                profit,
                profitPercent,
                sellReason
            };

        } catch (error) {
            log(`Error during sell of ${tokenAddress}: ${error.message || error.toString() || JSON.stringify(error)}`);
            return { 
                success: false, 
                message: `Sell failed for ${tokenAddress}: ${error.message || error.toString() || 'Unknown error'}` 
            };
        }
    }

    async getTokenPrice(tokenAddress) {
        try {
            const response = await fetch(`${BIRDEYE_API_BASE}/public/price?address=${tokenAddress}`);
            const data = await response.json();
            return data.data?.value || 0;
        } catch (error) {
            log(`Error getting price for ${tokenAddress}: ${error.message}`);
            return 0;
        }
    }

    getPriceAtTime(minutesAgo) {
        if (priceHistory.length === 0) return 0;
        
        const targetTime = new Date(Date.now() - minutesAgo * 60 * 1000);
        
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

    decideSell(currentPrice, capital) {
        if (!purchasedToken || priceHistory.length === 0) {
            return { sellAt: "no data", returnRate: 0, finalCapital: 0 };
        }

        // Get prices at different time intervals
        const price5m = this.getPriceAtTime(5);
        const price10m = this.getPriceAtTime(10);
        const price20m = this.getPriceAtTime(20);
        
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

    async startTokenMonitoring() {
        log('Starting token monitoring...');
        
        setInterval(async () => {
            try {
                if (purchasedToken) {
                    const currentPrice = await this.getTokenPrice(purchasedToken.tokenAddress);
                    
                    if (currentPrice === 0) return;

                    // Add current price to history
                    const now = new Date().toISOString();
                    priceHistory.push({
                        timestamp: now,
                        price: currentPrice
                    });

                    // Keep only last 2 hours of data (720 entries at 10-second intervals)
                    if (priceHistory.length > 720) {
                        priceHistory = priceHistory.slice(-720);
                    }

                    // Quick sell check: 50% gain
                    const priceRatio = currentPrice / purchasedToken.purchasePrice;
                    if (priceRatio >= 1.5) {
                        log(`Quick sell triggered for ${purchasedToken.tokenAddress} - 50%+ gain detected (${((priceRatio - 1) * 100).toFixed(2)}%)`);
                        await this.handleSell(purchasedToken.tokenAddress, "Quick sell - 50% gain");
                        return;
                    }

                    // Strategic sell check using tracked price history
                    const sellDecision = this.decideSell(currentPrice, purchasedToken.solAmount);
                    
                    if (sellDecision.sellAt !== "hold") {
                        log(`Strategic sell triggered for ${purchasedToken.tokenAddress} - ${sellDecision.sellAt} (${((sellDecision.returnRate - 1) * 100).toFixed(2)}% return)`);
                        await this.handleSell(purchasedToken.tokenAddress, `Strategic sell - ${sellDecision.sellAt}`);
                    }
                }
            } catch (error) {
                log(`Error in token monitoring: ${error.message}`);
            }
        }, PRICE_CHECK_INTERVAL);
    }

    // Helper method to get purchase time for a token
    getPurchaseTime(tokenAddress) {
        return purchasedToken && purchasedToken.tokenAddress === tokenAddress ? purchasedToken.purchaseTime : null;
    }

    // Helper method to get current purchased token
    getCurrentToken() {
        return purchasedToken;
    }

    // Helper method to check if we have a token
    hasToken() {
        return purchasedToken !== null;
    }

    // Helper method to get token address if we have one
    getCurrentTokenAddress() {
        return purchasedToken ? purchasedToken.tokenAddress : null;
    }

    // Method to manually sell current token
    async sellCurrentToken(reason = "Manual") {
        if (!purchasedToken) {
            log("No token to sell");
            return { success: false, message: "No token currently held" };
        }
        return await this.handleSell(purchasedToken.tokenAddress, reason);
    }

    // Method to set purchased token (for testing purposes only)
    setPurchasedToken(tokenData) {
        purchasedToken = tokenData;
        log(`Purchased token set: ${JSON.stringify(tokenData, null, 2)}`);
    }

    // Method to get the full purchased token object
    getPurchasedTokenObject() {
        return purchasedToken;
    }
}

module.exports = SolanaTrader;

