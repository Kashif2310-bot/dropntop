// Runs `worker` over `items` with at most `limit` running at once, instead
// of firing everything through Promise.all in one shot. Needed once a drop
// can hold 15-20 files: kicking off 20 simultaneous large-file hashes +
// uploads at once is what actually causes "it doesn't work" on a phone —
// not any one file being too big, but ALL of them competing for memory and
// the network at the same time. A small, bounded pool keeps memory flat and
// keeps the network from being sliced into 20 starved connections, while
// still uploading several files at once instead of one-by-one.
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}
