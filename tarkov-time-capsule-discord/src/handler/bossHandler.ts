﻿import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";

export const bossHandler: InteractionHandler = async (
	interaction: Interaction
): Promise<InteractionResponse> => {
	const bossName = interaction.data?.options?.[0]?.value; // Get the boss name from the command options
	const userID = interaction.member.user.id;

	if (!bossName) {
		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Please provide a boss name, <@${userID}>!`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	}

	try {
		// Fetch data from your API
		const response = await fetch(`${env.REACT_APP_API_URL}api/spawnchance?bossName=${encodeURIComponent(bossName)}`);
		const spawnRates: { MapName: string; Chance: number }[] = await response.json();

		// Format the spawn rates into a readable message
		const spawnRateMessage = spawnRates
			.map((rate: { MapName: string; Chance: number }) => `${rate.MapName}: ${rate.Chance * 100}%`)
			.join("\n");

		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Spawn rates for **${bossName}**:\n${spawnRateMessage}`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	} catch (error) {
		console.error("Error fetching spawn rates:", error);
		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Something went wrong while fetching spawn rates for **${bossName}**, <@${userID}>. Please try again later.`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	}
};
