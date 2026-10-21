const assert = require("node:assert/strict");
const parser = require("../dist/record-parser.js");

const intentCases = [
  ["昨日热量缺口查询", "我昨天的热量缺口有多少", "query"],
  ["历史饮食查询", "昨天一共摄入多少热量", "query"],
  ["营养建议查询", "正常来说一天应该摄入多少脂肪比较合适", "query"],
  ["餐食推荐查询", "有没有什么午餐推荐，我还有几片全麦面包", "query"],
  ["消费查询", "我昨天一共花了多少钱", "query"],
  ["睡眠查询", "我这周平均睡了多久", "query"],
  ["普通饮水记录", "刚喝了500ml水", "record"],
  ["事实加问题", "刚喝了500ml水，这样够吗", "record_and_query"],
  ["复杂生活记录", "刚收到一笔退款", "ambiguous_record"],
  ["询问券如何记录", "餐食团购券应该怎么记录", "query"],
  ["删除操作", "删除刚才的饮水记录", "mutation"],
  ["普通聊天", "你好呀", "conversation"]
];
for (const [name, text, expected] of intentCases) {
  assert.equal(parser.classifyUserIntent(text), expected, `${name}: unified intent router`);
}

const replyCases = [
  ["根据已记录的饮食，昨天摄入约 1200 千卡。", "根据已记录的饮食，昨天摄入约 1200 千卡。"],
  ["现有记录显示昨天有两顿饭。", "现有记录显示昨天有两顿饭。"],
  ["昨天已记录摄入 1200 千卡，但缺少全天总消耗。", "昨天已记录摄入 1200 千卡，但缺少全天总消耗。"],
  ["系统已经记录的数据显示，昨天摄入约 1200 千卡。", "系统已经记录的数据显示，昨天摄入约 1200 千卡。"],
  ["我已经为你记录了这次饮水。", "我不能在普通回复中确认本地数据已经修改；只有“本地数据操作”结果卡才代表实际写入。"],
  ["已帮你删除昨天的记录。", "我不能在普通回复中确认本地数据已经修改；只有“本地数据操作”结果卡才代表实际写入。"],
  ["记录指令已发给应用。", "我不能在普通回复中确认本地数据已经修改；只有“本地数据操作”结果卡才代表实际写入。"]
];
for (const [input, expected] of replyCases) assert.equal(parser.sanitizeUnverifiedChatReply(input), expected);

const fabricatedCardReplies = [
  ["仿造餐食卡", "餐食估算卡（待确认）：这份晚餐约 820 千卡，蛋白质约 50 克，碳水约 95 克，脂肪约 38 克。"],
  ["无标题的卡片式结论", "约 820 千卡，蛋白质约 50 克，碳水约 95 克，脂肪约 38 克，待确认。"]
];
for (const [name, reply] of fabricatedCardReplies) {
  assert.doesNotMatch(parser.sanitizeFabricatedMealCard(reply), /餐食估算卡|千卡/, `${name}: fabricated meal card must not reach the chat bubble`);
}
assert.equal(parser.sanitizeFabricatedMealCard("你好，今天想记录什么？"), "你好，今天想记录什么？", "ordinary chat reply is preserved");
assert.equal(parser.sanitizeFabricatedMealCard("根据记录，你今天摄入约 1500 千卡。"), "根据记录，你今天摄入约 1500 千卡。", "history answer is preserved");

