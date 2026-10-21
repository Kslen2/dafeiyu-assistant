// 应用级迁移测试：先写入 v5 旧状态，再启动 app.js，验证旧餐食卡/待补充记录被统一成草稿。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DIST = path.join(__dirname, "..", "dist");
const failures = [];
const assert = (condition, label) => {
  if (condition) console.log(`PASS ${label}`);
  else { console.log(`FAIL ${label}`); failures.push(label); }
};

function makeElement(tag = "div") {
  return {
    tagName: String(tag).toUpperCase(), id: "", className: "", innerHTML: "", textContent: "", value: "", disabled: false,
    dataset: {}, style: { setProperty() {} }, children: [], files: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.push(child); return child; }, insertAdjacentHTML() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, blur() {}, click() {}, remove() {},
    closest() { return null; }, querySelector() { return makeElement(); }, querySelectorAll() { return []; }
  };
}
const elementCache = new Map();
const documentStub = {
  readyState: "complete", activeElement: null, documentElement: makeElement("html"), body: makeElement("body"),
  querySelector(selector) { if (!elementCache.has(selector)) elementCache.set(selector, makeElement()); return elementCache.get(selector); },
  querySelectorAll() { return []; }, createElement(tag) { return makeElement(tag); }, addEventListener() {}
};
const memoryStore = new Map();
function makeRequest(run) { const request = {}; setTimeout(() => { run(request); request.onsuccess?.(); }, 0); return request; }
const databaseStub = {
  objectStoreNames: { contains: () => true }, createObjectStore: () => ({}),
  transaction: () => ({ objectStore: () => ({
    get: (key) => makeRequest((request) => { request.result = memoryStore.get(key); }),
    put: (value, key) => makeRequest(() => { memoryStore.set(key, value); })
  }) })
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => { throw new Error("no network in tests"); },
  indexedDB: { open: () => makeRequest((request) => { request.result = databaseStub; }) },
  document: documentStub, innerHeight: 900, visualViewport: { height: 900, addEventListener() {} },
  addEventListener() {}, alert() {}, confirm: () => true
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.memoryStore = memoryStore;
vm.createContext(sandbox);

// 预先写入 v5 状态：旧已确认餐食、旧待补充记录、旧未确认图片卡、旧已确认图片卡。
const now = new Date();
const localKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const legacyToday = localKey(now);
const legacyYesterday = localKey(hoursAgo(24));
const legacyState = {
  schemaVersion: 5,
  appVersion: "0.10.1",
  demo: false,
  settings: { apiKey: "" },
  tasks: [],
  entries: [
    { id: "old-meal", type: "meal", date: legacyYesterday, createdAt: hoursAgo(24).toISOString(), data: { name: "午饭", calories: 700, protein: 30, carbs: 90, fat: 22, confirmed: true } },
    { id: "old-note", type: "meal_note", date: legacyToday, createdAt: hoursAgo(0.6).toISOString(), data: { description: "这是我的晚饭", analyzed: false }, sourceText: "这是我的晚饭" }
  ],
  messages: [
    { id: "m1", role: "assistant", type: "meal", createdAt: hoursAgo(1).toISOString(), meal: { isFood: true, name: "猪肉白菜海带拌面", calories: 680, protein: 34, carbs: 82, fat: 24, foods: ["猪排约120克", "面条约200克"], note: "粗略估算" }, confirmed: false, sourceEntryId: null, recordedText: "这是今天的晚饭" },
    { id: "m2", role: "assistant", type: "meal", createdAt: hoursAgo(23).toISOString(), meal: { isFood: true, name: "午饭", calories: 700, protein: 30, carbs: 90, fat: 22 }, confirmed: true, sourceEntryId: "old-meal" }
  ]
};
memoryStore.set("primary", legacyState);

for (const file of ["record-parser.js", "record-operations.js", "profile-core.js", "conversation-router.js", "meal-model.js", "assistant-core.js", "app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(DIST, file), "utf8"), sandbox, { filename: file });
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  for (let i = 0; i < 80; i += 1) {
    await wait(50);
    if (vm.runInContext("typeof state !== 'undefined' && Array.isArray(state.entries) && state.schemaVersion === 6", sandbox)) break;
  }
  const result = vm.runInContext(`(() => {
    const byId = (id) => state.entries.find((entry) => entry.id === id);
    const message = (id) => state.messages.find((item) => item.id === id);
    const pending = latestPendingMealDraft();
    const clarification = pendingMealClarificationContext();
    return {
      schemaVersion: state.schemaVersion,
      oldMeal: byId("old-meal"),
      oldNote: byId("old-note"),
      m1: message("m1"),
      m2: message("m2"),
      pendingId: pending && pending.id,
      pendingItems: pending ? window.FeiyuMeal.view(pending).items.length : 0,
      clarificationId: clarification && clarification.entry.id,
      draftCount: state.entries.filter((entry) => entry.type === "meal_draft").length,
      savedSchema: memoryStore.get("primary") ? memoryStore.get("primary").schemaVersion : null
    };
  })()`, sandbox);

  assert(result.schemaVersion === 6, "state schema is upgraded to v6");
  assert(result.oldNote && result.oldNote.type === "meal_draft", "legacy meal_note becomes a meal_draft");
  assert(result.oldNote.data.status === "clarify" && result.oldNote.data.items.length === 0, "legacy unanalyzed note stays awaiting details");
  assert(result.oldMeal.data.items.length === 1 && result.oldMeal.data.calories === 700, "legacy confirmed meal gets an aggregate item");
  assert(result.m2.draftId === "old-meal", "legacy confirmed card links to its meal record");
  assert(result.m1.draftId && result.m1.draftId.startsWith("draft-m1"), "legacy pending card gets a draft");
  assert(result.pendingItems === 1, "pending draft inherits the old card's aggregate item");
  assert(result.oldNote.data.awaitingClarification === false, "legacy note is migrated without inventing a pending question");
  assert(result.clarificationId === null, "only real pending questions become clarification context");
  assert(result.draftCount === 2, "exactly one draft per pending source");
  assert(result.savedSchema === 6, "migrated schema is persisted");

  if (failures.length) { console.error(`\n${failures.length} failed`); process.exitCode = 1; }
  else console.log("\nAll meal migration assertions passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
