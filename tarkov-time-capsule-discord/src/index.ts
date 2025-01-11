import {
	createSlashCommandHandler,
} from "@glenstack/cf-workers-discord-bot";
import { pingCommand } from "./command/pingCommand";
import { bossHandler } from "./handler/bossHandler";
import { createBossCommand } from "./command/bossCommand";
import { helloHandler } from "./handler/helloHandler";
import { helloCommand } from "./command/helloCommand";
import { pingHandler } from "./handler/pingHandler";
import {bossesCommand} from "./command/bossesCommand";
import {bossesHandler} from "./handler/bossesHandler";

const setupBot = async () => {
	const bossCommand = await createBossCommand();

	return createSlashCommandHandler({
		applicationID: "1305653116443557958",
		applicationSecret: "zYuPj8UeYBqnAnn1FptYwEM_rGpvwdMQ",
		publicKey: "cb2c904a8b7da1ac15b97f7168f21091d76710fc87115ffabe4d143c2c9cc74a",
		commands: [
			[ pingCommand, pingHandler ],
			[ helloCommand, helloHandler ],
			[ bossCommand, bossHandler ],
			[ bossesCommand, bossesHandler ]
		],
	});
};

export default {
	async fetch(request: Request) {
		const slashCommandHandler = await setupBot();

		return slashCommandHandler(request);
	},
};