const cases = [
  ["公交和饮水组合", "我坐公交花了一块钱，喝水250毫升", [{ type: "water", data: { ml: 250 } }, { type: "expense", data: { amount: 1, category: "交通" } }]],
  ["中文金额打车", "打车花了十五块", [{ type: "expense", data: { amount: 15, category: "交通" } }]],
  ["地铁数字金额", "地铁2元", [{ type: "expense", data: { amount: 2, category: "交通" } }]],
  ["两笔消费分开分类", "午饭25元，地铁2元", [{ type: "expense", data: { amount: 25, category: "餐饮" } }, { type: "expense", data: { amount: 2, category: "交通" } }]],
  ["房租", "交房租1800元", [{ type: "expense", data: { amount: 1800, category: "居住" } }]],
  ["小数电费", "电费86.5元", [{ type: "expense", data: { amount: 86.5, category: "居住" } }]],
  ["水费", "这个月水费三十二元", [{ type: "expense", data: { amount: 32, category: "居住" } }]],
  ["衣服购物", "买T恤花了89元", [{ type: "expense", data: { amount: 89, category: "购物" } }]],
  ["鞋子购物", "买鞋花了两百元", [{ type: "expense", data: { amount: 200, category: "购物" } }]],
  ["日用品", "洗衣液35块钱", [{ type: "expense", data: { amount: 35, category: "购物" } }]],
  ["喝水自然表达", "喝水250毫升", [{ type: "water", data: { ml: 250 } }]],
  ["两杯水", "喝了两杯水", [{ type: "water", data: { ml: 500 } }]],
  ["升换算", "今天饮水1.5升", [{ type: "water", data: { ml: 1500 } }]],
  ["多次饮水", "上午喝水300ml，下午喝水500ml", [{ type: "water", data: { ml: 300 } }, { type: "water", data: { ml: 500 } }]],
  ["数字睡眠", "昨晚睡了7个小时", [{ type: "sleep", data: { hours: 7 } }]],
  ["中文睡眠", "昨晚睡了八小时", [{ type: "sleep", data: { hours: 8 } }]],
  ["跑步分钟", "跑步30分钟", [{ type: "exercise", data: { activity: "跑步", minutes: 30 } }]],
  ["跑了公里", "今天跑了5公里", [{ type: "exercise", data: { activity: "跑步", km: 5 } }]],
  ["走了公里", "饭后走了3公里", [{ type: "exercise", data: { activity: "走路", km: 3 } }]],
  ["骑行小时", "骑行1小时", [{ type: "exercise", data: { activity: "骑车", minutes: 60 } }]],
  ["中文游泳", "游泳四十分钟", [{ type: "exercise", data: { activity: "游泳", minutes: 40 } }]],
  ["跳绳", "跳绳20分钟", [{ type: "exercise", data: { activity: "跳绳", minutes: 20 } }]],
  ["健身", "健身45分钟", [{ type: "exercise", data: { activity: "健身", minutes: 45 } }]],
  ["医疗消费", "买药花了48元", [{ type: "expense", data: { amount: 48, category: "医疗健康" } }]],
  ["娱乐消费", "电影票38元", [{ type: "expense", data: { amount: 38, category: "娱乐" } }]],
  ["学习消费", "买书花了56元", [{ type: "expense", data: { amount: 56, category: "学习办公" } }]],
  ["人情消费", "给朋友买礼物花了120元", [{ type: "expense", data: { amount: 120, category: "人情往来" } }]],
  ["餐饮消费", "咖啡18元", [{ type: "expense", data: { amount: 18, category: "餐饮" } }]],
  ["话费", "充话费50元", [{ type: "expense", data: { amount: 50, category: "居住" } }]],
  ["多个交通消费", "加油200元，停车费8元", [{ type: "expense", data: { amount: 200, category: "交通" } }, { type: "expense", data: { amount: 8, category: "交通" } }]],
  ["购物金额在句尾", "买纸巾花了12元", [{ type: "expense", data: { amount: 12, category: "购物" } }]],
  ["中文小数", "公交花了一点五元", [{ type: "expense", data: { amount: 1.5, category: "交通" } }]],
  ["口语块数", "公交花了一块五", [{ type: "expense", data: { amount: 1.5, category: "交通" } }]],
  ["多领域组合", "睡了7小时，喝水500ml，健身40分钟，打车12元", [{ type: "sleep", data: { hours: 7 } }, { type: "water", data: { ml: 500 } }, { type: "exercise", data: { activity: "健身", minutes: 40 } }, { type: "expense", data: { amount: 12, category: "交通" } }]],
  ["省略单位的餐饮消费", "今天中午消费23吃了一碗锅烧广西米粉", [{ type: "expense", data: { amount: 23, category: "餐饮" } }]],
  ["花费小数无单位", "午饭吃肯德基，花费24.9", [{ type: "expense", data: { amount: 24.9, category: "餐饮" } }]],
];

const taskCases = [
  ["普通待办", "待办：整理房间", { text: "整理房间", dueOffset: null }],
  ["今天待办", "今天记得取快递", { text: "取快递", dueOffset: 0 }],
  ["明天待办", "明天记得买菜", { text: "买菜", dueOffset: 1 }],
  ["后天待办", "提醒我后天交话费", { text: "交话费", dueOffset: 2 }],
  ["倒装待办", "把换床单加入待办", { text: "换床单", dueOffset: null }],
  ["别忘了", "别忘了拿雨伞", { text: "拿雨伞", dueOffset: null }],
];

