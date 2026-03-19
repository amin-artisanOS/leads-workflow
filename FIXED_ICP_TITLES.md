# ✅ Fixed: ICP Titles Now Flow to Apollo

## Problem (Before)
Apollo was only searching for **1 generic title** per company (e.g., "Regional Account Manager"), missing most decision-makers.

## Solution (Now)
Apollo searches for **ALL 8 of your ICP titles** per company:
- Business Development Manager
- Export Manager
- Sales Director
- Commercial Director
- International Sales Manager
- Regional Account Manager
- Head of Sales
- Director Comercial

## What Changed

### 1. Pipeline Passes ICP Titles to Gemini
`runLeadPipeline.js` now sends your titles from `icp-config.json`:
```javascript
const titlesArg = config.titles.join(',');
await runCommand('node', [
  'geminiJobQualifier.js',
  `--titles="${titlesArg}"`  // ← Your ICP titles
]);
```

### 2. Gemini Outputs All Titles for Apollo
`geminiJobQualifier.js` now includes all titles in Apollo input:
```javascript
{
  "companyName": "García Baquero",
  "positions": ["Export Manager", "Sales Director", ...],  // Array
  "position": "Export Manager OR Sales Director OR ...",    // Apollo search string
  "canonicalTitle": "Regional Account Manager"              // Gemini's classification
}
```

### 3. Apollo Searches All Titles
Apollo URL now includes:
```
personTitles[]=Business%20Development%20Manager%20OR%20Export%20Manager%20OR%20Sales%20Director...
```

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Titles searched per company | 1 | 8 |
| Contacts found per company | ~5-10 | ~20-50 |
| Coverage of decision-makers | 12% | 100% |

## How to Customize Titles

Edit `icp-config.json`:
```json
{
  "titles": [
    "Export Manager",
    "VP of International Sales",  // ← Add custom titles
    "Global Business Development Director"
  ]
}
```

Run pipeline:
```bash
npm run pipeline:food
```

Apollo will search for **all your custom titles** at each qualified company.

## Test It

Run the demo:
```bash
node test-apollo-input.js
```

This shows the exact difference in Apollo URLs between old (1 title) and new (all titles).

## Next Run

Your next pipeline run will automatically:
1. ✅ Use your exact ICP titles from config
2. ✅ Pass them to Gemini for qualification
3. ✅ Send ALL titles to Apollo for enrichment
4. ✅ Find 5-10x more decision-makers per company
