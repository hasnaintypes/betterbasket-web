import { createServer } from "node:http";

const products = [
  {
    _id: "p1",
    sellerId: "5c6a2398-4734-439e-b2ad-feb261b9305b",
    title: "Blue Shirt",
    slug: "blue-shirt-abc123",
    description: "A comfortable blue shirt",
    images: [],
    category: "clothing",
    basePrice: { amount: 3200, currency: "USD" },
    minPrice: 3200,
    createdAt: "2026-11-25T10:00:00.000Z",
  },
  {
    _id: "p2",
    sellerId: "5c6a2398-4734-439e-b2ad-feb261b9305b",
    title: "Cotton Tee",
    slug: "cotton-tee-def456",
    description: "A soft cotton tee",
    images: [],
    category: "clothing",
    basePrice: { amount: 1800, currency: "USD" },
    minPrice: 1800,
    createdAt: "2026-11-24T10:00:00.000Z",
  },
  {
    _id: "p3",
    sellerId: "862522fc-6654-467e-95d1-d088c4cbd3d7",
    title: "Red Shoes",
    slug: "red-shoes-ghi789",
    description: "Bright red shoes",
    images: [],
    category: "shoes",
    basePrice: { amount: 7200, currency: "USD" },
    minPrice: 7200,
    createdAt: "2026-11-23T10:00:00.000Z",
  },
];

const taxonomy = {
  version: 1,
  categories: [
    {
      id: "fashion",
      name: "Fashion",
      children: [
        { id: "clothing", name: "Clothing" },
        { id: "shoes", name: "Shoes" },
      ],
    },
  ],
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4900");
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/health") return response.end(JSON.stringify({ ok: true }));
  if (url.pathname === "/api/categories") return response.end(JSON.stringify(taxonomy));
  if (url.pathname.startsWith("/api/auth/"))
    return response.end(JSON.stringify({ session: null, user: null }));
  if (url.pathname !== "/api/products") {
    response.statusCode = 404;
    return response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  }
  let items = [...products];
  const category = url.searchParams.get("category");
  const minPrice = url.searchParams.get("minPrice");
  const maxPrice = url.searchParams.get("maxPrice");
  const sellerId = url.searchParams.get("sellerId");
  const q = url.searchParams.get("q")?.toLowerCase();
  if (category) items = items.filter((item) => item.category === category);
  if (minPrice) items = items.filter((item) => item.minPrice >= Number(minPrice));
  if (maxPrice) items = items.filter((item) => item.minPrice <= Number(maxPrice));
  if (sellerId) items = items.filter((item) => item.sellerId === sellerId);
  if (q) items = items.filter((item) => item.title.toLowerCase().includes(q));
  const sort = url.searchParams.get("sort");
  if (sort === "price_asc") items.sort((a, b) => a.minPrice - b.minPrice);
  else if (sort === "price_desc") items.sort((a, b) => b.minPrice - a.minPrice);
  else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = items.length;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 20));
  response.end(
    JSON.stringify({ items: items.slice((page - 1) * limit, page * limit), total, page, limit }),
  );
});

server.listen(4900, "127.0.0.1");
