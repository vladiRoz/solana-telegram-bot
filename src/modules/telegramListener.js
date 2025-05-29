require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const input = require('input');
const { log } = require("../utils/logger");

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
    log('Error: TELEGRAM_APP_API_ID and TELEGRAM_APP_API_HASH must be defined in .env file');
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
        log('Client already started');
        return;
    }

    log('Creating Telegram client...');
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
        log('Attempting to connect to Telegram servers...');
        const connectionPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
        );
        
        try {
            await Promise.race([connectionPromise, timeoutPromise]);
            log('Initial connection successful');
        } catch (error) {
            log('Connection timeout or error: ' + error.message);
            log('Trying alternative connection method...');
        }

        // Start the client with phone login flow if not authenticated
        if (!process.env.TELEGRAM_STRING_SESSION) {
            log('No session found, starting authentication...');
            await client.start({
                phoneNumber: async () => await input.text('Please enter your phone number: '),
                password: async () => await input.text('Please enter your password: '),
                phoneCode: async () => await input.text('Please enter the code you received: '),
                onError: (err) => log(err),
            });

            // Save the session string to use it next time
            const sessionString = client.session.save();
            log('Authentication successful!');
            log('Please add this to your .env file as TELEGRAM_STRING_SESSION:');
            log(sessionString);
            isAuthenticated = true;
        } else {
            log('Using existing session, connecting...');
            isAuthenticated = true;
            log('Connection successful!');
        }

        // Add message event handler
        setupMessageHandler();

        return client;
    } catch (error) {
        log('Failed to start Telegram client: ' + error);
        throw error;
    }
}

/**
 * Set up event handlers for new messages
 */
function setupMessageHandler() {
    if (!client) {
        log('Client not initialized. Call startClient() first');
        return;
    }

    log('Setting up message handlers...');
    log(`Tracking channels: ${config.telegram_channels.join(', ')}`);

    // Add event handler for new messages
    client.addEventHandler(async (event) => {
        try {
            // Check if this is a message event
            if (event.className === 'UpdateNewMessage' || event.className === 'UpdateNewChannelMessage') {
                const message = event.message;

                if (!message) {
                    log('Skipping: No message in event');
                    return;
                }
                
                if (!message.peerId) {
                    log('Skipping: No peerId in message');
                    return;
                }
                
                try {
                    // Get the chat entity from peerId
                    const chat = await client.getEntity(message.peerId);

                    if (!chat) {
                        log('Skipping: Could not retrieve chat entity');
                        return;
                    }
                    
                    const chatTitle = chat.firstName;
                    const messageText = message.message || '';
                    
                    // Check if this is a tracked channel
                    if (config.telegram_channels.includes(chatTitle)) {
                        log(`Message is from a tracked channel: ${chatTitle}`);
                        
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
                            log('Message handler not set or message empty.');
                        }
                    }
                } catch (error) {
                    log('Error retrieving or processing chat entity: ' + error);
                }
            }
        } catch (error) {
            log('Error processing message: ' + error);
        }
    });
}

/**
 * Stop the Telegram client
 * @returns {Promise<void>}
 */
async function stopClient() {
    if (!client) {
        log('Client is not running');
        return;
    }
    
    try {
        await client.disconnect();
        client = null;
        log('Telegram client has been disconnected');
    } catch (error) {
        log('Error stopping client: ' + error);
    }
}

/**
 * Get the last message from a specific channel
 * @param {string|number} chatIdentifier - The chat ID or title to get messages from
 * @returns {Promise<Object|null>} The last message object or null if not found
 */
async function getLastMessage(chatIdentifier) {
    if (!client) {
        log('Client not initialized. Call startClient() first');
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
                log(`Could not find channel with title: ${chatIdentifier}`);
                return null;
            }
        }

        // Get the last message from the chat
        const messages = await client.getMessages(chat, {
            limit: 2,
        });

        log('messages: ' + JSON.stringify(messages.map(msg => msg.message)));

        if (messages && messages.length > 0) {
            return messages.map(msg => msg.message);
        }

        return null;
    } catch (error) {
        log('Error getting last message: ' + error);
        return null;
    }
}

module.exports = {
    setMessageHandler,
    startClient,
    stopClient,
    getLastMessage
};
