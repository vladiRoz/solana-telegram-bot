require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const input = require('input');
const { log } = require('console');

// Load config
const configPath = path.resolve(__dirname, '../../config/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Function to be called by index.js to pass the message handler
let messageHandlerCallback = null;
let client = null;
let isAuthenticated = false;

// Config values from .env
const apiId = parseInt(process.env.TELEGRAM_APP_API_ID || '0');
const apiHash = process.env.TELEGRAM_APP_API_HASH || '';
let stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

if (!apiId || !apiHash) {
    console.error('Error: TELEGRAM_APP_API_ID and TELEGRAM_APP_API_HASH must be defined in .env file');
    process.exit(1);
}

/**
 * Set the message handler function
 * @param {Function} callback - The message handler function
 */
function setMessageHandler(callback) {
    messageHandlerCallback = callback;
}

/**
 * Initialize and start the Telegram client
 * @returns {Promise<void>}
 */
async function startClient() {
    if (client) {
        console.log('Client already started');
        return;
    }

    console.log('Creating Telegram client...');
    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true, // Use secure WebSocket
        requestRetries: 5,
        timeout: 10000, // 10 seconds timeout
        deviceModel: 'Desktop',
        systemVersion: 'Windows 10',
        appVersion: '1.0.0',
    });

    try {
        // Set timeout for initial connection
        console.log('Attempting to connect to Telegram servers...');
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

        // Start the client with phone login flow if not authenticated
        if (!process.env.TELEGRAM_STRING_SESSION) {
            console.log('No session found, starting authentication...');
            await client.start({
                phoneNumber: async () => await input.text('Please enter your phone number: '),
                password: async () => await input.text('Please enter your password: '),
                phoneCode: async () => await input.text('Please enter the code you received: '),
                onError: (err) => console.log(err),
            });

            // Save the session string to use it next time
            const sessionString = client.session.save();
            console.log('Authentication successful!');
            console.log('Please add this to your .env file as TELEGRAM_STRING_SESSION:');
            console.log(sessionString);
            isAuthenticated = true;
        } else {
            console.log('Using existing session, connecting...');
            isAuthenticated = true;
            console.log('Connection successful!');
        }

        // Add message event handler
        setupMessageHandler();

        return client;
    } catch (error) {
        console.error('Failed to start Telegram client:', error);
        throw error;
    }
}

/**
 * Set up event handlers for new messages
 */
function setupMessageHandler() {
    if (!client) {
        console.error('Client not initialized. Call startClient() first');
        return;
    }

    console.log('Setting up message handlers...');
    console.log(`Tracking channels: ${config.telegram_channels.join(', ')}`);

    // Add event handler for new messages
    client.addEventHandler(async (event) => {
        try {
            // console.log(`Received event: ${event.className}`);
            
            // Check if this is a message event
            if (event.className === 'UpdateNewMessage' || event.className === 'UpdateNewChannelMessage') {
                const message = event.message;

                // console.log(`New message: ${message.message}`);
                
                if (!message) {
                    console.log('Skipping: No message in event');
                    return;
                }
                
                if (!message.peerId) {
                    console.log('Skipping: No peerId in message');
                    return;
                }
                
                try {
                    // Get the chat entity from peerId
                    const chat = await client.getEntity(message.peerId);
                    
                    if (!chat) {
                        console.log('Skipping: Could not retrieve chat entity');
                        return;
                    }
                    
                    const chatTitle = chat.title || chat.username || chat.firstName || 'Unknown';
                    const messageText = message.message || '';
                    
                    // console.log(`Resolved message from chat: ${chatTitle}: ${messageText}`);
                    
                    // Check if this is a tracked channel
                    if (config.telegram_channels.includes(chatTitle)) {
                        console.log(`Message is from a tracked channel: ${chatTitle}`);
                        
                        if (messageHandlerCallback && messageText) {
                            // Convert the message to a format compatible with the existing code
                            const formattedMsg = {
                                message_id: message.id,
                                chat: {
                                    id: chat.id.toString(),
                                    title: chatTitle
                                },
                                text: messageText,
                                date: message.date
                            };
                            
                            messageHandlerCallback(formattedMsg);
                        } else {
                            console.log('Message handler not set or message empty.');
                        }
                    }
                } catch (error) {
                    console.error('Error retrieving or processing chat entity:', error);
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
}

/**
 * Stop the Telegram client
 * @returns {Promise<void>}
 */
async function stopClient() {
    if (!client) {
        console.log('Client is not running');
        return;
    }
    
    try {
        await client.disconnect();
        client = null;
        console.log('Telegram client has been disconnected');
    } catch (error) {
        console.error('Error stopping client:', error);
    }
}

/**
 * Get the last message from a specific channel
 * @param {string|number} chatIdentifier - The chat ID or title to get messages from
 * @returns {Promise<Object|null>} The last message object or null if not found
 */
async function getLastMessage(chatIdentifier) {
    if (!client) {
        console.error('Client not initialized. Call startClient() first');
        return null;
    }

    try {
        // Get the chat entity
        let chat;
        if (typeof chatIdentifier === 'number') {
            // If it's a chat ID
            chat = await client.getEntity(chatIdentifier);
        } else {
            // If it's a chat title, find it in the config channels
            // Get all dialogs (chats)
            const dialogs = await client.getDialogs();
            chat = dialogs.find(dialog => dialog.title === chatIdentifier);
            
            if (!chat) {
                console.error(`Could not find channel with title: ${chatIdentifier}`);
                return null;
            }
        }

        // Get the last message from the chat
        const messages = await client.getMessages(chat, {
            limit: 1, // Get only the last message
            // reverse: true // Get the most recent message first
        });

        if (messages && messages.length > 0) {
            const message = messages[0];
            // Format the message to match the expected structure
            return {
                message_id: message.id,
                chat: {
                    id: chat.id.toString(),
                    title: chat.title || chat.username || 'Unknown'
                },
                text: message.message || '',
                date: message.date
            };
        }

        return null;
    } catch (error) {
        console.error('Error getting last message:', error);
        return null;
    }
}

module.exports = {
    setMessageHandler,
    startClient,
    stopClient,
    getLastMessage
};
