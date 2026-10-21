const assert = require("node:assert/strict");
const parser = require("../dist/record-parser.js");

let passed = 0;

function route(text) {
  if (parser.parseDeleteRequest(text)) return "delete";
  if (parser.needsAIEventInterpretation(text)) return "ai";
  if (parser.isMealEstimateRequest(text)) return "meal-estimate";
  if (parser.isFoodRecordRequest(text)) return "food";
  if (parser.isStructuredRecordRequest(text)) return "structured";
  return "chat";
}

const mealEstimateRoutingCases = [
  ["算一下我昨日的热量缺口", false],
  ["昨天摄入了多少热量", false],
  ["算一下今天总摄入", false],
  ["我本周热量赤字是多少", false],
  ["今天摄入和消耗差多少", false],
  ["统计一下这个月的总热量", false],
  ["昨天我一共吃了多少大卡", false],
  ["算下昨日的热量是多少", false],
  ["算一下这顿饭的热量", true],
  ["算一下刚才午饭的摄入", true],
  ["这杯西瓜汁多少热量", true],
  ["算一下热量", true],
  ["我刚喝了一杯西瓜汁，算一下摄入", true]
];

for (const [text, expected] of mealEstimateRoutingCases) {
  assert.equal(parser.isMealEstimateRequest(text), expected, `${text}: meal estimate routing`);
  passed += 1;
}

function signature(entry) {
  if (entry.type === "water") return `water:${entry.data.ml}`;
  if (entry.type === "expense") return `expense:${entry.data.amount}:${entry.data.category}`;
  if (entry.type === "exercise") {
    const data = entry.data;
    const measurement = data.minutes ?? (data.sets !== undefined ? `${data.sets}组`
      : data.steps !== undefined ? `${data.steps}步`
        : data.km !== undefined ? `${data.km}km` : "");
    return `exercise:${data.activity}${measurement !== "" ? `:${measurement}` : ""}`;
  }
  return entry.type;
}

