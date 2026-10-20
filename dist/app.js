const APP_VERSION = "0.7.0";
const SCHEMA_VERSION = 4;
const DB_NAME = "dafeiyu-assistant-preview-v2";
const STORE_NAME = "app-state";
const STATE_KEY = "primary";
const IDLE_COMPOSER_NOTE = "普通记录只保存；饮食会自动估算";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const timeLabel = (value = new Date()) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const entryTimeLabel = (entry) => entry?.timeSource === "period" && entry.timeText
  ? `${entry.timeText}（约${timeLabel(entry.occurredAt || entry.createdAt)}）`
  : timeLabel(entry?.occurredAt || entry?.createdAt);
const dateKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const localDateFromIso = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatMoney = (value, decimals = 2) => {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount).toFixed(decimals).replace(/\.00$/, "");
  return amount < 0 ? `-¥${absolute}` : `¥${absolute}`;
};
const formatMessageText = (value = "", allowMarkdown = false) => {
  const safe = escapeHtml(value);
  return (allowMarkdown ? safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") : safe).replace(/\n/g, "<br>");
};

function sanitizeUnverifiedChatReply(reply) {
  const value = String(reply || "").trim();
  const mutationClaim = /(?:^|[，。；！!\n])\s*(?:我|这边|系统|应用)?\s*(?:已|已经)(?:为你)?(?:记录|保存|写入|同步|确认|更新|删除|执行)|记录指令已发|指令已发给应用|实际写入由应用执行|请到[“\"']?当天[”\"']?页面查看是否/;
  if (!mutationClaim.test(value)) return value;
  return "这句话没有被应用识别为可写入记录，因此目前没有保存。请换一种包含记录类型和时间或数值的明确说法；只有应用显示“已记录……”确认条时，才表示已经写入“当天”。";
}

let db;
let state;
let toastTimer;
let pendingPhoto = null;
let requestInFlight = false;
let selectedDay = dateKey(0);
let viewportBaselineHeight = window.innerHeight;

function cssPixelValue(name) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function syncAppViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const visibleHeight = Math.min(layoutHeight, viewport?.height || layoutHeight);
  const nativeKeyboardHeight = cssPixelValue("--native-keyboard-height");
  const viewportReduction = Math.max(0, viewportBaselineHeight - visibleHeight);
  const keyboardOpen = nativeKeyboardHeight > 120 || viewportReduction > 120;

  if (!keyboardOpen) viewportBaselineHeight = Math.max(layoutHeight, viewport?.height || 0);
  const nativeVisibleHeight = Math.max(320, viewportBaselineHeight - nativeKeyboardHeight);
  const effectiveHeight = keyboardOpen ? Math.min(visibleHeight, nativeVisibleHeight) : visibleHeight;
  root.style.setProperty("--app-viewport-height", `${Math.round(effectiveHeight)}px`);
  root.classList.toggle("keyboard-open", keyboardOpen);

  if (keyboardOpen && document.activeElement === $("#chatInput")) {
    requestAnimationFrame(() => {
      const chat = $("#chatScroll");
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
  }
}

window.syncAppViewport = syncAppViewport;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function databaseGet(key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function databaseSet(key, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function seedState() {
  const entries = [];
  const sleep = [6.6, 7.1, 7.5, 6.9, 7.3, 7.7, 7.0];
  const water = [1200, 1500, 1700, 1300, 1800, 1600, 900];
  sleep.forEach((hours, index) => {
    const offset = index - 6;
    entries.push({ id: uid(), type: "sleep", date: dateKey(offset), createdAt: `${dateKey(offset)}T07:45:00`, data: { hours }, source: "demo" });
    entries.push({ id: uid(), type: "water", date: dateKey(offset), createdAt: `${dateKey(offset)}T20:00:00`, data: { ml: water[index] }, source: "demo" });
  });
  [
    [-6, 18, "餐饮", "早餐"], [-6, 25, "交通", "地铁与单车"], [-5, 42, "餐饮", "午饭"],
    [-4, 36, "购物", "生活用品"], [-3, 22, "餐饮", "咖啡与面包"], [-2, 68, "餐饮", "晚餐外卖"],
    [-1, 15, "交通", "打车补差"], [0, 28, "餐饮", "午饭"]
  ].forEach(([offset, amount, category, note]) => entries.push({ id: uid(), type: "expense", date: dateKey(offset), createdAt: `${dateKey(offset)}T12:30:00`, data: { amount, category, note }, source: "demo" }));
  [
    [-5, "跑步", 35], [-3, "快走", 42], [-1, "力量训练", 30]
  ].forEach(([offset, activity, minutes]) => entries.push({ id: uid(), type: "exercise", date: dateKey(offset), createdAt: `${dateKey(offset)}T18:30:00`, data: { activity, minutes }, source: "demo" }));
  [
    [-4, 590, 29, 72, 20], [-3, 680, 35, 83, 24], [-2, 720, 31, 91, 27], [-1, 620, 38, 68, 22], [0, 560, 32, 66, 19]
  ].forEach(([offset, calories, protein, carbs, fat]) => entries.push({ id: uid(), type: "meal", date: dateKey(offset), createdAt: `${dateKey(offset)}T12:20:00`, data: { name: "午餐", calories, protein, carbs, fat, confirmed: true }, source: "demo" }));

  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    demo: true,
    entries,
    messages: [
      { id: uid(), role: "assistant", type: "text", text: "嗨，我是大肥鱼。你可以像聊天一样记下吃饭、睡眠、运动、饮水、消费和待办。饮食会先给出粗略营养估算，确认后计入统计；其他普通记录会安静保存。", createdAt: nowIso() },
      { id: uid(), role: "user", type: "text", text: "昨晚睡了 7 小时，午饭 28 元", createdAt: nowIso() },
      { id: uid(), role: "assistant", type: "ack", text: "已记录睡眠 7 小时、餐饮消费 ¥28", createdAt: nowIso() }
    ],
    tasks: [
      { id: uid(), text: "整理本周消费票据", dueDate: dateKey(1), done: false, createdAt: nowIso(), source: "demo" },
      { id: uid(), text: "买一箱矿泉水", dueDate: "", done: false, createdAt: nowIso(), source: "demo" },
      { id: uid(), text: "完成 30 分钟快走", dueDate: dateKey(0), done: true, createdAt: nowIso(), source: "demo" }
    ],
    settings: { apiKey: "", profile: window.FeiyuProfile.defaults() }
  };
}

async function saveState() {
  state.appVersion = APP_VERSION;
  state.schemaVersion = SCHEMA_VERSION;
  await databaseSet(STATE_KEY, state);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
}

function switchView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === name));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.target === name));
  if (name === "day") renderDay();
  if (name === "trends") renderTrends();
  if (name === "tasks") renderTasks();
  if (name === "settings") renderSettings();
}

function leaveDemoMode() {
  if (!state.demo && !state.entries.some((entry) => entry.source === "demo") && !state.tasks.some((task) => task.source === "demo")) return;
  state.demo = false;
  state.entries = state.entries.filter((entry) => entry.source !== "demo");
  state.tasks = state.tasks.filter((task) => task.source !== "demo");
}

function renderMessage(message) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${message.role}`;
  wrapper.dataset.messageId = message.id;
  const avatar = message.role === "assistant" ? '<span class="mini-avatar"><img src="./assets/deepseek-icon.png" alt=""></span>' : "";
  let body = "";
  if (message.type === "ack") {
    body = `<div class="bubble"><div class="record-ack"><span class="check">✓</span><span>${escapeHtml(message.text)}</span></div><span class="message-time">${timeLabel(message.createdAt)}</span></div>`;
  } else if (message.type === "meal") {
    body = mealCardHtml(message);
  } else if (message.type === "summary") {
    body = summaryCardHtml(message);
  } else if (message.type === "profile_change") {
    body = profileChangeCardHtml(message);
  } else if (message.type === "operation") {
    body = operationReceiptHtml(message);
  } else {
    body = `<div class="bubble">${formatMessageText(message.text, message.role === "assistant")}<span class="message-time">${timeLabel(message.createdAt)}</span></div>`;
  }
  wrapper.innerHTML = `${avatar}${body}`;
  return wrapper;
}

function mealCardHtml(message) {
  const meal = message.meal;
  const confirmed = Boolean(message.confirmed);
  const superseded = Boolean(message.superseded);
  const deletedRecord = Boolean(message.deletedRecord);
  if (meal.isFood === false) {
    return `<article class="rich-card">
      <div class="rich-card-header">
        <div><span>图片检查</span><h4>${escapeHtml(meal.name || "未识别到餐食")}</h4></div>
        <span class="estimate-pill">未计入</span>
      </div>
      <p class="card-note">${escapeHtml(meal.note || "这张图片中没有识别到可估算的餐食，请换一张更清楚的食物照片。")}</p>
      <button class="confirm-button" disabled>未计入饮食记录</button>
    </article>`;
  }
  const estimate = (value, min, max) => {
    if (Number.isFinite(Number(value))) return Math.round(Number(value));
    const numbers = [min, max].map(Number).filter(Number.isFinite);
    if (numbers.length) return Math.round(numbers.reduce((sum, item) => sum + item, 0) / numbers.length);
    const embedded = String(value ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [0];
    return Math.round(embedded.reduce((sum, item) => sum + item, 0) / embedded.length);
  };
  const calories = estimate(meal.calories, meal.caloriesMin, meal.caloriesMax);
  const protein = estimate(meal.protein);
  const carbs = estimate(meal.carbs);
  const fat = estimate(meal.fat);
  const foods = Array.isArray(meal.foods) ? meal.foods : [meal.name || "本次饮食"];
  const statusLabel = deletedRecord ? "已删除" : superseded ? "已更新" : message.revisionOf ? "修正估算" : "粗略估算";
  const buttonLabel = deletedRecord ? "这条记录已删除" : superseded ? "已根据后续补充更新" : confirmed ? "✓ 已计入饮食记录" : "确认并计入记录";
  return `<article class="rich-card${superseded || deletedRecord ? " superseded-card" : ""}">
    <div class="rich-card-header">
      <div><span>${message.revisionOf ? "餐食修正" : "餐食识别"}${message.simulated ? " · 原型演示" : ""}</span><h4>${escapeHtml(meal.name)}</h4></div>
      <span class="estimate-pill">${statusLabel}</span>
    </div>
    <div class="calorie-line"><strong>${calories}</strong><span>千卡 · 估算值</span></div>
    <div class="macro-grid">
      <div class="macro-item"><span>蛋白质</span><strong>${protein}g</strong></div>
      <div class="macro-item"><span>碳水</span><strong>${carbs}g</strong></div>
      <div class="macro-item"><span>脂肪</span><strong>${fat}g</strong></div>
    </div>
    <ul class="food-list">${foods.map((food) => `<li>${escapeHtml(food)}</li>`).join("")}</ul>
    <p class="card-note">${escapeHtml(meal.note)}</p>
    <button class="confirm-button" data-confirm-meal="${message.id}" ${confirmed || superseded || deletedRecord ? "disabled" : ""}>${buttonLabel}</button>
    ${!confirmed && !superseded && !deletedRecord ? '<p class="revision-hint">份量或食物不对？直接在聊天里补充，我会重新估算。</p>' : ""}
  </article>`;
}

function summaryCardHtml(message) {
  const s = message.summary;
  const suggestions = Array.isArray(s.suggestions) ? s.suggestions.slice(0, 5) : [];
  return `<article class="rich-card">
    <div class="rich-card-header"><div><span>今日复盘</span><h4>${escapeHtml(s.title)}</h4></div><span>${escapeHtml(s.date)}</span></div>
    <div class="summary-list">
      <div class="summary-row"><span>睡眠</span><strong>${escapeHtml(s.sleep)}</strong></div>
      <div class="summary-row"><span>运动</span><strong>${escapeHtml(s.exercise)}</strong></div>
      <div class="summary-row"><span>饮水</span><strong>${escapeHtml(s.water)}</strong></div>
      <div class="summary-row"><span>消费</span><strong>${escapeHtml(s.expense)}</strong></div>
    </div>
    ${suggestions.length ? `<ol class="suggestion-list">${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : '<p class="summary-advice">今天的记录还不足以形成建议，继续自然记录就好。</p>'}
  </article>`;
}

