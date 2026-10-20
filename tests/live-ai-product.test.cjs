const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for the live product simulation");

const storage = new Map();
const sandbox = {
  window: {},
  document: { documentElement: { dataset: {} } },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  },
  fetch,
  console,
  Date,
  JSON,
  Math,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Set,
  Map
};
const source = fs.readFileSync(path.join(__dirname, "..", "dist", "assistant-core.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "assistant-core.js" });
const ai = sandbox.window.FeiyuAI;

const recentEntries = [
  { id: "expense-lunch", type: "expense", date: "2026-10-20", occurredAt: "2026-10-20T12:10:00+08:00", timeSource: "explicit", data: { amount: 28, direction: "out", category: "餐饮", note: "午饭" } },
  { id: "water-morning", type: "water", date: "2026-10-20", occurredAt: "2026-10-20T10:00:00+08:00", timeSource: "explicit", data: { ml: 200 } },
  { id: "sleep-today", type: "sleep", date: "2026-10-20", occurredAt: "2026-10-20T09:00:00+08:00", timeSource: "explicit", data: { hours: 7.5, bedTime: "01:30", wakeTime: "09:00" } },
  { id: "meal-lunch", type: "meal", date: "2026-10-20", occurredAt: "2026-10-20T12:10:00+08:00", timeSource: "explicit", data: { name: "牛肉米粉", calories: 680, protein: 30, carbs: 92, fat: 20, confirmed: true } }
];

let assertions = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };
const ok = (value, message) => { assert.ok(value, message); assertions += 1; };

async function interpret(text) {
  return ai.interpretLifeEvent({ apiKey, text, entries: recentEntries, history: [], profile: null });
}

(async () => {
  const voucher = await interpret("买了一张肯德基团购券，花了24.9元，还没有吃");
  equal(voucher.actions[0]?.op, "create_expense", "voucher creates expense");
  equal(voucher.actions[0]?.data?.subtype, "voucher_purchase", "voucher subtype");
  equal(voucher.actions[0]?.data?.direction, "out", "voucher is outflow");
  equal(voucher.mealText, "", "unused voucher is not a meal");

  const refund = await interpret("刚刚收到肯德基团购券退款24.9元");
  equal(refund.actions.some((action) => action.op === "create_expense" && action.data?.direction === "in"), true, "refund is inflow");
  equal(refund.mealText, "", "refund is not food");

  const correction = await interpret("刚才午饭消费不是28元，改成19.9元");
  const correctionAction = correction.actions.find((action) => action.op === "update_entry");
  equal(correctionAction?.target_id, "expense-lunch", "correction uses a real target id");
  equal(Number(correctionAction?.data?.amount), 19.9, "correction amount");

  const lifeCases = [
    ["上午连续看了三个小时电脑，眼睛有点干", "用眼"],
    ["下午整理房间四十分钟", "家务"],
    ["晚上和朋友聊了一个小时", "社交"],
    ["今天完成了项目报告", "工作"]
  ];
  for (const [text, category] of lifeCases) {
    const plan = await interpret(text);
    const event = plan.actions.find((action) => action.op === "create_life_event");
    ok(event, `${text}: creates life event`);
    equal(event?.data?.category, category, `${text}: category`);
  }

  const profile = await interpret("以后重点关注我的用眼情况，只在总结时提醒");
  const profileAction = profile.actions.find((action) => action.op === "propose_profile_update");
  ok(profileAction, "profile change is proposed");
  ok(profileAction?.data?.profile_patch?.customFocus, "eye-care custom focus exists");

  const mealCases = [
    "午饭吃了一碗牛肉米粉，加了一个卤蛋",
    "晚饭吃了两碗米饭、一份番茄炒蛋和一只烤鸡腿",
    "刚刚喝了一杯约400毫升、不额外加糖的西瓜汁",
    "早餐吃了50克燕麦、一个鸡蛋和250毫升纯牛奶"
  ];
  for (const text of mealCases) {
    const meal = await ai.analyzeMeal({ apiKey, text, imageDataUrl: "", profile: null });
    equal(meal.isFood, true, `${text}: recognized as food`);
    ok(meal.calories > 0, `${text}: calories`);
    ok(meal.protein >= 0 && meal.carbs >= 0 && meal.fat >= 0, `${text}: macros nonnegative`);
    ok(Array.isArray(meal.foods) && meal.foods.length > 0, `${text}: food details`);
    const macroCalories = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9;
    ok(Math.abs(macroCalories - meal.calories) <= Math.max(180, meal.calories * 0.4), `${text}: energy roughly consistent`);
  }

  const summary = await ai.summarizeDay({
    apiKey,
    entries: recentEntries,
    tasks: [{ text: "晚上整理书桌", dueDate: "2026-10-20", done: false }],
    profile: { assistantStyle: { maxSuggestions: 5 }, customFocuses: [{ name: "用眼情况", priority: "high", signals: ["连续屏幕时长"] }] }
  });
  ok(summary.title.length > 0, "summary title");
  ok(summary.suggestions.length <= 5, "summary suggestion limit");

  const greeting = await ai.chat({ apiKey, text: "你好", history: [], entries: [], tasks: [], profile: null });
  ok(greeting.length > 0, "greeting response");
  equal(/已记录|已保存|已写入/.test(greeting), false, "greeting does not claim persistence");

  const dinner = await ai.chat({ apiKey, text: "结合我今天的情况，建议晚饭吃什么？", history: [], entries: recentEntries, tasks: [], profile: null });
  ok(dinner.length > 0, "dinner advice response");
  equal(/已记录|已保存|已写入/.test(dinner), false, "advice does not claim persistence");

  const usage = ai.getUsageLog();
  const totals = usage.reduce((sum, item) => {
    sum.prompt += Number(item.usage?.prompt_tokens || 0);
    sum.completion += Number(item.usage?.completion_tokens || 0);
    sum.total += Number(item.usage?.total_tokens || 0);
    return sum;
  }, { prompt: 0, completion: 0, total: 0 });
  console.log(`PASS live AI product simulation: ${assertions} assertions, ${usage.length} calls, ${totals.total} total tokens (${totals.prompt} input / ${totals.completion} output)`);
})().catch((error) => {
  console.error("LIVE AI PRODUCT TEST FAILED");
  console.error(error);
  process.exitCode = 1;
});
