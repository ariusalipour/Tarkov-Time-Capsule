import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";
import { env } from "../environments";

interface SpawnRate {
	BossName: string;
	MapName: string;
	Chance: number;
	Timestamp: string;
}

export const bossesHandler: InteractionHandler = async (
	interaction: Interaction
): Promise<InteractionResponse> => {
	const userID = interaction.member.user.id;

	try {
		// Define the date range
		const endDate = new Date().toISOString().split('T')[0];
		const startDate = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];

		// Fetch data from your API with date range
		const response = await fetch(`${env.REACT_APP_API_URL}api/spawnchance?startDate=${startDate}&endDate=${endDate}`);
		const spawnRates: SpawnRate[] = await response.json();

		// Group spawn rates by BossName
		const groupedByBoss = spawnRates.reduce((acc, rate) => {
			if (!acc[rate.BossName]) {
				acc[rate.BossName] = [];
			}
			acc[rate.BossName].push(rate);
			return acc;
		}, {} as Record<string, SpawnRate[]>);

		// Create a map to store the latest spawn rate for each map within each boss group
		const latestSpawnRates = new Map<string, Map<string, SpawnRate>>();

		Object.keys(groupedByBoss).forEach(bossName => {
			const bossRates = groupedByBoss[bossName];
			const bossMap = new Map<string, SpawnRate>();

			bossRates.forEach((rate) => {
				const existingRate = bossMap.get(rate.MapName);
				if (!existingRate || new Date(rate.Timestamp) > new Date(existingRate.Timestamp)) {
					bossMap.set(rate.MapName, rate);
				}
			});

			latestSpawnRates.set(bossName, bossMap);
		});

		// Format the data into a readable message
		const spawnRateMessage = Array.from(latestSpawnRates.entries()).map(([bossName, mapRates]) => {
			const mapRatesMessage = Array.from(mapRates.values()).map(rate => `- ${rate.MapName}: ${rate.Chance * 100}%`).join("\n");
			return `**${bossName}**\n${mapRatesMessage}`;
		}).join("\n\n");

		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Spawn rates for all bosses:\n${spawnRateMessage}`,
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
				content: `Something went wrong while fetching spawn rates, <@${userID}>. Please try again later.`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	}
};
