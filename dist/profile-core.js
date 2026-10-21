(function initProfileCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeiyuProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function profileCoreFactory() {
  "use strict";

  const PRIORITY_KEYS = ["diet", "sleep", "exercise", "finance", "tasks", "dailyLife"];
  const PRIORITIES = new Set(["high", "normal", "low", "off"]);

  function defaults() {
    return {
      priorities: { diet: "high", sleep: "normal", exercise: "normal", finance: "normal", tasks: "normal", dailyLife: "normal" },
      goals: { dietGoal: "健康、均衡饮食", sleepHours: null, waterMl: null, exercisePerWeek: null },
      assistantStyle: { verbosity: "short", tone: "gentle", proactivity: "patterns_only", maxSuggestions: 5, ordinaryRecordReply: "brief" },
      customInstructions: "",
      customFocuses: [],
      temporaryFocus: null
    };
  }

  function cleanText(value, limit) {
    return String(value || "").trim().slice(0, limit);
  }

  function finiteInRange(value, min, max) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function normalize(input) {
    const base = defaults();
    const source = input && typeof input === "object" ? input : {};
    for (const key of PRIORITY_KEYS) if (PRIORITIES.has(source.priorities?.[key])) base.priorities[key] = source.priorities[key];
    if (source.goals?.dietGoal !== undefined) base.goals.dietGoal = cleanText(source.goals.dietGoal, 120);
    base.goals.sleepHours = finiteInRange(source.goals?.sleepHours, 1, 24);
    base.goals.waterMl = finiteInRange(source.goals?.waterMl, 100, 10000);
    base.goals.exercisePerWeek = finiteInRange(source.goals?.exercisePerWeek, 0, 30);
    if (["short", "medium", "detailed"].includes(source.assistantStyle?.verbosity)) base.assistantStyle.verbosity = source.assistantStyle.verbosity;
    if (["gentle", "direct", "data_focused"].includes(source.assistantStyle?.tone)) base.assistantStyle.tone = source.assistantStyle.tone;
    if (["questions_only", "patterns_only", "proactive"].includes(source.assistantStyle?.proactivity)) base.assistantStyle.proactivity = source.assistantStyle.proactivity;
    base.assistantStyle.maxSuggestions = Math.round(finiteInRange(source.assistantStyle?.maxSuggestions, 1, 5) || base.assistantStyle.maxSuggestions);
    if (["silent", "brief"].includes(source.assistantStyle?.ordinaryRecordReply)) base.assistantStyle.ordinaryRecordReply = source.assistantStyle.ordinaryRecordReply;
    base.customInstructions = cleanText(source.customInstructions, 600);
    base.customFocuses = (Array.isArray(source.customFocuses) ? source.customFocuses : []).slice(0, 12).map((item, index) => {
      const safe = item && typeof item === "object" ? item : {};
      return {
        id: cleanText(safe.id, 40) || `custom-${index + 1}`,
        name: cleanText(safe.name, 30),
        priority: PRIORITIES.has(safe.priority) ? safe.priority : "high",
        signals: (Array.isArray(safe.signals) ? safe.signals : []).map((signal) => cleanText(signal, 40)).filter(Boolean).slice(0, 10),
        adviceMode: ["summary_only", "patterns_only", "proactive"].includes(safe.adviceMode) ? safe.adviceMode : "summary_only"
      };
    }).filter((item) => item.name);
    if (source.temporaryFocus?.text) base.temporaryFocus = { text: cleanText(source.temporaryFocus.text, 160), expiresAt: cleanText(source.temporaryFocus.expiresAt, 10) };
    return base;
  }

  function focusId(name) {
    const compact = cleanText(name, 30).toLowerCase().replace(/\s+/g, "-");
    return compact || `focus-${Date.now()}`;
  }

  function applyPatch(profile, patch) {
    if (patch?.reset === true) return defaults();
    const next = normalize(profile);
    const value = patch && typeof patch === "object" ? patch : {};
    for (const key of PRIORITY_KEYS) if (PRIORITIES.has(value.priorities?.[key])) next.priorities[key] = value.priorities[key];
    if (value.goals && typeof value.goals === "object") {
      if (value.goals.dietGoal !== undefined) next.goals.dietGoal = cleanText(value.goals.dietGoal, 120);
      for (const [key, min, max] of [["sleepHours", 1, 24], ["waterMl", 100, 10000], ["exercisePerWeek", 0, 30]]) {
        if (value.goals[key] === null) next.goals[key] = null;
        else if (value.goals[key] !== undefined) {
          const number = finiteInRange(value.goals[key], min, max);
          if (number !== null) next.goals[key] = number;
        }
      }
    }
    if (value.assistantStyle && typeof value.assistantStyle === "object") {
      const style = value.assistantStyle;
      if (["short", "medium", "detailed"].includes(style.verbosity)) next.assistantStyle.verbosity = style.verbosity;
      if (["gentle", "direct", "data_focused"].includes(style.tone)) next.assistantStyle.tone = style.tone;
      if (["questions_only", "patterns_only", "proactive"].includes(style.proactivity)) next.assistantStyle.proactivity = style.proactivity;
      if (["silent", "brief"].includes(style.ordinaryRecordReply)) next.assistantStyle.ordinaryRecordReply = style.ordinaryRecordReply;
      const maximum = finiteInRange(style.maxSuggestions, 1, 5);
      if (maximum !== null) next.assistantStyle.maxSuggestions = Math.round(maximum);
    }
    if (value.customInstructions !== undefined) next.customInstructions = cleanText(value.customInstructions, 600);
    const focus = value.customFocus;
    if (focus?.name) {
      const id = cleanText(focus.id, 40) || focusId(focus.name);
      const matches = (item) => item.id === id || item.name === cleanText(focus.name, 30);
      if (focus.action === "remove" || focus.priority === "off") next.customFocuses = next.customFocuses.filter((item) => !matches(item));
      else {
        const item = {
          id,
          name: cleanText(focus.name, 30),
          priority: PRIORITIES.has(focus.priority) ? focus.priority : "high",
          signals: (Array.isArray(focus.signals) ? focus.signals : []).map((signal) => cleanText(signal, 40)).filter(Boolean).slice(0, 10),
          adviceMode: ["summary_only", "patterns_only", "proactive"].includes(focus.adviceMode) ? focus.adviceMode : "summary_only"
        };
        const index = next.customFocuses.findIndex(matches);
        if (index >= 0) next.customFocuses[index] = { ...next.customFocuses[index], ...item };
        else next.customFocuses.push(item);
      }
    }
    if (value.temporaryFocus === null) next.temporaryFocus = null;
    else if (value.temporaryFocus?.text) next.temporaryFocus = { text: cleanText(value.temporaryFocus.text, 160), expiresAt: cleanText(value.temporaryFocus.expiresAt, 10) };
    return normalize(next);
  }

  function describePatch(patch) {
    if (patch?.reset === true) return ["恢复默认个性化设置"];
    const descriptions = [];
    const labels = { diet: "饮食", sleep: "睡眠", exercise: "运动", finance: "消费", tasks: "待办", dailyLife: "日常生活" };
    const priorityLabels = { high: "重点关注", normal: "正常关注", low: "低关注", off: "暂不关注" };
    for (const [key, value] of Object.entries(patch?.priorities || {})) if (labels[key] && priorityLabels[value]) descriptions.push(`${labels[key]}：${priorityLabels[value]}`);
    const goals = patch?.goals || {};
    if (goals.sleepHours !== undefined) descriptions.push(`睡眠目标：${goals.sleepHours === null ? "取消" : `${goals.sleepHours}小时`}`);
    if (goals.waterMl !== undefined) descriptions.push(`饮水目标：${goals.waterMl === null ? "取消" : `${goals.waterMl}ml`}`);
    if (goals.exercisePerWeek !== undefined) descriptions.push(`运动目标：${goals.exercisePerWeek === null ? "取消" : `每周${goals.exercisePerWeek}次`}`);
    if (goals.dietGoal !== undefined) descriptions.push(`饮食目标：${cleanText(goals.dietGoal, 120) || "取消"}`);
    const style = patch?.assistantStyle || {};
    if (style.maxSuggestions !== undefined) descriptions.push(`建议上限：${style.maxSuggestions}条`);
    if (style.verbosity) descriptions.push(`回复长度：${({ short: "简短", medium: "适中", detailed: "详细" })[style.verbosity]}`);
    if (style.tone) descriptions.push(`语气：${({ gentle: "温和", direct: "直接", data_focused: "数据化" })[style.tone]}`);
    if (style.proactivity) descriptions.push(`主动程度：${({ questions_only: "只回答问题", patterns_only: "发现连续模式时提醒", proactive: "积极分析" })[style.proactivity]}`);
    if (patch?.customFocus?.name) descriptions.push(`${patch.customFocus.action === "remove" || patch.customFocus.priority === "off" ? "取消关注" : "自定义关注"}：${cleanText(patch.customFocus.name, 30)}`);
    if (patch?.customInstructions !== undefined) descriptions.push(`补充说明：${cleanText(patch.customInstructions, 80) || "清空"}`);
    if (patch?.temporaryFocus === null) descriptions.push("清除临时重点");
    else if (patch?.temporaryFocus?.text) descriptions.push(`临时重点：${cleanText(patch.temporaryFocus.text, 80)}`);
    return descriptions.slice(0, 10);
  }

  function forAI(profile) {
    const value = normalize(profile);
    return {
      priorities: value.priorities,
      goals: value.goals,
      assistantStyle: value.assistantStyle,
      customInstructions: value.customInstructions,
      customFocuses: value.customFocuses,
      temporaryFocus: value.temporaryFocus
    };
  }

  return { defaults, normalize, applyPatch, describePatch, forAI };
});
