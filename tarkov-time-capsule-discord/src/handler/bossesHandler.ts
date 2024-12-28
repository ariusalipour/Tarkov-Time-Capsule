import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";
import { env } from "../environments";

interface SpawnRate {
	MapName: string;
	Chance: number;
	Date: string;
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

		// Define the date range (last week)
		const endDate = new Date().toISOString().split('T')[0];
		const startDate = new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0];

		// Fetch spawn rates for each boss
		const spawnRatesPromises = bosses.map(bossName =>
			fetch(`${env.REACT_APP_API_URL}api/spawnchance?bossName=${encodeURIComponent(bossName)}&startDate=${startDate}&endDate=${endDate}`)
				.then(response => response.json() as Promise<SpawnRate[]>)
				.then(spawnRates => ({ bossName, spawnRates }))
		);

		const bossesSpawnRates = await Promise.all(spawnRatesPromises);

		// Format the data into a readable table
		const tableHeader = `| Boss | Map | Spawn Rate |\n| --- | --- | --- |\n`;
		const tableRows = bossesSpawnRates.flatMap(({ bossName, spawnRates }) =>
			spawnRates.map(rate => `| ${bossName} | ${rate.MapName} | ${rate.Chance * 100}% |`)
		).join("\n");

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
