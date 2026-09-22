import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const legacyDir = join(root, "worker", "legacy");
const htmlFiles = [
  ["index.html", "tool.html"],
  ["new-products.html", "new-products.html"],
  ["fix-options.html", "fix-options.html"],
  ["translate-descriptions.html", "translate-descriptions.html"],
  ["check-descriptions.html", "check-descriptions.html"],
  ["prepare-orders.html", "prepare-orders.html"],
];

await rm(publicDir, { recursive: true, force: true });
await rm(legacyDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await mkdir(legacyDir, { recursive: true });

for (const [source, target] of htmlFiles) {
  await cp(join(root, source), join(publicDir, target));
}
await cp(join(root, "assets"), join(publicDir, "assets"), { recursive: true });
await cp(join(root, "assets", "og.png"), join(publicDir, "og.png"));

for (const name of ["prepare-orders", "translate-description", "check-description", "fragrancex-orders"]) {
  await cp(join(root, "api", `${name}.js`), join(legacyDir, `${name}.cjs`));
}

let costsSource = await readFile(join(root, "api", "fragrancex-costs.js"), "utf8");
costsSource = costsSource
  .replace("const fs = require('node:fs');\nconst path = require('node:path');\n", "const BUNDLED_SKU_WEIGHTS = require('../../data/fragrancex-weights.json');\n")
  .replace(/function loadSkuWeights\(\) \{[\s\S]*?\n\}/, `function loadSkuWeights() {
  if (!cachedWeights) cachedWeights = BUNDLED_SKU_WEIGHTS;
  return cachedWeights;
}`);
await writeFile(join(legacyDir, "fragrancex-costs.cjs"), costsSource);
