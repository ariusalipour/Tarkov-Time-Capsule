import {
	InteractionHandler,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";

export const pingHandler: InteractionHandler = async (
): Promise<InteractionResponse> => {

	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			content: `Tarkov Time Capsule Discord is Live!`,
		},
	};
};
