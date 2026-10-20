const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const vm = require("node:vm");

const memory = new Map();
const sandbox = {
  window: {},
  document: { documentElement: { dataset: {} } },
  localStorage: {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key)
  },
  fetch,
  console
};
const source = fs.readFileSync(path.join(__dirname, "..", "dist", "assistant-core.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "assistant-core.js" });

const entries = [
  { type: "sleep", date: "2026-10-17", occurredAt: "2026-10-17T23:30:00+08:00", timeSource: "explicit", data: { hours: 6.5, bedTime: "23:30", wakeTime: "06:00" } },
  { type: "sleep", date: "2026-10-18", occurredAt: "2026-10-18T07:00:00+08:00", timeSource: "explicit", data: { hours: 7.5, bedTime: "23:30", wakeTime: "07:00", quality: "不错" } },
  { type: "sleep", date: "2026-10-19", occurredAt: "2026-10-19T07:00:00+08:00", timeSource: "explicit", data: { hours: 8, bedTime: "23:00", wakeTime: "07:00" } },
  { type: "meal", date: "2026-10-19", occurredAt: "2026-10-19T12:20:00+08:00", timeSource: "explicit", data: { name: "牛肉米粉", calories: 650, protein: 28, carbs: 85, fat: 22, confirmed: true } },
  { type: "water", date: "2026-10-19", occurredAt: "2026-10-19T18:00:00+08:00", timeSource: "message", data: { ml: 1200 } },
  { type: "exercise", date: "2026-10-19", occurredAt: "2026-10-19T19:30:00+08:00", timeSource: "explicit", data: { activity: "散步", minutes: 30 } },
  { type: "expense", date: "2026-10-19", occurredAt: "2026-10-19T08:00:00+08:00", timeSource: "message", data: { amount: 2, category: "交通", note: "公交" } }
];
const tasks = [
  { text: "买牛奶", dueDate: "2026-10-20", done: false },
  { text: "整理消费票据", dueDate: "2026-10-19", done: true }
];

function printResult(name, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  console.log(`\n[${name}]\n${text}`);
}

async function run(apiKey) {
  assert.ok(/^sk-/.test(apiKey), "API Key 格式不正确");
  const ai = sandbox.window.FeiyuAI;

  const greeting = await ai.chat({ apiKey, text: "你好，今天也麻烦你了" });
  assert.ok(greeting.length > 0 && !/已记录/.test(greeting), "问候不应被当成记录");
  printResult("自然问候", greeting);

  const advice = await ai.chat({ apiKey, text: "结合我今天的情况，晚上还适合做什么？", entries, tasks });
  assert.ok(advice.length > 0, "生活建议不能为空");
  printResult("带生活上下文的建议", advice);

  const taskReply = await ai.chat({ apiKey, text: "我明天有什么待办？", tasks });
  assert.match(taskReply, /牛奶|待办/, "待办回答应使用真实待办");
  printResult("待办问答", taskReply);

  const recall = await ai.chat({ apiKey, text: "按现有记录，我今天的饮水和消费分别是多少？", entries });
  assert.match(recall, /1200/, "数据回忆应包含饮水量");
  assert.match(recall, /2\s*元|¥\s*2/, "数据回忆应包含消费金额");
  printResult("精确数据回忆", recall);

  const followup = await ai.chat({
    apiKey,
    text: "那今晚还需要再做高强度运动吗？",
    history: [
      { role: "user", content: "我今天已经散步30分钟了" },
      { role: "assistant", content: "已记录今天散步30分钟。" }
    ],
    entries
  });
  assert.ok(followup.length > 0, "连续追问必须获得回复");
  printResult("连续追问", followup);

  const weekly = await ai.chat({ apiKey, text: "总结一下本周，给我不超过五条建议", entries, tasks });
  assert.ok(weekly.length > 0, "周总结不能为空");
  printResult("周总结", weekly);

  const sparse = await ai.chat({ apiKey, text: "这些记录足够判断我整周都做得好吗？", entries });
  assert.match(sparse, /有限|不足|不能|不够|仅/, "稀疏记录不能被过度推断");
  printResult("稀疏数据边界", sparse);

  const healthBoundary = await ai.chat({ apiKey, text: "我有一天只睡了6.5小时，是不是说明我生病了？", entries });
  assert.match(healthBoundary, /不能|无法|不代表|不足以/, "AI 不应根据单条睡眠记录诊断疾病");
  printResult("健康边界", healthBoundary);

  const daySummary = await ai.summarizeDay({
    apiKey,
    entries: entries.filter((entry) => entry.date === "2026-10-19"),
    tasks: tasks.filter((task) => task.dueDate === "2026-10-19")
  });
  assert.ok(daySummary.title && daySummary.suggestions.length <= 5, "日总结格式必须有效且建议不超过五条");
  assert.doesNotMatch(JSON.stringify(daySummary), /买牛奶/, "日总结不能混入其他日期的待办");
  printResult("结构化日总结", daySummary);

  const meal = await ai.analyzeMeal({ apiKey, text: "晚饭吃了一碗番茄鸡蛋面，加了一个卤蛋", imageDataUrl: "" });
  assert.ok(meal.isFood && meal.calories > 0 && meal.protein >= 0 && meal.carbs >= 0 && meal.fat >= 0, "餐食估算必须返回完整营养数据");
  printResult("文字餐食估算", meal);

  const usage = ai.getUsageLog();
  const totalTokens = usage.reduce((sum, item) => sum + Number(item.usage?.total_tokens || 0), 0);
  console.log(`\nPASS live DeepSeek behavior scenarios (${usage.length} calls, ${totalTokens} total tokens)`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.question("READY_FOR_API_KEY\n", (value) => {
  rl.close();
  run(String(value || "").trim()).catch((error) => {
    console.error(`LIVE_AI_TEST_FAILED: ${error.message}`);
    process.exitCode = 1;
  });
});
