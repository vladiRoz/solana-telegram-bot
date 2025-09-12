// Mock all external dependencies BEFORE importing anything
jest.mock('../../utils/logger');
jest.mock('../../utils/tokenState');
jest.mock('../messageProcessor');

// Mock the telegramListener module to prevent StringSession issues
jest.mock('../telegramListener', () => ({
    getLastMessage: jest.fn(),
    setMessageHandler: jest.fn(),
    startClient: jest.fn(),
    stopClient: jest.fn()
}));

// Mock global timer functions
global.setInterval = jest.fn();
global.clearInterval = jest.fn();
global.setTimeout = jest.fn();

const RugPullMonitoring = require('../rugPullMonitoring');
const { log } = require('../../utils/logger');
const { getLastMessage } = require('../telegramListener');
const { extractSolanaAddresses } = require('../messageProcessor');

describe('RugPullMonitoring', () => {
    let rugPullMonitor;
    let mockActionCallback;
    let intervalCallback;
    let timeoutCallback;

    // Helper function to execute interval callback
    const executeInterval = async () => {
        if (intervalCallback) {
            await intervalCallback();
        }
    };

    // Helper function to execute timeout callback
    const executeTimeout = () => {
        if (timeoutCallback) {
            timeoutCallback();
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Reset global mocks and setup callback capture
        global.setInterval = jest.fn((callback) => {
            intervalCallback = callback;
            return 'mockIntervalId';
        });
        global.clearInterval = jest.fn();
        global.setTimeout = jest.fn((callback) => {
            timeoutCallback = callback;
            return 'mockTimeoutId';
        });

        rugPullMonitor = new RugPullMonitoring();
        mockActionCallback = jest.fn();

        // Mock logger
        log.mockImplementation(() => {});

        // Mock getLastMessage
        getLastMessage.mockResolvedValue(['Test message with token ABC123']);

        // Mock extractSolanaAddresses
        extractSolanaAddresses.mockImplementation((msg) => {
            if (msg && msg.includes('ABC123')) return 'ABC123';
            if (msg && msg.includes('XYZ789')) return 'XYZ789';
            return null;
        });

        // Mock Date.now()
        jest.spyOn(Date, 'now').mockReturnValue(1640995200000);
    });

    afterEach(() => {
        jest.useRealTimers();
        // Don't call stopMonitoring in afterEach as it causes clearInterval issues
    });

    describe('Constructor', () => {
        it('should initialize with default values', () => {
            const monitor = new RugPullMonitoring();
            
            expect(monitor.monitoringInterval).toBeNull();
            expect(monitor.monitoringStartTime).toBeNull();
            expect(monitor.monitoredToken).toBeNull();
            expect(monitor.chatTitle).toBeNull();
            expect(monitor.isActive).toBe(false);
        });
    });

    describe('startMonitoring', () => {
        it('should initialize monitoring with correct parameters', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            expect(rugPullMonitor.monitoredToken).toBe('ABC123');
            expect(rugPullMonitor.chatTitle).toBe('Test Chat');
            expect(rugPullMonitor.isActive).toBe(true);
            expect(rugPullMonitor.monitoringStartTime).toBe(1640995200000);
        });

        it('should set up interval with 2 second frequency', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
        });

        it('should set up 5 minute timeout', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 300000);
        });

        it('should log monitoring start', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            expect(log).toHaveBeenCalledWith('Starting rug pull monitoring for token ABC123 in chat Test Chat', true);
            expect(log).toHaveBeenCalledWith('Will monitor for 5 minutes (300 seconds), checking every 2 seconds', true);
        });

        it('should stop previous monitoring if already active', () => {
            // Start first monitoring
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            // Start second monitoring
            rugPullMonitor.startMonitoring('XYZ789', 'Another Chat', mockActionCallback);

            expect(log).toHaveBeenCalledWith('Rug pull monitoring is already active. Stopping previous monitoring.', true);
            expect(global.clearInterval).toHaveBeenCalledWith('mockIntervalId');
        });
    });

    describe('checkForRugPull', () => {
        beforeEach(() => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
        });

        it('should return early if monitoring is not active', async () => {
            rugPullMonitor.isActive = false;

            await rugPullMonitor.checkForRugPull(mockActionCallback);

            expect(getLastMessage).not.toHaveBeenCalled();
        });

        it('should continue monitoring when token is still present', async () => {
            getLastMessage.mockResolvedValue(['Test message with token ABC123']);
            
            await executeInterval();

            expect(getLastMessage).toHaveBeenCalledWith('Test Chat');
            expect(mockActionCallback).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith('Token ABC123 still present in chat messages - no rug pull detected yet', false);
        });

        it('should detect rug pull when token address is no longer in messages', async () => {
            getLastMessage.mockResolvedValue(['Test message without token']);
            extractSolanaAddresses.mockReturnValue(null);
            
            await executeInterval();

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Message with token address was deleted',
                urgent: true,
                rugPullDetected: true
            });
            expect(log).toHaveBeenCalledWith('RUG PULL DETECTED! Token ABC123 address no longer found in recent messages from Test Chat', true);
        });

        it('should detect rug pull when no messages are returned', async () => {
            getLastMessage.mockResolvedValue(null);
            
            await executeInterval();

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Chat messages unavailable - possible deletion',
                urgent: true,
                rugPullDetected: true
            });
        });

        it('should detect rug pull when empty messages are returned', async () => {
            getLastMessage.mockResolvedValue([]);
            
            await executeInterval();

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Chat messages unavailable - possible deletion',
                urgent: true,
                rugPullDetected: true
            });
        });

        it('should log progress every 30 seconds', async () => {
            const originalMathFloor = Math.floor;
            jest.spyOn(Math, 'floor').mockImplementation((val) => {
                if (val === 30) return 30; // Simulate 30 seconds elapsed
                return originalMathFloor(val);
            });

            const currentTime = 1640995200000 + 30000; // 30 seconds later
            jest.spyOn(Date, 'now').mockReturnValue(currentTime);
            
            await executeInterval();

            expect(log).toHaveBeenCalledWith('Rug pull monitoring: 30s elapsed, still monitoring ABC123', true);
        });

        it('should handle errors gracefully', async () => {
            const error = new Error('Connection failed');
            getLastMessage.mockRejectedValue(error);
            
            await executeInterval();

            expect(log).toHaveBeenCalledWith('Error checking for rug pull: Connection failed', true);
            expect(mockActionCallback).not.toHaveBeenCalled();
        });

        it('should treat chat access errors as suspicious and trigger sell', async () => {
            const chatError = new Error('Chat access denied');
            getLastMessage.mockRejectedValue(chatError);
            
            await executeInterval();

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Unable to access chat - possible restriction',
                urgent: true,
                rugPullDetected: true
            });
        });

        it('should handle multiple token addresses in messages', async () => {
            getLastMessage.mockResolvedValue([
                'Message with ABC123',
                'Another message with XYZ789', 
                'Message with ABC123 again'
            ]);
            
            await executeInterval();

            expect(mockActionCallback).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith('Token ABC123 still present in chat messages - no rug pull detected yet', false);
        });
    });

    describe('handleRugPull', () => {
        beforeEach(() => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
        });

        it('should return early if monitoring is not active', async () => {
            rugPullMonitor.isActive = false;

            await rugPullMonitor.handleRugPull(mockActionCallback, 'test reason');

            expect(mockActionCallback).not.toHaveBeenCalled();
        });

        it('should call action callback with correct parameters', async () => {
            await rugPullMonitor.handleRugPull(mockActionCallback, 'Test deletion');

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Test deletion',
                urgent: true,
                rugPullDetected: true
            });
        });

        it('should stop monitoring after handling rug pull', async () => {
            await rugPullMonitor.handleRugPull(mockActionCallback, 'Test deletion');

            expect(rugPullMonitor.isActive).toBe(false);
            expect(rugPullMonitor.monitoredToken).toBeNull();
            expect(rugPullMonitor.chatTitle).toBeNull();
        });

        it('should log urgent messages', async () => {
            await rugPullMonitor.handleRugPull(mockActionCallback, 'Test deletion');

            expect(log).toHaveBeenCalledWith('URGENT: Rug pull detected for ABC123. Reason: Test deletion', true);
            expect(log).toHaveBeenCalledWith('Triggering immediate sell to minimize losses...', true);
        });

        it('should handle missing callback gracefully', async () => {
            await rugPullMonitor.handleRugPull(null, 'Test deletion');

            expect(log).toHaveBeenCalledWith('No action callback provided - cannot execute sell!', true);
        });
    });

    describe('stopMonitoring', () => {
        it('should clear interval when monitoring is active', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            rugPullMonitor.stopMonitoring();

            expect(global.clearInterval).toHaveBeenCalledWith('mockIntervalId');
        });

        it('should reset all properties', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            rugPullMonitor.stopMonitoring();

            expect(rugPullMonitor.isActive).toBe(false);
            expect(rugPullMonitor.monitoredToken).toBeNull();
            expect(rugPullMonitor.chatTitle).toBeNull();
            expect(rugPullMonitor.monitoringStartTime).toBeNull();
            expect(rugPullMonitor.monitoringInterval).toBeNull();
        });

        it('should log when stopping active monitoring', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            rugPullMonitor.stopMonitoring();

            expect(log).toHaveBeenCalledWith('Rug pull monitoring stopped for token ABC123', true);
        });

        it('should handle stopping when not active', () => {
            rugPullMonitor.stopMonitoring();

            expect(global.clearInterval).not.toHaveBeenCalled();
            expect(log).not.toHaveBeenCalledWith(expect.stringContaining('stopped for token'));
        });
    });

    describe('getStatus', () => {
        it('should return inactive status when not monitoring', () => {
            const status = rugPullMonitor.getStatus();

            expect(status).toEqual({
                active: false,
                token: null,
                chat: null,
                elapsed: 0,
                remaining: 0
            });
        });

        it('should return active status with correct details', () => {
            const startTime = 1640995200000;
            const currentTime = 1640995230000; // 30 seconds later
            
            jest.spyOn(Date, 'now')
                .mockReturnValueOnce(startTime) // For startMonitoring
                .mockReturnValueOnce(currentTime); // For getStatus

            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            const status = rugPullMonitor.getStatus();

            expect(status).toEqual({
                active: true,
                token: 'ABC123',
                chat: 'Test Chat',
                elapsed: 30,
                remaining: 270 // 300 - 30 = 270
            });
        });

        it('should return zero remaining time when time exceeded', () => {
            const startTime = 1640995200000;
            const currentTime = 1640995500000; // 300 seconds (5 minutes) later
            
            jest.spyOn(Date, 'now')
                .mockReturnValueOnce(startTime) // For startMonitoring
                .mockReturnValueOnce(currentTime); // For getStatus

            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            const status = rugPullMonitor.getStatus();

            expect(status.remaining).toBe(0);
        });
    });

    describe('isMonitoringActive', () => {
        it('should return false when not monitoring', () => {
            expect(rugPullMonitor.isMonitoringActive()).toBe(false);
        });

        it('should return true when monitoring is active', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            expect(rugPullMonitor.isMonitoringActive()).toBe(true);
        });

        it('should return false after stopping monitoring', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            rugPullMonitor.stopMonitoring();
            
            expect(rugPullMonitor.isMonitoringActive()).toBe(false);
        });
    });

    describe('Auto-stop after 5 minutes', () => {
        it('should auto-stop monitoring after 5 minutes', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            
            // Execute the timeout callback (simulating 5 minutes passing)
            executeTimeout();

            expect(rugPullMonitor.isActive).toBe(false);
            expect(log).toHaveBeenCalledWith('Rug pull monitoring completed for ABC123 after 5 minutes - no rug pull detected', true);
        });

        it('should not auto-stop if already stopped manually', () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            rugPullMonitor.stopMonitoring(); // Manual stop
            
            log.mockClear(); // Clear previous logs
            
            // Execute the timeout callback
            executeTimeout();

            expect(log).not.toHaveBeenCalledWith(expect.stringContaining('completed for ABC123 after 5 minutes'));
        });
    });

    describe('Integration scenarios', () => {
        it('should complete full monitoring cycle without rug pull', async () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            // Simulate several checks over time
            for (let i = 0; i < 3; i++) {
                getLastMessage.mockResolvedValue(['Message with ABC123']);
                await executeInterval();
                expect(mockActionCallback).not.toHaveBeenCalled();
            }

            // Auto-stop after timeout
            executeTimeout();
            expect(rugPullMonitor.isActive).toBe(false);
        });

        it('should detect rug pull and stop monitoring immediately', async () => {
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);

            // First check - token present
            getLastMessage.mockResolvedValue(['Message with ABC123']);
            await executeInterval();
            expect(mockActionCallback).not.toHaveBeenCalled();

            // Second check - token missing (rug pull)
            getLastMessage.mockResolvedValue(['Message without token']);
            extractSolanaAddresses.mockReturnValue(null);
            await executeInterval();

            expect(mockActionCallback).toHaveBeenCalledWith('SELL', {
                tokenAddress: 'ABC123',
                reason: 'RUG PULL PROTECTION: Message with token address was deleted',
                urgent: true,
                rugPullDetected: true
            });
            expect(rugPullMonitor.isActive).toBe(false);
        });

        it('should restart monitoring with new token after previous completion', () => {
            // Start first monitoring
            rugPullMonitor.startMonitoring('ABC123', 'Test Chat', mockActionCallback);
            executeTimeout(); // Complete first monitoring
            
            // Start second monitoring
            rugPullMonitor.startMonitoring('XYZ789', 'Another Chat', mockActionCallback);

            expect(rugPullMonitor.monitoredToken).toBe('XYZ789');
            expect(rugPullMonitor.chatTitle).toBe('Another Chat');
            expect(rugPullMonitor.isActive).toBe(true);
        });
    });
});
