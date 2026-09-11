import assert from "node:assert/strict";
import test from "node:test";
import { conversionsFor, groupMarketProducts, summarizeMarketProducts } from "../app/_lib/market-analytics.ts";

const base = {
  brand: "", productRating: 9, feedbackRating: 5, stock: 12,
  openDynamic: null, cartDynamic: null, orderDynamic: null, orderSumDynamic: null,
  addToCartPercent: 0, cartToOrderPercent: 0, orderFromOpenPercent: 0, buyoutPercent: 0,
};

test("calculates store funnel totals without averaging product percentages", () => {
  const products = [
    { ...base, nmId: 1, sku: "A", title: "A", subjectId: 10, subjectName: "牵引绳", openCount: 100, cartCount: 20, orderCount: 10, orderSum: 500, buyoutCount: 8, buyoutSum: 400, cancelCount: 2, cancelSum: 100, addToWishlist: 5 },
    { ...base, nmId: 2, sku: "B", title: "B", subjectId: 10, subjectName: "牵引绳", openCount: 50, cartCount: 5, orderCount: 1, orderSum: 50, buyoutCount: 1, buyoutSum: 50, cancelCount: 0, cancelSum: 0, addToWishlist: 2 },
  ];
  const summary = summarizeMarketProducts(products);
  assert.equal(summary.openCount, 150);
  assert.equal(summary.orderCount, 11);
  assert.equal(summary.orderSum, 550);
  assert.equal(summary.orderFromOpenPercent, 7.3);
  assert.equal(summary.buyoutPercent, 81.8);
  assert.equal(summary.stock, 24);
});

test("groups product metrics by WB subject and derives conversions from group totals", () => {
  const products = [
    { ...base, nmId: 1, sku: "A", title: "A", subjectId: 10, subjectName: "牵引绳", openCount: 100, cartCount: 20, orderCount: 10, orderSum: 500, buyoutCount: 8, buyoutSum: 400, cancelCount: 2, cancelSum: 100, addToWishlist: 5 },
    { ...base, nmId: 2, sku: "B", title: "B", subjectId: 20, subjectName: "清洁用品", openCount: 200, cartCount: 10, orderCount: 4, orderSum: 120, buyoutCount: 3, buyoutSum: 90, cancelCount: 1, cancelSum: 30, addToWishlist: 8 },
  ];
  const categories = groupMarketProducts(products);
  assert.equal(categories.length, 2);
  assert.equal(categories[0].subjectName, "牵引绳");
  assert.equal(categories[0].orderFromOpenPercent, 10);
  assert.equal(categories[1].addToCartPercent, 5);
});

test("uses zero-safe conversion formulas", () => {
  assert.deepEqual(conversionsFor({ openCount: 0, cartCount: 0, orderCount: 0, orderSum: 0, buyoutCount: 0, buyoutSum: 0, cancelCount: 0, cancelSum: 0, addToWishlist: 0 }), {
    addToCartPercent: 0,
    cartToOrderPercent: 0,
    orderFromOpenPercent: 0,
    buyoutPercent: 0,
  });
});
