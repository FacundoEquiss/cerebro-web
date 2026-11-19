import { env, EnvError } from "@/lib/env";

try {
  env();
} catch (e) {
  if (e instanceof EnvError) {
    console.error(`\n✗ ${e.message}\n\nThe server did not start. Fix the variables above and start it again.\n`);
    process.exit(1);
  }
  throw e;
}
