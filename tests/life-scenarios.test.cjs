const assert = require("node:assert/strict");
const parser = require("../dist/record-parser.js");

let passed = 0;

const completedEvents = [
  "上午开会一小时，讨论了项目进度",
  "今天工作到六点半才下班",
  "下午完成了季度报告",
  "刚刚学习了四十分钟英语",
  "晚上读了三十页书",
  "今天看了两小时网课",
  "下班后整理了书桌",
  "上午打扫了卧室",
  "刚才洗了衣服并晾好了",
  "晚上做了半小时家务",
  "今天做饭四十分钟",
  "饭后洗了碗",
  "下午去了超市",
  "刚刚坐车回家了",
  "到家后收拾了快递盒",
  "今天见了大学同学",
  "晚上和朋友聊了一个小时",
  "下午陪家人去了医院",
  "昨天下午玩了两局游戏",
  "晚上听了一个小时音乐",
  "今天看了一部电影",
  "睡前写了日记",
  "下午休息了二十分钟",
  "中午午睡了半小时",
  "上午晒太阳十五分钟",
  "睡前护肤了",
  "晚上洗澡二十分钟",
  "今天加班到九点",
  "下午眼睛有点干",
  "晚上眼睛不舒服",
  "工作后肩膀很酸",
  "今天颈椎有点疼",
  "上午连续看了三小时电脑",
  "下午写了两个小时代码",
  "今天完成了论文初稿",
  "刚才收到了快递",
  "晚上去了理发店",
  "中午做完了银行业务",
  "下午开始整理照片",
  "晚上结束了今天的学习",
  "起床后做了十分钟冥想",
  "睡前做了呼吸练习",
  "今天去了图书馆",
  "上午到了公司后开会",
  "下班后回家做饭",
  "刚刚见了客户",
  "下午聊了半小时工作",
  "晚上玩了半小时桌游",
  "今天听了两期播客",
  "上午写了三页笔记",
  "下午洗了床单",
  "今天整理了衣柜",
  "刚才打扫了厨房",
  "晚上做了明天的便当",
  "下午去了趟银行",
  "刚刚到了健身房",
  "今天出门办了身份证",
  "下午回家了",
  "昨天下午工作了四小时",
  "今天学习了新的软件用法"
];

for (const text of completedEvents) {
  assert.equal(parser.isUniversalLifeEventCandidate(text), true, `${text}: completed life event`);
  const hasDeterministicRoute = parser.isStructuredRecordRequest(text) || parser.isFoodRecordRequest(text);
  assert.equal(parser.needsAIEventInterpretation(text), !hasDeterministicRoute, `${text}: universal AI must not override a deterministic record route`);
  passed += 2;
}

const nonEvents = [
  "你好",
  "晚上好",
  "建议我晚上吃什么",
  "我今天应该运动吗？",
  "如何改善睡眠？",
  "为什么最近总是累？",
  "我打算今晚整理房间",
  "我计划明天去图书馆",
  "准备周末打扫厨房",
  "想去看电影",
  "可能下午会开会",
  "也许晚上读书",
  "如果今天加班怎么办",
  "假如眼睛不舒服要怎么处理",
  "要是明天下雨就不出门",
  "推荐一部电影",
  "帮我安排明天的工作",
  "请问怎么护眼",
  "能不能给我一个学习计划",
  "可以不记录这句话吗？",
  "查看今天的全部记录",
  "分析一下最近的生活",
  "总结这个月",
  "告诉我今天做了什么",
  "记录一下今天换了床单",
  "记一下今天很忙",
  "随手记今天路上堵车",
  "今天天气不错",
  "这部电影好看吗？",
  "下班后做什么比较好？"
];

for (const text of nonEvents) {
  assert.equal(parser.isUniversalLifeEventCandidate(text), false, `${text}: must not auto-create universal event`);
  passed += 1;
}

const profileChanges = [
  "我想注重我的用眼情况",
  "以后重点关注睡眠",
  "帮我把饮水目标设置成每天2000毫升",
  "回复可以详细一点",
  "建议最多给我三条",
  "语气直接一点",
  "最近重点关注肩颈酸痛",
  "从现在起不要提醒消费",
  "恢复默认个性化设置",
  "我希望主动分析连续出现的问题"
];
for (const text of profileChanges) {
  assert.equal(parser.isProfileChangeRequest(text), true, `${text}: profile change route`);
  assert.equal(parser.needsAIEventInterpretation(text), true, `${text}: profile change needs AI parsing`);
  passed += 2;
}

const profileQueries = [
  "我当前的设置是什么？",
  "现在关注重点有哪些？",
  "我的生活目标是什么？",
  "目前个性化怎么样？",
  "为什么你总是关注饮食？"
];
for (const text of profileQueries) {
  assert.equal(parser.isProfileQuery(text), true, `${text}: profile query route`);
  passed += 1;
}

const deterministicRecords = [
  "喝水300毫升",
  "昨晚睡了7小时",
  "跑步30分钟",
  "公交花了2元",
  "午饭25元",
  "健身45分钟",
  "今天走了6000步",
  "睡眠质量8分",
  "今天睡了7小时",
  "下午跑步30分钟",
  "昨天走了5000步",
  "中午喝水400毫升",
  "今天买衣服花了89元"
];
for (const text of deterministicRecords) {
  assert.equal(parser.isStructuredRecordRequest(text), true, `${text}: local deterministic route`);
  assert.equal(parser.needsAIEventInterpretation(text), false, `${text}: deterministic record must not be hijacked by universal AI`);
  passed += 2;
}

console.log(`PASS ${passed} broad daily-life routing scenarios`);
