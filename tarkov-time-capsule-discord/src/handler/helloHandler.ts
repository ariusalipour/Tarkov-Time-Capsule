import {
	InteractionHandler,
	Interaction,
	InteractionResponse,
	InteractionResponseType,
} from "@glenstack/cf-workers-discord-bot";

type UserID = string;

const greetings: ((userID: UserID) => string)[] = [
	(userID: UserID) => `Hey, PMC <@${userID}>! Ready to raid?`,
	(userID: UserID) => `Greetings, operator <@${userID}>! Scav run or PMC today?`,
	(userID: UserID) => `What's up, chad <@${userID}>? Looking for loot?`,
	(userID: UserID) => `Howdy, rat <@${userID}>! Found any stashes lately?`,
	(userID: UserID) => `Yo, <@${userID}>! Watch out for the bush wookie sniping Customs!`,
	(userID: UserID) => `Hello, <@${userID}>! Hope you're not stuck in Interchange!`,
	(userID: UserID) => `Hi there, <@${userID}>! Let's avoid that Factory spawn camper, eh?`,
	(userID: UserID) => `What's the status, <@${userID}>? Checked the flea market today?`,
	(userID: UserID) => `Welcome back, <@${userID}>! Hope your stash isn't full of junk.`,
	(userID: UserID) => `Hey, <@${userID}>! Need to extract with some juicy loot?`,
	(userID: UserID) => `Yo, <@${userID}>! You got the marked room key yet?`,
	(userID: UserID) => `Hi, <@${userID}>! Remember, Tarkov giveth and Tarkov taketh.`,
	(userID: UserID) => `Hey, <@${userID}>! Don't forget to check your hydration!`,
	(userID: UserID) => `Hello, <@${userID}>! Survive and extract, my friend.`,
	(userID: UserID) => `Greetings, <@${userID}>! Secure container loaded and ready?`,
	(userID: UserID) => `Yo, <@${userID}>! Watch out for Killa on Interchange!`,
	(userID: UserID) => `Hey, <@${userID}>! You extract or get Tarkov'd?`,
	(userID: UserID) => `Hi, <@${userID}>! Got a golden TT yet?`,
	(userID: UserID) => `What’s up, <@${userID}>? Found that last quest item yet?`,
	(userID: UserID) => `Hello there, <@${userID}>! Any good loot today?`,
	(userID: UserID) => `Howdy, <@${userID}>! Customs or Reserve next?`,
	(userID: UserID) => `Hey, <@${userID}>! Did you remember your Salewa?`,
	(userID: UserID) => `Greetings, <@${userID}>! Watch out for Reshala's guards!`,
	(userID: UserID) => `Yo, <@${userID}>! Labs keycard ready?`,
	(userID: UserID) => `Hey, <@${userID}>! Don't forget your armor repair kit.`,
	(userID: UserID) => `Hi, <@${userID}>! The flea market gods been kind to you?`,
	(userID: UserID) => `Hello, <@${userID}>! Let's hope Glukhar doesn't ruin our day.`,
	(userID: UserID) => `What's up, <@${userID}>? Got any room in your Gamma?`,
	(userID: UserID) => `Yo, <@${userID}>! You Tarkov'd anyone lately?`,
	(userID: UserID) => `Hi, <@${userID}>! Found any graphics cards for that Bitcoin farm?`,
	(userID: UserID) => `Hey, <@${userID}>! Don’t get head-eyes’d out there.`,
	(userID: UserID) => `What’s up, <@${userID}>? Extract camping today or nah?`,
	(userID: UserID) => `Howdy, <@${userID}>! Let's stack those rubles!`,
	(userID: UserID) => `Hey, <@${userID}>! Got enough painkillers?`,
	(userID: UserID) => `Yo, <@${userID}>! Ready to face the Sherpa squads?`,
	(userID: UserID) => `Hi, <@${userID}>! Hope you insured your kit.`,
	(userID: UserID) => `Hello, <@${userID}>! Got that FireKlean for Mechanic yet?`,
	(userID: UserID) => `Hey, <@${userID}>! Don’t let the Rogues catch you slipping.`,
	(userID: UserID) => `Hi, <@${userID}>! Time to hit up Shoreline for quests!`,
	(userID: UserID) => `Hello, <@${userID}>! What's your best barter today?`,
	(userID: UserID) => `Howdy, <@${userID}>! Gotten any good backpack Tetris done?`,
	(userID: UserID) => `Hey, <@${userID}>! Bet you forgot your factory key, huh?`,
	(userID: UserID) => `What’s up, <@${userID}>? Ready to hunt Raiders on Reserve?`
];



export const helloHandler: InteractionHandler = async (
	interaction: Interaction
): Promise<InteractionResponse> => {
	const userID = interaction.member.user.id;
	const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			content: `${randomGreeting}`,
			allowed_mentions: {
				users: [userID],
			},
		},
	};
};
