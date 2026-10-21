const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const app = read("dist/app.js");
const html = read("dist/index.html");
const core = read("dist/assistant-core.js");
const manifest = JSON.parse(read("dist/manifest.json"));

const appVersion = app.match(/^const APP_VERSION = "([^"]+)";/m)?.[1];
const htmlVersion = html.match(/class="version-tag">v([^<]+)</)?.[1];
assert.ok(appVersion, "app version must exist");
assert.equal(htmlVersion, appVersion, "visible version must match packaged version");

const requiredScripts = ["record-parser.js", "record-operations.js", "profile-core.js", "assistant-core.js", "app.js"];
let previousIndex = -1;
for (const script of requiredScripts) {
  const index = html.indexOf(`./${script}`);
  assert.ok(index > previousIndex, `${script} must be loaded in dependency order`);
  assert.ok(fs.existsSync(path.join(root, "dist", script)), `${script} must exist`);
  previousIndex = index;
}

const referencedIds = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
assert.deepEqual(missingIds, [], `every JavaScript DOM id must exist in HTML: ${missingIds.join(", ")}`);
const views = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
const navTargets = [...html.matchAll(/data-target="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(new Set(navTargets), new Set(views), "bottom navigation and app views must remain in sync");

assert.match(app, /indexedDB\.open\(/, "records must use IndexedDB");
assert.match(app, /exported\.settings\.apiKey\s*=\s*""/, "backup must exclude API key");
assert.match(app, /FeiyuRecordOps\.dayMetrics/, "day screen must use tested aggregation");
assert.match(app, /FeiyuRecordOps\.trendMetrics/, "trend screen must use tested aggregation");
assert.match(app, /pendingMealClarificationContext\(\)/, "meal clarification replies must stay in the structured meal flow");
assert.match(app, /FeiyuRecords\.isMealEstimateRequest/, "meal estimates must use the tested intent boundary instead of a broad calorie regex");
assert.match(app, /mealRecordedAt = currentHasFood[\s\S]{0,180}resolveEventTime/, "historical meal estimates must retain the user-stated meal date when confirmed");
assert.match(app, /await confirmMeal\(pendingMessage\.id\)/, "typed meal confirmation must perform a real database confirmation");
assert.match(app, /repairEmbeddedMealExpenses\(\)/, "older meal notes with embedded expenses must be repaired on migration");
assert.match(app, /repairMisclassifiedSleepEntries\(\)/, "misclassified sleep notes must be repaired on migration");
assert.match(app, /FeiyuRecords\.resolveSleepTiming/, "sleep records must preserve cross-day bed and wake timestamps");
assert.match(app, /FeiyuAI\.interpretLifeEvent/, "complex life events must use structured AI interpretation");
assert.match(app, /applyInterpretedActions/, "AI interpretations must be applied by deterministic app code");
assert.match(app, /create_life_event/, "universal completed events must have a structured persistence operation");
assert.match(app, /profileChangeCardHtml/, "profile changes must be shown for confirmation");
assert.match(app, /confirmProfileChange/, "profile changes must require explicit confirmation");
assert.match(app, /openEntryEditor/, "day cards must support manual editing");
assert.match(app, /openEntryCreator/, "day screen must support manual record creation");
assert.match(app, /saveEditedEntry/, "manual edits must have a persistence path");
assert.match(app, /deleteEntryManually/, "day cards must support manual deletion");
assert.match(app, /addOperationReceipt/, "successful mutations must create structured result cards");
assert.match(app, /undoOperation/, "structured result cards must support one-tap undo");
assert.match(app, /data-view-operation-day/, "operation results must link to the affected day");
assert.match(app, /sanitizeUnverifiedChatReply/, "unverified AI chat replies must not claim database mutations");
assert.match(app, /记录指令已发/, "false mutation claims from chat must be rejected deterministically");
assert.match(html, /id="entryEditor"/, "manual editor dialog must exist");
assert.match(html, /id="openEntryCreator"/, "day screen must expose manual record creation");
assert.match(html, /id="entryEditType"/, "manual creation must allow choosing a record type");
assert.match(html, /id="deleteEditedEntry"/, "manual editor must expose deletion");
assert.match(app, /profile:\s*currentProfile\(\)/, "AI calls must receive the active personalized profile");
assert.match(app, /FeiyuProfile\.normalize/, "older installs must migrate to a normalized profile");
assert.match(app, /imported\.settings\?\.profile[\s\S]{0,120}FeiyuProfile\.normalize/, "complete backup import must restore personalized settings without replacing the API key");
assert.match(core, /https:\/\/api\.deepseek\.com\/chat\/completions/, "AI endpoint must use HTTPS");
assert.match(core, /日维持热量或可靠的全天总消耗/, "calorie deficit answers must require a valid expenditure baseline");
assert.equal(manifest.name, "大肥鱼助手");
for (const icon of manifest.icons || []) assert.ok(fs.existsSync(path.join(root, "dist", icon.src)), `manifest icon must exist: ${icon.src}`);

console.log("PASS application integrity, offline assets, backup privacy, and version consistency");
