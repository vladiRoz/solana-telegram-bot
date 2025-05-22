const bs58 = require('bs58');

// Helper function to convert JSON array private key to base58
function convertPrivateKeyToBase58(privateKeyJson) {
    try {
        // Parse the JSON string if it's a string
        const privateKeyArray = typeof privateKeyJson === 'string' ? JSON.parse(privateKeyJson) : privateKeyJson;
        
        // Convert array to Uint8Array
        const privateKeyBytes = new Uint8Array(privateKeyArray);
        
        // Convert to base58
        return bs58.encode(privateKeyBytes);
    } catch (error) {
        console.error('Error converting private key:', error);
        throw new Error('Failed to convert private key to base58 format');
    }
}

module.exports = {
    convertPrivateKeyToBase58
};