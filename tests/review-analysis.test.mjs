import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProductReviews, classifyReviewIssues, orderStatusLabel, reviewIssueLabel } from "../app/_lib/review-analysis.ts";

const feedbacks = [
  { id: "f1", nmId: 1, rating: 1, text: "Товар сломан, упаковка помята", pros: "", cons: "Плохое качество", answered: false, orderStatus: "returned" },
  { id: "f2", nmId: 1, rating: 3, text: "Размер слишком маленький и не соответствует фото", pros: "", cons: "", answered: true, orderStatus: "buyout" },
  { id: "f3", nmId: 1, rating: 5, text: "Отлично", pros: "Удобный", cons: "", answered: true, orderStatus: "buyout" },
];
const questions = [
  { id: "q1", nmId: 1, text: "Как установить?", answered: false },
  { id: "q2", nmId: 1, text: "Какой размер?", answered: true },
];

test("calculates the real star distribution and response metrics", () => {
  const result = analyzeProductReviews(feedbacks, questions);
  assert.equal(result.total, 3);
  assert.equal(result.starCounts[1], 1);
  assert.equal(result.starCounts[3], 1);
  assert.equal(result.starCounts[5], 1);
  assert.equal(result.averageRating, 3);
  assert.equal(result.low, 2);
  assert.equal(result.critical, 1);
  assert.equal(result.positiveRate, 1 / 3 * 100);
  assert.equal(result.unansweredFeedbacks, 1);
  assert.equal(result.unansweredQuestions, 1);
  assert.equal(result.returnedFeedbacks, 1);
  assert.equal(result.responseRate, 3 / 5 * 100);
  assert.equal(result.priority, "high");
});

test("turns only observed review and question text into issue suggestions", () => {
  const result = analyzeProductReviews(feedbacks, questions);
  const issueKeys = new Set(result.issues.map((issue) => issue.key));
  assert.equal(issueKeys.has("quality"), true);
  assert.equal(issueKeys.has("packaging"), true);
  assert.equal(issueKeys.has("size"), true);
  assert.equal(issueKeys.has("mismatch"), true);
  assert.equal(issueKeys.has("usage"), true);
  assert.ok(result.recommendations.some((item) => item.title.includes("一至二星")));
  assert.ok(result.recommendations.some((item) => item.title.includes("未回答提问")));
});

test("does not invent a quality problem when no keyword was observed", () => {
  assert.deepEqual(classifyReviewIssues("Отличный товар, спасибо"), []);
  assert.equal(reviewIssueLabel("quality"), "质量/损坏");
});

test("translates only official WB order status values", () => {
  assert.equal(orderStatusLabel("buyout"), "已购买");
  assert.equal(orderStatusLabel("returned"), "已退货");
  assert.equal(orderStatusLabel("rejected"), "已拒收");
  assert.equal(orderStatusLabel("unknown"), "平台未标记");
});
