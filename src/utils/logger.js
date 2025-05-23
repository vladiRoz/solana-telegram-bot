const config = require('../../config/config.json');

function formatTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${hours}:${minutes}-${day}/${month}`;
}

function log(message) {
    const timestamp = config.logging?.show_timestamps ? `[${formatTimestamp()}] ` : '';
    console.log(`${timestamp}${message}`);
}

module.exports = {
    log
}; 