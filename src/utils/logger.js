const config = require('../../config/config.json');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = path.join(logsDir, 'bot-activity.log');

function formatTimestamp() {
    const now = new Date();
    const options = {
        timeZone: 'Australia/Sydney',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        hour12: false,
    };

    // Use Intl.DateTimeFormat for robust timezone handling. 'en-GB' gives dd/mm format.
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    return `${parts.hour}:${parts.minute}-${parts.day}/${parts.month}`;
}

function formatFullTimestamp() {
    const now = new Date();
    const sydneyTime = now.toLocaleString('sv-SE', {
        timeZone: 'Australia/Sydney',
        hour12: false,
    });

    const [date, time] = sydneyTime.split(' ');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    return `${date}T${time}.${milliseconds}`;
}

function log(message, saveToFile = false) {
    const timestamp = config.logging?.show_timestamps ? `[${formatTimestamp()}] ` : '';
    const consoleMessage = `${timestamp}${message}`;
    
    // Always log to console
    console.log(consoleMessage);
    
    // Save to file if requested
    if (saveToFile) {
        const fullTimestamp = formatFullTimestamp();
        const fileMessage = `[${fullTimestamp}] ${message}\n`;
        
        try {
            fs.appendFileSync(logFilePath, fileMessage, 'utf8');
        } catch (error) {
            console.error(`Failed to write to log file: ${error.message}`);
        }
    }
}

module.exports = {
    log
}; 