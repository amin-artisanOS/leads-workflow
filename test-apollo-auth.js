import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.APOLLO_API_KEY;
const domain = "google.com";

async function testHeader() {
    console.log("--- Testing Header x-api-key ---");
    try {
        const res = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
            q_organization_domains: domain,
            page: 1,
            per_page: 1
        }, {
            headers: {
                'x-api-key': key,
                'Content-Type': 'application/json'
            }
        });
        console.log("Header success:", res.data.people?.length, "results");
    } catch (e) {
        console.log("Header error:", e.response?.status, e.response?.data);
    }
}

async function testBody() {
    console.log("\n--- Testing Body api_key ---");
    try {
        const res = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
            api_key: key,
            q_organization_domains: domain,
            page: 1,
            per_page: 1
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log("Body success:", res.data.people?.length, "results");
    } catch (e) {
        console.log("Body error:", e.response?.status, e.response?.data);
    }
}

async function testBearer() {
    console.log("\n--- Testing Bearer Authorization ---");
    try {
        const res = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
            q_organization_domains: domain,
            page: 1,
            per_page: 1
        }, {
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Bearer success:", res.data.people?.length, "results");
    } catch (e) {
        console.log("Bearer error:", e.response?.status, e.response?.data);
    }
}

const run = async () => {
    await testHeader();
    await testBody();
    await testBearer();
}
run();
