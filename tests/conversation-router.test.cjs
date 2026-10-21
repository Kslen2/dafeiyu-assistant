const assert = require("node:assert/strict");
const router = require("../dist/conversation-router.js");

const states = [
  ["无待处理", {}],
  ["待确认餐食", { hasPendingMeal: true }],
  ["待补充餐食", { hasPendingMealClarification: true }],
  ["待确认个性化", { hasPendingProfile: true }],
  ["餐食和个性化同时待确认", { hasPendingMeal: true, hasPendingProfile: true }],
  ["餐食补充和个性化同时待处理", { hasPendingMealClarification: true, hasPendingProfile: true }]
];

const independentQueries = [
  "我昨天的热量缺口有多少",
  "昨天一共摄入多少热量",
  "我这周平均睡了多久",
  "最近运动情况怎么样",
  "昨天喝了多少水",
  "本月一共花了多少钱",
  "我明天有什么待办",
  "正常来说一天应该摄入多少脂肪比较合适",
  "有没有什么午餐推荐，我还有几片全麦面包",
  "为什么最近总是晚饭吃得很晚",
  "团购券应该怎么记录",
  "退款之后净消费怎么算"
];

let assertions = 0;
for (const [stateName, state] of states) {
  for (const text of independentQueries) {
    const decision = router.assertRouteSafety(router.routeMessage({ text, ...state }));
    assert.equal(decision.allowsMutation, false, `${stateName} + ${text}: query must be read-only`);
    assert.ok(["query_chat", "profile_query"].includes(decision.route), `${stateName} + ${text}: independent query route`);
    assertions += 2;
  }
}

const routeCases = [
  ["图片", { text: "这是午饭", hasPhoto: true }, "photo", false],
  ["删除", { text: "删除刚才那条饮水记录" }, "delete", true],
  ["总结", { text: "总结今天" }, "day_summary", false],
  ["裸记录", { text: "记录一下" }, "bare_record", false],
  ["确认餐食", { text: "确认", hasPendingMeal: true }, "meal_confirm", true],
  ["确认个性化", { text: "确认", hasPendingProfile: true }, "profile_confirm", true],
  ["明确确认餐食", { text: "确认餐食", hasPendingMeal: true, hasPendingProfile: true }, "meal_confirm", true],
  ["明确确认个性化", { text: "确认个性化设置", hasPendingMeal: true, hasPendingProfile: true }, "profile_confirm", true],
  ["模糊确认冲突", { text: "确认", hasPendingMeal: true, hasPendingProfile: true }, "pending_action_conflict", false],
  ["明确取消餐食", { text: "取消餐食", hasPendingMealClarification: true, hasPendingProfile: true }, "meal_clarification_cancel", true],
  ["明确取消个性化", { text: "取消个性化设置", hasPendingMealClarification: true, hasPendingProfile: true }, "profile_cancel", true],
  ["模糊取消冲突", { text: "取消", hasPendingMealClarification: true, hasPendingProfile: true }, "pending_action_conflict", false],
  ["补充餐食", { text: "一个鸡腿堡和小份薯条", hasPendingMealClarification: true }, "meal_clarification_response", true],
  ["修正餐食", { text: "其实只吃了一半", hasPendingMeal: true }, "meal_correction", true],
  ["口述份量修正餐食", { text: "牛肉150克，海带丝，金针菇，豆干丝加起来100克，大白菜150克，一个煎蛋，一包过了水的油炸泡面", hasPendingMeal: true }, "meal_correction", true],
  ["单项份量修正餐食", { text: "一包泡面", hasPendingMeal: true }, "meal_correction", true],
  ["笼统说卡片不准", { text: "卡片不准，需要修改", hasPendingMeal: true }, "meal_correction_prompt", false],
  ["笼统说算错了", { text: "你算错了", hasPendingMeal: true }, "meal_correction_prompt", false],
  ["笼统说热量太高", { text: "热量太高了", hasPendingMeal: true }, "meal_correction_prompt", false],
  ["直接改热量数值", { text: "改成800千卡", hasPendingMeal: true }, "meal_correction", true],
  ["指认晚饭", { text: "这是我的晚饭" }, "meal_caption", false],
  ["待确认时指认晚饭", { text: "这是我的晚饭", hasPendingMeal: true }, "meal_caption", false],
  ["带食物内容的晚饭仍是记录", { text: "晚饭吃了牛肉面" }, "food_record", true],
  ["消费纠错不被餐食抢走", { text: "刚才那笔消费不对，应该是20元", hasPendingMeal: true }, "ai_event", true],
  ["饮水记录", { text: "刚喝了500ml水" }, "structured_record", true],
  ["饮水混合问句", { text: "刚喝了500ml水，这样够吗" }, "structured_record", true],
  ["运动记录", { text: "下午跑步30分钟" }, "structured_record", true],
  ["睡眠记录", { text: "昨晚一点半睡到今早九点" }, "structured_record", true],
  ["消费记录", { text: "坐公交花了2元" }, "structured_record", true],
  ["饮食记录", { text: "午饭吃了牛肉面" }, "food_record", true],
  ["单餐估算", { text: "算一下刚才那顿饭的热量" }, "meal_estimate", false],
  ["团购券", { text: "刚买了一张肯德基团购券，花了24.9，还没吃" }, "ai_event", true],
  ["退款", { text: "刚收到上一笔订单的退款24.9元" }, "ai_event", true],
  ["普通聊天", { text: "你好呀" }, "chat", false]
];

