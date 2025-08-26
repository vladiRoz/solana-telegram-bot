// Mock config data is defined inline in the fs mock below

// Mock all external dependencies BEFORE importing anything
jest.mock('@solana/web3.js', () => ({
    Keypair: {
        fromSecretKey: jest.fn()
    },
    PublicKey: jest.fn(),
    LAMPORTS_PER_SOL: 1000000000,
    VersionedTransaction: {
        deserialize: jest.fn()
    },
    Connection: jest.fn()
}));

jest.mock('fs', () => ({
    readFileSync: jest.fn(() => JSON.stringify({
        excluded_tokens: ['excludedToken123'],
        trading_settings: {
            slippage_bps: 300,
            purchase_amount_sol: 0.01,
            compute_unit_price_micro_lamports: 5000,
            compute_unit_limit: 200000,
            take_profit_percentage: 50
        }
    })),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    appendFileSync: jest.fn(),
    writeFileSync: jest.fn()
}));

jest.mock('path', () => ({
    resolve: jest.fn(() => '/mock/config/path'),
    join: jest.fn((...args) => args.join('/')),
    dirname: jest.fn((p) => p.split('/').slice(0, -1).join('/')),
    basename: jest.fn((p) => p.split('/').pop())
}));

jest.mock('../../utils/utils');
jest.mock('../../utils/logger');
jest.mock('../../utils/tokenState');
jest.mock('cross-fetch');

const SolanaTrader = require('../solanaTrader');
const { convertPrivateKeyToBase58, getTokenPrice } = require('../../utils/utils');
const { log } = require('../../utils/logger');
const tokenState = require('../../utils/tokenState');
const fetch = require('cross-fetch');

