import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { subscriptionSeatUpgradeScenario } from "../src/reference/subscription-seat-upgrade.js";
import {
  assertDisposablePostgresHost,
  createSubscriptionSeatUpgradePostgresWorld,
  type PostgresConnection,
  resolvePostgresConnection,
  type SeatUpgradeFault,
  subscriptionSeatUpgradePostgresScenario,
} from "../src/reference/subscription-seat-upgrade-postgres.js";
import { defineScenario, runScenario, type ScenarioResult } from "../src/scenario.js";

const connection = resolvePostgresConnection();

/**
 * A real PostgreSQL server is required. If one is not reachable the suite skips loudly
 * rather than silently substituting an in-memory fake, which would defeat the experiment.
 */
async function postgresReachable(): Promise<boolean> {
  const client = new pg.Client({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.adminDatabase,
    connectionTimeoutMillis: 3_000,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

let available = false;
beforeAll(async () => {
  available = await postgresReachable();
  if (!available) {
    console.warn(
      `SKIPPING PostgreSQL world tests: no server at ${connection.host}:${connection.port}`,
    );
  }
});

async function withAdmin<T>(handler: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.adminDatabase,
  });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(name: string): Promise<boolean> {
  return withAdmin(async (client) => {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return result.rowCount === 1;
  });
}

function faultyScenario(fault: SeatUpgradeFault) {
  return defineScenario({
    name: subscriptionSeatUpgradePostgresScenario.name,
    description: subscriptionSeatUpgradePostgresScenario.description,
    fixture: subscriptionSeatUpgradePostgresScenario.fixture,
    expected: subscriptionSeatUpgradePostgresScenario.expected,
    createWorld: () => createSubscriptionSeatUpgradePostgresWorld({ fault }),
  });
}

function expectationFor(result: ScenarioResult, path: string) {
  const found = result.expectations.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`no expectation recorded for ${path}`);
  return found;
}

describe("disposable host guard", () => {
  it("accepts loopback hosts and unix sockets", () => {
    expect(() => assertDisposablePostgresHost("127.0.0.1")).not.toThrow();
    expect(() => assertDisposablePostgresHost("localhost")).not.toThrow();
    expect(() => assertDisposablePostgresHost("/tmp/.s.PGSQL.5432")).not.toThrow();
  });

  it("refuses to create disposable databases on remote or hosted servers", () => {
    for (const host of ["db.example.com", "ep-x.eu-central-1.aws.neon.tech", "10.0.0.4"]) {
      expect(() => assertDisposablePostgresHost(host)).toThrow(/non-local PostgreSQL host/u);
    }
  });

  it("resolves a local connection by default", () => {
    const resolved: PostgresConnection = resolvePostgresConnection();
    expect(() => assertDisposablePostgresHost(resolved.host)).not.toThrow();
  });
});

describe.runIf(process.env.RAPTURE_SKIP_PG !== "1")("postgres product world", () => {
  it("prepares a disposable database with the minimal schema", async () => {
    if (!available) return;
    const world = createSubscriptionSeatUpgradePostgresWorld();
    await world.prepare();
    const name = world.databaseName();
    try {
      expect(name).toMatch(/^rapture_scenario_[0-9a-f]{16}$/u);
      expect(await databaseExists(name ?? "")).toBe(true);

      const client = new pg.Client({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        database: name ?? "",
      });
      await client.connect();
      const tables = await client.query<{ readonly table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      await client.end();
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "accounts",
        "audit_events",
        "billing_subscriptions",
        "invoices",
        "notifications",
        "permissions_state",
      ]);
    } finally {
      await world.disposeOrReset();
    }
    expect(await databaseExists(name ?? "")).toBe(false);
  });

  it("seeds the exact fixture state as real rows", async () => {
    if (!available) return;
    const world = createSubscriptionSeatUpgradePostgresWorld();
    await world.prepare();
    try {
      await world.seedOrRestore(subscriptionSeatUpgradeScenario.fixture);
      const observation = await world.observe();
      expect(observation).toEqual({
        account: { seats: 10 },
        billing: { quantity: 10 },
        permissions: { activeSeats: 10 },
        prorationInvoiceCreated: false,
        auditEventCreated: false,
        confirmationNotificationCreated: false,
      });
    } finally {
      await world.disposeOrReset();
    }
  });

  it("executes the workflow against persisted rows and observes the result", async () => {
    if (!available) return;
    const world = createSubscriptionSeatUpgradePostgresWorld();
    await world.prepare();
    const name = world.databaseName() ?? "";
    try {
      await world.seedOrRestore(subscriptionSeatUpgradeScenario.fixture);
      await world.run();

      // Read the rows back on an independent connection: the mutation is really committed,
      // not held in a process-local object.
      const client = new pg.Client({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        database: name,
      });
      await client.connect();
      const rows = await client.query<{ readonly seats: number; readonly quantity: number }>(
        "SELECT a.seats, b.quantity FROM accounts a JOIN billing_subscriptions b ON b.account_id = a.id",
      );
      const invoices = await client.query("SELECT kind FROM invoices");
      await client.end();

      expect(rows.rows[0]).toEqual({ seats: 15, quantity: 15 });
      expect(invoices.rowCount).toBe(1);
      expect(await world.observe()).toMatchObject({ account: { seats: 15 } });
    } finally {
      await world.disposeOrReset();
    }
  });

  it("returns PASS end to end through runScenario", async () => {
    if (!available) return;
    const result = await runScenario(subscriptionSeatUpgradePostgresScenario);

    expect(result.status).toBe("PASS");
    expect(result.failures).toEqual([]);
    expect(result.observedState).toEqual({
      account: { seats: 15 },
      billing: { quantity: 15 },
      permissions: { activeSeats: 15 },
      prorationInvoiceCreated: true,
      auditEventCreated: true,
      confirmationNotificationCreated: true,
    });
    expect(result.stages.map((stage) => `${stage.phase}:${stage.status}`)).toEqual([
      "prepare:PASS",
      "seed:PASS",
      "action:PASS",
      "observe:PASS",
      "expect:PASS",
      "reset:PASS",
    ]);
  });

  it("produces the same deterministic result as the in-memory world", async () => {
    if (!available) return;
    const memory = await runScenario(subscriptionSeatUpgradeScenario);
    const postgres = await runScenario(subscriptionSeatUpgradePostgresScenario);

    expect(postgres.status).toBe(memory.status);
    expect(postgres.observedState).toEqual(memory.observedState);
    expect(postgres.expectations).toEqual(memory.expectations);
    // Volatile database identity never reaches the deterministic result content.
    expect(postgres.resultHash).toBe(memory.resultHash);
  });

  it("FAILs on a business-state regression while the workflow itself succeeds", async () => {
    if (!available) return;
    const result = await runScenario(faultyScenario("permissions-not-propagated"));

    expect(result.status).toBe("FAIL");
    // The workflow committed cleanly; this is not an infrastructure ERROR.
    expect(result.failures).toEqual([]);
    expect(result.stages.map((stage) => `${stage.phase}:${stage.status}`)).toEqual([
      "prepare:PASS",
      "seed:PASS",
      "action:PASS",
      "observe:PASS",
      "expect:PASS",
      "reset:PASS",
    ]);

    expect(expectationFor(result, "account.seats")).toMatchObject({ status: "PASS", actual: 15 });
    expect(expectationFor(result, "billing.quantity")).toMatchObject({
      status: "PASS",
      actual: 15,
    });
    expect(expectationFor(result, "permissions.activeSeats")).toMatchObject({
      status: "FAIL",
      difference: "MISMATCH",
      expected: 15,
      actual: 10,
    });
    expect(result.expectations.filter((entry) => entry.status === "FAIL")).toHaveLength(1);
  });

  it("returns ERROR, not FAIL, when the action hits a real database fault", async () => {
    if (!available) return;
    const result = await runScenario(faultyScenario("billing-table-missing-before-action"));

    expect(result.status).toBe("ERROR");
    expect(result.failures[0]?.phase).toBe("action");
    expect(result.expectations).toEqual([]);
    expect(result.stages).toContainEqual({ phase: "reset", status: "PASS" });
  });

  it("returns ERROR when observation hits a real database fault", async () => {
    if (!available) return;
    const result = await runScenario(faultyScenario("permissions-table-missing-before-observe"));

    expect(result.status).toBe("ERROR");
    expect(result.failures[0]?.phase).toBe("observe");
    expect(result.stages).toContainEqual({ phase: "reset", status: "PASS" });
  });

  it("returns ERROR when the server is unreachable and leaves nothing behind", async () => {
    if (!available) return;
    const result = await runScenario(
      defineScenario({
        name: subscriptionSeatUpgradePostgresScenario.name,
        description: subscriptionSeatUpgradePostgresScenario.description,
        fixture: subscriptionSeatUpgradePostgresScenario.fixture,
        expected: subscriptionSeatUpgradePostgresScenario.expected,
        createWorld: () =>
          createSubscriptionSeatUpgradePostgresWorld({ connection: { port: 59_999 } }),
      }),
    );

    expect(result.status).toBe("ERROR");
    expect(result.failures[0]?.phase).toBe("prepare");
  });

  it("drops the disposable database after PASS, FAIL, and ERROR", async () => {
    if (!available) return;
    const observed: { readonly status: string; readonly name: string }[] = [];

    for (const fault of [
      "none",
      "permissions-not-propagated",
      "billing-table-missing-before-action",
    ] as const) {
      let captured = "";
      const result = await runScenario(
        defineScenario({
          name: subscriptionSeatUpgradePostgresScenario.name,
          description: subscriptionSeatUpgradePostgresScenario.description,
          fixture: subscriptionSeatUpgradePostgresScenario.fixture,
          expected: subscriptionSeatUpgradePostgresScenario.expected,
          createWorld: () => {
            const world = createSubscriptionSeatUpgradePostgresWorld({ fault });
            return {
              ...world,
              prepare: async () => {
                await world.prepare();
                captured = world.databaseName() ?? "";
              },
            };
          },
        }),
      );
      observed.push({ status: result.status, name: captured });
    }

    expect(observed.map((entry) => entry.status)).toEqual(["PASS", "FAIL", "ERROR"]);
    for (const entry of observed) {
      expect(entry.name).not.toBe("");
      expect(await databaseExists(entry.name)).toBe(false);
    }
  });

  it("isolates two consecutive runs with no state leakage", async () => {
    if (!available) return;
    const names: string[] = [];
    const results: ScenarioResult[] = [];

    for (let index = 0; index < 2; index += 1) {
      let seededState: unknown;
      const result = await runScenario(
        defineScenario({
          name: subscriptionSeatUpgradePostgresScenario.name,
          description: subscriptionSeatUpgradePostgresScenario.description,
          fixture: subscriptionSeatUpgradePostgresScenario.fixture,
          expected: subscriptionSeatUpgradePostgresScenario.expected,
          createWorld: () => {
            const world = createSubscriptionSeatUpgradePostgresWorld();
            return {
              ...world,
              prepare: async () => {
                await world.prepare();
                names.push(world.databaseName() ?? "");
              },
              seedOrRestore: async (fixture) => {
                await world.seedOrRestore(fixture);
                // Snapshot the post-seed state: run two must not start from run one's rows.
                seededState = await world.observe();
              },
            };
          },
        }),
      );
      results.push(result);
      expect(seededState).toEqual({
        account: { seats: 10 },
        billing: { quantity: 10 },
        permissions: { activeSeats: 10 },
        prorationInvoiceCreated: false,
        auditEventCreated: false,
        confirmationNotificationCreated: false,
      });
    }

    const [first, second] = results;
    expect(names[0]).not.toBe(names[1]);
    expect(first?.status).toBe("PASS");
    expect(second?.status).toBe("PASS");
    expect(second?.observedState).toEqual(first?.observedState);
    expect(second?.resultHash).toBe(first?.resultHash);

    for (const name of names) {
      expect(await databaseExists(name)).toBe(false);
    }
  });

  it("leaves no rapture_scenario_* databases behind on the shared server", async () => {
    if (!available) return;
    const leftovers = await withAdmin(async (client) => {
      const result = await client.query<{ readonly datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'rapture\\_scenario\\_%'",
      );
      return result.rows.map((row) => row.datname);
    });
    expect(leftovers).toEqual([]);
  });
});
