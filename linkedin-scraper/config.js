module.exports = {
    // LinkedIn search URL (e.g., "https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=United%20States")
    searchUrl: '',
    
    // Maximum number of results to scrape (default: 100)
    maxResults: 100,
    
    // Proxy configuration
    proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'], // Use residential proxies to avoid blocks
    },
    
    // Enable debug logging
    debugLog: false,
    
    // Optional: Function to extend the output data
    // This function will receive the scraped job data and should return an object with additional properties
    extendOutputFunction: null,
    
    // Optional: Custom function to modify the scraper behavior
    // This function will receive the Playwright page object and the current job data
    extendScraperFunction: null
};
