(function initRecordOperations(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeiyuRecordOps = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function recordOperationsFactory() {
  "use strict";

  function dateKey(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function targetDate(dateOffset, referenceValue = new Date()) {
    if (dateOffset === null || dateOffset === undefined) return null;
    const value = new Date(referenceValue);
    value.setDate(value.getDate() + Number(dateOffset || 0));
    return dateKey(value);
  }

  function formatDateLabel(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "选择日期";
    return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
  }

  function typeMatches(entry, type) {
    if (!type) return true;
    if (type === "meal") return entry.type === "meal" || entry.type === "meal_draft" || entry.type === "meal_note";
    return entry.type === type;
  }

  function amountMatches(entry, amount) {
    if (amount === null || amount === undefined) return true;
    return entry.type === "expense" && Math.abs(Number(entry.data?.amount || 0) - Number(amount)) < .001;
  }

  function timestamp(entry) {
    const value = new Date(entry.occurredAt || entry.createdAt || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function deleteEntries(entries, request, referenceValue = new Date()) {
    const source = Array.isArray(entries) ? entries : [];
    if (!request || request.scope === "ambiguous") return { entries: [...source], removed: [], targetDate: null };
    const day = targetDate(request.dateOffset, referenceValue);
    const candidates = source.filter((entry) => (!day || entry.date === day) && typeMatches(entry, request.type) && amountMatches(entry, request.amount));

    let removed = [];
    if (request.scope === "day_all" || request.scope === "day_type_all") removed = candidates;
    else if (request.scope === "latest" && candidates.length) removed = [candidates.reduce((latest, entry) => timestamp(entry) >= timestamp(latest) ? entry : latest)];

    const removedIds = new Set(removed.map((entry) => entry.id));
    return { entries: source.filter((entry) => !removedIds.has(entry.id)), removed, targetDate: day };
  }

  function undoOperation(entries, tasks, operation = {}) {
    const createdEntryIds = new Set(Array.isArray(operation.createdEntryIds) ? operation.createdEntryIds : []);
    const createdTaskIds = new Set(Array.isArray(operation.createdTaskIds) ? operation.createdTaskIds : []);
    const restored = [
      ...(Array.isArray(operation.previousEntries) ? operation.previousEntries : []),
      ...(Array.isArray(operation.deletedEntries) ? operation.deletedEntries : [])
    ];
    const nextEntries = (Array.isArray(entries) ? entries : []).filter((entry) => !createdEntryIds.has(entry.id));
    for (const snapshot of restored) {
      if (!snapshot?.id) continue;
      const copy = JSON.parse(JSON.stringify(snapshot));
      const index = nextEntries.findIndex((entry) => entry.id === copy.id);
      if (index >= 0) nextEntries[index] = copy;
      else nextEntries.push(copy);
    }
    return {
      entries: nextEntries,
      tasks: (Array.isArray(tasks) ? tasks : []).filter((task) => !createdTaskIds.has(task.id))
    };
  }

  function sumEntries(entries, key) {
    return entries.reduce((sum, entry) => sum + Number(entry.data?.[key] || 0), 0);
  }

  function expenseValue(entry) {
    const raw = Number(entry?.data?.amount || 0);
    const amount = Math.abs(Number.isFinite(raw) ? raw : 0);
    return entry?.data?.direction === "in" || entry?.data?.subtype === "refund" || raw < 0 ? -amount : amount;
  }

  function expenseMetrics(entries) {
    const values = entries.map(expenseValue);
    return {
      expenseTotal: values.reduce((sum, value) => sum + value, 0),
      expenseOutflow: values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      refundTotal: Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)),
      expenseCount: values.filter((value) => value > 0).length,
      refundCount: values.filter((value) => value < 0).length
    };
  }

  function totalsByDay(entries, key) {
    const totals = new Map();
    entries.forEach((entry) => {
      const amount = Number(entry.data?.[key] || 0);
      if (!entry.date || amount <= 0) return;
      totals.set(entry.date, (totals.get(entry.date) || 0) + amount);
    });
    return totals;
  }

  function dayMetrics(entries) {
    const source = Array.isArray(entries) ? entries : [];
    const meals = source.filter((entry) => entry.type === "meal" && entry.data?.confirmed);
    const expenses = source.filter((entry) => entry.type === "expense");
    const waters = source.filter((entry) => entry.type === "water");
    const exercises = source.filter((entry) => entry.type === "exercise");
    const sleeps = source.filter((entry) => entry.type === "sleep");
    const money = expenseMetrics(expenses);
    return {
      calories: sumEntries(meals, "calories"), mealCount: meals.length,
      ...money,
      waterMl: sumEntries(waters, "ml"), waterCount: waters.length,
      exerciseMinutes: sumEntries(exercises, "minutes"), exerciseKm: sumEntries(exercises, "km"),
      exerciseSteps: sumEntries(exercises, "steps"), exerciseCount: exercises.length,
      sleepHours: sumEntries(sleeps, "hours"), sleepCount: sleeps.length
    };
  }

  function trendMetrics(entries) {
    const source = Array.isArray(entries) ? entries : [];
    const sleeps = source.filter((entry) => entry.type === "sleep");
    const exercises = source.filter((entry) => entry.type === "exercise");
    const waters = source.filter((entry) => entry.type === "water");
    const expenses = source.filter((entry) => entry.type === "expense");
    const meals = source.filter((entry) => entry.type === "meal" && entry.data?.confirmed);
    const lifeEvents = source.filter((entry) => entry.type === "life_event");
    const sleepByDay = totalsByDay(sleeps, "hours");
    const waterByDay = totalsByDay(waters, "ml");
    const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const tracked = [...sleeps, ...exercises, ...waters, ...expenses, ...meals, ...lifeEvents];
    const money = expenseMetrics(expenses);
    return {
      sleeps, exercises, waters, expenses, meals, lifeEvents, sleepByDay, waterByDay,
      avgSleep: average([...sleepByDay.values()]),
      avgWater: Math.round(average([...waterByDay.values()])),
      exerciseMinutes: sumEntries(exercises, "minutes"),
      exerciseSteps: sumEntries(exercises, "steps"),
      exerciseKm: sumEntries(exercises, "km"),
      ...money,
      activeDays: new Set(tracked.map((entry) => entry.date).filter(Boolean)).size,
      realEntryCount: tracked.length
    };
  }

  return { deleteEntries, undoOperation, targetDate, formatDateLabel, expenseValue, expenseMetrics, dayMetrics, trendMetrics };
});