const cases = [
  ["刚喝了250毫升水", "structured", ["water:250"], 0],
  ["上午喝了水250毫升", "structured", ["water:250"], 0],
  ["喝了一瓶500ml的水", "structured", ["water:500"], 0],
  ["饮水量大约1.2升", "structured", ["water:1200"], 0],
  ["刚才补水两杯", "structured", ["water:500"], 0],
  ["今天还没喝水", "chat", [], 0],
  ["我打算下午喝水500毫升", "chat", [], 0],
  ["明天记得喝两升水", "structured", [], 1],
  ["每天喝2000毫升水够吗？", "chat", [], 0],

  ["晚上快走四十五分钟", "structured", ["exercise:快走:45"], 0],
  ["刚刚做了三组深蹲", "structured", ["exercise:深蹲:3组"], 0],
  ["下午骑了12公里自行车", "structured", ["exercise:骑车:12km"], 0],
  ["今天走了一万步", "structured", ["exercise:走路:10000步"], 0],
  ["打了一个半小时羽毛球", "structured", ["exercise:羽毛球:90"], 0],
  ["我刚健身完", "structured", ["exercise:健身"], 0],
  ["今天没跑步", "chat", [], 0],
  ["我打算晚上跑步30分钟", "chat", [], 0],
  ["跑步30分钟够吗？", "chat", [], 0],

  ["早上公交付了两块钱", "structured", ["expense:2:交通"], 0],
  ["午饭一共24块9", "structured", ["expense:24.9:餐饮"], 0],
  ["在超市买纸巾花费18.5", "structured", ["expense:18.5:购物"], 0],
  ["充了50元话费", "structured", ["expense:50:居住"], 0],
  ["停车收了8元", "structured", ["expense:8:交通"], 0],
  ["刚收到外卖退款18.5元", "ai", [], 0],
  ["今天没有花20元买咖啡", "chat", [], 0],
  ["明天午饭预算30元", "chat", [], 0],
  ["这个套餐25元值得买吗？", "chat", [], 0],
  ["这双鞋原价299元，现在不买", "chat", [], 0],
  ["A套餐20元，B套餐25元，选哪个？", "chat", [], 0],
  ["工资到账5000元", "chat", [], 0],
  ["别人转给我100元", "chat", [], 0],

  ["午饭吃了一碗牛肉面", "food", [], 0],
  ["刚喝了一杯无糖豆浆", "food", [], 0],
  ["早餐两个鸡蛋和一杯牛奶", "food", [], 0],
  ["晚饭吃了米粉，花了23元", "food", ["expense:23:餐饮"], 0],
  ["午饭花了25元", "structured", ["expense:25:餐饮"], 0],
  ["今天没吃早饭", "chat", [], 0],
  ["早饭没吃", "chat", [], 0],
  ["明天晚饭准备吃牛肉面", "chat", [], 0],
  ["晚上吃什么比较好？", "chat", [], 0],
  ["如果晚饭吃炸鸡会不会太油？", "chat", [], 0],
  ["刚买了面包还没吃", "ai", [], 0],
  ["买了一张餐食团购券，还没吃，花了19.9元", "ai", [], 0],

  ["提醒我明天买牛奶", "structured", [], 1],
  ["把交电费加入待办", "structured", [], 1],
  ["别忘了今晚倒垃圾", "structured", [], 1],
  ["后天要做：去银行办卡", "structured", [], 1],
  ["我明天有什么待办？", "chat", [], 0],
  ["今天要做什么？", "chat", [], 0],
  ["有哪些待办？", "chat", [], 0],
  ["明天去银行办卡", "chat", [], 0],

  ["上午整理了房间四十分钟", "ai", [], 0],
  ["刚刚开完会", "ai", [], 0],
  ["上午开了个会", "ai", [], 0],
  ["下午连续看电脑三小时，眼睛有点干", "ai", [], 0],
  ["昨晚看了一部电影", "ai", [], 0],
  ["我打算晚上整理房间", "chat", [], 0],
  ["晚上准备整理房间", "chat", [], 0],
  ["眼睛有点干怎么办？", "chat", [], 0],
  ["今天没有去图书馆", "chat", [], 0],

  ["早上喝水300毫升，坐公交花2元，晚上跑步30分钟", "structured", ["water:300", "expense:2:交通", "exercise:跑步:30"], 0],
  ["午饭吃了鸡肉饭花28元，下午喝水500毫升", "food", ["expense:28:餐饮", "water:500"], 0],
  ["今天没运动，只喝水500毫升", "structured", ["water:500"], 0],
  ["明天跑步30分钟，今天喝水400毫升", "structured", ["water:400"], 0],
  ["删除刚才那条饮水记录", "delete", [], 0],
  ["不要删除今天的饮水记录", "chat", [], 0],
  ["刚才那笔消费改成19.9元", "ai", [], 0],
  ["上一条饮水应该是350毫升", "ai", [], 0]
];

for (const [text, expectedRoute, expectedEntries, expectedTasks] of cases) {
  const parsed = parser.extract(text);
  assert.equal(route(text), expectedRoute, `${text}: route`);
  if (expectedRoute !== "ai") {
    const actualEntries = parsed.entries.map(signature);
    for (const expected of expectedEntries) assert.ok(actualEntries.includes(expected), `${text}: missing ${expected}; got ${actualEntries.join(", ")}`);
    if (!expectedEntries.length) assert.equal(actualEntries.length, 0, `${text}: must not create a local entry`);
  }
  assert.equal(parsed.tasks.length, expectedTasks, `${text}: task count`);
  passed += 1;
}

const nonFactLocalEntries = [
  "计划下午喝水300毫升",
  "我想每天喝水两升",
  "还没喝那瓶500ml的水",
  "喝水500毫升合适吗？",
  "建议每天饮水2000毫升",
  "明天跑步45分钟",
  "计划每周游泳60分钟",
  "今天没有走一万步",
  "骑车20公里有用吗？",
  "建议每天做三组深蹲",
  "这件衣服预算200元",
  "电影票原价45元",
  "明天打车预计30元",
  "这杯咖啡18元贵不贵？",
  "没有支付那笔99元订单",
  "下次午饭控制在25元",
  "奖金到账3000元",
  "同事转给我50元",
  "计划明早吃两个鸡蛋",
  "还没喝那杯牛奶",
  "晚饭不吃米饭",
  "要不要吃一碗面？",
  "假如夜宵吃炸鸡怎么样？"
];
for (const text of nonFactLocalEntries) {
  const parsed = parser.extract(text);
  assert.equal(parsed.entries.length, 0, `${text}: non-fact must not create deterministic entry`);
  assert.equal(parser.isFoodRecordRequest(text), false, `${text}: non-fact must not start meal analysis`);
  passed += 2;
}

