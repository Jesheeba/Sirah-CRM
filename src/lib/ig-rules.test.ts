import { describe, expect, it } from "vitest";
import { containsKeyword, repliesFor, resolveIgRule, validateRule, type IgRule, type RuleEvent } from "./ig-rules";

const rule = (over: Partial<IgRule>): IgRule => ({
  id: over.name ?? "r",
  name: "rule",
  ig_account_id: null,
  applies_to: "comment",
  ig_media_id: null,
  rule_type: "keyword",
  match_keywords: [],
  match_mode: "any",
  whole_word: true,
  priority: 100,
  is_enabled: true,
  action: "public_reply",
  reply_text: "reply",
  dm_text: null,
  send_mode: "needs_approval",
  ...over,
});

const RULES: IgRule[] = [
  rule({ name: "office", match_keywords: ["office", "address", "அலுவலகம்"], priority: 10 }),
  rule({ name: "timings", match_keywords: ["timing", "timings", "hours"], priority: 20 }),
  rule({ name: "fee", match_keywords: ["fee"], priority: 30 }),
  rule({ name: "ration card help", match_keywords: ["ration", "card"], match_mode: "all", priority: 40 }),
  rule({ name: "hindi", match_keywords: ["कार्यालय"], priority: 50 }),
  rule({ name: "reel offer", match_keywords: ["offer"], ig_media_id: "reel-1", priority: 999 }),
  rule({ name: "partial", match_keywords: ["congrat"], whole_word: false, priority: 60 }),
  rule({ name: "disabled", match_keywords: ["hello"], is_enabled: false, priority: 1 }),
  rule({ name: "dm hello", applies_to: "dm", match_keywords: ["hello", "hi"], action: "dm_reply", dm_text: "Hi!", priority: 5 }),
  rule({ name: "dm catch-all", applies_to: "dm", rule_type: "always", action: "dm_reply", dm_text: "We'll get back", priority: 900 }),
];
const BLOCK = ["complaint", "bribe", "லஞ்சம்"];

const ev = (text: string | null, over: Partial<RuleEvent> = {}): RuleEvent => ({ kind: "comment", text, mediaId: "post-1", igAccountId: "acc", isOwn: false, ...over });
const fired = (o: ReturnType<typeof resolveIgRule>) => (o.kind === "match" ? o.rule.name : o.kind === "blocked" ? `blocked:${o.word}` : "none");

// ≥30 sample comments, per the F9 acceptance criteria.
const CASES: [string, RuleEvent, string][] = [
  ["plain keyword", ev("Where is the office?"), "office"],
  ["upper case", ev("WHERE IS THE OFFICE"), "office"],
  ["mixed case + punctuation", ev("office-address pls!!"), "office"],
  ["second keyword", ev("send the address please"), "office"],
  ["Tamil keyword", ev("அலுவலகம் எங்கே உள்ளது?"), "office"],
  ["Hindi keyword", ev("कार्यालय कहाँ है"), "hindi"],
  ["emoji around keyword", ev("🙏office🙏 timings?"), "office"],
  ["priority: office beats timings", ev("office timings"), "office"],
  ["timings alone", ev("What are the timings?"), "timings"],
  ["plural not in list for singular rule", ev("hours on sunday?"), "timings"],
  ["whole word: fee", ev("what is the fee"), "fee"],
  ["whole word: coffee is not fee", ev("thanks for the coffee"), "none"],
  ["whole word: feedback is not fee", ev("great feedback session"), "none"],
  ["all-mode: both words", ev("need help with ration card"), "ration card help"],
  ["all-mode: only one word", ev("ration shop closed"), "none"],
  ["all-mode: words far apart", ev("card lost, ration not received"), "ration card help"],
  ["substring rule", ev("Congratulations sir!"), "partial"],
  ["disabled rule never fires", ev("hello there"), "none"],
  ["post-specific rule wins over priority", ev("office offer?", { mediaId: "reel-1" }), "reel offer"],
  ["post-specific rule ignored on other posts", ev("any offer?", { mediaId: "post-9" }), "none"],
  ["blocklist beats every rule", ev("complaint about the office"), "blocked:complaint"],
  ["blocklist case-insensitive", ev("BRIBE asked at office"), "blocked:bribe"],
  ["Tamil blocklist", ev("லஞ்சம் கேட்கிறார்கள்"), "blocked:லஞ்சம்"],
  ["own account never fires", ev("office", { isOwn: true }), "none"],
  ["tagged post never fires", ev("office", { kind: "tag" }), "none"],
  ["empty text", ev(""), "none"],
  ["null text", ev(null), "none"],
  ["only spaces", ev("    "), "none"],
  ["comment rules don't answer DMs", ev("office", { kind: "dm" }), "dm catch-all"],
  ["DM keyword", ev("hi", { kind: "dm" }), "dm hello"],
  ["DM keyword inside word doesn't match", ev("this is high time", { kind: "dm" }), "dm catch-all"],
  ["DM catch-all", ev("random question", { kind: "dm" }), "dm catch-all"],
  ["mention with no mention rules", ev("office", { kind: "mention" }), "none"],
  ["near miss: offices (whole word)", ev("all offices closed"), "none"],
  ["regex characters in text are harmless", ev("(office)? [address]*"), "office"],
];

