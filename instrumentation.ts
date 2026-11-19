// Runs once when the server starts. It validates the environment HERE, so a half-configured
// deployment (a database adapter without its URL, production without its secrets…) stops at
// start-up with a message that says what to fix — instead of failing in the middle of a purchase.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
