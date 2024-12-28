import {
	createSlashCommandHandler,
} from "@glenstack/cf-workers-discord-bot";

import {helloCommand} from "./command/helloCommand";
import {helloHandler} from "./handler/helloHandler";

// Securely load secrets from environment variables
let env = {
	APPLICATION_SECRET: "",
};

const slashCommandHandler = createSlashCommandHandler({
	applicationID: "1305653116443557958",
	applicationSecret: env.APPLICATION_SECRET, // Cloudflare Worker Secrets
	publicKey: "cb2c904a8b7da1ac15b97f7168f21091d76710fc87115ffabe4d143c2c9cc74a",
	commands: [
		[helloCommand, helloHandler]
	],
});

// Use ES Module format with `export default`
export default {
	async fetch(request: Request) {
		return slashCommandHandler(request);
	},
};