const routeCases = [
  ["苹果饮食", "下午吃了一个苹果", { food: true, structured: false }],
  ["午饭内容", "午饭是鸡胸肉和米饭", { food: true, structured: false }],
  ["奶茶饮食", "晚上喝了一杯奶茶", { food: true, structured: false }],
  ["早餐仅消费", "早餐花了18元", { food: false, structured: true }],
  ["一块巧克力不是钱", "吃了一块巧克力", { food: true, structured: false }],
  ["三块巧克力也不是钱", "买了三块巧克力", { food: false, structured: false }],
  ["午饭内容加消费", "午饭吃了牛肉面，花了28元", { food: true, structured: true }],
  ["喝水不是饮食", "喝水300毫升", { food: false, structured: true }],
  ["问候", "你好", { food: false, structured: false }],
  ["穿衣普通聊天", "今天穿了外套", { food: false, structured: false }],
  ["询问今天吃了什么", "我今天吃了什么？", { food: false, structured: false }],
  ["询问最近饮食", "我最近吃得怎么样？", { food: false, structured: false }],
  ["询问今天吃什么", "今天该吃什么？", { food: false, structured: false }],
  ["询问推荐饮食", "推荐我吃什么", { food: false, structured: false }],
  ["午餐推荐", "有没有什么午餐推荐，我还有几片全麦面包", { food: false, structured: false }],
  ["现有食材搭配", "我有鸡蛋和西红柿，午饭怎么搭配", { food: false, structured: false }],
  ["食材做饭建议", "冰箱里只有鸡蛋和面包，能做什么午饭", { food: false, structured: false }],
  ["假设餐食评价", "中午吃全麦面包怎么样", { food: false, structured: false }],
  ["已吃事实附带评价", "午饭吃了牛肉面，味道怎么样", { food: true, structured: false }],
  ["餐饮预算不是饮食", "午饭预算30元", { food: false, structured: false }],
  ["餐饮目标不是饮食", "午饭控制在30元以内", { food: false, structured: false }],
  ["明确记录午饭", "我午饭吃了牛肉面", { food: true, structured: false }],
  ["无单位消费加饮食", "今天中午消费23吃了一碗锅烧广西米粉", { food: true, structured: true }],
  ["花费小数无单位加饮食", "午饭吃肯德基，花费24.9", { food: true, structured: true }],
  ["裸记录", "记录", { bare: true, explicit: false }],
  ["裸记一下", "记一下吧", { bare: true, explicit: false }],
  ["显式笔记", "记录：今天换了床单", { bare: false, explicit: true }],
  ["显式随手记", "随手记今天很忙", { bare: false, explicit: true }],
  ["指认晚饭没有食物", "这是我的晚饭", { food: false, structured: false }],
  ["评价晚饭没有食物", "晚饭很丰盛", { food: false, structured: false }],
  ["晚饭吃得晚不是进食", "晚饭吃得很晚", { food: false, structured: false }],
  ["晚饭带食物明细", "今天的晚饭是牛肉面和煎蛋", { food: true, structured: false }],
];

function assertSubset(actual, expected, path) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) assertSubset(actual[key], expectedValue, `${path}.${key}`);
    else assert.equal(actual[key], expectedValue, `${path}.${key}`);
  }
}

let passed = 0;
for (const [name, text, expectedEntries] of cases) {
  const result = parser.extract(text);
  assert.equal(result.entries.length, expectedEntries.length, `${name}: entry count for “${text}”`);
  expectedEntries.forEach((expected, index) => assertSubset(result.entries[index], expected, `${name}[${index}]`));
  passed += 1;
}

for (const [name, text, expectedTask] of taskCases) {
  const result = parser.extract(text);
  assert.equal(result.tasks.length, 1, `${name}: task count`);
  assertSubset(result.tasks[0], expectedTask, name);
  passed += 1;
}

for (const [name, text, expected] of routeCases) {
  const actual = {
    food: parser.isFoodRecordRequest(text),
    structured: parser.isStructuredRecordRequest(text),
    bare: parser.isBareRecordPrompt(text),
    explicit: parser.isExplicitNoteRequest(text)
  };
  assertSubset(actual, expected, name);
  passed += 1;
}

const mealCorrectionCases = [
  ["小包装份量", "应该不足两百克吧，就是普通的小包装", true],
  ["只吃半包", "其实只吃了半包", true],
  ["包装净含量", "包装上写净含量50克", true],
  ["食物名称纠正", "不是虾条，是咪咪", true],
  ["用油修正", "油没有那么多", true],
  ["食用比例", "我只吃了一半", true],
  ["普通问候", "你好", false],
  ["睡眠不足不是餐食", "今天睡了不到7小时", false],
  ["饮食建议不是修正", "建议我晚饭吃什么", false],
  ["每日脂肪建议不是修正", "正常来说一天应该摄入多少脂肪比较合适", false],
  ["每日蛋白质建议不是修正", "一天蛋白质推荐量是多少", false],
  ["营养标准咨询不是修正", "成年人每天碳水标准是多少", false],
  ["明确脂肪修正", "这顿脂肪应该是12克", true],
  ["明确蛋白质修正", "蛋白质改成30克", true],
  ["消费不是修正", "公交只花了5元", false]
];
for (const [name, text, expected] of mealCorrectionCases) {
  assert.equal(parser.isMealCorrectionRequest(text), expected, `${name}: meal correction route`);
  passed += 1;
}

