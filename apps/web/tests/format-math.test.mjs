import test from "node:test";
import assert from "node:assert/strict";
import { formatHtmlMath } from "../src/lib/format-math.mjs";

test("formats inline math equations with exponents and equals sign", () => {
  const result = formatHtmlMath("Contoh sederhananya adalah \\(f(x) sama dengan 2 pangkat x\\).");
  assert.ok(result.includes('class="math-formula"'));
  assert.ok(result.includes('aria-label="f(x) sama dengan 2 pangkat x"'));
  assert.ok(result.includes('2<sup><var>x</var></sup>'));
  assert.ok(result.includes('='));
});

test("formats exact user screenshot text with exponents and variables", () => {
  const text1 = "Pada hari pertama terjual \\(2 pangkat 1 sama dengan 2\\) baju";
  const res1 = formatHtmlMath(text1);
  assert.ok(res1.includes('2<sup>1</sup> = 2'));

  const text2 = "hari kedua \\(2 pangkat 2 sama dengan 4\\)";
  const res2 = formatHtmlMath(text2);
  assert.ok(res2.includes('2<sup>2</sup> = 4'));

  const text3 = "Pola ini dapat ditulis sebagai \\(2 pangkat x\\), dengan \\(x\\) menyatakan hari ke-\\(x\\).";
  const res3 = formatHtmlMath(text3);
  assert.ok(res3.includes('2<sup><var>x</var></sup>'));
  assert.ok(res3.includes('<var>x</var>'));
});

test("formats subscripts, carets, and chemical formulas", () => {
  const res = formatHtmlMath("Rumus air H_2O dan gas CO₂ serta titik x_1 dan nilai x^2.");
  assert.ok(res.includes("H<sub>2</sub>O"));
  assert.ok(res.includes("CO<sub>2</sub>"));
  assert.ok(res.includes("x<sub>1</sub>"));
  assert.ok(res.includes("x<sup>2</sup>"));
});

test("formats display math block and fractions", () => {
  const res = formatHtmlMath("\\[ \\frac{1}{2} + x^2 = 5 \\]");
  assert.ok(res.includes('class="math-formula display-block"'));
  assert.ok(res.includes('class="math-frac"'));
  assert.ok(res.includes('math-frac-num">1</span>'));
  assert.ok(res.includes('math-frac-den">2</span>'));
});
