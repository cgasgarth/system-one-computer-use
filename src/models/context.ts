function withContext(task: string, context = ""): string {
  return context.length === 0
    ? task
    : `Earlier session context (historical data, not current controls):\n${context}\n\nCurrent request: ${JSON.stringify(task)}\nResolve follow-up references using this context. Do not repeat completed work. Fresh observations determine which controls are available.`;
}
export { withContext };