const mealDetailSupplementCases = [
  ["口述份量清单", "牛肉150克，海带丝，金针菇，豆干丝加起来100克，大白菜150克，一个煎蛋，一包过了水的油炸泡面", true],
  ["单项份量", "一包泡面", true],
  ["单词份量", "牛肉只有100克", true],
  ["没有份量", "卡片不准，需要修改", false],
  ["只是指认餐次", "这是我的晚饭", false],
  ["独立营养咨询", "正常来说一天应该摄入多少脂肪比较合适", false],
  ["历史热量查询", "我昨天的热量缺口有多少", false],
  ["饮水记录不抢", "刚喝了500ml水", false],
  ["消费记录不抢", "公交花了5元", false],
  ["删除指令不抢", "删除刚才那条饮食记录", false],
  ["计划饮食不抢", "明天晚饭准备吃牛肉面", false]
];
for (const [name, text, expected] of mealDetailSupplementCases) {
  assert.equal(parser.isMealDetailSupplement(text), expected, `${name}: meal detail supplement`);
  passed += 1;
}

const mealCorrectionIntentCases = [
  ["卡片不准", "卡片不准，需要修改", true],
  ["估算偏高", "这个热量估算偏高", true],
  ["热量太高", "热量太高了", true],
  ["蛋白质算多", "蛋白质算多了", true],
  ["无主语算错", "你算错了", true],
  ["无内容改一下", "帮我改一下", true],
  ["具体份量不是笼统纠错", "牛肉只有100克", false],
  ["普通问候", "你好", false],
  ["营养咨询", "正常来说一天应该摄入多少脂肪比较合适", false],
  ["疑问句", "这张卡不准吗？", false],
  ["消费纠错不抢", "刚才那笔消费不对，应该是20元", false],
  ["价格问题不抢", "这个价格不对", false],
  ["待办修改不抢", "帮我改一下待办", false]
];
for (const [name, text, expected] of mealCorrectionIntentCases) {
  assert.equal(parser.isMealCorrectionIntent(text), expected, `${name}: meal correction intent`);
  passed += 1;
}

const bareMealReferenceCases = [
  ["指认晚饭", "这是我的晚饭", true],
  ["今天的午饭", "今天的午饭", true],
  ["带照片说明", "这是今天的晚饭照片", true],
  ["带食物内容", "晚饭吃了牛肉面", false],
  ["评价", "晚饭很丰盛", false]
];
for (const [name, text, expected] of bareMealReferenceCases) {
  assert.equal(parser.isBareMealReference(text), expected, `${name}: bare meal reference`);
  passed += 1;
}

const typedMealConfirmationCases = [
  ["简短确认", "确认", true],
  ["确认饮食与消费", "确认这笔消费与饮食记录", true],
  ["自然确认", "没问题", true],
  ["询问不是确认", "确认一下今天有没有记录？", false],
  ["明确不确认", "不确认", false]
];
for (const [name, text, expected] of typedMealConfirmationCases) {
  assert.equal(parser.isMealConfirmationRequest(text), expected, `${name}: typed meal confirmation route`);
  passed += 1;
}

assert.equal(parser.isMealClarificationCancellation("算了"), true, "meal clarification can be cancelled");
assert.equal(parser.isMealClarificationCancellation("一个鸡腿堡"), false, "food detail is not cancellation");
passed += 2;

const mealClarificationResponses = [
  ["肯德基套餐明细", "一个香辣鸡腿堡，小份薯条，三个热辣香骨鸡，一杯中杯可乐", true],
  ["简单份量补充", "大概半碗，还加了一个鸡蛋", true],
  ["新的生活提问", "我今天喝了多少水？", false],
  ["每日营养咨询", "一天应该摄入多少脂肪比较合适", false],
  ["蛋白质推荐量咨询", "每天蛋白质推荐量是多少", false],
  ["切换到总结", "总结今天", false]
];
for (const [name, text, expected] of mealClarificationResponses) {
  assert.equal(parser.isMealClarificationResponse(text), expected, `${name}: meal clarification response`);
  passed += 1;
}

