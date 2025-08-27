const fs = require('fs');

// Mock telegram session before any imports
jest.mock('telegram/sessions', () => ({
  StringSession: jest.fn().mockImplementation(() => ({
    save: jest.fn().mockReturnValue('mock-session-string')
  }))
}));

// Mock telegram client
jest.mock('telegram', () => ({
  TelegramClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    start: jest.fn(),
    addEventHandler: jest.fn(),
    getEntity: jest.fn(),
    getMessages: jest.fn(),
    getDialogs: jest.fn(),
    disconnect: jest.fn(),
    session: {
      save: jest.fn().mockReturnValue('mock-session-string')
    }
  }))
}));

// Mock input
jest.mock('input', () => ({
  text: jest.fn()
}));

// Mock cross-fetch
jest.mock('cross-fetch', () => jest.fn());

// Mock bs58
jest.mock('bs58', () => ({
  encode: jest.fn(),
  decode: jest.fn()
}));

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Mock all dependencies before requiring index.js
jest.mock('../telegramListener');
jest.mock('../messageProcessor');
jest.mock('../solanaTrader');
jest.mock('../tokenMonitoring', () => ({
  ...jest.requireActual('../tokenMonitoring'),
  startTokenMonitoring: jest.fn(),
  stopTokenMonitoring: jest.fn()
})); // Partially mock - keep executeMonitoringCycle real
jest.mock('../../utils/utils');
jest.mock('../../utils/logger');
jest.mock('../../utils/tokenState');
jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(),
  Keypair: {
    fromSecretKey: jest.fn()
  },
  PublicKey: jest.fn(),
  LAMPORTS_PER_SOL: 1000000000,
  VersionedTransaction: {
    deserialize: jest.fn()
  }
}));

// Import mocked modules
const { setMessageHandler, startClient, stopClient } = require('../telegramListener');
const { processMessage } = require('../messageProcessor');
const SolanaTrader = require('../solanaTrader');
const { startTokenMonitoring, stopTokenMonitoring, executeMonitoringCycle } = require('../tokenMonitoring');
const { getTokenPrice } = require('../../utils/utils');
const { log } = require('../../utils/logger');
const tokenState = require('../../utils/tokenState');
const { Connection } = require('@solana/web3.js');
const { initializeApplication } = require('../../index');

