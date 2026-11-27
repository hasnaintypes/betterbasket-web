import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function seriousAccessibilityViolations(page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      }));
  });
}

test("category and price filters update the URL and visible products", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "New arrivals" })).toBeVisible();
  await expect(page.getByText("Blue Shirt")).toBeVisible();
  await page.getByRole("link", { name: "Clothing", exact: true }).click();
  await expect(page).toHaveURL(/category=clothing/);
  await expect(page.getByText("Blue Shirt")).toBeVisible();
  await expect(page.getByText("Red Shoes")).toHaveCount(0);
  await page.getByLabel("Minimum price").selectOption("2500");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/category=clothing.*minPrice=2500/);
  await expect(page.getByText("Blue Shirt")).toBeVisible();
  await expect(page.getByText("Cotton Tee")).toHaveCount(0);
  await page.getByLabel("Maximum price").selectOption("2500");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No products match these filters")).toBeVisible();
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test("home page records a browser LCP sample", async ({ page }) => {
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
  const lcp = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return window.__lcp;
  });
  expect(lcp).toBeGreaterThan(0);
  console.log(`Local stub home LCP: ${Math.round(lcp)} ms`);
});
