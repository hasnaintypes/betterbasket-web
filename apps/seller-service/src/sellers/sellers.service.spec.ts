import { BadRequestException } from "@nestjs/common";
import { db } from "../db/client";
import { SellersService } from "./sellers.service";

jest.mock("../db/client", () => ({
  db: { query: { sellers: { findFirst: jest.fn() } }, insert: jest.fn() },
}));
const mockFindFirst = db.query.sellers.findFirst as jest.Mock;
const mockInsert = db.insert as jest.Mock;

const input = {
  storeName: "Test Store",
  slug: "test-store",
  country: "US",
  supportEmail: "support@example.test",
};

describe("SellersService.onboard", () => {
  const service = new SellersService();
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
  });
  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("returns the existing seller without another insert", async () => {
    mockFindFirst.mockResolvedValue({ id: "seller-1", status: "active", slug: "saved" });
    await expect(service.onboard("org-1", input)).resolves.toEqual({
      id: "seller-1",
      status: "active",
      slug: "saved",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns one pending row when concurrent inserts conflict on organization", async () => {
    const row = { id: "seller-1", status: "pending", slug: "test-store-suffix" };
    let inserted = false;
    mockFindFirst.mockImplementation(async () => (inserted ? row : undefined));
    mockInsert.mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (inserted) return [];
            inserted = true;
            return [row];
          },
        }),
      }),
    }));
    const [first, second] = await Promise.all([
      service.onboard("org-1", input),
      service.onboard("org-1", input),
    ]);
    expect(first).toEqual(row);
    expect(second).toEqual(row);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("rejects a country outside the configured list outside test mode", async () => {
    mockFindFirst.mockResolvedValue(undefined);
    process.env.NODE_ENV = "production";
    process.env.SUPPORTED_SELLER_COUNTRIES = "US,CA";
    try {
      await expect(service.onboard("org-2", { ...input, country: "GB" })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockInsert).not.toHaveBeenCalled();
    } finally {
      delete process.env.SUPPORTED_SELLER_COUNTRIES;
    }
  });
});
