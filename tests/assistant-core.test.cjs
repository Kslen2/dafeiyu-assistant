const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requests = [];
const revisedPayload = {
  is_food: true,
  name: "咪咪虾条（小包）",
  calories: 230,
  protein: 4,
  carbs: 30,
  fat: 12,
  foods: ["咪咪虾条约50克（1小包）"],
  uncertainties: [],
  needs_clarification: false,
  question: "",
  note: "已按普通小包装约50克修正。"
};
const interpretationPayload = {
  intent: "record",
  actions: [
    { op: "create_expense", target_id: "", data: { amount: 24.9, direction: "out", category: "餐饮", subtype: "voucher_purchase", merchant: "肯德基", voucher_status: "unused" } }
  ],
  meal_text: "",
  needs_clarification: false,
  question: ""
};
const lifeEventPayload = {
  intent: "record",
  actions: [
    { op: "create_life_event", target_id: "", data: { title: "整理房间", details: "下午整理房间40分钟", category: "家务", duration_minutes: 40, tags: ["整理", "家务"] } }
  ],
  meal_text: "",
  needs_clarification: false,
  question: ""
};
const eyeEventPayload = {
  intent: "record",
  actions: [
    { op: "create_life_event", target_id: "", data: { title: "连续用电脑三小时", details: "眼睛有点干", duration_minutes: 180, tags: ["用眼"] } }
  ],
  meal_text: "",
  needs_clarification: false,
  question: ""
};
const profilePayload = {
  intent: "record",
  actions: [
    { op: "propose_profile_update", target_id: "", data: { profile_patch: { customFocus: { id: "eye-care", name: "用眼情况", priority: "high", signals: ["连续屏幕时长", "眼睛干涩", "晚间用眼"], adviceMode: "patterns_only", action: "upsert" } } } }
  ],
  meal_text: "",
  needs_clarification: false,
  question: ""
};

const sandbox = {
  window: {},
  document: { documentElement: { dataset: {} } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const prompt = requests.at(-1).messages.at(-1).content;
    const responsePayload = /结构化操作/.test(prompt)
      ? /用户输入：我想重点关注用眼情况/.test(prompt) ? profilePayload
        : /用户输入：下午整理房间40分钟/.test(prompt) ? lifeEventPayload
          : /用户输入：上午连续看了三个小时电脑/.test(prompt) ? eyeEventPayload
            : interpretationPayload
      : revisedPayload;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(responsePayload) } }], usage: { total_tokens: 120 } })
    };
  },
  console
};

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "assistant-core.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "assistant-core.js" });

(async () => {
  const originalMeal = { name: "咪咪虾条（一包）", calories: 445, protein: 16, carbs: 126, fat: 55, foods: ["约200克"] };
  const result = await sandbox.window.FeiyuAI.reviseMeal({
    apiKey: "test-key",
    originalText: "刚刚吃了一包咪咪",
    originalMeal,
    correction: "应该不足两百克，就是普通小包装"
  });

  assert.equal(requests.length, 1, "revision should make one request");
  assert.equal(requests[0].model, "deepseek-flash");
  const prompt = requests[0].messages.at(-1).content;
  assert.match(prompt, /刚刚吃了一包咪咪/);
  assert.match(prompt, /445/);
  assert.match(prompt, /普通小包装/);
  assert.equal(result.name, "咪咪虾条（小包）");
  assert.equal(result.calories, 230);
  assert.equal(result.needsClarification, false);
  assert.deepEqual(Array.from(result.foods), ["咪咪虾条约50克（1小包）"]);

  const plan = await sandbox.window.FeiyuAI.interpretLifeEvent({
    apiKey: "test-key",
    text: "买了一张肯德基团购券，花了24.9，还没吃",
    entries: [{ id: "old-expense", type: "expense", date: "2026-10-20", createdAt: "2026-10-20T08:00:00+08:00", data: { amount: 10 } }],
    history: []
  });
  assert.equal(requests.length, 2, "interpretation should make one additional request");
  assert.match(requests[1].messages.at(-1).content, /还没吃/);
  assert.match(requests[1].messages.at(-1).content, /团购券.*不等于已经进食/);
  assert.equal(plan.actions[0].data.direction, "out");
  assert.equal(plan.actions[0].data.subtype, "voucher_purchase");
  assert.equal(plan.mealText, "");

  const lifePlan = await sandbox.window.FeiyuAI.interpretLifeEvent({
    apiKey: "test-key",
    text: "下午整理房间40分钟",
    entries: [],
    history: []
  });
  assert.equal(lifePlan.actions[0].op, "create_life_event");
  assert.equal(lifePlan.actions[0].data.category, "家务");
  assert.equal(lifePlan.actions[0].data.duration_minutes, 40);

  const eyePlan = await sandbox.window.FeiyuAI.interpretLifeEvent({
    apiKey: "test-key",
    text: "上午连续看了三个小时电脑，眼睛有点干",
    entries: [],
    history: []
  });
  assert.equal(eyePlan.actions[0].data.category, "用眼", "missing AI category is normalized from local evidence");

  const profilePlan = await sandbox.window.FeiyuAI.interpretLifeEvent({
    apiKey: "test-key",
    text: "我想重点关注用眼情况",
    entries: [],
    history: [],
    profile: { priorities: { diet: "high" } }
  });
  assert.equal(profilePlan.actions[0].op, "propose_profile_update");
  assert.equal(profilePlan.actions[0].data.profile_patch.customFocus.name, "用眼情况");
  assert.match(requests.at(-1).messages.at(-1).content, /用户当前个性化设置/);
  assert.match(requests.at(-1).messages.at(-1).content, /应用还会要求用户确认/);
  console.log("PASS meal revision, universal event, and profile interpretation contracts (mocked)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
