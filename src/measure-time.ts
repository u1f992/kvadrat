export const measureTime = async (fn: () => void | Promise<void>) => {
  const start = process.hrtime.bigint();
  await fn();
  console.log(`${(process.hrtime.bigint() - start) / 1000000n} ms`);
};
