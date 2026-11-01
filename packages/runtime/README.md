# Runtime configuration

Define an app's environment schema with Zod, using the `url()`, `secret()`, `csv()`, `bool()`, and `port()` helpers from `@betterbasket/runtime`. After the app loads its environment file, call `loadConfig(schema)`. It returns a frozen, typed object. Invalid or missing values stop startup with exit code 1 and print variable names only, never values.

Keep each app's `.env.development.example` and `.env.production.example` keys in sync with its schema. The gateway shows the pattern. Tests may call `loadConfig(schema, testEnv)` with an explicit source; production code uses `process.env`.
