require("dotenv").config();
const { Connection, Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } = require("@solana/web3.js");
const bs58 = require("bs58");
const { log } = require("console");
const fs = require("fs");
const path = require("path");
const { convertPrivateKeyToBase58 } = require("./utils");

// Load config
const configPath = path.resolve(__dirname, "../../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Store purchased tokens with their purchase timestamps
const purchasedTokens = new Map(); // Map<tokenAddress, purchaseTimestamp>

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
            
            console.log('Wallet public key:', this.wallet.publicKey.toBase58());
        } catch (error) {
            console.error("Failed to load wallet from private key:", error.message);
            throw new Error("Invalid SOLANA_WALLET_PRIVATE_KEY. Ensure it is a valid JSON array of numbers.");
        }

        this.connection = new Connection(config.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com", "confirmed");
        console.log(`Solana Trader initialized. Wallet public key: ${this.wallet.publicKey.toBase58()}`);
        console.log(`Connected to Solana RPC: ${this.connection.rpcEndpoint}`);
    }

    async handlePurchase(tokenAddress) {
        console.log(`Attempting to handle purchase for token: ${tokenAddress}`);

        if (purchasedTokens.has(tokenAddress)) {
            const purchaseTime = new Date(purchasedTokens.get(tokenAddress));
            console.log(`Token ${tokenAddress} was already purchased at ${purchaseTime.toISOString()}. Skipping.`);
            return { 
                success: false, 
                message: "Token already purchased",
                purchaseTime: purchaseTime.toISOString()
            };
        }

        const { slippage_bps, purchase_amount_sol, compute_unit_price_micro_lamports, compute_unit_limit } = config.trading_settings;
        const amountToSpendLamports = purchase_amount_sol * LAMPORTS_PER_SOL;

        console.log(`Attempting to purchase ${tokenAddress} with ${purchase_amount_sol} SOL.`);
        console.log(`Slippage: ${slippage_bps} bps, Amount (Lamports): ${amountToSpendLamports}`);
        console.log(`Compute Unit Price (microLamports): ${compute_unit_price_micro_lamports}, Compute Unit Limit: ${compute_unit_limit}`);

        // SIMULATED PURCHASE LOGIC
        // Actual token purchase on a DEX (e.g., Raydium, Jupiter) is complex and requires:
        // 1. Finding the liquidity pool for SOL and the token.
        // 2. Calculating amounts based on current price and slippage.
        // 3. Building a swap transaction using the DEX's SDK or program ID and instruction layout.
        // 4. Signing and sending the transaction.
        // This is beyond a simple script without specific DEX SDKs and more detailed setup.
        // For this implementation, we will simulate the purchase by logging the intent
        // and assuming the purchase would be successful if this were a real trading bot with DEX integration.

        try {
            // Placeholder for actual DEX interaction logic
            console.log(`[SIMULATION] Checking wallet balance for ${this.wallet.publicKey.toBase58()}...`);
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            console.log(`[SIMULATION] Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

            if (balance < amountToSpendLamports) {
                console.error(`[SIMULATION] Insufficient SOL balance to make the purchase. Required: ${amountToSpendLamports}, Available: ${balance}`);
                return { success: false, message: "Insufficient SOL balance (simulated check)" };
            }

            // Example: A simple (non-functional for token swap) transaction to demonstrate structure
            const transaction = new Transaction();
            
            // Add compute budget instructions if specified
            if (compute_unit_price_micro_lamports && compute_unit_price_micro_lamports > 0) {
                transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: compute_unit_price_micro_lamports }));
            }
            if (compute_unit_limit && compute_unit_limit > 0) {
                transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: compute_unit_limit }));
            }

            // transaction.add(
            //     SystemProgram.transfer({
            //         fromPubkey: this.wallet.publicKey,
            //         toPubkey: new PublicKey(tokenAddress), // This is incorrect for a swap, just a placeholder
            //         lamports: 1000, // Sending a tiny amount of lamports, not SOL for token
            //     })
            // );
            // console.log("[SIMULATION] Building a placeholder transaction (not a real swap).");
            // const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.wallet]);
            // console.log(`[SIMULATION] Placeholder transaction successful with signature: ${signature}`);
            
            console.log(`[SIMULATION] Purchase of token ${tokenAddress} for ${purchase_amount_sol} SOL would be executed here.`);
            console.log(`[SIMULATION] Parameters: Slippage ${slippage_bps}bps.`);
            
            // If simulation is considered a success:
            const purchaseTime = new Date();
            purchasedTokens.set(tokenAddress, purchaseTime.toISOString());
            console.log(`Token ${tokenAddress} marked as purchased (simulated) at ${purchaseTime.toISOString()}.`);
            
            return { 
                success: true, 
                message: `Simulated purchase of ${tokenAddress} successful.`,
                purchaseTime: purchaseTime.toISOString()
            };

        } catch (error) {
            console.error(`[SIMULATION] Error during simulated purchase of ${tokenAddress}:`, error.message);
            return { 
                success: false, 
                message: `Simulated purchase failed for ${tokenAddress}: ${error.message}` 
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

