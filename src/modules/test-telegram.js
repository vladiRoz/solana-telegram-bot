require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const apiId = parseInt(process.env.TELEGRAM_APP_API_ID || '0');
const apiHash = process.env.TELEGRAM_APP_API_HASH || '';
let stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

// Simple test client
async function main() {
    console.log('Starting Telegram client test...');
    
    if (!apiId || !apiHash) {
        console.error('TELEGRAM_APP_API_ID or TELEGRAM_APP_API_HASH not set in .env file');
        process.exit(1);
    }

    console.log('API credentials loaded:', { apiId, apiHash: apiHash.substring(0, 3) + '...' });
    
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true, // Try using secure WebSocket
        requestRetries: 5,
        timeout: 10000, // 10 seconds timeout
        deviceModel: 'Desktop',
        systemVersion: 'Windows 10',
        appVersion: '1.0.0',
    });
    console.log('Client created, attempting to connect...');
    
    try {
        // Set timeout for connection
        const connectionPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
        );
        
        try {
            await Promise.race([connectionPromise, timeoutPromise]);
            console.log('Initial connection successful');
        } catch (error) {
            console.error('Connection timeout or error:', error.message);
            console.log('Trying alternative connection method...');
        }
        
        // Start the client
        console.log('Starting client authentication process...');
        await client.start({
            phoneNumber: async () => {
                console.log('Phone number prompt displayed');
                return await input.text('Please enter your phone (with country code): ');
            },
            password: async () => {
                console.log('Password prompt displayed');
                return await input.text('Please enter your 2FA password (if enabled): ');
            },
            phoneCode: async () => {
                console.log('Code prompt displayed');
                return await input.text('Please enter the code you received: ');
            },
            onError: (err) => {
                console.error('Authentication error:', err);
            },
        });
        
        // Save the session string for reuse
        console.log('You should now be connected.');
        const sessionStr = client.session.save();
        console.log('Add this to your .env file as TELEGRAM_STRING_SESSION:');
        console.log(sessionStr);
        
        // Get dialogs (chats and channels)
        console.log('Fetching your dialogs (chats and channels)...');
        const dialogs = await client.getDialogs({
            limit: 10
        });
        
        console.log('Your most recent dialogs:');
        if (dialogs && dialogs.length > 0) {
            dialogs.slice(0, 10).forEach((dialog, i) => {
                const entity = dialog.entity;
                const name = entity.title || entity.firstName || entity.username || 'Unknown';
                console.log(`${i + 1}. ${name} (${entity.className})`);
            });
        } else {
            console.log('No dialogs found or unable to retrieve dialogs');
        }
        
        // Add a message handler to see incoming messages
        console.log('Setting up event handler for new messages...');
        client.addEventHandler((update) => {
            console.log('Update received:', update.className);
            if (update.className === 'UpdateNewMessage' || update.className === 'UpdateNewChannelMessage') {
                const message = update.message;
                if (message && message.message) {
                    console.log(`New message: ${message.message}`);
                }
            }
        });
        
        console.log('Test client running. Press Ctrl+C to exit.');
        // Keep the process alive
        await new Promise((resolve) => {
            console.log('Waiting for messages. Will exit automatically after 5 minutes if no activity.');
            setTimeout(resolve, 300000); // 5 minutes timeout
        });
        
        console.log('Test completed. Disconnecting...');
        await client.disconnect();
        console.log('Disconnected.');
        
    } catch (error) {
        console.error('Error in Telegram client test:', error);
        if (error.message) console.error('Error message:', error.message);
        if (error.stack) console.error('Stack trace:', error.stack);
    }
}

// Run the test
main()
    .catch(error => {
        console.error('Unhandled error in main:', error);
    })
    .finally(() => {
        console.log('Test script finished.');
        process.exit(0);
    }); 