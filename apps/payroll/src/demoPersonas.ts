// Fixed, known user IDs for the deployed demo — not real authentication.
// The demo login page lets a visitor pick one of these; the seed script
// grants them memberships in the demo org. See apps/payroll/README.md
// "Not built yet" for why this exists instead of real Supabase Auth.
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_ADMIN_ID = "00000000-0000-4000-8000-000000000002";
export const DEMO_VIEWER_ID = "00000000-0000-4000-8000-000000000003";