const actualParaphrases = [
  ["一口气喝了750ml水", "water:750"],
  ["下午饮水量约0.8升", "water:800"],
  ["刚补水三杯", "water:750"],
  ["骑自行车15公里", "exercise:骑车:15km"],
  ["快走一万二千步", "exercise:快走:12000步"],
  ["做了四组俯卧撑", "exercise:俯卧撑:4组"],
  ["地铁花了3块5", "expense:3.5:交通"],
  ["早餐一共12块8", "expense:12.8:餐饮"],
  ["刚交了物业费260元", "expense:260:居住"]
];
for (const [text, expected] of actualParaphrases) {
  const actual = parser.extract(text).entries.map(signature);
  assert.ok(actual.includes(expected), `${text}: expected ${expected}; got ${actual.join(", ")}`);
  passed += 1;
}

const waterVariants = ["喝水300毫升", "饮水1.5升", "补水两杯"];
for (const fact of waterVariants) {
  for (const text of [`我打算${fact}`, `明天${fact}`, `建议每天${fact}`, `${fact}够吗？`]) {
    assert.equal(parser.extract(text).entries.some((entry) => entry.type === "water"), false, `${text}: no planned/question water`);
    passed += 1;
  }
}

for (const activity of ["跑步", "游泳", "骑车", "快走", "力量训练"]) {
  for (const text of [`我计划${activity}30分钟`, `明天${activity}30分钟`, `${activity}30分钟够吗？`, `今天没${activity}30分钟`]) {
    assert.equal(parser.extract(text).entries.some((entry) => entry.type === "exercise"), false, `${text}: no planned/question exercise`);
    passed += 1;
  }
}

for (const [item, amount] of [["套餐", 25], ["鞋", 299], ["电影票", 45], ["打车", 30], ["咖啡", 18]]) {
  for (const text of [`这个${item}${amount}元值得买吗？`, `${item}预算${amount}元`, `${item}原价${amount}元`, `明天${item}预计${amount}元`]) {
    assert.equal(parser.extract(text).entries.some((entry) => entry.type === "expense"), false, `${text}: no quoted/planned expense`);
    passed += 1;
  }
}

for (const food of ["牛肉面", "炸鸡", "鸡蛋", "面包", "米饭"]) {
  for (const text of [`明天晚饭准备吃${food}`, `今天没吃${food}`, `如果晚饭吃${food}怎么样？`, `买了${food}还没吃`]) {
    assert.equal(parser.isFoodRecordRequest(text), false, `${text}: no planned/negated meal`);
    passed += 1;
  }
}

const reference = new Date(2026, 9, 21, 8, 30, 0);
const timingCases = [
  ["昨晚11点喝水300毫升", "2026-10-20", 23, 0],
  ["昨晚跑步30分钟", "2026-10-20", 20, 0],
  ["昨晚公交花了2元", "2026-10-20", 20, 0],
  ["昨天晚上11点喝水300毫升", "2026-10-20", 23, 0],
  ["今早7点喝水300毫升", "2026-10-21", 7, 0],
  ["前晚8点跑步30分钟", "2026-10-19", 20, 0]
];

for (const [text, expectedDate, expectedHour, expectedMinute] of timingCases) {
  const entry = parser.extract(text).entries[0];
  assert.ok(entry, `${text}: parsed entry`);
  const timing = parser.resolveEventTime(entry.timeContext, reference);
  const occurredAt = new Date(timing.occurredAt);
  assert.equal(timing.date, expectedDate, `${text}: date`);
  assert.equal(occurredAt.getHours(), expectedHour, `${text}: hour`);
  assert.equal(occurredAt.getMinutes(), expectedMinute, `${text}: minute`);
  passed += 1;
}

assert.equal(parser.numberFromText("一万"), 10000);
assert.equal(parser.numberFromText("十二万三千"), 123000);
assert.equal(parser.numberFromText("一千零五"), 1005);
passed += 3;

console.log(`PASS ${passed} intent-boundary and cross-category recognition scenarios`);
