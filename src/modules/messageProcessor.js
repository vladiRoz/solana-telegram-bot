const bs58 = require("bs58");
const { getLastMessage } = require("./telegramListener");
const { log } = require("../utils/logger");
// Remove reference to old bot
// const { bot } = require("./telegramListener"); // For re-verification

// Regex to find Solana addresses (32-44 base58 characters)
// Plain base58: \b[1-9A-HJ-NP-Za-km-z]{32,44}\b
// Text-embedded: might be preceded/followed by text, look for the pattern
// URL: dexscreener.com/solana/<address>
const SOLANA_ADDRESS_REGEX_BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}(?:pump)?/g;
const SOLANA_ADDRESS_LENGTH_MIN = 32;
const SOLANA_ADDRESS_LENGTH_MAX = 44;

function isValidSolanaAddress(address) {
    if (!address || typeof address !== "string") return false;
    if (address.length < SOLANA_ADDRESS_LENGTH_MIN || address.length > SOLANA_ADDRESS_LENGTH_MAX) return false;
    
    // Special case for pump.fun addresses
    if (address.endsWith('pump')) {
        return true;
    }
    
    try {
        bs58.decode(address); // Only check that it decodes without error
        return true;
    } catch (e) {
        return false;
    }
}

function extractSolanaAddresses(messageText) {
    if (!messageText || typeof messageText !== "string") return null;

    if (/dexscreener\.com/i.test(messageText)) {
        return null;
    }

    // Look for any valid base58 address
    const base58Matches = messageText.match(SOLANA_ADDRESS_REGEX_BASE58);
    
    if (base58Matches) {
        for (const addr of base58Matches) {
            if (isValidSolanaAddress(addr)) {
                log('Found valid address: ' + addr);
                return addr;
            }
        }
    }

    log('No valid address found');
    return null;
}

async function processMessage(msg) {
    const messageText = msg.text;
    const messageId = msg.message_id;
    const chatTitle = msg.chat.title;

    if (!messageText) {
        log("Message has no text, skipping.", true);
        return null;
    }

    const address = extractSolanaAddresses(messageText);

    if (address === null) {
        return null;
    }

    log(`Found potential Solana address in message from ${chatTitle}: ${address}`, true);

    // 1. Wait 30 seconds
    log(`Waiting 30 seconds before re-verifying message for address ${address}...`, true);
    await new Promise(resolve => setTimeout(resolve, 20000)); // 30 seconds
    log('-----------------------------------------------------------------', true);

    // 2. Verify message still exists using getLastMessage
    log(`Re-verifying message ${messageId} in chat ${chatTitle} for address ${address}...`, true);

    const lastMessages = await getLastMessage(chatTitle);
    
    if (!lastMessages) {
        log(`Could not retrieve last message from ${chatTitle}, skipping...`, true);
        return null;
    }

    // run extractSolanaAddresses for each message
    const lastMessageAddress = lastMessages.map(msg => extractSolanaAddresses(msg));
    log('lastMessageAddress ' + JSON.stringify(lastMessageAddress), true);

    // check if the last message contains the same address
    if (!lastMessageAddress.includes(address)) {
        log(`Address ${address} no longer exists in the last message of ${chatTitle}, skipping...`, true);
        return null;
    }

    return address;
}

module.exports = {
    extractSolanaAddresses,
    isValidSolanaAddress,
    processMessage
};
