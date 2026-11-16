import { insertWithSellerSlug, sellerSlugBase } from "./slug";

describe("seller slugs", () => {
  it("normalizes and bounds the base, and rejects reserved words", () => {
    expect(sellerSlugBase("My Fine Store")).toBe("my-fine-store");
    expect(sellerSlugBase("a".repeat(150))).toHaveLength(91);
    expect(() => sellerSlugBase("admin")).toThrow("reserved");
    expect(() => sellerSlugBase("--")).toThrow("Invalid");
  });

  it("retries only slug unique collisions with a new random suffix", async () => {
    const seen: string[] = [];
    const insert = jest.fn(async (slug: string) => {
      seen.push(slug);
      if (seen.length === 1) {
        throw { cause: { code: "23505", constraint: "sellers_slug_unique" } };
      }
      return slug;
    });
    const suffixes = ["11111111", "22222222"];
    await expect(insertWithSellerSlug("sample", insert, () => suffixes.shift()!)).resolves.toBe(
      "sample-22222222",
    );
    expect(seen).toEqual(["sample-11111111", "sample-22222222"]);
    await expect(
      insertWithSellerSlug(
        "sample",
        async (slug) => {
          if (slug.endsWith("33333333")) {
            throw { code: "23505", constraint: "sellers_slug_key" };
          }
          return slug;
        },
        (() => {
          const values = ["33333333", "44444444"];
          return () => values.shift()!;
        })(),
      ),
    ).resolves.toBe("sample-44444444");
    await expect(
      insertWithSellerSlug("sample", async () => {
        throw { code: "23505", constraint: "sellers_organization_id_unique" };
      }),
    ).rejects.toMatchObject({ constraint: "sellers_organization_id_unique" });
  });
});
