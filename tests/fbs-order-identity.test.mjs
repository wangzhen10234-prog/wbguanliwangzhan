import assert from "node:assert/strict";
import test from "node:test";
import { fbsOrderKey } from "../app/_lib/fbs-order-identity.ts";

test("keeps separate WB item orders that share one customer orderUid", () => {
  const first = {
    id: 5584760503,
    orderUid: "i176c6d399813ffecc904f638a7051f19",
    rid: "ecd.i176c6d399813ffecc904f638a7051f19.0.0",
  };
  const second = {
    id: 5584760505,
    orderUid: "i176c6d399813ffecc904f638a7051f19",
    rid: "ecd.i176c6d399813ffecc904f638a7051f19.0.1",
  };

  assert.notEqual(fbsOrderKey(first), fbsOrderKey(second));
  const rows = new Map([first, second].map((order) => [fbsOrderKey(order), order]));
  assert.equal(rows.size, 2);
  assert.deepEqual([...rows.values()].map((order) => order.id), [5584760503, 5584760505]);
});

test("uses rid and then orderUid only when the numeric item order id is absent", () => {
  assert.equal(fbsOrderKey({ rid: "RID.0.1", orderUid: "GROUP" }), "rid:rid.0.1");
  assert.equal(fbsOrderKey({ orderUid: "GROUP" }), "order:group");
  assert.equal(fbsOrderKey({}), "");
});
