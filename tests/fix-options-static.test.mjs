import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const newProductsHtml = fs.readFileSync('new-products.html', 'utf8');
const html = fs.readFileSync('fix-options.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

assert.match(indexHtml, /fix-options\.html/, 'main page must link to the option-fix page');
assert.match(newProductsHtml, /fix-options\.html/, 'new-products page must link to the option-fix page');

has(/cdn\.jsdelivr\.net\/npm\/exceljs@/, 'page must load ExcelJS for template-preserving XLSX export');
has(/cdn\.jsdelivr\.net\/npm\/xlsx@/, 'page must load SheetJS for AllFragrances XLS parsing');
has(/cdn\.jsdelivr\.net\/npm\/papaparse@/, 'page must load PapaParse for supplier CSV parsing');
has(/id="sallaFile"/, 'page must include a Salla full-products upload input');
has(/id="supplierFile"/, 'page must include a supplier CSV upload input');
has(/id="priceListFile"/, 'page must include an AllFragrances upload input');
has(/function\s+loadPriceListXls/, 'page must expose an AllFragrances upload loader');
has(/id="autoFixPanel"/, 'page must include a first-case auto-fix preview panel');
has(/id="downloadAutoFixPreviewBtn"/, 'first-case preview must include a dedicated download button');
has(/id="manualOnlyPanel"/, 'page must include a second-case manual-only preview panel');
has(/id="warningsPanel"/, 'page must include a warnings preview panel');
has(/autoFixCases/, 'page must keep first-case auto-fix classification state');
has(/manualOnlyCases/, 'page must keep second-case manual-only classification state');
has(/warningCases/, 'page must keep unclear warning classification state');
has(/Handle/, 'page must group supplier rows by CSV Handle');
has(/Variant SKU/, 'page must read supplier Variant SKU values');
has(/Size\/Type/, 'page must use AllFragrances Size/Type for Arabic option values');
has(/priceBySku/, 'page must build an Item# -> AllFragrances row map');
has(/function\s+readPriceListRows/, 'page must parse AllFragrances rows');
has(/function\s+sizeMl/, 'page must convert Size/Type values to Arabic ml labels');
has(/function\s+optionValueInfo/, 'page must expose option value resolution with source metadata');
has(/function\s+classifyOptionProblems/, 'page must expose option-problem classification logic');
has(/function\s+renderAutoFixPreview/, 'page must render the first-case preview');
has(/function\s+renderManualOnlyPreview/, 'page must render the second-case preview');
has(/function\s+renderWarningsPreview/, 'page must render warnings preview');
has(/function\s+downloadAutoFixPreviewXlsx/, 'page must export the first-case preview workbook');
has(/function\s+addAutoFixRowsToWorksheet/, 'exports must keep the parent/options/converted ordering for first-case groups');
has(/function\s+clearTemplateDataRows/, 'exports must hard-clear template data rows before adding fix rows');
has(/function\s+downloadOptionsFixXlsx/, 'page must export the fix workbook');
has(/sallaWorkbook/, 'page must reuse the uploaded Salla workbook as the export template');
has(/salla_options_case1_preview_\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.xlsx/, 'first-case preview filename must follow the agreed date pattern');
has(/salla_options_fix_\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.xlsx/, 'export filename must follow the agreed date pattern');

const clearTemplateBody = html.match(/function\s+clearTemplateDataRows\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(clearTemplateBody.includes('spliceRows(3'), 'template cleanup must delete rows below the Salla header');
assert.ok(clearTemplateBody.includes('_rows'), 'template cleanup must compact ExcelJS internal row cache so old Salla rows cannot remain in exported XML');
assert.ok(/slice\(0,\s*2\)|length\s*=\s*2/.test(clearTemplateBody), 'template cleanup must keep only the two header rows before adding preview rows');

const autoFixWriterBody = html.match(/function\s+addAutoFixRowsToWorksheet\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(autoFixWriterBody.includes('cloneRowValues(item.parent)'), 'first-case export must include the parent product row for each preview group');
assert.ok(autoFixWriterBody.includes('existingOptions'), 'first-case export must include existing option rows under the parent');
assert.ok(autoFixWriterBody.includes('convertedOptionValues'), 'first-case export must include converted option rows under the parent');
assert.ok(autoFixWriterBody.indexOf('cloneRowValues(item.parent)') < autoFixWriterBody.indexOf('existingOptions'), 'parent rows must be written before existing option rows');
assert.ok(autoFixWriterBody.indexOf('existingOptions') < autoFixWriterBody.indexOf('convertedOptionValues'), 'existing option rows must be written before converted option rows');

const previewDownloadBody = html.match(/async\s+function\s+downloadAutoFixPreviewXlsx\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(previewDownloadBody.includes('buildAutoFixWorkbook'), 'first-case preview download must use the grouped parent/options workbook builder');

const fixWorkbookBody = html.match(/async\s+function\s+buildAutoFixWorkbook\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(fixWorkbookBody.includes('clearTemplateDataRows'), 'fix export must hard-clear original Salla rows before adding ordered fix rows');

const checkReadyBody = html.match(/function\s+checkReady\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(checkReadyBody.includes('priceListFile'), 'analyze button must require the AllFragrances file');

const optionValueBody = html.match(/function\s+optionValueInfo\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(optionValueBody.includes('priceBySku'), 'option value must prefer AllFragrances rows by SKU');
assert.ok(optionValueBody.includes('sizeMl'), 'option value must convert AllFragrances Size/Type to Arabic ml');
assert.ok(!optionValueBody.includes("['Option1 Value']"), 'option value must not use CSV Option1 Value as the primary source');