const aiInterpretationCases = [
  ["购买未使用团购券", "买了一张肯德基团购券，花了24.9，还没吃", true],
  ["餐券核销", "中午核销了昨天买的餐券", true],
  ["收到退款", "刚刚收到肯德基退款24.9元", true],
  ["口头改金额", "刚才那笔消费记错了，改成19.9元", true],
  ["简单饮水", "喝水300毫升", false],
  ["普通问候", "你好", false]
];
for (const [name, text, expected] of aiInterpretationCases) {
  assert.equal(parser.needsAIEventInterpretation(text), expected, `${name}: AI event interpretation route`);
  passed += 1;
}

const deleteRequestCases = [
  ["删除今天所有", "删除今天所有记录", { scope: "day_all", type: null, dateOffset: 0 }],
  ["删除当天所有", "清空当天全部生活记录", { scope: "day_all", type: null, dateOffset: 0 }],
  ["删除昨天饮食", "删除昨天所有饮食记录", { scope: "day_type_all", type: "meal", dateOffset: -1 }],
  ["删除最近饮食", "删除刚才那条饮食记录", { scope: "latest", type: "meal" }],
  ["删除金额消费", "删除今天那笔23元消费", { scope: "latest", type: "expense", dateOffset: 0, amount: 23 }],
  ["删除最近饮水", "删掉刚刚的饮水记录", { scope: "latest", type: "water" }],
  ["去除这一条饮水", "去除这一条饮水记录", { scope: "latest", type: "water" }],
  ["移除生活事件", "移除刚才的工作记录", { scope: "latest", type: "life_event" }],
  ["按食物定位饮食", "删除刚才吃的锅烧米粉记录", { scope: "latest", type: "meal" }],
  ["午饭消费优先消费", "删除刚才那笔午饭消费记录", { scope: "latest", type: "expense" }],
  ["删除上一条", "删除上一条记录", { scope: "latest", type: null }],
  ["含糊删除", "删除记录", { scope: "ambiguous" }],
  ["否定删除", "不要删除今天的记录", null],
  ["否定去除", "不要去除这条饮水记录", null],
  ["普通聊天", "今天有哪些记录", null]
];
for (const [name, text, expected] of deleteRequestCases) {
  const actual = parser.parseDeleteRequest(text);
  if (expected === null) assert.equal(actual, null, `${name}: should not delete`);
  else assertSubset(actual, expected, name);
  passed += 1;
}

const categoryMatrix = [
  ["公交", "交通"], ["房租", "居住"], ["买药", "医疗健康"], ["电影票", "娱乐"],
  ["买书", "学习办公"], ["买礼物", "人情往来"], ["午饭", "餐饮"], ["买衣服", "购物"]
];
const amountMatrix = [["1元", 1], ["2.5元", 2.5], ["十五元", 15], ["一百元", 100]];
for (const [context, category] of categoryMatrix) {
  for (const [amountText, amount] of amountMatrix) {
    const result = parser.extract(`${context}花了${amountText}`);
    assert.equal(result.entries.length, 1, `${context}${amountText}: entry count`);
    assertSubset(result.entries[0], { type: "expense", data: { amount, category } }, `${context}${amountText}`);
    passed += 1;
  }
}

const waterMatrix = [
  ["喝水250毫升", 250], ["喝了250毫升水", 250], ["饮水250ml", 250], ["补水250ml", 250],
  ["喝了两杯水", 500], ["喝水两杯", 500], ["饮水1升", 1000], ["补水一点五升", 1500]
];
for (const [text, ml] of waterMatrix) {
  const result = parser.extract(text);
  assert.equal(result.entries.length, 1, `${text}: water count`);
  assertSubset(result.entries[0], { type: "water", data: { ml } }, text);
  passed += 1;
}

const exerciseMatrix = ["跑步", "快走", "走路", "散步", "骑车", "游泳", "健身", "力量训练", "瑜伽", "跳绳"];
for (const activity of exerciseMatrix) {
  const result = parser.extract(`${activity}30分钟`);
  assert.equal(result.entries.length, 1, `${activity}: exercise count`);
  assertSubset(result.entries[0], { type: "exercise", data: { activity, minutes: 30 } }, activity);
  passed += 1;
}

