require("dotenv").config();
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } = require("@solana/web3.js");
const fetch = require('cross-fetch');
const bs58 = require("bs58");
const fs = require("fs");
const path = require("path");
const { convertPrivateKeyToBase58, getTokenPrice } = require("../utils/utils");
const { log } = require("../utils/logger");
const { SOL_MINT, JUPITER_API_BASE } = require("../utils/consts");
const tokenState = require("../utils/tokenState");

// Load config
const configPath = path.resolve(__dirname, "../../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
class SolanaTrader {
    constructor(privateKey) {
        if (!privateKey) {
            throw new Error("Private key is required");
        }

        try {
            // Convert the private key from JSON array to base58
            const privateKeyBase58 = convertPrivateKeyToBase58(privateKey);
            
            // Create wallet from base58 private key
            this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
            
            log('Wallet public key: ' + this.wallet.publicKey.toBase58());
        } catch (error) {
            log("Failed to load wallet from private key: " + error.message);
            throw new Error("Invalid private key. Ensure it is a valid JSON array of numbers.");
        }

        this.connection = new Connection(config.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com", "confirmed");
        log(`Solana Trader initialized. Wallet public key: ${this.wallet.publicKey.toBase58()}`);
        log(`Connected to Solana RPC: ${this.connection.rpcEndpoint}`);
    }

    async handlePurchase(tokenAddress, msg = null) {
        log(`Attempting to handle purchase for token: ${tokenAddress}`, true);

        if (config.excluded_tokens && config.excluded_tokens.includes(tokenAddress)) {
            log(`Token ${tokenAddress} is in the exclusion list. Skipping purchase.`, true);
            return {
                success: false,
                message: `Token ${tokenAddress} is excluded.`
            };
        }

        if (tokenState.isTokenSold(tokenAddress)) {
            log(`Token ${tokenAddress} has been sold before in this session. Skipping purchase.`, true);
            return {
                success: false,
                message: `Token ${tokenAddress} has been sold before in this session.`
            };
        }

        if (tokenState.hasPurchasedToken()) {
            const currentToken = tokenState.getPurchasedToken();
            log(`Cannot purchase ${tokenAddress}. Already holding token: ${currentToken.tokenAddress} since ${currentToken.purchaseTime}`, true);
            return { 
                success: false, 
                message: `Already holding token: ${currentToken.tokenAddress}`,
                currentToken: currentToken.tokenAddress,
                purchaseTime: currentToken.purchaseTime
            };
        }

        const { slippage_bps, purchase_amount_sol, compute_unit_price_micro_lamports, compute_unit_limit } = config.trading_settings;
        const amountToSpendLamports = purchase_amount_sol * LAMPORTS_PER_SOL;

        log(`Attempting to purchase ${tokenAddress} with ${purchase_amount_sol} SOL.`, true);
        log(`Slippage: ${slippage_bps} bps, Amount (Lamports): ${amountToSpendLamports}`, true);
        log(`Compute Unit Price (microLamports): ${compute_unit_price_micro_lamports}, Compute Unit Limit: ${compute_unit_limit}`, true);

        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            log(`Purchase attempt ${attempt}/${maxRetries + 1} for token: ${tokenAddress}`, true);
            try {
                // Check wallet balance
                const balance = await this.connection.getBalance(this.wallet.publicKey);
                log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`, true);

                if (balance < amountToSpendLamports) {
                    log(`Insufficient SOL balance to make the purchase. Required: ${amountToSpendLamports}, Available: ${balance}`, true);
                    return { success: false, message: "Insufficient SOL balance" };
                }

                // Get quote from Jupiter
                const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${tokenAddress}&amount=${amountToSpendLamports}&slippageBps=${slippage_bps}`;
                log(`Getting quote from: ${quoteUrl}`, true);
                
                const quoteResponse = await fetch(quoteUrl);
                const quoteData = await quoteResponse.json();

                log(`Quote response: ${JSON.stringify(quoteData)}`, true);

                if (quoteData.error || !quoteData.outAmount) {
                    log(`No routes found for swapping to ${tokenAddress}. Error: ${quoteData.error || 'Unknown error'}`, true);
                    // This is a permanent error for this attempt, so we can continue to the next retry
                    if (attempt <= maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // wait before retrying
                        continue;
                    } else {
                         return { success: false, message: `No swap routes found: ${quoteData.error || 'Unknown error'}` };
                    }
                }

                log(`Best route found with price impact: ${quoteData.priceImpactPct}%`, true);
                log(`Expected output amount: ${quoteData.outAmount}`, true);
                
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
                    })
                });
                
                const { swapTransaction } = await swapResponse.json();
                
                if (!swapTransaction) {
                    log('Failed to get swap transaction', true);
                     if (attempt <= maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // wait before retrying
                        continue;
                    } else {
                        return { success: false, message: "Failed to get swap transaction" };
                    }
                }

                // Deserialize the transaction
                const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
                const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
                log('Transaction deserialized successfully', true);

                // Sign the transaction - using the correct method from Jupiter docs
                transaction.sign([this.wallet]);
                log('Transaction signed successfully', true);

                // Get the latest block hash before sending
                const latestBlockHash = await this.connection.getLatestBlockhash();

                // Execute the transaction
                log('Sending transaction...', true);
                const rawTransaction = transaction.serialize();
                const signature = await this.connection.sendRawTransaction(rawTransaction, {
                    skipPreflight: true,
                    maxRetries: 2
                });
                
                log(`Transaction sent with signature: ${signature}`, true);
                
                // Wait for confirmation using the proper method from Jupiter docs
                const confirmation = await this.connection.confirmTransaction({
                    blockhash: latestBlockHash.blockhash,
                    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                    signature: signature
                });

                log(`Purchase transaction confirmed: ${JSON.stringify(confirmation)}`, true);

                // Check if transaction actually succeeded
                if (confirmation.value.err) {
                    log(`Purchase transaction failed with error: ${JSON.stringify(confirmation.value.err)}`, true);
                     if (attempt <= maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // wait before retrying
                        continue;
                    } else {
                        return { 
                            success: false, 
                            message: `Purchase transaction failed: ${JSON.stringify(confirmation.value.err)}`,
                            txid: signature,
                            error: confirmation.value.err
                        };
                    }
                }

                log(`Swap successful! Transaction signature: ${signature}`, true);
                log(`View transaction: https://solscan.io/tx/${signature}`, true);
                
                // Get initial price for tracking
                const initialPrice = await getTokenPrice(tokenAddress, this.connection);

                // Check actual received amount vs expected
                const actualBalance = await this.getTokenBalance(tokenAddress);
                log(`Expected token amount: ${quoteData.outAmount}`, true);
                log(`Actual token balance after purchase: ${actualBalance}`, true);
                
                // Record the purchase
                const purchaseTime = new Date();
                const messageTime = msg && msg.date ? new Date(msg.date * 1000) : purchaseTime;
                
                const purchasedTokenData = {
                    tokenAddress,
                    purchaseTime: purchaseTime.toISOString(),
                    messageTime: messageTime.toISOString(),
                    purchasePrice: initialPrice,
                    tokenAmount: actualBalance, // Use actual balance instead of quote amount
                    solAmount: purchase_amount_sol,
                    pricePerTokenUSD: initialPrice
                };
                tokenState.setPurchasedToken(purchasedTokenData);
                
                // Initialize price history with purchase price
                tokenState.setPriceHistory([{
                    timestamp: purchaseTime.toISOString(),
                    price: initialPrice
                }]);
                
                log(`Token ${tokenAddress} purchased at ${purchaseTime.toISOString()}`, true);
                log(`Message received at: ${messageTime.toISOString()}`, true);
                log(`Purchase price: $${initialPrice} USD per token`, true);
                
                return { 
                    success: true, 
                    message: `Successfully purchased ${tokenAddress}`,
                    purchaseTime: purchaseTime.toISOString(),
                    txid: signature,
                    outAmount: quoteData.outAmount
                };

            } catch (error) {
                log(`Error during purchase attempt ${attempt} for ${tokenAddress}: ${error.message || error.toString() || JSON.stringify(error)}`, true);
                log(`Full error object on attempt ${attempt}: ${JSON.stringify(error, null, 2)}`, true);
                
                // Check if this is a timeout error but transaction might have succeeded
                const isTimeoutError = error.message && (
                    error.message.includes('block height exceeded') ||
                    error.message.includes('has expired') ||
                    error.message.includes('timeout') ||
                    error.message.includes('Transaction was not confirmed')
                );
                
                if (isTimeoutError && error.signature) {
                    log(`Timeout error detected, verifying if transaction actually succeeded...`, true);
                    
                    // Wait a moment for the transaction to settle
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    const verification = await this.verifyTransactionSuccess(error.signature, tokenAddress, 0);
                    
                    if (verification.success) {
                        log(`Transaction actually succeeded despite timeout! Treating as successful purchase.`, true);
                        
                        // Get initial price for tracking
                        const initialPrice = await getTokenPrice(tokenAddress, this.connection);
                        
                        // Record the purchase
                        const purchaseTime = new Date();
                        const messageTime = msg && msg.date ? new Date(msg.date * 1000) : purchaseTime;
                        
                        const purchasedTokenData = {
                            tokenAddress,
                            purchaseTime: purchaseTime.toISOString(),
                            messageTime: messageTime.toISOString(),
                            purchasePrice: initialPrice,
                            tokenAmount: verification.actualBalance,
                            solAmount: purchase_amount_sol
                        };
                        tokenState.setPurchasedToken(purchasedTokenData);
                        
                        // Initialize price history with purchase price
                        tokenState.setPriceHistory([{
                            timestamp: purchaseTime.toISOString(),
                            price: initialPrice
                        }]);
                        
                        log(`Token ${tokenAddress} purchased at ${purchaseTime.toISOString()} (verified after timeout)`, true);
                        log(`View transaction: https://solscan.io/tx/${error.signature}`, true);
                        
                        return { 
                            success: true, 
                            message: `Successfully purchased ${tokenAddress} (verified after timeout)`,
                            purchaseTime: purchaseTime.toISOString(),
                            txid: error.signature,
                            outAmount: verification.actualBalance
                        };
                    }
                }
                
                if (attempt > maxRetries) {
                    log(`All ${maxRetries + 1} purchase attempts failed for ${tokenAddress}.`, true);
                    return { 
                        success: false, 
                        message: `Purchase failed for ${tokenAddress}: ${error.message || error.toString() || 'Unknown error'}` 
                    };
                }

                log(`Waiting 2 seconds before retry...`, true);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        return { 
            success: false, 
            message: `Purchase failed for ${tokenAddress} after all retries.` 
        };
    }

    async getTokenBalance(tokenAddress) {
        try {
            // Get all token accounts for the wallet
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey,
                { mint: new PublicKey(tokenAddress) }
            );
            
            if (tokenAccounts.value.length === 0) {
                log(`No token accounts found for ${tokenAddress}`, true);
                return 0;
            }
            
            let totalBalance = 0;
            for (const account of tokenAccounts.value) {
                const balance = account.account.data.parsed.info.tokenAmount.amount;
                totalBalance += parseInt(balance);
            }
            
            log(`Current wallet balance for ${tokenAddress}: ${totalBalance}`, true);
            return totalBalance;
        } catch (error) {
            log(`Error getting token balance for ${tokenAddress}: ${error.message}`, true);
            return 0;
        }
    }

    async handleSell(tokenAddress, sellReason = "Manual") {
        log(`Attempting to sell token: ${tokenAddress} (Reason: ${sellReason})`, true);

        const currentToken = tokenState.getPurchasedToken();
        if (!currentToken || currentToken.tokenAddress !== tokenAddress) {
            log(`Token ${tokenAddress} was not purchased by this bot. Skipping sell.`, true);
            return { success: false, message: "Token not found in purchase records" };
        }

        const { slippage_bps, compute_unit_price_micro_lamports, compute_unit_limit } = config.trading_settings;

        try {
            // Get the current actual token balance (sell ALL tokens we have)
            const currentTokenBalance = await this.getTokenBalance(tokenAddress);
            
            if (currentTokenBalance === 0) {
                log(`No tokens found in wallet for ${tokenAddress}. Nothing to sell.`, true);
                return { success: false, message: "No tokens found in wallet" };
            }
            
            log(`Current token balance: ${currentTokenBalance}, selling ALL tokens`, true);

            // Get quote for selling ALL tokens back to SOL
            const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=${currentTokenBalance}&slippageBps=${slippage_bps}`;
            log(`Getting sell quote from: ${quoteUrl}`, true);
            
            const quoteResponse = await fetch(quoteUrl);
            const quoteData = await quoteResponse.json();

            log(`Sell quote response: ${JSON.stringify(quoteData)}`, true);

            if (quoteData.error || !quoteData.outAmount) {
                log(`No routes found for selling ${tokenAddress}. Error: ${quoteData.error || 'Unknown error'}`, true);
                return { success: false, message: `No sell routes found: ${quoteData.error || 'Unknown error'}` };
            }

            log(`Best sell route found with price impact: ${quoteData.priceImpactPct}%`, true);

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
                log('Failed to get sell swap transaction', true);
                return { success: false, message: "Failed to get sell swap transaction" };
            }

            // Deserialize the transaction
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            log('Sell transaction deserialized successfully', true);

            // Sign the transaction - using the correct method from Jupiter docs
            transaction.sign([this.wallet]);
            log('Sell transaction signed successfully', true);

            // Get the latest block hash before sending
            const latestBlockHash = await this.connection.getLatestBlockhash();

            // Execute the sell transaction
            log('Sending sell transaction...', true);
            const rawTransaction = transaction.serialize();
            const signature = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });
            
            log(`Sell transaction sent with signature: ${signature}`, true);
            
            // Wait for confirmation using the proper method from Jupiter docs
            const confirmation = await this.connection.confirmTransaction({
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                signature: signature
            });

            log(`Sell transaction confirmed: ${JSON.stringify(confirmation)}`, true);

            // Check if transaction actually succeeded
            if (confirmation.value.err) {
                log(`Sell transaction failed with error: ${JSON.stringify(confirmation.value.err)}`, true);
                return { 
                    success: false, 
                    message: `Sell transaction failed: ${JSON.stringify(confirmation.value.err)}`,
                    txid: signature,
                    error: confirmation.value.err
                };
            }

            // Calculate profit/loss
            const solReceived = quoteData.outAmount / 1000000000;
            const profit = solReceived - currentToken.solAmount;
            const profitPercent = ((solReceived / currentToken.solAmount) - 1) * 100;

            log(`Sell successful! Transaction signature: ${signature}`, true);
            log(`SOL received: ${solReceived}, Profit: ${profit} SOL (${profitPercent.toFixed(2)}%)`, true);
            log(`View transaction: https://solscan.io/tx/${signature}`, true);
            
            // Add to in-memory sold tokens list to prevent re-buying during this session
            tokenState.addToSoldTokens(tokenAddress);
            log(`Added ${tokenAddress} to the session's sold tokens list. It will not be purchased again.`, true);
            
            // Remove from tracking only if transaction was successful
            tokenState.clearPurchasedToken();
            
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
            log(`Error during sell of ${tokenAddress}: ${error.message || error.toString() || JSON.stringify(error)}`, true);
            return { 
                success: false, 
                message: `Sell failed for ${tokenAddress}: ${error.message || error.toString() || 'Unknown error'}` 
            };
        }
    }

    async verifyTransactionSuccess(signature, tokenAddress, expectedMinAmount = 0) {
        try {
            log(`Verifying transaction success for signature: ${signature}`, true);
            
            // Get transaction details from RPC
            const txDetails = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (txDetails && !txDetails.meta.err) {
                log(`Transaction ${signature} was successful on-chain`, true);
                
                // Also check if we received the tokens
                const actualBalance = await this.getTokenBalance(tokenAddress);
                if (actualBalance > expectedMinAmount) {
                    log(`Token balance confirmed: ${actualBalance}`, true);
                    return { success: true, actualBalance };
                }
            }
            
            return { success: false };
        } catch (error) {
            log(`Error verifying transaction: ${error.message}`, true);
            return { success: false };
        }
    }
}

module.exports = SolanaTrader;

