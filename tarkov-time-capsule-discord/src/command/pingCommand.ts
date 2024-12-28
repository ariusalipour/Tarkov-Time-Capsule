import { ApplicationCommand } from "@glenstack/cf-workers-discord-bot";

export const pingCommand: ApplicationCommand = {
	name: "ping",
	description: "Server Status Ping Check!",
};
