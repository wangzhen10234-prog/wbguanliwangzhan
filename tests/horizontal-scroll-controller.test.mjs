import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("covers every wide data-table wrapper with the global horizontal controller", async () => {
  const source = await readFile(new URL("../app/_components/horizontal-scroll-controller.tsx", import.meta.url), "utf8");
  const expectedWrappers = [
    "table-wrap",
    "product-detail-table-wrap",
    "order-detail-table-wrap",
    "finance-movement-table-wrap",
    "pricing-table-scroll",
    "promotion-table-wrap",
    "returns-table-wrap",
    "advertising-table-wrap",
    "advertising-dialog-table-wrap",
    "audit-table-wrap",
    "price-table-wrap",
    "review-table-wrap",
  ];

  for (const wrapper of expectedWrappers) assert.match(source, new RegExp(`\\.${wrapper}`));
  assert.match(source, /type="range"/);
  assert.doesNotMatch(source, /<button/);
  assert.doesNotMatch(source, /site-horizontal-scroller-label/);
  assert.match(source, /拖动以左右查看数据/);
});

test("mounts the controller site-wide and keeps a visible native horizontal thumb", async () => {
  const [layout, css] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<HorizontalScrollController \/>/);
  assert.match(css, /::-webkit-scrollbar-thumb:horizontal/);
  assert.match(css, /\.site-horizontal-scroller\{/);
  assert.match(css, /\.site-horizontal-scroller\[hidden\]\{display:none\}/);
});
