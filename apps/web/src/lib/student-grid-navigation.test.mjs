import assert from "node:assert/strict";
import test from "node:test";
import { findGridNeighbor } from "./student-grid-navigation.mjs";

const desktopGrid = [
  { left: 0, top: 0, width: 100, height: 80 },
  { left: 120, top: 0, width: 100, height: 80 },
  { left: 240, top: 0, width: 100, height: 80 },
  { left: 0, top: 100, width: 100, height: 80 },
  { left: 120, top: 100, width: 100, height: 80 },
  { left: 240, top: 100, width: 100, height: 80 },
];

const mobileGrid = Array.from({ length: 6 }, (_, index) => ({
  left: 0,
  top: index * 100,
  width: 320,
  height: 80,
}));

test("moves vertically to the nearest card in a three-column grid", () => {
  assert.equal(findGridNeighbor(desktopGrid, 1, "ArrowDown"), 4);
  assert.equal(findGridNeighbor(desktopGrid, 4, "ArrowUp"), 1);
});

test("moves to the next card vertically in a one-column mobile grid", () => {
  assert.equal(findGridNeighbor(mobileGrid, 2, "ArrowDown"), 3);
  assert.equal(findGridNeighbor(mobileGrid, 2, "ArrowUp"), 1);
  assert.equal(findGridNeighbor(mobileGrid, 2, "ArrowRight"), -1);
});

test("does not wrap focus across grid edges", () => {
  assert.equal(findGridNeighbor(desktopGrid, 0, "ArrowLeft"), -1);
  assert.equal(findGridNeighbor(desktopGrid, 5, "ArrowDown"), -1);
});
