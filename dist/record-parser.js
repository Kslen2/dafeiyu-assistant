(function initRecordParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeiyuRecords = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function recordParserFactory() {
  "use strict";

  const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const NUMBER_SOURCE = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+(?:点[零〇一二三四五六七八九]+)?)";

  function numberFromText(value) {
    if (/^\d/.test(value)) return Number(value);
    const [integerPart, decimalPart = ""] = value.split("点");
    let total = 0;
    let section = 0;
    let current = 0;
    for (const char of integerPart) {
      if (char in CN_DIGITS) current = CN_DIGITS[char];
      else if (char === "十") { section += (current || 1) * 10; current = 0; }
      else if (char === "百") { section += (current || 1) * 100; current = 0; }
      else if (char === "千") { section += (current || 1) * 1000; current = 0; }
      else if (char === "万") { total += (section + current || 1) * 10000; section = 0; current = 0; }
    }
    total += section + current;
    if (decimalPart) total += Number(`0.${[...decimalPart].map((char) => CN_DIGITS[char] ?? "").join("")}`);
    return total;
  }

  function localDateKey(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function resolveEventTime(text, referenceValue = new Date()) {
    const value = String(text || "").trim();
    const reference = new Date(referenceValue);
    const base = Number.isNaN(reference.getTime()) ? new Date() : reference;
    const resolved = new Date(base);
    resolved.setSeconds(0, 0);

    const relativeHourPattern = new RegExp(`(半|${NUMBER_SOURCE})\\s*(?:个)?小时(?:前|之前)`, "i");
    const relativeMinutePattern = new RegExp(`(${NUMBER_SOURCE})\\s*分钟(?:前|之前)`, "i");
    const relativeHour = value.match(relativeHourPattern);
    const relativeMinute = value.match(relativeMinutePattern);
    if (relativeHour || relativeMinute) {
      const minutes = relativeHour
        ? (relativeHour[1] === "半" ? 30 : numberFromText(relativeHour[1]) * 60)
        : numberFromText(relativeMinute[1]);
      resolved.setMinutes(resolved.getMinutes() - minutes);
      return { occurredAt: resolved.toISOString(), date: localDateKey(resolved), timeSource: "relative", timeText: (relativeHour || relativeMinute)[0] };
    }

    const dayOffset = /前晚|前天/.test(value) ? -2 : /昨晚|昨夜|昨天|昨日/.test(value) ? -1 : 0;
    if (dayOffset) resolved.setDate(resolved.getDate() + dayOffset);

    const periodSource = "(前晚|昨晚|昨夜|今早|半夜|凌晨|清晨|早晨|早上|上午|中午|午后|下午|傍晚|晚上|今晚|夜里|睡前|起床后)?";
    const colonPattern = new RegExp(`${periodSource}\\s*(${NUMBER_SOURCE})\\s*[:：]\\s*(\\d{1,2})`, "i");
    const pointPattern = new RegExp(`${periodSource}\\s*(${NUMBER_SOURCE})\\s*点(?:\\s*(半|${NUMBER_SOURCE})\\s*分?)?`, "i");
    const clockMatch = value.match(colonPattern) || value.match(pointPattern);
    if (clockMatch) {
      const period = clockMatch[1] || "";
      let hour = numberFromText(clockMatch[2]);
      const minuteValue = clockMatch[3];
      const minute = minuteValue === "半" ? 30 : minuteValue ? numberFromText(minuteValue) : 0;
      if (/前晚|昨晚|昨夜|午后|下午|傍晚|晚上|今晚|夜里|睡前/.test(period) && hour < 12) hour += 12;
      if (/凌晨/.test(period) && hour === 12) hour = 0;
      if (/中午/.test(period) && hour < 11) hour += 12;
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        resolved.setHours(hour, minute, 0, 0);
        return { occurredAt: resolved.toISOString(), date: localDateKey(resolved), timeSource: "explicit", timeText: clockMatch[0].trim() };
      }
    }

    const periodDefaults = [
      [/前晚|昨晚|昨夜/, 20, 0],
      [/今早/, 7, 0],
      [/半夜/, 0, 30],
      [/凌晨/, 2, 0],
      [/清晨/, 6, 30],
      [/早晨|早上|起床后/, 8, 0],
      [/上午/, 10, 0],
      [/中午/, 12, 30],
      [/午后|下午/, 15, 0],
      [/傍晚/, 18, 0],
      [/晚上|今晚/, 20, 0],
      [/夜里/, 23, 0],
      [/睡前/, 22, 30]
    ];
    const periodDefault = periodDefaults.find(([pattern]) => pattern.test(value));
    if (periodDefault) {
      const [pattern, hour, minute] = periodDefault;
      const periodText = (value.match(pattern) || [""])[0];
      resolved.setHours(hour, minute, 0, 0);
      if (!dayOffset && resolved.getTime() > base.getTime()) resolved.setTime(base.getTime());
      resolved.setSeconds(0, 0);
      return { occurredAt: resolved.toISOString(), date: localDateKey(resolved), timeSource: "period", timeText: periodText };
    }

    return {
      occurredAt: resolved.toISOString(),
      date: localDateKey(resolved),
      timeSource: dayOffset ? "date" : "message",
      timeText: dayOffset ? (value.match(/前天|昨天|昨日/) || [""])[0] : ""
    };
  }

  function expenseCategory(text) {
    if (/打车|出租|网约车|地铁|公交|车费|加油|停车|高铁|火车|机票|共享单车/.test(text)) return "交通";
    if (/药|医院|挂号|体检|牙医|医疗/.test(text)) return "医疗健康";
    if (/房租|水费|电费|燃气|物业|宽带|话费/.test(text)) return "居住";
    if (/电影|游戏|演出|门票|娱乐|会员/.test(text)) return "娱乐";
    if (/课程|书|办公|文具|软件/.test(text)) return "学习办公";
    if (/红包|礼物|请客|人情/.test(text)) return "人情往来";
    if (/饭|餐|咖啡|奶茶|水果|外卖|早餐|午饭|晚饭|米粉|米线|面条|饮料|果汁|夜宵|零食/.test(text)) return "餐饮";
    if (/买|购物|淘宝|衣服|裤|鞋|袜|日用|洗衣液|纸巾|用品/.test(text)) return "购物";
    return "其他";
  }

  function clauseAround(text, start, end) {
    const separators = /[，,。；;！？!?、\n]/;
    let left = start;
    let right = end;
    while (left > 0 && !separators.test(text[left - 1])) left -= 1;
    while (right < text.length && !separators.test(text[right])) right += 1;
    return text.slice(left, right).trim();
  }

  function hasCompletedCue(value, actionSource = "") {
    const action = actionSource ? `(?:${actionSource})` : ".{0,12}";
    return new RegExp(`(?:刚刚|刚才|已经|刚|${action}了|${action}完|${action}结束)`).test(value);
  }

  function isQuestionLike(value) {
    return /[?？]|(?:够吗|好吗|行吗|可以吗|合适吗|有用吗|有效吗|值得吗|值得买吗|会不会|选哪个|怎么|如何)/.test(value);
  }

  function isPlannedOrRecurring(value, actionSource) {
    const action = `(?:${actionSource})`;
    return new RegExp(`(?:打算|计划|准备|预计|希望|想要|想|应该|最好|建议|目标|明天|后天|以后|下次|每天|每日|每晚|每周).{0,16}${action}`).test(value)
      || new RegExp(`${action}.{0,12}(?:计划|安排|目标)`).test(value);
  }

  function isNegatedAction(value, actionSource) {
    const action = `(?:${actionSource})`;
    return new RegExp(`(?:没|没有|未|还没|并未|不曾|不打算|不准备).{0,8}${action}`).test(value)
      || new RegExp(`${action}.{0,8}(?:没做|没去|取消|放弃)`).test(value);
  }

  const ACTIVITY_SOURCE = "打羽毛球|打篮球|踢足球|打乒乓球|打网球|骑自行车|有氧运动|力量训练|动感单车|爬楼梯|俯卧撑|广场舞|跑完步|羽毛球|乒乓球|普拉提|椭圆机|HIIT|慢跑|跑步|跑了|快走|健走|步行|走路|走了|散步|骑车|骑行|骑了|单车|游泳|健身|锻炼|运动|力量|有氧|瑜伽|拉伸|跳绳|篮球|足球|网球|爬楼|爬山|登山|划船|深蹲|卷腹|拳击|太极|跳舞|体操|撸铁|打球";

  function normalizeActivity(value) {
    const names = {
      跑了: "跑步", 跑完步: "跑步", 慢跑: "跑步", 走了: "走路", 健走: "快走", 骑行: "骑车", 单车: "骑车",
      力量: "力量训练", 撸铁: "力量训练", 步行: "走路", 登山: "爬山", 有氧: "有氧运动", 爬楼梯: "爬楼", 骑了: "骑车", 骑自行车: "骑车", 打羽毛球: "羽毛球", 打篮球: "篮球", 踢足球: "足球",
      打乒乓球: "乒乓球", 打网球: "网球", 打球: "球类运动", 锻炼: "运动"
    };
    return names[value] || value;
  }

  function isHypotheticalAction(clause) {
    const action = `(?:睡|入睡|起床|${ACTIVITY_SOURCE})`;
    return isPlannedOrRecurring(clause, `睡|入睡|起床|${ACTIVITY_SOURCE}`)
      || new RegExp(`(?:要不要|能不能|是否|怎么|如何).{0,12}${action}`).test(clause)
      || new RegExp(`(?:没|没有|未|还没|并未)\\s*(?:有)?\\s*${action}`).test(clause)
      || (isQuestionLike(clause) && !hasCompletedCue(clause, `睡|入睡|起床|${ACTIVITY_SOURCE}`))
      || new RegExp(`${action}.{0,14}(?:怎么样|如何|好吗|可以吗|行吗|是否合适|够吗|有用吗|有效吗)[？?]?$`).test(clause);
  }

  function isNonCompletedWater(value) {
    const action = "喝|饮水|补水";
    if (isNegatedAction(value, action) || isPlannedOrRecurring(value, action)) return true;
    if (/(?:记得|提醒我|别忘了|待办).{0,16}(?:喝|饮水|补水)/.test(value)) return true;
    return isQuestionLike(value) && !/(?:刚刚|刚才|已经|刚)?\s*喝了|饮用了|补了水/.test(value);
  }

  function isNonExpenseContext(segment, wholeValue) {
    const value = String(segment || "");
    const explicitCompletedSpend = /花了|消费了?|支付了?|付了|用了|买了|交了|缴了|充了|扣了/.test(value);
    if (/(?:工资|奖金|收入|补贴|报销).{0,10}(?:到账|收到|发了)|(?:别人|朋友|同事|商家).{0,8}(?:转给我|给我转)|(?:收回|收到了?|到账).{0,8}(?:转账|款|钱)/.test(value)) return true;
    if (/(?:没有|没|未|并未|不曾).{0,8}(?:花|消费|支付|付款|买)|(?:不买|没买|取消购买|放弃购买)/.test(value)) return true;
    if (/(?:预算|原价|现价|售价|标价|报价|参考价|价格是)/.test(value)) return true;
    if (/(?:明天|后天|以后|下次|打算|计划|准备|预计|想要)/.test(value) && !explicitCompletedSpend) return true;
    if (isQuestionLike(value) && !explicitCompletedSpend) return true;
    if (/[?？]/.test(wholeValue) && /(?:值得|选哪个|哪个好|便宜|贵不贵|多少钱|几元|价格)/.test(wholeValue) && !explicitCompletedSpend) return true;
    return false;
  }

  function parseMeasurement(value) {
    const text = String(value || "").trim();
    const hours = text.match(new RegExp(`(半|${NUMBER_SOURCE})\\s*(?:个)?\\s*(半)?\\s*(?:小时|钟头|h)(?:\\s*(${NUMBER_SOURCE})\\s*(?:分钟|分|min))?`, "i"));
    if (hours) {
      const baseMinutes = hours[1] === "半" ? 30 : numberFromText(hours[1]) * 60 + (hours[2] ? 30 : 0);
      return { minutes: baseMinutes + (hours[3] ? numberFromText(hours[3]) : 0), unitText: text };
    }
    const simple = text.match(new RegExp(`(${NUMBER_SOURCE})\\s*(分钟|分|min|公里|千米|km|米|步|下|个|次|组)`, "i"));
    if (!simple) return {};
    const amount = numberFromText(simple[1]);
    const unit = simple[2].toLowerCase();
    if (unit === "分钟" || unit === "分" || unit === "min") return { minutes: amount, unitText: text };
    if (["公里", "千米", "km"].includes(unit)) return { km: amount, unitText: text };
    if (unit === "米") return { km: amount / 1000, unitText: text };
    if (unit === "步") return { steps: amount, unitText: text };
    if (unit === "组") return { sets: amount, unitText: text };
    return { reps: amount, unitText: text };
  }

  function clockParts(hourText, colonMinuteText, pointMinuteText, period = "") {
    let hour = numberFromText(hourText);
    const minuteText = colonMinuteText || pointMinuteText || "";
    const minute = minuteText === "半" ? 30 : minuteText ? numberFromText(minuteText) : 0;
    if (/昨晚|昨天晚上|昨夜|晚上|夜里/.test(period)) {
      if (hour === 12) hour = 0;
      else if (hour >= 6 && hour < 12) hour += 12;
    }
    if (/凌晨/.test(period) && hour === 12) hour = 0;
    return { hour, minute };
  }

  function formatClock(parts) {
    return `${String(parts.hour % 24).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }

  function parseSleep(value) {
    const startContext = `(?<startContext>昨天晚上|昨晚|昨夜|前天|昨天|昨日|晚上|夜里|凌晨|今天|今日)?`;
    const endContext = `(?<endContext>前天早上|昨天早上|昨日早上|今天早上|今日早上|今早|早上|早晨|上午|清晨|今天|今日)?`;
    const clockToken = (prefix) => `(?<${prefix}Hour>${NUMBER_SOURCE})(?:\\s*[:：]\\s*(?<${prefix}ColonMinute>\\d{1,2})|\\s*点\\s*(?<${prefix}PointMinute>半|${NUMBER_SOURCE})?\\s*分?)`;
    const startClock = clockToken("start");
    const endClock = clockToken("end");
    const intervalSeparator = `(?:到|至|—|－|-|~|～)`;
    const intervalPatterns = [
      // 昨晚十一点睡到早上七点
      new RegExp(`${startContext}\\s*${startClock}\\s*(?:睡(?:觉)?|入睡|上床)(?:\\s*(?:${intervalSeparator}|，|,|。|；|;)\\s*)?${endContext}\\s*${endClock}(?:\\s*(?:起(?:床)?|醒(?:来|了)?))?`, "i"),
      // 今日睡眠一点半到九点；记录昨晚睡眠，零点至今早八点二十
      new RegExp(`${startContext}\\s*(?:睡眠(?:时间|记录)?|睡觉|睡了?)\\s*(?:是|为)?\\s*(?:[，,：:]\\s*)?(?:从\\s*)?(?<clockContext>昨天晚上|昨晚|昨夜|晚上|夜里|凌晨)?\\s*${startClock}\\s*${intervalSeparator}\\s*${endContext}\\s*${endClock}(?:\\s*(?:起(?:床)?|醒(?:来|了)?))?`, "i"),
      // 记今天 1:30 到 9:00 的睡眠
      new RegExp(`${startContext}\\s*${startClock}\\s*${intervalSeparator}\\s*${endContext}\\s*${endClock}\\s*(?:的)?\\s*(?:睡眠(?:时间|记录)?|睡觉)`, "i")
    ];
    const interval = intervalPatterns.map((pattern) => value.match(pattern)).find(Boolean) || null;
    let data = null;
    let match = interval;
    if (interval && !isHypotheticalAction(clauseAround(value, interval.index, interval.index + interval[0].length))) {
      const groups = interval.groups || {};
      const start = clockParts(groups.startHour, groups.startColonMinute, groups.startPointMinute, groups.clockContext || groups.startContext || "");
      const end = clockParts(groups.endHour, groups.endColonMinute, groups.endPointMinute, groups.endContext || "");
      let startMinutes = start.hour * 60 + start.minute;
      const endMinutes = end.hour * 60 + end.minute;
      let duration = endMinutes - startMinutes;
      if (duration <= 0) duration += 24 * 60;
      if (duration > 14 * 60 && start.hour < 12) {
        startMinutes += 12 * 60;
        duration = endMinutes - startMinutes;
        if (duration <= 0) duration += 24 * 60;
        start.hour += 12;
      }
      if (duration > 0 && duration <= 16 * 60) data = { hours: Math.round(duration / 6) / 10, bedTime: formatClock(start), wakeTime: formatClock(end) };
    }

    if (!data) {
      const durationPattern = new RegExp(`(?:睡(?:了|觉(?:了)?|眠(?:时长)?(?:为|是|有)?)?|午睡(?:了)?|小睡(?:了)?)\\s*(?:大约|大概|约|差不多|将近|只有|只)?\\s*((?:半|${NUMBER_SOURCE})\\s*(?:个)?\\s*(?:半)?\\s*(?:小时|钟头|h)(?:\\s*${NUMBER_SOURCE}\\s*(?:分钟|分|min))?|${NUMBER_SOURCE}\\s*(?:分钟|分|min))`, "i");
      const duration = value.match(durationPattern);
      if (duration && !isHypotheticalAction(clauseAround(value, duration.index, duration.index + duration[0].length))) {
        const measurement = parseMeasurement(duration[1]);
        if (measurement.minutes > 0 && measurement.minutes <= 16 * 60) {
          data = { hours: Math.round(measurement.minutes / 6) / 10 };
          match = duration;
        }
      }
    }

    const score = value.match(/(?:睡眠质量|睡得|睡眠)\s*(?:是|有|为)?\s*([一二三四五六七八九十]|10|[1-9])\s*分/);
    const quality = value.match(/睡得\s*(很好|不错|还行|一般|不好|很差|不太好|挺好)/);
    const poorQuality = value.match(/(?:昨晚|昨天晚上|夜里)?\s*(?:没睡好|睡眠不好)/);
    const qualityMatch = score || quality || poorQuality;
    if (qualityMatch && (poorQuality || !isHypotheticalAction(clauseAround(value, qualityMatch.index, qualityMatch.index + qualityMatch[0].length)))) {
      data = data || {};
      if (score) data.qualityScore = numberFromText(score[1]);
      if (quality) data.quality = quality[1];
      if (poorQuality) data.quality = "不好";
      match = match || qualityMatch;
    }
    if (!data) return null;
    const details = [];
    if (data.hours) details.push(`${data.hours} 小时`);
    if (data.bedTime && data.wakeTime) details.push(`${data.bedTime}–${data.wakeTime}`);
    if (data.qualityScore) details.push(`质量 ${data.qualityScore} 分`);
    else if (data.quality) details.push(`睡得${data.quality}`);
    return { data, label: `睡眠 ${details.join("，") || "已记录"}`, match };
  }

  function resolveSleepTiming(data, text, referenceValue = new Date()) {
    if (!data?.wakeTime || !/^\d{2}:\d{2}$/.test(data.wakeTime)) return resolveEventTime(text, referenceValue);
    const reference = new Date(referenceValue);
    const base = Number.isNaN(reference.getTime()) ? new Date() : reference;
    const value = String(text || "");
    let wakeDayOffset = 0;
    if (/前天(?:早上|早晨|上午|清晨)/.test(value)) wakeDayOffset = -2;
    else if (/(?:昨天|昨日)(?:早上|早晨|上午|清晨)/.test(value)) wakeDayOffset = -1;
    else if (/(?:今早|今天早上|今日早上|今天|今日)/.test(value)) wakeDayOffset = 0;
    else if (/(?:昨晚|昨夜|昨天晚上)/.test(value)) wakeDayOffset = 0;
    else if (/前天/.test(value)) wakeDayOffset = -2;
    else if (/(?:昨天|昨日)/.test(value)) wakeDayOffset = -1;

    const [wakeHour, wakeMinute] = data.wakeTime.split(":").map(Number);
    const wakeAt = new Date(base);
    wakeAt.setDate(wakeAt.getDate() + wakeDayOffset);
    wakeAt.setHours(wakeHour, wakeMinute, 0, 0);

    let bedAt = null;
    if (data.bedTime && /^\d{2}:\d{2}$/.test(data.bedTime)) {
      const [bedHour, bedMinute] = data.bedTime.split(":").map(Number);
      bedAt = new Date(wakeAt);
      bedAt.setHours(bedHour, bedMinute, 0, 0);
      if (bedHour * 60 + bedMinute >= wakeHour * 60 + wakeMinute) bedAt.setDate(bedAt.getDate() - 1);
    }

    return {
      occurredAt: wakeAt.toISOString(),
      date: localDateKey(wakeAt),
      timeSource: "explicit",
      timeText: data.bedTime ? `${data.bedTime}–${data.wakeTime}` : data.wakeTime,
      wakeAt: wakeAt.toISOString(),
      bedAt: bedAt?.toISOString() || ""
    };
  }

  function extract(text) {
    const entries = [];
    const tasks = [];
    const value = String(text || "").trim();

    const sleep = parseSleep(value);
    if (sleep) entries.push({ type: "sleep", data: sleep.data, label: sleep.label, timeContext: clauseAround(value, sleep.match.index, sleep.match.index + sleep.match[0].length) });

    const waterPattern = new RegExp(`(?:喝(?:了)?|饮水(?:量)?|补水)\\s*(?:了\\s*)?(?:(?:一|两|二)\\s*(?:瓶|壶)\\s*)?(?:水\\s*)?(?:大约|大概|约)?\\s*(${NUMBER_SOURCE})\\s*(ml|毫升|升|l|杯)(?=\\s*(?:的?水|[，,。；;！？!?、\\n]|$))`, "gi");
    let match;
    while ((match = waterPattern.exec(value)) !== null) {
      const segment = clauseAround(value, match.index, waterPattern.lastIndex);
      if (isNonCompletedWater(segment)) continue;
      const amount = numberFromText(match[1]);
      const unit = match[2].toLowerCase();
      const ml = unit === "升" || unit === "l" ? amount * 1000 : unit === "杯" ? amount * 250 : amount;
      entries.push({ type: "water", data: { ml }, label: `饮水 ${ml}ml`, timeContext: segment });
    }

    const measurementSource = `(?:(?:半|${NUMBER_SOURCE})\\s*(?:个)?\\s*(?:半)?\\s*(?:小时|钟头|h)(?:\\s*${NUMBER_SOURCE}\\s*(?:分钟|分|min))?|${NUMBER_SOURCE}\\s*(?:分钟|分|min|公里|千米|km|米|步|下|个|次|组))`;
    const exercisePattern = new RegExp(`(${ACTIVITY_SOURCE})[^0-9零〇一二两三四五六七八九十百千半]{0,10}(${measurementSource})`, "gi");
    const reverseExercisePattern = new RegExp(`(?:打|踢|做|练)(?:了)?\\s*(${measurementSource})\\s*(羽毛球|篮球|足球|乒乓球|网球|俯卧撑|深蹲|卷腹|瑜伽|普拉提|力量训练|有氧运动|有氧|拉伸|拳击|太极|跳舞|体操|撸铁)`, "gi");
    const exerciseRanges = [];
    while ((match = exercisePattern.exec(value)) !== null) {
      const segment = clauseAround(value, match.index, exercisePattern.lastIndex);
      if (isHypotheticalAction(segment)) continue;
      const activity = normalizeActivity(match[1]);
      const measurement = parseMeasurement(match[2]);
      const data = { activity, ...measurement };
      delete data.unitText;
      entries.push({ type: "exercise", data, label: `${activity} ${match[2].replace(/\\s+/g, "")}`, timeContext: segment });
      exerciseRanges.push([match.index, exercisePattern.lastIndex]);
    }
    while ((match = reverseExercisePattern.exec(value)) !== null) {
      if (exerciseRanges.some(([start, end]) => match.index < end && reverseExercisePattern.lastIndex > start)) continue;
      const segment = clauseAround(value, match.index, reverseExercisePattern.lastIndex);
      if (isHypotheticalAction(segment)) continue;
      const activity = normalizeActivity(match[2]);
      const measurement = parseMeasurement(match[1]);
      const data = { activity, ...measurement };
      delete data.unitText;
      entries.push({ type: "exercise", data, label: `${activity} ${match[1].replace(/\\s+/g, "")}`, timeContext: segment });
      exerciseRanges.push([match.index, reverseExercisePattern.lastIndex]);
    }

    const clauses = value.split(/[，,。；;！？!?、\\n]/).map((item) => item.trim()).filter(Boolean);
    clauses.forEach((clause) => {
      if (isHypotheticalAction(clause)) return;
      if (entries.some((entry) => entry.type === "exercise" && entry.timeContext === clause)) return;
      const completed = clause.match(new RegExp(`(?:(?:刚刚|刚才).{0,8}(${ACTIVITY_SOURCE})|(?:去|做|练|打|踢)(?:了)?\\s*(${ACTIVITY_SOURCE})(?:了|完|结束)?|(${ACTIVITY_SOURCE})(?:了|完|结束了))`));
      const rawActivity = completed?.[1] || completed?.[2] || completed?.[3];
      if (rawActivity) entries.push({ type: "exercise", data: { activity: normalizeActivity(rawActivity) }, label: `${normalizeActivity(rawActivity)} 已完成`, timeContext: clause });
    });

    const expensePattern = new RegExp(`(${NUMBER_SOURCE})\\s*(块钱|元|块)([零〇一二两三四五六七八九\\d])?(?!钟)`, "g");
    while ((match = expensePattern.exec(value)) !== null) {
      const segment = clauseAround(value, match.index, expensePattern.lastIndex);
      if (isNonExpenseContext(segment, value)) continue;
      const unit = match[2];
      const hasMoneyCue = /花了?|消费|支付|付了?|用了?|价格|票价|车费|收了?|买了?|公交|地铁|打车|房租|水费|电费|燃气|物业/.test(segment);
      const trailingChar = value[expensePattern.lastIndex] || "";
      if (unit === "块" && !match[3] && /[\u4e00-\u9fff]/.test(trailingChar)) continue;
      if (unit === "块" && !match[3] && !hasMoneyCue) continue;
      let amount = numberFromText(match[1]);
      if (unit === "块" && match[3]) amount += (/^\d$/.test(match[3]) ? Number(match[3]) : CN_DIGITS[match[3]]) / 10;
      const segmentCategory = expenseCategory(segment);
      const category = segmentCategory === "其他" ? expenseCategory(value) : segmentCategory;
      entries.push({ type: "expense", data: { amount, category, note: segment.slice(0, 60) }, label: `${category}消费 ¥${amount.toFixed(2).replace(/\.00$/, "")}`, timeContext: segment });
    }

    const unitlessExpensePattern = new RegExp(`(花了?|花费|消费|支付|付了?)\\s*(?:大约|约)?\\s*(${NUMBER_SOURCE})`, "g");
    while ((match = unitlessExpensePattern.exec(value)) !== null) {
      const trailing = value.slice(unitlessExpensePattern.lastIndex).trimStart();
      if (/^(?:元|块钱|块)/.test(trailing)) continue;
      const amount = numberFromText(match[2]);
      const segment = clauseAround(value, match.index, unitlessExpensePattern.lastIndex);
      if (isNonExpenseContext(segment, value)) continue;
      const segmentCategory = expenseCategory(segment);
      const category = segmentCategory === "其他" ? expenseCategory(value) : segmentCategory;
      entries.push({ type: "expense", data: { amount, category, note: segment.slice(0, 60) }, label: `${category}消费 ¥${amount.toFixed(2).replace(/\.00$/, "")}`, timeContext: segment });
    }

    const dueOffset = /后天/.test(value) ? 2 : /明天/.test(value) ? 1 : /今天|今晚/.test(value) ? 0 : null;
    const taskQuery = /[?？]/.test(value) && /(?:待办|要做什么|有什么要做|有什么事|提醒.{0,6}什么)/.test(value)
      || /(?:查看|看看|列出|告诉我).{0,8}(?:待办|任务|事项)/.test(value);
    const todoMatch = taskQuery ? null : value.match(/(?:待办|记得|要做|别忘了|提醒我)[:：]?\s*(.+)/) || value.match(/把\s*(.+?)\s*加入待办/);
    if (todoMatch) {
      const taskText = todoMatch[1].replace(/^(?:今天|今晚|明天|后天)\s*/, "").trim();
      if (taskText) tasks.push({ text: taskText, dueOffset, label: `待办“${taskText}”` });
    }

    return { entries, tasks };
  }

  function isStructuredRecordRequest(text) {
    const result = extract(text);
    return result.entries.length > 0 || result.tasks.length > 0;
  }

  function isFoodRecordRequest(text) {
    const value = String(text || "").trim();
    const hasPastEatingAction = /(?:刚刚|刚才|已经|刚)?\s*(?:吃了|喝了|尝了|吃完|喝完)|来了一(?:份|包|碗|盘|杯)/.test(value);
    const mealSource = "早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|加餐";
    const isFoodHistoryQuestion = /(?:吃了?(?:什么|啥)|(?:今天|昨天|最近).{0,8}(?:吃过|吃了).{0,5}(?:什么|啥)|(?:今天|最近).{0,8}(?:饮食|吃得).{0,8}(?:怎么样|如何|好吗))/.test(value);
    if (isFoodHistoryQuestion) return false;
    const isFoodAdviceQuestion = /(?:吃什么|吃啥|吃得(?:怎么样|如何|好吗)|该吃什么|推荐.{0,12}(?:吃|喝|搭配))/.test(value)
      || new RegExp(`(?:有没有|有没|有什么|求|给我|帮我).{0,14}(?:${mealSource})?.{0,6}(?:推荐|建议)`).test(value)
      || new RegExp(`(?:${mealSource}).{0,14}(?:推荐|建议|吃什么|吃啥|怎么(?:吃|搭配)|如何(?:吃|搭配))`).test(value)
      || new RegExp(`(?:推荐|建议).{0,14}(?:${mealSource}|吃|喝|搭配)`).test(value)
      || /(?:吃|喝|搭配).{0,14}(?:怎么样|合适吗|好吗|行吗|可以吗)|(?:怎么|如何).{0,14}(?:吃|喝|搭配|做)|(?:能|可以).{0,8}(?:做|吃).{0,8}(?:什么|啥|哪种|哪个)/.test(value);
    if (isFoodAdviceQuestion && !hasPastEatingAction) return false;
    const negatedEating = /(?:没|没有|还没|未|并未)\s*(?:有)?\s*(?:吃|喝)(?!完)|(?:不|别)\s*(?:吃|喝)|(?:早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|零食|食物).{0,8}(?:没吃|没有吃|未吃|不吃)|(?:买了?|拿了?).{0,18}(?:还没吃|没有吃|未吃)/.test(value);
    const plannedEating = /(?:明天|后天|以后|下次|打算|计划|准备|预计|想要|想).{0,18}(?:吃|喝|早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵)/.test(value);
    const hypotheticalEating = /^(?:如果|假如|要是)|(?:会不会|要不要|该不该).{0,12}(?:吃|喝)|(?:吃|喝).{0,12}(?:会不会|要不要|该不该)/.test(value);
    if (negatedEating || ((!hasPastEatingAction) && (plannedEating || hypotheticalEating))) return false;
    const hasMealWord = /早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|零食|加餐/.test(value);
    const hasEatingAction = /(?:吃(?:了)?(?!完|饭(?:前|后))|尝了|来了一份|来了一包|来了一碗|来了一盘)/.test(value);
    const hasDrinkAction = /(?:喝了?|饮用|来了一杯).{0,12}(?:酸奶|牛奶|咖啡|奶茶|果汁|西瓜汁|饮料|可乐|豆浆)/.test(value);
    const hasFoodDetails = /米饭|面条|泡面|拉面|米线|粥|馒头|面包|鸡蛋|鸡胸|牛肉|猪肉|鸭肉|鱼肉|虾|蔬菜|水果|苹果|香蕉|薯片|饼干|蛋糕|巧克力|坚果|酸奶|牛奶|豆浆/.test(value);
    const parsed = extract(value);
    const isExpenseOnlyMeal = hasMealWord && parsed.entries.some((entry) => entry.type === "expense") && !hasEatingAction && !hasDrinkAction && !hasFoodDetails;
    const mealUsedOnlyAsTiming = /(?:早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|加餐)(?:前|后)/.test(value)
      && parsed.entries.some((entry) => entry.type === "exercise")
      && !hasEatingAction && !hasDrinkAction && !hasFoodDetails;
    return hasEatingAction || hasDrinkAction || (hasMealWord && !isExpenseOnlyMeal && !mealUsedOnlyAsTiming);
  }

  function isMealEstimateRequest(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    // “热量缺口”和跨整天/整段时间的总量问题需要读取历史记录，不能伪装成一顿新餐食。
    const energyBalanceQuery = /(?:热量|能量).{0,4}(?:缺口|差额|赤字|盈余|结余)|(?:缺口|差额|赤字|盈余|结余).{0,6}(?:热量|能量)|(?:摄入|热量).{0,8}(?:和|与|减|对比).{0,8}(?:消耗|支出)|(?:消耗|支出).{0,8}(?:和|与|减|对比).{0,8}(?:摄入|热量)/.test(value);
    const periodTotalQuery = /(?:今天|今日|昨天|昨日|前天|本周|这周|上周|本月|这个月|全天|整天|最近|过去).{0,16}(?:总摄入|总热量|摄入(?:了)?多少|(?:吃了|喝了)多少(?:热量|千卡|大卡|卡路里)?|多少(?:热量|千卡|大卡|卡路里)|消耗(?:了)?多少|热量(?:总共|一共)|热量情况)|(?:总摄入|总热量|全天(?:摄入|热量)|整天(?:摄入|热量)).{0,12}(?:多少|算|计算|估算|统计|情况)?/.test(value);
    if (energyBalanceQuery || periodTotalQuery) return false;

    const calculateCue = /(?:算|计算|估算|核算|看看|查).{0,14}(?:摄入|热量|千卡|大卡|卡路里)|(?:摄入|热量|千卡|大卡|卡路里).{0,14}(?:多少|怎么算|计算|估算|算一下)|(?:多少|几).{0,6}(?:热量|千卡|大卡|卡路里)/.test(value);
    if (!calculateCue) return false;

    // 允许“算一下热量”承接最近一顿，也允许在同一句里描述具体食物。
    const mealCue = /这顿|这餐|这一顿|这一餐|早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|加餐|零食|刚才|刚刚|吃了|喝了|图片|照片|食物|饮料|果汁|西瓜汁|咖啡|奶茶|牛奶|豆浆|米饭|面|粉|粥|肉|鸡|鸭|鱼|虾|蛋|菜|水果/.test(value);
    const bareFollowUp = /^(?:帮我)?(?:算|计算|估算)(?:一下)?(?:这(?:个|顿|餐|次))?(?:的)?(?:摄入|热量|千卡|大卡|卡路里)[吧。！!？?]*$/.test(value);
    return mealCue || bareFollowUp || isFoodRecordRequest(value);
  }

  function isMealCorrectionRequest(text) {
    const value = String(text || "").trim();
    if (!value || value.length > 180) return false;
    const correctionCue = /其实|实际|应该|大概|大约|约莫|不是|改成|算作|只有|只吃|没吃完|剩了|不足|不到|少于|多于|一半|半份|半包|小包装|大包装|净含量|营养成分|没有那么多|没那么多/;
    const mealCue = /克|千克|公斤|g\b|kg\b|毫升|ml\b|升\b|包|碗|盘|份|杯|口|根|片|个|食物|餐|饭|面|粉|粥|肉|鸡|鸭|鱼|虾|蛋|奶|水果|蔬菜|零食|饮料|油|糖|酱|热量|蛋白质|碳水|脂肪|营养|吃/i;
    return correctionCue.test(value) && mealCue.test(value);
  }

  function isMealConfirmationRequest(text) {
    const value = String(text || "").trim();
    if (!value || value.length > 40 || /[?？]/.test(value)) return false;
    if (/^(?:没|不|别|暂不|先不).*(?:确认|保存|计入)|^(?:取消|算了|不用了|不记了|先不记)/.test(value)) return false;
    return /^(?:确认|确定|可以|没问题|就这样)(?:并)?(?:保存|计入)?(?:这(?:笔|条|份)?)?(?:(?:消费|饮食|餐食)(?:与|和|、)?){0,2}(?:记录)?(?:了|吧)?[。！!]*$/.test(value);
  }

  function isMealClarificationCancellation(text) {
    return /^(?:取消|算了|不用了|不分析了|不记了|先不记了|先这样)[。！!]*$/.test(String(text || "").trim());
  }

  function isMealClarificationResponse(text) {
    const value = String(text || "").trim();
    if (!value || value.length > 240 || isMealClarificationCancellation(value)) return false;
    if (/[?？]/.test(value) || /^(?:你好|嗨|哈喽|总结|删除|清空|待办|提醒我|记录一下)/.test(value)) return false;
    return /(?:个|份|碗|盘|杯|包|克|两|半|大|中|小|套餐|汉堡|鸡|肉|鱼|虾|蛋|饭|面|粉|粥|薯|菜|汤|饮料|可乐|咖啡|奶茶|果汁|没吃完|吃了)/.test(value);
  }

  function needsAIEventInterpretation(text) {
    const value = String(text || "").trim();
    if (!value || isSimpleGreeting(value)) return false;
    const voucherEvent = /团购券|代金券|餐券|券码|核销|补差价/.test(value);
    const refundEvent = /(?:收到|获得|退回|退了|到账|成功|已经|刚刚|刚才).{0,12}(?:退款|退钱|返款)|(?:退款|退钱|返款).{0,12}(?:收到|退回|到账|成功)/.test(value);
    const spokenCorrection = /(?:改成|改为|修改|更正|记错|不对|其实|应该是|不是.{0,12}是)/.test(value)
      && /(?:刚才|刚刚|上一(?:条|笔)|最近一(?:条|笔)|那(?:条|笔|次|顿)|这(?:条|笔|次|顿)|之前)/.test(value);
    const universalEvent = isUniversalLifeEventCandidate(value) && !isStructuredRecordRequest(value) && !isFoodRecordRequest(value);
    return voucherEvent || refundEvent || spokenCorrection || isProfileChangeRequest(value) || universalEvent;
  }

  function isProfileChangeRequest(text) {
    const value = String(text || "").trim();
    if (!value || /[?？]/.test(value)) return false;
    const settingCue = /(?:以后|从现在起|接下来|最近|未来|帮我|我想|希望|设置|改成|调整|取消|不要再|恢复默认|回复|建议|语气)/;
    const preferenceCue = /(?:重点关注|注重|关注|目标|建议.{0,6}条|回复.{0,6}(?:简短|详细)|语气|直接一点|温和一点|主动分析|不要提醒|普通记录|个性化|生活重点|饮食目标|睡眠目标|饮水目标|运动目标)/;
    return settingCue.test(value) && preferenceCue.test(value);
  }

  function isProfileQuery(text) {
    const value = String(text || "").trim();
    return /(?:当前|现在|目前|已经).{0,8}(?:设置|关注|目标|偏好)|(?:设置|关注重点|生活目标|个性化).{0,8}(?:是什么|有哪些|怎么样)|为什么.{0,12}(?:建议|关注|提醒)/.test(value);
  }

  function isUniversalLifeEventCandidate(text) {
    const value = String(text || "").trim();
    if (!value || value.length > 260 || /[?？]/.test(value)) return false;
    if (/^(?:我\s*)?(?:如果|假如|要是|打算|计划|准备|想要|想去|可能|也许|建议|推荐|帮我|请问|怎么|为什么|如何|能不能|可以不)/.test(value)) return false;
    if (/^(?:删除|清空|总结|分析|查看|告诉我|记录一下|记一下|随手记)/.test(value)) return false;
    if (/(?:打算|计划|准备|预计|可能|也许|想要|想去).{0,24}(?:去|开始|结束|完成|做|看|读|学|工作|开会|整理|收拾|打扫|洗|买|见|聊|玩|听|写|休息|护肤|洗澡|做饭|加班|上班|出门|回家)/.test(value)) return false;
    if (/(?:没|没有|未|还没|并未).{0,12}(?:去|完成|做|看|读|学习|工作|开会|整理|收拾|打扫|洗|买|见|聊|玩|听|写)/.test(value)) return false;
    const timedCompletedEvent = /(?:刚刚|刚才|刚|今天|上午|中午|下午|晚上|昨晚|昨天(?:上午|中午|下午|晚上)?|下班后|工作后|久坐后|用眼后|睡前|起床后|到家后|饭后|连续).{0,36}(?:去了|到了|开始|结束|完成|做了|做完|看了|读了|学了|学习|工作|开会|开完会|开了(?:个|一场)?会|通勤|坐车|整理|收拾|打扫|洗了|买了|收到|见了|聊了|玩了|听了|写了|休息|午睡|晒太阳|护肤|洗澡|做饭|做家务|加班|下班|上班|出门|回家|眼睛|肩膀|颈椎|腰|背|手腕|不舒服|疼|酸|干|累|胀)/.test(value);
    const explicitCompletedEvent = /(?:整理了|收拾了|打扫了|完成了|看了|读了|学习了|工作了|开完会|开了(?:个|一场)?会|买了|收到了?|见了|聊了|玩了|听了|写了|洗了|做了|去了|回家了|到家了)/.test(value);
    const bodySignal = /(?:眼睛|肩膀|颈椎|腰|背|手腕).{0,10}(?:不舒服|疼|痛|酸|干|涩|累|胀)/.test(value);
    return timedCompletedEvent || explicitCompletedEvent || bodySignal;
  }

  function parseDeleteRequest(text) {
    const value = String(text || "").trim();
    if (!/(?:删除|删掉|删了|去除|移除|清除|清空)/.test(value) || /(?:不要(?:删除|去除|移除)|别(?:删除|去除|移除)|不用(?:删除|去除|移除))/.test(value)) return null;

    const typeRules = [
      ["expense", /消费|花销|支出|付款|金额/],
      ["water", /饮水|喝水|补水/],
      ["exercise", /运动|锻炼|跑步|健身|散步|骑行|游泳/],
      ["sleep", /睡眠|睡觉|睡了/],
      ["meal", /饮食|餐食|早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|零食|食物|热量|吃了|吃的|咖啡|奶茶|米饭|米粉|米线|面条|面包|鸡蛋|肉|鱼|虾/],
      ["life_event", /生活事件|工作记录|学习记录|家务记录|社交记录|娱乐记录|出行记录|用眼记录|身体感受/],
      ["note", /笔记|随手记/]
    ];
    const type = typeRules.find(([, pattern]) => pattern.test(value))?.[0] || null;
    const dateOffset = /昨天|昨日/.test(value) ? -1 : /今天|今日|当天/.test(value) ? 0 : null;
    const wantsAll = /所有|全部|全都|都删|清空/.test(value);
    const amountMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块)/) || value.match(/消费\s*(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? Number(amountMatch[1]) : null;

    if (wantsAll && dateOffset !== null) return { scope: type ? "day_type_all" : "day_all", type, dateOffset, amount: null };
    const hasLocator = /刚才|刚刚|上一条|最近一条|这条|那条|这一条|那一条|这笔|那笔/.test(value);
    if (type || hasLocator || amount !== null) return { scope: "latest", type, dateOffset, amount };
    return { scope: "ambiguous", type: null, dateOffset, amount: null };
  }

  function foodTimeContext(text) {
    const value = String(text || "").trim();
    const clauses = value.split(/[，,。；;！？!?\n]/).map((item) => item.trim()).filter(Boolean);
    return clauses.find((clause) => /早餐|早饭|午餐|午饭|晚餐|晚饭|夜宵|零食|加餐|吃了?|尝了|来了一份|来了一包|来了一碗|来了一盘|喝了?|饮用|来了一杯/.test(clause)) || value;
  }

  function isBareRecordPrompt(text) {
    return /^(?:记录一下|记录|记下|记一下|帮我记|随手记)[吧。！!？?]*$/.test(String(text || "").trim());
  }

  function isExplicitNoteRequest(text) {
    const value = String(text || "").trim();
    return !isBareRecordPrompt(value) && /^(?:记录一下|记录|记下|记一下|帮我记|随手记)[:：]?\s*.+/.test(value);
  }

  function needsLifeContext(text) {
    const value = String(text || "");
    const domain = /(?:睡眠|睡了|睡觉|起床|运动|锻炼|跑步|散步|健身|步数|多少步|走了|饮食|饮水|喝水|喝了.{0,6}水|吃得|吃饭|用餐|早餐|午饭|午餐|晚饭|晚餐|夜宵|餐食|热量|消费|花销|花了|支出|多少钱|生活记录|生活状态|周总结|月总结)/.test(value);
    const periodLifeQuery = /(?:最近|今天|昨天|前天|这周|本周|本月|这个月|上周).{0,12}(?:记录|总结|状态|生活|怎么样|做了什么|发生了什么)/.test(value)
      || /总结.{0,8}(?:今天|昨天|本周|这周|本月|这个月|上周)/.test(value);
    const clearlyUnrelated = /(?:天气|气温|下雨|新闻|股票|代码|编程|电影|电视剧|游戏|路线|快递到哪)/.test(value);
    return domain || (periodLifeQuery && !clearlyUnrelated);
  }

  function needsTaskContext(text) {
    return /(?:待办|要做的事|要做什么|要干什么|有什么要做|有什么事|安排|计划|事项|任务)/.test(String(text || ""));
  }

  function expectsConversation(text) {
    return /[?？]|^(?:你好|嗨|哈喽|hello|hi|在吗|早上好|下午好|晚上好)|(?:怎么样|怎么办|你觉得|建议|可以吗|能不能|为什么|如何|聊聊|分析一下|帮我看看)/i.test(String(text || "").trim());
  }

  function isSimpleGreeting(text) {
    return /^(?:你好|嗨|哈喽|hello|hi|在吗|早上好|下午好|晚上好)[!！。,.，?？~～]*$/i.test(String(text || "").trim());
  }

  return { numberFromText, resolveEventTime, resolveSleepTiming, expenseCategory, extract, isStructuredRecordRequest, isFoodRecordRequest, isMealEstimateRequest, isMealCorrectionRequest, isMealConfirmationRequest, isMealClarificationCancellation, isMealClarificationResponse, needsAIEventInterpretation, isProfileChangeRequest, isProfileQuery, isUniversalLifeEventCandidate, parseDeleteRequest, foodTimeContext, isBareRecordPrompt, isExplicitNoteRequest, needsLifeContext, needsTaskContext, expectsConversation, isSimpleGreeting };
});