describe('Index.js Integration Test', () => {
  let mockSolanaTrader;
  let mockConnection;
  let messageHandler;
  let monitoringCallback;

  const testTokenAddress = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
  const initialPrice = 0.000001;
  const increasedPrice = initialPrice * 1.7; // 70% increase

  // Helper function to initialize application with mocks
  const initializeTestApplication = async () => {
    const mockConfig = {
      telegram_channels: ['Test Channel'],
      solana_rpc_endpoint: 'https://api.mainnet-beta.solana.com',
      trading_settings: {
        slippage_bps: 2000,
        compute_unit_price_micro_lamports: 500000,
        compute_unit_limit: 200000,
        purchase_amount_sol: 0.02,
        take_profit_percentage: 70
      }
    };

    await initializeApplication({
      config: mockConfig,
      connection: mockConnection,
      solanaTrader: mockSolanaTrader
    });

    await jest.runAllTimersAsync();
  };

  beforeAll(() => {
    // Mock environment variables
    process.env.TELEGRAM_APP_API_ID = '12345';
    process.env.TELEGRAM_APP_API_HASH = 'test_hash';
    process.env.TELEGRAM_STRING_SESSION = 'mock-session-string';
    process.env.SOLANA_WALLET_PRIVATE_KEY = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64]);

    // Mock config file reading
    const mockConfig = {
      telegram_channels: ['Test Channel'],
      solana_rpc_endpoint: 'https://api.mainnet-beta.solana.com',
      trading_settings: {
        slippage_bps: 2000,
        compute_unit_price_micro_lamports: 500000,
        compute_unit_limit: 200000,
        purchase_amount_sol: 0.02,
        take_profit_percentage: 70
      }
    };

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
      if (filePath.includes('config.json')) {
        return JSON.stringify(mockConfig);
      }
      return '';
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock process.exit to prevent tests from terminating
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    // Mock Connection
    mockConnection = {
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
      getBalance: jest.fn(),
      getParsedAccountInfo: jest.fn(),
      getParsedTokenAccountsByOwner: jest.fn(),
      sendRawTransaction: jest.fn(),
      confirmTransaction: jest.fn(),
      getLatestBlockhash: jest.fn(),
      getTransaction: jest.fn()
    };
    Connection.mockImplementation(() => mockConnection);

    // Mock SolanaTrader
    mockSolanaTrader = {
      handlePurchase: jest.fn(),
      handleSell: jest.fn()
    };
    SolanaTrader.mockImplementation(() => mockSolanaTrader);

    // Mock telegram listener functions
    setMessageHandler.mockImplementation((handler) => {
      messageHandler = handler;
    });
    startClient.mockResolvedValue();
    stopClient.mockResolvedValue();

    // Mock message processor
    processMessage.mockResolvedValue(testTokenAddress);

    // Mock token monitoring to avoid real intervals but store the callback
    startTokenMonitoring.mockImplementation((connection, actionCallback) => {
      monitoringCallback = actionCallback;
    });
    stopTokenMonitoring.mockImplementation(() => { });

    // Mock utils
    getTokenPrice.mockResolvedValue(initialPrice);

    // Mock logger
    log.mockImplementation(() => { });

    // Mock tokenState - set up for monitoring logic
    tokenState.isTokenSold.mockReturnValue(false);
    tokenState.hasPurchasedToken.mockReturnValue(false);
    tokenState.getPurchasedToken.mockReturnValue(null);
    tokenState.setPurchasedToken.mockImplementation(() => { });
    tokenState.setPriceHistory.mockImplementation(() => { });
    tokenState.addToSoldTokens.mockImplementation(() => { });
    tokenState.clearPurchasedToken.mockImplementation(() => { });
    tokenState.addPriceToHistory.mockImplementation(() => { });
    tokenState.getLastLogTime.mockReturnValue(0);
    tokenState.setLastLogTime.mockImplementation(() => { });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('Complete integration flow: message -> buy -> monitor -> sell', async () => {
    // Step 1: Mock successful purchase
    mockSolanaTrader.handlePurchase.mockResolvedValue({
      success: true,
      message: `Successfully purchased ${testTokenAddress}`
    });

    // Step 2: Mock successful sell
    mockSolanaTrader.handleSell.mockResolvedValue({
      success: true,
      message: `Successfully sold ${testTokenAddress}`,
      txid: 'mock-sell-signature',
      solReceived: 0.034,
      profit: 0.014,
      profitPercent: 70,
      sellReason: 'Take profit - 70% gain'
    });

    // Step 3: Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Verify that message handler is set
    expect(setMessageHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(startClient).toHaveBeenCalled();

    // Step 4: Simulate incoming message with token address
    const mockMessage = {
      message_id: 123,
      chat: {
        id: '456',
        title: 'Test Channel'
      },
      text: `Buy this token: ${testTokenAddress}`,
      date: Math.floor(Date.now() / 1000)
    };

    // Call the message handler
    expect(messageHandler).toBeDefined();
    const messagePromise = messageHandler(mockMessage);

    // Wait for message processing
    await jest.runAllTimersAsync();
    await messagePromise;

    // Step 5: Verify processMessage was called
    expect(processMessage).toHaveBeenCalledWith(mockMessage);

    // Step 6: Verify handlePurchase was called
    expect(mockSolanaTrader.handlePurchase).toHaveBeenCalledWith(testTokenAddress, mockMessage);

    // Step 7: Set up tokenState to simulate a purchased token for monitoring
    const mockPurchasedToken = {
      tokenAddress: testTokenAddress,
      purchaseTime: new Date().toISOString(),
      messageTime: new Date().toISOString(),
      purchasePrice: initialPrice,
      tokenAmount: 1000000,
      solAmount: 0.02,
      pricePerTokenUSD: initialPrice
    };
    tokenState.getPurchasedToken.mockReturnValue(mockPurchasedToken);

    // Step 8: Mock the increased price and manually trigger real monitoring cycle
    getTokenPrice.mockResolvedValue(increasedPrice);

    // Step 9: Manually trigger the real executeMonitoringCycle function
    const result = await executeMonitoringCycle(mockConnection);

    // Log the result for debugging
    process.stdout.write(`\nResult from executeMonitoringCycle:\n${JSON.stringify(result, null, 2)}\n`);

    // Manually invoke the callback with the returned result
    if (result && monitoringCallback) {
      await monitoringCallback(result.action, result.data);
    }

    // Step 10: Verify handleSell was called
    expect(mockSolanaTrader.handleSell).toHaveBeenCalledWith(
      testTokenAddress,
      'Take profit - 70% gain'
    );

    // Step 10: Verify the complete flow executed successfully
    expect(log).toHaveBeenCalledWith(`Message for ${testTokenAddress} verified. Proceeding to trading module.`);
    expect(log).toHaveBeenCalledWith('Starting token monitoring', true);
    expect(log).toHaveBeenCalledWith(
      `Monitoring triggered SELL action for ${testTokenAddress}: Take profit - 70% gain`,
      true
    );
    expect(log).toHaveBeenCalledWith(
      'Sell completed successfully: Successfully sold DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump',
      true
    );
  });

  test('Integration flow with failed purchase', async () => {
    // Mock failed purchase
    mockSolanaTrader.handlePurchase.mockResolvedValue({
      success: false,
      message: 'Insufficient SOL balance'
    });

    // Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Simulate incoming message
    const mockMessage = {
      message_id: 123,
      chat: { id: '456', title: 'Test Channel' },
      text: `Buy token: ${testTokenAddress}`,
      date: Math.floor(Date.now() / 1000)
    };

    const messagePromise = messageHandler(mockMessage);
    await jest.runAllTimersAsync();
    await messagePromise;

    // Verify purchase was attempted but failed
    expect(mockSolanaTrader.handlePurchase).toHaveBeenCalledWith(testTokenAddress, mockMessage);

    // Verify monitoring was NOT started since purchase failed
    expect(startTokenMonitoring).not.toHaveBeenCalled();
  });

  test('Integration flow with failed sell', async () => {
    // Mock successful purchase
    mockSolanaTrader.handlePurchase.mockResolvedValue({
      success: true,
      message: `Successfully purchased ${testTokenAddress}`
    });

    // Mock failed sell
    mockSolanaTrader.handleSell.mockResolvedValue({
      success: false,
      message: 'No tokens found in wallet'
    });

    // Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Simulate message and purchase
    const mockMessage = {
      message_id: 123,
      chat: { id: '456', title: 'Test Channel' },
      text: `Token: ${testTokenAddress}`,
      date: Math.floor(Date.now() / 1000)
    };

    const messagePromise = messageHandler(mockMessage);
    await jest.runAllTimersAsync();
    await messagePromise;

    // Set up tokenState to simulate a purchased token for monitoring
    const mockPurchasedToken = {
      tokenAddress: testTokenAddress,
      purchaseTime: new Date().toISOString(),
      messageTime: new Date().toISOString(),
      purchasePrice: initialPrice,
      tokenAmount: 1000000,
      solAmount: 0.02
    };
    tokenState.getPurchasedToken.mockReturnValue(mockPurchasedToken);

    // Mock increased price to trigger sell
    getTokenPrice.mockResolvedValue(increasedPrice);

    // Manually trigger the real executeMonitoringCycle function
    const result = await executeMonitoringCycle(mockConnection);

    // Manually invoke the callback with the returned result
    if (result && monitoringCallback) {
      await monitoringCallback(result.action, result.data);
    }

    // Verify sell was attempted but failed
    expect(mockSolanaTrader.handleSell).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Sell failed: No tokens found in wallet', true);
  });

  test('Integration flow with no valid token address in message', async () => {
    // Mock processMessage to return null (no valid address)
    processMessage.mockResolvedValue(null);

    // Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Simulate message without valid address
    const mockMessage = {
      message_id: 123,
      chat: { id: '456', title: 'Test Channel' },
      text: 'Hello world, no token here!',
      date: Math.floor(Date.now() / 1000)
    };

    const messagePromise = messageHandler(mockMessage);
    await jest.runAllTimersAsync();
    await messagePromise;

    // Verify no purchase was attempted
    expect(mockSolanaTrader.handlePurchase).not.toHaveBeenCalled();
    expect(startTokenMonitoring).not.toHaveBeenCalled();
  });

  test('Error handling in message processing', async () => {
    // Mock processMessage to throw an error
    processMessage.mockRejectedValue(new Error('Processing failed'));

    // Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Simulate message
    const mockMessage = {
      message_id: 123,
      chat: { id: '456', title: 'Test Channel' },
      text: `Token: ${testTokenAddress}`,
      date: Math.floor(Date.now() / 1000)
    };

    const messagePromise = messageHandler(mockMessage);
    await jest.runAllTimersAsync();
    await messagePromise;

    // Verify error was logged
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Error processing message in main handler'));
  });

  test('Error handling in monitoring action', async () => {
    // Mock successful purchase
    mockSolanaTrader.handlePurchase.mockResolvedValue({
      success: true,
      message: `Successfully purchased ${testTokenAddress}`
    });

    // Mock handleSell to throw an error
    mockSolanaTrader.handleSell.mockRejectedValue(new Error('Sell transaction failed'));

    // Initialize the application using the actual index.js function
    await initializeTestApplication();

    // Process message and start monitoring
    const mockMessage = {
      message_id: 123,
      chat: { id: '456', title: 'Test Channel' },
      text: `Token: ${testTokenAddress}`,
      date: Math.floor(Date.now() / 1000)
    };

    const messagePromise = messageHandler(mockMessage);
    await jest.runAllTimersAsync();
    await messagePromise;

    // Set up tokenState to simulate a purchased token for monitoring
    const mockPurchasedToken = {
      tokenAddress: testTokenAddress,
      purchaseTime: new Date().toISOString(),
      messageTime: new Date().toISOString(),
      purchasePrice: initialPrice,
      tokenAmount: 1000000,
      solAmount: 0.02
    };
    tokenState.getPurchasedToken.mockReturnValue(mockPurchasedToken);

    // Mock increased price to trigger sell
    getTokenPrice.mockResolvedValue(increasedPrice);

    // Manually trigger the real executeMonitoringCycle function that will cause an error
    const result = await executeMonitoringCycle(mockConnection);

    // Manually invoke the callback with the returned result
    if (result && monitoringCallback) {
      await monitoringCallback(result.action, result.data);
    }

    // Verify error was logged
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Error handling monitoring action SELL: Sell transaction failed'),
      true
    );
  });
});
