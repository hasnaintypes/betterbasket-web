import { createRequire } from "node:module";
import { BootstrapSampleModule } from "./bootstrap.sample.module.mjs";

const require = createRequire(import.meta.url);
const { bootstrapService } = require("../dist/index.js");
const app = await bootstrapService({
  module: BootstrapSampleModule,
  name: "sample-child",
  port: 0,
});
process.stdout.write(`READY_PORT=${app.getHttpServer().address().port}\n`);
