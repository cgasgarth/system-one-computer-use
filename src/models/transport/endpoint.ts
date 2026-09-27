import { z } from "zod";
import { inferenceRoleSchema } from "./protocol.ts";

const endpointSchema = z.url({ protocol: /^(?:https?|unix)$/u }).superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "unix:") {
    return;
  }
  if (
    url.host !== "" ||
    url.pathname === "/" ||
    !url.pathname.startsWith("/") ||
    !inferenceRoleSchema.safeParse(url.searchParams.get("role")).success
  ) {
    context.addIssue({
      code: "custom",
      message: "A local model endpoint needs an absolute socket path and model role.",
    });
  }
});

function localEndpoint(
  value: string,
): { readonly path: string; readonly role: "decision" | "text" } | undefined {
  const url = new URL(endpointSchema.parse(value));
  if (url.protocol !== "unix:") {
    return undefined;
  }
  return {
    path: decodeURIComponent(url.pathname),
    role: inferenceRoleSchema.parse(url.searchParams.get("role")),
  };
}

export { endpointSchema, localEndpoint };
