import { ApplicationCommand, ApplicationCommandOptionType } from "@glenstack/cf-workers-discord-bot";
import { env } from "../environments";

// Fetch boss names from the API and return an array of strings
const fetchBossNames = async (): Promise<string[]> => {
	try {
		const response = await fetch(`${env.REACT_APP_API_URL}api/bosses`);
		return await response.json(); // Assumes API returns an array of boss names
	} catch (error) {
		console.error("Error fetching boss names:", error);
		return [];
	}
};

// Function to create the boss command dynamically
export const createBossCommand = async (): Promise<ApplicationCommand> => {
	const bossNames = await fetchBossNames();

	return {
		name: "boss",
		description: "Get the spawn rates of a boss on all maps",
		options: [
			{
				name: "bossname",
				description: "Select the boss",
				type: ApplicationCommandOptionType.STRING,
				required: true,
				choices: bossNames.map((name) => ({ name, value: name })), // Convert boss names into Discord choices
			},
		],
	};
};
