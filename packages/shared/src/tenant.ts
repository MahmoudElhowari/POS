/** Every row and every query is scoped to a restaurant (tenant). */
export type TenantId = string & { readonly __brand: "TenantId" };

export function tenantId(value: string): TenantId {
  if (!/^[a-z0-9-]{2,64}$/.test(value)) {
    throw new RangeError(`Invalid tenant id: ${value}`);
  }
  return value as TenantId;
}
