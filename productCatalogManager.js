#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import createCsvWriter from 'csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_FILE = path.join(__dirname, 'product-catalog.json');
const SUPPLIER_CONFIG_FILE = path.join(__dirname, 'supplier-config.json');

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

const COMMAND = process.argv[2];
const PRODUCT_NAME = getArgValue('--name');
const CATEGORY = getArgValue('--category');
const DESCRIPTION = getArgValue('--description');
const TARGET_PRICE = getArgValue('--price');
const DEMAND = getArgValue('--demand');
const KEYWORDS = getArgValue('--keywords');

// Load existing catalog
function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      const data = fs.readFileSync(CATALOG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading catalog:', error.message);
  }
  return { products: [], lastUpdated: new Date().toISOString() };
}

// Save catalog
function saveCatalog(catalog) {
  catalog.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`✅ Catalog saved to ${CATALOG_FILE}`);
}

// Sync with supplier config
function syncWithSupplierConfig() {
  try {
    if (fs.existsSync(SUPPLIER_CONFIG_FILE)) {
      const supplierConfig = JSON.parse(fs.readFileSync(SUPPLIER_CONFIG_FILE, 'utf8'));
      const catalog = loadCatalog();

      // Update supplier config with catalog products
      supplierConfig.products = catalog.products;
      fs.writeFileSync(SUPPLIER_CONFIG_FILE, JSON.stringify(supplierConfig, null, 2));
      console.log('✅ Synced product catalog with supplier configuration');
    }
  } catch (error) {
    console.error('Error syncing with supplier config:', error.message);
  }
}

// Interactive product addition
async function addProductInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log('\n🏪 Add New Product to Catalog');
  console.log('='.repeat(30));

  try {
    const name = await question('Product name: ');
    const category = await question('Category (e.g., Electronics, Home & Garden, Fitness): ');
    const description = await question('Description: ');
    const targetPrice = await question('Target price range (e.g., $15-25): ');
    const monthlyDemand = await question('Monthly demand (units): ');
    const keywordsInput = await question('Keywords (comma-separated): ');

    const keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);

    const catalog = loadCatalog();
    const product = {
      id: `product_${Date.now()}`,
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      targetPrice: targetPrice.trim(),
      monthlyDemand: parseInt(monthlyDemand) || 0,
      keywords: keywords,
      dateAdded: new Date().toISOString(),
      status: 'active'
    };

    catalog.products.push(product);
    saveCatalog(catalog);
    syncWithSupplierConfig();

    console.log(`\n✅ Added product: ${product.name}`);
    console.log(`📊 Category: ${product.category}`);
    console.log(`🎯 Target Price: ${product.targetPrice}`);
    console.log(`📈 Monthly Demand: ${product.monthlyDemand} units`);

  } catch (error) {
    console.error('Error adding product:', error.message);
  } finally {
    rl.close();
  }
}

// List products
function listProducts() {
  const catalog = loadCatalog();
  const products = catalog.products;

  if (products.length === 0) {
    console.log('📭 No products in catalog. Add some with: node productCatalogManager.js add');
    return;
  }

  console.log('\n📦 PRODUCT CATALOG');
  console.log('='.repeat(80));
  console.log('Name'.padEnd(25) + 'Category'.padEnd(20) + 'Price Range'.padEnd(15) + 'Demand'.padEnd(10) + 'Status');
  console.log('-'.repeat(80));

  products.forEach(product => {
    const name = product.name.substring(0, 24);
    const category = product.category.substring(0, 19);
    const price = product.targetPrice.substring(0, 14);
    const demand = String(product.monthlyDemand).padStart(9);
    const status = product.status || 'active';

    console.log(`${name.padEnd(25)}${category.padEnd(20)}${price.padEnd(15)}${demand} ${status}`);
  });

  console.log(`\n📊 Total: ${products.length} products`);
  console.log(`📅 Last updated: ${new Date(catalog.lastUpdated).toLocaleDateString()}`);
}

