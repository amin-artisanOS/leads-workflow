import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI argument parsing
function getArgValue(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
    if (arg === flag && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return null;
}

const INPUT_FILE = getArgValue('--input');
const OUTPUT_FILE = getArgValue('--output');
const PRODUCTS_ARG = getArgValue('--products');
const TITLES_ARG = getArgValue('--titles');

if (!INPUT_FILE || !OUTPUT_FILE || !PRODUCTS_ARG || !TITLES_ARG) {
  console.error('🔴 Missing required arguments:');
  console.error('   --input=<path>     Path to scraped jobs JSON');
  console.error('   --output=<path>    Path to output qualified suppliers JSON');
  console.error('   --products=<json>  JSON string of products array');
  console.error('   --titles=<csv>     Comma-separated supplier titles');
  process.exit(1);
}

let products;
try {
  products = JSON.parse(PRODUCTS_ARG);
} catch (error) {
  console.error('🔴 Invalid products JSON:', error.message);
  process.exit(1);
}

const targetTitles = TITLES_ARG.split(',').map(t => t.trim().toLowerCase());

async function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('🔴 Missing GEMINI_API_KEY in environment.');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.1,
      topP: 0.9
    }
  });
}

function isRelevantJob(job, products, targetTitles) {
  const title = (job.jobTitle || '').toLowerCase();
  const description = (job.jobDescription || '').toLowerCase();
  const company = (job.companyName || '').toLowerCase();

  // Check if job title matches target supplier roles
  const titleMatch = targetTitles.some(targetTitle =>
    title.includes(targetTitle) || targetTitle.includes(title)
  );

  if (!titleMatch) {
    return { qualified: false, reason: 'Job title does not match supplier roles' };
  }

  // Check if company/industry is relevant to products
  let productRelevance = false;
  let relevantProduct = null;

  for (const product of products) {
    const keywords = product.keywords || [];
    const productMatch = keywords.some(keyword =>
      description.includes(keyword.toLowerCase()) ||
      company.includes(keyword.toLowerCase()) ||
      title.includes(keyword.toLowerCase())
    );

    if (productMatch) {
      productRelevance = true;
      relevantProduct = product;
      break;
    }
  }

  if (!productRelevance) {
    return { qualified: false, reason: 'Company/industry not relevant to target products' };
  }

  // Check for export/international experience
  const exportKeywords = ['export', 'international', 'overseas', 'foreign', 'trade', 'shipping', 'logistics'];
  const hasExportExperience = exportKeywords.some(keyword =>
    description.includes(keyword) || title.includes(keyword)
  );

  return {
    qualified: true,
    relevantProduct: relevantProduct,
    hasExportExperience: hasExportExperience,
    reason: 'Matches supplier criteria and product relevance'
  };
}