function profileChangeCardHtml(message) {
  const descriptions = Array.isArray(message.descriptions) ? message.descriptions : window.FeiyuProfile.describePatch(message.profilePatch);
  const status = message.cancelled ? "已取消" : message.confirmed ? "已生效" : "等待确认";
  return `<article class="rich-card${message.cancelled ? " superseded-card" : ""}">
    <div class="rich-card-header"><div><span>个性化设置</span><h4>调整助手关注方式</h4></div><span class="estimate-pill">${status}</span></div>
    <ul class="profile-change-list">${descriptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    ${message.confirmed || message.cancelled ? "" : `<div class="card-actions"><button class="secondary-button" data-cancel-profile="${message.id}">取消</button><button class="confirm-button" data-confirm-profile="${message.id}">确认修改</button></div>`}
  </article>`;
}

function operationReceiptHtml(message) {
  const items = Array.isArray(message.items) ? message.items.slice(0, 8) : [];
  const undone = Boolean(message.undone);
  return `<article class="rich-card operation-card${undone ? " superseded-card" : ""}">
    <div class="rich-card-header">
      <div><span>本地数据操作</span><h4>${escapeHtml(message.title || "记录已更新")}</h4></div>
      <span class="operation-status">${undone ? "已撤销" : "已完成"}</span>
    </div>
    <ul class="operation-list">${items.map((item) => `<li><span class="check">✓</span><span>${escapeHtml(item)}</span></li>`).join("")}</ul>
    <div class="operation-actions">
      ${message.operation?.date ? `<button type="button" class="secondary-button" data-view-operation-day="${escapeHtml(message.operation.date)}">查看当天</button>` : ""}
      ${message.operation && !undone ? `<button type="button" class="secondary-button operation-undo" data-undo-operation="${escapeHtml(message.id)}">撤销本次操作</button>` : ""}
    </div>
    <span class="message-time">${timeLabel(message.createdAt)}</span>
  </article>`;
}

function renderMessages(scroll = false) {
  const list = $("#messageList");
  list.innerHTML = "";
  state.messages.slice(-30).forEach((message) => list.appendChild(renderMessage(message)));
  $("#demoBanner").classList.toggle("hidden", !state.demo);
  if (scroll) requestAnimationFrame(() => { $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight; });
}

function addMessage(message) {
  const saved = { id: uid(), createdAt: nowIso(), ...message };
  state.messages.push(saved);
  return saved;
}

function addOperationReceipt(title, items, operation) {
  return addMessage({ role: "assistant", type: "operation", title, items, operation });
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function addEntry(type, data, sourceText = "", referenceValue = new Date(), timeContext = sourceText) {
  const createdAt = new Date(referenceValue);
  const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
  let timing = window.FeiyuRecords.resolveEventTime(timeContext, safeCreatedAt);
  if (type === "sleep" && data?.wakeTime && /^\d{2}:\d{2}$/.test(data.wakeTime)) {
    const [hour, minute] = data.wakeTime.split(":").map(Number);
    const wakeTime = new Date(safeCreatedAt);
    wakeTime.setHours(hour, minute, 0, 0);
    timing = { occurredAt: wakeTime.toISOString(), date: localDateFromIso(wakeTime), timeSource: "explicit", timeText: data.wakeTime };
  }
  const entry = {
    id: uid(),
    type,
    date: timing.date,
    createdAt: safeCreatedAt.toISOString(),
    occurredAt: timing.occurredAt,
    timeSource: timing.timeSource,
    timeText: timing.timeText,
    data,
    sourceText
  };
  state.entries.push(entry);
  return entry;
}

function parseAndRecord(text) {
  const parsed = window.FeiyuRecords.extract(text);
  const result = { labels: [], entryIds: [], taskIds: [], date: "" };
  const recordedAt = new Date();
  parsed.entries.forEach((entry) => {
    const saved = addEntry(entry.type, entry.data, text, recordedAt, entry.timeContext || text);
    result.entryIds.push(saved.id);
    result.date ||= saved.date;
    result.labels.push(entry.label);
  });
  parsed.tasks.forEach((task) => {
    const saved = { id: uid(), text: task.text, dueDate: task.dueOffset === null ? "" : dateKey(task.dueOffset), done: false, createdAt: nowIso() };
    state.tasks.unshift(saved);
    result.taskIds.push(saved.id);
    result.labels.push(task.label);
  });

  if (!result.labels.length) {
    const saved = addEntry("note", { text }, text);
    result.entryIds.push(saved.id);
    result.date = saved.date;
    result.labels.push("一条生活记录");
  }
  return result;
}

function repairEmbeddedMealExpenses() {
  const mealEntries = state.entries.filter((entry) => ["meal", "meal_note"].includes(entry.type) && entry.sourceText);
  let repaired = 0;
  mealEntries.forEach((mealEntry) => {
    const parsedExpenses = window.FeiyuRecords.extract(mealEntry.sourceText).entries.filter((entry) => entry.type === "expense");
    parsedExpenses.forEach((parsed) => {
      const alreadyExists = state.entries.some((entry) =>
        entry.type === "expense"
        && entry.date === mealEntry.date
        && entry.sourceText === mealEntry.sourceText
        && Math.abs(Number(entry.data?.amount || 0) - Number(parsed.data.amount || 0)) < .001
      );
      if (alreadyExists) return;
      addEntry("expense", parsed.data, mealEntry.sourceText, mealEntry.createdAt, parsed.timeContext || mealEntry.sourceText);
      repaired += 1;
    });
  });
  return repaired;
}

function createMealEstimate(text = "午饭照片") {
  const isJuice = /西瓜汁|果汁/.test(text);
  return isJuice ? {
    name: "西瓜汁", caloriesMin: 110, caloriesMax: 180, protein: "1–2", carbs: "27–43", fat: "0–1",
    foods: ["西瓜汁约 350–450ml"], note: "含糖量取决于是否额外加糖。确认杯量后会更准确。"
  } : {
    name: "米饭配鸡肉与时蔬", caloriesMin: 520, caloriesMax: 680, protein: "30–42", carbs: "62–82", fat: "16–25",
    foods: ["米饭约 180–220g", "鸡肉约 120g", "炒时蔬一份"], note: "图片无法准确判断烹调用油和米饭重量，因此先给区间。你可以确认后再计入。"
  };
}

function isMealEstimateRequest(text) {
  return /算.*(?:摄入|热量)|(?:摄入|热量).*算|西瓜汁|果汁/.test(text);
}

function isFoodRecordRequest(text) {
  return window.FeiyuRecords.isFoodRecordRequest(text);
}

function recentMealContext() {
  const pending = [...state.entries].reverse().find((entry) => {
    if (entry.type !== "meal_note" || entry.data?.analyzed) return false;
    const age = Date.now() - new Date(entry.createdAt).getTime();
    return entry.date === dateKey(0) || age < 24 * 60 * 60 * 1000;
  });
  if (pending) return { description: pending.data.description || pending.sourceText, sourceEntryId: pending.id };

  const previousFoodMessage = state.messages.slice(0, -1).reverse().find((message) =>
    message.role === "user" && message.type === "text" && isFoodRecordRequest(message.text) && !isMealEstimateRequest(message.text)
  );
  return previousFoodMessage ? { description: previousFoodMessage.text, sourceEntryId: null } : null;
}

function latestPendingMealMessage() {
  return [...state.messages].reverse().find((message) =>
    message.role === "assistant" && message.type === "meal" && !message.confirmed && !message.superseded && message.meal?.isFood !== false
      && Date.now() - new Date(message.createdAt).getTime() < 24 * 60 * 60 * 1000
  ) || null;
}

function latestPendingProfileMessage() {
  return [...state.messages].reverse().find((message) =>
    message.role === "assistant" && message.type === "profile_change" && !message.confirmed && !message.cancelled
  ) || null;
}

function currentProfile() {
  return window.FeiyuProfile.normalize(state.settings?.profile);
}

function pendingMealClarificationContext() {
  const entry = [...state.entries].reverse().find((item) => {
    if (item.type !== "meal_note" || !item.data?.awaitingClarification || item.data?.analyzed) return false;
    const age = Date.now() - new Date(item.createdAt).getTime();
    return item.date === dateKey(0) || age < 24 * 60 * 60 * 1000;
  });
  return entry ? { entry, description: entry.data.description || entry.sourceText || "" } : null;
}

function isMealCorrectionRequest(text) {
  return window.FeiyuRecords.isMealCorrectionRequest(text);
}

function isMealConfirmationRequest(text) {
  return window.FeiyuRecords.isMealConfirmationRequest(text);
}

function isMealClarificationCancellation(text) {
  return window.FeiyuRecords.isMealClarificationCancellation(text);
}

function isMealClarificationResponse(text) {
  return window.FeiyuRecords.isMealClarificationResponse(text);
}

function isStructuredRecordRequest(text) {
  return window.FeiyuRecords.isStructuredRecordRequest(text);
}

function needsAIEventInterpretation(text) {
  return window.FeiyuRecords.needsAIEventInterpretation(text);
}

function isProfileQuery(text) {
  return window.FeiyuRecords.isProfileQuery(text);
}

function isBareRecordPrompt(text) {
  return window.FeiyuRecords.isBareRecordPrompt(text);
}

function isExplicitNoteRequest(text) {
  return window.FeiyuRecords.isExplicitNoteRequest(text);
}

function parseDeleteRequest(text) {
  return window.FeiyuRecords.parseDeleteRequest(text);
}

function recordTypeLabel(type) {
  return ({ meal: "饮食", meal_note: "饮食", expense: "消费", water: "饮水", exercise: "运动", sleep: "睡眠", life_event: "生活事件", note: "生活" })[type] || "生活";
}

function markEntryMessagesDeleted(removedIds) {
  state.messages.forEach((message) => {
    if (message.type === "meal" && message.sourceEntryId && removedIds.has(message.sourceEntryId)) {
      message.deletedRecord = true;
      message.superseded = true;
    }
  });
}

function deleteRecords(request) {
  if (request.scope === "ambiguous") return { ambiguous: true, removed: [] };
  const result = window.FeiyuRecordOps.deleteEntries(state.entries, request, new Date());
  state.entries = result.entries;
  const removedIds = new Set(result.removed.map((entry) => entry.id));
  markEntryMessagesDeleted(removedIds);
  return { ...result, ambiguous: false };
}

async function undoOperation(messageId) {
  const message = state.messages.find((item) => item.id === messageId && item.type === "operation");
  if (!message?.operation || message.undone) return;
  const operation = message.operation;
  const createdEntryIds = new Set(operation.createdEntryIds || []);
  const deletedEntries = Array.isArray(operation.deletedEntries) ? operation.deletedEntries : [];
  const restored = window.FeiyuRecordOps.undoOperation(state.entries, state.tasks, operation);
  state.entries = restored.entries;
  state.tasks = restored.tasks;

  state.messages.forEach((item) => {
    if (!item.sourceEntryId) return;
    if (createdEntryIds.has(item.sourceEntryId)) item.confirmed = false;
    if (deletedEntries.some((entry) => entry.id === item.sourceEntryId)) {
      item.deletedRecord = false;
      if (item.superseded && !item.revisionOf) item.superseded = false;
    }
  });
  if (operation.unconfirmMessageId) {
    const mealMessage = state.messages.find((item) => item.id === operation.unconfirmMessageId && item.type === "meal");
    if (mealMessage) mealMessage.confirmed = false;
  }
  message.undone = true;
  message.undoneAt = nowIso();
  await saveState();
  renderAll();
  showToast("本次操作已撤销");
}

function expectsConversation(text) {
  return window.FeiyuRecords.expectsConversation(text);
}

function isSimpleGreeting(text) {
  return window.FeiyuRecords.isSimpleGreeting(text);
}

function needsLifeContext(text) {
  return window.FeiyuRecords.needsLifeContext(text);
}

function needsTaskContext(text) {
  return window.FeiyuRecords.needsTaskContext(text);
}

function isPeriodSummaryRequest(text) {
  return /(?:总结(?:一下)?(?:本周|这周|本月|这个月)|(?:周|月)总结)/.test(String(text || "").trim());
}

function lifeContextDays(text) {
  return /(?:本月|这个月|月总结)/.test(String(text || "")) ? 31 : 7;
}

function recentTasksForAI(days = 31) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(days) || 31));
  return state.tasks.filter((task) => {
    if (!task?.text || task.source === "demo") return false;
    if (!task.done) return true;
    return new Date(task.createdAt || 0) >= cutoff;
  }).slice(-50);
}

