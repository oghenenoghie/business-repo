import { randomUUID } from "node:crypto";
import { closePool, withUserContext } from "@bp/core";
import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balance, post, reverse, trialBalance, UnbalancedEntryError } from "../src/ledger.js";
import { adminClient, createAccount, createTestOrg } from "./helpers.js";

describe("ledger", () => {
  let admin: pg.Client;
  let org: string;
  let owner: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const testOrg = await createTestOrg(admin, "Ledger Test Org");
    org = testOrg.orgId;
    owner = testOrg.ownerId;

    await createAccount(admin, org, "1000", "Cash", "asset", "NGN");
    await createAccount(admin, org, "2000", "Accounts Payable", "liability", "NGN");
    await createAccount(admin, org, "3000", "Equity", "equity", "NGN");
    await createAccount(admin, org, "4000", "Revenue", "revenue", "NGN");
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("posts a balanced entry", async () => {
    const entry = await withUserContext(owner, (client) =>
      post(client, {
        orgId: org,
        entryDate: "2026-01-01",
        description: "opening balance",
        source: "test",
        idempotencyKey: `open-${randomUUID()}`,
        lines: [
          { account: "1000", amount: 10_000_00n },
          { account: "3000", amount: -10_000_00n },
        ],
      }),
    );
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.reduce((sum, l) => sum + l.amount, 0n)).toBe(0n);
  });

  it("rejects an unbalanced entry at the application layer", async () => {
    await expect(
      withUserContext(owner, (client) =>
        post(client, {
          orgId: org,
          entryDate: "2026-01-01",
          description: "typo",
          source: "test",
          idempotencyKey: `unbalanced-${randomUUID()}`,
          lines: [
            { account: "1000", amount: 100_00n },
            { account: "3000", amount: -50_00n },
          ],
        }),
      ),
    ).rejects.toThrow(UnbalancedEntryError);
  });

  it("the database also rejects an unbalanced entry, even bypassing the application check", async () => {
    // Insert lines directly, skipping post()'s pre-check, to prove the
    // deferred constraint trigger is the real backstop.
    await expect(
      withUserContext(owner, async (client) => {
        const entryResult = await client.query<{ id: string }>(
          `insert into journal_entries (org_id, entry_date, description, source, idempotency_key)
           values ($1, $2, $3, $4, $5) returning id`,
          [org, "2026-01-01", "forged unbalanced entry", "test", `forged-${randomUUID()}`],
        );
        const entryId = entryResult.rows[0]!.id;
        const accounts = await client.query<{ id: string; code: string }>(
          "select id, code from accounts where org_id = $1 and code in ('1000', '3000')",
          [org],
        );
        const byCode = new Map(accounts.rows.map((r) => [r.code, r.id]));
        await client.query(
          "insert into journal_lines (entry_id, account_id, amount, currency) values ($1, $2, $3, 'NGN')",
          [entryId, byCode.get("1000"), 100_00n],
        );
        await client.query(
          "insert into journal_lines (entry_id, account_id, amount, currency) values ($1, $2, $3, 'NGN')",
          [entryId, byCode.get("3000"), -40_00n],
        );
        // Deferred trigger fires at COMMIT, which withUserContext issues.
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it("posting the same idempotency key twice is a no-op", async () => {
    const key = `idempotent-${randomUUID()}`;
    const lines = [
      { account: "1000", amount: 500_00n },
      { account: "4000", amount: -500_00n },
    ];

    const first = await withUserContext(owner, (client) =>
      post(client, { orgId: org, entryDate: "2026-01-02", description: "sale", source: "test", idempotencyKey: key, lines }),
    );
    const second = await withUserContext(owner, (client) =>
      post(client, { orgId: org, entryDate: "2026-01-02", description: "sale", source: "test", idempotencyKey: key, lines }),
    );

    expect(second.id).toBe(first.id);

    const count = await admin.query("select count(*) from journal_entries where org_id = $1 and idempotency_key = $2", [
      org,
      key,
    ]);
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it("reverse() posts the mirror entry; both stay visible and net balance returns to its prior value", async () => {
    const before = await withUserContext(owner, (client) => balance(client, org, "1000"));

    const entry = await withUserContext(owner, (client) =>
      post(client, {
        orgId: org,
        entryDate: "2026-01-03",
        description: "reversal source",
        source: "test",
        idempotencyKey: `rev-src-${randomUUID()}`,
        lines: [
          { account: "1000", amount: 1_000_00n },
          { account: "4000", amount: -1_000_00n },
        ],
      }),
    );
    const afterPost = await withUserContext(owner, (client) => balance(client, org, "1000"));
    expect(afterPost - before).toBe(1_000_00n);

    const reversal = await withUserContext(owner, (client) => reverse(client, org, entry.id, { reason: "posted in error" }));
    expect(reversal.reversesId).toBe(entry.id);

    const afterReverse = await withUserContext(owner, (client) => balance(client, org, "1000"));
    expect(afterReverse).toBe(before);

    const rows = await admin.query("select id from journal_entries where org_id = $1 and id = any($2)", [
      org,
      [entry.id, reversal.id],
    ]);
    expect(rows.rows).toHaveLength(2);
  });

  it("reversing the same entry twice is a no-op (idempotent)", async () => {
    const entry = await withUserContext(owner, (client) =>
      post(client, {
        orgId: org,
        entryDate: "2026-01-04",
        description: "reversal source 2",
        source: "test",
        idempotencyKey: `rev-src-2-${randomUUID()}`,
        lines: [
          { account: "1000", amount: 200_00n },
          { account: "4000", amount: -200_00n },
        ],
      }),
    );

    const firstReversal = await withUserContext(owner, (client) => reverse(client, org, entry.id, { reason: "dup test" }));
    const secondReversal = await withUserContext(owner, (client) => reverse(client, org, entry.id, { reason: "dup test" }));
    expect(secondReversal.id).toBe(firstReversal.id);
  });

  it("a KWD amount round-trips through post() and balance() without losing the third decimal", async () => {
    const kwdOrg = await createTestOrg(admin, "KWD Org");
    await createAccount(admin, kwdOrg.orgId, "1000", "Cash", "asset", "KWD");
    await createAccount(admin, kwdOrg.orgId, "3000", "Equity", "equity", "KWD");

    const amountFils = 1_234n; // 1.234 KWD — the third decimal is the point
    await withUserContext(kwdOrg.ownerId, (client) =>
      post(client, {
        orgId: kwdOrg.orgId,
        entryDate: "2026-01-01",
        description: "KWD precision check",
        source: "test",
        idempotencyKey: `kwd-${randomUUID()}`,
        lines: [
          { account: "1000", amount: amountFils },
          { account: "3000", amount: -amountFils },
        ],
      }),
    );

    const cashBalance = await withUserContext(kwdOrg.ownerId, (client) => balance(client, kwdOrg.orgId, "1000"));
    expect(cashBalance).toBe(1_234n);
  });

  it("trial balance sums to zero, and every account balance matches an independent raw-SQL sum, under randomized balanced postings", async () => {
    const accountCodes = ["1000", "2000", "3000", "4000"];
    let counter = 0;

    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 500_000 }), { minLength: 1, maxLength: 6 }), async (amounts) => {
        const lines = amounts.map((amount, i) => ({
          account: accountCodes[i % (accountCodes.length - 1)]!,
          amount: BigInt(amount),
        }));
        const total = lines.reduce((sum, l) => sum + l.amount, 0n);
        lines.push({ account: accountCodes[accountCodes.length - 1]!, amount: -total });

        await withUserContext(owner, (client) =>
          post(client, {
            orgId: org,
            entryDate: "2026-02-01",
            description: "property test posting",
            source: "test",
            idempotencyKey: `prop-${counter++}-${randomUUID()}`,
            lines,
          }),
        );
      }),
      { numRuns: 100 },
    );

    const totals = await withUserContext(owner, (client) => trialBalance(client, org));
    expect(totals.NGN).toBe(0n);

    for (const code of accountCodes) {
      const viaApi = await withUserContext(owner, (client) => balance(client, org, code));
      const viaRawSql = await admin.query<{ total: string | null }>(
        `select sum(jl.amount) as total from journal_lines jl
         join accounts a on a.id = jl.account_id
         where a.org_id = $1 and a.code = $2`,
        [org, code],
      );
      expect(viaApi).toBe(BigInt(viaRawSql.rows[0]?.total ?? "0"));
    }
  });
});
