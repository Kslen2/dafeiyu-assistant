(function initMealModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeiyuMeal = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function mealModelFactory() {
  "use strict";

  const MAX_ITEMS = 16;
  const MACRO_FIELDS = ["calories", "protein", "carbs", "fat"];
  const LIMITS = { calories: 10000, protein: 1000, carbs: 2000, fat: 1000 };

  function numberValue(value, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(number, maximum);
  }

  function roundTotal(value) {
    return Math.round(Number(value) || 0);
  }

  function roundMacro(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function normalizeItems(items) {
    const list = Array.isArray(items) ? items : [];
    return list.map((item, index) => ({
      id: String(item?.id || `item-${index + 1}`),
      name: String(item?.name || "").trim().slice(0, 60),
      amount: String(item?.amount || "").trim().slice(0, 40),
      calories: roundTotal(numberValue(item?.calories, LIMITS.calories)),
      protein: roundMacro(numberValue(item?.protein, LIMITS.protein)),
      carbs: roundMacro(numberValue(item?.carbs, LIMITS.carbs)),
      fat: roundMacro(numberValue(item?.fat, LIMITS.fat)),
      source: ["ai", "user", "legacy"].includes(item?.source) ? item.source : "ai"
    })).filter((item) => item.name).slice(0, MAX_ITEMS);
  }

  function totals(items) {
    const list = Array.isArray(items) ? items : [];
    const sum = (key) => list.reduce((total, item) => total + Number(item?.[key] || 0), 0);
    return {
      calories: roundTotal(sum("calories")),
      protein: roundMacro(sum("protein")),
      carbs: roundMacro(sum("carbs")),
      fat: roundMacro(sum("fat"))
    };
  }

  function itemLabel(item) {
    return [item?.name, item?.amount].filter(Boolean).join(" · ");
  }

  function itemsFromMeal(meal) {
    if (!meal || meal.isFood === false) return [];
    const sourceItems = normalizeItems(meal.items);
    if (sourceItems.length) return sourceItems;
    const name = String(meal.name || "").trim();
    if (!name && !MACRO_FIELDS.some((key) => Number(meal[key]) > 0)) return [];
    return normalizeItems([{
      id: "item-1",
      name: name || "本次饮食",
      amount: Array.isArray(meal.foods) && meal.foods.length ? String(meal.foods[0]).slice(0, 40) : "",
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      source: "ai"
    }]);
  }

  function totalsFromData(data = {}) {
    return {
      calories: roundTotal(numberValue(data.calories, LIMITS.calories)),
      protein: roundMacro(numberValue(data.protein, LIMITS.protein)),
      carbs: roundMacro(numberValue(data.carbs, LIMITS.carbs)),
      fat: roundMacro(numberValue(data.fat, LIMITS.fat))
    };
  }

  function view(entry) {
    const data = entry?.data || {};
    const items = normalizeItems(data.items);
    const computed = items.length ? totals(items) : totalsFromData(data);
    return {
      type: entry?.type === "meal" ? "meal" : "draft",
      name: String(data.name || "").trim() || (items.length === 1 ? items[0].name : "本次饮食"),
      items,
      foods: Array.isArray(data.foods) ? data.foods.filter(Boolean).slice(0, 12) : [],
      totals: computed,
      note: String(data.note || ""),
      description: String(data.description || entry?.sourceText || ""),
      sourceType: data.sourceType || "legacy",
      status: data.status || (data.awaitingClarification ? "clarify" : "ready"),
      awaitingClarification: Boolean(data.awaitingClarification),
      corrections: Array.isArray(data.corrections) ? data.corrections.filter(Boolean) : [],
      isFood: data.isFood !== false,
      manuallyEdited: Boolean(data.manuallyEdited),
      confirmed: entry?.type === "meal" && data.confirmed !== false
    };
  }

  function mealMeta(meal, meta = {}) {
    return {
      description: String(meta.description ?? "").trim().slice(0, 500),
      sourceType: meta.sourceType || "text",
      corrections: Array.isArray(meta.corrections) ? meta.corrections.filter(Boolean).slice(0, 20) : [],
      meal
    };
  }

  function dataFromMeal(meal, meta = {}) {
    const items = itemsFromMeal(meal);
    const computed = totals(items);
    return {
      description: String(meta.description || "").trim().slice(0, 500),
      sourceType: meta.sourceType || "text",
      name: String(meal?.name || "").slice(0, 80),
      isFood: meal?.isFood !== false,
      items,
      foods: Array.isArray(meal?.foods) ? meal.foods.map(String).filter(Boolean).slice(0, 12) : items.map(itemLabel),
      note: String(meal?.note || "").slice(0, 500),
      uncertainties: Array.isArray(meal?.uncertainties) ? meal.uncertainties.filter(Boolean).slice(0, 8) : [],
      status: meal?.needsClarification ? "clarify" : "ready",
      awaitingClarification: Boolean(meal?.needsClarification),
      corrections: Array.isArray(meta.corrections) ? meta.corrections.filter(Boolean).slice(0, 20) : [],
      ...computed
    };
  }

  function applyMeal(entry, meal, meta = {}) {
    const data = dataFromMeal(meal, meta);
    entry.data = {
      ...entry.data,
      ...data,
      updatedAt: new Date().toISOString()
    };
    return entry;
  }

  function applyItems(entry, items, meta = {}) {
    const normalized = normalizeItems(items);
    if (!normalized.length) throw new Error("请至少填写一项食材");
    const computed = totals(normalized);
    entry.data = {
      ...entry.data,
      items: normalized,
      name: String(meta.name || entry.data?.name || "").trim().slice(0, 80) || (normalized.length === 1 ? normalized[0].name : normalized.slice(0, 2).map((item) => item.name).join("、")),
      note: meta.note === undefined ? entry.data?.note || "" : String(meta.note).slice(0, 500),
      status: entry.type === "meal" ? "confirmed" : "ready",
      awaitingClarification: false,
      manuallyEdited: true,
      corrections: Array.isArray(meta.corrections) ? meta.corrections.filter(Boolean).slice(0, 20) : entry.data?.corrections || [],
      updatedAt: new Date().toISOString(),
      ...computed
    };
    return entry;
  }

  function scaleItems(items, fromTotals, toTotals) {
    const list = normalizeItems(items);
    if (!list.length) return list;
    const from = totalsFromData(fromTotals);
    const to = totalsFromData(toTotals);
    const scaled = list.map((item) => {
      const next = { ...item };
      for (const key of MACRO_FIELDS) {
        const base = Number(from[key]) || 0;
        const target = Number(to[key]) || 0;
        const rounding = key === "calories" ? roundTotal : roundMacro;
        next[key] = base > 0 ? rounding(Number(item[key] || 0) * target / base) : (list.length === 1 ? rounding(target) : rounding(Number(item[key] || 0)));
      }
      return next;
    });
    // 舍入后可能差一两克，把差额补到第一项，保证合计与用户修改的总数一致。
    const actual = totals(scaled);
    for (const key of MACRO_FIELDS) {
      const difference = Number(to[key]) - Number(actual[key]);
      if (Math.abs(difference) < 0.001) continue;
      scaled[0][key] = (key === "calories" ? roundTotal : roundMacro)(Number(scaled[0][key]) + difference);
    }
    return normalizeItems(scaled);
  }

  function localDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function draftFromLegacyMessage(message) {
    const meal = message?.meal || {};
    const at = message?.mealRecordedAt || message?.createdAt || new Date().toISOString();
    return {
      id: String(message?.draftId || `draft-${message?.id || Date.now()}`),
      type: "meal_draft",
      date: localDateKey(at),
      createdAt: at,
      occurredAt: at,
      timeSource: "message",
      timeText: "",
      data: {
        ...dataFromMeal(meal, { description: message.recordedText || "", sourceType: "legacy" }),
        status: message?.confirmed ? "confirmed" : "ready"
      },
      sourceText: message?.recordedText || ""
    };
  }

  function migrate(entries, messages) {
    let changed = 0;
    const resultEntries = [];
    (Array.isArray(entries) ? entries : []).forEach((source) => {
      let entry = { ...source, data: { ...(source?.data || {}) } };
      if (entry.type === "meal_note") {
        entry.type = "meal_draft";
        entry.data = {
          ...entry.data,
          description: String(entry.data.description || entry.sourceText || ""),
          sourceType: entry.data.sourceType || "text",
          items: normalizeItems(entry.data.items),
          status: entry.data.status || (entry.data.analyzed ? "ready" : "clarify"),
          awaitingClarification: Boolean(entry.data.awaitingClarification),
          corrections: Array.isArray(entry.data.corrections) ? entry.data.corrections : []
        };
        delete entry.data.analyzed;
        changed += 1;
      }
      if (entry.type === "meal") {
        const items = normalizeItems(entry.data.items);
        if (!items.length) {
          const totalsValue = totalsFromData(entry.data);
          const hasAny = totalsValue.calories || totalsValue.protein || totalsValue.carbs || totalsValue.fat || entry.data.name;
          if (hasAny) {
            items.push(...normalizeItems([{
              id: "legacy-1",
              name: entry.data.name || "本次饮食",
              amount: "整餐",
              ...totalsValue,
              source: "legacy"
            }]));
            changed += 1;
          }
        }
        const computed = items.length ? totals(items) : totalsFromData(entry.data);
        entry.data = {
          ...entry.data,
          items,
          foods: Array.isArray(entry.data.foods) ? entry.data.foods : items.map(itemLabel),
          status: "confirmed",
          confirmed: entry.data.confirmed !== false,
          sourceType: entry.data.sourceType || "legacy",
          ...computed
        };
      }
      if (entry.type === "meal_draft") {
        const items = normalizeItems(entry.data.items);
        const computed = items.length ? totals(items) : totalsFromData(entry.data);
        entry.data = {
          ...entry.data,
          items,
          status: entry.data.status || (entry.data.awaitingClarification ? "clarify" : "ready"),
          awaitingClarification: Boolean(entry.data.awaitingClarification),
          corrections: Array.isArray(entry.data.corrections) ? entry.data.corrections : [],
          ...computed
        };
      }
      resultEntries.push(entry);
    });

    const entryById = new Map(resultEntries.map((entry) => [entry.id, entry]));
    const resultMessages = (Array.isArray(messages) ? messages : []).map((source) => {
      if (source?.type !== "meal") return source;
      const message = { ...source };
      if (message.draftId && !entryById.has(message.draftId)) delete message.draftId;
      if (!message.draftId && message.sourceEntryId && entryById.has(message.sourceEntryId)) {
        message.draftId = message.sourceEntryId;
        changed += 1;
      }
      if (!message.draftId && message.meal && !message.deletedRecord) {
        if (message.meal.isFood === false) return message;
        if (message.superseded) return message;
        if (message.confirmed) {
          const entry = { ...draftFromLegacyMessage(message), type: "meal" };
          Object.assign(entry.data, { confirmed: true, status: "confirmed" });
          entryById.set(entry.id, entry);
          resultEntries.push(entry);
          message.draftId = entry.id;
          changed += 1;
        } else {
          const entry = draftFromLegacyMessage(message);
          entryById.set(entry.id, entry);
          resultEntries.push(entry);
          message.draftId = entry.id;
          changed += 1;
        }
      }
      if (message.draftId) {
        const entry = entryById.get(message.draftId);
        if (entry?.type === "meal_draft" && !entry.data.items.length && message.meal && !entry.data.awaitingClarification) {
          Object.assign(entry.data, dataFromMeal(message.meal, {
            description: entry.data.description || message.recordedText || "",
            sourceType: entry.data.sourceType || "legacy"
          }));
          changed += 1;
        }
        if (entry?.type === "meal" && !message.confirmed) {
          message.confirmed = true;
          changed += 1;
        }
        if (entry?.type === "meal_draft" && message.confirmed) {
          message.confirmed = false;
          changed += 1;
        }
      }
      return message;
    });

    return { entries: resultEntries, messages: resultMessages, changed };
  }

  function isMealType(type) {
    return type === "meal" || type === "meal_draft";
  }

  return Object.freeze({
    MAX_ITEMS,
    MACRO_FIELDS,
    normalizeItems,
    totals,
    totalsFromData,
    itemLabel,
    itemsFromMeal,
    dataFromMeal,
    view,
    applyMeal,
    applyItems,
    scaleItems,
    draftFromLegacyMessage,
    migrate,
    isMealType
  });
});
