const assert = require("node:assert/strict");
const meal = require("../dist/meal-model.js");

let passed = 0;

const items = meal.normalizeItems([
  { name: "牛肉", amount: "150克", calories: 250, protein: 26, carbs: 0, fat: 16, source: "ai" },
  { name: "煎蛋", amount: "一个", calories: 90, protein: 7, carbs: 1, fat: 6 },
  { name: "", amount: "空行应该被丢弃", calories: 999 }
]);
assert.equal(items.length, 2, "empty item is dropped");
assert.equal(items[0].id, "item-1", "missing item id is filled");
assert.equal(items[1].calories, 90);
assert.equal(meal.totals(items).calories, 340);
assert.equal(meal.totals(items).fat, 22);
passed += 4;

const view = meal.view({
  type: "meal_draft",
  data: {
    name: "牛肉蔬菜泡面",
    items,
    note: "粗略估算",
    description: "牛肉150克，一个煎蛋",
    sourceType: "text",
    status: "ready"
  }
});
assert.equal(view.type, "draft");
assert.equal(view.totals.calories, 340);
assert.equal(view.items.length, 2);
assert.equal(view.confirmed, false);
passed += 4;

const legacy = meal.view({
  type: "meal",
  data: { name: "午餐", calories: 680, protein: 34, carbs: 82, fat: 24, confirmed: true }
});
assert.equal(legacy.totals.calories, 680, "legacy totals survive without items");
assert.equal(legacy.confirmed, true);
passed += 2;

const draftEntry = { type: "meal_draft", data: { description: "晚饭" } };
meal.applyMeal(draftEntry, {
  isFood: true,
  name: "猪肉白菜面",
  calories: 680,
  protein: 34,
  carbs: 82,
  fat: 24,
  foods: ["猪排约120克", "面条约200克"],
  note: "估算"
}, { description: "这是今天的晚饭", sourceType: "photo" });
assert.equal(draftEntry.data.items.length, 1, "meal without items becomes one aggregate item");
assert.equal(draftEntry.data.items[0].calories, 680);
assert.equal(draftEntry.data.calories, 680);
assert.equal(draftEntry.data.sourceType, "photo");
passed += 4;

const itemizedEntry = { type: "meal_draft", data: {} };
meal.applyMeal(itemizedEntry, {
  isFood: true,
  name: "牛肉蔬菜泡面",
  calories: 850,
  protein: 52,
  carbs: 96,
  fat: 37,
  items: [
    { name: "牛肉", amount: "150克", calories: 250, protein: 26, carbs: 0, fat: 16 },
    { name: "泡面", amount: "一包", calories: 500, protein: 20, carbs: 90, fat: 18 },
    { name: "煎蛋", amount: "一个", calories: 100, protein: 6, carbs: 6, fat: 3 }
  ]
}, { description: "牛肉150克，一包泡面，一个煎蛋" });
assert.equal(itemizedEntry.data.items.length, 3);
assert.equal(itemizedEntry.data.calories, 850, "totals are re-summed from items");
assert.equal(itemizedEntry.data.protein, 52);
passed += 3;

meal.applyItems(itemizedEntry, [
  { name: "牛肉", amount: "100克", calories: 170, protein: 18, carbs: 0, fat: 11 },
  { name: "泡面", amount: "半包", calories: 250, protein: 10, carbs: 45, fat: 9 }
], { name: "牛肉半包泡面" });
assert.equal(itemizedEntry.data.items.length, 2);
assert.equal(itemizedEntry.data.calories, 420);
assert.equal(itemizedEntry.data.name, "牛肉半包泡面");
assert.equal(itemizedEntry.data.status, "ready");
passed += 4;

const scaled = meal.scaleItems(itemizedEntry.data.items, meal.totals(itemizedEntry.data.items), { calories: 420, protein: 28, carbs: 45, fat: 20 });
assert.equal(meal.totals(scaled).calories, 420);
assert.equal(meal.totals(scaled).fat, 20);
passed += 2;

// 旧数据迁移：旧待确认卡、旧已确认餐食、旧 meal_note、旧更新卡
const messages = [
  {
    id: "m1", role: "assistant", type: "meal", createdAt: "2026-10-21T20:16:00+08:00",
    meal: { isFood: true, name: "猪肉白菜海带拌面", calories: 680, protein: 34, carbs: 82, fat: 24, foods: ["猪排约120克", "面条约200克"], note: "粗略估算" },
    confirmed: false, sourceEntryId: null, recordedText: "这是今天的晚饭"
  },
  {
    id: "m2", role: "assistant", type: "meal", createdAt: "2026-10-20T12:00:00+08:00",
    meal: { isFood: true, name: "午饭", calories: 700, protein: 30, carbs: 90, fat: 22 },
    confirmed: true, sourceEntryId: "old-meal"
  },
  {
    id: "m3", role: "assistant", type: "meal", createdAt: "2026-10-21T20:20:00+08:00",
    meal: { isFood: true, name: "旧版修正卡", calories: 850, protein: 52, carbs: 96, fat: 37 },
    confirmed: false, superseded: true
  }
];
const migrated = meal.migrate([
  { id: "old-meal", type: "meal", date: "2026-10-20", createdAt: "2026-10-20T12:00:00+08:00", data: { name: "午饭", calories: 700, protein: 30, carbs: 90, fat: 22, confirmed: true } },
  { id: "old-note", type: "meal_note", date: "2026-10-21", createdAt: "2026-10-21T20:18:00+08:00", data: { description: "这是我的晚饭", analyzed: false }, sourceText: "这是我的晚饭" }
], messages);

assert.equal(migrated.entries.find((entry) => entry.id === "old-meal").data.items.length, 1, "confirmed meal gets an aggregate item");
assert.equal(migrated.entries.find((entry) => entry.id === "old-meal").data.calories, 700);
const noteDraft = migrated.entries.find((entry) => entry.id === "old-note");
assert.equal(noteDraft.type, "meal_draft", "meal_note becomes a draft");
assert.equal(noteDraft.data.status, "clarify");
const createdDraft = migrated.entries.find((entry) => entry.id === "draft-m1");
assert.ok(createdDraft, "pending legacy card gets a draft");
assert.equal(createdDraft.type, "meal_draft");
assert.equal(createdDraft.data.calories, 680);
assert.equal(createdDraft.data.items.length, 1);
assert.equal(migrated.messages.find((message) => message.id === "m1").draftId, "draft-m1");
assert.equal(migrated.messages.find((message) => message.id === "m2").draftId, "old-meal");
assert.equal(migrated.messages.find((message) => message.id === "m3").draftId, undefined, "superseded card stays historical");
passed += 8;

const secondPass = meal.migrate(migrated.entries, migrated.messages);
assert.equal(secondPass.changed, 0, "migration is idempotent");
assert.equal(secondPass.entries.length, migrated.entries.length);
passed += 2;

console.log(`PASS ${passed} meal model assertions`);
