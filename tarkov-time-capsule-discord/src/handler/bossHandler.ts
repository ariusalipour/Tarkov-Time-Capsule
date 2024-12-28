import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";
import { env } from "../environments";

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
		const spawnRates: { MapName: string; Chance: number; Date: string; Change?: number }[] = await response.json();

		if (spawnRates.length === 0) {
			return {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: {
					content: `It looks like **${bossName}** isn't spawning on any maps right now.`,
					allowed_mentions: {
						users: [userID],
					},
				},
			};
		}

		// Create a map to store the latest spawn rate for each map
		const latestSpawnRates = new Map<string, { MapName: string; Chance: number; Date: string; Change?: number }>();

		spawnRates.forEach((rate) => {
			const existingRate = latestSpawnRates.get(rate.MapName);
			if (!existingRate || new Date(rate.Date) > new Date(existingRate.Date)) {
				latestSpawnRates.set(rate.MapName, rate);
			}
		});

		// Convert the map back to an array
		const latestSpawnRatesArray = Array.from(latestSpawnRates.values());

		// Format the spawn rates into a readable message
		const spawnRateMessage = latestSpawnRatesArray
			.map((rate) => {
				const changeText = rate.Change !== undefined ? ` (Change: ${rate.Change * 100}%)` : '';
				return `${rate.MapName}: ${rate.Chance * 100}%${changeText}`;
			})
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
