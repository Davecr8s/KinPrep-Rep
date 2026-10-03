// Shared by the e2e database server and the tests. Fake data only.

export const E2E_DB_PORT = 54329;
export const E2E_DB_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;
export const E2E_PRACTICE_SECRET = "e2e-practice-link-secret-not-for-production";
export const E2E_CRON_SECRET = "e2e-cron-secret-not-for-production-0123456789";

export const E2E_STUDENTS = {
  junior: {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "Kemi",
    junior: true,
    whatsapp: null,
  },
  senior: {
    id: "22222222-2222-4222-8222-222222222222",
    firstName: "Tunde",
    junior: false,
    whatsapp: "+2348099000001",
  },
  reload: {
    id: "33333333-3333-4333-8333-333333333333",
    firstName: "Ife",
    junior: false,
    whatsapp: "+2348099000002",
  },
} as const;