function recentConversationHistory() {
  return state.messages.slice(0, -1).map((message) => {
    if (message.type === "text" || message.type === "ack") return { role: message.role, content: message.text };
    if (message.type === "meal" && message.meal) {
      const meal = message.meal;
      const status = message.superseded ? "已被后续修正" : message.confirmed ? "已确认" : "待确认";
      return { role: "assistant", content: `餐食估算卡（${status}）：${meal.name}，约${meal.calories}千卡，蛋白质${meal.protein}克，碳水${meal.carbs}克，脂肪${meal.fat}克；食物：${(meal.foods || []).join("、")}` };
    }
    return null;
  }).filter(Boolean).slice(-8);
}

function recentLifeEntries(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(days) || 7));
  const limit = days > 7 ? 220 : 80;
  return state.entries.filter((entry) => new Date(`${entry.date}T00:00:00`) >= cutoff).slice(-limit);
}

const EXPENSE_CATEGORIES = new Set(["餐饮", "交通", "购物", "居住", "医疗健康", "娱乐", "学习办公", "人情往来", "其他"]);

function validPositiveNumber(value, maximum = 10000000) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? number : null;
}

function applyInterpretedActions(actions, sourceText, referenceValue = new Date()) {
  const result = { labels: [], createdEntryIds: [], previousEntries: [], date: "" };
  for (const action of Array.isArray(actions) ? actions : []) {
    const data = action?.data || {};
    if (action?.op === "create_life_event") {
      const title = String(data.title || "生活事件").trim().slice(0, 60);
      const details = String(data.details || sourceText).trim().slice(0, 300);
      const category = String(data.category || "其他").trim().slice(0, 30);
      const durationMinutes = data.duration_minutes === undefined ? null : validPositiveNumber(data.duration_minutes, 1440);
      const tags = (Array.isArray(data.tags) ? data.tags : []).map((item) => String(item).trim().slice(0, 30)).filter(Boolean).slice(0, 8);
      const saved = addEntry("life_event", { title, details, category, durationMinutes, tags }, sourceText, referenceValue, sourceText);
      result.createdEntryIds.push(saved.id);
      result.date ||= saved.date;
      result.labels.push(`${category}：${title}`);
      continue;
    }
    if (action?.op === "create_expense") {
      const amount = validPositiveNumber(data.amount);
      if (amount === null) continue;
      const direction = data.direction === "in" ? "in" : "out";
      const category = EXPENSE_CATEGORIES.has(data.category) ? data.category : "其他";
      const expenseData = {
        amount,
        direction,
        category,
        subtype: ["ordinary", "voucher_purchase", "refund"].includes(data.subtype) ? data.subtype : direction === "in" ? "refund" : "ordinary",
        note: String(data.note || sourceText).slice(0, 100)
      };
      if (data.merchant) expenseData.merchant = String(data.merchant).slice(0, 40);
      if (["unused", "used", "refunded", "partially_refunded"].includes(data.voucher_status)) expenseData.voucherStatus = data.voucher_status;
      if (data.linked_entry_id && state.entries.some((entry) => entry.id === data.linked_entry_id)) expenseData.linkedEntryId = data.linked_entry_id;
      const saved = addEntry("expense", expenseData, sourceText, referenceValue, sourceText);
      result.createdEntryIds.push(saved.id);
      result.date ||= saved.date;
      if (direction === "in") result.labels.push(`退款 +¥${amount.toFixed(2).replace(/\.00$/, "")}`);
      else if (expenseData.subtype === "voucher_purchase") result.labels.push(`${category}团购券 ¥${amount.toFixed(2).replace(/\.00$/, "")}（未进食）`);
      else result.labels.push(`${category}消费 ¥${amount.toFixed(2).replace(/\.00$/, "")}`);
      continue;
    }

    if (action?.op !== "update_entry") continue;
    const entry = state.entries.find((item) => item.id === action.target_id && item.source !== "demo");
    if (!entry) continue;
    result.previousEntries.push(cloneValue(entry));
    result.date ||= entry.date;
    const next = { ...entry.data };
    if (entry.type === "expense") {
      const amount = data.amount === undefined ? null : validPositiveNumber(data.amount);
      if (amount !== null) next.amount = amount;
      if (["in", "out"].includes(data.direction)) next.direction = data.direction;
      if (EXPENSE_CATEGORIES.has(data.category)) next.category = data.category;
      if (["ordinary", "voucher_purchase", "refund"].includes(data.subtype)) next.subtype = data.subtype;
      if (data.note !== undefined) next.note = String(data.note).slice(0, 100);
      if (data.merchant !== undefined) next.merchant = String(data.merchant).slice(0, 40);
      if (["unused", "used", "refunded", "partially_refunded"].includes(data.voucher_status)) next.voucherStatus = data.voucher_status;
      if (data.linked_entry_id && state.entries.some((item) => item.id === data.linked_entry_id)) next.linkedEntryId = data.linked_entry_id;
    } else if (entry.type === "water") {
      const ml = data.ml === undefined ? null : validPositiveNumber(data.ml, 20000);
      if (ml !== null) next.ml = ml;
    } else if (entry.type === "sleep") {
      const hours = data.hours === undefined ? null : validPositiveNumber(data.hours, 24);
      if (hours !== null) next.hours = hours;
      if (data.bedTime !== undefined) next.bedTime = String(data.bedTime).slice(0, 10);
      if (data.wakeTime !== undefined) next.wakeTime = String(data.wakeTime).slice(0, 10);
      if (data.quality !== undefined) next.quality = String(data.quality).slice(0, 30);
    } else if (entry.type === "exercise") {
      if (data.activity !== undefined) next.activity = String(data.activity).slice(0, 30);
      for (const [key, maximum] of [["minutes", 1440], ["km", 1000], ["steps", 200000]]) {
        const value = data[key] === undefined ? null : validPositiveNumber(data[key], maximum);
        if (value !== null) next[key] = value;
      }
    } else if (entry.type === "meal") {
      if (data.name !== undefined) next.name = String(data.name).slice(0, 60);
      for (const [key, maximum] of [["calories", 10000], ["protein", 1000], ["carbs", 2000], ["fat", 1000]]) {
        const value = data[key] === undefined ? null : validPositiveNumber(data[key], maximum);
        if (value !== null) next[key] = Math.round(value);
      }
    } else if (entry.type === "life_event") {
      if (data.title !== undefined) next.title = String(data.title).slice(0, 60);
      if (data.details !== undefined) next.details = String(data.details).slice(0, 300);
      if (data.category !== undefined) next.category = String(data.category).slice(0, 30);
      const duration = data.duration_minutes === undefined ? null : validPositiveNumber(data.duration_minutes, 1440);
      if (duration !== null) next.durationMinutes = duration;
      if (Array.isArray(data.tags)) next.tags = data.tags.map((item) => String(item).slice(0, 30)).filter(Boolean).slice(0, 8);
    } else {
      continue;
    }
    entry.data = next;
    entry.lastCorrectedAt = nowIso();
    entry.correctionSource = sourceText;
    result.labels.push(`修正${recordTypeLabel(entry.type)}记录`);
  }
  return result;
}

function profilePatchFromActions(actions) {
  const action = (Array.isArray(actions) ? actions : []).find((item) => item?.op === "propose_profile_update" && item.data?.profile_patch);
  return action ? action.data.profile_patch : null;
}

async function confirmProfileChange(messageId) {
  const message = state.messages.find((item) => item.id === messageId && item.type === "profile_change");
  if (!message || message.confirmed || message.cancelled) return;
  state.settings.profile = window.FeiyuProfile.applyPatch(currentProfile(), message.profilePatch);
  message.confirmed = true;
  await saveState();
  renderMessages();
  renderSettings();
  showToast("个性化设置已更新");
}

async function cancelProfileChange(messageId) {
  const message = state.messages.find((item) => item.id === messageId && item.type === "profile_change");
  if (!message || message.confirmed || message.cancelled) return;
  message.cancelled = true;
  await saveState();
  renderMessages();
  showToast("已取消设置修改");
}

function todaySummary() {
  const todays = state.entries.filter((entry) => entry.date === dateKey(0));
  const metrics = window.FeiyuRecordOps.dayMetrics(todays);
  return {
    title: todays.length ? "今天有好好留下痕迹" : "今天还很安静",
    date: new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    sleep: metrics.sleepHours ? `${metrics.sleepHours} 小时` : metrics.sleepCount ? "已记录睡眠感受" : "尚未记录",
    exercise: metrics.exerciseMinutes ? `${metrics.exerciseMinutes} 分钟` : metrics.exerciseCount ? `${metrics.exerciseCount} 次活动` : "尚未记录",
    water: metrics.waterMl ? `${metrics.waterMl}ml` : "尚未记录",
    expense: metrics.expenseCount || metrics.refundCount ? formatMoney(metrics.expenseTotal) : "无记录",
    suggestions: metrics.waterMl && metrics.waterMl < 1200 ? ["今天饮水记录偏少，睡前少量补水即可，不必一次喝很多。"] : []
  };
}