describe("F9 resolver — 35 sample comments", () => {
  it.each(CASES)("%s", (_label, event, expected) => {
    expect(fired(resolveIgRule(event, RULES, BLOCK))).toBe(expected);
  });
  it("rules for another account don't fire", () => {
    const r = [rule({ name: "acc-only", match_keywords: ["office"], ig_account_id: "other" })];
    expect(fired(resolveIgRule(ev("office"), r, []))).toBe("none");
  });
});

describe("F9 keyword matching", () => {
  it("keywords with regex characters are matched literally", () => {
    expect(containsKeyword("price is 5+5", "5+5", true)).toBe(true);
    expect(containsKeyword("aaaa", "a.*", false)).toBe(false);
  });
  it("blank keyword never matches", () => expect(containsKeyword("anything", "  ", false)).toBe(false));
});

describe("F9 replies a rule produces", () => {
  const both = rule({ action: "both", reply_text: "Public", dm_text: "Private" });
  it("both → public + private for a comment", () => {
    expect(repliesFor(both, ["public", "private"])).toEqual([{ channel: "public", body: "Public" }, { channel: "private", body: "Private" }]);
  });
  it("drops channels Instagram doesn't allow for the item", () => {
    expect(repliesFor(both, ["public"])).toEqual([{ channel: "public", body: "Public" }]);
    expect(repliesFor(rule({ action: "dm_reply", dm_text: "x" }), ["public"])).toEqual([]);
  });
});

describe("F9 rule validation", () => {
  const base = { name: "Office", ig_account_id: null, applies_to: "comment" as const, ig_media_id: null, rule_type: "keyword" as const, match_keywords: ["office"], match_mode: "any" as const, whole_word: true, priority: 10, action: "public_reply" as const, reply_text: "At Main Rd", dm_text: null, send_mode: "auto" as const };
  it("accepts a good rule and cleans keywords (trim, de-duplicate, drop blanks)", () => {
    const v = validateRule({ ...base, match_keywords: [" Office ", "office", "", "address"] });
    expect(v.ok && v.rule.match_keywords).toEqual(["Office", "address"]);
  });
  it.each([
    ["no name", { name: "  " }],
    ["no keywords", { match_keywords: ["", " "] }],
    ["DM action on a comment rule", { action: "dm_reply" }],
    ["private reply on a mention rule", { applies_to: "mention", action: "private_reply" }],
    ["missing public text", { reply_text: "" }],
    ["missing DM text", { action: "private_reply", dm_text: " " }],
    ["DM text too long", { action: "private_reply", dm_text: "x".repeat(1001) }],
    ["too many keywords", { match_keywords: Array.from({ length: 51 }, (_, i) => `k${i}`) }],
  ])("rejects: %s", (_l, patch) => {
    expect(validateRule({ ...base, ...(patch as object) }).ok).toBe(false);
  });
  it("catch-all rules don't need keywords; unknown send mode becomes 'needs approval'", () => {
    const v = validateRule({ ...base, rule_type: "always", match_keywords: [], send_mode: "weird" as never });
    expect(v.ok && [v.rule.match_keywords, v.rule.send_mode]).toEqual([[], "needs_approval"]);
  });
});
