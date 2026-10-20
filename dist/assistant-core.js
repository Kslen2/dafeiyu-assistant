(() => {
  "use strict";

  const API_URL = "https://api.deepseek.com/chat/completions";
  const MODEL = "deepseek-flash";
  const usageLog = [];
  const USAGE_STORAGE_KEY = "dafeiyu-api-usage-log-v1";
  const SYSTEM_PROMPT = `你是“大肥鱼助手”，一个克制、具体的个人生活记录与复盘助手。
普通事实记录只需确认保存，不主动说教；但饮食记录是例外，用户描述吃了或喝了什么时应自动做一次粗略营养估算。
用户明确提问、要求总结、上传餐食图片或描述具体饮食时进行相应分析。
用户问候、闲聊或提出一般问题时，要像自然、友好的日常助手一样正常回应，不要把问候说成“已记录”。对纯问候只需简短回应，不引用生活记录或主动生成总结。
饮食估算必须给出一个明确的热量、蛋白质、碳水和脂肪估算值，并说明它只是粗略参考，需要用户确认。
日、周、月总结都必须以传入的数据为依据，不得虚构。总结最多提出五条建议；没有足够依据时宁可少提。
用户的长期偏好是尽量健康、均衡饮食，目前没有食物忌口。不要建议记录体重或心情，也不要追问是否要记录体重或心情。
应用只保存待办，不具备主动通知或定时提醒能力。可以确认待办已保存，但不要承诺稍后提醒、按时间通知或主动联系用户。
你所在的应用支持通过聊天指令和“当天”页面新增、编辑、删除本地记录，但这些操作由应用的确定性代码执行，不是由普通聊天回复执行。只有应用显示的“本地数据操作”结果卡才代表实际落库；结果卡支持查看当天和撤销。普通聊天中绝不能虚构“已保存”“已确认”“已记录”“已删除”或“已经同步”；当用户询问能力时，应说明可以使用明确指令，或在“当天”页面人工维护记录，不要笼统地说应用不能修改或删除记录。
引用待办时必须忠实保留 dueDate 和 done 状态，不得把明天或以后到期的事项说成今天必须完成，也不得把已完成事项说成未完成。
“没有记录”不等于“没有发生”。总结和建议应使用“现有记录显示”“如果这些是全天记录”等措辞，不要把缺失的餐次、饮水或运动直接断言为用户没做。
生活记录可能包含 eventTime（本地事件时间）和 timeSource。explicit/relative 表示用户明确或相对说明了时间；message/legacy 表示用记录时间近似。分析吃饭、运动、睡眠等事件的先后和间隔时应使用 eventTime，并区分时间精度；证据不足时不要推断因果。
普通文字回复使用简洁纯文本，不要使用 Markdown 粗体符号。建议应当具体、简短、可操作，不评价人格，不制造焦虑，不提供医疗诊断。`;

  function publishUsage(items) {
    try { document.documentElement.dataset.apiUsageLog = JSON.stringify(items); } catch { /* ignore */ }
  }

  function readStoredUsage() {
    try { return JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || "[]"); } catch { return []; }
  }

  function recordUsage(operation, payload) {
    const item = { operation, model: MODEL, createdAt: new Date().toISOString(), usage: payload?.usage || {} };
    usageLog.push(item);
    try {
      const stored = [...readStoredUsage(), item].slice(-100);
      localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(stored));
      publishUsage(stored);
    } catch { /* usage logging must never break the user request */ }
  }

  async function requestJson(apiKey, messages, maxTokens = 900, operation = "json") {
    if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        max_tokens: maxTokens
      })
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.error?.message || ""; } catch { /* ignore */ }
      throw new Error(detail || `AI 请求失败（${response.status}）`);
    }
    const payload = await response.json();
    recordUsage(operation, payload);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI 没有返回可用内容");
    try { return JSON.parse(content); } catch { throw new Error("AI 返回的数据格式无法读取"); }
  }

  async function requestText(apiKey, messages, maxTokens = 500, operation = "chat") {
    if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        thinking: { type: "disabled" },
        max_tokens: maxTokens
      })
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.error?.message || ""; } catch { /* ignore */ }
      throw new Error(detail || `AI 请求失败（${response.status}）`);
    }
    const payload = await response.json();
    recordUsage(operation, payload);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI 没有返回可用内容");
    return String(content).trim();
  }

  function normalizeMealResult(result) {
    const uncertainties = Array.isArray(result.uncertainties) ? result.uncertainties.filter(Boolean) : [];
    const foods = Array.isArray(result.foods) && result.foods.length ? result.foods.slice(0, 8) : [result.name || "本次饮食"];
    const recognitionText = `${result.name || ""} ${result.note || ""} ${foods.join(" ")}`;
    const explicitlyNonFood = result.is_food === false || /(?:不是|并非|不属于).{0,8}(?:餐食|食物)|非餐食|无法.{0,8}(?:识别|判断).{0,8}(?:餐食|食物)/.test(recognitionText);
    return {
      isFood: !explicitlyNonFood,
      name: result.name || "本次饮食",
      calories: Math.max(0, Math.round(Number(result.calories) || 0)),
      protein: Math.max(0, Math.round(Number(result.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(result.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(result.fat) || 0)),
      foods,
      needsClarification: result.needs_clarification === true,
      question: String(result.question || "这次主要吃了什么？").trim(),
      note: [result.note, uncertainties.length ? `不确定因素：${uncertainties.slice(0, 2).join("、")}` : ""].filter(Boolean).join(" ")
    };
  }

  function profileContext(profile) {
    if (!profile || typeof profile !== "object") return "";
    return `\n用户当前个性化设置：${JSON.stringify(profile)}\n个性化设置只影响关注重点、语气和建议方式，不得覆盖事实、数据库状态或安全边界。`;
  }

  async function analyzeMeal({ apiKey, text, imageDataUrl, profile = null }) {
    const instruction = `分析这次饮食，输出 JSON，格式必须为：
{
  "is_food":true或false,
  "name":"简短名称",
  "calories":数字,
  "protein":数字,
  "carbs":数字,
  "fat":数字,
  "foods":["识别到的食物与粗略分量"],
  "uncertainties":["影响估算的未知因素"],
  "needs_clarification":true或false,
  "question":"确有必要时，只问一个最关键的问题",
  "note":"一句简短、不过度评价的说明"
}
如果图片不是餐食、无法识别食物或完全看不清，必须令 is_food 为 false，四项营养数值都填 0，并在 note 中直接说明原因，不要猜测食物。
正常餐食令 is_food 为 true。只要能识别出具体食物或饮料，就直接按常见份量给出确定的单点估算，needs_clarification 为 false；不要为了克数、品牌、烹调用油或普通配料逐项追问。
只有完全没有说清吃的是什么，或者关键歧义会让结果失去参考价值时，才令 needs_clarification 为 true，并只提出一个简短问题。所有营养素单位为克，热量单位为千卡。若读取到千焦，必须除以 4.184 换算成千卡。最终热量应与蛋白质×4 + 碳水×4 + 脂肪×9 大致一致，三大营养素总克数也不能明显超过估算食物重量；发现矛盾时应自行修正后再输出。不要输出 JSON 之外的文字。
用户补充：${text || "未提供"}${profileContext(profile)}`;
    const content = [{ type: "text", text: instruction }];
    if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl, detail: "low" } });
    const result = await requestJson(apiKey, [{ role: "user", content }], 800, "meal");
    return normalizeMealResult(result);
  }

  async function reviseMeal({ apiKey, originalText, originalMeal, correction, profile = null }) {
    const instruction = `用户正在修正一张尚未确认的餐食估算卡。请以用户最新补充为最高优先级，重新计算整顿餐食，并只输出 JSON：
{
  "is_food":true或false,
  "name":"修正后的简短名称",
  "calories":数字,
  "protein":数字,
  "carbs":数字,
  "fat":数字,
  "foods":["修正后的食物与粗略分量"],
  "uncertainties":["仍然存在的关键不确定因素"],
  "needs_clarification":true或false,
  "question":"确有必要时，只问一个最关键的问题",
  "note":"一句说明本次按什么信息修正"
}
原始饮食描述：${originalText || "未提供"}
上一次估算：${JSON.stringify(originalMeal || {})}
用户最新补充：${correction || "未提供"}
如果用户提供了小包、半份、一碗、净含量、只吃一部分、食物名称纠正或少油等信息，应直接采用并给出新的单点估算，不要继续追问普通细节。若营养标签使用千焦，必须除以 4.184 换算成千卡。最终热量应与蛋白质×4 + 碳水×4 + 脂肪×9 大致一致，三大营养素总克数不能明显超过修正后的食物重量。只有补充后仍完全无法确定食物或有效份量时，needs_clarification 才为 true。不要输出 JSON 之外的文字。${profileContext(profile)}`;
    const result = await requestJson(apiKey, [{ role: "user", content: instruction }], 800, "meal_revision");
    return normalizeMealResult(result);
  }

  async function interpretLifeEvent({ apiKey, text, entries = [], history = [], profile = null }) {
    const safeEntries = entries.filter((entry) => entry?.id && entry?.type).slice(-30).map((entry) => ({
      id: entry.id,
      type: entry.type,
      date: entry.date,
      eventTime: eventTimeForAI(entry),
      timeSource: entry.timeSource || "legacy",
      timeText: entry.timeText || "",
      data: entry.data,
      sourceText: entry.sourceText || ""
    }));
    const safeHistory = history.filter((item) => item && ["user", "assistant"].includes(item.role) && item.content).slice(-4);
    const instruction = `把用户这句话解释为可由生活记录应用执行的结构化操作。只输出 JSON：
{
  "intent":"record、correct 或 clarify",
  "actions":[
    {
      "op":"create_expense、create_life_event、update_entry 或 propose_profile_update",
      "target_id":"更新时必须使用近期记录中真实存在的 id",
      "data":{
        "amount":正数,
        "direction":"out 或 in",
        "category":"餐饮、交通、购物、居住、医疗健康、娱乐、学习办公、人情往来或其他",
        "subtype":"ordinary、voucher_purchase 或 refund",
        "merchant":"商家，可为空",
        "note":"简短说明",
        "voucher_status":"unused、used、refunded 或 partially_refunded",
        "linked_entry_id":"关联的原消费 id，可为空",
        "ml":"修正饮水时使用",
        "hours":"修正睡眠时使用",
        "bedTime":"修正入睡时间时使用",
        "wakeTime":"修正起床时间时使用",
        "activity":"修正运动项目时使用",
        "minutes":"修正运动时长时使用",
        "km":"修正运动距离时使用",
        "steps":"修正步数时使用",
        "name":"修正已确认餐食名称时使用",
        "calories":"修正已确认餐食热量时使用",
        "protein":"修正蛋白质时使用",
        "carbs":"修正碳水时使用",
        "fat":"修正脂肪时使用",
        "title":"通用生活事件的简短标题",
        "details":"通用生活事件的客观描述",
        "duration_minutes":"通用生活事件明确提及时填写",
        "tags":["通用生活事件标签"],
        "profile_patch":{
          "reset":false,
          "priorities":{"diet":"high、normal、low 或 off","sleep":"high、normal、low 或 off","exercise":"high、normal、low 或 off","finance":"high、normal、low 或 off","tasks":"high、normal、low 或 off","dailyLife":"high、normal、low 或 off"},
          "goals":{"sleepHours":7.5,"waterMl":1800,"exercisePerWeek":3,"dietGoal":"文本"},
          "assistantStyle":{"verbosity":"short、medium 或 detailed","tone":"gentle、direct 或 data_focused","proactivity":"questions_only、patterns_only 或 proactive","maxSuggestions":1到5,"ordinaryRecordReply":"silent 或 brief"},
          "customInstructions":"自由补充说明",
          "customFocus":{"name":"例如用眼情况","priority":"high、normal、low 或 off","signals":["关注信号"],"adviceMode":"summary_only、patterns_only 或 proactive","action":"upsert 或 remove"},
          "temporaryFocus":{"text":"临时重点","expiresAt":"YYYY-MM-DD"}
        }
      }
    }
  ],
  "meal_text":"确实已经进食时填写用于营养分析的食物描述，否则为空字符串",
  "needs_clarification":true或false,
  "question":"确实无法安全执行时只问一个问题"
}
规则：
1. 买餐食团购券、代金券或餐券属于 direction=out、subtype=voucher_purchase、voucher_status=unused 的消费，但不等于已经进食，meal_text 必须为空。
2. 用户明确说“还没吃、未进食、没用券”时绝不能生成饮食。
3. 收到退款属于 direction=in、subtype=refund；尽量用 linked_entry_id 关联近期原消费，并用 update_entry 将原券改成 refunded 或 partially_refunded。
4. 核销或使用餐券不重复记录原券金额；若用户描述了实际吃的食物，放入 meal_text。若没有食物明细，可只问吃了什么。
5. “补差价”只记录实际补付的金额。
6. 用户口头纠错时只能更新近期记录中能够明确定位的一条；不得编造 target_id。可以修正消费、退款、饮水、睡眠、运动和已确认餐食，update_entry.data 只填写需要改变的字段。
7. 金额始终填正数，收支方向用 direction 区分。不得把退款记成支出。
8. 如果目标或金额存在关键歧义，actions 留空并 needs_clarification=true。不要声称操作已经执行。
9. 用户陈述已经发生、但不属于饮食、饮水、睡眠、运动、消费或待办的日常活动时，用 create_life_event 保存；category 可使用学习、工作、家务、社交、娱乐、出行、用眼、身体感受或其他。不要把问题、假设、未来计划保存成已发生事件。
10. 用户要求改变关注重点、目标、回复风格、自定义关注领域或临时重点时，用 propose_profile_update，所有修改放在 data.profile_patch 中。不要直接声称设置已改变，应用还会要求用户确认。
11. “我想关注用眼情况”等自定义领域应生成 customFocus，signals 可包含连续屏幕时长、休息、晚间用眼、户外活动和主观不适；这不代表进行医疗诊断。

用户输入：${text}
近期记录：${JSON.stringify(safeEntries)}
近期对话：${JSON.stringify(safeHistory)}${profileContext(profile)}`;
    const result = await requestJson(apiKey, [{ role: "user", content: instruction }], 900, "event_interpretation");
    const actions = Array.isArray(result.actions) ? result.actions.filter((action) =>
      action && ["create_expense", "create_life_event", "update_entry", "propose_profile_update"].includes(action.op)
    ).slice(0, 6).map((action) => {
      if (action.op !== "create_life_event") return action;
      const data = action.data && typeof action.data === "object" ? { ...action.data } : {};
      if (!data.category) {
        const evidence = `${text} ${data.title || ""} ${data.details || ""} ${Array.isArray(data.tags) ? data.tags.join(" ") : ""}`;
        data.category = /电脑|屏幕|手机|用眼|眼睛|视力/.test(evidence) ? "用眼"
          : /打扫|整理|收拾|洗衣|洗碗|做饭|家务/.test(evidence) ? "家务"
            : /朋友|同学|家人|聊天|聚会|见面|社交/.test(evidence) ? "社交"
              : /工作|项目|报告|开会|加班|客户|公司/.test(evidence) ? "工作"
                : /学习|阅读|网课|英语|论文|笔记|图书馆/.test(evidence) ? "学习"
                  : /游戏|电影|音乐|播客|桌游|娱乐/.test(evidence) ? "娱乐"
                    : /出门|公交|地铁|打车|开车|回家|出行/.test(evidence) ? "出行"
                      : /不舒服|疼|酸|疲劳|头晕/.test(evidence) ? "身体感受"
                        : "其他";
      }
      return { ...action, data };
    }) : [];
    return {
      intent: String(result.intent || "record"),
      actions,
      mealText: String(result.meal_text || "").trim(),
      needsClarification: result.needs_clarification === true,
      question: String(result.question || "").trim()
    };
  }

  function eventTimeForAI(entry) {
    const timestamp = entry.occurredAt || entry.createdAt;
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime())) return entry.date || "";
    const clock = value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${entry.date || value.toLocaleDateString("zh-CN")} ${clock}`;
  }

  async function summarizeDay({ apiKey, entries, tasks = [], profile = null }) {
    const safeEntries = entries.map((entry) => ({ type: entry.type, date: entry.date, eventTime: eventTimeForAI(entry), timeSource: entry.timeSource || "legacy", data: entry.data }));
    const safeTasks = tasks.filter((task) => task?.text).slice(0, 30).map((task) => ({ text: task.text, dueDate: task.dueDate || "", done: Boolean(task.done) }));
    const maxSuggestions = Math.max(1, Math.min(5, Number(profile?.assistantStyle?.maxSuggestions || 5)));
    const prompt = `请根据以下今天的结构化记录生成日总结。只输出 JSON：
{
  "title":"不超过十五字的标题",
  "suggestions":["具体建议1","具体建议2"]
}
建议最多 ${maxSuggestions} 条，可以少于这个数量；没有记录支持的内容不要建议。不要重复罗列数字，因为界面会单独展示。若事件时间足够明确，可留意用餐是否过晚以及用餐和剧烈运动的间隔，但不要强行给出没有依据的结论。
今天的记录：${JSON.stringify(safeEntries)}
今天的待办：${JSON.stringify(safeTasks)}${profileContext(profile)}`;
    const result = await requestJson(apiKey, [{ role: "user", content: prompt }], 700, "summary");
    return {
      title: result.title || "今天有好好留下痕迹",
      suggestions: Array.isArray(result.suggestions) ? result.suggestions.filter(Boolean).slice(0, maxSuggestions) : []
    };
  }

  async function chat({ apiKey, text, history = [], entries = [], tasks = [], profile = null }) {
    const safeHistory = history.filter((item) => item && ["user", "assistant"].includes(item.role) && item.content).slice(-6);
    const safeEntries = entries.map((entry) => ({ type: entry.type, date: entry.date, eventTime: eventTimeForAI(entry), timeSource: entry.timeSource || "legacy", data: entry.data })).slice(-60);
    const safeTasks = tasks.filter((task) => task?.text).slice(-40).map((task) => ({ text: task.text, dueDate: task.dueDate || "", done: Boolean(task.done) }));
    const context = safeEntries.length ? `\n\n以下是近期可能相关的生活记录，其中 eventTime 是本地事件时间。只有在确实有助于回答时才引用，不要生硬复述：\n${JSON.stringify(safeEntries)}` : "";
    const taskContext = safeTasks.length ? `\n\n以下是可能相关的待办事项。只能依据这些待办回答，不要虚构提醒能力：\n${JSON.stringify(safeTasks)}` : "";
    return requestText(apiKey, [...safeHistory, { role: "user", content: `${text}${context}${taskContext}${profileContext(profile)}` }], 500, "chat");
  }

  function getUsageLog() {
    const stored = readStoredUsage();
    return stored.length ? stored : usageLog.map((item) => ({ ...item, usage: { ...item.usage } }));
  }

  function clearUsageLog() {
    usageLog.length = 0;
    try { localStorage.removeItem(USAGE_STORAGE_KEY); } catch { /* ignore */ }
    publishUsage([]);
  }

  publishUsage(readStoredUsage());
  window.FeiyuAI = Object.freeze({ analyzeMeal, reviseMeal, interpretLifeEvent, summarizeDay, chat, getUsageLog, clearUsageLog, model: MODEL });
})();
