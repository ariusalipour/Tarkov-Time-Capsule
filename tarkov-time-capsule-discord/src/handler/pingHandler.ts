import {
	InteractionHandler,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";

export const pingHandler: InteractionHandler = async (
): Promise<InteractionResponse> => {

	const currentDateTime = new Date().toLocaleString();

	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			content: `${currentDateTime} || Tarkov Time Capsule Discord is Live!`,
		},
	};
};
