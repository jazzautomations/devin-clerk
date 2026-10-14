import { describe, expect, it } from "vitest";
import { parseId } from "@/lib/ids";

describe("parseId", () => {
  it("aceita inteiro positivo que cabe no INTEGER do Postgres", () => {
    expect(parseId("7")).toBe(7);
    expect(parseId("2147483647")).toBe(2147483647);
  });

  it.each(["2147483648", "1e21", "01", " 1", "1 ", "0", "-1", "1.5", "abc", "", "999999999999999999999"])(
    "recusa %j",
    (raw) => {
      expect(parseId(raw)).toBeNull();
    },
  );

  it("recusa ausente", () => {
    expect(parseId(undefined)).toBeNull();
    expect(parseId(null)).toBeNull();
  });
});
