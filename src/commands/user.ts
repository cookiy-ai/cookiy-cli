import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";

export function registerUser(program: Command): void {
  const user = program.command("user").description("User: info");

  user
    .command("info")
    .description("current user API metadata")
    .action(async () => {
      await runV1(() => v1.get("/v1/user/info"));
    });
}
