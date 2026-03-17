import type { UserDefiPosition } from './position'
import type { AccountsMap, SolanaAddress, UserPositionsPlan } from './solanaIntegration'

/**
 * Drives multiple UserPositionsPlan generators in parallel.
 *
 * Each round, all active generators yield their required addresses. Those are
 * deduplicated and fetched in a single RPC call. The shared AccountsMap is
 * passed back to every generator so each can read the addresses it needs.
 *
 * This guarantees at most one getMultipleAccounts call per round regardless
 * of how many integrations are running.
 */
export async function runIntegrations(
  plans: UserPositionsPlan[],
  fetchAccounts: (addresses: SolanaAddress[]) => Promise<AccountsMap>,
): Promise<UserDefiPosition[][]> {
  const steps = await Promise.all(plans.map((p) => p.next()))

  while (steps.some((s) => !s.done)) {
    const addressSet = new Set<SolanaAddress>()
    for (const step of steps) {
      if (!step.done) {
        for (const addr of step.value) addressSet.add(addr)
      }
    }

    const accounts = await fetchAccounts([...addressSet])

    await Promise.all(
      steps.map(async (step, i) => {
        if (!step.done) {
          steps[i] = await plans[i]!.next(accounts)
        }
      }),
    )
  }

  return steps.map((s) => s.value as UserDefiPosition[])
}