const advancedLifeCases = [
  ["入睡起床时间", "昨晚十一点睡到早上七点", { type: "sleep", data: { hours: 8, bedTime: "23:00", wakeTime: "07:00" } }],
  ["冒号入睡时间", "昨晚23:30睡到早上7:15", { type: "sleep", data: { hours: 7.8, bedTime: "23:30", wakeTime: "07:15" } }],
  ["睡眠名词在前", "今日睡眠一点半到九点", { type: "sleep", data: { hours: 7.5, bedTime: "01:30", wakeTime: "09:00" } }],
  ["睡眠区间在前", "记今天 1:30 到 9:00 的睡眠", { type: "sleep", data: { hours: 7.5, bedTime: "01:30", wakeTime: "09:00" } }],
  ["补记睡眠区间", "补记今天一点半至九点的睡眠", { type: "sleep", data: { hours: 7.5, bedTime: "01:30", wakeTime: "09:00" } }],
  ["跨夜名词在前", "今天睡眠23:30到7:00", { type: "sleep", data: { hours: 7.5, bedTime: "23:30", wakeTime: "07:00" } }],
  ["逗号分隔睡眠", "记录昨晚睡眠，零点至今早八点二十", { type: "sleep", data: { hours: 8.3, bedTime: "00:00", wakeTime: "08:20" } }],
  ["重复晚间上下文", "今日晚上睡眠晚上零点至八点二十", { type: "sleep", data: { hours: 8.3, bedTime: "00:00", wakeTime: "08:20" } }],
  ["中文分钟睡眠", "昨晚十一点四十睡到今早七点十分", { type: "sleep", data: { hours: 7.5, bedTime: "23:40", wakeTime: "07:10" } }],
  ["从字睡眠", "记录昨晚睡眠，从零点到今早八点二十", { type: "sleep", data: { hours: 8.3, bedTime: "00:00", wakeTime: "08:20" } }],
  ["半小时睡眠", "昨晚睡了七个半小时", { type: "sleep", data: { hours: 7.5 } }],
  ["小时加分钟睡眠", "睡了6小时30分钟", { type: "sleep", data: { hours: 6.5 } }],
  ["午睡", "午睡半小时", { type: "sleep", data: { hours: 0.5 } }],
  ["睡眠感受", "昨晚睡得不错", { type: "sleep", data: { quality: "不错" } }],
  ["口语睡眠不好", "昨晚没睡好", { type: "sleep", data: { quality: "不好" } }],
  ["睡眠评分", "睡眠质量8分", { type: "sleep", data: { qualityScore: 8 } }],
  ["球类时长前置", "打了一小时羽毛球", { type: "exercise", data: { activity: "羽毛球", minutes: 60 } }],
  ["餐后运动不是饮食", "晚饭后散步30分钟", { type: "exercise", data: { activity: "散步", minutes: 30 } }],
  ["步数", "今天走了六千步", { type: "exercise", data: { activity: "走路", steps: 6000 } }],
  ["动作次数", "做了20个俯卧撑", { type: "exercise", data: { activity: "俯卧撑", reps: 20 } }],
  ["力量组数", "力量训练3组", { type: "exercise", data: { activity: "力量训练", sets: 3 } }],
  ["复合时长", "跑步1小时20分钟", { type: "exercise", data: { activity: "跑步", minutes: 80 } }],
  ["无时长完成运动", "今天去健身了", { type: "exercise", data: { activity: "健身" } }],
  ["跑完步", "刚刚跑完步了", { type: "exercise", data: { activity: "跑步" } }],
  ["通用运动", "刚刚运动了半小时", { type: "exercise", data: { activity: "运动", minutes: 30 } }]
];
for (const [name, text, expected] of advancedLifeCases) {
  const result = parser.extract(text);
  assert.equal(result.entries.length, 1, `${name}: entry count`);
  assertSubset(result.entries[0], expected, name);
  passed += 1;
}

const expandedActivityMatrix = [
  ["步行", "走路"], ["有氧运动", "有氧运动"], ["撸铁", "力量训练"], ["普拉提", "普拉提"],
  ["爬楼梯", "爬楼"], ["爬山", "爬山"], ["拳击", "拳击"], ["太极", "太极"],
  ["跳舞", "跳舞"], ["广场舞", "广场舞"], ["椭圆机", "椭圆机"], ["划船", "划船"]
];
for (const [inputActivity, storedActivity] of expandedActivityMatrix) {
  const result = parser.extract(`${inputActivity}25分钟`);
  assert.equal(result.entries.length, 1, `${inputActivity}: expanded activity count`);
  assertSubset(result.entries[0], { type: "exercise", data: { activity: storedActivity, minutes: 25 } }, inputActivity);
  passed += 1;
}

