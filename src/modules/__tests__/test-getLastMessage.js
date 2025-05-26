require('dotenv').config();
const { startClient, getLastMessage } = require('../telegramListener');

async function testGetLastMessage() {
    try {
        console.log('Starting Telegram client...');
        await startClient();
        
        // Try different variations of the channel identifier
        const channelIdentifiers = [
            'TangerineTrip',  // Original name
        ];

        console.log('\nTrying different channel identifiers...');
        
        for (const identifier of channelIdentifiers) {
            console.log(`\nTrying identifier: ${identifier}`);
            try {
                const lastMessage = await getLastMessage(identifier);
                
                if (lastMessage) {
                    console.log('\nLast message details:', lastMessage);
                    break; // Exit loop if we found a message
                } else {
                    console.log('No message found for this identifier');
                }
            } catch (error) {
                console.log(`Error with identifier ${identifier}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error during test:', error);
    } finally {
        // Keep the process running for a while to allow the client to fetch messages
        console.log('\nTest completed. Press Ctrl+C to exit.');
    }
}

// Run the test
testGetLastMessage(); 