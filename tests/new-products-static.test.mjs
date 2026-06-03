import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('new-products.html', 'utf8');

function has(pattern, message) {
  assert.match(html, pattern, message);
}

function notHas(pattern, message) {
  assert.doesNotMatch(html, pattern, message);
}

has(/cdn\.jsdelivr\.net\/npm\/xlsx@/, 'SheetJS must be loaded for browser XLS parsing');
has(/let\s+[^;]*priceListFile/, 'page state must include the XLS price-list file');
has(/let\s+[^;]*brandFile/, 'page state must include the optional brand file');
has(/function\s+loadPriceListXls/, 'page must expose an XLS upload loader');
has(/function\s+loadBrandFile/, 'page must expose an optional brand-file upload loader');
has(/function\s+readPriceListRows/, 'page must parse XLS supplier price-list rows');
has(/function\s+readBrandFileRows/, 'page must parse optional brand-file rows');
has(/priceBySku/, 'page must build an Item# -> XLS row map');
has(/excludedXlsOnlyRows/, 'page must report XLS-only SKUs excluded from export');
has(/brandExactMap/, 'page must map XLS brands to exact Salla brand values');
has(/brandArabicMap/, 'page must map XLS brands to Arabic product-name phrases');
has(/brandFileExactMap/, 'page must map optional brand-file keys to Salla brand names');
has(/brandFileArabicMap/, 'page must map optional brand-file keys to Arabic brand names for product titles');
has(/function\s+brandFileKeysForRow/, 'page must derive brand-file matching keys from brand name and SEO URL');
has(/function\s+brandFileArabicNameForRow/, 'page must extract Arabic brand names from optional brand-file rows');
has(/id="brandFile"/, 'page must include an optional brand-file upload input');
has(/id="brandFileInfo"/, 'page must show selected optional brand-file information');
has(/function\s+sizeMl/, 'page must derive Arabic ml size values from Size/Type');
has(/function\s+arabicType/, 'page must derive Arabic perfume/type labels from Size/Type');
has(/stCsv/, 'stats must include CSV SKU count');
has(/stXls/, 'stats must include XLS SKU count');
has(/stExcluded/, 'stats must include XLS-only excluded SKU count');
has(/const\s+TEMPLATE_BASE64='[^']{1000,}'/, 'page must embed a template fallback for file:// usage');
has(/function\s+base64ToArrayBuffer/, 'page must decode embedded template fallback');
has(/catch\s*\([^)]*\)\s*\{[\s\S]*TEMPLATE_BASE64/, 'workbookFromTemplate must fallback when fetch fails');

