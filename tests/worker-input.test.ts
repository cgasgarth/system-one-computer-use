import { expect, test } from "bun:test";
import { consumeWorkerInput } from "../src/app/worker-input.ts";

const taskLine = JSON.stringify({
  kind: "task",
  mode: "desktop",
  task: "Read a menu",
  session: { mode: "auto" },
});

test("accepts a user approval reply while the task is still running", async () => {
  const taskDone = Promise.withResolvers<boolean>();
  const started = Promise.withResolvers<boolean>();
  const responseId = crypto.randomUUID();
  const holder: { controller?: ReadableStreamDefaultController<string> } = {};
  const lines = new ReadableStream<string>({
    start(value): void {
      holder.controller = value;
    },
  });
  const { controller } = holder;
  if (controller === undefined) {
    throw new Error("The input stream did not start.");
  }
  const seen: string[] = [];
  const consumed = consumeWorkerInput(lines, {
    run: async (task) => {
      seen.push(task.task);
      started.resolve(true);
      await taskDone.promise;
    },
    respond: (response) => {
      seen.push(response.decision);
      taskDone.resolve(true);
    },
    cancel: () => {
      seen.push("cancelled");
      taskDone.resolve(true);
    },
    busy: () => {
      seen.push("busy");
    },
    error: () => {
      seen.push("error");
    },
    stopped: () => false,
  });
  controller.enqueue(taskLine);
  await started.promise;
  controller.enqueue(
    JSON.stringify({ kind: "approval_response", requestId: responseId, decision: "allow_once" }),
  );
  await taskDone.promise;
  await Bun.sleep(0);
  controller.close();
  await consumed;
  expect(seen).toEqual(["Read a menu", "allow_once"]);
});

test("closing worker input cancels a task waiting for approval", async () => {
  const taskDone = Promise.withResolvers<boolean>();
  const started = Promise.withResolvers<boolean>();
  const holder: { controller?: ReadableStreamDefaultController<string> } = {};
  const lines = new ReadableStream<string>({
    start(value): void {
      holder.controller = value;
    },
  });
  const { controller } = holder;
  if (controller === undefined) {
    throw new Error("The input stream did not start.");
  }
  let cancellations = 0;
  const consumed = consumeWorkerInput(lines, {
    run: async () => {
      started.resolve(true);
      await taskDone.promise;
    },
    respond: () => {
      throw new Error("No approval reply was sent.");
    },
    cancel: () => {
      cancellations += 1;
      taskDone.resolve(true);
    },
    busy: () => {
      throw new Error("Unexpected second task.");
    },
    error: () => {
      throw new Error("Unexpected task error.");
    },
    stopped: () => false,
  });
  controller.enqueue(taskLine);
  await started.promise;
  controller.close();
  await consumed;
  expect(cancellations).toBe(1);
});
