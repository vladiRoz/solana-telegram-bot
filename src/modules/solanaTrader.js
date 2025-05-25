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

// Store purchased tokens with their purchase timestamps
const purchasedTokens = new Map(); // Map<tokenAddress, purchaseTimestamp>

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL mint address
const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';

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

    async handlePurchase(tokenAddress) {
        log(`Attempting to handle purchase for token: ${tokenAddress}`);

        if (purchasedTokens.has(tokenAddress)) {
            const purchaseTime = new Date(purchasedTokens.get(tokenAddress));
            log(`Token ${tokenAddress} was already purchased at ${purchaseTime.toISOString()}. Skipping.`);
            return { 
                success: false, 
                message: "Token already purchased",
                purchaseTime: purchaseTime.toISOString()
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

            // Get swap transaction
            const { swapTransaction } = await (
                await fetch(`${JUPITER_API_BASE}/swap`, {
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
                        wrapAndUnwrapSol: true
                    })
                })
            ).json();
            
            if (!swapTransaction) {
                log('Failed to get swap transaction');
                return { success: false, message: "Failed to get swap transaction" };
            }

            // Deserialize and sign the transaction
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            log('Transaction deserialized successfully');

            // Sign the transaction
            transaction.sign([this.wallet]);
            log('Transaction signed successfully');

            // Execute the transaction
            log('Sending transaction...');
            const rawTransaction = transaction.serialize();
            const signature = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });
            
            log(`Transaction sent with signature: ${signature}`);
            
            // Wait for confirmation - simplified approach from Jupiter docs
            const latestBlockHash = await this.connection.getLatestBlockhash();
            await this.connection.confirmTransaction({
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                signature: signature
            });

            log(`Swap successful! Transaction signature: ${signature}`);
            log(`View transaction: https://solscan.io/tx/${signature}`);
            
            // Record the purchase
            const purchaseTime = new Date();
            purchasedTokens.set(tokenAddress, purchaseTime.toISOString());
            log(`Token ${tokenAddress} purchased at ${purchaseTime.toISOString()}`);
            
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

    // Helper method to get purchase time for a token
    getPurchaseTime(tokenAddress) {
        return purchasedTokens.get(tokenAddress);
    }

    // Helper method to get all purchased tokens with their times
    getAllPurchasedTokens() {
        return Object.fromEntries(purchasedTokens);
    }
}

module.exports = SolanaTrader;

