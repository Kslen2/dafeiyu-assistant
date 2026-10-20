const assert = require("node:assert/strict");
const parser = require("../dist/record-parser.js");
const ops = require("../dist/record-operations.js");
const profiles = require("../dist/profile-core.js");

let passed = 0;

const expenseContexts = [
  ["公交", "交通"], ["地铁", "交通"], ["房租", "居住"], ["电费", "居住"],
  ["买药", "医疗健康"], ["电影票", "娱乐"], ["买书", "学习办公"], ["买礼物", "人情往来"],
  ["午饭", "餐饮"], ["咖啡", "餐饮"], ["买衣服", "购物"], ["洗衣液", "购物"]
];
const amounts = [1, 2, 2.5, 5, 8, 12, 18, 24.9, 35, 48, 56, 89, 100, 120, 200];
const prefixes = ["", "刚刚", "今天", "下午"];
for (const [context, category] of expenseContexts) {
  for (const amount of amounts) {
    for (const prefix of prefixes) {
      const text = `${prefix}${context}花了${amount}元`;
      const result = parser.extract(text);
      assert.equal(result.entries.length, 1, `${text}: one expense`);
      assert.equal(result.entries[0].type, "expense", `${text}: expense type`);
      assert.equal(result.entries[0].data.amount, amount, `${text}: amount`);
      assert.equal(result.entries[0].data.category, category, `${text}: category`);
      assert.equal(parser.needsAIEventInterpretation(text), false, `${text}: local route remains authoritative`);
      passed += 5;
    }
  }
}

const activities = ["跑步", "快走", "走路", "散步", "骑车", "游泳", "健身", "力量训练", "瑜伽", "跳绳", "普拉提", "爬山", "拳击", "太极", "跳舞"];
const durations = [["10分钟", 10], ["30分钟", 30], ["45分钟", 45], ["1小时", 60], ["半小时", 30]];
for (const activity of activities) {
  for (const [duration, minutes] of durations) {
    const text = `下午${activity}${duration}`;
    const result = parser.extract(text);
    assert.equal(result.entries.length, 1, `${text}: one exercise`);
    assert.equal(result.entries[0].type, "exercise", `${text}: exercise type`);
    assert.equal(result.entries[0].data.minutes, minutes, `${text}: duration`);
    assert.equal(parser.needsAIEventInterpretation(text), false, `${text}: must not become generic life event`);
    passed += 4;
  }
}

for (const ml of [100, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000]) {
  for (const verb of ["喝水", "饮水", "补水"]) {
    const text = `今天${verb}${ml}毫升`;
    const result = parser.extract(text);
    assert.equal(result.entries.length, 1, `${text}: one water record`);
    assert.equal(result.entries[0].data.ml, ml, `${text}: water value`);
    assert.equal(parser.needsAIEventInterpretation(text), false, `${text}: deterministic water route`);
    passed += 3;
  }
}

for (const hours of [4, 5, 6, 6.5, 7, 7.5, 8, 9, 10]) {
  const text = `昨晚睡了${hours}小时`;
  const result = parser.extract(text);
  assert.equal(result.entries.length, 1, `${text}: one sleep record`);
  assert.equal(result.entries[0].type, "sleep", `${text}: sleep type`);
  assert.equal(result.entries[0].data.hours, hours, `${text}: sleep hours`);
  assert.equal(parser.needsAIEventInterpretation(text), false, `${text}: deterministic sleep route`);
  passed += 4;
}

let profile = profiles.defaults();
for (const key of ["diet", "sleep", "exercise", "finance", "tasks", "dailyLife"]) {
  for (const priority of ["high", "normal", "low", "off"]) {
    profile = profiles.applyPatch(profile, { priorities: { [key]: priority } });
    assert.equal(profile.priorities[key], priority, `${key}: ${priority}`);
    passed += 1;
  }
}
for (let index = 1; index <= 12; index += 1) {
  profile = profiles.applyPatch(profile, { customFocus: { id: `focus-${index}`, name: `自定义重点${index}`, priority: "high", signals: [`信号${index}`] } });
  assert.equal(profile.customFocuses.length, index);
  passed += 1;
}
profile = profiles.applyPatch(profile, { customFocus: { id: "focus-5", name: "自定义重点5", action: "remove" } });
assert.equal(profile.customFocuses.length, 11);
passed += 1;

const generatedEntries = [];
let expectedExpense = 0;
let expectedCalories = 0;
for (let day = 1; day <= 120; day += 1) {
  const date = `2026-${String(Math.floor((day - 1) / 28) + 1).padStart(2, "0")}-${String(((day - 1) % 28) + 1).padStart(2, "0")}`;
  const expense = day % 17 + 1;
  const refund = day % 10 === 0 ? 5 : 0;
  const calories = 500 + day;
  generatedEntries.push({ type: "expense", date, data: { amount: expense, direction: "out" } });
  generatedEntries.push({ type: "meal", date, data: { confirmed: true, calories } });
  generatedEntries.push({ type: "water", date, data: { ml: 1000 + day } });
  generatedEntries.push({ type: "sleep", date, data: { hours: 6 + day % 3 } });
  generatedEntries.push({ type: "life_event", date, data: { category: "学习", title: `阅读第${day}天` } });
  expectedExpense += expense;
  expectedCalories += calories;
  if (refund) {
    generatedEntries.push({ type: "expense", date, data: { amount: refund, direction: "in", subtype: "refund" } });
    expectedExpense -= refund;
  }
}
const trend = ops.trendMetrics(generatedEntries);
assert.equal(trend.expenseTotal, expectedExpense);
assert.equal(trend.meals.reduce((sum, entry) => sum + entry.data.calories, 0), expectedCalories);
assert.equal(trend.lifeEvents.length, 120);
assert.equal(trend.activeDays, 120);
assert.ok(trend.avgSleep >= 6 && trend.avgSleep <= 8);
assert.ok(trend.avgWater >= 1000 && trend.avgWater <= 1120);
passed += 6;

console.log(`PASS ${passed} stress-matrix assertions across daily records, profiles, and long-term aggregation`);
