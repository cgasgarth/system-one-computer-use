import process from "node:process";

const CLEANUP_DELAY_MS = 100;
const OWNER_HOLD_MS = 1000;
const owner = setInterval(() => {
  /* Represents a live control child. */
}, OWNER_HOLD_MS);
async function release(): Promise<void> {
  await Bun.write("cleanup-complete", "released");
  clearInterval(owner);
  process.stdin.destroy();
}
process.once("SIGTERM", () => {
  setTimeout(() => {
    void release();
  }, CLEANUP_DELAY_MS);
});
process.stdin.once("data", () => {
  process.stdout.write(`${JSON.stringify({ status: "running", message: "Fixture running" })}\n`);
});
process.stdin.resume();
