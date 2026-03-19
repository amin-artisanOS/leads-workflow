# LinkedIn Jobs Scraper

A powerful LinkedIn job scraper built with Apify and Playwright that extracts detailed job listings from LinkedIn search results.

## Features

- Scrapes job details including title, company, location, salary, description, and more
- Handles pagination automatically
- Uses Apify Proxy to avoid IP blocks
- Supports custom output extensions
- Extracts company details when available
- Handles job poster information

## Prerequisites

- Node.js 16 or higher
- Apify account (for Apify Proxy)
- Apify CLI (optional, for local development)

## Installation

1. Install dependencies:
   ```bash
   npm install apify axios cheerio
   ```

2. Configure your LinkedIn search URL in `config.js`

## Usage

### Basic Usage

1. Update the `searchUrl` in `config.js` with your LinkedIn jobs search URL
2. Run the scraper:
   ```bash
   npx apify run -p ./linkedin-scraper
   ```

### Advanced Usage

You can customize the scraper behavior by modifying the `config.js` file:

```javascript
module.exports = {
    // Your LinkedIn jobs search URL
    searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=United%20States',
    
    // Maximum number of results to scrape (default: 100)
    maxResults: 200,
    
    // Proxy configuration
    proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
    },
    
    // Enable debug logging
    debugLog: true,
    
    // Optional: Extend output with custom data
    extendOutputFunction: `
        // This function receives the scraped job data
        // You can add or modify properties here
        data.customField = 'Custom Value';
        return data;
    `
};
```

### Output Format

The scraper outputs data in the following format:

```json
{
    "id": "3692563200",
    "link": "https://www.linkedin.com/jobs/view/3692563200",
    "title": "Senior Software Engineer",
    "companyName": "Tech Corp",
    "companyLinkedinUrl": "https://www.linkedin.com/company/tech-corp",
    "companyLogo": "https://example.com/logo.png",
    "location": "San Francisco, CA",
    "salaryInfo": ["$120,000", "$150,000"],
    "postedAt": "2 weeks ago",
    "descriptionHtml": "<p>Job description HTML</p>",
    "descriptionText": "Job description text",
    "applicantsCount": "25",
    "applyUrl": "https://www.linkedin.com/apply/123",
    "jobPosterName": "John Doe",
    "jobPosterTitle": "Technical Recruiter",
    "jobPosterPhoto": "https://example.com/photo.jpg",
    "jobPosterProfileUrl": "https://www.linkedin.com/in/johndoe",
    "seniority level": "Mid-Senior level",
    "employment type": "Full-time",
    "job function": "Engineering",
    "industries": "Technology, Information and Internet",
    "companyDescription": "Company description...",
    "companyWebsite": "https://techcorp.com",
    "companyEmployeesCount": "1001-5000",
    "scrapedAt": "2023-08-16T12:00:00.000Z"
}
```

## Running with Docker

1. Build the Docker image:
   ```bash
   docker build -t linkedin-jobs-scraper .
   ```

2. Run the container:
   ```bash
   docker run -e APIFY_PROXY_PASSWORD=your_apify_proxy_password -e LINKEDIN_SEARCH_URL='your_search_url' linkedin-jobs-scraper
   ```

## Limitations

- LinkedIn may block scrapers, so using residential proxies is recommended
- The scraper might break if LinkedIn changes their HTML structure
- Some job details might be behind authentication walls

## License

MIT
