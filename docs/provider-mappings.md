# Provider semantic mappings

Verified against current official documentation on 2026-08-16. Economics are
not sourced from marketing pages: each adapter requires the effective marginal
micro-USD cost for the actual account through environment configuration.

| Provider   | Provider state                           | Canonical decision / confidence | Evidence notes                                                                                                   |
| ---------- | ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Hunter     | `valid`, `webmail`                       | `send` / high                   | SMTP check controls mailbox evidence; documented booleans control syntax/domain/disposable/catch-all             |
| Hunter     | `invalid`                                | `do_not_send` / high            | Mailbox is missing only when syntax and MX pass but SMTP check fails                                             |
| Hunter     | `disposable`                             | `do_not_send` / high            | Disposable true; mailbox remains unknown                                                                         |
| Hunter     | `accept_all`                             | `uncertain` / low               | Catch-all true; mailbox unknown                                                                                  |
| Hunter     | `unknown` or unrecognized                | `uncertain` / unknown           | Known check booleans retained for documented `unknown`; new status fails open to evidence unknown, never to send |
| ZeroBounce | `valid`                                  | `send` / high                   | Mailbox exists; MX and catch-all retained                                                                        |
| ZeroBounce | `invalid`                                | `do_not_send` / high            | Syntax/domain/mailbox specificity only from matching sub-status                                                  |
| ZeroBounce | `spamtrap`, `abuse`, `do_not_mail`       | `do_not_send` / high            | Disposable and role evidence only from explicit sub-status                                                       |
| ZeroBounce | `catch-all`                              | `uncertain` / low               | Catch-all true; mailbox unknown                                                                                  |
| ZeroBounce | `unknown` or unrecognized                | `uncertain` / unknown           | Unrecognized top-level states preserve total uncertainty                                                         |
| Kickbox    | `deliverable`                            | `send` / high                   | `accepted_email` maps mailbox exists; flags retained                                                             |
| Kickbox    | `undeliverable`                          | `do_not_send` / high            | Reason distinguishes syntax, domain, or rejected mailbox                                                         |
| Kickbox    | `risky`                                  | `uncertain` / low               | No binary send claim                                                                                             |
| Kickbox    | `unknown`, unsuccessful, or unrecognized | `uncertain` / unknown           | Unknown provider evolution cannot become a send decision                                                         |

Hunter endpoint: `https://api.hunter.io/v2/email-verifier`. ZeroBounce endpoint:
`https://api.zerobounce.net/v2/validate`. Kickbox endpoint:
`https://api.kickbox.com/v2/verify`. Adapters enforce exactly these HTTPS hosts,
validate JSON before normalization, never expose raw payloads, and perform no
automatic retries.

Provider scores (`score` and `sendex`) are deliberately not converted into a
probability. Hunter documents an arbitrary score for some classes, and neither
provider's score is established as a calibrated probability for this workload.

## Complete status and sub-status treatment

Hunter top-level states are exhaustively listed in the first table: `valid`,
`invalid`, `accept_all`, `webmail`, `disposable`, and `unknown`. Its documented
check booleans map independently; `gibberish`, `webmail`, `smtp_server`,
`block`, and `sources` are intentionally not in the V0 customer-job evidence.
They remain adapter-private rather than being forced into unrelated fields.

ZeroBounce sub-statuses map as follows. A sub-status never upgrades the
top-level decision or confidence by itself.

| ZeroBounce sub-status                                                                                                                                                                                                                                                                                                                                                                                                                    | Canonical evidence effect                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| empty, `alternate`, `antispam_system`, `greylisted`, `mail_server_temporary_error`, `forcible_disconnect`, `mail_server_did_not_respond`, `timeout_exceeded`, `failed_smtp_connection`, `mailbox_quota_exceeded`, `exception_occurred`, `possible_trap`, `global_suppression`, `possible_typo`, `unroutable_ip_address`, `leading_period_removed`, `alias_address`, `toxic`, `accept_all`, `gold`, `allowed`, `blocked`, or unrecognized | No additional canonical evidence; preserve the top-level mapping |
| `failed_syntax_check`                                                                                                                                                                                                                                                                                                                                                                                                                    | syntax `invalid`                                                 |
| `no_dns_entries`, `does_not_accept_mail`                                                                                                                                                                                                                                                                                                                                                                                                 | domain `unreachable`                                             |
| `mailbox_not_found`                                                                                                                                                                                                                                                                                                                                                                                                                      | mailbox `missing`                                                |
| `role_based`, `role_based_catch_all`                                                                                                                                                                                                                                                                                                                                                                                                     | role-based `true`                                                |
| `disposable`                                                                                                                                                                                                                                                                                                                                                                                                                             | disposable `true`                                                |

The documented top-level ZeroBounce statuses are `valid`, `invalid`,
`catch-all`, `unknown`, `spamtrap`, `abuse`, and `do_not_mail`. `mx_found` and
`catchall_domain` map directly when present. Because the API documentation shows
`mx_found` as both boolean and string in examples, the adapter validates exactly
those two representations.

Kickbox reasons map independently as follows: `invalid_email` makes syntax
invalid; `invalid_domain` makes the domain unreachable; `rejected_email` makes
the mailbox missing; `accepted_email` makes it exist. `low_quality`,
`low_deliverability`, `no_connect`, `timeout`, `invalid_smtp`,
`unavailable_smtp`, `unexpected_error`, and any new reason add no canonical
evidence. Top-level `deliverable`, `undeliverable`, `risky`, and `unknown`
remain authoritative for the decision mapping shown above.

Sources: [Hunter API Reference](https://hunter.io/api-documentation),
[ZeroBounce v2 Validate](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails),
and the [Kickbox-maintained client contract](https://github.com/kickboxio/kickbox-php).