// Export to CSV
async function exportToCSV() {
  const catalog = loadCatalog();
  const csvFile = path.join(__dirname, 'product-catalog.csv');

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: csvFile,
    header: [
      { id: 'name', title: 'Product Name' },
      { id: 'category', title: 'Category' },
      { id: 'description', title: 'Description' },
      { id: 'targetPrice', title: 'Target Price Range' },
      { id: 'monthlyDemand', title: 'Monthly Demand' },
      { id: 'keywords', title: 'Keywords' },
      { id: 'status', title: 'Status' },
      { id: 'dateAdded', title: 'Date Added' }
    ]
  });

  const records = catalog.products.map(product => ({
    ...product,
    keywords: product.keywords.join(', '),
    dateAdded: new Date(product.dateAdded).toLocaleDateString()
  }));

  await csvWriter.writeRecords(records);
  console.log(`✅ Exported ${records.length} products to ${csvFile}`);
}

// Generate supplier search keywords
function generateSearchKeywords() {
  const catalog = loadCatalog();

  console.log('\n🔍 SUPPLIER SEARCH KEYWORDS');
  console.log('='.repeat(40));

  const allKeywords = new Set();
  const categories = new Set();

  catalog.products.forEach(product => {
    product.keywords.forEach(keyword => allKeywords.add(keyword));
    categories.add(product.category);
  });

  console.log('📂 Categories:');
  Array.from(categories).forEach(cat => console.log(`   • ${cat}`));

  console.log('\n🏷️  Keywords for LinkedIn/Apollo searches:');
  Array.from(allKeywords).forEach(keyword => console.log(`   • "${keyword}" supplier`));

  console.log('\n💡 Pro tip: Use these keywords in your supplier-config.json for better targeting');
}

// Show usage
function showUsage() {
  console.log('\n🏪 Product Catalog Manager');
  console.log('==========================');
  console.log('');
  console.log('USAGE:');
  console.log('  node productCatalogManager.js <command> [options]');
  console.log('');
  console.log('COMMANDS:');
  console.log('  add                    Add product interactively');
  console.log('  add --name="Product" --category="Category" --description="Desc" --price="$10-20" --demand=100 --keywords="kw1,kw2"');
  console.log('  list                   List all products');
  console.log('  export                 Export catalog to CSV');
  console.log('  keywords               Generate supplier search keywords');
  console.log('  sync                   Sync catalog with supplier config');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  node productCatalogManager.js add');
  console.log('  node productCatalogManager.js list');
  console.log('  node productCatalogManager.js add --name="Wireless Earbuds" --category="Electronics" --price="$15-25" --demand=500 --keywords="wireless,earbuds,bluetooth"');
  console.log('');
}

// Main command handling
async function main() {
  switch (COMMAND) {
    case 'add':
      if (PRODUCT_NAME) {
        // Add product programmatically
        const catalog = loadCatalog();
        const product = {
          id: `product_${Date.now()}`,
          name: PRODUCT_NAME,
          category: CATEGORY || 'General',
          description: DESCRIPTION || '',
          targetPrice: TARGET_PRICE || '',
          monthlyDemand: parseInt(DEMAND) || 0,
          keywords: KEYWORDS ? KEYWORDS.split(',').map(k => k.trim()) : [],
          dateAdded: new Date().toISOString(),
          status: 'active'
        };

        catalog.products.push(product);
        saveCatalog(catalog);
        syncWithSupplierConfig();
        console.log(`✅ Added product: ${product.name}`);
      } else {
        // Interactive mode
        await addProductInteractive();
      }
      break;

    case 'list':
      listProducts();
      break;

    case 'export':
      await exportToCSV();
      break;

    case 'keywords':
      generateSearchKeywords();
      break;

    case 'sync':
      syncWithSupplierConfig();
      console.log('✅ Catalog synced with supplier configuration');
      break;

    default:
      showUsage();
      break;
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
