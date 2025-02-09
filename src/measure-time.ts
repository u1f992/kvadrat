export const measureTime = async (
  label: string,
  fn: () => any | Promise<any>,
) => {
  const start = process.hrtime.bigint();
  const ret = await fn();
  console.log(`${label}: ${(process.hrtime.bigint() - start) / 1000000n} ms`);
  return ret;
};
