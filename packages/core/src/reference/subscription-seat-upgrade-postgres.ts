import { randomBytes } from "node:crypto";
import pg from "pg";
import { defineScenario, type ScenarioWorld } from "../scenario.js";
import {
  type SeatUpgradeFixture,
  type SeatUpgradeObservation,
  subscriptionSeatUpgradeScenario,
} from "./subscription-seat-upgrade.js";

/**
 * The single account the reference scenario operates on. The scenario fixture is a
 * business-state snapshot, not a database dump, so the world owns the surrogate key.
 */
const ACCOUNT_ID = "acct_reference";

const PRORATION_INVOICE_KIND = "seat-upgrade-proration";
const SEAT_UPGRADE_AUDIT_KIND = "subscription.seats-upgraded";
const SEAT_UPGRADE_NOTIFICATION_KIND = "subscription-seat-upgrade-confirmed";

const UPGRADE_QUANTITY = 15;

/** Only the state the subscription-seat-upgrade scenario actually reads or writes. */
const SCHEMA_DDL = `
CREATE TABLE accounts (
  id text PRIMARY KEY,
  plan text NOT NULL,
  seats integer NOT NULL CHECK (seats >= 0)
);
CREATE TABLE billing_subscriptions (
  account_id text PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity >= 0),
  outstanding_balance integer NOT NULL
);
CREATE TABLE permissions_state (
  account_id text PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  active_seats integer NOT NULL CHECK (active_seats >= 0)
);
CREATE TABLE invoices (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind text NOT NULL
);
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind text NOT NULL
);
CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind text NOT NULL
);
`;

/**
 * Controlled, test-only faults. Every value other than "none" produces a *real* fault in
 * real PostgreSQL rather than a synthetic throw, so the PASS/FAIL/ERROR boundary is
 * exercised by genuine behaviour.
 */
export type SeatUpgradeFault =
  | "none"
  /** Business regression: the workflow commits, but permissions never learn about it. */
  | "permissions-not-propagated"
  /** Infrastructure fault surfacing during the action. */
  | "billing-table-missing-before-action"
  /** Infrastructure fault surfacing during observation. */
  | "permissions-table-missing-before-observe";

export interface PostgresConnection {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password?: string;
  /** Maintenance database used only to CREATE/DROP the disposable scenario database. */
  readonly adminDatabase: string;
}

export interface PostgresSeatUpgradeWorldOptions {
  readonly connection?: Partial<PostgresConnection>;
  readonly fault?: SeatUpgradeFault;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Rapture worlds are disposable, which means they issue DROP DATABASE. That is only ever
 * safe against a local, throwaway server, so refuse anything that is not loopback or a
 * unix socket. This is the guard that keeps a hosted or production database untouchable.
 */
export function assertDisposablePostgresHost(host: string): void {
  if (host.startsWith("/")) return;
  if (LOCAL_HOSTS.has(host)) return;
  throw new Error(`refusing to create a disposable database on non-local PostgreSQL host: ${host}`);
}

export function resolvePostgresConnection(
  overrides: Partial<PostgresConnection> = {},
): PostgresConnection {
  const port = Number(overrides.port ?? process.env.PGPORT ?? 5432);
  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error(`invalid PostgreSQL port: ${String(port)}`);
  }
  const password = overrides.password ?? process.env.PGPASSWORD;
  return {
    host: overrides.host ?? process.env.PGHOST ?? "127.0.0.1",
    port,
    user: overrides.user ?? process.env.PGUSER ?? process.env.USER ?? "postgres",
    ...(password === undefined ? {} : { password }),
    adminDatabase: overrides.adminDatabase ?? process.env.PGDATABASE ?? "postgres",
  };
}

function clientConfig(connection: PostgresConnection, database: string): pg.ClientConfig {
  return {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database,
    ...(connection.password === undefined ? {} : { password: connection.password }),
  };
}

