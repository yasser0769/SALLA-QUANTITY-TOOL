import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const newProductsHtml = fs.readFileSync('new-products.html', 'utf8');
const fixOptionsHtml = fs.readFileSync('fix-options.html', 'utf8');
const html = fs.readFileSync('translate-descriptions.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

function notHas(pattern, message) {
  assert.doesNotMatch(html, pattern, message);
}

assert.match(indexHtml, /translate-descriptions\.html/, 'main page must link to the description translation page');
assert.match(newProductsHtml, /translate-descriptions\.html/, 'new-products page must link to the description translation page');
assert.match(fixOptionsHtml, /translate-descriptions\.html/, 'fix-options page must link to the description translation page');

has(/cdn\.jsdelivr\.net\/npm\/exceljs@/, 'page must load ExcelJS for preserving Salla workbook exports');
has(/id="sallaFile"/, 'page must include a Salla full-products upload input');
has(/function\s+loadSallaProducts/, 'page must expose a Salla upload loader');
has(/function\s+readSallaCatalogWorkbook/, 'page must parse the uploaded Salla workbook');
has(/function\s+isEnglishOnlyDescription/, 'page must detect English-only descriptions');
notHas(/function\s+sourceDescriptionMatchesProduct/, 'page must translate descriptions directly without product-title matching');
notHas(/skipped_mismatch/, 'mismatched descriptions must not be skipped by product-title matching');
has(/function\s+isTranslatableDescription/, 'page must decide whether a Salla description is eligible');
has(/plain\.length\s*<=\s*minLength/, 'descriptions at or below the editable threshold must be skipped');
has(/id="translationMinLength"[^>]*value="70"/, 'default translation threshold must be 70 characters');
has(/[\u0600-\u06FF]/, 'test sanity check for Arabic regex support');
has(/Arabic|\\u0600-\\u06FF/, 'English filter must reject Arabic descriptions');
has(/latinRatio/, 'English filter must require enough Latin content');
has(/selectedBrands\s*=\s*new Set\(\)/, 'no brands should be selected by default');
has(/function\s+resetAnalysisState/, 'page must reset analysis state when a new file is selected');
has(/resetAnalysisState\(\)/, 'file loading must clear stale translation/export state');
has(/duplicateHeaders/, 'page must detect duplicate Salla headers before export-sensitive writes');
has(/function\s+toggleBrand/, 'page must support multi-brand toggling');
has(/function\s+setVisibleBrands/, 'page must support selecting all visible brands');
has(/function\s+selectedProducts/, 'translation/export scope must be based on selected brands');
has(/لا توجد ماركات محددة/, 'page must tell the user when no brands are selected');
has(/id="translationProvider"/, 'translation settings must include a provider selector');
has(/id="translationModel"/, 'translation settings must include a model selector');
has(/id="translationApiKey"/, 'translation settings must include an API key input');
has(/https:\/\/api\.deepseek\.com\/chat\/completions/, 'DeepSeek direct endpoint must be configured');
has(/deepseek-v4-flash/, 'DeepSeek direct model selector must include the fast V4 Flash model');
has(/deepseek-v4-pro/, 'DeepSeek direct model selector must keep DeepSeek V4 Pro available');
has(/https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/, 'OpenRouter endpoint must be configured');
has(/deepseek\/deepseek-v4-pro/, 'OpenRouter model must use DeepSeek V4 Pro');
has(/response_format\s*:\s*\{\s*type\s*:\s*['"]json_object['"]\s*\}/, 'LLM calls must request JSON object responses');
has(/AbortController/, 'translation API calls must be abortable');
has(/TRANSLATION_API_TIMEOUT_MS/, 'translation API calls must have a clear timeout');
has(/function\s+reviewTranslations/, 'page must review translated descriptions');
has(/function\s+validateTranslatedDescription/, 'page must locally validate reviewed translations');
has(/لا تختصر|لا تلخص/, 'translation prompt must explicitly forbid shortening or summarizing');
has(/حافظ على كل التفاصيل/, 'translation prompt must preserve all source details');
has(/صياغة عربية وصفية جذابة/, 'translation prompt must request rich attractive Arabic wording');
has(/أوسع أو أجمل من الأصل/, 'review prompt must allow richer wording when it keeps the meaning');
has(/includes\(['"]\*['"]\)/, 'translation validator must reject asterisks');
has(/\\u4E00-\\u9FFF|Script=Han/, 'translation validator must reject Chinese characters');
has(/سوف أترجم|سأترجم|I will translate|Here is/i, 'translation validator must reject assistant preambles');
has(/<textarea[^>]+oninput="editTranslatedDescription/, 'preview must include editable translated descriptions');
has(/status:\s*local\.ok\?\s*['"]edited['"]\s*:\s*['"]manual_invalid['"]/, 'manual edits must become edited only when locally valid');
has(/manual_invalid/, 'invalid manual edits must not be counted as valid edited translations');
has(/function\s+exportableProducts/, 'page must export only translated or edited products');
has(/function\s+translatedValueForProduct/, 'export must read the approved translated description');
has(/setByHeader\(values,\s*['"]description['"]/, 'export must replace only the Salla description column');
has(/imageAlt:\['وصف صورة المنتج'\]/, 'page must know the Salla image description column');
has(/function\s+cleanImageAltText/, 'page must clean product names before using them as image descriptions');
has(/normalize\(['"]NFD['"]\)/, 'image description cleaner must separate Arabic diacritics before removal');
has(/[\u064B-\u065F\u0670]/, 'image description cleaner must remove Arabic diacritics');
has(/replace\(\s*\/\[\^\\p\{Script=Arabic\}\\p\{Script=Latin\}\\s\]\+\/gu\s*,\s*''\s*\)/, 'image description cleaner must keep Arabic and English letters only');
has(/setByHeader\(values,\s*['"]imageAlt['"]\s*,\s*cleanImageAltText\(textFor\(product,\s*['"]name['"]\)\)\)/, 'export must set the image description to the cleaned product name');
has(/for\(const option of product\.options\)/, 'export must include option rows for translated products with options');
has(/cloneRowValues\(option\)/, 'option rows must be exported unchanged');
has(/clearTemplateDataRows/, 'export must delete original Salla data rows before adding translated rows');
has(/salla_translated_descriptions_\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.xlsx/, 'export filename must follow the agreed date pattern');
notHas(/translationStatus|translationReason|translationLabel/, 'preview-only translation columns must not be part of export row data');
