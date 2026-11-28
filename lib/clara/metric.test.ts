import { test } from "node:test";
import assert from "node:assert/strict";
import { claraMetric, setClaraMetricSink } from "./metric";

test("a metric is one '[clara-metric] {json}' log line, and a sink that throws breaks nothing", () => {
  const lines: string[] = [];
  const info = console.info;
  console.info = (m: unknown) => void lines.push(String(m));
  try {
    claraMetric("dish_served", { meal: "dinner", source: "generated", calories_from: "amounts" });
    assert.deepEqual(lines, ['[clara-metric] {"m":"dish_served","meal":"dinner","source":"generated","calories_from":"amounts"}']);
    assert.deepEqual(JSON.parse(lines[0].slice("[clara-metric] ".length)).m, "dish_served");
  } finally {
    console.info = info;
  }
  const before = setClaraMetricSink(() => {
    throw new Error("drain down");
  });
  try {
    assert.doesNotThrow(() => claraMetric("chat_busy", { status: 503 }));
  } finally {
    setClaraMetricSink(before);
  }
});
