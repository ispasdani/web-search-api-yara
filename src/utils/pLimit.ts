// Minimal concurrency limiter — no npm package needed.
// Returns a `limit` function. Wrap any async fn with limit(() => yourFn())
// and at most `concurrency` promises will run simultaneously.
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active < concurrency && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
