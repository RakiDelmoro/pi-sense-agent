// publish-test.ts — Publish random temperature data to MQTT broker
// Usage: bun run scripts/publish-test.ts

const mqtt = await import("mqtt");

const broker = process.env.MQTT_BROKER || "tcp://localhost:1883";
const topic = process.env.MQTT_TOPIC || "sensors/room/temp";
const interval = Number(process.env.PUBLISH_INTERVAL) || 2000;

const client = mqtt.connect(broker);

client.on("connect", () => {
  console.log(`Connected to ${broker}`);
  console.log(`Publishing to topic: ${topic}`);
  console.log(`Interval: ${interval}ms`);
  console.log("Press Ctrl+C to stop\n");

  setInterval(() => {
    const temp = (18 + Math.random() * 10).toFixed(1);
    const payload = JSON.stringify({ value: parseFloat(temp) });
    client.publish(topic, payload);
    console.log(`Published: ${temp}°C → ${topic}`);
  }, interval);
});

client.on("error", (err: Error) => {
  console.error("MQTT error:", err.message);
  process.exit(1);
});
