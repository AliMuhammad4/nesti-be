const tails = new Map();

/** Runs tasks for the same key one at a time. A later task sees the earlier write. */
export function withExclusiveKey(key, task) {
  const previous = tails.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.then(() => {}, () => {});
  tails.set(key, tail);
  tail.finally(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
