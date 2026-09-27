import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ModelIngress } from "../src/app/models/ingress.ts";
import { decisionResponseSchema } from "../src/models/system-one-schema.ts";
import { requestUnix } from "../src/models/transport/unix.ts";

const PRIVATE_SOCKET = 0o600;
const MODE_DIVISOR = 0o1000;
const request = {
  role: "decision" as const,
  body: {
    model: "local",
    state: "Ready",
    questions: {
      next_action: {
        type: "choice" as const,
        instructions: "Choose Ready",
        criteria: { A0: "Ready", A1: "Not ready" },
      },
    },
  },
};
const response = { answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } } };

test("local ingress forwards one typed Unix request through a private socket", async () => {
  const directory = await mkdtemp("/tmp/system-one-ingress-");
  const socket = path.join(directory, "model.sock");
  const ingress = new ModelIngress({
    sockets: { ingress: socket },
    async forward(): Promise<typeof response> {
      return response;
    },
  });
  try {
    await ingress.start();
    const socketInfo = await stat(socket);
    expect(socketInfo.mode % MODE_DIVISOR).toBe(PRIVATE_SOCKET);
    const result = await requestUnix({
      path: socket,
      message: request,
      schema: decisionResponseSchema,
      signal: new AbortController().signal,
    });
    expect(result).toEqual(response);
  } finally {
    await ingress.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing a client connection cancels the active forwarded request", async () => {
  const directory = await mkdtemp("/tmp/system-one-ingress-");
  const socket = path.join(directory, "model.sock");
  const started = Promise.withResolvers<boolean>();
  const cancelled = Promise.withResolvers<boolean>();
  const ingress = new ModelIngress({
    sockets: { ingress: socket },
    async forward(_request, signal): Promise<never> {
      started.resolve(true);
      const aborted = Promise.withResolvers<boolean>();
      signal.addEventListener(
        "abort",
        () => {
          aborted.resolve(true);
        },
        { once: true },
      );
      if (signal.aborted) {
        aborted.resolve(true);
      }
      await aborted.promise;
      cancelled.resolve(true);
      throw new Error("Cancelled");
    },
  });
  try {
    await ingress.start();
    const controller = new AbortController();
    const pending = requestUnix({
      path: socket,
      message: request,
      schema: decisionResponseSchema,
      signal: controller.signal,
    });
    await started.promise;
    controller.abort(new Error("Stopped by user"));
    let failure = "";
    try {
      await pending;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Unknown failure";
    }
    expect(failure).toContain("Stopped by user");
    await cancelled.promise;
  } finally {
    await ingress.close();
    await rm(directory, { recursive: true, force: true });
  }
});