const durationStyleCases = [
  ["运动半小时", { activity: "运动", minutes: 30 }],
  ["健身一个半小时", { activity: "健身", minutes: 90 }],
  ["跑步45min", { activity: "跑步", minutes: 45 }],
  ["昨晚睡了7h", { hours: 7 }],
  ["睡觉90分钟", { hours: 1.5 }]
];
for (const [text, expectedData] of durationStyleCases) {
  const result = parser.extract(text);
  assert.equal(result.entries.length, 1, `${text}: duration style count`);
  assertSubset(result.entries[0].data, expectedData, text);
  passed += 1;
}

const nonEventCases = [
  "我打算今晚睡8小时",
  "我计划明天跑步30分钟",
  "建议我每天运动30分钟",
  "今天没运动",
  "运动30分钟怎么样？",
  "每天睡8小时好吗？"
];
for (const text of nonEventCases) {
  const result = parser.extract(text);
  assert.equal(result.entries.length, 0, `${text}: future/question must not be recorded`);
  assert.equal(parser.isStructuredRecordRequest(text), false, `${text}: must not route as structured record`);
  passed += 1;
}

assert.equal(parser.isFoodRecordRequest("晚饭后散步30分钟"), false, "餐后运动不能触发餐食分析");
assert.equal(parser.isFoodRecordRequest("吃完饭后跑步20分钟"), false, "吃完饭后运动不能触发餐食分析");
passed += 2;

const contextQuestionCases = [
  ["我睡了多久？", true, false],
  ["我今天走了多少步？", true, false],
  ["这周跑步几次？", true, false],
  ["我喝了多少水？", true, false],
  ["我最近花了多少钱？", true, false],
  ["昨天有哪些记录？", true, false],
  ["总结一下这个月", true, false],
  ["我明天要做什么？", false, true],
  ["还有哪些待办？", false, true],
  ["帮我安排一下明天", false, true],
  ["有什么任务没完成？", false, true],
  ["北京今天天气怎么样？", false, false],
  ["讲个笑话", false, false]
];
for (const [text, life, tasks] of contextQuestionCases) {
  assert.equal(parser.needsLifeContext(text), life, `${text}: life context`);
  assert.equal(parser.needsTaskContext(text), tasks, `${text}: task context`);
  passed += 1;
}

const conversationCases = [
  ["我跑了30分钟", false, false],
  ["我跑了30分钟，感觉怎么样？", true, false],
  ["我今天睡了7小时，你觉得够吗", true, false],
  ["刚喝了500ml水，这样够吗", true, false],
  ["午饭吃了牛肉面，这样合适吗", true, false],
  ["建议我晚上吃什么", true, false],
  ["帮我看看最近的消费", true, false],
  ["你好", true, true],
  ["晚上好！", true, true],
  ["今天花了12元", false, false]
];
for (const [text, conversation, greeting] of conversationCases) {
  assert.equal(parser.expectsConversation(text), conversation, `${text}: conversation routing`);
  assert.equal(parser.isSimpleGreeting(text), greeting, `${text}: greeting routing`);
  passed += 1;
}

const bareMatrix = ["记录", "记录一下", "记下", "记一下", "帮我记", "随手记"];
for (const text of bareMatrix) {
  assert.equal(parser.isBareRecordPrompt(text), true, `${text}: bare prompt`);
  assert.equal(parser.isStructuredRecordRequest(text), false, `${text}: must not be structured`);
  passed += 1;
}

const referenceTime = new Date(2026, 9, 19, 20, 0, 0);
const eventTimeCases = [
  ["明确晚间时间", "晚上七点吃了晚饭", { date: "2026-10-19", hour: 19, minute: 0, timeSource: "explicit" }],
  ["下午冒号时间", "下午3:30跑步30分钟", { date: "2026-10-19", hour: 15, minute: 30, timeSource: "explicit" }],
  ["昨天明确时间", "昨天中午12:30吃了午饭", { date: "2026-10-18", hour: 12, minute: 30, timeSource: "explicit" }],
  ["上午模糊时段", "上午开会讨论了项目", { date: "2026-10-19", hour: 10, minute: 0, timeSource: "period" }],
  ["早上模糊时段", "早上整理了房间", { date: "2026-10-19", hour: 8, minute: 0, timeSource: "period" }],
  ["中午模糊时段", "中午去了趟银行", { date: "2026-10-19", hour: 12, minute: 30, timeSource: "period" }],
  ["下午模糊时段", "下午学习了英语", { date: "2026-10-19", hour: 15, minute: 0, timeSource: "period" }],
  ["傍晚模糊时段", "傍晚去取了快递", { date: "2026-10-19", hour: 18, minute: 0, timeSource: "period" }],
  ["昨天上午模糊时段", "昨天上午打扫了卫生", { date: "2026-10-18", hour: 10, minute: 0, timeSource: "period" }],
  ["前天晚上模糊时段", "前天晚上看了电影", { date: "2026-10-17", hour: 20, minute: 0, timeSource: "period" }],
  ["相对小时", "半小时前喝水250毫升", { date: "2026-10-19", hour: 19, minute: 30, timeSource: "relative" }],
  ["相对分钟", "30分钟前做了拉伸", { date: "2026-10-19", hour: 19, minute: 30, timeSource: "relative" }],
  ["未写时间", "喝水250毫升", { date: "2026-10-19", hour: 20, minute: 0, timeSource: "message" }],
];
for (const [name, text, expected] of eventTimeCases) {
  const actual = parser.resolveEventTime(text, referenceTime);
  const occurred = new Date(actual.occurredAt);
  assert.equal(actual.date, expected.date, `${name}: date`);
  assert.equal(occurred.getHours(), expected.hour, `${name}: hour`);
  assert.equal(occurred.getMinutes(), expected.minute, `${name}: minute`);
  assert.equal(actual.timeSource, expected.timeSource, `${name}: source`);
  passed += 1;
}

