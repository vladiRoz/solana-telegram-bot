require('dotenv').config({ path: '../.env' });
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const apiId = parseInt(process.env.TELEGRAM_APP_API_ID || '0');
const apiHash = process.env.TELEGRAM_APP_API_HASH || '';

// Create new session (empty string for new session)
const stringSession = new StringSession('');

async function createNewSession() {
    console.log('Creating new Telegram session...');
    
    if (!apiId || !apiHash) {
        console.error('TELEGRAM_APP_API_ID or TELEGRAM_APP_API_HASH not set in .env file');
        process.exit(1);
    }

    console.log('API credentials loaded');
    
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true,
        requestRetries: 5,
        timeout: 10000,
        deviceModel: 'Desktop',
        systemVersion: 'Windows 10',
        appVersion: '1.0.0',
    });
    
    try {
        console.log('Connecting to Telegram...');
        await client.connect();
        console.log('Connection successful');
        
        // Start authentication process
        console.log('Starting authentication...');
        await client.start({
            phoneNumber: async () => {
                return await input.text('Enter your phone number (with country code, e.g., +1234567890): ');
            },
            password: async () => {
                return await input.text('Enter your 2FA password (if enabled): ');
            },
            phoneCode: async () => {
                return await input.text('Enter the verification code you received: ');
            },
            onError: (err) => {
                console.error('Authentication error:', err);
            },
        });
        
        // Save the session string
        const sessionStr = client.session.save();
        console.log('\n✅ Authentication successful!');
        console.log('\n📋 Copy this TELEGRAM_STRING_SESSION to your .env file:');
        console.log('TELEGRAM_STRING_SESSION="' + sessionStr + '"');
        console.log('\n⚠️  Keep this session string secure and do not share it!');
        
        // Disconnect
        await client.disconnect();
        console.log('\n✅ Session created and client disconnected.');
        
    } catch (error) {
        console.error('❌ Error creating session:', error.message);
        if (error.stack) console.error('Stack trace:', error.stack);
    }
}

// Run the session creation
createNewSession()
    .catch(error => {
        console.error('Unhandled error:', error);
    })
    .finally(() => {
        console.log('Session creation script finished.');
        process.exit(0);
    }); 