import { resetTestRateLimits } from "./test-rate-fixture.ts";

if (process.env.AUTH_TEST_DATABASE_URL)
  await resetTestRateLimits(process.env.AUTH_TEST_DATABASE_URL);
