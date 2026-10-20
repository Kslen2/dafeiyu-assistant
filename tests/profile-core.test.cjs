const assert = require("node:assert/strict");
const profile = require("../dist/profile-core.js");

let passed = 0;

const base = profile.defaults();
assert.equal(base.priorities.diet, "high");
assert.equal(base.assistantStyle.maxSuggestions, 5);
assert.deepEqual(base.customFocuses, []);
passed += 3;

const changed = profile.applyPatch(base, {
  priorities: { sleep: "high", finance: "low" },
  goals: { sleepHours: 8, waterMl: 1800, exercisePerWeek: 4 },
  assistantStyle: { verbosity: "detailed", tone: "data_focused", maxSuggestions: 3 },
  customFocus: {
    id: "eye-care",
    name: "用眼健康",
    priority: "high",
    signals: ["连续屏幕时间", "眼睛干涩", "夜间用眼"],
    adviceMode: "patterns_only"
  }
});
assert.equal(changed.priorities.sleep, "high");
assert.equal(changed.priorities.finance, "low");
assert.equal(changed.goals.sleepHours, 8);
assert.equal(changed.goals.waterMl, 1800);
assert.equal(changed.goals.exercisePerWeek, 4);
assert.equal(changed.assistantStyle.verbosity, "detailed");
assert.equal(changed.assistantStyle.tone, "data_focused");
assert.equal(changed.assistantStyle.maxSuggestions, 3);
assert.equal(changed.customFocuses[0].name, "用眼健康");
passed += 9;

const updatedFocus = profile.applyPatch(changed, {
  customFocus: { id: "eye-care", name: "用眼健康", priority: "high", signals: ["每次用眼时长"], adviceMode: "proactive" },
  temporaryFocus: { text: "本周关注早睡", expiresAt: "2026-10-27" }
});
assert.equal(updatedFocus.customFocuses.length, 1, "same focus must be updated, not duplicated");
assert.deepEqual(updatedFocus.customFocuses[0].signals, ["每次用眼时长"]);
assert.equal(updatedFocus.temporaryFocus.text, "本周关注早睡");
passed += 3;

const removedFocus = profile.applyPatch(updatedFocus, { customFocus: { id: "eye-care", name: "用眼健康", action: "remove" } });
assert.equal(removedFocus.customFocuses.length, 0);
passed += 1;

const normalized = profile.normalize({
  priorities: { diet: "invalid", sleep: "off" },
  goals: { sleepHours: 40, waterMl: 50, exercisePerWeek: -2 },
  assistantStyle: { verbosity: "essay", maxSuggestions: 99 },
  customFocuses: [{ name: "肩颈", signals: ["酸痛"], priority: "high" }]
});
assert.equal(normalized.priorities.diet, "high");
assert.equal(normalized.priorities.sleep, "off");
assert.equal(normalized.goals.sleepHours, null);
assert.equal(normalized.goals.waterMl, null);
assert.equal(normalized.assistantStyle.verbosity, "short");
assert.equal(normalized.assistantStyle.maxSuggestions, 5);
assert.equal(normalized.customFocuses[0].name, "肩颈");
passed += 7;

const descriptions = profile.describePatch({
  priorities: { exercise: "high" },
  goals: { waterMl: 2000 },
  customFocus: { name: "用眼", priority: "high" }
});
assert.ok(descriptions.some((item) => item.includes("运动")));
assert.ok(descriptions.some((item) => item.includes("2000ml")));
assert.ok(descriptions.some((item) => item.includes("用眼")));
passed += 3;

const reset = profile.applyPatch(changed, { reset: true });
assert.deepEqual(reset, profile.defaults());
assert.deepEqual(profile.forAI(reset), reset);
passed += 2;

console.log(`PASS ${passed} personalized-profile scenarios`);
