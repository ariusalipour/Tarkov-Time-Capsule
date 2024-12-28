import {
	createSlashCommandHandler,
} from "@glenstack/cf-workers-discord-bot";
import { bossHandler } from "./handler/bossHandler";
import { createBossCommand } from "./command/bossCommand";
import {helloHandler} from "./handler/helloHandler";
import {helloCommand} from "./command/helloCommand";
import { env } from "./environments";

const setupBot = async () => {
	const bossCommand = await createBossCommand();

	return createSlashCommandHandler({
		applicationID: "1305653116443557958",
		applicationSecret: env.APPLICATION_SECRET,
		publicKey: "cb2c904a8b7da1ac15b97f7168f21091d76710fc87115ffabe4d143c2c9cc74a",
		commands: [
			[helloCommand, helloHandler],
			[bossCommand, bossHandler]
		],
	});
};

export default {
	async fetch(request: Request) {
		const slashCommandHandler = await setupBot();
		return slashCommandHandler(request);
	},
};
