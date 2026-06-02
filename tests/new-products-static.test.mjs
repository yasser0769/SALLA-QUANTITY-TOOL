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
has(/const\s+TEMPLATE_BASE64='[^']{1000,}'/, 'page must embed a template fallback for file:// usage');
has(/function\s+base64ToArrayBuffer/, 'page must decode embedded template fallback');
has(/catch\s*\([^)]*\)\s*\{[\s\S]*TEMPLATE_BASE64/, 'workbookFromTemplate must fallback when fetch fails');

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
has(/https:\/\/api\.deepseek\.com\/chat\/completions/, 'DeepSeek direct endpoint must be configured');
has(/deepseek-v4-pro/, 'DeepSeek direct model must use deepseek-v4-pro');
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
has(/function\s+refreshTranslationEligibility/, 'page must refresh eligibility when the threshold changes');
has(/function\s+excludeTranslation/, 'page must let users exclude filtered descriptions from translation');
has(/function\s+restoreExcludedTranslation/, 'page must let users restore manually excluded descriptions');
has(/skipped_manual/, 'manual translation exclusions must be represented as skipped state');
has(/let\s+[^;]*translationPaused\s*=\s*false/, 'translation state must track pause/resume status');
has(/translationQueue/, 'translation state must keep a resumable queue');
has(/id="translationMinLength"[^>]*value="70"/, 'default translation threshold must be 70 characters');
has(/plain\.length\s*<=\s*minLength/, 'descriptions at or below the editable threshold must be skipped');
notHas(/plain\.length\s*<\s*35/, 'old 35-character translation threshold must be removed');
has(/response_format\s*:\s*\{\s*type\s*:\s*['"]json_object['"]\s*\}/, 'LLM calls must request JSON object responses');
has(/includes\(['"]\*['"]\)/, 'translation validator must reject asterisks');
has(/\\u4E00-\\u9FFF|Script=Han/, 'translation validator must reject Chinese characters');
has(/سوف أترجم|سأترجم|I will translate|Here is/i, 'translation validator must reject assistant preambles');
notHas(/slice\(\s*0\s*,\s*400\s*\)/, 'preview must not hard-cap visible rows to 400');
notHas(/أول\s*\$\{Math\.min\(visibleRows\.length,400\)/, 'preview note must not mention the first 400 rows');

const templateBody = html.match(/function\s+templateRowArray\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(!/translationStatus|translationReason|translationLabel|translationAction/.test(templateBody), 'translation preview columns must not be exported in templateRowArray');
has(/function\s+previewExtraCells/, 'translation status/reasons must be rendered as preview-only cells');
notHas(/templateFileObj/, 'template upload state must stay removed');
