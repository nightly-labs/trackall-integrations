import type { UserDefiPosition } from './position'
import type { AccountsMap, GetProgramAccountsRequest, SolanaAddress, UserPositionsPlan } from './solanaIntegration'

/**
 * Drives multiple UserPositionsPlan generators in parallel.
 *
 * Each round, all active generators yield their required addresses or program
 * account requests. Address yields are deduplicated and fetched in a single
 * getMultipleAccounts call shared across all generators. getProgramAccounts
 * requests are fetched in parallel but each result is returned only to the
 * generator that issued the request — results are never cross-pollinated.
 */
export async function runIntegrations(
  plans: UserPositionsPlan[],
  fetchAccounts: (addresses: SolanaAddress[]) => Promise<AccountsMap>,
  fetchProgramAccounts: (req: GetProgramAccountsRequest) => Promise<AccountsMap>,
): Promise<UserDefiPosition[][]> {
  const steps = await Promise.all(plans.map((p) => p.next()))

  while (steps.some((s) => !s.done)) {
    const addressSet = new Set<SolanaAddress>()
    // Map from generator index to its getProgramAccounts request
    const progReqByIndex = new Map<number, GetProgramAccountsRequest>()

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      if (step.done) continue
      if (Array.isArray(step.value)) {
        for (const addr of step.value) addressSet.add(addr)
      } else {
        progReqByIndex.set(i, step.value)
      }
    }

    // Fire address fetch and all program account fetches in parallel
    const progEntries = [...progReqByIndex.entries()]
    const [multiMap, ...progMaps] = await Promise.all([
      addressSet.size > 0 ? fetchAccounts([...addressSet]) : Promise.resolve<AccountsMap>({}),
      ...progEntries.map(([, req]) => fetchProgramAccounts(req)),
    ])

    await Promise.all(
      steps.map(async (step, i) => {
        if (step.done) return
        // Each generator gets the shared address map plus only its own prog accounts result
        const progMapIndex = progEntries.findIndex(([idx]) => idx === i)
        const progMap = progMapIndex >= 0 ? progMaps[progMapIndex] : undefined
        const accounts: AccountsMap = progMap ? { ...multiMap, ...progMap } : { ...multiMap }
        steps[i] = await plans[i]!.next(accounts)
      }),
    )
  }

  return steps.map((s) => s.value as UserDefiPosition[])
}
