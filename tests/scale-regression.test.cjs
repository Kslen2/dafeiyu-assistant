const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const parser = require("../dist/record-parser.js");
const ops = require("../dist/record-operations.js");

let passed = 0;
const checkEqual = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  passed += 1;
};
const checkOk = (value, message) => {
  assert.ok(value, message);
  passed += 1;
};

function clock(hour, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sleepHours(startHour, endHour) {
  let minutes = endHour * 60 - startHour * 60;
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round(minutes / 6) / 10;
}

for (const startHour of [0, 1, 2, 21, 22, 23]) {
  for (const endHour of [6, 7, 8, 9, 10]) {
    const expectedHours = sleepHours(startHour, endHour);
    for (const text of [
      `今日睡眠${startHour}:00到${endHour}:00`,
      `记今天 ${startHour}:00 到 ${endHour}:00 的睡眠`
    ]) {
      const result = parser.extract(text);
      checkEqual(result.entries.length, 1, `${text}: one record`);
      checkEqual(result.entries[0].type, "sleep", `${text}: sleep type`);
      checkEqual(result.entries[0].data.hours, expectedHours, `${text}: duration`);
      checkEqual(result.entries[0].data.bedTime, clock(startHour), `${text}: bed time`);
      checkEqual(result.entries[0].data.wakeTime, clock(endHour), `${text}: wake time`);
      checkEqual(parser.isStructuredRecordRequest(text), true, `${text}: deterministic route`);
      checkEqual(parser.needsAIEventInterpretation(text), false, `${text}: no AI mutation route`);
    }
  }
}

const entries = [];
let expectedOutflow = 0;
let expectedRefunds = 0;
let expectedCalories = 0;
let expectedWater = 0;
let expectedExercise = 0;
let expectedSleep = 0;
for (let day = 0; day < 365; day += 1) {
  const date = new Date(2025, 0, 1 + day);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const outflow = 10 + day % 91;
  const refund = day % 13 === 0 ? 6.5 : 0;
  const calories = 420 + day % 380;
  const water = 800 + day % 1600;
  const exercise = day % 75;
  const sleep = 5 + (day % 35) / 10;
  entries.push({ id: `expense-${day}`, type: "expense", date: dateKey, occurredAt: `${dateKey}T12:00:00`, data: { amount: outflow, direction: "out", category: "餐饮" }, source: "manual" });
  entries.push({ id: `meal-${day}`, type: "meal", date: dateKey, occurredAt: `${dateKey}T12:10:00`, data: { confirmed: true, calories, protein: 30, carbs: 60, fat: 20 }, source: "manual" });
  entries.push({ id: `water-${day}`, type: "water", date: dateKey, occurredAt: `${dateKey}T14:00:00`, data: { ml: water }, source: "manual" });
  entries.push({ id: `exercise-${day}`, type: "exercise", date: dateKey, occurredAt: `${dateKey}T18:00:00`, data: { activity: "走路", minutes: exercise }, source: "manual" });
  entries.push({ id: `sleep-${day}`, type: "sleep", date: dateKey, occurredAt: `${dateKey}T08:00:00`, data: { hours: sleep }, source: "manual" });
  entries.push({ id: `event-${day}`, type: "life_event", date: dateKey, occurredAt: `${dateKey}T20:00:00`, data: { title: "阅读", category: "学习", durationMinutes: 30 }, source: "manual" });
  if (refund) entries.push({ id: `refund-${day}`, type: "expense", date: dateKey, occurredAt: `${dateKey}T16:00:00`, data: { amount: refund, direction: "in", subtype: "refund", category: "餐饮" }, source: "manual" });
  expectedOutflow += outflow;
  expectedRefunds += refund;
  expectedCalories += calories;
  expectedWater += water;
  expectedExercise += exercise;
  expectedSleep += sleep;
}

const trend = ops.trendMetrics(entries);
checkEqual(trend.expenseOutflow, expectedOutflow, "365-day outflow");
checkEqual(trend.refundTotal, expectedRefunds, "365-day refunds");
checkEqual(trend.expenseTotal, expectedOutflow - expectedRefunds, "365-day net expense");
checkEqual(trend.meals.reduce((sum, entry) => sum + entry.data.calories, 0), expectedCalories, "365-day calories");
checkEqual(trend.waters.reduce((sum, entry) => sum + entry.data.ml, 0), expectedWater, "365-day water");
checkEqual(trend.exerciseMinutes, expectedExercise, "365-day exercise");
checkEqual(Math.round([...trend.sleepByDay.values()].reduce((sum, value) => sum + value, 0) * 10) / 10, Math.round(expectedSleep * 10) / 10, "365-day sleep");
checkEqual(trend.lifeEvents.length, 365, "365-day life events");
checkEqual(trend.activeDays, 365, "365 active days");

for (let day = 0; day < 365; day += 17) {
  const date = new Date(2025, 0, 1 + day);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const daily = entries.filter((entry) => entry.date === dateKey);
  const metrics = ops.dayMetrics(daily);
  checkEqual(metrics.mealCount, 1, `${dateKey}: confirmed manual meal`);
  checkEqual(metrics.waterCount, 1, `${dateKey}: manual water`);
  checkEqual(metrics.exerciseCount, 1, `${dateKey}: manual exercise`);
  checkEqual(metrics.sleepCount, 1, `${dateKey}: manual sleep`);
  checkEqual(metrics.expenseCount, 1, `${dateKey}: manual expense`);
}

for (let index = 0; index < 120; index += 1) {
  const dateOffset = -(index % 7);
  const reference = new Date(2025, 11, 31, 20, 0, index % 60);
  const date = new Date(reference);
  date.setDate(date.getDate() + dateOffset);
  const target = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sample = [
    { id: `old-${index}`, type: "water", date: target, occurredAt: `${target}T09:00:00`, data: { ml: 100 } },
    { id: `new-${index}`, type: "water", date: target, occurredAt: `${target}T11:00:00`, data: { ml: 200 } },
    { id: `keep-${index}`, type: "expense", date: target, occurredAt: `${target}T12:00:00`, data: { amount: 10 } }
  ];
  const result = ops.deleteEntries(sample, { scope: "latest", type: "water", dateOffset, amount: null }, reference);
  checkEqual(result.removed.length, 1, `delete matrix ${index}: one removed`);
  checkEqual(result.removed[0].id, `new-${index}`, `delete matrix ${index}: newest removed`);
  checkEqual(result.entries.some((entry) => entry.id === `keep-${index}`), true, `delete matrix ${index}: unrelated kept`);
}

for (let index = 0; index < 500; index += 1) {
  const original = { id: `base-${index}`, type: "water", date: "2026-10-20", data: { ml: 100 + index } };
  const changed = { ...original, data: { ml: 500 + index } };
  const created = { id: `created-${index}`, type: "expense", date: "2026-10-20", data: { amount: index + 1 } };
  const undone = ops.undoOperation([changed, created], [{ id: `task-${index}` }], {
    createdEntryIds: [created.id],
    createdTaskIds: [`task-${index}`],
    previousEntries: [original]
  });
  checkEqual(undone.entries.length, 1, `undo ${index}: created entry removed`);
  checkEqual(undone.entries[0].data.ml, 100 + index, `undo ${index}: previous entry restored`);
  checkEqual(undone.tasks.length, 0, `undo ${index}: created task removed`);
}

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "dist", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
checkOk(/source:\s*"manual"/.test(app), "manual entries have an explicit source");
checkOk(/next\.confirmed\s*=\s*true/.test(app), "manual meals enter confirmed statistics");
checkOk(/leaveDemoMode\(\)[\s\S]{0,400}state\.entries\.push/.test(app), "manual creation exits demo mode before persistence");
checkOk(/renderAll\(\)[\s\S]{0,100}记录已添加/.test(app), "manual creation refreshes every view");
checkOk(/type:\s*"operation"/.test(app), "database mutations render operation receipts");
checkOk(/data-undo-operation/.test(app), "operation receipts expose one-tap undo");
checkOk(/FeiyuRecordOps\.undoOperation/.test(app), "undo uses the tested deterministic operation engine");
for (const type of ["note", "meal", "expense", "water", "exercise", "sleep", "life_event"]) {
  checkOk(new RegExp(`option value=["']${type}["']`).test(html), `manual type option: ${type}`);
}

console.log(`PASS ${passed} scale-regression assertions across sleep language, 365-day manual data, deletion, and UI persistence contracts`);
