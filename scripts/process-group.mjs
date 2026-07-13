const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function signalTarget(pid) {
  return process.platform === 'win32' ? pid : -pid;
}

export function signalProcessGroup(pid, signal) {
  try {
    process.kill(signalTarget(pid), signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function processGroupExists(pid) {
  try {
    process.kill(signalTarget(pid), 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

export async function stopProcessGroup(pid, { graceMs = 2_000 } = {}) {
  if (!signalProcessGroup(pid, 'SIGTERM')) return;

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return;
    await delay(25);
  }

  if (signalProcessGroup(pid, 'SIGKILL')) {
    while (processGroupExists(pid)) await delay(10);
  }
}
