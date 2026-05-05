import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const SCREENSHOTS_DIR = join(import.meta.dir, "..", "screenshots");

const sensorName = process.argv[2];
if (!sensorName) {
  console.error("Usage: bun run scripts/screenshot-sensor.ts <sensor-name>");
  process.exit(1);
}

console.log(`\n📸 Screenshotting sensor: ${sensorName}\n`);

// Ensure screenshots directory exists
await mkdir(SCREENSHOTS_DIR, { recursive: true });

try {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 400, height: 300 });

  console.log("  Loading dashboard...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 10000 });

  // Wait for sensor to load
  const selector = `.sensor-card--${sensorName}`;
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
  } catch {
    console.error(`  ❌ Sensor "${sensorName}" not found on dashboard`);
    await browser.close();
    process.exit(1);
  }

  // Wait a moment for rendering
  await page.waitForTimeout(500);

  // Screenshot the sensor card
  const card = await page.$(selector);
  if (card) {
    const screenshotPath = join(SCREENSHOTS_DIR, `${sensorName}.png`);
    await card.screenshot({ path: screenshotPath });
    console.log(`  ✅ Screenshot saved to screenshots/${sensorName}.png`);
  }

  // Dump the rendered DOM
  const dom = await card?.innerHTML() || "";
  const domPath = join(SCREENSHOTS_DIR, `${sensorName}.dom.html`);
  await Bun.write(domPath, dom);
  console.log(`  ✅ DOM dump saved to screenshots/${sensorName}.dom.html`);

  await browser.close();
  console.log(`\n✅ Visual capture complete for "${sensorName}".\n`);
} catch (err: any) {
  if (err.message?.includes("playwright")) {
    console.error("  ❌ Playwright not installed. Run: bun add -d playwright && bunx playwright install chromium");
  } else {
    console.error(`  ❌ Error: ${err.message}`);
  }
  process.exit(1);
}
