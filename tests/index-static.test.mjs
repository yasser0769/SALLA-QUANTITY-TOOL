import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

has(/https:\/\/s\.salla\.sa\/export\/product-quantities\?type=xlsx/, 'page must link to the Salla product quantities export request');
has(/https:\/\/s\.salla\.sa\/export\/product-prices\?type=xlsx/, 'page must link to the Salla product prices export request');
has(/https:\/\/s\.salla\.sa\/import\/product-quantities/, 'page must link to the Salla product quantities import page');
has(/https:\/\/s\.salla\.sa\/import\/product-prices/, 'page must link to the Salla product prices import page');
has(/https:\/\/www\.fragrancex\.com\/customeraccount\/_tofile_true-am-cid_frgxexcel__wholesale_pricelisthtml\.html/, 'page must link to the supplier product list');
has(/طلب تصدير كميات المنتجات/, 'quantities export request must have a visible Arabic label');
has(/طلب تصدير أسعار المنتجات/, 'prices export request must have a visible Arabic label');
has(/رفع الكميات الجديدة/, 'quantities import page must have a visible Arabic label');
has(/رفع الأسعار الجديدة/, 'prices import page must have a visible Arabic label');
has(/تحميل منتجات المورد/, 'supplier products link must have a visible Arabic label');
has(/repeat\(auto-fit,minmax\(210px,1fr\)\)/, 'source action buttons must use a responsive grid');
has(/target="_blank"/, 'external source links must open without leaving the current workflow');
has(/rel="noopener"/, 'external source links must use noopener');
