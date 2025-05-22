const { extractSolanaAddresses, isValidSolanaAddress } = require('../messageProcessor');
const { processMessage } = require('../messageProcessor');

// Mock the telegramListener module
jest.mock('../telegramListener', () => ({
    getLastMessage: jest.fn()
}));

// Import the mocked function
const { getLastMessage } = require('../telegramListener');

describe('extractSolanaAddresses', () => {
    // Test invalid inputs
    test('should return null for null input', () => {
        expect(extractSolanaAddresses(null)).toBeNull();
    });

    test('should return null for undefined input', () => {
        expect(extractSolanaAddresses(undefined)).toBeNull();
    });

    test('should return null for non-string input', () => {
        expect(extractSolanaAddresses(123)).toBeNull();
    });

    test('should return null for empty string', () => {
        expect(extractSolanaAddresses('')).toBeNull();
    });

    // Test dexscreener URL cases
    test('should extract address from dexscreener URL', () => {
        const message = 'Buy Flowers For MOM 🥹 DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        const expected = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        expect(extractSolanaAddresses(message)).toBe(expected);
    });

    test('should extract address from plain text', () => {
        const message = '335SEGfUMycHTdPxV3LSM6rLHDMmVEeus7thohK4pump';
        const expected = '335SEGfUMycHTdPxV3LSM6rLHDMmVEeus7thohK4pump';
        expect(extractSolanaAddresses(message)).toBe(expected);
    });

    test('should extract address from text with surrounding content', () => {
        const message = 'Minecraftfication 9EdYm43yM3DjLHfry7KnjnTihuabZHEdkoQehjoQpump';
        const expected = '9EdYm43yM3DjLHfry7KnjnTihuabZHEdkoQehjoQpump';
        expect(extractSolanaAddresses(message)).toBe(expected);
    });

    test('should not extract invalid address', () => {
        const message = 'Token address: invalidaddress123';
        expect(extractSolanaAddresses(message)).toBeNull();
    });

    // Test address length validation
    test('should not extract address that is too short', () => {
        const message = 'Token: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs'; // 31 chars
        expect(extractSolanaAddresses(message)).toBeNull();
    });

    test('should not extract address that is too long', () => {
        const message = 'Token: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU123456789'; // 45 chars
        expect(extractSolanaAddresses(message)).toBeNull();
    });
});

describe('processMessage', () => {
    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        // Mock console.log to keep test output clean
        jest.spyOn(console, 'log').mockImplementation(() => {});
        // Use fake timers
        jest.useFakeTimers();
    });

    afterEach(() => {
        // Restore console.log after each test
        console.log.mockRestore();
        // Clear all timers
        jest.clearAllTimers();
    });

    it('should return null if message has no text', async () => {
        const msg = {
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        const result = await processMessage(msg);
        expect(result).toBeNull();
        expect(getLastMessage).not.toHaveBeenCalled();
    });

    it('should return null if no valid address found', async () => {
        const msg = {
            text: 'This is a message without any address',
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        const result = await processMessage(msg);
        expect(result).toBeNull();
        expect(getLastMessage).not.toHaveBeenCalled();
    });

    it('should return address if message is valid and last message matches', async () => {
        const address = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        const msg = {
            text: `Buy token ${address}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        // Mock getLastMessage to return a message with the same address
        getLastMessage.mockResolvedValue({
            text: `Buy token ${address}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 2
        });

        const processPromise = processMessage(msg);
        
        // Fast-forward timers to skip the 30-second wait
        jest.advanceTimersByTime(30000);
        
        const result = await processPromise;
        expect(getLastMessage).toHaveBeenCalledWith('Test Channel');
        expect(result).toBe(address);
    });

    it('should return null if last message has different address', async () => {
        const originalAddress = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        const newAddress = '335SEGfUMycHTdPxV3LSM6rLHDMmVEeus7thohK4pump';
        
        const msg = {
            text: `Buy token ${originalAddress}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        // Mock getLastMessage to return a message with a different address
        getLastMessage.mockResolvedValue({
            text: `Buy token ${newAddress}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 2
        });

        const processPromise = processMessage(msg);
        
        // Fast-forward timers to skip the 30-second wait
        jest.advanceTimersByTime(30000);
        
        const result = await processPromise;
        expect(getLastMessage).toHaveBeenCalledWith('Test Channel');
        expect(result).toBeNull();
    });

    it('should return null if last message cannot be retrieved', async () => {
        const address = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        const msg = {
            text: `Buy token ${address}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        // Mock getLastMessage to return null
        getLastMessage.mockResolvedValue(null);

        const processPromise = processMessage(msg);
        
        // Fast-forward timers to skip the 30-second wait
        jest.advanceTimersByTime(30000);
        
        const result = await processPromise;
        expect(getLastMessage).toHaveBeenCalledWith('Test Channel');
        expect(result).toBeNull();
    });

    it('should return address from dexscreener URL if last message matches', async () => {
        const address = 'DyBbW4tJ1DEPjbWqGdd4esr8Qq3JYC3TUsf1WJ5Tpump';
        const msg = {
            text: `Check this token: https://dexscreener.com/solana/${address}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 1
        };

        // Mock getLastMessage to return a message with the same address
        getLastMessage.mockResolvedValue({
            text: `Check this token: https://dexscreener.com/solana/${address}`,
            chat: { id: '123', title: 'Test Channel' },
            message_id: 2
        });

        const processPromise = processMessage(msg);
        
        // Fast-forward timers to skip the 30-second wait
        jest.advanceTimersByTime(30000);
        
        const result = await processPromise;
        expect(getLastMessage).toHaveBeenCalledWith('Test Channel');
        expect(result).toBe(address);
    });
}); 