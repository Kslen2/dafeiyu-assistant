(function initConversationRouter(root, factory) {
  const records = typeof module === "object" && module.exports ? require("./record-parser.js") : root.FeiyuRecords;
  const api = factory(records);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeiyuConversationRouter = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function conversationRouterFactory(records) {
  "use strict";

  const MUTATING_ROUTES = new Set([
    "delete", "profile_confirm", "profile_cancel", "meal_confirm",
    "meal_clarification_cancel", "meal_clarification_response", "meal_correction",
    "ai_event", "food_record", "structured_record"
  ]);

  function result(route, intent, reason, extra = {}) {
    return Object.freeze({
      route,
      intent,
      reason,
      allowsMutation: MUTATING_ROUTES.has(route),
      ...extra
    });
  }

  function routeMessage({
    text = "",
    hasPhoto = false,
    hasPendingProfile = false,
    hasPendingMeal = false,
    hasPendingMealClarification = false
  } = {}) {
    const value = String(text || "").trim();
    if (hasPhoto) return result("photo", "record", "attached_photo");

    const deleteRequest = records.parseDeleteRequest(value);
    if (deleteRequest) return result("delete", "mutation", "explicit_delete", { deleteRequest });
    if (/总结(?:一下)?今天|今日总结/.test(value)) return result("day_summary", "query", "explicit_day_summary");
    if (records.isBareRecordPrompt(value)) return result("bare_record", "conversation", "record_prompt_without_content");

    const intent = records.classifyUserIntent(value);
    const genericConfirmation = records.isMealConfirmationRequest(value);
    const genericCancellation = records.isMealClarificationCancellation(value);
    const explicitProfileConfirmation = /^(?:确认|确定|应用|保存)(?:这次)?(?:个性化设置|偏好设置|个性化|偏好|设置)(?:修改|调整)?[。！!]*$/.test(value);
    const explicitProfileCancellation = /^(?:取消|放弃|不应用)(?:这次)?(?:个性化设置|偏好设置|个性化|偏好|设置)(?:修改|调整)?[。！!]*$/.test(value);
    const explicitMealConfirmation = /^(?:确认|确定|保存|计入)(?:这次|这份|这顿|这条)?(?:餐食|饮食|饭菜|营养)(?:记录|估算)?[。！!]*$/.test(value);
    const explicitMealCancellation = /^(?:取消|放弃|不保存|不计入)(?:这次|这份|这顿|这条)?(?:餐食|饮食|饭菜|营养)(?:记录|估算)?[。！!]*$/.test(value);
    const pureQuery = intent === "query";

    if (hasPendingProfile && explicitProfileConfirmation) return result("profile_confirm", "mutation", "explicitly_confirm_pending_profile");
    if (hasPendingProfile && explicitProfileCancellation) return result("profile_cancel", "mutation", "explicitly_cancel_pending_profile");
    if (hasPendingMeal && explicitMealConfirmation) return result("meal_confirm", "mutation", "explicitly_confirm_pending_meal");
    if (hasPendingMealClarification && explicitMealCancellation) return result("meal_clarification_cancel", "mutation", "explicitly_cancel_pending_meal_clarification");
    if (genericConfirmation && hasPendingProfile && hasPendingMeal) {
      return result("pending_action_conflict", "conversation", "profile_and_meal_both_pending");
    }
    if (genericCancellation && hasPendingProfile && hasPendingMealClarification) {
      return result("pending_action_conflict", "conversation", "profile_and_meal_clarification_both_pending");
    }
    if (hasPendingProfile && genericConfirmation) return result("profile_confirm", "mutation", "confirm_pending_profile");
    if (hasPendingProfile && genericCancellation) return result("profile_cancel", "mutation", "cancel_pending_profile");
    if (hasPendingMeal && genericConfirmation) return result("meal_confirm", "mutation", "confirm_pending_meal");

    // 独立查询永远不会被旧的待补充/待修正餐食上下文接管。
    if (!pureQuery && hasPendingMealClarification && genericCancellation) {
      return result("meal_clarification_cancel", "mutation", "cancel_pending_meal_clarification");
    }
    if (!pureQuery && hasPendingMealClarification && records.isMealClarificationResponse(value)) {
      return result("meal_clarification_response", "mutation", "answer_pending_meal_clarification");
    }
    if (genericConfirmation || explicitMealConfirmation || explicitProfileConfirmation) return result("meal_confirmation_missing", "conversation", "no_unambiguous_pending_action");
    if (!pureQuery && hasPendingMeal && records.isMealCorrectionRequest(value)) {
      return result("meal_correction", "mutation", "correct_pending_meal");
    }

    if (records.isProfileQuery(value)) return result("profile_query", "query", "profile_information_query");
    if (intent === "ambiguous_record" && records.needsAIEventInterpretation(value)) {
      return result("ai_event", intent, "ambiguous_event_requires_structured_ai");
    }
    if (records.isMealEstimateRequest(value)) return result("meal_estimate", intent, "explicit_meal_estimate");
    if (records.isFoodRecordRequest(value)) return result("food_record", intent, "completed_food_event");
    if (records.isStructuredRecordRequest(value) || records.isExplicitNoteRequest(value)) {
      return result("structured_record", intent, "deterministic_local_record", { replyAfterMutation: records.expectsConversation(value) });
    }
    if (pureQuery) return result("query_chat", intent, "standalone_information_query");
    return result("chat", intent, "ordinary_conversation");
  }

  function assertRouteSafety(decision) {
    if (!decision || typeof decision !== "object") throw new Error("缺少路由结果");
    if (decision.intent === "query" && decision.allowsMutation) throw new Error(`查询不能进入写入路由：${decision.route}`);
    return decision;
  }

  return Object.freeze({ routeMessage, assertRouteSafety, mutatingRoutes: Object.freeze([...MUTATING_ROUTES]) });
});