function setRequestState(busy, label = "") {
  requestInFlight = busy;
  $("#sendButton").disabled = busy;
  $("#composerNote").textContent = busy ? label : pendingPhoto ? `已选择：${pendingPhoto.name}` : IDLE_COMPOSER_NOTE;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("无法解析图片"));
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleSend() {
  if (requestInFlight) return;
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text && !pendingPhoto) return;
  const photo = pendingPhoto;
  pendingPhoto = null;
  leaveDemoMode();
  const userText = photo ? `${text ? `${text}\n` : ""}📷 ${photo.name}` : text;
  const userMessage = addMessage({ role: "user", type: "text", text: userText });
  input.value = "";
  input.style.height = "auto";
  await saveState();
  renderMessages(true);

  let mutationApplied = false;
  try {
    const deleteRequest = !photo ? parseDeleteRequest(text) : null;
    if (deleteRequest) {
      const deletion = deleteRecords(deleteRequest);
      if (deletion.ambiguous) {
        addMessage({ role: "assistant", type: "text", text: "请说清要删除哪条，例如“删除刚才那条饮食记录”“删除今天那笔 23 元消费”，或者“删除今天所有记录”。" });
      } else if (!deletion.removed.length) {
        addMessage({ role: "assistant", type: "text", text: "没有找到符合条件的记录，所以没有删除任何内容。" });
      } else {
        const title = deleteRequest.scope === "day_all"
          ? `已删除${deletion.targetDate === dateKey(0) ? "今天" : "当天"}的 ${deletion.removed.length} 条记录`
          : deleteRequest.scope === "day_type_all"
            ? `已删除当天全部${recordTypeLabel(deleteRequest.type)}记录`
            : `已删除这条${recordTypeLabel(deletion.removed[0].type)}记录`;
        const items = deletion.removed.map((entry) => {
          const [, label, value] = dayEntryPresentation(entry);
          return `${label}：${value}`;
        });
        addOperationReceipt(title, items, {
          deletedEntries: cloneValue(deletion.removed),
          date: deletion.targetDate || deletion.removed[0]?.date || dateKey(0)
        });
        mutationApplied = true;
      }
    } else if (photo) {
      setRequestState(true, "正在识别这顿饭…");
      const imageDataUrl = await compressImage(photo);
      const meal = await window.FeiyuAI.analyzeMeal({ apiKey: state.settings.apiKey, text, imageDataUrl, profile: currentProfile() });
      addMessage({ role: "assistant", type: "meal", meal, simulated: false, confirmed: false, recordedText: text, mealRecordedAt: userMessage.createdAt });
    } else if (/总结(?:一下)?今天|今日总结/.test(text)) {
      setRequestState(true, "正在整理今天的记录…");
      const base = todaySummary();
      const todaysEntries = state.entries.filter((entry) => entry.date === dateKey(0));
      const todaysTasks = state.tasks.filter((task) => (task.dueDate || localDateFromIso(task.createdAt)) === dateKey(0));
      const aiSummary = await window.FeiyuAI.summarizeDay({ apiKey: state.settings.apiKey, entries: todaysEntries, tasks: todaysTasks, profile: currentProfile() });
      addMessage({ role: "assistant", type: "summary", summary: { ...base, ...aiSummary } });
    } else if (isBareRecordPrompt(text)) {
      addMessage({ role: "assistant", type: "text", text: "好，你想记录什么？可以直接说完整内容，比如“坐公交花了 1 元，喝水 250 毫升”。" });
    } else if (latestPendingProfileMessage() && isMealConfirmationRequest(text)) {
      const pendingProfile = latestPendingProfileMessage();
      await confirmProfileChange(pendingProfile.id);
      mutationApplied = true;
      addMessage({ role: "assistant", type: "ack", text: "个性化设置已确认并生效。" });
    } else if (latestPendingProfileMessage() && isMealClarificationCancellation(text)) {
      const pendingProfile = latestPendingProfileMessage();
      await cancelProfileChange(pendingProfile.id);
      mutationApplied = true;
      addMessage({ role: "assistant", type: "ack", text: "已取消这次个性化设置修改。" });
    } else if (latestPendingMealMessage() && isMealConfirmationRequest(text)) {
      const pendingMessage = latestPendingMealMessage();
      await confirmMeal(pendingMessage.id);
      mutationApplied = true;
    } else if (pendingMealClarificationContext() && (isMealClarificationCancellation(text) || isMealClarificationResponse(text))) {
      const context = pendingMealClarificationContext();
      if (isMealClarificationCancellation(text)) {
        state.entries = state.entries.filter((entry) => entry.id !== context.entry.id);
        mutationApplied = true;
        addMessage({ role: "assistant", type: "ack", text: "已取消这条待补充的饮食记录。" });
      } else {
        context.entry.data.corrections = [...(context.entry.data.corrections || []), text];
        setRequestState(true, "正在根据补充内容估算…");
        const analysisText = `${context.description}\n用户补充：${text}`;
        const meal = await window.FeiyuAI.analyzeMeal({ apiKey: state.settings.apiKey, text: analysisText, imageDataUrl: "", profile: currentProfile() });
        if (meal.needsClarification) {
          context.entry.data.awaitingClarification = true;
          addMessage({ role: "assistant", type: "text", text: meal.question || "还需要确认一个关键内容。", sourceEntryId: context.entry.id });
        } else {
          context.entry.data.awaitingClarification = false;
          context.entry.data.analyzed = true;
          addMessage({
            role: "assistant",
            type: "meal",
            meal,
            simulated: false,
            confirmed: false,
            sourceEntryId: context.entry.id,
            recordedText: context.description,
            mealRecordedAt: context.entry.createdAt
          });
        }
      }
    } else if (isMealConfirmationRequest(text)) {
      const clarification = pendingMealClarificationContext();
      addMessage({
        role: "assistant",
        type: "text",
        text: clarification
          ? "这条饮食还缺少食物明细，暂时不能确认。补充主要吃了什么后，我会生成可确认的营养卡片。"
          : "当前没有等待确认的餐食卡；已经确认过的记录不会重复写入。"
      });
    } else if (latestPendingMealMessage() && isMealCorrectionRequest(text)) {
      const previous = latestPendingMealMessage();
      const sourceEntry = previous.sourceEntryId ? state.entries.find((entry) => entry.id === previous.sourceEntryId) : null;
      const originalText = previous.recordedText || sourceEntry?.data?.description || sourceEntry?.sourceText || "";
      setRequestState(true, "正在按补充信息修正…");
      const meal = await window.FeiyuAI.reviseMeal({ apiKey: state.settings.apiKey, originalText, originalMeal: previous.meal, correction: text, profile: currentProfile() });
      if (meal.needsClarification) {
        addMessage({ role: "assistant", type: "text", text: meal.question || "还需要确认一个关键份量。" });
      } else {
        previous.superseded = true;
        if (sourceEntry?.type === "meal_note") {
          sourceEntry.data.corrections = [...(sourceEntry.data.corrections || []), text];
          sourceEntry.data.analyzed = true;
        }
        addMessage({
          role: "assistant",
          type: "meal",
          meal,
          simulated: false,
          confirmed: false,
          revisionOf: previous.id,
          sourceEntryId: previous.sourceEntryId || null,
          recordedText: originalText,
          mealRecordedAt: previous.mealRecordedAt || previous.createdAt
        });
      }
    } else if (isProfileQuery(text)) {
      setRequestState(true, "正在查看你的个性化设置…");
      const reply = await window.FeiyuAI.chat({ apiKey: state.settings.apiKey, text, history: [], entries: [], tasks: [], profile: currentProfile() });
      addMessage({ role: "assistant", type: "text", text: sanitizeUnverifiedChatReply(reply) });
    } else if (needsAIEventInterpretation(text)) {
      setRequestState(true, "正在理解这条生活记录…");
      const plan = await window.FeiyuAI.interpretLifeEvent({
        apiKey: state.settings.apiKey,
        text,
        entries: recentLifeEntries(31),
        history: recentConversationHistory(),
        profile: currentProfile()
      });
      const recorded = applyInterpretedActions(plan.actions, text, userMessage.createdAt);
      const profilePatch = profilePatchFromActions(plan.actions);
      if (recorded.labels.length) addOperationReceipt("生活记录已更新", recorded.labels, {
        createdEntryIds: recorded.createdEntryIds,
        previousEntries: recorded.previousEntries,
        date: recorded.date
      });
      if (recorded.labels.length) mutationApplied = true;
      if (profilePatch) addMessage({ role: "assistant", type: "profile_change", profilePatch, descriptions: window.FeiyuProfile.describePatch(profilePatch), confirmed: false, cancelled: false });

      if (plan.mealText) {
        const pendingMeal = addEntry("meal_note", { description: plan.mealText, analyzed: false }, text, userMessage.createdAt, text);
        const meal = await window.FeiyuAI.analyzeMeal({ apiKey: state.settings.apiKey, text: plan.mealText, imageDataUrl: "", profile: currentProfile() });
        if (meal.needsClarification) {
          pendingMeal.data.awaitingClarification = true;
          addMessage({ role: "assistant", type: "text", text: meal.question || "这次实际吃了什么？", sourceEntryId: pendingMeal.id });
        } else {
          pendingMeal.data.analyzed = true;
          addMessage({ role: "assistant", type: "meal", meal, simulated: false, confirmed: false, sourceEntryId: pendingMeal.id, recordedText: plan.mealText, mealRecordedAt: userMessage.createdAt });
        }
      }

      if (plan.needsClarification) {
        addMessage({ role: "assistant", type: "text", text: plan.question || "我还需要确认一个关键信息后才能准确记录。" });
      } else if (!recorded.labels.length && !plan.mealText && !profilePatch) {
        addMessage({ role: "assistant", type: "text", text: "我没有找到可以安全执行的修改。请说清要改哪条记录以及正确结果，例如“刚才那笔消费改成 19.9 元”。" });
      }
    } else if (isMealEstimateRequest(text)) {
      setRequestState(true, "正在估算饮食摄入…");
      const currentHasFood = isFoodRecordRequest(text) && !/^(?:帮我)?算(?:一下)?(?:这(?:个|顿|次))?(?:的)?(?:摄入|热量)[吧。！!？?]*$/.test(text.trim());
      const context = currentHasFood ? null : recentMealContext();
      const analysisText = context ? `${context.description}\n用户追问：${text}` : text;
      const meal = await window.FeiyuAI.analyzeMeal({ apiKey: state.settings.apiKey, text: analysisText, imageDataUrl: "", profile: currentProfile() });
      addMessage({ role: "assistant", type: "meal", meal, simulated: false, confirmed: false, sourceEntryId: context?.sourceEntryId || null, recordedText: currentHasFood ? text : context?.description || text });
    } else if (isFoodRecordRequest(text)) {
      const otherRecords = isStructuredRecordRequest(text) ? parseAndRecord(text) : { labels: [], entryIds: [], taskIds: [], date: "" };
      const pendingMeal = addEntry("meal_note", { description: text, analyzed: false }, text, new Date(), window.FeiyuRecords.foodTimeContext(text));
      mutationApplied = true;
      await saveState();
      setRequestState(true, "正在估算饮食摄入…");
      const meal = await window.FeiyuAI.analyzeMeal({ apiKey: state.settings.apiKey, text, imageDataUrl: "", profile: currentProfile() });
      if (otherRecords.labels.length) addOperationReceipt("同时保存了其他记录", otherRecords.labels, {
        createdEntryIds: otherRecords.entryIds,
        createdTaskIds: otherRecords.taskIds,
        date: otherRecords.date
      });
      if (meal.needsClarification) {
        pendingMeal.data.awaitingClarification = true;
        addMessage({ role: "assistant", type: "text", text: meal.question || "这次主要吃了什么？", sourceEntryId: pendingMeal.id });
      } else {
        pendingMeal.data.analyzed = true;
        addMessage({ role: "assistant", type: "meal", meal, simulated: false, confirmed: false, sourceEntryId: pendingMeal.id, recordedText: text });
      }
    } else {
      const shouldRecord = isStructuredRecordRequest(text) || isExplicitNoteRequest(text);
      if (shouldRecord) {
        const records = parseAndRecord(text);
        mutationApplied = true;
        addOperationReceipt("记录已保存", records.labels, {
          createdEntryIds: records.entryIds,
          createdTaskIds: records.taskIds,
          date: records.date
        });
        if (expectsConversation(text)) {
          setRequestState(true, "大肥鱼正在想…");
          const reply = await window.FeiyuAI.chat({ apiKey: state.settings.apiKey, text, history: isPeriodSummaryRequest(text) ? [] : recentConversationHistory(), entries: needsLifeContext(text) ? recentLifeEntries(lifeContextDays(text)) : [], tasks: needsTaskContext(text) || isPeriodSummaryRequest(text) ? recentTasksForAI(lifeContextDays(text)) : [], profile: currentProfile() });
          addMessage({ role: "assistant", type: "text", text: reply });
        }
      } else {
        setRequestState(true, "大肥鱼正在回复…");
        const reply = await window.FeiyuAI.chat({
          apiKey: state.settings.apiKey,
          text,
          history: isSimpleGreeting(text) || isPeriodSummaryRequest(text) ? [] : recentConversationHistory(),
          entries: needsLifeContext(text) ? recentLifeEntries(lifeContextDays(text)) : [],
          tasks: needsTaskContext(text) || isPeriodSummaryRequest(text) ? recentTasksForAI(lifeContextDays(text)) : [],
          profile: currentProfile()
        });
        addMessage({ role: "assistant", type: "text", text: sanitizeUnverifiedChatReply(reply) });
      }
    }
  } catch (error) {
    addMessage({
      role: "assistant",
      type: "text",
      text: mutationApplied
        ? `后续 AI 分析没有完成：${error.message}。上方操作结果卡中显示的本地记录已经保存，可以查看或撤销。`
        : `这次没有分析成功：${error.message}。聊天内容已经保留，但没有写入统计，你可以稍后再试。`
    });
  } finally {
    setRequestState(false);
    await saveState();
    renderMessages(true);
    renderDay();
    renderTrends();
    renderTasks();
  }
}

