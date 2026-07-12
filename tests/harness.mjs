const tests = [];

class SkipError extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipError";
  }
}

export default function test(name, fn) {
  tests.push({ name, fn });
}

export async function run() {
  let failed = 0;
  let skipped = 0;

  for (const entry of tests) {
    try {
      await entry.fn({
        skip(message = "skipped") {
          throw new SkipError(message);
        },
      });
      console.log(`ok - ${entry.name}`);
    } catch (error) {
      if (error instanceof SkipError) {
        skipped += 1;
        console.log(`skip - ${entry.name}: ${error.message}`);
        continue;
      }

      failed += 1;
      console.error(`not ok - ${entry.name}`);
      console.error(error);
    }
  }

  const passed = tests.length - failed - skipped;
  console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}
