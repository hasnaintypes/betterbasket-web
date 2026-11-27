import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const productDir = path.join(rootDir, "apps/product-service");
const requireProduct = createRequire(path.join(productDir, "package.json"));
const mongoose = requireProduct("mongoose");
const webOrigin = "http://127.0.0.1:3116";
const gatewayOrigin = "http://127.0.0.1:4916";
const productOrigin = "http://127.0.0.1:4917";

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child?.exitCode ?? null, null, `Server exited before ${url} was ready`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for the local server to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

test("seeded Mongo catalog filters appear in the browser", { timeout: 180_000 }, async () => {
  assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI to a nonproduction MongoDB connection");
  const uri = new URL(process.env.MONGODB_URI);
  assert.equal(uri.protocol, "mongodb:");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname),
    "Seeded browser tests require a local MongoDB connection",
  );
  const database = `bb_catalog_e2e_${randomUUID().replaceAll("-", "")}`;
  uri.pathname = `/${database}`;
  const connection = await mongoose.createConnection(uri.toString()).asPromise();
  let product;
  let web;
  let browser;
  let gateway;
  try {
    const sellerId = randomUUID();
    const now = new Date();
    await connection.db.collection("products").insertMany(
      [
        ["Seeded Blue Shirt", "clothing", 3200, 3],
        ["Seeded Cotton Tee", "clothing", 1800, 2],
        ["Seeded Red Shoes", "shoes", 7200, 1],
      ].map(([title, category, amount, order]) => ({
        sellerId,
        title,
        slug: String(title).toLowerCase().replaceAll(" ", "-"),
        description: "Synthetic browser fixture",
        images: [],
        category,
        basePrice: { amount, currency: "USD" },
        minPrice: amount,
        variants: [
          {
            variantId: randomUUID(),
            sku: `E2E-${order}`,
            options: {},
            price: { amount, currency: "USD" },
            stock: 10,
          },
        ],
        status: "active",
        sellerStatus: "active",
        version: 0,
        schemaVersion: 2,
        createdAt: new Date(now.getTime() - Number(order) * 1000),
        updatedAt: now,
      })),
    );
    const common = {
      ...process.env,
      NODE_ENV: "test",
      GIT_SHA: "catalog-e2e",
      ENABLE_DOCS: "false",
    };
    product = spawn("node", ["dist/main.js"], {
      cwd: productDir,
      env: {
        ...common,
        PORT: "4917",
        MONGODB_URI: uri.toString(),
        AUTH_ISSUER: "http://127.0.0.1:4916",
        AUTH_JWKS_URL: "http://127.0.0.1:4916/jwks",
        KAFKA_BROKERS: "127.0.0.1:9092",
        KAFKA_USERNAME: "test",
        KAFKA_PASSWORD: "test",
        KAFKA_TOPIC_PREFIX: "test",
      },
      stdio: "ignore",
    });
    await waitFor(`${productOrigin}/health`, product);
    gateway = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? "/", gatewayOrigin).pathname;
      if (pathname.startsWith("/api/auth/")) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ session: null, user: null }));
        return;
      }
      const upstream =
        pathname === "/api/categories" ? "/categories" : pathname.replace(/^\/api/, "");
      const target = new URL(request.url ?? "/", productOrigin);
      target.pathname = upstream;
      try {
        const result = await fetch(target);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
    await new Promise((resolve) => gateway.listen(4916, "127.0.0.1", resolve));
    web = spawn("pnpm", ["exec", "next", "dev", "-p", "3116"], {
      cwd: webDir,
      env: { ...common, NEXT_PUBLIC_API_URL: gatewayOrigin, NEXT_PUBLIC_SITE_URL: webOrigin },
      stdio: "ignore",
    });
    await waitFor(webOrigin, web);
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto(webOrigin);
    await assertVisible(page, "Seeded Blue Shirt");
    await page.getByRole("link", { name: "Clothing", exact: true }).click();
    await page.waitForURL(/category=clothing/);
    assert.match(page.url(), /category=clothing/);
    await assertVisible(page, "Seeded Blue Shirt");
    assert.equal(await page.getByText("Seeded Red Shoes").count(), 0);
    await page.getByLabel("Minimum price").selectOption("2500");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.waitForURL(/category=clothing.*minPrice=2500/);
    assert.match(page.url(), /category=clothing.*minPrice=2500/);
    await assertVisible(page, "Seeded Blue Shirt");
    assert.equal(await page.getByText("Seeded Cotton Tee").count(), 0);
    await page.getByLabel("Maximum price").selectOption("2500");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await assertVisible(page, "No products match these filters");
    console.log("Seeded MongoDB catalog: category, price, URL, and empty-state assertions passed");
  } finally {
    await browser?.close();
    await stop(web);
    await new Promise((resolve) => gateway?.close(resolve) ?? resolve());
    await stop(product);
    await connection.dropDatabase();
    await connection.close();
  }
});

async function assertVisible(page, text) {
  await page.getByText(text).waitFor({ state: "visible" });
}
