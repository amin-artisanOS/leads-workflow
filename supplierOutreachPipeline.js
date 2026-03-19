#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPLIER_CONFIG_FILE = path.join(__dirname, 'supplier-config.json');
const OUTPUT_DIR = path.join(__dirname, 'supplier_outreach_runs');

// Parse CLI arguments
const args = process.argv.slice(2);
function getArgValue(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

const configPath = getArgValue('--config') || SUPPLIER_CONFIG_FILE;
const productFilter = getArgValue('--product');
const countryFilter = getArgValue('--country');
const skipGenerate = args.includes('--skip-generate');
const skipScrape = args.includes('--skip-scrape');
const skipQualify = args.includes('--skip-qualify');
const skipApollo = args.includes('--skip-apollo');
const skipEmails = args.includes('--skip-emails');
const dryRun = args.includes('--dry-run');

console.log('🏪 Supplier Outreach Pipeline\n');

// Load supplier configuration
let config;
try {
  const raw = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(raw);
  console.log(`✅ Loaded supplier config from ${configPath}`);
} catch (error) {
  console.error(`🔴 Failed to load supplier config from ${configPath}`);
  console.error(error.message);
  process.exit(1);
}

// Apply filters
if (productFilter) {
  const filtered = config.products.filter(p =>
    p.name.toLowerCase().includes(productFilter.toLowerCase()) ||
    p.category.toLowerCase().includes(productFilter.toLowerCase())
  );
  if (filtered.length === 0) {
    console.error(`🔴 No products matched filter: ${productFilter}`);
    process.exit(1);
  }
  config.products = filtered;
  console.log(`🔍 Filtered to products: ${filtered.map(p => p.name).join(', ')}`);
}

if (countryFilter) {
  const filtered = countryFilter
    .split(',')
    .map((c) => c.trim())
    .filter((c) => config.targetCountries.includes(c));
  if (filtered.length === 0) {
    console.error(`🔴 No countries matched filter: ${countryFilter}`);
    process.exit(1);
  }
  config.targetCountries = filtered;
  console.log(`🔍 Filtered to countries: ${filtered.join(', ')}`);
}

console.log(`\n📊 Supplier Outreach Configuration:`);
console.log(`   Products: ${config.products.length}`);
console.log(`   Countries: ${config.targetCountries.length}`);
console.log(`   Supplier Titles: ${config.supplierTitles.length}`);
console.log(`   Total combinations: ${config.products.length * config.targetCountries.length}\n`);

if (dryRun) {
  console.log('🏃 Dry run mode - no actions will be executed\n');
  process.exit(0);
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const runDir = path.join(OUTPUT_DIR, `run_${timestamp}`);
fs.mkdirSync(runDir, { recursive: true });

// Save run config
fs.writeFileSync(
  path.join(runDir, 'supplier_config.json'),
  JSON.stringify(config, null, 2),
  'utf8'
);

console.log(`📁 Run directory: ${runDir}\n`);

// Helper to run a command
function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`▶️  ${description}`);
    console.log(`${'='.repeat(60)}\n`);

    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: __dirname
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${description} completed successfully\n`);
        resolve();
      } else {
        console.error(`\n🔴 ${description} failed with exit code ${code}\n`);
        reject(new Error(`${description} failed`));
      }
    });

    proc.on('error', (error) => {
      console.error(`\n🔴 Failed to start ${description}`);
      console.error(error);
      reject(error);
    });
  });
}

// Pipeline stages
async function runPipeline() {
  const urlsFile = path.join(runDir, 'supplier_linkedin_urls.json');
  const scrapedFile = path.join(runDir, 'supplier_jobs.json');
  const qualifiedFile = path.join(runDir, 'qualified_suppliers.json');
  const apolloDir = path.join(runDir, 'supplier_contacts');
  const emailsDir = path.join(runDir, 'supplier_emails');

  try {
    // Stage 1: Generate LinkedIn URLs for supplier discovery
    if (!skipGenerate) {
      // Create ICP config for suppliers
      const icpConfig = {
        titles: config.supplierTitles,
        industries: config.industries,
        locations: config.targetCountries,
        experienceLevels: config.experienceLevels,
        companySize: config.companySize,
        scraping: config.scraping,
        apollo: config.apollo
      };

      const tempConfig = path.join(runDir, 'temp_icp_config.js');
      const configContent = `export const ICP_CONFIG = ${JSON.stringify(icpConfig, null, 2)};`;
      fs.writeFileSync(tempConfig, configContent, 'utf8');

      await runCommand(
        'node',
        ['generateICPLinkedInURLs.js'],
        'Step 1: Generate LinkedIn URLs for Supplier Discovery'
      );

      // Move generated files to run directory
      const generatedFile = path.join(__dirname, 'linkedin_icp_urls_by_country_niche.json');
      if (fs.existsSync(generatedFile)) {
        fs.renameSync(generatedFile, urlsFile);
        console.log(`📄 Supplier URLs saved to ${urlsFile}`);
      }
    } else {
      console.log('⏭️  Skipping URL generation');
    }

    // Stage 2: Scrape LinkedIn supplier jobs
    if (!skipScrape && fs.existsSync(urlsFile)) {
      const urls = JSON.parse(fs.readFileSync(urlsFile, 'utf8'));
      const allJobs = [];

      for (let i = 0; i < urls.length; i++) {
        const entry = urls[i];
        console.log(`\n📥 Scraping ${i + 1}/${urls.length}: ${entry.niche} - ${entry.location}`);

        const outputFile = path.join(runDir, `scrape_${i}_${entry.location}_${entry.niche.replace(/[^a-z0-9]/gi, '_')}.json`);

        await runCommand(
          'node',
          [
            'linkedinJobsScraper.js',
            `--url="${entry.url}"`,
            `--count=${config.scraping.jobsPerCountry}`,
            `--output-dir="${runDir}"`
          ],
          `Scraping Suppliers: ${entry.niche} - ${entry.location}`
        );

        // Find the most recent scraped file
        const files = fs.readdirSync(runDir)
          .filter(f => f.startsWith('linkedin_jobs_results_'))
          .sort()
          .reverse();

        if (files.length > 0) {
          const latestFile = path.join(runDir, files[0]);
          const jobs = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
          allJobs.push(...jobs);
        }
      }

      fs.writeFileSync(scrapedFile, JSON.stringify(allJobs, null, 2), 'utf8');
      console.log(`\n✅ Total supplier jobs scraped: ${allJobs.length}`);
      console.log(`📄 Saved to ${scrapedFile}`);
    } else {
      console.log('⏭️  Skipping supplier scraping');
    }

    // Stage 3: Qualify suppliers with Gemini
    if (!skipQualify && fs.existsSync(scrapedFile)) {
      const titlesArg = config.supplierTitles.join(',');
      await runCommand(
        'node',
        [
          'supplierQualifier.js',
          `--input="${scrapedFile}"`,
          `--output="${qualifiedFile}"`,
          `--products="${JSON.stringify(config.products)}"`,
          `--titles="${titlesArg}"`
        ],
        'Step 3: Qualify Suppliers with Gemini AI'
      );

      // Move Gemini outputs to run directory
      const geminiOutputs = [
        'supplier_qualified_jobs_gemini.json',
        'supplier_rejected_jobs_gemini.json',
        'supplier_apollo_input_candidates_gemini.json'
      ];

      geminiOutputs.forEach((file) => {
        const fullPath = path.join(__dirname, file);
        if (fs.existsSync(fullPath)) {
          const basename = path.basename(file);
          fs.renameSync(fullPath, path.join(runDir, basename));
        }
      });
    } else {
      console.log('⏭️  Skipping supplier qualification');
    }

    // Stage 4: Enrich with Apollo.io for supplier contacts
    if (!skipApollo) {
      const qualifiedInput = path.join(runDir, 'supplier_qualified_jobs_gemini.json');
      if (fs.existsSync(qualifiedInput)) {
        fs.mkdirSync(apolloDir, { recursive: true });

        await runCommand(
          'node',
          [
            'apolloEnricher.js',
            `--input="${qualifiedInput}"`,
            `--output-dir="${apolloDir}"`,
            `--max-leads=${config.apollo.leadsPerCompany || 3}`
          ],
          'Step 4: Enrich Supplier Contacts with Apollo.io'
        );
      } else {
        console.log('⚠️  No qualified suppliers file found, skipping Apollo enrichment');
      }
    } else {
      console.log('⏭️  Skipping Apollo enrichment');
    }

    // Stage 5: Generate supplier outreach emails
    if (!skipEmails) {
      const contactsInput = path.join(runDir, 'supplier_qualified_jobs_gemini.json');
      if (fs.existsSync(contactsInput)) {
        fs.mkdirSync(emailsDir, { recursive: true });

        await runCommand(
          'node',
          [
            'supplierEmailGenerator.js',
            `--leads="${contactsInput}"`,
            `--products="${JSON.stringify(config.products)}"`,
            `--config="${configPath}"`,
            `--output-dir="${emailsDir}"`
          ],
          'Step 5: Generate Supplier Outreach Emails'
        );
      } else {
        console.log('⚠️  No supplier contacts found, skipping email generation');
      }
    } else {
      console.log('⏭️  Skipping email generation');
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Supplier outreach pipeline completed successfully!');
    console.log('='.repeat(60));
    console.log(`\n📁 All outputs saved to: ${runDir}\n`);
    console.log('📋 Next Steps:');
    console.log('1. Review qualified suppliers in supplier_qualified_jobs_gemini.json');
    console.log('2. Check supplier contacts in supplier_contacts/');
    console.log('3. Review generated emails in supplier_emails/');
    console.log('4. Run email verification: npm run verify-emails -- --input-csv=supplier_emails/emails.csv');
    console.log('5. Start automated outreach with the email infrastructure');

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('🔴 Supplier pipeline failed');
    console.error('='.repeat(60));
    console.error(error);
    process.exit(1);
  }
}

runPipeline();
