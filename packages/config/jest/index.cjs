/** Shared Jest configuration for Nest services. */
module.exports = function createJestConfig(rootDir, transformer = "ts-jest") {
  const transform =
    transformer === "swc"
      ? [
          "@swc/jest",
          {
            jsc: {
              parser: { syntax: "typescript", decorators: true },
              target: "es2022",
              transform: { legacyDecorator: true, decoratorMetadata: true },
            },
            module: { type: "commonjs" },
          },
        ]
      : "ts-jest";
  return {
    rootDir,
    testEnvironment: "node",
    testMatch: ["<rootDir>/src/**/*.spec.ts"],
    moduleFileExtensions: ["js", "json", "ts"],
    transform: { "^.+\\.(t|j)sx?$": transform },
    transformIgnorePatterns: [],
    collectCoverageFrom: ["<rootDir>/src/**/*.(t|j)s"],
    coverageDirectory: "<rootDir>/coverage",
  };
};
