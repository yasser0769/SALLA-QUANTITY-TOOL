import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('new-products.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

function notHas(pattern, message) {
  assert.doesNotMatch(html, pattern, message);
}

has(/cdn\.jsdelivr\.net\/npm\/xlsx@/, 'SheetJS must be loaded for browser XLS parsing');
has(/let\s+[^;]*priceListFile/, 'page state must include the XLS price-list file');
has(/function\s+loadPriceListXls/, 'page must expose an XLS upload loader');
has(/function\s+readPriceListRows/, 'page must parse XLS supplier price-list rows');
has(/priceBySku/, 'page must build an Item# -> XLS row map');
has(/excludedXlsOnlyRows/, 'page must report XLS-only SKUs excluded from export');
has(/brandExactMap/, 'page must map XLS brands to exact Salla brand values');
has(/brandArabicMap/, 'page must map XLS brands to Arabic product-name phrases');
has(/function\s+sizeMl/, 'page must derive Arabic ml size values from Size/Type');
has(/function\s+arabicType/, 'page must derive Arabic perfume/type labels from Size/Type');
has(/stCsv/, 'stats must include CSV SKU count');
has(/stXls/, 'stats must include XLS SKU count');
has(/stExcluded/, 'stats must include XLS-only excluded SKU count');

const pricePackBody = html.match(/function\s+pricePack\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(pricePackBody.includes("['Cost']") || pricePackBody.includes('.Cost'), 'pricePack must use XLS Cost');
assert.ok(pricePackBody.includes("['Retail Price']") || pricePackBody.includes('Retail Price'), 'pricePack must use XLS Retail Price');
assert.ok(!pricePackBody.includes('Variant Price'), 'pricePack must not use CSV Variant Price');
assert.ok(!pricePackBody.includes('Variant Compare At Price'), 'pricePack must not use CSV compare-at price');

has(/image:\s*isVariant\s*\?\s*''/, 'parent rows with options must have no product image');
has(/optName:\s*isVariant\s*\?\s*'الحجم'/, 'variant parent rows must define [1] الاسم as الحجم');
has(/optType:\s*isVariant\s*\?\s*'صورة'/, 'variant parent rows must define [1] النوع as صورة');
has(/largeImageUrl\([^)]*Image Src/, 'option/product images must pass through largeImageUrl');
has(/\/images\\\/products\\\/sku\\\/small\\\/.*i/, 'largeImageUrl must catch lowercase sku/small FragranceX paths');
notHas(/templateFileObj/, 'template upload state must stay removed');
