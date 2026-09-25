# Engineering rules

- Keep the harness provider-neutral. Models implement `DecisionModel` or `TextModel`;
  drivers implement `Computer`. Do not branch the task loop on provider names.
- Validate external data once with Zod at configuration, HTTP, model, and CUA
  boundaries. Infer types from those schemas. Trust typed values inside the repo.
- Do not spread `unknown`, `any`, broad records, casts, or manual shape guards
  through application code. Keep SDK-owned protocol types at the transport boundary.
- Keep modules in the `src/agent`, `src/app`, `src/computer`, and `src/models`
  directories. Separate UI assets from server logic. Maximum source-file length: 600 lines.
- Use Bun for the TypeScript runtime and scripts. Use uv for the optional Python
  serving integration. No custom model training belongs in this repository.
- Run `bun run check` and `bun run test` after changes. Use `bun run format` for formatting.
  Keep strict typing and safety lint rules enabled; document compatibility exceptions.
- Generated traces, screenshots, recordings, model assets, and research clones
  belong under ignored `runs/`. Never commit credentials or local `.env` files.
- Demo videos must use real app recordings with clear task text and timing.
  Keep them local for review. Do not upload to YouTube. Do not add GitHub Actions.
