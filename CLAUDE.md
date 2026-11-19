# Cerebro Web

Read **[AGENTS.md](AGENTS.md)** first (Spanish: [AGENTS.es.md](AGENTS.es.md)). It says what this
project is, the rules that always apply, where everything lives and how to verify your work.

Three things that never change:

1. **The brain comes first.** `cerebro/` is the guide for building and growing a business
   website. Start with `cerebro/dist/llms-full.txt`.
2. **Never invent business data** (prices, stock, addresses, policies, reviews). What is missing
   is marked as pending and asked to the owner.
3. **Verify before saying it works:** `npm run check && npm run typecheck && npm test &&
   npm run build && npm run test:e2e`, and look at the result in a real browser.
