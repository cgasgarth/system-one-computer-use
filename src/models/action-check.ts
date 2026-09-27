import type { Action } from "../agent/contracts.ts";
import type { BinaryAnswer } from "./system-one-schema.ts";

interface ActionCheck {
  readonly action: Action;
  readonly answer: BinaryAnswer;
  readonly phase?:
    | "form-semantics"
    | "commit-classification"
    | "commit-authorization"
    | "field-readiness";
  readonly source?: "dom" | "model" | "conservative";
  readonly control?: { readonly role: string; readonly label: string };
}

export type { ActionCheck };
