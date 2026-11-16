import assert from "node:assert/strict";
import { test } from "node:test";
import { openStore } from "../src/store.js";

test("settings are kept per hub", () => {
  const store = openStore(":memory:");
  store.set("https://a", "k", "1");
  store.set("https://b", "k", "2");
  store.set("https://a", "k", "3");
  assert.equal(store.get("https://a", "k"), "3");
  assert.equal(store.get("https://b", "k"), "2");
  store.delete("https://a", "k");
  assert.equal(store.get("https://a", "k"), undefined);
});