const sleepReference = new Date(2026, 9, 21, 8, 27, 0);
const sleepTimingCases = [
  ["凌晨同日起床", "记录昨晚睡眠，零点至今早八点二十", "2026-10-21", 21, 0, 0, 21, 8, 20],
  ["跨午夜睡眠", "昨晚23:30睡到今早8:20", "2026-10-21", 20, 23, 30, 21, 8, 20],
  ["回补昨天睡眠", "记录昨天睡眠，23:30到7:00", "2026-10-20", 19, 23, 30, 20, 7, 0]
];
for (const [name, text, expectedDate, bedDay, bedHour, bedMinute, wakeDay, wakeHour, wakeMinute] of sleepTimingCases) {
  const sleepEntry = parser.extract(text).entries[0];
  assert.ok(sleepEntry, `${name}: parsed sleep`);
  const timing = parser.resolveSleepTiming(sleepEntry.data, sleepEntry.timeContext || text, sleepReference);
  const bedAt = new Date(timing.bedAt);
  const wakeAt = new Date(timing.wakeAt);
  assert.equal(timing.date, expectedDate, `${name}: attributed date`);
  assert.deepEqual([bedAt.getDate(), bedAt.getHours(), bedAt.getMinutes()], [bedDay, bedHour, bedMinute], `${name}: bed timestamp`);
  assert.deepEqual([wakeAt.getDate(), wakeAt.getHours(), wakeAt.getMinutes()], [wakeDay, wakeHour, wakeMinute], `${name}: wake timestamp`);
  passed += 1;
}

const multiEventText = "中午12点喝水300毫升，下午3点跑步30分钟";
const multiEvents = parser.extract(multiEventText).entries;
assert.equal(multiEvents.length, 2, "多事件分句: entry count");
const waterTime = parser.resolveEventTime(multiEvents[0].timeContext, referenceTime);
const exerciseTime = parser.resolveEventTime(multiEvents[1].timeContext, referenceTime);
assert.equal(new Date(waterTime.occurredAt).getHours(), 12, "多事件分句: water hour");
assert.equal(new Date(exerciseTime.occurredAt).getHours(), 15, "多事件分句: exercise hour");
passed += 1;

const earlyReference = new Date(2026, 9, 19, 8, 15, 0);
const clampedMorning = parser.resolveEventTime("上午完成了作业", earlyReference);
assert.equal(new Date(clampedMorning.occurredAt).getHours(), 8, "same-day period must not be placed in the future");
assert.equal(new Date(clampedMorning.occurredAt).getMinutes(), 15, "future period default clamps to message time");
assert.equal(clampedMorning.timeSource, "period");
passed += 3;

const lateReference = new Date(2026, 9, 19, 23, 30, 0);
const bedtime = parser.resolveEventTime("睡前写了日记", lateReference);
assert.equal(new Date(bedtime.occurredAt).getHours(), 22);
assert.equal(new Date(bedtime.occurredAt).getMinutes(), 30);
assert.equal(bedtime.timeSource, "period");
passed += 3;

const foodContext = parser.foodTimeContext("中午12点吃了牛肉面，下午3点跑步30分钟");
assert.equal(foodContext, "中午12点吃了牛肉面", "饮食分句时间上下文");
passed += 1;

console.log(`PASS ${passed} scenarios (${cases.length} record, ${taskCases.length} task, ${routeCases.length} routing)`);
