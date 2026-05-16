import { Command } from "commander";
import { v1, runV1 } from "../v1Client.js";

export function registerUser(program: Command): void {
  const user = program
    .command("user")
    .description("User: info");

  user
    .command("info")
    .description("current logged-in user details and limits")
    .action(async () => {
      await runV1(() => v1.get("/v1/user/info"));
    });
}
