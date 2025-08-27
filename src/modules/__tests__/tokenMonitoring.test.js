// Mock config data is defined inline in the fs mock below

// Mock all external dependencies BEFORE importing anything
jest.mock('fs', () => ({
  readFileSync: jest.fn(() => JSON.stringify({
    trading_settings: {
      take_profit_percentage: 50,
      slippage_bps: 300,
      purchase_amount_sol: 0.01
    }
  })),
  existsSync: jest.fn(() => true)
}));

jest.mock('path', () => ({
  resolve: jest.fn(() => '/mock/config/path'),
  join: jest.fn((...args) => args.join('/'))
}));

jest.mock('../../utils/utils');
jest.mock('../../utils/logger');
jest.mock('../../utils/tokenState');
jest.mock('../../utils/consts', () => ({
  PRICE_CHECK_INTERVAL: 100 // Use shorter interval for tests
}));

// Mock global timer functions
global.setInterval = jest.fn();
global.clearInterval = jest.fn();

const tokenMonitoring = require('../tokenMonitoring');
const { getTokenPrice } = require('../../utils/utils');
const { log } = require('../../utils/logger');
const tokenState = require('../../utils/tokenState');
const { createMockConnection, createMockPurchasedToken } = require('./testUtils');

describe('TokenMonitoring', () => {
  let mockConnection;
  let intervalCallback;

  // Helper function to execute interval callback
  const executeInterval = async () => {
    if (intervalCallback) {
      await intervalCallback();
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset global mocks and setup interval callback capture
    global.setInterval = jest.fn((callback) => {
      intervalCallback = callback;
      return 'mockIntervalId';
    });
    global.clearInterval = jest.fn();

    mockConnection = createMockConnection();

    // Mock tokenState methods
    tokenState.getPurchasedToken = jest.fn();
    tokenState.getPriceHistory = jest.fn();
    tokenState.addPriceToHistory = jest.fn();
    tokenState.getLastLogTime = jest.fn();
    tokenState.setLastLogTime = jest.fn();

    // Mock utils
    getTokenPrice.mockResolvedValue(0.000002);

    // Mock logger
    log.mockImplementation(() => { });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Don't call stopTokenMonitoring here as it causes clearInterval errors in test environment
  });

  describe('getPriceAtTime', () => {
    beforeEach(() => {
      tokenMonitoring.stopTokenMonitoring();
    });

    it('should return 0 when price history is empty', () => {
      tokenState.getPriceHistory.mockReturnValue([]);

      const price = tokenMonitoring.getPriceAtTime(5);

      expect(price).toBe(0);
    });

    it('should return 0 when not enough history is available', () => {
      const now = Date.now();
      const recentTime = new Date(now - 2 * 60 * 1000); // 2 minutes ago

      tokenState.getPriceHistory.mockReturnValue([
        { timestamp: recentTime.toISOString(), price: 0.000001 }
      ]);

      const price = tokenMonitoring.getPriceAtTime(10); // Looking for 10 minutes ago

      expect(price).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Not enough price history'));
    });

    it('should return closest price when history is available', () => {
      const now = Date.now();
      const priceHistory = [
        { timestamp: new Date(now - 15 * 60 * 1000).toISOString(), price: 0.000001 }, // 15m ago
        { timestamp: new Date(now - 10 * 60 * 1000).toISOString(), price: 0.000002 }, // 10m ago
        { timestamp: new Date(now - 5 * 60 * 1000).toISOString(), price: 0.000003 },  // 5m ago
        { timestamp: new Date(now - 1 * 60 * 1000).toISOString(), price: 0.000004 }   // 1m ago
      ];

      tokenState.getPriceHistory.mockReturnValue(priceHistory);

      const price5m = tokenMonitoring.getPriceAtTime(5);
      const price10m = tokenMonitoring.getPriceAtTime(10);

      expect(price5m).toBe(0.000003);
      expect(price10m).toBe(0.000002);
    });

    it('should find closest match when exact time is not available', () => {
      const now = Date.now();
      const priceHistory = [
        { timestamp: new Date(now - 12 * 60 * 1000).toISOString(), price: 0.000001 }, // 12m ago
        { timestamp: new Date(now - 8 * 60 * 1000).toISOString(), price: 0.000002 },  // 8m ago
      ];

      tokenState.getPriceHistory.mockReturnValue(priceHistory);

      const price10m = tokenMonitoring.getPriceAtTime(10); // Should get 12m price (closer to 10m than 8m)

      expect(price10m).toBe(0.000001); // 12m ago is closer to 10m target than 8m ago
    });
  });

  describe('decideSell', () => {
    beforeEach(() => {
      tokenMonitoring.stopTokenMonitoring();
    });

    it('should return no data when no purchased token', () => {
      tokenState.getPurchasedToken.mockReturnValue(null);
      tokenState.getPriceHistory.mockReturnValue([]);

      const decision = tokenMonitoring.decideSell(0.000002, 0.01);

      expect(decision).toEqual({
        sellAt: "no data",
        returnRate: 0,
        finalCapital: 0
      });
    });

    it('should return no data when no price history', () => {
      const mockToken = createMockPurchasedToken();
      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getPriceHistory.mockReturnValue([]);

      const decision = tokenMonitoring.decideSell(0.000002, 0.01);

      expect(decision).toEqual({
        sellAt: "no data",
        returnRate: 0,
        finalCapital: 0
      });
    });

    it('should recommend sell at 10m when price is dropping from 5m', () => {
      const mockToken = createMockPurchasedToken({
        purchasePrice: 0.000001
      });

      const now = Date.now();
      const priceHistory = [
        { timestamp: new Date(now - 20 * 60 * 1000).toISOString(), price: 0.000001 }, // 20m ago
        { timestamp: new Date(now - 10 * 60 * 1000).toISOString(), price: 0.000002 }, // 10m ago
        { timestamp: new Date(now - 5 * 60 * 1000).toISOString(), price: 0.000001 },  // 5m ago (lower than 10m)
      ];

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getPriceHistory.mockReturnValue(priceHistory);

      // Current price = 0.000001
      // r5 = current/price5m = 0.000001/0.000001 = 1
      // r10 = current/price10m = 0.000001/0.000002 = 0.5
      // Since r10 (0.5) < r5 (1), this should trigger "drop detected"
      const decision = tokenMonitoring.decideSell(0.000001, 0.01);

      expect(decision.sellAt).toBe("10m (drop detected)");
      expect(decision.returnRate).toBe(0.5); // current/price10m = 0.000001/0.000002
    });

    it('should recommend sell at 10m when 20m shows further drop', () => {
      const mockToken = createMockPurchasedToken({
        purchasePrice: 0.000001
      });

      const now = Date.now();
      const priceHistory = [
        { timestamp: new Date(now - 20 * 60 * 1000).toISOString(), price: 0.000003 }, // 20m ago (higher)
        { timestamp: new Date(now - 10 * 60 * 1000).toISOString(), price: 0.000002 }, // 10m ago
        { timestamp: new Date(now - 5 * 60 * 1000).toISOString(), price: 0.000002 },  // 5m ago
      ];

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getPriceHistory.mockReturnValue(priceHistory);

      // Current price = 0.000002
      // r20 = current/price20m = 0.000002/0.000003 = 0.67
      // r10 = current/price10m = 0.000002/0.000002 = 1
      // Since r20 (0.67) < r10 (1), this should trigger "pre-20m drop"
      const decision = tokenMonitoring.decideSell(0.000002, 0.01);

      expect(decision.sellAt).toBe("10m (pre-20m drop)");
      expect(decision.returnRate).toBe(1); // current/price10m = 0.000002/0.000002
    });

    it('should recommend hold when no sell conditions are met', () => {
      const mockToken = createMockPurchasedToken({
        purchasePrice: 0.000001
      });

      const now = Date.now();
      const priceHistory = [
        { timestamp: new Date(now - 20 * 60 * 1000).toISOString(), price: 0.000001 }, // 20m ago
        { timestamp: new Date(now - 10 * 60 * 1000).toISOString(), price: 0.000002 }, // 10m ago
        { timestamp: new Date(now - 5 * 60 * 1000).toISOString(), price: 0.000003 },  // 5m ago - trending up
      ];

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getPriceHistory.mockReturnValue(priceHistory);

      const decision = tokenMonitoring.decideSell(0.000004, 0.01); // Current price higher

      expect(decision.sellAt).toBe("hold");
      expect(decision.returnRate).toBe(4); // 0.000004 / 0.000001
    });
  });

  describe('startTokenMonitoring', () => {
    let actionCallback;

    beforeEach(() => {
      actionCallback = jest.fn();
    });

    it('should start monitoring and log the start', () => {
      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      expect(log).toHaveBeenCalledWith('Starting token monitoring...', true);
    });

    it('should clear existing interval before starting new one', () => {
      // Mock setInterval to return a mock interval ID
      global.setInterval.mockReturnValue('mockIntervalId');

      // Start monitoring twice
      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);
      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // clearInterval should be called when starting the second time
      expect(global.clearInterval).toHaveBeenCalledWith('mockIntervalId');
    });

    it('should not process when no purchased token', async () => {
      tokenState.getPurchasedToken.mockReturnValue(null);

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(getTokenPrice).not.toHaveBeenCalled();
      expect(actionCallback).not.toHaveBeenCalled();
    });

    it('should trigger take profit sell when profit percentage is reached', async () => {
      const mockToken = createMockPurchasedToken({
        tokenAddress: 'testToken123',
        purchasePrice: 0.000001 // Purchase at $0.000001
      });

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(0);
      getTokenPrice.mockResolvedValue(0.0000015); // 50% profit

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(actionCallback).toHaveBeenCalledWith("SELL", {
        tokenAddress: 'testToken123',
        reason: 'Take profit - 50% gain',
        currentPrice: 0.0000015,
        profitPercent: '50.00'
      });
    });

    it('should call HOLD when no sell conditions are met', async () => {
      const mockToken = createMockPurchasedToken({
        tokenAddress: 'testToken123',
        purchasePrice: 0.000002 // Purchase at higher price
      });

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(0);
      getTokenPrice.mockResolvedValue(0.000001); // Lower than purchase price

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(actionCallback).toHaveBeenCalledWith("HOLD", {
        tokenAddress: 'testToken123',
        currentPrice: 0.000001
      });
    });

    it('should add price to history during monitoring', async () => {
      const mockToken = createMockPurchasedToken();
      const currentTime = 1640995200000; // Fixed timestamp

      jest.spyOn(Date, 'now').mockReturnValue(currentTime);

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(0);
      getTokenPrice.mockResolvedValue(0.000001);

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(tokenState.addPriceToHistory).toHaveBeenCalledWith({
        timestamp: new Date(currentTime).toISOString(),
        price: 0.000001
      });
    });

    it('should log price every 2 minutes', async () => {
      const mockToken = createMockPurchasedToken();
      const currentTime = 1640995200000;

      jest.spyOn(Date, 'now').mockReturnValue(currentTime);

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(currentTime - 130000); // 2+ minutes ago
      getTokenPrice.mockResolvedValue(0.000001);

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(log).toHaveBeenCalledWith('startTokenMonitoring - Current price: $0.000001 USD per token', true);
      expect(tokenState.setLastLogTime).toHaveBeenCalledWith(currentTime);
    });

    it('should skip processing when price is 0', async () => {
      const mockToken = createMockPurchasedToken();

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      getTokenPrice.mockResolvedValue(0); // Price fetch failed

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(tokenState.addPriceToHistory).not.toHaveBeenCalled();
      expect(actionCallback).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const mockToken = createMockPurchasedToken();

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      getTokenPrice.mockRejectedValue(new Error('API Error'));

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute the interval callback
      await executeInterval();

      expect(log).toHaveBeenCalledWith('Error in token monitoring: API Error', true);
    });
  });

  describe('stopTokenMonitoring', () => {
    it('should stop monitoring and log when interval exists', () => {
      // Mock setInterval to return an interval ID
      global.setInterval.mockReturnValue('mockIntervalId');

      // Start monitoring first
      tokenMonitoring.startTokenMonitoring(mockConnection, jest.fn());

      // Then stop it
      tokenMonitoring.stopTokenMonitoring();

      expect(global.clearInterval).toHaveBeenCalledWith('mockIntervalId');
      expect(log).toHaveBeenCalledWith('Token monitoring stopped', true);
    });

    it('should handle stopping when no interval is running', () => {
      tokenMonitoring.stopTokenMonitoring();

      // Should not crash and should not call clearInterval
      expect(global.clearInterval).not.toHaveBeenCalled();
    });
  });

  describe('Integration scenarios', () => {
    let actionCallback;

    beforeEach(() => {
      actionCallback = jest.fn();
    });

    it('should handle complete monitoring cycle with take profit', async () => {
      const mockToken = createMockPurchasedToken({
        tokenAddress: 'profitToken123',
        purchasePrice: 0.000001
      });

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(0);

      // First execution - should HOLD (20% gain, below 50% threshold)
      getTokenPrice.mockResolvedValue(0.0000012); // 20% gain

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);
      await executeInterval();

      expect(actionCallback).toHaveBeenCalledWith("HOLD", {
        tokenAddress: 'profitToken123',
        currentPrice: 0.0000012
      });

      // Reset and test take profit scenario
      actionCallback.mockClear();
      getTokenPrice.mockResolvedValue(0.0000015); // 50% gain - should trigger sell

      await executeInterval();

      expect(actionCallback).toHaveBeenCalledWith("SELL", {
        tokenAddress: 'profitToken123',
        reason: 'Take profit - 50% gain',
        currentPrice: 0.0000015,
        profitPercent: '50.00'
      });
    });

    it('should maintain price history correctly over time', async () => {
      const mockToken = createMockPurchasedToken();
      let currentTime = 1640995200000;

      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      tokenState.getPurchasedToken.mockReturnValue(mockToken);
      tokenState.getLastLogTime.mockReturnValue(0);

      const prices = [0.000001, 0.000002, 0.000003];

      tokenMonitoring.startTokenMonitoring(mockConnection, actionCallback);

      // Execute intervals with different prices and times
      for (let i = 0; i < 3; i++) {
        getTokenPrice.mockResolvedValue(prices[i]);
        await executeInterval();

        expect(tokenState.addPriceToHistory).toHaveBeenNthCalledWith(i + 1, {
          timestamp: new Date(currentTime).toISOString(),
          price: prices[i]
        });

        currentTime += 1000;
      }

      // Verify price history was updated correctly
      expect(tokenState.addPriceToHistory).toHaveBeenCalledTimes(3);
    });
  });
});
