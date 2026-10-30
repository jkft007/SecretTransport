import { setDefaultKdf } from '../src/kdf';

// The suite makes dozens of packets; use cheap Argon2id settings so it stays fast. Production
// parameters (64 MiB, 3 passes) are exercised explicitly in tests/security.test.ts.
setDefaultKdf({ type: 'argon2id', memLog2: 12, iterations: 1 });