async function confirmMeal(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message || message.confirmed || message.superseded || message.deletedRecord) return;
  const meal = message.meal;
  const midpointOf = (range) => {
    if (Number.isFinite(Number(range))) return Math.round(Number(range));
    const numbers = String(range).match(/\d+/g)?.map(Number) || [0];
    return numbers.length > 1 ? Math.round((numbers[0] + numbers[1]) / 2) : numbers[0];
  };
  const calories = Number.isFinite(Number(meal.calories))
    ? Math.round(Number(meal.calories))
    : Math.round((Number(meal.caloriesMin || 0) + Number(meal.caloriesMax || meal.caloriesMin || 0)) / 2);
  const mealData = {
    name: meal.name,
    calories,
    protein: midpointOf(meal.protein),
    carbs: midpointOf(meal.carbs),
    fat: midpointOf(meal.fat),
    confirmed: true
  };
  const sourceEntry = message.sourceEntryId ? state.entries.find((entry) => entry.id === message.sourceEntryId) : null;
  const previousEntry = sourceEntry ? cloneValue(sourceEntry) : null;
  let createdEntry = null;
  if (sourceEntry) {
    const baseDescription = sourceEntry.data?.description || sourceEntry.sourceText || "";
    const corrections = Array.isArray(sourceEntry.data?.corrections) ? sourceEntry.data.corrections : [];
    const description = [baseDescription, ...corrections.map((item) => `补充：${item}`)].filter(Boolean).join("；");
    sourceEntry.type = "meal";
    sourceEntry.data = { ...mealData, description };
    sourceEntry.sourceText = sourceEntry.sourceText || description || "餐食识别确认";
  } else {
    const newEntry = addEntry("meal", mealData, message.recordedText || "餐食识别确认", message.mealRecordedAt || message.createdAt);
    message.sourceEntryId = newEntry.id;
    createdEntry = newEntry;
  }
  message.confirmed = true;
  addOperationReceipt("饮食已确认并计入统计", [
    `${mealData.name}：${mealData.calories} 千卡`,
    `蛋白质 ${mealData.protein}g · 碳水 ${mealData.carbs}g · 脂肪 ${mealData.fat}g`
  ], {
    createdEntryIds: createdEntry ? [createdEntry.id] : [],
    previousEntries: previousEntry ? [previousEntry] : [],
    date: createdEntry?.date || sourceEntry?.date || dateKey(0),
    unconfirmMessageId: message.id
  });
  await saveState();
  renderMessages();
  renderDay();
  renderTrends();
  showToast("已计入饮食记录");
}

function relevantEntries(type, days = 7) {
  const cutoff = dateKey(-(days - 1));
  const today = dateKey(0);
  return state.entries.filter((entry) => entry.type === type && entry.date >= cutoff && entry.date <= today && entry.source !== "demo");
}

