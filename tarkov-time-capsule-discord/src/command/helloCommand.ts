import { ApplicationCommand } from "@glenstack/cf-workers-discord-bot";

export const helloCommand: ApplicationCommand = {
	name: "hello",
	description: "Bot will say hello to you!",
};
