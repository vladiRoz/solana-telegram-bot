// Test utilities for SolanaTrader tests

/**
 * Creates a mock Solana connection object
 */
function createMockConnection() {
    return {
        getBalance: jest.fn(),
        getParsedAccountInfo: jest.fn(),
        getParsedTokenAccountsByOwner: jest.fn(),
        sendRawTransaction: jest.fn(),
        confirmTransaction: jest.fn(),
        getLatestBlockhash: jest.fn(),
        getTransaction: jest.fn(),
        rpcEndpoint: 'https://mock-rpc.com'
    };
}

/**
 * Creates a mock wallet object
 */
function createMockWallet(publicKey = 'mockPublicKey123') {
    return {
        publicKey: {
            toBase58: jest.fn().mockReturnValue(publicKey)
        },
        secretKey: new Uint8Array(64)
    };
}

/**
 * Creates mock Jupiter API responses
 */
function createMockJupiterResponses() {
    return {
        quote: {
            outAmount: '1000000',
            priceImpactPct: '0.5',
            swapUsdValue: '0.01'
        },
        swap: {
            swapTransaction: 'base64TransactionString'
        }
    };
}

/**
 * Creates a mock purchased token object
 */
function createMockPurchasedToken(overrides = {}) {
    return {
        tokenAddress: 'testToken123',
        purchaseTime: '2023-01-01T00:00:00.000Z',
        messageTime: '2023-01-01T00:00:00.000Z',
        purchasePrice: '0.000001',
        tokenAmount: 1000000,
        solAmount: 0.01,
        pricePerTokenUSD: '0.000001',
        ...overrides
    };
}

/**
 * Creates mock token accounts for balance testing
 */
function createMockTokenAccounts(balances = ['1000000']) {
    return {
        value: balances.map(balance => ({
            account: {
                data: {
                    parsed: {
                        info: {
                            tokenAmount: {
                                amount: balance
                            }
                        }
                    }
                }
            }
        }))
    };
}

/**
 * Creates a mock transaction confirmation
 */
function createMockTransactionConfirmation(success = true) {
    return {
        value: {
            err: success ? null : 'Transaction failed'
        }
    };
}

/**
 * Sets up common mocks for SolanaTrader tests
 */
function setupCommonMocks() {
    const { Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const { convertPrivateKeyToBase58, getTokenPrice } = require('../../utils/utils');
    const { log } = require('../../utils/logger');
    const tokenState = require('../../utils/tokenState');
    const fetch = require('cross-fetch');
    
    // Mock Solana Web3
    const mockWallet = createMockWallet();
    Keypair.fromSecretKey.mockReturnValue(mockWallet);
    PublicKey.mockImplementation((address) => ({ address }));
    LAMPORTS_PER_SOL.mockReturnValue(1000000000);
    
    const mockTransaction = {
        sign: jest.fn(),
        serialize: jest.fn().mockReturnValue(Buffer.from('serialized'))
    };
    VersionedTransaction.deserialize.mockReturnValue(mockTransaction);
    
    // Mock utils
    convertPrivateKeyToBase58.mockReturnValue('mockBase58Key');
    getTokenPrice.mockResolvedValue('0.000001');
    
    // Mock tokenState
    tokenState.isTokenSold.mockReturnValue(false);
    tokenState.hasPurchasedToken.mockReturnValue(false);
    tokenState.setPurchasedToken.mockImplementation(() => {});
    tokenState.setPriceHistory.mockImplementation(() => {});
    tokenState.getPurchasedToken.mockReturnValue(null);
    tokenState.addToSoldTokens.mockImplementation(() => {});
    tokenState.clearPurchasedToken.mockImplementation(() => {});
    
    // Mock logger
    log.mockImplementation(() => {});
    
    // Mock fetch
    fetch.mockImplementation(() => Promise.resolve({
        json: () => Promise.resolve({ outAmount: '1000000' })
    }));
    
    return {
        mockWallet,
        mockTransaction
    };
}

module.exports = {
    createMockConnection,
    createMockWallet,
    createMockJupiterResponses,
    createMockPurchasedToken,
    createMockTokenAccounts,
    createMockTransactionConfirmation,
    setupCommonMocks
};

