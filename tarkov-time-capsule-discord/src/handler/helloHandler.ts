import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";

export const helloHandler: InteractionHandler = async (
	interaction: Interaction
): Promise<InteractionResponse> => {
	const userID = interaction.member.user.id;

	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			content: `You are one razzle dazzle of a PMC, <@${userID}>!`,
			allowed_mentions: {
				users: [userID],
			},
		},
	};
};
