import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const sheet = postcss.parse(readFileSync(new URL("../src/index.css", import.meta.url), "utf8"));

function declaration(selector: string, property: string) {
  let value: string | undefined;
  sheet.walkRules(selector, (rule) => {
    rule.walkDecls(property, (decl) => { value = decl.value; });
  });
  return value;
}

const scales = { xs: .85, small: .92, normal: 1, large: 1.1, xl: 1.2 };

for (const [step, scale] of Object.entries(scales)) {
  test(`${step} uses the shared ${Math.round(scale * 100)}% typography scale`, () => {
    assert.equal(Number(declaration(`:root[data-font-size="${step}"]`, "--font-scale")), scale);
  });
}

test("adjacent font settings differ perceptibly without changing the default", () => {
  const values = Object.values(scales);
  values.slice(1).forEach((value, index) => assert.ok(value / values[index] >= 1.08));
  assert.equal(declaration(":root", "--font-scale"), "1");
  assert.equal(declaration(":root", "--reading-scale"), "var(--font-scale)");
});

test("inherited text and slider samples use the shared typography tokens", () => {
  assert.equal(declaration("body", "font-size"), "var(--text-body)");
  assert.equal(declaration(":root", "--text-body"), "calc(16px * var(--font-scale))");
  assert.equal(declaration(".settings-font-size-a-small", "font-size"), "var(--text-sm)");
  assert.equal(declaration(".settings-font-size-a-large", "font-size"), "var(--text-lg)");
});

test("visible font sizes cannot bypass the global scale", () => {
  sheet.walkDecls("font-size", (decl) => {
    assert.ok(/var\(|^(inherit|0)$/.test(decl.value), `${decl.parent?.toString()}`);
  });
  sheet.walkDecls("font", (decl) => {
    assert.equal(decl.value, "inherit", "font shorthand must not reset scaled text");
  });
});

test("mobile menu labels wrap and keep a usable minimum touch target", () => {
  assert.equal(declaration(".mobile-settings-nav > button", "height"), "auto");
  assert.equal(declaration(".mobile-settings-nav > button", "min-height"), "56px");
  assert.equal(declaration(".mobile-settings-nav > button > span", "white-space"), "normal");
});

test("desktop secondary rows grow with their text rather than clipping it", () => {
  assert.equal(declaration(".settings-page-scope .settings-nav-inner", "min-height"), "49px");
  assert.equal(declaration(".settings-page-scope .settings-nav-label", "white-space"), "normal");
});
