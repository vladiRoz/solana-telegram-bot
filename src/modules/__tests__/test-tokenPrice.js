require("dotenv").config({ path: "../../../.env" });
const SolanaTrader = require("../solanaTrader");
const { log } = require("../../utils/logger");

const tokenAddress = "J7gaM1P2fVpivP9sRpyno8j6SGwUSffTADnWFQvqpump";

async function testHandleTokenPrice() {
    log("Testing FIXED getTokenPrice function...");

    try {
        const solanaTrader = new SolanaTrader();
        
        log("Getting price with decimal correction...");
        const price = await solanaTrader.getTokenPrice(tokenAddress);
        
        log(`Function returned: $${price}`);

    } catch (error) {
        log(`Test error: ${error.message}`);
    }
}

// Main test execution
async function runAllTests() {
    await testHandleTokenPrice();
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        log(`Test execution failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    runAllTests
}; 