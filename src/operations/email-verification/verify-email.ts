import { Effect } from "effect";
import type {
  OperationRouter,
  RoutingFailure,
} from "../../routing/operation-router.js";
import type {
  EmailVerificationRequest,
  EmailVerificationResultWire,
} from "./contract.js";

const hasPlausibleEmailSyntax = (email: string): boolean => {
  if (email.length > 320 || /\s/.test(email)) return false;
  const separator = email.lastIndexOf("@");
  if (
    separator <= 0 ||
    separator === email.length - 1 ||
    email.indexOf("@") !== separator
  )
    return false;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return local.length <= 64 && domain.length <= 255;
};

export const verifyEmail = (
  router: OperationRouter,
  request: EmailVerificationRequest,
): Effect.Effect<EmailVerificationResultWire, RoutingFailure> => {
  if (!hasPlausibleEmailSyntax(request.email)) {
    return Effect.succeed({
      decision: "do_not_send",
      confidence: "high",
      evidence: {
        syntax: "invalid",
        domain: "unknown",
        mailbox: "unknown",
        catchAll: null,
        disposable: null,
        roleBased: null,
      },
      economics: { costMicroUsd: "0", latencyMs: 0, attempts: 0 },
      execution: { provider: "local_syntax", fallbackUsed: false },
    });
  }
  return router.verifyEmail(request);
};
