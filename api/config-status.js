export default function handler(req, res) {
    const status = {
        apify: process.env.APIFY_TOKEN && process.env.APIFY_TOKEN.startsWith('apify_api_'),
        apollo: process.env.APOLLO_API_KEY && process.env.APOLLO_API_KEY.length > 10,
        gemini: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIzaSy')
    };

    const allConfigured = Object.values(status).every(Boolean);

    res.status(200).json({
        configured: allConfigured,
        status: status,
        message: allConfigured
            ? 'All API keys configured ✓'
            : 'Some API keys need to be configured in Vercel environment variables'
    });
}
