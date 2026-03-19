const Apify = require('apify');

// Initialize Apify
Apify.main(async () => {
    const { log } = Apify.utils;

    // Get input data from the actor input or use environment variables
    const input = await Apify.getInput() || {};
    
    // Fallback to environment variables if input is not provided
    const config = {
        searchUrl: input.searchUrl || process.env.LINKEDIN_SEARCH_URL,
        maxResults: input.maxResults || parseInt(process.env.MAX_RESULTS) || 100,
        debugLog: input.debugLog || process.env.DEBUG_LOG === 'true'
    };
    
    if (!config.searchUrl) {
        throw new Error('LinkedIn search URL is required. Please provide LINKEDIN_SEARCH_URL environment variable or pass it in the input.');
    }
    
    // Enable debug logging if needed
    if (config.debugLog) {
        log.setLevel(log.LEVELS.DEBUG);
    }
    // Configure proxy
    const proxyConfig = config.proxyConfiguration || { useApifyProxy: true };
    if (proxyConfig.useApifyProxy) {
        proxyConfig.apifyProxyGroups = proxyConfig.apifyProxyGroups || ['RESIDENTIAL'];
    }

    // Initialize dataset
    const dataset = await Apify.openDataset();
    const requestQueue = await Apify.openRequestQueue();
    
    // Add the initial request
    await requestQueue.addRequest({
        url: config.searchUrl,
        userData: {
            label: 'SEARCH',
            page: 1
        }
    });

    // Create a custom session pool
    const sessionPool = await Apify.openSessionPool({
        maxPoolSize: 10,
        sessionOptions: {
            maxUsageCount: 50,
        },
    });

    // Create the crawler
    const crawler = new Apify.PlaywrightCrawler({
        requestQueue,
        sessionPool,
        proxyConfiguration: proxyConfig.useApifyProxy 
            ? await Apify.createProxyConfiguration(proxyConfig)
            : undefined,
        useSessionPool: true,
        sessionPoolOptions: {
            sessionOptions: {
                maxUsageCount: 50,
            },
        },
        maxConcurrency: 5,
        maxRequestRetries: 10,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 300,
        handlePageFunction: async (context) => {
            const { request, page, session } = context;
            const { label, page: pageNumber } = request.userData;

            log.info(`Processing ${label} page ${pageNumber || 1}...`);

            if (label === 'SEARCH') {
                await handleSearchPage(context);
            } else if (label === 'JOB') {
                await handleJobPage(context);
            }
        },
        handleFailedRequestFunction: async ({ request, error }) => {
            log.error(`Request ${request.url} failed and will be retried`, error);
        },
    });

    // Start the crawler
    log.info('Starting the crawl...');
    await crawler.run();
    log.info('Crawl finished.');

    // Helper function to handle search pages
    async function handleSearchPage({ page, request, session, enqueueLinks, requestQueue }) {
        try {
            // Wait for job cards to load
            await page.waitForSelector('.jobs-search__results-list', { timeout: 30000 });
            
            // Extract job URLs from the search results
            const jobUrls = await page.$$eval(
                'a[data-tracking-control-name="public_jobs_jserp-result_search-card"]',
                (links) => links.map(link => link.href)
            );

            log.info(`Found ${jobUrls.length} jobs on page ${request.userData.page}`);

            // Enqueue job detail pages
            for (const jobUrl of jobUrls) {
                await requestQueue.addRequest({
                    url: jobUrl,
                    userData: {
                        label: 'JOB',
                        searchUrl: request.url,
                        searchPage: request.userData.page
                    }
                });
            }

            // Check for next page and enqueue if exists
            const nextPageExists = await page.$('button[aria-label*="Next"]:not([disabled])');
            if (nextPageExists && (request.userData.page * 25) < config.maxResults) {
                await page.click('button[aria-label*="Next"]');
                await page.waitForLoadState('networkidle');
                
                const nextPageUrl = page.url();
                if (nextPageUrl !== request.url) {
                    await requestQueue.addRequest({
                        url: nextPageUrl,
                        userData: {
                            label: 'SEARCH',
                            page: request.userData.page + 1
                        }
                    });
                }
            }
        } catch (error) {
            log.error(`Error processing search page: ${error.message}`);
            throw error;
        }
    }

    // Helper function to handle job detail pages
    async function handleJobPage({ page, request, session }) {
        try {
            await page.waitForSelector('.top-card-layout__title', { timeout: 30000 });
            
            const jobData = await page.evaluate(() => {
                // Extract basic job information
                const title = document.querySelector('.top-card-layout__title')?.textContent?.trim() || '';
                const companyName = document.querySelector('.topcard__org-name-link')?.textContent?.trim() || 
                                 document.querySelector('.topcard__flavor--black-link')?.textContent?.trim() || '';
                const location = document.querySelector('.topcard__flavor--topcard .topcard__flavor--bullet')?.textContent?.trim() || 
                              document.querySelector('.topcard__flavor--topcard .topcard__flavor')?.textContent?.trim() || '';
                
                // Extract salary information if available
                let salaryInfo = [];
                const salaryElement = Array.from(document.querySelectorAll('.description__job-criteria-text'))
                    .find(el => el.textContent.toLowerCase().includes('salary'));
                if (salaryElement) {
                    const salaryText = salaryElement.parentElement?.querySelector('.description__job-criteria-text--criteria')?.textContent?.trim();
                    if (salaryText) {
                        salaryInfo = salaryText.split('-').map(s => s.trim()).filter(Boolean);
                    }
                }

                // Extract job description
                const descriptionElement = document.querySelector('.show-more-less-html__markup');
                let descriptionHtml = '';
                let descriptionText = '';
                
                if (descriptionElement) {
                    descriptionHtml = descriptionElement.innerHTML;
                    descriptionText = descriptionElement.textContent?.trim() || '';
                }

                // Extract company details
                const companyLinkedinUrl = document.querySelector('.topcard__org-name-link')?.href || 
                                         document.querySelector('.topcard__flavor--black-link')?.href || '';
                const companyLogo = document.querySelector('.topcard__org-image-logo')?.src || '';
                
                // Extract job metadata
                const postedAt = document.querySelector('.posted-time-ago__text')?.textContent?.trim() || '';
                const applicantsCount = document.querySelector('.num-applicants__caption')?.textContent?.trim() || '';
                
                // Extract job poster info if available
                const jobPosterElement = document.querySelector('.hirer-card__hirer-inner');
                let jobPosterName = '';
                let jobPosterTitle = '';
                let jobPosterPhoto = '';
                let jobPosterProfileUrl = '';
                
                if (jobPosterElement) {
                    jobPosterName = jobPosterElement.querySelector('h3')?.textContent?.trim() || '';
                    jobPosterTitle = jobPosterElement.querySelector('h4')?.textContent?.trim() || '';
                    jobPosterPhoto = jobPosterElement.querySelector('img')?.src || '';
                    jobPosterProfileUrl = jobPosterElement.querySelector('a')?.href || '';
                }
                
                // Extract job criteria
                const criteria = {};
                document.querySelectorAll('.description__job-criteria-item').forEach(item => {
                    const key = item.querySelector('.description__job-criteria-subheader')?.textContent?.trim()?.toLowerCase() || '';
                    const value = item.querySelector('.description__job-criteria-text--criteria')?.textContent?.trim() || '';
                    if (key) {
                        criteria[key] = value;
                    }
                });

                // Extract company details if available
                const companySection = document.querySelector('.topcard__flavor--bottom');
                let companyDescription = '';
                let companyWebsite = '';
                let companyEmployeesCount = '';
                
                if (companySection) {
                    companyDescription = companySection.textContent?.trim() || '';
                    companyWebsite = companySection.querySelector('a')?.href || '';
                    
                    // Extract employee count if available
                    const employeeCountText = companySection.textContent?.match(/(\d{1,3}(?:,\d{3})*)\s*employees?/i);
                    if (employeeCountText) {
                        companyEmployeesCount = employeeCountText[1].replace(/,/g, '');
                    }
                }

                return {
                    id: (new URL(window.location.href).pathname.split('/').pop() || '').split('?')[0],
                    link: window.location.href,
                    title,
                    companyName,
                    companyLinkedinUrl,
                    companyLogo,
                    location,
                    salaryInfo,
                    postedAt,
                    benefits: [], // LinkedIn doesn't show benefits on the job page
                    descriptionHtml,
                    descriptionText,
                    applicantsCount,
                    applyUrl: document.querySelector('.apply-button')?.href || '',
                    jobPosterName,
                    jobPosterTitle,
                    jobPosterPhoto,
                    jobPosterProfileUrl,
                    ...criteria,
                    companyDescription,
                    companyWebsite,
                    companyEmployeesCount,
                    scrapedAt: new Date().toISOString()
                };
            });

            // Apply extendOutputFunction if provided
            if (extendOutputFunction) {
                try {
                    const extendedData = await page.evaluate((extendFunction) => {
                        try {
                            const func = new Function('data', extendFunction);
                            return func(jobData);
                        } catch (e) {
                            console.error('Error in extendOutputFunction:', e);
                            return jobData;
                        }
                    }, extendOutputFunction);
                    
                    Object.assign(jobData, extendedData);
                } catch (e) {
                    log.error('Failed to extend output:', e);
                }
            }

            // Save the job data
            await dataset.pushData(jobData);
            log.info(`Scraped job: ${jobData.title} at ${jobData.companyName}`);
            
        } catch (error) {
            log.error(`Error processing job page ${request.url}: ${error.message}`);
            throw error;
        }
    }
});