describe('SolanaTrader', () => {
    let mockConnection;
    let mockWallet;
    let solanaTrader;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock Solana Web3 objects
        const { Keypair, PublicKey } = require('@solana/web3.js');

        mockWallet = {
            publicKey: {
                toBase58: jest.fn().mockReturnValue('mockPublicKey123')
            },
            secretKey: new Uint8Array(64)
        };

        mockConnection = {
            getBalance: jest.fn(),
            getParsedAccountInfo: jest.fn(),
            getParsedTokenAccountsByOwner: jest.fn(),
            sendRawTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
            getLatestBlockhash: jest.fn(),
            getTransaction: jest.fn(),
            rpcEndpoint: 'https://mock-rpc.com'
        };

        Keypair.fromSecretKey.mockReturnValue(mockWallet);
        PublicKey.mockImplementation((address) => ({ address }));

        // Mock utils
        convertPrivateKeyToBase58.mockReturnValue('mockBase58Key');
        getTokenPrice.mockResolvedValue('0.000001');

        // Mock tokenState
        tokenState.isTokenSold.mockReturnValue(false);
        tokenState.hasPurchasedToken.mockReturnValue(false);
        tokenState.setPurchasedToken.mockImplementation(() => { });
        tokenState.setPriceHistory.mockImplementation(() => { });
        tokenState.getPurchasedToken.mockReturnValue(null);
        tokenState.addToSoldTokens.mockImplementation(() => { });
        tokenState.clearPurchasedToken.mockImplementation(() => { });

        // Mock logger
        log.mockImplementation(() => { });
    });

    describe('Constructor', () => {
        it('should create SolanaTrader instance with valid parameters', () => {
            const trader = new SolanaTrader('mockPrivateKey', mockConnection);

            expect(trader).toBeInstanceOf(SolanaTrader);
            expect(trader.connection).toBe(mockConnection);
            expect(trader.wallet).toBe(mockWallet);
            expect(convertPrivateKeyToBase58).toHaveBeenCalledWith('mockPrivateKey');
            expect(log).toHaveBeenCalledWith('Wallet public key: mockPublicKey123');
        });

        it('should throw error if private key is missing', () => {
            expect(() => {
                new SolanaTrader(null, mockConnection);
            }).toThrow('Private key is required');
        });

        it('should throw error if connection is missing', () => {
            expect(() => {
                new SolanaTrader('mockPrivateKey', null);
            }).toThrow('Solana connection is required');
        });

        it('should throw error if private key conversion fails', () => {
            convertPrivateKeyToBase58.mockImplementation(() => {
                throw new Error('Invalid key format');
            });

            expect(() => {
                new SolanaTrader('invalidKey', mockConnection);
            }).toThrow('Invalid private key. Ensure it is a valid JSON array of numbers.');
        });
    });

    describe('handlePurchase', () => {
        beforeEach(() => {
            solanaTrader = new SolanaTrader('mockPrivateKey', mockConnection);
        });

        it('should skip purchase for excluded tokens', async () => {
            const result = await solanaTrader.handlePurchase('excludedToken123');

            expect(result).toEqual({
                success: false,
                message: 'Token excludedToken123 is excluded.'
            });
        });

        it('should skip purchase for previously sold tokens', async () => {
            tokenState.isTokenSold.mockReturnValue(true);

            const result = await solanaTrader.handlePurchase('soldToken123');

            expect(result).toEqual({
                success: false,
                message: 'Token soldToken123 has been sold before in this session.'
            });
        });

        it('should skip purchase if already holding a token', async () => {
            const mockCurrentToken = {
                tokenAddress: 'currentToken123',
                purchaseTime: '2023-01-01T00:00:00.000Z'
            };

            tokenState.hasPurchasedToken.mockReturnValue(true);
            tokenState.getPurchasedToken.mockReturnValue(mockCurrentToken);

            const result = await solanaTrader.handlePurchase('newToken123');

            expect(result).toEqual({
                success: false,
                message: 'Already holding token: currentToken123',
                currentToken: 'currentToken123',
                purchaseTime: '2023-01-01T00:00:00.000Z'
            });
        });

        it('should fail purchase with insufficient balance', async () => {
            mockConnection.getBalance.mockResolvedValue(5000000); // Less than required

            const result = await solanaTrader.handlePurchase('testToken123');

            expect(result).toEqual({
                success: false,
                message: 'Insufficient SOL balance'
            });
        });

        it('should successfully purchase token', async () => {
            const { VersionedTransaction } = require('@solana/web3.js');

            // Mock sufficient balance
            mockConnection.getBalance.mockResolvedValue(100000000); // 0.1 SOL

            // Mock Jupiter API responses
            const mockQuoteData = {
                outAmount: '1000000',
                priceImpactPct: '0.5'
            };

            const mockSwapResponse = {
                swapTransaction: 'base64TransactionString'
            };

            fetch
                .mockResolvedValueOnce({
                    json: () => Promise.resolve(mockQuoteData)
                })
                .mockResolvedValueOnce({
                    json: () => Promise.resolve(mockSwapResponse)
                });

            // Mock transaction handling
            const mockTransaction = {
                sign: jest.fn(),
                serialize: jest.fn().mockReturnValue(Buffer.from('serialized'))
            };

            VersionedTransaction.deserialize.mockReturnValue(mockTransaction);

            mockConnection.sendRawTransaction.mockResolvedValue('mockSignature123');
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: 'mockBlockhash',
                lastValidBlockHeight: 12345
            });
            mockConnection.confirmTransaction.mockResolvedValue({
                value: { err: null }
            });

            // Mock token balance
            solanaTrader.getTokenBalance = jest.fn().mockResolvedValue(1000000);

            const result = await solanaTrader.handlePurchase('testToken123');

            expect(result).toEqual({
                success: true,
                message: 'Successfully purchased testToken123'
            });

            expect(tokenState.setPurchasedToken).toHaveBeenCalled();
            expect(tokenState.setPriceHistory).toHaveBeenCalled();
        });
    });

    describe('getTokenBalance', () => {
        beforeEach(() => {
            solanaTrader = new SolanaTrader('mockPrivateKey', mockConnection);
        });

        it('should return 0 for token with no accounts', async () => {
            mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
                value: []
            });

            const balance = await solanaTrader.getTokenBalance('testToken123');

            expect(balance).toBe(0);
        });

        it('should return total balance for token with accounts', async () => {
            mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
                value: [
                    {
                        account: {
                            data: {
                                parsed: {
                                    info: {
                                        tokenAmount: {
                                            amount: '1000000'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        account: {
                            data: {
                                parsed: {
                                    info: {
                                        tokenAmount: {
                                            amount: '500000'
                                        }
                                    }
                                }
                            }
                        }
                    }
                ]
            });

            const balance = await solanaTrader.getTokenBalance('testToken123');

            expect(balance).toBe(1500000);
        });

        it('should handle errors and return 0', async () => {
            mockConnection.getParsedTokenAccountsByOwner.mockRejectedValue(
                new Error('Network error')
            );

            const balance = await solanaTrader.getTokenBalance('testToken123');

            expect(balance).toBe(0);
            expect(log).toHaveBeenCalledWith(
                'Error getting token balance for testToken123: Network error',
                true
            );
        });
    });

    describe('handleSell', () => {
        beforeEach(() => {
            solanaTrader = new SolanaTrader('mockPrivateKey', mockConnection);
        });

        it('should fail if no token is currently held', async () => {
            tokenState.getPurchasedToken.mockReturnValue(null);

            const result = await solanaTrader.handleSell('testToken123');

            expect(result).toEqual({
                success: false,
                message: 'Token not found in purchase records'
            });
        });

        it('should fail if trying to sell different token', async () => {
            const mockCurrentToken = {
                tokenAddress: 'differentToken123',
                solAmount: 0.01
            };

            tokenState.getPurchasedToken.mockReturnValue(mockCurrentToken);

            const result = await solanaTrader.handleSell('testToken123');

            expect(result).toEqual({
                success: false,
                message: 'Token not found in purchase records'
            });
        });

        it('should fail if no tokens in wallet', async () => {
            const mockCurrentToken = {
                tokenAddress: 'testToken123',
                solAmount: 0.01
            };

            tokenState.getPurchasedToken.mockReturnValue(mockCurrentToken);
            solanaTrader.getTokenBalance = jest.fn().mockResolvedValue(0);

            const result = await solanaTrader.handleSell('testToken123');

            expect(result).toEqual({
                success: false,
                message: 'No tokens found in wallet'
            });
        });

        it('should successfully sell tokens', async () => {
            const mockCurrentToken = {
                tokenAddress: 'testToken123',
                solAmount: 0.01
            };

            tokenState.getPurchasedToken.mockReturnValue(mockCurrentToken);
            solanaTrader.getTokenBalance = jest.fn().mockResolvedValue(1000000);

            // Mock Jupiter sell quote
            const mockQuoteData = {
                outAmount: '15000000', // 0.015 SOL in lamports
                priceImpactPct: '1.2'
            };

            const mockSwapResponse = {
                swapTransaction: 'base64SellTransactionString'
            };

            fetch
                .mockResolvedValueOnce({
                    json: () => Promise.resolve(mockQuoteData)
                })
                .mockResolvedValueOnce({
                    json: () => Promise.resolve(mockSwapResponse)
                });

            // Mock transaction handling
            const { VersionedTransaction } = require('@solana/web3.js');
            const mockTransaction = {
                sign: jest.fn(),
                serialize: jest.fn().mockReturnValue(Buffer.from('serialized'))
            };

            VersionedTransaction.deserialize.mockReturnValue(mockTransaction);

            mockConnection.sendRawTransaction.mockResolvedValue('sellSignature123');
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: 'mockBlockhash',
                lastValidBlockHeight: 12345
            });
            mockConnection.confirmTransaction.mockResolvedValue({
                value: { err: null }
            });

            const result = await solanaTrader.handleSell('testToken123', 'Test sell');

            expect(result).toEqual({
                success: true,
                message: 'Successfully sold testToken123',
                txid: 'sellSignature123',
                solReceived: 0.015,
                profit: expect.closeTo(0.005, 10),
                profitPercent: 50,
                sellReason: 'Test sell'
            });

            expect(tokenState.addToSoldTokens).toHaveBeenCalledWith('testToken123');
            expect(tokenState.clearPurchasedToken).toHaveBeenCalled();
        });
    });

    describe('verifyTransactionSuccess', () => {
        beforeEach(() => {
            solanaTrader = new SolanaTrader('mockPrivateKey', mockConnection);
        });

        it('should return success for confirmed transaction', async () => {
            mockConnection.getTransaction.mockResolvedValue({
                meta: { err: null }
            });

            solanaTrader.getTokenBalance = jest.fn().mockResolvedValue(1000000);

            const result = await solanaTrader.verifyTransactionSuccess(
                'testSignature123',
                'testToken123',
                500000
            );

            expect(result).toEqual({
                success: true,
                actualBalance: 1000000
            });
        });

        it('should return failure for failed transaction', async () => {
            mockConnection.getTransaction.mockResolvedValue({
                meta: { err: 'Transaction failed' }
            });

            const result = await solanaTrader.verifyTransactionSuccess(
                'testSignature123',
                'testToken123',
                500000
            );

            expect(result).toEqual({
                success: false
            });
        });

        it('should handle errors and return failure', async () => {
            mockConnection.getTransaction.mockRejectedValue(
                new Error('RPC error')
            );

            const result = await solanaTrader.verifyTransactionSuccess(
                'testSignature123',
                'testToken123',
                500000
            );

            expect(result).toEqual({
                success: false
            });
        });
    });
});

