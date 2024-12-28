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
		// Fetch the list of all bosses
		const bossesResponse = await fetch(`${env.REACT_APP_API_URL}api/bosses`);
		const bosses: string[] = await bossesResponse.json();

		if (bosses.length === 0) {
			return {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: {
					content: `No bosses found.`,
					allowed_mentions: {
						users: [userID],
					},
				},
			};
		}

		// Define the date range (last day)
		const endDate = new Date().toISOString().split('T')[0];
		const startDate = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];

		// Fetch spawn rates for all bosses within the date range
		const response = await fetch(`${env.REACT_APP_API_URL}api/spawnchance?startDate=${startDate}&endDate=${endDate}`);
		const spawnRates: SpawnRate[] = await response.json();

		if (spawnRates.length === 0) {
			return {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: {
					content: `No spawn rates found for the specified date range.`,
					allowed_mentions: {
						users: [userID],
					},
				},
			};
		}

		// Format the data into a readable table
		const tableHeader = `| Boss | Map | Spawn Rate |\n| --- | --- | --- |\n`;
		const tableRows = spawnRates.map(rate => `| ${rate.BossName} | ${rate.MapName} | ${rate.Chance * 100}% |`).join("\n");

		const table = tableHeader + tableRows;

		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Spawn rates for all bosses:\n${table}`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	} catch (error) {
		console.error("Error fetching bosses or spawn rates:", error);
		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				content: `Something went wrong while fetching bosses or spawn rates, <@${userID}>. Please try again later.`,
				allowed_mentions: {
					users: [userID],
				},
			},
		};
	}
};
