function appNameMatches(actual: string, requested: string): boolean {
  const name = actual.toLocaleLowerCase();
  const query = requested.toLocaleLowerCase();
  return name === query || name.endsWith(` ${query}`);
}

export { appNameMatches };
