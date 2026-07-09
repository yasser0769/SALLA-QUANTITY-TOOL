import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const newProductsHtml = fs.readFileSync('new-products.html', 'utf8');
const fixOptionsHtml = fs.readFileSync('fix-options.html', 'utf8');
const translateHtml = fs.readFileSync('translate-descriptions.html', 'utf8');
const html = fs.readFileSync('prepare-orders.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

assert.match(indexHtml, /prepare-orders\.html/, 'main page must link to the order preparation page');
assert.match(newProductsHtml, /prepare-orders\.html/, 'new-products page must link to the order preparation page');
assert.match(fixOptionsHtml, /prepare-orders\.html/, 'fix-options page must link to the order preparation page');
assert.match(translateHtml, /prepare-orders\.html/, 'translation page must link to the order preparation page');

has(/<h1>تجهيز الطلبات<\/h1>/, 'page must use the requested Arabic page name');
has(/cdn\.jsdelivr\.net\/npm\/xlsx@/, 'page must load SheetJS for Salla order XLSX parsing');
has(/id="provider"/, 'page must include an API provider selector');
has(/value="openrouter"/, 'page must support OpenRouter');
has(/value="deepseek"/, 'page must support DeepSeek');
has(/id="accessToken"/, 'page must use the shared access token instead of exposing provider API keys');
has(/localStorage\.setItem\(STORAGE_KEY/, 'page must optionally remember the access token locally');
has(/\/api\/prepare-orders/, 'page must call the protected order preparation API route');
assert.doesNotMatch(html, /id="apiKey"/, 'page must not expose a direct provider API key input');
assert.doesNotMatch(html, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/, 'page must not call OpenRouter directly from the browser');
assert.doesNotMatch(html, /https:\/\/api\.deepseek\.com\/chat\/completions/, 'page must not call DeepSeek directly from the browser');
has(/function\s+parseExcelFile/, 'page must parse the uploaded order workbook');
has(/COL_|row\[18\]|row\[19\]|row\[20\]/, 'page must read the known Salla order columns including SKU, address, and products');
has(/function\s+translateBatch/, 'page must translate orders through AI batches');
has(/function\s+parsePrepareOrdersApiError/, 'page must translate protected API errors into useful Arabic messages');
has(/رمز الدخول غير صحيح/, '401 access-token failures must show a clear Arabic message');
has(/OPENROUTER_API_KEY/, 'missing OpenRouter env errors must tell the user which variable is missing');
has(/function\s+mapOrderData/, 'page must map raw orders and AI output into shipping rows');
has(/function\s+parseOrderDetails/, 'page must convert product quantities to Qty,SKU details');
has(/function\s+parseOrderItems/, 'page must parse product quantities into supplier cost items');
has(/\/api\/fragrancex-costs/, 'page must call the protected FragranceX cost API route');
has(/function\s+fetchSupplierCosts/, 'page must fetch supplier costs after preparing orders');
has(/COrderID.*FirstName.*LastName.*Address.*OrderDetails/s, 'CSV headers must match the original order converter output');
has(/function\s+downloadCSV/, 'page must export CSV');
has(/function\s+renderPreview/, 'page must render an editable preview table');
has(/id="orderTotalSummary"/, 'preview must show total order value above the table');
has(/إجمالي قيمة الطلبات:/, 'preview total must use a visible Arabic value label');
has(/function\s+findOrderTotalColumn/, 'page must detect the final order value column from workbook headers');
has(/function\s+parseMoneyValue/, 'page must parse localized order value cells');
has(/__orderTotal/, 'page must keep the order value internally without adding it to shipping CSV headers');
has(/function\s+orderTotalValue/, 'page must sum the final order values for the preview summary');
has(/formatCurrency\(orderTotalValue\(\)\)/, 'preview summary must render the summed order value as currency');
has(/COST_PREVIEW_HEADERS/, 'preview must define supplier-cost display-only headers');
has(/تكلفة المورد/, 'preview must show supplier cost summary text');
has(/تكلفة الوصول/, 'preview must show landed cost summary text');
has(/الربح المتوقع/, 'preview must show expected profit summary text');
has(/costPreviewCells/, 'supplier cost cells must be rendered separately from CSV fields');
has(/selectedOrderKeys\s*=\s*new Set\(\)/, 'page must track selected orders separately from CSV data');
has(/id="selectVisibleRows"/, 'preview table must support selecting all visible rows');
has(/function\s+toggleOrderSelection/, 'page must support selecting one order row');
has(/function\s+toggleVisibleSelection/, 'page must support selecting visible rows as a group');
has(/function\s+deleteSelectedOrders/, 'page must support deleting selected orders');
has(/حذف المحدد/, 'preview controls must include an Arabic delete selected action');
has(/outputRows\s*=\s*outputRows\.filter\(\(row\)\s*=>\s*!\s*selectedOrderKeys\.has\(row\.__rowKey\)\)/, 'delete action must remove selected rows from the export data');
has(/prepared_orders_\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.csv/, 'export filename must include the current date');
assert.doesNotMatch(
  html.match(/const\s+CSV_HEADERS\s*=\s*\[([^\]]+)\]/)?.[1] || '',
  /تكلفة المورد|تكلفة الوصول|الربح المتوقع/,
  'supplier cost display columns must not be included in CSV_HEADERS'
);

const api = fs.readFileSync('api/prepare-orders.js', 'utf8');
assert.match(api, /OPENROUTER_API_KEY/, 'server route must read the OpenRouter key from Vercel env');
assert.match(api, /TRANSLATION_ACCESS_TOKEN/, 'server route must use the same translation access token');
assert.match(api, /defaultProvider:\s*'openrouter'/, 'order preparation API must default to OpenRouter');
assert.match(api, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/, 'server route must support OpenRouter upstream calls');
assert.match(api, /https:\/\/api\.deepseek\.com\/chat\/completions/, 'server route may still support DeepSeek upstream calls');

const costApiPath = 'api/fragrancex-costs.js';
assert.ok(fs.existsSync(costApiPath), 'FragranceX supplier cost API route must exist');
const costApi = fs.readFileSync(costApiPath, 'utf8');
assert.match(costApi, /process\.env\.FRAGRANCEX_API_ID/, 'cost API must read FragranceX API ID from Vercel env');
assert.match(costApi, /process\.env\.FRAGRANCEX_API_KEY/, 'cost API must read FragranceX API key from Vercel env');
assert.match(costApi, /process\.env\.UPSTASH_REDIS_REST_URL/, 'cost API must use Upstash Redis REST URL for daily cache');
assert.match(costApi, /process\.env\.UPSTASH_REDIS_REST_TOKEN/, 'cost API must use Upstash Redis REST token for daily cache');
assert.match(costApi, /https:\/\/apilisting\.fragrancex\.com\/token/, 'cost API must request a FragranceX bearer token server-side');
assert.match(costApi, /https:\/\/apilisting\.fragrancex\.com\/product\/list\//, 'cost API must load FragranceX product catalog server-side');
assert.match(costApi, /https:\/\/apiordering\.fragrancex\.com\/order\/GetFixedShipping\//, 'cost API must load fixed shipping countries');
assert.match(costApi, /https:\/\/apiordering\.fragrancex\.com\/order\/GetVatCountries\//, 'cost API must load VAT countries');
assert.match(costApi, /WholesalePriceUSD/, 'cost API must use FragranceX wholesale USD prices');
assert.match(costApi, /USD_TO_SAR_RATE/, 'cost API must convert FragranceX USD costs into SAR values');
assert.doesNotMatch(costApi, /FRAGRANCEX_API_KEY\s*=\s*['"][^'"]+['"]/, 'cost API must not contain a hard-coded FragranceX API key');
assert.doesNotMatch(costApi, /FRAGRANCEX_API_ID\s*=\s*['"][^'"]+['"]/, 'cost API must not contain a hard-coded FragranceX API ID');
