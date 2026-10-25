import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync("miniprogram/utils/table-layout.js", "utf8");
const context = { module: { exports: {} } };
vm.runInNewContext(source, context);
const { seatLayout } = context.module.exports;

test("actual player count, own seat at bottom, and original indices stay intact", () => {
  for (let count = 1; count <= 9; count++) {
    const players = Array.from({ length: count }, (_, id) => ({ id, folded: true, stack: 0 }));
    const before = JSON.stringify(players);
    for (let own = 0; own < count; own++) {
      const seats = seatLayout(players, own);
      assert.equal(seats.length, count);
      assert.equal(seats[0].index, own);
      assert.equal(seats[0].x, 50);
      assert.equal(seats[0].y, 84);
      assert.equal(new Set(seats.map((seat) => seat.index)).size, count);
      seats.forEach((seat, offset) => {
        assert.equal(seat.index, (own + offset) % count);
        assert.ok(seat.x >= 14 && seat.x <= 86);
        assert.ok(seat.y >= 12 && seat.y <= 84);
      });
    }
    assert.equal(JSON.stringify(players), before);
  }
});

test("heads up sits opposite and empty room has no seats", () => {
  assert.equal(seatLayout([], null).length, 0);
  const seats = seatLayout([{ id: "a" }, { id: "b" }], "b");
  assert.equal(seats[1].y, 16);
  assert.ok(Math.abs(seats[1].x - 50) < 0.001);
  assert.equal(seats[1].index, 0);
});

test("browser and native entry points expose the same layout", () => {
  const browser = {};
  vm.runInNewContext(source, browser);
  const players = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(JSON.stringify(browser.TableLayout.seatLayout(players, "c")), JSON.stringify(seatLayout(players, "c")));
});
