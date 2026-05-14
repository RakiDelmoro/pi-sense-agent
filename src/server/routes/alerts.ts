import { readAlerts, writeAlerts, readAlertHistory, writeAlertHistory } from "../alerts-store";
import { broadcast, dispatchWs } from "../state";
import { buildLatestQuery } from "../influx/queries";
import { queryInflux } from "../influx/client";
import { parseInfluxCsv } from "../influx/csv-parser";
import { parseDuration } from "../alerts-store";

export async function handleAlerts(path: string, method: string, body?: any): Promise<Response | null> {
  // GET /api/alerts
  if (path === "/api/alerts" && method === "GET") {
    return Response.json(await readAlerts());
  }

  // POST /api/alerts
  if (path === "/api/alerts" && method === "POST") {
    const rule = body;
    if (!rule) return Response.json({ error: "Invalid body" }, { status: 400 });
    const alerts = await readAlerts();
    rule.id = rule.id || `alert-${Date.now()}`;
    rule.enabled = rule.enabled ?? true;
    rule._lastTriggered = 0;
    alerts.push(rule);
    await writeAlerts(alerts);
    return Response.json({ ok: true, id: rule.id });
  }

  // /api/alerts/:id or /api/alerts/history
  const alertIdMatch = path.match(/^\/api\/alerts\/(.+)$/);
  if (alertIdMatch) {
    const id = alertIdMatch[1];

    // GET /api/alerts/history
    if (id === "history" && method === "GET") {
      return Response.json(await readAlertHistory());
    }

    // PUT /api/alerts/:id
    if (method === "PUT") {
      const update = body;
      const alerts = await readAlerts();
      const idx = alerts.findIndex((a: any) => a.id === id);
      if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
      alerts[idx] = { ...alerts[idx], ...update, id };
      await writeAlerts(alerts);
      return Response.json({ ok: true });
    }

    // DELETE /api/alerts/:id
    if (method === "DELETE") {
      const alerts = await readAlerts();
      await writeAlerts(alerts.filter((a: any) => a.id !== id));
      return Response.json({ ok: true });
    }
  }

  return null;
}

// ── Alert evaluation (called on interval) ──
export async function evaluateAlerts() {
  const alerts = await readAlerts();
  const now = Date.now();

  for (const rule of alerts) {
    if (!rule.enabled) continue;
    if (rule._lastTriggered && now - rule._lastTriggered < parseDuration(rule.cooldown || "15m")) continue;

    try {
      const flux = buildLatestQuery(rule.measurement, rule.field, rule.tag);
      const result = await queryInflux(flux);

      let value: number | null = null;
      if (typeof result === "string") {
        const parsed = parseInfluxCsv(result);
        if (parsed.length > 0 && typeof parsed[0].value === "number") value = parsed[0].value;
      } else if (result && result.value !== undefined) {
        value = Number(result.value);
      }
      if (value === null || isNaN(value)) continue;

      let triggered = false;
      if (rule.condition === "above" && value > rule.threshold) triggered = true;
      else if (rule.condition === "below" && value < rule.threshold) triggered = true;
      else if (rule.condition === "equal" && Math.abs(value - rule.threshold) < 0.001) triggered = true;

      if (triggered) {
        rule._lastTriggered = now;
        await writeAlerts(alerts);

        const event = {
          rule: { id: rule.id, name: rule.name, measurement: rule.measurement, field: rule.field, condition: rule.condition, threshold: rule.threshold },
          value,
          time: new Date().toISOString(),
        };

        broadcast({ type: "alert-triggered", ...event });
        dispatchWs("alert-triggered", event);

        const history = await readAlertHistory();
        history.unshift(event);
        if (history.length > 100) history.length = 100;
        await writeAlertHistory(history);

        if (rule.webhook) {
          try {
            await fetch(rule.webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
              signal: AbortSignal.timeout(5000),
            });
          } catch (e: any) {
            console.error(`[alert] Webhook failed: ${e.message}`);
          }
        }
      }
    } catch (e: any) {
      console.error(`[alert] Evaluation error for ${rule.id}:`, e.message);
    }
  }
}