function renderTrends() {
  const recent = ["sleep", "exercise", "water", "expense", "meal", "life_event"].flatMap((type) => relevantEntries(type));
  const metrics = window.FeiyuRecordOps.trendMetrics(recent);
  const { sleeps, exercises, waters, expenses, meals, avgSleep, exerciseMinutes, exerciseSteps, expenseTotal, expenseCount, refundCount, activeDays, realEntryCount } = metrics;
  const uniqueDays = (items) => new Set(items.map((entry) => entry.date)).size;
  const avgWater = metrics.avgWater;
  const score = realEntryCount ? Math.min(100, 35 + activeDays * 7 + Math.min(16, realEntryCount * 2)) : 0;
  $("#scoreValue").textContent = score;
  $(".score-ring").setAttribute("aria-label", `生活记录完整度 ${score}`);
  $("#overviewText").textContent = realEntryCount
    ? `近 7 天有 ${activeDays} 天留下记录，共 ${realEntryCount} 条。饮食与消费会在确认后立即计入。`
    : "近 7 天还没有实际记录。开始记录后，变化会直接显示在这里。";
  $("#metricGrid").innerHTML = [
    ["平均睡眠", avgSleep ? `${avgSleep.toFixed(1)}h` : "—", `${uniqueDays(sleeps)} 天有记录`],
    ["运动时间", `${exerciseMinutes}min`, `${exercises.length} 次活动${exerciseSteps ? ` · ${exerciseSteps}步` : ""}`],
    ["本周净消费", formatMoney(expenseTotal, 0), `${expenseCount} 笔支出${refundCount ? ` · ${refundCount} 笔退款` : ""}`],
    ["平均饮水", avgWater ? `${avgWater}ml` : "—", `${uniqueDays(waters)} 天有记录`]
  ].map(([label, value, note]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
  $("#sleepAverage").textContent = avgSleep ? `均值 ${avgSleep.toFixed(1)}h` : "暂无数据";

  const sleepByDate = Object.fromEntries(metrics.sleepByDay);
  const values = Array.from({ length: 7 }, (_, i) => {
    const offset = i - 6;
    const day = new Date(`${dateKey(offset)}T12:00:00`);
    const label = day.toLocaleDateString("zh-CN", { weekday: "short" }).replace("周", "");
    return { date: dateKey(offset), label, hours: Number(sleepByDate[dateKey(offset)] || 0), today: offset === 0 };
  });
  $("#sleepChart").innerHTML = values.map((item) => `<div class="bar-column"><div class="bar ${item.today ? "today" : ""}" style="height:${item.hours ? Math.max(16, item.hours / 9 * 100) : 5}%" title="${item.hours || 0} 小时"></div><span>${item.label}</span></div>`).join("");

  const mealsByDay = new Map();
  meals.forEach((entry) => {
    const totals = mealsByDay.get(entry.date) || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    ["calories", "protein", "carbs", "fat"].forEach((key) => { totals[key] += Number(entry.data[key] || 0); });
    mealsByDay.set(entry.date, totals);
  });
  const recordedDays = [...mealsByDay.values()];
  const dailyAverage = (key) => recordedDays.length ? Math.round(recordedDays.reduce((sum, day) => sum + day[key], 0) / recordedDays.length) : 0;
  const macros = [["热量", dailyAverage("calories"), 2200, "kcal"], ["蛋白质", dailyAverage("protein"), 100, "g"], ["碳水", dailyAverage("carbs"), 300, "g"], ["脂肪", dailyAverage("fat"), 80, "g"]];
  $("#mealDaysLabel").textContent = recordedDays.length ? `${recordedDays.length} 个有记录日` : "暂无确认记录";
  $("#macroList").innerHTML = macros.map(([label, value, guide, unit]) => `<div class="macro-progress-row"><span>${label}</span><div class="macro-track"><i style="width:${Math.min(100, value / guide * 100)}%"></i></div><span>${value || 0}${unit}</span></div>`).join("");

  const categoryTotals = {};
  expenses.forEach((entry) => { categoryTotals[entry.data.category] = (categoryTotals[entry.data.category] || 0) + window.FeiyuRecordOps.expenseValue(entry); });
  const sorted = Object.entries(categoryTotals).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const donutTotal = sorted.reduce((sum, [, value]) => sum + Math.abs(value), 0);
  const colors = ["#397868", "#d9935a", "#7892a5", "#d9d6ce", "#9b7ba0"];
  let cursor = 0;
  const gradient = sorted.length ? sorted.map(([, value], index) => {
    const start = cursor;
    cursor += donutTotal ? Math.abs(value) / donutTotal * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(",") : "#d9d6ce 0 100%";
  $("#spendingDonut").style.background = `conic-gradient(${gradient})`;
  $("#spendingTotal").textContent = formatMoney(expenseTotal, 0);
  $("#spendingLegend").innerHTML = sorted.slice(0, 4).map(([category, value], index) => `<div class="legend-row"><i class="legend-dot" style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(category)}</span><strong>${formatMoney(value, 0)}</strong></div>`).join("") || '<span class="subtle">还没有消费记录</span>';
  const topCategory = sorted.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
  $("#trendInsight").textContent = !realEntryCount
    ? "近 7 天还没有实际记录；开始记录后，这里会根据真实数据给出提示。"
    : topCategory
      ? `近 7 天净消费最高的分类是${topCategory[0]}（${formatMoney(topCategory[1], 0)}）。数据积累后，周总结会结合饮食与作息一起分析。`
      : recordedDays.length
        ? `已有 ${recordedDays.length} 个饮食记录日；继续记录几天后，周总结会比较营养摄入的变化。`
        : "记录正在积累中；有了更多天的数据后，这里会显示真实趋势，而不是预设结论。";
}

function dayEntryPresentation(entry) {
  const data = entry.data || {};
  const sleepParts = [];
  if (Number(data.hours || 0)) sleepParts.push(`${Number(data.hours)} 小时`);
  if (data.bedTime && data.wakeTime) sleepParts.push(`${data.bedTime}–${data.wakeTime}`);
  if (data.qualityScore) sleepParts.push(`质量 ${data.qualityScore} 分`);
  else if (data.quality) sleepParts.push(`睡得${data.quality}`);
  const exerciseParts = [];
  if (data.minutes) exerciseParts.push(`${data.minutes} 分钟`);
  if (data.km) exerciseParts.push(`${data.km} 公里`);
  if (data.steps) exerciseParts.push(`${data.steps} 步`);
  if (data.sets) exerciseParts.push(`${data.sets} 组`);
  if (data.reps) exerciseParts.push(`${data.reps} 次`);
  const formats = {
    sleep: ["☾", "睡眠", sleepParts.join(" · ") || "已记录"],
    water: ["◌", "饮水", `${Number(data.ml || 0)}ml`],
    exercise: ["↗", "运动", `${data.activity || "运动"}${exerciseParts.length ? ` · ${exerciseParts.join(" · ")}` : " · 已完成"}`],
    expense: data.direction === "in" || data.subtype === "refund"
      ? ["↩", `${data.category || "消费"}退款`, `+¥${Math.abs(Number(data.amount || 0)).toFixed(2).replace(/\.00$/, "")}${data.note ? ` · ${data.note}` : ""}`]
      : ["¥", data.subtype === "voucher_purchase" ? `${data.category || "餐饮"}团购券` : data.category || "消费", `¥${Number(data.amount || 0).toFixed(2).replace(/\.00$/, "")}${data.voucherStatus === "unused" ? " · 未使用" : ""}${data.note ? ` · ${data.note}` : ""}`],
    meal: ["◇", "饮食", `${data.name || "餐食"} · ${Number(data.calories || 0)} 千卡 · 蛋白质 ${Number(data.protein || 0)}g / 碳水 ${Number(data.carbs || 0)}g / 脂肪 ${Number(data.fat || 0)}g`],
    meal_note: ["◇", data.analyzed ? "待确认饮食" : "待补充饮食", data.description || entry.sourceText || "已记录饮食"],
    life_event: ["·", data.category || "生活事件", `${data.title || "生活事件"}${data.durationMinutes ? ` · ${data.durationMinutes} 分钟` : ""}${data.details && data.details !== data.title ? ` · ${data.details}` : ""}`],
    note: ["·", "生活记录", data.text || entry.sourceText || "已记录"]
  };
  return formats[entry.type] || ["·", "记录", entry.sourceText || "已记录"];
}

function editorInput(label, name, value = "", options = {}) {
  const type = options.type || "text";
  const step = options.step ? ` step="${options.step}"` : "";
  const min = options.min !== undefined ? ` min="${options.min}"` : "";
  const full = options.full ? " full" : "";
  return `<label class="${full.trim()}">${escapeHtml(label)}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}"${step}${min}></label>`;
}

function editorTextarea(label, name, value = "") {
  return `<label class="full">${escapeHtml(label)}<textarea name="${name}">${escapeHtml(value ?? "")}</textarea></label>`;
}

function editorSelect(label, name, value, choices) {
  return `<label>${escapeHtml(label)}<select name="${name}">${choices.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></label>`;
}

function editorFieldsForEntry(entry) {
  const data = entry.data || {};
  if (entry.type === "meal") return [
    editorInput("餐食名称", "name", data.name, { full: true }),
    editorInput("热量（kcal）", "calories", data.calories, { type: "number", min: 0, step: "1" }),
    editorInput("蛋白质（g）", "protein", data.protein, { type: "number", min: 0, step: "0.1" }),
    editorInput("碳水（g）", "carbs", data.carbs, { type: "number", min: 0, step: "0.1" }),
    editorInput("脂肪（g）", "fat", data.fat, { type: "number", min: 0, step: "0.1" }),
    editorTextarea("食物明细（每行或逗号分隔）", "foods", (data.foods || []).join("、")),
    editorTextarea("备注", "note", data.note)
  ].join("");
  if (entry.type === "expense") return [
    editorInput("金额（元）", "amount", Math.abs(Number(data.amount || 0)), { type: "number", min: 0.01, step: "0.01" }),
    editorSelect("方向", "direction", data.direction === "in" || data.subtype === "refund" ? "in" : "out", [["out", "支出"], ["in", "退款 / 收入"]]),
    editorSelect("分类", "category", data.category || "其他", ["餐饮", "交通", "购物", "居住", "医疗健康", "娱乐", "学习办公", "人情往来", "其他"].map((item) => [item, item])),
    editorInput("商家", "merchant", data.merchant || ""),
    editorTextarea("备注", "note", data.note || entry.sourceText || "")
  ].join("");
  if (entry.type === "water") return editorInput("饮水量（ml）", "ml", data.ml, { type: "number", min: 1, step: "1", full: true });
  if (entry.type === "sleep") return [
    editorInput("时长（小时）", "hours", data.hours ?? "", { type: "number", min: 0, step: "0.1" }),
    editorInput("质量评分（1–10）", "qualityScore", data.qualityScore ?? "", { type: "number", min: 1, step: "1" }),
    editorInput("入睡时间", "bedTime", data.bedTime || "", { type: "time" }),
    editorInput("起床时间", "wakeTime", data.wakeTime || "", { type: "time" }),
    editorInput("睡眠感受", "quality", data.quality || "", { full: true })
  ].join("");
  if (entry.type === "exercise") return [
    editorInput("运动项目", "activity", data.activity || "运动", { full: true }),
    editorInput("时长（分钟）", "minutes", data.minutes ?? "", { type: "number", min: 0, step: "1" }),
    editorInput("距离（公里）", "km", data.km ?? "", { type: "number", min: 0, step: "0.1" }),
    editorInput("步数", "steps", data.steps ?? "", { type: "number", min: 0, step: "1" }),
    editorInput("组数", "sets", data.sets ?? "", { type: "number", min: 0, step: "1" }),
    editorInput("次数", "reps", data.reps ?? "", { type: "number", min: 0, step: "1" })
  ].join("");
  if (entry.type === "life_event") return [
    editorInput("标题", "title", data.title || "生活事件", { full: true }),
    editorInput("分类", "category", data.category || "其他"),
    editorInput("时长（分钟）", "durationMinutes", data.durationMinutes ?? "", { type: "number", min: 0, step: "1" }),
    editorInput("标签（逗号分隔）", "tags", (data.tags || []).join("、"), { full: true }),
    editorTextarea("详细内容", "details", data.details || entry.sourceText || "")
  ].join("");
  if (entry.type === "meal_note") return editorTextarea("待分析饮食描述", "description", data.description || entry.sourceText || "");
  return editorTextarea("记录内容", "text", data.text || entry.sourceText || "");
}

function openEntryEditor(entryId) {
  const entry = state.entries.find((item) => item.id === entryId && item.source !== "demo");
  if (!entry) return;
  const timestamp = new Date(entry.occurredAt || entry.createdAt || Date.now());
  $("#entryEditor").dataset.mode = "edit";
  $("#entryEditor").dataset.entryId = entry.id;
  $("#entryEditorKicker").textContent = "人工修改";
  $("#entryEditorTitle").textContent = `编辑${recordTypeLabel(entry.type)}记录`;
  $("#entryEditTypeWrap").classList.add("hidden");
  $("#entryEditType").value = entry.type;
  $("#entryEditDate").value = entry.date || localDateFromIso(timestamp);
  $("#entryEditTime").value = `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}`;
  $("#entryEditorFields").innerHTML = editorFieldsForEntry(entry);
  $("#deleteEditedEntry").classList.remove("hidden");
  $("#saveEditedEntry").textContent = "保存修改";
  $("#entryEditor").classList.remove("hidden");
}

function openEntryCreator() {
  const now = new Date();
  const type = "note";
  $("#entryEditor").dataset.mode = "create";
  delete $("#entryEditor").dataset.entryId;
  $("#entryEditorKicker").textContent = "人工添加";
  $("#entryEditorTitle").textContent = "添加一条记录";
  $("#entryEditTypeWrap").classList.remove("hidden");
  $("#entryEditType").value = type;
  $("#entryEditDate").value = selectedDay;
  $("#entryEditTime").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  $("#entryEditorFields").innerHTML = editorFieldsForEntry({ type, data: {} });
  $("#deleteEditedEntry").classList.add("hidden");
  $("#saveEditedEntry").textContent = "添加记录";
  $("#entryEditor").classList.remove("hidden");
}

function closeEntryEditor() {
  $("#entryEditor").classList.add("hidden");
  delete $("#entryEditor").dataset.entryId;
  delete $("#entryEditor").dataset.mode;
}

function formNumber(formData, name, options = {}) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 10000000;
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${options.label || name}数值不正确`);
  if (options.integer) return Math.round(value);
  const scale = 10 ** (options.decimals ?? 1);
  return Math.round(value * scale) / scale;
}

function assignOptionalNumber(target, key, formData, options) {
  const value = formNumber(formData, key, options);
  if (value === null) delete target[key];
  else target[key] = value;
}

function syncMealMessageFromEntry(entry) {
  if (entry.type !== "meal") return;
  state.messages.forEach((message) => {
    if (message.type === "meal" && message.sourceEntryId === entry.id) message.meal = { ...message.meal, ...entry.data };
  });
}

async function saveEditedEntry(event) {
  event.preventDefault();
  const isCreating = $("#entryEditor").dataset.mode === "create";
  const entryId = $("#entryEditor").dataset.entryId;
  const existingEntry = state.entries.find((item) => item.id === entryId && item.source !== "demo");
  if (!isCreating && !existingEntry) return closeEntryEditor();
  try {
    const formData = new FormData(event.currentTarget);
    const date = $("#entryEditDate").value;
    const time = $("#entryEditTime").value;
    const occurredAt = new Date(`${date}T${time}:00`);
    if (!date || !time || Number.isNaN(occurredAt.getTime())) throw new Error("日期或时间不正确");
    const entry = isCreating ? { type: $("#entryEditType").value, data: {} } : existingEntry;
    const previousEntry = isCreating ? null : cloneValue(existingEntry);
    let savedEntry = entry;
    const next = { ...entry.data };
    if (entry.type === "meal") {
      next.name = String(formData.get("name") || "本次饮食").trim().slice(0, 80);
      for (const [key, label] of [["calories", "热量"], ["protein", "蛋白质"], ["carbs", "碳水"], ["fat", "脂肪"]]) assignOptionalNumber(next, key, formData, { label, minimum: 0, maximum: 100000 });
      next.foods = String(formData.get("foods") || "").split(/[、，,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
      next.note = String(formData.get("note") || "").trim().slice(0, 300);
      next.confirmed = true;
    } else if (entry.type === "expense") {
      const amount = formNumber(formData, "amount", { label: "金额", minimum: 0.01, maximum: 10000000, decimals: 2 });
      if (amount === null) throw new Error("请填写金额");
      next.amount = amount;
      next.direction = formData.get("direction") === "in" ? "in" : "out";
      next.subtype = next.direction === "in" ? "refund" : next.subtype === "voucher_purchase" ? "voucher_purchase" : "ordinary";
      next.category = String(formData.get("category") || "其他");
      next.merchant = String(formData.get("merchant") || "").trim().slice(0, 40);
      next.note = String(formData.get("note") || "").trim().slice(0, 160);
    } else if (entry.type === "water") {
      const ml = formNumber(formData, "ml", { label: "饮水量", minimum: 1, maximum: 20000, integer: true });
      if (ml === null) throw new Error("请填写饮水量");
      next.ml = ml;
    } else if (entry.type === "sleep") {
      assignOptionalNumber(next, "hours", formData, { label: "睡眠时长", minimum: 0, maximum: 24 });
      assignOptionalNumber(next, "qualityScore", formData, { label: "睡眠评分", minimum: 1, maximum: 10, integer: true });
      next.bedTime = String(formData.get("bedTime") || "");
      next.wakeTime = String(formData.get("wakeTime") || "");
      next.quality = String(formData.get("quality") || "").trim().slice(0, 50);
      if (!next.hours && next.bedTime && next.wakeTime) {
        const [bedHour, bedMinute] = next.bedTime.split(":").map(Number);
        const [wakeHour, wakeMinute] = next.wakeTime.split(":").map(Number);
        let durationMinutes = wakeHour * 60 + wakeMinute - (bedHour * 60 + bedMinute);
        if (durationMinutes <= 0) durationMinutes += 24 * 60;
        if (durationMinutes > 0 && durationMinutes <= 16 * 60) next.hours = Math.round(durationMinutes / 6) / 10;
      }
      if (!next.hours && !next.qualityScore && !next.quality) throw new Error("请填写睡眠时长、起止时间或睡眠感受");
    } else if (entry.type === "exercise") {
      next.activity = String(formData.get("activity") || "运动").trim().slice(0, 40);
      assignOptionalNumber(next, "minutes", formData, { label: "运动时长", minimum: 0, maximum: 1440, integer: true });
      assignOptionalNumber(next, "km", formData, { label: "运动距离", minimum: 0, maximum: 1000 });
      assignOptionalNumber(next, "steps", formData, { label: "步数", minimum: 0, maximum: 200000, integer: true });
      assignOptionalNumber(next, "sets", formData, { label: "组数", minimum: 0, maximum: 1000, integer: true });
      assignOptionalNumber(next, "reps", formData, { label: "次数", minimum: 0, maximum: 100000, integer: true });
    } else if (entry.type === "life_event") {
      next.title = String(formData.get("title") || "生活事件").trim().slice(0, 80);
      next.category = String(formData.get("category") || "其他").trim().slice(0, 30);
      assignOptionalNumber(next, "durationMinutes", formData, { label: "事件时长", minimum: 0, maximum: 1440, integer: true });
      next.tags = String(formData.get("tags") || "").split(/[、，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
      next.details = String(formData.get("details") || "").trim().slice(0, 500);
    } else if (entry.type === "meal_note") {
      next.description = String(formData.get("description") || "").trim().slice(0, 500);
    } else {
      next.text = String(formData.get("text") || "").trim().slice(0, 500);
      if (!next.text) throw new Error("请填写记录内容");
    }
    if (isCreating) {
      leaveDemoMode();
      savedEntry = {
        id: uid(),
        type: entry.type,
        date,
        createdAt: nowIso(),
        occurredAt: occurredAt.toISOString(),
        timeSource: "manual",
        timeText: time,
        data: next,
        sourceText: `人工添加${recordTypeLabel(entry.type)}记录`,
        source: "manual"
      };
      state.entries.push(savedEntry);
    } else {
      entry.data = next;
      entry.date = date;
      entry.occurredAt = occurredAt.toISOString();
      entry.timeSource = "manual";
      entry.timeText = time;
      entry.lastCorrectedAt = nowIso();
      entry.correctionSource = "manual_editor";
      syncMealMessageFromEntry(entry);
    }
    const [, receiptLabel, receiptValue] = dayEntryPresentation(savedEntry);
    addOperationReceipt(isCreating ? "已手动添加记录" : "已手动修改记录", [`${receiptLabel}：${receiptValue}`], {
      createdEntryIds: isCreating ? [savedEntry.id] : [],
      previousEntries: previousEntry ? [previousEntry] : [],
      date
    });
    await saveState();
    closeEntryEditor();
    renderAll();
    showToast(isCreating ? "记录已添加" : "记录已修改");
  } catch (error) {
    showToast(error.message || "修改失败");
  }
}

async function deleteEntryManually(entryId) {
  const entry = state.entries.find((item) => item.id === entryId && item.source !== "demo");
  if (!entry) return;
  if (!confirm(`确定删除这条${recordTypeLabel(entry.type)}记录吗？`)) return;
  const snapshot = cloneValue(entry);
  const [, label, value] = dayEntryPresentation(entry);
  state.entries = state.entries.filter((item) => item.id !== entry.id);
  markEntryMessagesDeleted(new Set([entry.id]));
  addOperationReceipt("已手动删除记录", [`${label}：${value}`], {
    deletedEntries: [snapshot],
    date: entry.date
  });
  await saveState();
  closeEntryEditor();
  renderAll();
  showToast("记录已删除，可在聊天中撤销");
}

function renderDay() {
  const day = new Date(`${selectedDay}T12:00:00`);
  const isToday = selectedDay === dateKey(0);
  $("#dayEyebrow").textContent = isToday ? "今天" : day.toLocaleDateString("zh-CN", { weekday: "long" });
  $("#dayHeading").textContent = day.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  $("#dayDateInput").value = selectedDay;
  $("#dayDateLabel").textContent = window.FeiyuRecordOps.formatDateLabel(selectedDay);

  const entries = state.entries.filter((entry) => entry.date === selectedDay && entry.source !== "demo").sort((a, b) => String(a.occurredAt || a.createdAt).localeCompare(String(b.occurredAt || b.createdAt)));
  const metrics = window.FeiyuRecordOps.dayMetrics(entries);
  const sleepValue = metrics.sleepHours ? `${metrics.sleepHours}h` : metrics.sleepCount ? "已记录" : "0h";
  const exerciseValue = metrics.exerciseMinutes ? `${metrics.exerciseMinutes}min` : metrics.exerciseCount ? `${metrics.exerciseCount}次` : "0min";
  $("#daySummaryGrid").innerHTML = [
    ["饮食", `${metrics.calories} kcal`, `${metrics.mealCount} 条已确认`],
    ["净消费", formatMoney(metrics.expenseTotal), `${metrics.expenseCount} 笔支出${metrics.refundCount ? ` · ${metrics.refundCount} 笔退款` : ""}`],
    ["饮水", `${metrics.waterMl}ml`, metrics.waterMl ? "当天累计" : "暂无记录"],
    ["运动 / 睡眠", `${exerciseValue} · ${sleepValue}`, `${metrics.exerciseCount} 次运动 · ${metrics.sleepCount} 条睡眠`]
  ].map(([label, value, note]) => `<article class="day-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");

  $("#dayEntryCount").textContent = `${entries.length} 条`;
  $("#dayEntries").innerHTML = entries.length ? entries.map((entry) => {
    const [icon, label, value] = dayEntryPresentation(entry);
    return `<article class="day-entry" data-entry-id="${escapeHtml(entry.id)}"><time class="day-entry-time">${escapeHtml(entryTimeLabel(entry))}</time><span class="day-entry-icon">${icon}</span><div class="day-entry-copy"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><div class="day-entry-actions"><button type="button" data-edit-entry="${escapeHtml(entry.id)}">编辑</button><button type="button" class="day-delete" data-delete-entry="${escapeHtml(entry.id)}">删除</button></div></article>`;
  }).join("") : '<div class="empty-copy day-empty">这一天还没有生活记录。</div>';

  const tasks = state.tasks.filter((task) => {
    if (task.source === "demo") return false;
    const taskDay = task.dueDate || localDateFromIso(task.createdAt);
    return taskDay === selectedDay;
  });
  $("#dayTaskCount").textContent = `${tasks.length} 项`;
  $("#dayTasks").innerHTML = tasks.length ? tasks.map((task) => `<article class="day-task ${task.done ? "done" : ""}">
    <button data-day-toggle-task="${task.id}" aria-label="${task.done ? "设为未完成" : "完成待办"}">${task.done ? "✓" : ""}</button>
    <div><strong>${escapeHtml(task.text)}</strong><span>${task.done ? "已完成" : "待完成"}${task.dueDate ? " · 当天截止" : " · 当天创建"}</span></div>
  </article>`).join("") : '<div class="empty-copy day-empty">这一天没有待办。</div>';
}

function renderTasks() {
  const pending = state.tasks.filter((task) => !task.done);
  const done = state.tasks.filter((task) => task.done);
  const total = state.tasks.length;
  $("#taskCount").textContent = `${pending.length} 件待完成`;
  $("#taskProgress").style.width = total ? `${done.length / total * 100}%` : "0%";
  $("#pendingCount").textContent = pending.length;
  $("#doneCount").textContent = done.length;
  $("#pendingTasks").innerHTML = pending.length ? pending.map(taskHtml).join("") : '<div class="empty-copy">暂时没有待办，享受一下空闲吧。</div>';
  $("#doneTasks").innerHTML = done.length ? done.map(taskHtml).join("") : '<div class="empty-copy">完成的事项会出现在这里。</div>';
}

function taskHtml(task) {
  const date = task.dueDate ? `截止 ${task.dueDate.slice(5).replace("-", "/")}` : "无截止日期";
  return `<article class="task-item ${task.done ? "done" : ""}" data-task-id="${task.id}">
    <button class="task-check" data-toggle-task="${task.id}" aria-label="${task.done ? "设为未完成" : "完成待办"}">${task.done ? "✓" : ""}</button>
    <div class="task-copy"><strong>${escapeHtml(task.text)}</strong><span>${date}</span></div>
    <button class="task-delete" data-delete-task="${task.id}" aria-label="删除待办">×</button>
  </article>`;
}

function renderSettings() {
  $("#apiKey").value = state.settings.apiKey || "";
  const profile = currentProfile();
  const focusLabels = { diet: "饮食", sleep: "睡眠", exercise: "运动", finance: "消费", tasks: "待办", dailyLife: "日常" };
  const highFocuses = Object.entries(profile.priorities)
    .filter(([, priority]) => priority === "high")
    .map(([key]) => focusLabels[key])
    .filter(Boolean);
  highFocuses.push(...profile.customFocuses.filter((item) => item.priority === "high").map((item) => item.name));
  const goals = [
    profile.goals.sleepHours ? `睡眠${profile.goals.sleepHours}h` : "",
    profile.goals.waterMl ? `饮水${profile.goals.waterMl}ml` : "",
    profile.goals.exercisePerWeek !== null ? `运动每周${profile.goals.exercisePerWeek}次` : "",
    profile.goals.dietGoal || ""
  ].filter(Boolean);
  const style = profile.assistantStyle;
  const styleText = `${({ short: "简短", medium: "适中", detailed: "详细" })[style.verbosity]} · 最多${style.maxSuggestions}条建议 · ${({ gentle: "温和", direct: "直接", data_focused: "数据化" })[style.tone]}`;
  const rows = [
    ["重点关注", highFocuses.join("、") || "未特别设置"],
    ["生活目标", goals.join("；") || "未设置"],
    ["回复方式", styleText],
    ["自定义领域", profile.customFocuses.map((item) => item.name).join("、") || "暂无"],
    ["临时重点", profile.temporaryFocus?.text || "暂无"]
  ];
  if (profile.customInstructions) rows.push(["补充说明", profile.customInstructions]);
  $("#profileSummary").innerHTML = rows
    .map(([label, value]) => `<div class="profile-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

async function clearDemoData() {
  state.demo = false;
  state.entries = state.entries.filter((entry) => entry.source !== "demo");
  state.tasks = state.tasks.filter((task) => task.source !== "demo");
  state.messages = [{ id: uid(), role: "assistant", type: "text", text: "准备好了。从现在开始，这里只显示你的记录。", createdAt: nowIso() }];
  await saveState();
  renderAll();
  showToast("演示数据已清除");
}

function downloadFile(name, content, type) {
  if (window.AndroidBackup && typeof window.AndroidBackup.saveTextFile === "function") {
    window.AndroidBackup.saveTextFile(name, content, type);
    return;
  }
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const exported = JSON.parse(JSON.stringify(state));
  exported.settings.apiKey = "";
  exported.exportedAt = nowIso();
  downloadFile(`大肥鱼助手备份-${dateKey(0)}.json`, JSON.stringify(exported, null, 2), "application/json;charset=utf-8");
  showToast("完整备份已导出");
}

function exportCsv() {
  const rows = [["日期", "方向", "金额", "净额", "分类", "类型", "备注"], ...state.entries.filter((entry) => entry.type === "expense").map((entry) => [
    entry.date,
    window.FeiyuRecordOps.expenseValue(entry) < 0 ? "退款" : "支出",
    Math.abs(Number(entry.data.amount || 0)),
    window.FeiyuRecordOps.expenseValue(entry),
    entry.data.category,
    entry.data.subtype || "ordinary",
    entry.data.note || ""
  ])];
  const csv = "\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(`大肥鱼助手消费-${dateKey(0)}.csv`, csv, "text/csv;charset=utf-8");
  showToast("消费 CSV 已导出");
}

async function importJson(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.entries) || !Array.isArray(imported.tasks)) throw new Error("格式不正确");
    imported.entries = imported.entries.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt || entry.createdAt,
      timeSource: entry.timeSource || "legacy"
    }));
    const existingEntryIds = new Set(state.entries.map((item) => item.id));
    const existingTaskIds = new Set(state.tasks.map((item) => item.id));
    const existingMessageIds = new Set(state.messages.map((item) => item.id));
    state.entries.push(...imported.entries.filter((item) => !existingEntryIds.has(item.id)));
    state.tasks.push(...imported.tasks.filter((item) => !existingTaskIds.has(item.id)));
    if (Array.isArray(imported.messages)) state.messages.push(...imported.messages.filter((item) => item?.id && !existingMessageIds.has(item.id)));
    if (imported.settings?.profile) state.settings.profile = window.FeiyuProfile.normalize(imported.settings.profile);
    state.demo = false;
    await saveState();
    renderAll();
    showToast("备份已合并");
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  }
}

function renderAll() {
  renderMessages();
  renderDay();
  renderTrends();
  renderTasks();
  renderSettings();
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.target)));
  $("#openToday").addEventListener("click", () => { selectedDay = dateKey(0); switchView("day"); });
  $("#dayDateInput").addEventListener("change", (event) => { selectedDay = event.target.value || dateKey(0); renderDay(); });
  $$("[data-day-shift]").forEach((button) => button.addEventListener("click", () => {
    const d = new Date(`${selectedDay}T12:00:00`);
    d.setDate(d.getDate() + Number(button.dataset.dayShift));
    selectedDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    renderDay();
  }));
  $("#dayToday").addEventListener("click", () => { selectedDay = dateKey(0); renderDay(); });
  $("#openEntryCreator").addEventListener("click", openEntryCreator);
  $("#dayEntries").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-entry]");
    const deleteButton = event.target.closest("[data-delete-entry]");
    if (editButton) openEntryEditor(editButton.dataset.editEntry);
    if (deleteButton) deleteEntryManually(deleteButton.dataset.deleteEntry);
  });
  $("#entryEditForm").addEventListener("submit", saveEditedEntry);
  $("#entryEditType").addEventListener("change", (event) => {
    if ($("#entryEditor").dataset.mode !== "create") return;
    $("#entryEditorFields").innerHTML = editorFieldsForEntry({ type: event.target.value, data: {} });
  });
  $("#closeEntryEditor").addEventListener("click", closeEntryEditor);
  $("#cancelEntryEdit").addEventListener("click", closeEntryEditor);
  $("#deleteEditedEntry").addEventListener("click", () => {
    const entryId = $("#entryEditor").dataset.entryId;
    if (entryId) deleteEntryManually(entryId);
  });
  $("#entryEditor").addEventListener("click", (event) => {
    if (event.target === $("#entryEditor")) closeEntryEditor();
  });
  $("#dayTasks").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-day-toggle-task]");
    if (!button) return;
    const task = state.tasks.find((item) => item.id === button.dataset.dayToggleTask);
    if (task) task.done = !task.done;
    await saveState();
    renderDay();
    renderTasks();
  });
  $("#sendButton").addEventListener("click", handleSend);
  $("#chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSend(); }
  });
  $("#chatInput").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 84)}px`;
  });
  $("#chatInput").addEventListener("focus", () => {
    setTimeout(syncAppViewport, 80);
    setTimeout(syncAppViewport, 280);
  });
  $("#chatInput").addEventListener("blur", () => setTimeout(syncAppViewport, 120));
  $$(".quick-chip[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    $("#chatInput").value = button.dataset.prompt;
    $("#chatInput").focus();
  }));
  $("#photoQuick").addEventListener("click", () => $("#photoInput").click());
  $("#photoInput").addEventListener("change", (event) => {
    pendingPhoto = event.target.files[0] || null;
    $("#composerNote").textContent = pendingPhoto ? `已选择：${pendingPhoto.name}` : IDLE_COMPOSER_NOTE;
    if (pendingPhoto) $("#chatInput").focus();
    event.target.value = "";
  });
  $("#messageList").addEventListener("click", (event) => {
    const mealButton = event.target.closest("[data-confirm-meal]");
    const profileButton = event.target.closest("[data-confirm-profile]");
    const cancelProfileButton = event.target.closest("[data-cancel-profile]");
    const undoButton = event.target.closest("[data-undo-operation]");
    const viewDayButton = event.target.closest("[data-view-operation-day]");
    if (mealButton) confirmMeal(mealButton.dataset.confirmMeal);
    if (profileButton) confirmProfileChange(profileButton.dataset.confirmProfile);
    if (cancelProfileButton) cancelProfileChange(cancelProfileButton.dataset.cancelProfile);
    if (undoButton) undoOperation(undoButton.dataset.undoOperation);
    if (viewDayButton) {
      selectedDay = viewDayButton.dataset.viewOperationDay || dateKey(0);
      switchView("day");
    }
  });
  $("#clearDemo").addEventListener("click", clearDemoData);

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#taskInput").value.trim();
    if (!text) return;
    leaveDemoMode();
    state.tasks.unshift({ id: uid(), text, dueDate: $("#taskDate").value, done: false, createdAt: nowIso() });
    $("#taskInput").value = "";
    $("#taskDate").value = "";
    await saveState();
    renderTasks();
  });
  $("#focusTaskInput").addEventListener("click", () => $("#taskInput").focus());
  $(".tasks-content").addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-toggle-task]");
    const remove = event.target.closest("[data-delete-task]");
    if (toggle) {
      const task = state.tasks.find((item) => item.id === toggle.dataset.toggleTask);
      if (task) task.done = !task.done;
    }
    if (remove) state.tasks = state.tasks.filter((item) => item.id !== remove.dataset.deleteTask);
    if (toggle || remove) { state.demo = false; await saveState(); renderTasks(); }
  });

  $("#toggleKey").addEventListener("click", () => {
    const input = $("#apiKey");
    input.type = input.type === "password" ? "text" : "password";
    $("#toggleKey").textContent = input.type === "password" ? "显示" : "隐藏";
  });
  $("#apiKey").addEventListener("change", async (event) => { state.settings.apiKey = event.target.value.trim(); await saveState(); showToast("API Key 已保存在本机"); });
  $("#resetProfile").addEventListener("click", async () => {
    const profilePatch = { reset: true };
    addMessage({
      role: "assistant",
      type: "profile_change",
      profilePatch,
      descriptions: window.FeiyuProfile.describePatch(profilePatch),
      confirmed: false,
      cancelled: false
    });
    await saveState();
    renderMessages(true);
    switchView("chat");
  });
  $("#exportJson").addEventListener("click", exportJson);
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#importJson").addEventListener("change", (event) => { if (event.target.files[0]) importJson(event.target.files[0]); event.target.value = ""; });
  $("#resetData").addEventListener("click", async () => {
    if (!confirm("确定清除本机全部记录、待办和设置吗？建议先导出备份。")) return;
    state = seedState();
    state.demo = false;
    state.entries = [];
    state.tasks = [];
    state.messages = [{ id: uid(), role: "assistant", type: "text", text: "本机数据已清空。随时可以重新开始。", createdAt: nowIso() }];
    await saveState();
    renderAll();
    switchView("chat");
    showToast("本机数据已清除");
  });
}

