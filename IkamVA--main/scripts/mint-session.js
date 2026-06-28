const jwt = require('jsonwebtoken');
const fs = require('fs');

const clientId = process.argv[2];
if (!clientId) {
    console.error("Error: Please provide a Client UUID. Example: node scripts/mint-session.js <UUID>");
    process.exit(1);
}

// Signs a mock session token using a default test secret
const secret = process.env.JWT_SECRET || 'super-secret-development-token-key-32-chars';
const token = jwt.sign({ clientId: clientId, role: 'authenticated' }, secret, { expiresIn: '1h' });

console.log("\n================ MINTED SESSION TOKEN ================");
console.log(token);
console.log("======================================================\n");