async function withAdminClient<T>(
  connection: PostgresConnection,
  handler: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client(clientConfig(connection, connection.adminDatabase));
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

/** Identifiers cannot be parameterised, so the generated name is strictly validated. */
function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(identifier)) {
    throw new Error(`unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function disposableDatabaseName(): string {
  return `rapture_scenario_${randomBytes(8).toString("hex")}`;
}

async function seedFixture(client: pg.Client, fixture: SeatUpgradeFixture): Promise<void> {
  await client.query("BEGIN");
  try {
    // Restore semantics: the scenario database must contain the fixture and nothing else.
    await client.query(
      "TRUNCATE notifications, audit_events, invoices, permissions_state, billing_subscriptions, accounts RESTART IDENTITY CASCADE",
    );
    await client.query("INSERT INTO accounts (id, plan, seats) VALUES ($1, $2, $3)", [
      ACCOUNT_ID,
      fixture.account.plan,
      fixture.account.seats,
    ]);
    await client.query(
      "INSERT INTO billing_subscriptions (account_id, quantity, outstanding_balance) VALUES ($1, $2, $3)",
      [ACCOUNT_ID, fixture.billing.quantity, fixture.billing.outstandingBalance],
    );
    await client.query("INSERT INTO permissions_state (account_id, active_seats) VALUES ($1, $2)", [
      ACCOUNT_ID,
      fixture.permissions.activeSeats,
    ]);
    for (const invoice of fixture.invoices) {
      await client.query("INSERT INTO invoices (account_id, kind) VALUES ($1, $2)", [
        ACCOUNT_ID,
        invoice.kind,
      ]);
    }
    for (const event of fixture.auditEvents) {
      await client.query("INSERT INTO audit_events (account_id, kind) VALUES ($1, $2)", [
        ACCOUNT_ID,
        event.kind,
      ]);
    }
    for (const notification of fixture.notifications) {
      await client.query("INSERT INTO notifications (account_id, kind) VALUES ($1, $2)", [
        ACCOUNT_ID,
        notification.kind,
      ]);
    }
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * The product workflow under test. It reads persisted state, validates against it, and
 * commits every downstream consequence in one transaction.
 */
export async function upgradeSubscriptionSeats(
  client: pg.Client,
  accountId: string,
  quantity: number,
  fault: SeatUpgradeFault = "none",
): Promise<void> {
  await client.query("BEGIN");
  try {
    const current = await client.query<{ readonly seats: number }>(
      "SELECT seats FROM accounts WHERE id = $1 FOR UPDATE",
      [accountId],
    );
    const account = current.rows[0];
    if (account === undefined) throw new Error(`account not found: ${accountId}`);
    if (!Number.isSafeInteger(quantity) || quantity <= account.seats) {
      throw new Error("upgrade quantity must be a safe integer greater than current seats");
    }

    await client.query("UPDATE accounts SET seats = $2 WHERE id = $1", [accountId, quantity]);
    await client.query("UPDATE billing_subscriptions SET quantity = $2 WHERE account_id = $1", [
      accountId,
      quantity,
    ]);
    if (fault !== "permissions-not-propagated") {
      await client.query("UPDATE permissions_state SET active_seats = $2 WHERE account_id = $1", [
        accountId,
        quantity,
      ]);
    }
    await client.query("INSERT INTO invoices (account_id, kind) VALUES ($1, $2)", [
      accountId,
      PRORATION_INVOICE_KIND,
    ]);
    await client.query("INSERT INTO audit_events (account_id, kind) VALUES ($1, $2)", [
      accountId,
      SEAT_UPGRADE_AUDIT_KIND,
    ]);
    await client.query("INSERT INTO notifications (account_id, kind) VALUES ($1, $2)", [
      accountId,
      SEAT_UPGRADE_NOTIFICATION_KIND,
    ]);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

type ObservationRow = {
  readonly seats: number;
  readonly quantity: number;
  readonly active_seats: number;
  readonly proration_invoice_created: boolean;
  readonly audit_event_created: boolean;
  readonly confirmation_notification_created: boolean;
};

/**
 * Observation is deliberately business-shaped: no row ids, timestamps, database name or
 * other volatile PostgreSQL metadata leaks into the deterministic result content.
 */
export async function observeSeatUpgradeState(
  client: pg.Client,
  accountId: string,
): Promise<SeatUpgradeObservation> {
  const result = await client.query<ObservationRow>(
    `SELECT
       a.seats,
       b.quantity,
       p.active_seats,
       EXISTS (SELECT 1 FROM invoices i WHERE i.account_id = a.id AND i.kind = $2)
         AS proration_invoice_created,
       EXISTS (SELECT 1 FROM audit_events e WHERE e.account_id = a.id AND e.kind = $3)
         AS audit_event_created,
       EXISTS (SELECT 1 FROM notifications n WHERE n.account_id = a.id AND n.kind = $4)
         AS confirmation_notification_created
     FROM accounts a
     JOIN billing_subscriptions b ON b.account_id = a.id
     JOIN permissions_state p ON p.account_id = a.id
     WHERE a.id = $1`,
    [accountId, PRORATION_INVOICE_KIND, SEAT_UPGRADE_AUDIT_KIND, SEAT_UPGRADE_NOTIFICATION_KIND],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no observable account state for: ${accountId}`);
  return {
    account: { seats: row.seats },
    billing: { quantity: row.quantity },
    permissions: { activeSeats: row.active_seats },
    prorationInvoiceCreated: row.proration_invoice_created,
    auditEventCreated: row.audit_event_created,
    confirmationNotificationCreated: row.confirmation_notification_created,
  };
}

