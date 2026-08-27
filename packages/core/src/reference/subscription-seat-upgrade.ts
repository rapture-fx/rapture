import { defineScenario, type ScenarioWorld } from "../scenario.js";

export type SeatUpgradeFixture = {
  readonly account: { readonly plan: "team"; readonly seats: number };
  readonly billing: { readonly quantity: number; readonly outstandingBalance: number };
  readonly permissions: { readonly activeSeats: number };
  readonly invoices: readonly { readonly kind: string }[];
  readonly auditEvents: readonly { readonly kind: string }[];
  readonly notifications: readonly { readonly kind: string }[];
};

export type SeatUpgradeObservation = {
  readonly account: { readonly seats: number };
  readonly billing: { readonly quantity: number };
  readonly permissions: { readonly activeSeats: number };
  readonly prorationInvoiceCreated: boolean;
  readonly auditEventCreated: boolean;
  readonly confirmationNotificationCreated: boolean;
};

type MutableProductState = {
  account: { plan: "team"; seats: number };
  billing: { quantity: number; outstandingBalance: number };
  permissions: { activeSeats: number };
  invoices: { kind: string }[];
  auditEvents: { kind: string }[];
  notifications: { kind: string }[];
};

function upgradeSubscriptionSeats(state: MutableProductState, quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= state.account.seats) {
    throw new Error("upgrade quantity must be a safe integer greater than current seats");
  }
  state.account.seats = quantity;
  state.billing.quantity = quantity;
  state.permissions.activeSeats = quantity;
  state.invoices.push({ kind: "seat-upgrade-proration" });
  state.auditEvents.push({ kind: "subscription.seats-upgraded" });
  state.notifications.push({ kind: "subscription-seat-upgrade-confirmed" });
}

function cloneFixture(fixture: SeatUpgradeFixture): MutableProductState {
  return structuredClone(fixture) as MutableProductState;
}

export function createSubscriptionSeatUpgradeWorld(): ScenarioWorld<
  SeatUpgradeFixture,
  SeatUpgradeObservation
> {
  let prepared = false;
  let state: MutableProductState | undefined;
  return {
    prepare: async () => {
      if (prepared) throw new Error("world has already been prepared");
      prepared = true;
    },
    seedOrRestore: async (fixture) => {
      if (!prepared) throw new Error("world must be prepared before seeding");
      state = cloneFixture(fixture);
    },
    run: async () => {
      if (state === undefined) throw new Error("world must be seeded before the action");
      upgradeSubscriptionSeats(state, 15);
    },
    observe: async () => {
      if (state === undefined) throw new Error("world has no state to observe");
      return {
        account: { seats: state.account.seats },
        billing: { quantity: state.billing.quantity },
        permissions: { activeSeats: state.permissions.activeSeats },
        prorationInvoiceCreated: state.invoices.some(
          (invoice) => invoice.kind === "seat-upgrade-proration",
        ),
        auditEventCreated: state.auditEvents.some(
          (event) => event.kind === "subscription.seats-upgraded",
        ),
        confirmationNotificationCreated: state.notifications.some(
          (notification) => notification.kind === "subscription-seat-upgrade-confirmed",
        ),
      };
    },
    disposeOrReset: async () => {
      state = undefined;
      prepared = false;
    },
  };
}

export const subscriptionSeatUpgradeScenario = defineScenario({
  name: "subscription-seat-upgrade",
  description: "Upgrade a team account from 10 to 15 seats and verify resulting product state.",
  fixture: {
    account: { plan: "team", seats: 10 },
    billing: { quantity: 10, outstandingBalance: 0 },
    permissions: { activeSeats: 10 },
    invoices: [],
    auditEvents: [],
    notifications: [],
  },
  expected: {
    account: { seats: 15 },
    billing: { quantity: 15 },
    permissions: { activeSeats: 15 },
    prorationInvoiceCreated: true,
    auditEventCreated: true,
    confirmationNotificationCreated: true,
  },
  createWorld: createSubscriptionSeatUpgradeWorld,
});
