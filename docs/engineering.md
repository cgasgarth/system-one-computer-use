# Type and lint policy

External data is parsed at the boundary with Zod. CUA methods return concrete
tool-result types. Model requests and responses have explicit schemas. Internal
functions accept those types and do not repeat shape checks.

Action grounding is a separate runtime check: even a well-typed action must refer
to the current window and snapshot. Completion checks assess task state; they do
not replace boundary validation.

TypeScript extends `@tsconfig/strictest`, checks library declarations, and enables
erasable syntax, unchecked side-effect-import checks, and consistent filename
casing. The runtime is Bun. Oxlint performs both type-aware linting and type checking.

All Oxlint categories, including nursery, have error severity. The 600-line file
limit includes blank lines and comments. Warnings and unused disable directives
fail checks. Complexity and function-size limits keep responsibilities small.

The configuration makes explicit compatibility choices:

- Modern Bun code uses async/await, optional chaining, and object spread. The
  legacy syntax-ban rules are disabled.
- Modules use named exports and relative parent imports. Node standard-library
  APIs are allowed because Bun and the MCP SDK support them.
- Type-aware `require-await` replaces its syntax-only duplicate. Async test
  doubles can implement async interfaces without real I/O.
- Simple ternaries are allowed; nested expressions remain subject to other rules.
  Object-key order can carry protocol meaning and is not automatically sorted.
- Exhaustive TypeScript switches replace the generic default-case requirement.
  `undefined` is the standard optional-value representation.
- SDK-owned `Request` and Zod schema objects retain their library types. Named
  compatibility allowances do not weaken checks on application data.
- Top-level await and console output are allowed in app entry points. The agent
  loop and browser-startup polling intentionally await dependent operations in order.
- Explicit `void` is allowed for DOM event handlers whose async body handles errors.
  The event handler itself remains synchronous.

No blanket unsafe-type suppressions are used. The test suite checks provider
interchangeability, response validation, live action grounding, typing conditions,
and observed task completion.

The native shell uses Swift 6 and AppKit. Its JSON messages have Codable
contracts; model settings cross a Zod boundary in the Bun process before saving.
The installer bundles the worker and Playwright runtime. The app reads its own
Application Support configuration and does not need access to the source checkout.
