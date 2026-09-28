import type { ApprovalRequest, ApprovalResult } from "../computer/codex-controls/protocol.ts";
import type { ReadonlyDeep } from "type-fest";
import type { z } from "zod";
import {
  approvalEventSchema,
  approvalFormSchema,
  approvalMetadataSchema,
} from "./approval-protocol.ts";
import type { ApprovalEvent, ApprovalResponseLine } from "./approval-protocol.ts";

interface Pending {
  readonly resolve: (result: ReadonlyDeep<ApprovalResult>) => void;
  readonly signal: Readonly<AbortSignal>;
  readonly abort: () => void;
  readonly cacheApp?: string;
}

type ApprovalForm = z.infer<typeof approvalFormSchema>;
type ApprovalMetadata = z.infer<typeof approvalMetadataSchema>;
function taskCacheApp(
  form: ReadonlyDeep<ApprovalForm>,
  metadata: ReadonlyDeep<ApprovalMetadata>,
): string | undefined {
  const app = metadata.tool_params?.app;
  if (
    metadata.connector_id !== "computer-use" ||
    metadata.riskLevel !== "low" ||
    metadata.persist?.includes("session") !== true ||
    app === undefined ||
    app.length === 0 ||
    metadata.tool_params?.url !== undefined ||
    Object.keys(form.properties ?? {}).length > 0
  ) {
    return undefined;
  }
  return app;
}
interface PromptContext {
  readonly requestId: string;
  readonly request: ReadonlyDeep<ApprovalRequest>;
  readonly metadata: ReadonlyDeep<ApprovalMetadata>;
  readonly cacheApp: string | undefined;
}
function promptEvent(context: Readonly<PromptContext>): ApprovalEvent {
  const { requestId, request, metadata, cacheApp } = context;
  return approvalEventSchema.parse({
    status: "approval_requested",
    requestId,
    message: request.message,
    canAllowTask: cacheApp !== undefined,
    ...(metadata.tool_params?.app === undefined ? {} : { app: metadata.tool_params.app }),
    ...(metadata.tool_params?.url === undefined
      ? {}
      : { site: new URL(metadata.tool_params.url).origin }),
    ...(metadata.tool_name === undefined ? {} : { tool: metadata.tool_name }),
  });
}

class PendingApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly allowedApps = new Set<string>();
  private readonly notify: (event: ReadonlyDeep<ApprovalEvent>) => void;

  public constructor(notify: (event: ReadonlyDeep<ApprovalEvent>) => void) {
    this.notify = notify;
  }

  public async request(
    request: ReadonlyDeep<ApprovalRequest>,
    signal: Readonly<AbortSignal>,
  ): Promise<ApprovalResult> {
    if (signal.aborted) {
      return { action: "cancel" };
    }
    const form = approvalFormSchema.parse(request.requestedSchema);
    if ((form.required?.length ?? 0) > 0) {
      return { action: "cancel" };
    }
    const metadata = approvalMetadataSchema.parse(Reflect.get(request, "_meta"));
    const cacheApp = taskCacheApp(form, metadata);
    if (cacheApp !== undefined && this.allowedApps.has(cacheApp)) {
      return { action: "accept", content: {} };
    }
    const requestId = crypto.randomUUID();
    const pending = Promise.withResolvers<ApprovalResult>();
    const abort = (): void => {
      this.resolve(requestId, { action: "cancel" });
    };
    this.pending.set(requestId, {
      resolve: pending.resolve,
      signal,
      abort,
      ...(cacheApp === undefined ? {} : { cacheApp }),
    });
    signal.addEventListener("abort", abort, { once: true });
    try {
      this.notify(promptEvent({ requestId, request, metadata, cacheApp }));
    } catch {
      this.resolve(requestId, { action: "cancel" });
    }
    return pending.promise;
  }

  public respond(response: ReadonlyDeep<ApprovalResponseLine>): boolean {
    const entry = this.pending.get(response.requestId);
    if (entry === undefined) {
      return false;
    }
    if (response.decision === "allow_task") {
      if (entry.cacheApp === undefined) {
        return this.resolve(response.requestId, { action: "decline" });
      }
      this.allowedApps.add(entry.cacheApp);
      return this.resolve(response.requestId, {
        action: "accept",
        content: {},
      });
    }
    return this.resolve(
      response.requestId,
      response.decision === "allow_once"
        ? { action: "accept", content: {} }
        : { action: "decline" },
    );
  }

  public cancelAll(): void {
    this.allowedApps.clear();
    for (const requestId of this.pending.keys()) {
      this.resolve(requestId, { action: "cancel" });
    }
  }

  private resolve(requestId: string, result: ReadonlyDeep<ApprovalResult>): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return false;
    }
    this.pending.delete(requestId);
    entry.signal.removeEventListener("abort", entry.abort);
    entry.resolve(result);
    return true;
  }
}

export { PendingApprovals };
