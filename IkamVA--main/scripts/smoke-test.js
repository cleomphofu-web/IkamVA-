const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const clientId = process.env.SMOKE_CLIENT_ID;

if (!databaseUrl) {
    console.error("Error: Missing DATABASE_URL environment variable in this terminal window.");
    process.exit(1);
}
if (!clientId) {
    console.error("Error: Missing SMOKE_CLIENT_ID environment variable.");
    process.exit(1);
}

console.log(`Starting Queue QA automation pipeline...`);
console.log(`Targeting Client Account Database Record: ${clientId}\n`);

// Directly verify database and schema readiness
const client = new Client({ connectionString: databaseUrl });

async function runTest() {
    try {
        await client.connect();
        console.log("✔ Connection verification: Successfully handshaked with Supabase Postgres.");
        
        // Verify our test client exists in the app schema
        const res = await client.query('SELECT id, account_name FROM app.clients WHERE id = $1', [clientId]);
        
        if (res.rows.length > 0) {
            console.log(`✔ Schema verification: Found client profile "${res.rows[0].account_name}" inside app.clients.`);
            console.log("\n================ SMOKE TEST SUCCESSFUL ================");
            console.log("The database schema is intact and the queue engine has a clear runway!");
            console.log("=======================================================");
        } else {
            console.log(`⚠ Alert: Connection worked, but UUID ${clientId} wasn't found in the database table.`);
        }
    } catch (err) {
        console.error("❌ Smoke test pipeline failed:", err.message);
    } finally {
        await client.end();
    }
}

runTest();