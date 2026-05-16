import { MQTT_BROKER } from "./config";
import { state, broadcast } from "./state";
import { readPipeline } from "./watcher";
import { writeInflux } from "./influx";

export async function startMqttPipeline() {
  try {
    const mqtt = await import("mqtt");

    state.mqttClient = mqtt.connect(MQTT_BROKER);

    state.mqttClient.on("connect", async () => {
      console.log(`[mqtt] Connected to ${MQTT_BROKER}`);
      state.mqttStatus = "ok";
      broadcast({ type: "status", influxdb: state.influxStatus, mqtt: "ok" });

      const pipeline = await readPipeline();
      const subs = pipeline.subscriptions || [];
      for (const sub of subs) {
        state.mqttClient.subscribe(sub.mqtt_topic);
        state.pipelineSubscriptions.set(sub.mqtt_topic, sub);
        state.seenTopics.add(sub.mqtt_topic);
        console.log(`[mqtt] Subscribed to ${sub.mqtt_topic}`);
      }
      if (subs.length === 0) console.log("[pipeline] No subscriptions in pipeline.json — waiting for updates");
    });

    state.mqttClient.on("message", async (topic: string, payload: Buffer) => {
      const sub = state.pipelineSubscriptions.get(topic);
      if (!sub) return;

      const raw = payload.toString();
      console.log(`[mqtt] Received on ${topic}: ${raw}`);

      // Track device
      state.seenTopics.add(topic);
      const wasOffline = !state.devices.has(topic) || !state.devices.get(topic)!.online;
      state.devices.set(topic, { online: true, lastSeen: new Date().toISOString() });
      if (wasOffline) {
        broadcast({ type: "device-status", topic, online: true, lastSeen: state.devices.get(topic)!.lastSeen });
      }

      // Forward to subscribed WebSocket clients
      for (const [ws, topics] of state.wsTopicSubs) {
        if (topics.has(topic) && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "mqtt-message", topic, payload: raw }));
        }
      }

      let fields: Record<string, number | string> = {};
      try {
        if (sub.data_format === "json") {
          let parsed: any;
          try { parsed = JSON.parse(raw); }
          catch {
            try {
              const fixed = raw.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
              parsed = JSON.parse(fixed);
            } catch (e2) { throw new SyntaxError(`Invalid JSON: ${raw}`); }
          }
          for (const [key, type] of Object.entries(sub.fields)) {
            const val = parsed[key];
            if (val !== undefined) fields[key] = type === "float" || type === "int" ? Number(val) : String(val);
          }
        } else if (sub.data_format === "value") {
          const firstKey = Object.keys(sub.fields)[0];
          fields[firstKey] = Number(raw);
        } else if (sub.data_format === "csv") {
          const parts = raw.split(",");
          Object.keys(sub.fields).forEach((key, i) => {
            if (parts[i] !== undefined) {
              const type = sub.fields[key];
              fields[key] = type === "float" || type === "int" ? Number(parts[i]) : String(parts[i]);
            }
          });
        }
      } catch (err) {
        console.error(`[mqtt] Failed to parse payload on ${topic}:`, err);
        return;
      }

      let line = sub.measurement;
      if (sub.tags && Object.keys(sub.tags).length > 0) {
        const tagParts = Object.entries(sub.tags).map(([k, v]) => `${k}=${v}`);
        line += "," + tagParts.join(",");
      }
      const fieldParts = Object.entries(fields).map(([k, v]) => {
        if (typeof v === "number") {
          const fieldType = sub.fields[k];
          if (fieldType === "float" && Number.isInteger(v)) return `${k}=${v}.0`;
          return `${k}=${v}`;
        }
        return `${k}="${v}"`;
      });
      line += " " + fieldParts.join(",");

      console.log(`[mqtt] Writing to InfluxDB: ${line}`);
      await writeInflux(line);
    });

    state.mqttClient.on("error", (err: Error) => {
      console.error("[mqtt] Error:", err.message);
      state.mqttStatus = "down";
      broadcast({ type: "status", influxdb: state.influxStatus, mqtt: "down" });
    });

    state.mqttClient.on("close", () => {
      state.mqttStatus = "down";
      broadcast({ type: "status", influxdb: state.influxStatus, mqtt: "down" });
    });
  } catch (err: any) {
    console.log("[mqtt] MQTT client not available:", err.message);
    state.mqttStatus = "down";
  }
}

export async function reloadPipelineSubscriptions() {
  const pipeline = await readPipeline();
  const subs = pipeline.subscriptions || [];
  if (state.mqttClient?.connected) {
    for (const [topic] of state.pipelineSubscriptions) state.mqttClient.unsubscribe(topic);
  }
  state.pipelineSubscriptions.clear();
  if (state.mqttClient?.connected) {
    for (const sub of subs) {
      state.mqttClient.subscribe(sub.mqtt_topic);
      state.pipelineSubscriptions.set(sub.mqtt_topic, sub);
      console.log(`[mqtt] Re-subscribed to ${sub.mqtt_topic}`);
    }
  }
}