async function qualifySupplierWithGemini(model, job, products, targetTitles) {
  const qualification = isRelevantJob(job, products, targetTitles);

  if (!qualification.qualified) {
    return {
      ...job,
      qualified: false,
      qualificationReason: qualification.reason,
      relevantProduct: null,
      supplierScore: 0
    };
  }

  const prompt = `Analyze this job posting for supplier potential. Rate from 0-10 how suitable this company would be as a supplier for ecommerce products.

Job Details:
- Title: ${job.jobTitle}
- Company: ${job.companyName}
- Description: ${job.jobDescription || 'N/A'}
- Location: ${job.location}

Target Products: ${products.map(p => p.name).join(', ')}

Rate based on:
- Export experience (3 points)
- Company size suitability (2 points)
- Product relevance (3 points)
- International trade experience (2 points)

Return JSON: {"score": 0-10, "reasoning": "brief explanation", "recommended": true/false, "productFit": "best matching product name"}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
      ...job,
      qualified: analysis.recommended || analysis.score >= 6,
      supplierScore: analysis.score || 0,
      qualificationReason: analysis.reasoning || qualification.reason,
      relevantProduct: analysis.productFit || qualification.relevantProduct?.name,
      hasExportExperience: qualification.hasExportExperience,
      geminiAnalysis: analysis
    };

  } catch (error) {
    console.warn(`⚠️ Gemini analysis failed for ${job.companyName}: ${error.message}`);
    return {
      ...job,
      qualified: qualification.qualified,
      supplierScore: qualification.qualified ? 5 : 0,
      qualificationReason: qualification.reason,
      relevantProduct: qualification.relevantProduct?.name,
      hasExportExperience: qualification.hasExportExperience,
      geminiAnalysis: null
    };
  }
}

async function main() {
  try {
    // Load input data
    console.log(`📚 Loading scraped jobs from ${INPUT_FILE}`);
    const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
    const jobs = JSON.parse(rawData);
    console.log(`✅ Loaded ${jobs.length} jobs`);

    // Initialize Gemini
    const model = await initGemini();
    console.log('🤖 Initialized Gemini AI for supplier qualification');

    const qualified = [];
    const rejected = [];

    console.log('\n🔍 Qualifying suppliers...');

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      console.log(`\n📋 Processing ${i + 1}/${jobs.length}: ${job.companyName} - ${job.jobTitle}`);

      const qualifiedJob = await qualifySupplierWithGemini(model, job, products, targetTitles);

      if (qualifiedJob.qualified) {
        qualified.push(qualifiedJob);
        console.log(`   ✅ QUALIFIED (Score: ${qualifiedJob.supplierScore}/10)`);
        console.log(`      Product: ${qualifiedJob.relevantProduct}`);
      } else {
        rejected.push(qualifiedJob);
        console.log(`   ❌ REJECTED: ${qualifiedJob.qualificationReason}`);
      }

      // Rate limiting
      if (i < jobs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Save results
    const results = {
      qualified,
      rejected,
      summary: {
        totalProcessed: jobs.length,
        qualifiedCount: qualified.length,
        rejectedCount: rejected.length,
        qualificationRate: ((qualified.length / jobs.length) * 100).toFixed(1) + '%',
        averageScore: qualified.length > 0 ?
          (qualified.reduce((sum, j) => sum + j.supplierScore, 0) / qualified.length).toFixed(1) : 0,
        productsCovered: [...new Set(qualified.map(j => j.relevantProduct).filter(Boolean))]
      }
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✅ Saved qualification results to ${OUTPUT_FILE}`);

    // Save separate files for pipeline compatibility
    const qualifiedOnlyFile = OUTPUT_FILE.replace('.json', '_qualified_only.json');
    fs.writeFileSync(qualifiedOnlyFile, JSON.stringify(qualified, null, 2));

    const apolloInputFile = path.join(path.dirname(OUTPUT_FILE), 'supplier_apollo_input_candidates_gemini.json');
    fs.writeFileSync(apolloInputFile, JSON.stringify(qualified, null, 2));

    // Create CSV export
    const csvFile = OUTPUT_FILE.replace('.json', '.csv');
    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: csvFile,
      header: [
        { id: 'companyName', title: 'Company Name' },
        { id: 'jobTitle', title: 'Job Title' },
        { id: 'location', title: 'Location' },
        { id: 'relevantProduct', title: 'Relevant Product' },
        { id: 'supplierScore', title: 'Supplier Score' },
        { id: 'hasExportExperience', title: 'Export Experience' },
        { id: 'qualificationReason', title: 'Qualification Reason' },
        { id: 'companyWebsite', title: 'Website' }
      ]
    });

    await csvWriter.writeRecords(qualified.map(job => ({
      companyName: job.companyName,
      jobTitle: job.jobTitle,
      location: job.location,
      relevantProduct: job.relevantProduct,
      supplierScore: job.supplierScore,
      hasExportExperience: job.hasExportExperience ? 'Yes' : 'No',
      qualificationReason: job.qualificationReason,
      companyWebsite: job.companyWebsite || ''
    })));

    console.log(`✅ Saved CSV export to ${csvFile}`);

    // Print summary
    console.log('\n📊 SUPPLIER QUALIFICATION SUMMARY');
    console.log('='.repeat(40));
    console.log(`Total Jobs Processed: ${jobs.length}`);
    console.log(`Qualified Suppliers: ${qualified.length}`);
    console.log(`Rejected: ${rejected.length}`);
    console.log(`Qualification Rate: ${results.summary.qualificationRate}`);
    console.log(`Average Score: ${results.summary.averageScore}/10`);
    console.log(`Products Covered: ${results.summary.productsCovered.join(', ')}`);

  } catch (error) {
    console.error('🔴 Supplier qualification failed:', error.message);
    process.exit(1);
  }
}

main();
