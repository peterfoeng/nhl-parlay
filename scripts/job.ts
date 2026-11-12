import { runDaily, runDate } from "../lib/job/run";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const force = process.argv.includes("--force");
  const date = arg("--date");
  const grade = arg("--grade");
  const reports = [];
  if (!date && !grade) {
    const daily = await runDaily();
    reports.push(daily.featured);
    if (daily.previous) reports.push(daily.previous);
  } else {
    if (date) reports.push(await runDate(date, force));
    if (grade) reports.push(await runDate(grade, force));
  }
  for (const item of reports) console.log(JSON.stringify(item, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
