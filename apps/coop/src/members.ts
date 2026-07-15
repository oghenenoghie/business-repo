import type { PoolClient } from "pg";
import type { Member, MemberStatus, NewMemberInput } from "./types.js";

interface MemberRow {
  id: string;
  org_id: string;
  membership_number: string;
  full_name: string;
  // pg parses `date` columns to a JS Date by default, despite this type —
  // toMember() normalizes it back to YYYY-MM-DD before it ever reaches a UI.
  join_date: string | Date;
  status: MemberStatus;
  phone: string | null;
  email: string | null;
}

export async function createMember(client: PoolClient, input: NewMemberInput): Promise<Member> {
  const result = await client.query<MemberRow>(
    `insert into members (org_id, membership_number, full_name, join_date, phone, email)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [input.orgId, input.membershipNumber, input.fullName, input.joinDate, input.phone ?? null, input.email ?? null],
  );
  return toMember(result.rows[0]!);
}

export async function listMembers(client: PoolClient, orgId: string): Promise<Member[]> {
  const result = await client.query<MemberRow>("select * from members where org_id = $1 order by membership_number", [
    orgId,
  ]);
  return result.rows.map(toMember);
}

export async function getMember(client: PoolClient, orgId: string, memberId: string): Promise<Member | null> {
  const result = await client.query<MemberRow>("select * from members where org_id = $1 and id = $2", [
    orgId,
    memberId,
  ]);
  const row = result.rows[0];
  return row ? toMember(row) : null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    orgId: row.org_id,
    membershipNumber: row.membership_number,
    fullName: row.full_name,
    joinDate: toDateString(row.join_date),
    status: row.status,
    phone: row.phone,
    email: row.email,
  };
}

function toDateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
