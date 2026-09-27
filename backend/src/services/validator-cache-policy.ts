const EMPTY_CATALOG_RETRY_MS = 30_000;

export function validatorCacheTtlSeconds(validatorCount: number, configuredTtl: number): number {
  return validatorCount > 0 ? configuredTtl : Math.min(configuredTtl, EMPTY_CATALOG_RETRY_MS / 1000);
}

/** Also expires empty snapshots written by older versions with a full-hour TTL. */
export function expiredEmptyValidatorCatalog(
  snapshot: { validators: unknown[]; fetchedAt: string },
  now = Date.now(),
): boolean {
  if (snapshot.validators.length > 0) return false;
  const age = now - Date.parse(snapshot.fetchedAt);
  return !Number.isFinite(age) || age < 0 || age >= EMPTY_CATALOG_RETRY_MS;
}
