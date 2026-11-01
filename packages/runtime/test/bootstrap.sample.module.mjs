import "reflect-metadata";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Controller, Get, Module, Post, Req } = require("@nestjs/common");

class ProbeController {
  slow() {
    process.stdout.write("IN_FLIGHT\n");
    return new Promise((resolve) => setTimeout(() => resolve({ status: "done" }), 250));
  }
  raw(req) {
    return { rawBody: req.rawBody?.toString("utf8") ?? null };
  }
}

Controller("probe")(ProbeController);
Get("slow")(
  ProbeController.prototype,
  "slow",
  Object.getOwnPropertyDescriptor(ProbeController.prototype, "slow"),
);
Post("raw")(
  ProbeController.prototype,
  "raw",
  Object.getOwnPropertyDescriptor(ProbeController.prototype, "raw"),
);
Req()(ProbeController.prototype, "raw", 0);

class BootstrapSampleModule {}
Module({ controllers: [ProbeController] })(BootstrapSampleModule);

export { BootstrapSampleModule };