for (const [name, input, expectedRoute, expectedMutation] of routeCases) {
  const decision = router.assertRouteSafety(router.routeMessage(input));
  assert.equal(decision.route, expectedRoute, `${name}: route`);
  assert.equal(decision.allowsMutation, expectedMutation, `${name}: mutation boundary`);
  assertions += 2;
}

for (const text of [
  "刚喝了500ml水，这样够吗",
  "今天跑了30分钟，这个运动量合适吗",
  "昨晚睡了7小时，你觉得够吗"
]) {
  const routed = router.routeMessage({ text });
  assert.equal(routed.route, "structured_record", `${text}: mixed record and question route`);
  assert.equal(routed.replyAfterMutation, true, `${text}: reply after recording`);
  assertions += 2;
}

// 连续会话：待确认餐食不能劫持新的营养咨询，之后仍可修正并确认原餐食。
let state = {};
let decision = router.routeMessage({ text: "午饭吃了锅烧米粉", ...state });
assert.equal(decision.route, "food_record");
state.hasPendingMeal = true;
decision = router.routeMessage({ text: "正常来说一天摄入多少脂肪合适", ...state });
assert.equal(decision.route, "query_chat");
assert.equal(decision.allowsMutation, false);
decision = router.routeMessage({ text: "刚才那碗其实只吃了一半", ...state });
assert.equal(decision.route, "meal_correction");
decision = router.routeMessage({ text: "确认餐食", ...state });
assert.equal(decision.route, "meal_confirm");
assertions += 5;

// 查询的措辞变化不应改变只读属性。
const queryPrefixes = ["帮我看看", "查一下", "告诉我", "我想知道"];
const querySubjects = ["昨天的热量缺口有多少", "本月消费了多少钱", "最近平均睡了多久", "本周运动情况怎么样"];
for (const prefix of queryPrefixes) {
  for (const subject of querySubjects) {
    const routed = router.assertRouteSafety(router.routeMessage({ text: `${prefix}${subject}`, hasPendingMeal: true, hasPendingProfile: true }));
    assert.equal(routed.allowsMutation, false, `${prefix}${subject}: paraphrased query is read-only`);
    assertions += 1;
  }
}

// 图片卡之后的真实会话：口述份量应修正原卡，不能掉进普通聊天让 AI 另编一张“卡”。
decision = router.routeMessage({ text: "这是我的晚饭", hasPhoto: true });
assert.equal(decision.route, "photo");
const pendingPhotoState = { hasPendingMeal: true };
decision = router.routeMessage({ text: "牛肉150克，海带丝，金针菇，豆干丝加起来100克，大白菜150克，一个煎蛋，一包过了水的油炸泡面", ...pendingPhotoState });
assert.equal(decision.route, "meal_correction");
assert.equal(decision.allowsMutation, true);
decision = router.routeMessage({ text: "卡片不准，需要修改", ...pendingPhotoState });
assert.equal(decision.route, "meal_correction_prompt");
assert.equal(decision.allowsMutation, false);
decision = router.routeMessage({ text: "这是我的晚饭", ...pendingPhotoState });
assert.equal(decision.route, "meal_caption");
assert.equal(decision.allowsMutation, false);
assert.equal(router.routeMessage({ text: "正常来说一天应该摄入多少脂肪比较合适", ...pendingPhotoState }).route, "query_chat");
assertions += 8;

console.log(`PASS ${assertions} stateful conversation-router assertions`);