const checkReadyBody = html.match(/function\s+checkReady\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(!checkReadyBody.includes('brandFile'), 'optional brand file must not be required before analysis');

const pricePackBody = html.match(/function\s+pricePack\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(pricePackBody.includes("['Cost']") || pricePackBody.includes('.Cost'), 'pricePack must use XLS Cost');
assert.ok(pricePackBody.includes("['Retail Price']") || pricePackBody.includes('Retail Price'), 'pricePack must use XLS Retail Price');
assert.ok(!pricePackBody.includes('Variant Price'), 'pricePack must not use CSV Variant Price');
assert.ok(!pricePackBody.includes('Variant Compare At Price'), 'pricePack must not use CSV compare-at price');

has(/image:\s*isVariant\s*\?\s*''/, 'parent rows with options must have no product image');
has(/sku:\s*isVariant\s*\?\s*''\s*:\s*cleanSku\(first\['Variant SKU'\]\)/, 'parent rows with options must not repeat an SKU');
has(/optName:\s*isVariant\s*\?\s*'الحجم'/, 'variant parent rows must define [1] الاسم as الحجم');
has(/optType:\s*isVariant\s*\?\s*'صورة'/, 'variant parent rows must define [1] النوع as صورة');
has(/largeImageUrl\([^)]*Image Src/, 'option/product images must pass through largeImageUrl');
has(/\/images\\\/products\\\/sku\\\/small\\\/.*i/, 'largeImageUrl must catch lowercase sku/small FragranceX paths');
has(/function\s+cleanImageAltText/, 'image alt text must be sanitized for Salla');
has(/[\u0600-\u06FF]/, 'test file sanity check for Arabic regex support');
has(/replace\(\s*\/\[\^\\p\{Script=Arabic\}\\p\{Script=Latin\}\\s\]\+\/gu\s*,\s*''\s*\)/, 'image alt sanitizer must keep only Arabic/English letters and spaces');
has(/noimage5\.png/, 'noimage5 placeholder images must be detected');
has(/function\s+isNoImageUrl/, 'page must expose no-image detection helper');
has(/function\s+filterRowsWithImages/, 'rows with noimage5 must be excluded before preview/export');
has(/id="previewSearch"/, 'preview must include a search box');
has(/id="previewTypeFilter"/, 'preview must include a row-type filter');
has(/id="previewCategoryFilter"/, 'preview must include a category filter');
has(/id="previewBrandFilter"/, 'preview must include a brand filter');
has(/function\s+resetPreviewFilters/, 'preview filters must have a reset action');
has(/function\s+filteredPreviewRows/, 'preview must filter rowCache without changing export selection');
has(/function\s+previewRowKind/, 'preview must classify parent/simple/option rows');
has(/label='او دو برفيوم'/, 'plain Parfum results must become او دو برفيوم');
has(/id="nextTranslationBtn"/, 'preview step must include a next button to open translation');
has(/id="backToPreviewBtn"/, 'translation step must include a back button');
has(/let\s+[^;]*currentStep\s*=\s*['"]preview['"]/, 'page must track the current wizard step');
has(/function\s+showStep/, 'page must expose a step switching function');
has(/function\s+goToTranslationStep/, 'page must expose a next-step handler');
has(/function\s+goToPreviewStep/, 'page must expose a back-step handler');
has(/id="translationProvider"/, 'translation settings must include a provider selector');
has(/id="translationModel"/, 'translation settings must include a model selector');
has(/id="translationApiKey"/, 'translation settings must include an API key input');
has(/id="translationMinLength"/, 'translation settings must include an editable minimum description length');
has(/id="translateDescriptionsBtn"/, 'translation panel must include a translate/review action');
has(/id="retryFailedTranslationsBtn"/, 'translation panel must include a retry-failed action');
has(/id="pauseTranslationsBtn"/, 'translation panel must include a pause action');
has(/id="resumeTranslationsBtn"/, 'translation panel must include a resume action');
has(/id="translationStatusFilter"/, 'preview must include a translation status filter');
has(/stTranslationOk/, 'translation stats must report successful descriptions');
has(/stTranslationFailed/, 'translation stats must report failed descriptions');
has(/stTranslationSkipped/, 'translation stats must report skipped descriptions');
has(/stTranslationPending/, 'translation stats must report pending descriptions');
has(/stTranslationReady/, 'translation stats must report descriptions ready to translate');
has(/https:\/\/api\.deepseek\.com\/chat\/completions/, 'DeepSeek direct endpoint must be configured');
has(/deepseek-v4-flash/, 'DeepSeek direct model selector must include the fast V4 Flash model');
has(/deepseek-v4-pro/, 'DeepSeek direct model selector must keep DeepSeek V4 Pro available');
has(/https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/, 'OpenRouter endpoint must be configured');
has(/deepseek\/deepseek-v4-pro/, 'OpenRouter model must use DeepSeek V4 Pro');
has(/function\s+isTranslatableDescription/, 'page must decide whether a source description is worth translating');
has(/function\s+translateDescriptions/, 'page must translate selected product descriptions');
has(/function\s+reviewTranslations/, 'page must review translated descriptions');
has(/function\s+validateTranslatedDescription/, 'page must locally validate reviewed translations');
has(/function\s+retryFailedTranslations/, 'page must retry only failed translations');
has(/function\s+pauseTranslations/, 'page must pause an active translation batch');
has(/function\s+resumeTranslations/, 'page must resume a paused translation batch');
has(/function\s+translationMinLength/, 'page must read the editable description length threshold');
has(/function\s+syncTranslationModelOptions/, 'page must sync model choices with the selected provider');
has(/function\s+translationModelName/, 'page must send the selected model to the API');
has(/function\s+refreshTranslationEligibility/, 'page must refresh eligibility when the threshold changes');
has(/function\s+excludeTranslation/, 'page must let users exclude filtered descriptions from translation');
has(/function\s+restoreExcludedTranslation/, 'page must let users restore manually excluded descriptions');
has(/skipped_manual/, 'manual translation exclusions must be represented as skipped state');
has(/let\s+[^;]*translationPaused\s*=\s*false/, 'translation state must track pause/resume status');
has(/translationQueue/, 'translation state must keep a resumable queue');
has(/id="translationMinLength"[^>]*value="70"/, 'default translation threshold must be 70 characters');
has(/plain\.length\s*<=\s*minLength/, 'descriptions at or below the editable threshold must be skipped');
notHas(/plain\.length\s*<\s*35/, 'old 35-character translation threshold must be removed');
has(/AbortController/, 'translation API calls must be abortable instead of hanging forever');
has(/TRANSLATION_API_TIMEOUT_MS/, 'translation API calls must have a clear timeout');
has(/بدأت ترجمة/, 'translation run must log an immediate start message');
has(/response_format\s*:\s*\{\s*type\s*:\s*['"]json_object['"]\s*\}/, 'LLM calls must request JSON object responses');
has(/includes\(['"]\*['"]\)/, 'translation validator must reject asterisks');
has(/\\u4E00-\\u9FFF|Script=Han/, 'translation validator must reject Chinese characters');
has(/سوف أترجم|سأترجم|I will translate|Here is/i, 'translation validator must reject assistant preambles');
notHas(/slice\(\s*0\s*,\s*400\s*\)/, 'preview must not hard-cap visible rows to 400');
notHas(/أول\s*\$\{Math\.min\(visibleRows\.length,400\)/, 'preview note must not mention the first 400 rows');

const templateBody = html.match(/function\s+templateRowArray\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(!/translationStatus|translationReason|translationLabel|translationAction/.test(templateBody), 'translation preview columns must not be exported in templateRowArray');
assert.ok(/row\.cost\s*,\s*row\.sale\s*,\s*''\s*,\s*''\s*,\s*10000\s*,/.test(templateBody), 'templateRowArray must export 10000 for max quantity per customer');
has(/function\s+previewExtraCells/, 'translation status/reasons must be rendered as preview-only cells');
notHas(/templateFileObj/, 'template upload state must stay removed');
has(/function\s+removeExtraWorksheets/, 'export must remove template helper worksheets before download');
has(/workbook\.removeWorksheet\(workbook\.worksheets\[1\]\.id\)/, 'export must remove every worksheet after the first one');
has(/const\s+removeCount\s*=\s*Math\.max\(worksheet\.rowCount-2,\s*0\)/, 'export must remove all template sample rows after the two header rows');
has(/worksheet\.spliceRows\(3,\s*removeCount\)/, 'export must delete template sample rows starting at row 3');

const productStyleIndex = html.indexOf('const productStyle=captureRowStyle(worksheet,3)');
const optionStyleIndex = html.indexOf('const optionStyle=captureRowStyle(worksheet,4)');
const spliceIndex = html.indexOf('worksheet.spliceRows(3,removeCount)');
assert.ok(productStyleIndex > -1 && optionStyleIndex > -1 && spliceIndex > -1, 'export must capture template row styles and remove sample rows');
assert.ok(productStyleIndex < spliceIndex && optionStyleIndex < spliceIndex, 'export must capture product and option styles before deleting template sample rows');

const removeSheetsIndex = html.indexOf('removeExtraWorksheets(workbook)');
const writeBufferIndex = html.indexOf('workbook.xlsx.writeBuffer()');
assert.ok(removeSheetsIndex > -1 && writeBufferIndex > -1 && removeSheetsIndex < writeBufferIndex, 'export must remove extra worksheets before writing the XLSX file');

const selectedRowsBody = html.match(/function\s+selectedRows\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(selectedRowsBody.includes('isBrandFileSelected'), 'selectedRows must include rows matched by the optional brand file');

const brandFileArabicNameBody = html.match(/function\s+brandFileArabicNameForRow\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(/Page Description/.test(brandFileArabicNameBody) && /جميع\\s\+عطور/.test(brandFileArabicNameBody) && /الأصلية/.test(brandFileArabicNameBody), 'brand-file Arabic names must be extracted from the fixed page-description text');
assert.ok(/Page Title/.test(brandFileArabicNameBody) && /replace\(\s*\/\^عطور\\s\+\//.test(brandFileArabicNameBody), 'brand-file Arabic names must fall back to the Arabic page title');
assert.ok(/اسم الماركة/.test(brandFileArabicNameBody) && /function\s+firstArabicBrandPart/.test(html) && /\[-–—\|\/\]/.test(html), 'brand-file Arabic names must fall back to Arabic parts from the brand name');

const pageScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
const brandFileArabicExamples = vm.runInNewContext(`${pageScript}
[
  brandFileArabicNameForRow({'(Page Description) وصف صفحة العلامة التجارية':'جميع عطور نسك الأصلية اسعارنا مميزة','(Page Title) عنوان صفحة العلامة التجارية':'','اسم الماركة':'Nusuk'}),
  brandFileArabicNameForRow({'(Page Description) وصف صفحة العلامة التجارية':'','(Page Title) عنوان صفحة العلامة التجارية':'عطور اديداس | عاطر','اسم الماركة':'Adidas'}),
  brandFileArabicNameForRow({'(Page Description) وصف صفحة العلامة التجارية':'','(Page Title) عنوان صفحة العلامة التجارية':'','اسم الماركة':'عطور كلين'})
]`);
assert.deepEqual(Array.from(brandFileArabicExamples), ['نسك','اديداس','كلين'], 'brand-file Arabic extraction must cover Nusuk, Adidas, and Clean cases');

const buildBrandFileMapBody = html.match(/function\s+buildBrandFileMap\s*\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(buildBrandFileMapBody.includes('brandFileArabicMap'), 'buildBrandFileMap must populate the Arabic brand-file map');

const arabicBrandForBody = html.match(/function\s+arabicBrandFor\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(arabicBrandForBody.includes('brandFileArabicMap'), 'arabicBrandFor must use Arabic names extracted from the optional brand file');
