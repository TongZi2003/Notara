// The Host owns its cleanup. Losing the wrapper must not leave an orphan Host
// holding the original port while the supervisor prepares its replacement.
if (process.connected) {
  process.once('disconnect', () => {
    const deadline = setTimeout(() => process.exit(1), 6000);
    deadline.unref();
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(0);
  });
}
