// A standard batch ref can never be a legacy publication source or destination.
export function reservedBatchRef(...refs: unknown[]) {
  return refs.some(ref=>typeof ref==='string' && /^(?:refs\/heads\/)?factory\/batch\//.test(ref));
}