export interface PostgresSeatUpgradeWorld
  extends ScenarioWorld<SeatUpgradeFixture, SeatUpgradeObservation> {
  /** Name of the disposable database, for isolation and cleanup assertions. */
  readonly databaseName: () => string | undefined;
}

export function createSubscriptionSeatUpgradePostgresWorld(
  options: PostgresSeatUpgradeWorldOptions = {},
): PostgresSeatUpgradeWorld {
  const connection = resolvePostgresConnection(options.connection);
  const fault = options.fault ?? "none";
  let databaseName: string | undefined;
  let client: pg.Client | undefined;

  return {
    databaseName: () => databaseName,

    prepare: async () => {
      if (databaseName !== undefined) throw new Error("world has already been prepared");
      assertDisposablePostgresHost(connection.host);
      const name = disposableDatabaseName();
      await withAdminClient(connection, async (admin) => {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
      });
      // Only record the name once the database exists, so disposal never targets a
      // database this world did not create.
      databaseName = name;
      const scenarioClient = new pg.Client(clientConfig(connection, name));
      await scenarioClient.connect();
      client = scenarioClient;
      await scenarioClient.query(SCHEMA_DDL);
    },

    seedOrRestore: async (fixture) => {
      if (client === undefined) throw new Error("world must be prepared before seeding");
      await seedFixture(client, fixture);
    },

    run: async () => {
      if (client === undefined) throw new Error("world must be seeded before the action");
      if (fault === "billing-table-missing-before-action") {
        await client.query("DROP TABLE billing_subscriptions");
      }
      await upgradeSubscriptionSeats(client, ACCOUNT_ID, UPGRADE_QUANTITY, fault);
    },

    observe: async () => {
      if (client === undefined) throw new Error("world has no state to observe");
      if (fault === "permissions-table-missing-before-observe") {
        await client.query("DROP TABLE permissions_state");
      }
      return observeSeatUpgradeState(client, ACCOUNT_ID);
    },

    disposeOrReset: async () => {
      const name = databaseName;
      databaseName = undefined;
      const openClient = client;
      client = undefined;
      if (openClient !== undefined) {
        await openClient.end();
      }
      if (name === undefined) return;
      await withAdminClient(connection, async (admin) => {
        // Any connection left over from a crashed run would block the drop.
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [name],
        );
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
      });
    },
  };
}

/**
 * The same scenario name, description, fixture and expectations as the in-memory
 * reference. Only `createWorld` differs, which is the whole point of the experiment.
 */
export const subscriptionSeatUpgradePostgresScenario = defineScenario<
  SeatUpgradeFixture,
  SeatUpgradeObservation
>({
  name: subscriptionSeatUpgradeScenario.name,
  description: subscriptionSeatUpgradeScenario.description,
  fixture: subscriptionSeatUpgradeScenario.fixture,
  expected: subscriptionSeatUpgradeScenario.expected,
  createWorld: () => createSubscriptionSeatUpgradePostgresWorld(),
});
