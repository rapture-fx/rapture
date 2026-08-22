import { assert, candidateRequire, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const LRUCache = load("internal/lrucache.js");
  assert.equal(typeof LRUCache, "function", "internal/lrucache.js must export a constructor");

  // --- basic map semantics -----------------------------------------------------------
  const cache = new LRUCache();
  assert.equal(cache.max, 1000, "the default capacity must remain 1000");
  assert.equal(cache.get("missing"), undefined);
  assert.equal(cache.set("a", 1), cache, "set must return the cache for chaining");
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.delete("a"), true, "delete must report whether a key was present");
  assert.equal(cache.delete("a"), false);
  assert.equal(cache.get("a"), undefined);

  // Storing `undefined` must not create an entry.
  cache.set("u", undefined);
  assert.equal(cache.get("u"), undefined);
  assert.equal(cache.delete("u"), false, "set(key, undefined) must not create an entry");

  // --- capacity is enforced ----------------------------------------------------------
  const bounded = new LRUCache();
  for (let index = 0; index < bounded.max; index += 1) {
    bounded.set(`k${index}`, index);
  }
  assert.equal(bounded.get("k0"), 0, "the cache must hold exactly `max` entries before evicting");
  assert.equal(bounded.get(`k${bounded.max - 1}`), bounded.max - 1);

  bounded.set("overflow", "x");
  assert.equal(bounded.get("overflow"), "x");
  assert.equal(
    bounded.get("k1"),
    undefined,
    "inserting beyond capacity must evict the least recently used entry",
  );

  // --- reads refresh recency ----------------------------------------------------------
  const recency = new LRUCache();
  for (let index = 0; index < recency.max; index += 1) {
    recency.set(`k${index}`, index);
  }
  assert.equal(recency.get("k0"), 0);
  recency.set("overflow", "x");
  assert.equal(
    recency.get("k0"),
    0,
    "a key read just before an eviction must survive that eviction",
  );
  assert.equal(recency.get("k1"), undefined, "the least recently used key must be evicted instead");

  // --- the cache stays bounded under sustained churn ------------------------------------
  const churn = new LRUCache();
  const total = churn.max * 3;
  for (let index = 0; index < total; index += 1) {
    churn.set(`c${index}`, index);
  }
  assert.equal(churn.get(`c${total - 1}`), total - 1, "the newest entry must be retained");
  assert.equal(churn.get("c0"), undefined, "the oldest entries must have been evicted");
  let retained = 0;
  for (let index = 0; index < total; index += 1) {
    if (churn.get(`c${index}`) !== undefined) retained += 1;
  }
  assert.ok(
    retained <= churn.max,
    `the cache must never retain more than max entries, retained ${retained}`,
  );

  // --- the rest of the library still works with the cache in place -----------------------
  const semver = load("index.js");
  // Parsing far more distinct ranges than the cache can hold exercises eviction on the
  // real call path and must not change any answer.
  for (let index = 0; index < 1500; index += 1) {
    assert.equal(semver.satisfies(`1.${index}.0`, `^1.${index}.0`), true, `range ${index}`);
    assert.equal(semver.satisfies(`2.${index}.0`, `^1.${index}.0`), false, `range ${index}`);
  }
  assert.equal(semver.satisfies("1.2.3", "^1.0.0"), true);
  assert.equal(semver.satisfies("2.0.0", "^1.0.0"), false);
  assert.equal(semver.validRange("^1.0.0"), ">=1.0.0 <2.0.0-0");
});
