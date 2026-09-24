import { ZodError } from "zod";
import { runTask } from "../agent/loop.ts";
import { createComputer, createModels, loadConfig } from "./config.ts";
import { taskInputSchema } from "./task-schema.ts";
import type { TaskInput, TaskResponse } from "./task-schema.ts";
import page from "./web/index.html";

const MS_PER_SECOND = 1000;
const HTTP = {
  badRequest: 400,
  conflict: 409,
  forbidden: 403,
  notFound: 404,
  serverError: 500,
  unsupportedMedia: 415,
};
const config = loadConfig();
const models = createModels(config);
let busy = false;

function failure(error: string, status: number): Response {
  const body: TaskResponse = { error, status: "error" };
  return Response.json(body, { status });
}

async function executeTask(input: TaskInput): Promise<Response> {
  const computer = createComputer(config, input.mode);
  try {
    const result = await runTask({
      ...models,
      computer,
      maxSteps: config.SYSTEM_ONE_MAX_STEPS,
      task: input.task,
    });
    const body: TaskResponse = {
      decisions: result.steps.length,
      requestsPerSecond: result.requestsPerSecond,
      status: "complete",
      summary: result.summary,
      totalSeconds: result.totalMs / MS_PER_SECOND,
    };
    return Response.json(body);
  } finally {
    await computer.close();
  }
}

async function submitTask(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return failure("Origin is not allowed", HTTP.forbidden);
  }
  if (request.headers.get("content-type")?.startsWith("application/json") !== true) {
    return failure("Send JSON", HTTP.unsupportedMedia);
  }
  if (busy) {
    return failure("A task is already running", HTTP.conflict);
  }
  busy = true;
  try {
    const input = taskInputSchema.parse(await request.json());
    return await executeTask(input);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return failure("Enter a task and choose a valid mode", HTTP.badRequest);
    }
    if (error instanceof Error) {
      return failure(error.message, HTTP.serverError);
    }
    return failure("Task failed", HTTP.serverError);
  } finally {
    busy = false;
  }
}

const server = Bun.serve({
  async fetch(request): Promise<Response> {
    if (request.method === "POST" && new URL(request.url).pathname === "/tasks") {
      return submitTask(request);
    }
    return failure("Not found", HTTP.notFound);
  },
  hostname: "127.0.0.1",
  port: config.PORT,
  routes: { "/": page },
});
console.log(`Task input: ${server.url}`);
