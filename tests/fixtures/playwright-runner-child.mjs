import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [mode, path, generated] = process.argv.slice(2);

if (mode === 'nonzero-with-late-descendant') {
  spawn(
    process.execPath,
    [
      '-e',
      'process.on("SIGTERM",()=>{});setTimeout(()=>{require("node:fs").writeFileSync(process.argv[1],process.argv[2]);process.exit(0)},100)',
      path,
      generated,
    ],
    { stdio: 'ignore' },
  );
  process.exit(7);
}

if (mode === 'wait-for-signal') {
  writeFileSync(path, generated);
  setInterval(() => {}, 1_000);
}
