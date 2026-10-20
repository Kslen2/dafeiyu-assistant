const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requests = [];
const sandbox = {
  window: {},
  document: { documentElement: { dataset: {} } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const content = body.response_format
      ? JSON.stringify({ title: "稳稳记录的一天", suggestions: ["晚饭后散步十分钟", "完成明天到期的待办"] })
      : "你明天有一项买牛奶的待办，可以在回家路上完成。";
    return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 100 } }) };
  },
  console
};

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "assistant-core.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "assistant-core.js" });

(async () => {
  const entries = [{ type: "exercise", date: "2026-10-19", occurredAt: "2026-10-19T11:00:00.000Z", timeSource: "explicit", data: { activity: "散步", minutes: 30 } }];
  const tasks = [{ text: "买牛奶", dueDate: "2026-10-20", done: false }];

  const profile = {
    priorities: { sleep: "high", diet: "normal" },
    assistantStyle: { verbosity: "short", tone: "direct", maxSuggestions: 2 },
    customFocuses: [{ name: "用眼情况", priority: "high", signals: ["连续屏幕时长"] }]
  };
  const summary = await sandbox.window.FeiyuAI.summarizeDay({ apiKey: "test-key", entries, tasks, profile });
  assert.equal(summary.title, "稳稳记录的一天");
  assert.equal(summary.suggestions.length, 2);
  assert.match(requests[0].messages.at(-1).content, /今天的待办/);
  assert.match(requests[0].messages.at(-1).content, /买牛奶/);
  assert.match(requests[0].messages[0].content, /不得把明天或以后到期的事项说成今天必须完成/);
  assert.match(requests[0].messages[0].content, /没有记录.*不等于.*没有发生/);
  assert.match(requests[0].messages[0].content, /应用支持通过聊天指令和“当天”页面新增、编辑、删除本地记录/);
  assert.match(requests[0].messages[0].content, /只有应用显示的“本地数据操作”结果卡才代表实际落库/);
  assert.match(requests[0].messages[0].content, /不要笼统地说应用不能修改或删除记录/);
  assert.match(requests[0].messages.at(-1).content, /用眼情况/);
  assert.match(requests[0].messages.at(-1).content, /最多 2 条/);

  const reply = await sandbox.window.FeiyuAI.chat({ apiKey: "test-key", text: "我明天有什么待办？", entries, tasks, profile });
  assert.match(reply, /买牛奶/);
  const chatPrompt = requests[1].messages.at(-1).content;
  assert.match(chatPrompt, /生活记录/);
  assert.match(chatPrompt, /待办事项/);
  assert.match(chatPrompt, /买牛奶/);
  assert.match(chatPrompt, /用眼情况/);
  assert.doesNotMatch(chatPrompt, /test-key/);

  console.log("PASS AI life-record and task-context contracts (mocked)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
