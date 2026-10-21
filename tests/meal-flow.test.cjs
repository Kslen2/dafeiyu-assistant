// 应用级流程测试：用最小 DOM/IndexedDB 桩加载 dist/app.js，验证“草稿 → 修正 → 编辑 → 确认 → 撤销”。
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
    tagName: String(tag).toUpperCase(),
    id: "", className: "", innerHTML: "", textContent: "", value: "", disabled: false,
    dataset: {}, style: { setProperty() {} }, children: [], files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.push(child); return child; },
    insertAdjacentHTML() {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    focus() {}, blur() {}, click() {}, remove() {}, closest() { return null; },
    querySelector() { return makeElement(); }, querySelectorAll() { return []; }
  };
}

const elementCache = new Map();
const documentStub = {
  readyState: "complete",
  activeElement: null,
  documentElement: makeElement("html"),
  body: makeElement("body"),
  querySelector(selector) {
    if (!elementCache.has(selector)) elementCache.set(selector, makeElement());
    return elementCache.get(selector);
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {}
};

const memoryStore = new Map();
function makeRequest(run) {
  const request = {};
  setTimeout(() => { run(request); request.onsuccess?.(); }, 0);
  return request;
}
const databaseStub = {
  objectStoreNames: { contains: () => true },
  createObjectStore: () => ({}),
  transaction: () => ({
    objectStore: () => ({
      get: (key) => makeRequest((request) => { request.result = memoryStore.get(key); }),
      put: (value, key) => makeRequest(() => { memoryStore.set(key, value); })
    })
  })
};

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => { throw new Error("测试环境不发起真实请求"); },
  indexedDB: { open: () => makeRequest((request) => { request.result = databaseStub; }) },
  document: documentStub,
  innerHeight: 900,
  visualViewport: { height: 900, addEventListener() {} },
  addEventListener() {},
  alert() {}, confirm: () => true
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const file of ["record-parser.js", "record-operations.js", "profile-core.js", "conversation-router.js", "meal-model.js", "assistant-core.js", "app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(DIST, file), "utf8"), sandbox, { filename: file });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (expression) => vm.runInContext(expression, sandbox);

async function main() {
  for (let i = 0; i < 80; i += 1) {
    await wait(50);
    if (await run("typeof state !== 'undefined' && Array.isArray(state.messages) && typeof handleSend === 'function'")) break;
  }
  assert(await run("typeof state !== 'undefined' && typeof handleSend === 'function'"), "app.js initializes in the stub environment");

  const mealResult = `({
    isFood: true,
    name: "牛肉蔬菜泡面",
    items: [
      { name: "牛肉", amount: "150克", calories: 250, protein: 26, carbs: 0, fat: 16 },
      { name: "过水泡面", amount: "一包", calories: 420, protein: 16, carbs: 82, fat: 14 },
      { name: "煎蛋", amount: "一个", calories: 100, protein: 7, carbs: 1, fat: 7 }
    ],
    calories: 770, protein: 49, carbs: 83, fat: 37,
    foods: ["牛肉150克", "过水泡面一包", "煎蛋一个"],
    needsClarification: false, question: "", note: "按口述份量估算"
  })`;
  const revisedResult = `({
    isFood: true,
    name: "牛肉半包泡面",
    items: [
      { name: "牛肉", amount: "100克", calories: 170, protein: 18, carbs: 0, fat: 11 },
      { name: "过水泡面", amount: "半包", calories: 210, protein: 8, carbs: 41, fat: 7 }
    ],
    calories: 380, protein: 26, carbs: 41, fat: 18,
    foods: ["牛肉100克", "泡面半包"],
    needsClarification: false, question: "", note: "按补充份量重算"
  })`;

  await run(`
    window.__calls = [];
    window.FeiyuAI = {
      analyzeMeal: async () => ${mealResult},
      reviseMeal: async (options) => { window.__calls.push(["reviseMeal", options.correction]); return ${revisedResult}; },
      chat: async (options) => { window.__calls.push(["chat", options.text]); return "普通回复"; },
      interpretLifeEvent: async () => ({ intent: "record", actions: [], mealText: "", needsClarification: false, question: "" }),
      summarizeDay: async () => ({ title: "今天", suggestions: [] })
    };
    state.demo = false;
    state.entries = [];
    state.tasks = [];
    state.messages = [];
    true;
  `);

  // 1. 照片/文字餐食都先建立同一种草稿，再生成引用草稿的卡片
  const draftInfo = await run(`(async () => {
    const { draft, meal } = await analyzeMealIntoDraft({
      description: "这是今天的晚饭", sourceType: "photo", dateRef: new Date(),
      timeContext: "", imageDataUrl: "", recordedText: "这是今天的晚饭", imageName: "IMG_1.jpg"
    });
    const card = state.messages.find((message) => message.type === "meal" && message.draftId === draft.id);
    const view = window.FeiyuMeal.view(draft);
    return { draftId: draft.id, type: draft.type, status: draft.data.status, cardDraftId: card && card.draftId, items: view.items.length, calories: view.totals.calories, draftCount: state.entries.filter((entry) => entry.type === "meal_draft").length };
  })()`);
  assert(draftInfo.type === "meal_draft", "photo meal creates a meal_draft entry");
  assert(draftInfo.cardDraftId === draftInfo.draftId, "meal card references the draft");
  assert(draftInfo.items === 3 && draftInfo.calories === 770, "card totals are summed from items");
  assert(draftInfo.draftCount === 1, "only one draft exists for the meal");

  // 2. 聊天口述份量 → 更新同一张草稿和同一张卡，不新建第二张
  const correction = await run(`(async () => {
    document.querySelector("#chatInput").value = "牛肉只有100克，泡面只吃了半包";
    await handleSend();
    const drafts = state.entries.filter((entry) => entry.type === "meal_draft");
    const cards = state.messages.filter((message) => message.type === "meal");
    const draft = drafts[0];
    const view = window.FeiyuMeal.view(draft);
    return {
      drafts: drafts.length, cards: cards.length, items: view.items.length, calories: view.totals.calories,
      name: view.name, corrections: view.corrections.length, route: document.documentElement.dataset.lastConversationRoute,
      lastText: state.messages[state.messages.length - 1].text, hasRevise: window.__calls.some((call) => call[0] === "reviseMeal")
    };
  })()`);
  assert(correction.route === "meal_correction", `quantity correction routes to meal_correction (${correction.route})`);
  assert(correction.drafts === 1 && correction.cards === 1, "correction updates the same draft and card (no duplicates)");
  assert(correction.items === 2 && correction.calories === 380, "items and totals are replaced by the revision");
  assert(correction.corrections === 1, "the correction is recorded on the draft");
  assert(/已按补充更新这张卡/.test(correction.lastText || ""), "correction leaves a short update note");

  // 3. 逐项编辑后合计按项重算，卡片从草稿读取
  const edited = await run(`(() => {
    const draft = state.entries.find((entry) => entry.type === "meal_draft");
    window.FeiyuMeal.applyItems(draft, [
      { name: "牛肉", amount: "120克", calories: 200, protein: 21, carbs: 0, fat: 13 },
      { name: "泡面", amount: "半包", calories: 210, protein: 8, carbs: 41, fat: 7 },
      { name: "青菜", amount: "100克", calories: 20, protein: 2, carbs: 3, fat: 0 }
    ], { name: "牛肉青菜泡面" });
    const view = window.FeiyuMeal.view(draft);
    return { items: view.items.length, calories: view.totals.calories, name: view.name, draftCalories: draft.data.calories };
  })()`);
  assert(edited.items === 3 && edited.calories === 430, "per-item editing recomputes the total");
  assert(edited.name === "牛肉青菜泡面" && edited.draftCalories === 430, "edited name and totals live on the draft");

  // 4. 卡片按钮确认 → 记录保存分项与合计；撤销恢复草稿
  const confirmed = await run(`(async () => {
    const card = state.messages.find((message) => message.type === "meal");
    await confirmMeal(card.id);
    const entry = state.entries.find((item) => item.id === card.draftId);
    const metrics = window.FeiyuRecordOps.dayMetrics([entry]);
    const receipt = state.messages.find((message) => message.type === "operation");
    return {
      type: entry.type, confirmed: entry.data.confirmed, items: entry.data.items.length,
      calories: entry.data.calories, metricsCalories: metrics.calories, mealCount: metrics.mealCount,
      messageConfirmed: card.confirmed, receiptId: receipt.id
    };
  })()`);
  assert(confirmed.type === "meal" && confirmed.confirmed === true, "confirmation converts the draft into a meal record");
  assert(confirmed.items === 3 && confirmed.calories === 430, "confirmed record keeps the item list");
  assert(confirmed.metricsCalories === 430 && confirmed.mealCount === 1, "day metrics count the confirmed meal");
  assert(confirmed.messageConfirmed === true, "card shows as confirmed");

  const undone = await run(`(async () => {
    const receipt = state.messages.find((message) => message.type === "operation");
    await undoOperation(receipt.id);
    const entry = state.entries.find((item) => item.type === "meal_draft");
    const card = state.messages.find((message) => message.type === "meal");
    return { type: entry && entry.type, confirmed: Boolean(entry && entry.data.confirmed), cardConfirmed: Boolean(card && card.confirmed) };
  })()`);
  assert(undone.type === "meal_draft" && undone.confirmed === false, "undo restores the pending draft");
  assert(undone.cardConfirmed === false, "undo re-enables the card");

  // 5. 笼统纠错与餐次指认仍然走确定性回复
  const vague = await run(`(async () => {
    document.querySelector("#chatInput").value = "卡片不准，需要修改";
    await handleSend();
    return { route: document.documentElement.dataset.lastConversationRoute, text: state.messages[state.messages.length - 1].text };
  })()`);
  assert(vague.route === "meal_correction_prompt" && /要改哪里/.test(vague.text || ""), "vague complaints ask for specifics");
  const caption = await run(`(async () => {
    document.querySelector("#chatInput").value = "这是我的晚饭";
    await handleSend();
    return { route: document.documentElement.dataset.lastConversationRoute, text: state.messages[state.messages.length - 1].text, drafts: state.entries.filter((entry) => entry.type === "meal_draft").length };
  })()`);
  assert(caption.route === "meal_caption" && caption.drafts === 1, "bare meal captions do not create another draft");
  assert(/还没有确认/.test(caption.text || ""), "caption points at the pending card");

  // 6. 独立营养查询只读
  const query = await run(`(async () => {
    document.querySelector("#chatInput").value = "正常来说一天应该摄入多少蛋白质";
    await handleSend();
    return { route: document.documentElement.dataset.lastConversationRoute, drafts: state.entries.filter((entry) => entry.type === "meal_draft").length };
  })()`);
  assert(query.route === "query_chat" && query.drafts === 1, "nutrition queries stay read-only");

  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll meal draft flow assertions passed");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
