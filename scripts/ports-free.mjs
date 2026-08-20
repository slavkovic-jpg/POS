/**
 * Free the ports this app uses.
 *
 * A leftover server holding 5185 is the most common reason `npm run dev`
 * fails, and the resulting EADDRINUSE stack trace tells you nothing useful.
 */
import { execSync } from 'node:child_process';

const PORTS = [5173, 5185];
const isWindows = process.platform === 'win32';

for (const port of PORTS) {
  let pids = [];
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { stdio: 'pipe' }).toString();
      pids = [...new Set(
        out.trim().split(/\r?\n/)
          .filter((l) => l.includes('LISTENING'))
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && p !== '0')
      )];
    } else {
      pids = execSync(`lsof -ti tcp:${port}`, { stdio: 'pipe' })
        .toString().trim().split('\n').filter(Boolean);
    }
  } catch {
    // findstr and lsof both exit non-zero when nothing matches.
    console.log(`  ${port} already free`);
    continue;
  }

  if (!pids.length) { console.log(`  ${port} already free`); continue; }

  for (const pid of pids) {
    try {
      execSync(isWindows ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`, { stdio: 'ignore' });
      console.log(`  freed ${port} (pid ${pid})`);
    } catch {
      console.log(`  could not kill pid ${pid} on ${port} — may need an elevated shell`);
    }
  }
}
