const assert = require("node:assert/strict");
const ops = require("../dist/record-operations.js");

const reference = new Date(2026, 9, 19, 20, 0, 0);
const entries = [
  { id: "meal", type: "meal", date: "2026-10-19", createdAt: "2026-10-19T12:00:00+08:00", data: { confirmed: true, calories: 650 } },
  { id: "expense-23", type: "expense", date: "2026-10-19", createdAt: "2026-10-19T12:01:00+08:00", data: { amount: 23 } },
  { id: "expense-8", type: "expense", date: "2026-10-19", createdAt: "2026-10-19T18:00:00+08:00", data: { amount: 8 } },
  { id: "water", type: "water", date: "2026-10-19", createdAt: "2026-10-19T19:00:00+08:00", data: { ml: 250 } },
  { id: "sleep-yesterday", type: "sleep", date: "2026-10-18", createdAt: "2026-10-18T08:00:00+08:00", data: { hours: 7 } }
];

let result = ops.deleteEntries(entries, { scope: "day_all", type: null, dateOffset: 0, amount: null }, reference);
assert.deepEqual(result.removed.map((entry) => entry.id), ["meal", "expense-23", "expense-8", "water"]);
assert.deepEqual(result.entries.map((entry) => entry.id), ["sleep-yesterday"]);

result = ops.deleteEntries(entries, { scope: "latest", type: "expense", dateOffset: 0, amount: 23 }, reference);
assert.deepEqual(result.removed.map((entry) => entry.id), ["expense-23"]);
assert.equal(result.entries.length, 4);

result = ops.deleteEntries(entries, { scope: "latest", type: "water", dateOffset: null, amount: null }, reference);
assert.deepEqual(result.removed.map((entry) => entry.id), ["water"]);

result = ops.deleteEntries(entries, { scope: "day_type_all", type: "sleep", dateOffset: -1, amount: null }, reference);
assert.deepEqual(result.removed.map((entry) => entry.id), ["sleep-yesterday"]);

result = ops.deleteEntries(entries, { scope: "latest", type: "expense", dateOffset: 0, amount: 999 }, reference);
assert.equal(result.removed.length, 0);
assert.equal(result.entries.length, entries.length);

let undone = ops.undoOperation(
  [{ id: "existing", type: "water", data: { ml: 200 } }, { id: "created", type: "expense", data: { amount: 10 } }],
  [{ id: "keep-task" }, { id: "created-task" }],
  {
    createdEntryIds: ["created"],
    createdTaskIds: ["created-task"],
    previousEntries: [{ id: "existing", type: "water", data: { ml: 100 } }],
    deletedEntries: [{ id: "restored", type: "sleep", data: { hours: 7 } }]
  }
);
assert.deepEqual(undone.entries.map((entry) => entry.id).sort(), ["existing", "restored"]);
assert.equal(undone.entries.find((entry) => entry.id === "existing").data.ml, 100);
assert.deepEqual(undone.tasks.map((task) => task.id), ["keep-task"]);

assert.equal(ops.formatDateLabel("2026-10-19"), "2026年10月19日");
assert.equal(ops.formatDateLabel(""), "选择日期");

const lifestyleEntries = [
  { type: "sleep", date: "2026-10-19", data: { hours: 7 } },
  { type: "sleep", date: "2026-10-19", data: { hours: 0.5 } },
  { type: "sleep", date: "2026-10-18", data: { hours: 8 } },
  { type: "sleep", date: "2026-10-17", data: { quality: "不错" } },
  { type: "exercise", date: "2026-10-19", data: { activity: "跑步", minutes: 30, km: 5 } },
  { type: "exercise", date: "2026-10-19", data: { activity: "走路", steps: 6000 } },
  { type: "water", date: "2026-10-19", data: { ml: 500 } },
  { type: "water", date: "2026-10-18", data: { ml: 1500 } },
  { type: "expense", date: "2026-10-19", data: { amount: 23 } },
  { type: "expense", date: "2026-10-19", data: { amount: 10, direction: "in", subtype: "refund" } },
  { type: "meal", date: "2026-10-19", data: { confirmed: true, calories: 650 } },
  { type: "meal", date: "2026-10-19", data: { confirmed: false, calories: 300 } },
  { type: "life_event", date: "2026-10-19", data: { category: "家务", title: "整理房间", durationMinutes: 40 } }
];
const day = ops.dayMetrics(lifestyleEntries.filter((entry) => entry.date === "2026-10-19"));
assert.deepEqual(day, {
  calories: 650, mealCount: 1,
  expenseTotal: 13, expenseOutflow: 23, refundTotal: 10, expenseCount: 1, refundCount: 1,
  waterMl: 500, waterCount: 1,
  exerciseMinutes: 30, exerciseKm: 5, exerciseSteps: 6000, exerciseCount: 2,
  sleepHours: 7.5, sleepCount: 2
});

const trend = ops.trendMetrics(lifestyleEntries);
assert.equal(trend.avgSleep, 7.75, "sleep trend averages daily totals, not individual sleep entries");
assert.equal(trend.avgWater, 1000);
assert.equal(trend.exerciseMinutes, 30);
assert.equal(trend.exerciseSteps, 6000);
assert.equal(trend.expenseTotal, 13);
assert.equal(trend.expenseOutflow, 23);
assert.equal(trend.refundTotal, 10);
assert.equal(ops.expenseValue({ type: "expense", data: { amount: 24.9, direction: "in" } }), -24.9);
assert.equal(trend.meals.length, 1, "only confirmed meals enter trends");
assert.equal(trend.lifeEvents.length, 1, "universal daily-life events enter trend context");
assert.equal(trend.activeDays, 3);
assert.equal(trend.realEntryCount, 12, "unconfirmed meals are excluded while life events are included");

console.log("PASS record deletion and lifestyle aggregation operations");
