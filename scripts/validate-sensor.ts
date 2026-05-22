import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

const SENSORS_DIR = join(import.meta.dir, "..", "sensors");
const PIPELINE_PATH = join(import.meta.dir, "..", "pipeline.json");

const sensorName = process.argv[2];
if (!sensorName) {
  console.error("Usage: bun run scripts/validate-sensor.ts <sensor-name>");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function ok(msg: string) {
  console.log(`  ✅ ${msg}`);
  passed++;
}

function fail(msg: string) {
  console.error(`  ❌ ${msg}`);
  failed++;
}

console.log(`\n🔍 Validating sensor: ${sensorName}\n`);

// 1. Check sensor directory exists
const sensorDir = join(SENSORS_DIR, sensorName);
try {
  const s = await stat(sensorDir);
  if (s.isDirectory()) {
    ok("Sensor directory exists");
  } else {
    fail("Sensor path exists but is not a directory");
  }
} catch {
  fail("Sensor directory does not exist");
  console.error("\nCannot continue — sensor directory missing.");
  process.exit(1);
}

// 2. Check all three files exist
const requiredFiles = ["sensor.html", "sensor.css", "sensor.ts"];
for (const file of requiredFiles) {
  const filePath = join(sensorDir, file);
  try {
    const s = await stat(filePath);
    if (s.isFile() && s.size > 0) {
      ok(`${file} exists and is non-empty (${s.size} bytes)`);
    } else {
      fail(`${file} is empty or not a file`);
    }
  } catch {
    fail(`${file} is missing`);
  }
}

// 3. Check CSS scoping
const cssPath = join(sensorDir, "sensor.css");
try {
  const css = await readFile(cssPath, "utf-8");
  const scopeClass = `.sensor-card--${sensorName}`;
  if (css.includes(scopeClass)) {
    ok(`CSS is scoped with ${scopeClass}`);
  } else {
    fail(`CSS is NOT scoped — missing ${scopeClass}`);
  }
} catch {
  fail("Cannot read sensor.css for scoping check");
}

// 4. Check HTML structure
const htmlPath = join(sensorDir, "sensor.html");
try {
  const html = await readFile(htmlPath, "utf-8");
  const hasScript = html.includes("<script");
  const hasStyle = html.includes("<style");
  const hasHtml = html.includes("<html") || html.includes("<body") || html.includes("<head");

  if (!hasScript && !hasStyle && !hasHtml) {
    ok("HTML is a fragment (no <script>, <style>, <html>, <body>)");
  } else {
    if (hasScript) fail("HTML contains <script> tags — logic goes in sensor.ts");
    if (hasStyle) fail("HTML contains <style> tags — styles go in sensor.css");
    if (hasHtml) fail("HTML contains <html>/<body>/<head> — use a fragment only");
  }
} catch {
  fail("Cannot read sensor.html for structure check");
}

// 5. Check TS compiles
const tsPath = join(sensorDir, "sensor.ts");
try {
  const ts = await readFile(tsPath, "utf-8");
  // Use Bun.build with a temporary file as entrypoint
  const tmpFile = join(sensorDir, "_validate_tmp.ts");
  await Bun.write(tmpFile, ts);
  try {
    const result = await Bun.build({
      entrypoints: [tmpFile],
      target: "browser",
    });
    if (result.success && result.outputs.length > 0) {
      ok("TypeScript compiles without errors");
    } else {
      for (const log of result.logs) {
        fail(`TypeScript compile error: ${log}`);
      }
    }
  } catch (err: any) {
    fail(`TypeScript compile error: ${err.message}`);
  } finally {
    // Clean up temp file
    try { await Bun.write(tmpFile, ""); const { unlink } = await import("node:fs/promises"); await unlink(tmpFile); } catch {}
  }
} catch (err: any) {
  fail(`TypeScript build failed: ${err.message}`);
}

// 6. Check pipeline.json entry
let sensorSub: any = null;
try {
  const pipeline = JSON.parse(await readFile(PIPELINE_PATH, "utf-8"));
  const sub = (pipeline.subscriptions || []).find(
    (s: any) => s.sensor === sensorName
  );
  if (sub) {
    sensorSub = sub;
    ok("pipeline.json entry exists");

    // Validate required fields
    if (!sub.mqtt_topic) fail("pipeline entry missing mqtt_topic");
    else ok("pipeline entry has mqtt_topic");

    if (!sub.measurement) fail("pipeline entry missing measurement");
    else ok("pipeline entry has measurement");

    if (!sub.fields || Object.keys(sub.fields).length === 0) fail("pipeline entry missing fields");
    else ok("pipeline entry has fields");

    if (!sub.data_format) fail("pipeline entry missing data_format");
    else ok(`pipeline entry has data_format: ${sub.data_format}`);
  } else {
    fail("No pipeline.json entry found for this sensor");
  }
} catch {
  fail("Cannot read or parse pipeline.json");
}

// 7. Check MQTT topic subscription
if (sensorSub?.mqtt_topic) {
  const ts = await readFile(tsPath, "utf-8");
  if (ts.includes("pisense.onTopic") || ts.includes("ps.onTopic")) {
    ok("sensor.ts subscribes to MQTT topic via pisense.onTopic");
  } else {
    fail("sensor.ts does not call pisense.onTopic — MQTT messages will not reach this sensor");
  }
}



// ── Summary ──
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n❌ Sensor "${sensorName}" has ${failed} issue(s). Fix them before proceeding.\n`);
  process.exit(1);
} else {
  console.log(`\n✅ Sensor "${sensorName}" passes all structural checks.\n`);
}
