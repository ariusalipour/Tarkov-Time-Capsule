import { request, gql } from 'graphql-request';
import { Map } from './types';

const graphqlQuery = gql`
	{
		maps {
			name,
			bosses {
				spawnChance
				name
			}
		}
	}
`;

export async function fetchGraphQLData(): Promise<{ maps: Map[] }> {
	return await request('https://api.tarkov.dev/graphql', graphqlQuery);
}