async function init() {
  window.addEventListener("resize", syncAppViewport);
  window.visualViewport?.addEventListener("resize", syncAppViewport);
  window.visualViewport?.addEventListener("scroll", syncAppViewport);
  syncAppViewport();
  $("#statusTime").textContent = timeLabel();
  db = await openDatabase();
  state = await databaseGet(STATE_KEY);
  if (!state) {
    state = seedState();
    await saveState();
  }
  state.settings ||= { apiKey: "" };
  state.settings.profile = window.FeiyuProfile.normalize(state.settings.profile);
  state.entries ||= [];
  state.messages ||= [];
  state.tasks ||= [];
  const previousSchemaVersion = Number(state.schemaVersion || 0);
  let stateNeedsMigration = previousSchemaVersion !== SCHEMA_VERSION;
  if (previousSchemaVersion < 3 && repairEmbeddedMealExpenses()) stateNeedsMigration = true;
  state.entries.forEach((entry) => {
    if (!entry.occurredAt) {
      entry.occurredAt = entry.createdAt;
      entry.timeSource = entry.timeSource || "legacy";
      stateNeedsMigration = true;
    }
  });
  const entryCountBeforeCleanup = state.entries.length;
  state.entries = state.entries.filter((entry) => !(entry.type === "note" && isBareRecordPrompt(entry.data?.text || entry.sourceText || "")));
  if (!state.demo && (state.entries.some((entry) => entry.source === "demo") || state.tasks.some((task) => task.source === "demo"))) {
    leaveDemoMode();
    await saveState();
  } else if (state.entries.length !== entryCountBeforeCleanup || stateNeedsMigration) {
    await saveState();
  }
  bindEvents();
  renderAll();
  renderMessages(true);
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="padding:32px;font-family:system-ui"><h1>大肥鱼助手暂时无法启动</h1><p>${escapeHtml(error.message)}</p></main>`;
});
