#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'icp-config.json');
const OUTPUT_DIR = path.join(__dirname, 'pipeline_runs');

// Parse CLI arguments
const args = process.argv.slice(2);
function getArgValue(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

const configPath = getArgValue('--config') || CONFIG_FILE;
const industryFilter = getArgValue('--industry');
const countryFilter = getArgValue('--country');
const skipGenerate = args.includes('--skip-generate');
const skipScrape = args.includes('--skip-scrape');
const skipQualify = args.includes('--skip-qualify');
const skipApollo = args.includes('--skip-apollo');
const dryRun = args.includes('--dry-run');

console.log('🚀 Lead Generation Pipeline\n');

// Load configuration
let config;
try {
  const raw = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(raw);
  console.log(`✅ Loaded config from ${configPath}`);
} catch (error) {
  console.error(`🔴 Failed to load config from ${configPath}`);
  console.error(error.message);
  process.exit(1);
}

// Apply filters
if (industryFilter) {
  const filtered = {};
  industryFilter.split(',').forEach((ind) => {
    const key = Object.keys(config.industries).find(
      (k) => k.toLowerCase().includes(ind.toLowerCase())
    );
    if (key) {
      filtered[key] = config.industries[key];
    }
  });
  if (Object.keys(filtered).length === 0) {
    console.error(`🔴 No industries matched filter: ${industryFilter}`);
    process.exit(1);
  }
  config.industries = filtered;
  console.log(`🔍 Filtered to industries: ${Object.keys(filtered).join(', ')}`);
}

if (countryFilter) {
  const filtered = countryFilter
    .split(',')
    .map((c) => c.trim())
    .filter((c) => config.locations.includes(c));
  if (filtered.length === 0) {
    console.error(`🔴 No countries matched filter: ${countryFilter}`);
    process.exit(1);
  }
  config.locations = filtered;
  console.log(`🔍 Filtered to countries: ${filtered.join(', ')}`);
}

console.log(`\n📊 Pipeline Configuration:`);
console.log(`   Industries: ${Object.keys(config.industries).length}`);
console.log(`   Countries: ${config.locations.length}`);
console.log(`   Titles: ${config.titles.length}`);
console.log(`   Total URL combinations: ${Object.keys(config.industries).length * config.locations.length}\n`);

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
  path.join(runDir, 'config.json'),
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
  const urlsFile = path.join(runDir, 'linkedin_urls.json');
  const scrapedFile = path.join(runDir, 'scraped_jobs.json');
  const qualifiedFile = path.join(runDir, 'qualified_jobs.json');
  const apolloDir = path.join(runDir, 'apollo_output');

  try {
    // Stage 1: Generate LinkedIn URLs
    if (!skipGenerate) {
      // Write temporary config for generator
      const tempConfig = path.join(runDir, 'temp_icp_config.js');
      const configContent = `export const ICP_CONFIG = ${JSON.stringify(config, null, 2)};`;
      fs.writeFileSync(tempConfig, configContent, 'utf8');

      await runCommand(
        'node',
        ['generateICPLinkedInURLs.js'],
        'Step 1: Generate LinkedIn URLs'
      );

      // Move generated files to run directory
      const generatedFile = path.join(__dirname, 'linkedin_icp_urls_by_country_niche.json');
      if (fs.existsSync(generatedFile)) {
        fs.renameSync(generatedFile, urlsFile);
        console.log(`📄 URLs saved to ${urlsFile}`);
      }
    } else {
      console.log('⏭️  Skipping URL generation');
    }

    // Stage 2: Scrape LinkedIn jobs
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
          `Scraping: ${entry.niche} - ${entry.location}`
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
      console.log(`\n✅ Total jobs scraped: ${allJobs.length}`);
      console.log(`📄 Saved to ${scrapedFile}`);
    } else {
      console.log('⏭️  Skipping scraping');
    }

    // Stage 3: Qualify with Gemini
    if (!skipQualify && fs.existsSync(scrapedFile)) {
      const titlesArg = config.titles.join(',');
      await runCommand(
        'node',
        [
          'geminiJobQualifier.js',
          `--input="${scrapedFile}"`,
          `--output="${qualifiedFile}"`,
          `--titles="${titlesArg}"`
        ],
        'Step 3: Qualify leads with Gemini AI'
      );

      // Move Gemini outputs to run directory
      const geminiOutputs = [
        'job_postings/eu_qualified_jobs_gemini.json',
        'job_postings/eu_rejected_jobs_gemini.json',
        'job_postings/apollo_input_candidates_gemini.json'
      ];

      geminiOutputs.forEach((file) => {
        const fullPath = path.join(__dirname, file);
        if (fs.existsSync(fullPath)) {
          const basename = path.basename(file);
          fs.renameSync(fullPath, path.join(runDir, basename));
        }
      });
    } else {
      console.log('⏭️  Skipping qualification');
    }

    // Stage 4: Enrich with Apollo
    if (!skipApollo) {
      const qualifiedInput = path.join(runDir, 'eu_qualified_jobs_gemini.json');
      if (fs.existsSync(qualifiedInput)) {
        fs.mkdirSync(apolloDir, { recursive: true });

        await runCommand(
          'node',
          [
            'apolloEnricher.js',
            `--input="${qualifiedInput}"`,
            `--output-dir="${apolloDir}"`,
            `--max-leads=${config.apollo.leadsPerCompany || 50}`
          ],
          'Step 4: Enrich with Apollo.io'
        );
      } else {
        console.log('⚠️  No qualified jobs file found, skipping Apollo enrichment');
      }
    } else {
      console.log('⏭️  Skipping Apollo enrichment');
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Pipeline completed successfully!');
    console.log('='.repeat(60));
    console.log(`\n📁 All outputs saved to: ${runDir}\n`);

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('🔴 Pipeline failed');
    console.error('='.repeat(60));
    console.error(error);
    process.exit(1);
  }
}

runPipeline();
