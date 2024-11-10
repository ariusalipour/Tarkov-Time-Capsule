import { ApolloServer } from 'apollo-server';
import typeDefs from './schema'; // Import the GraphQL schema
import resolvers from './resolvers'; // Import the resolvers
import { D1Database } from '@cloudflare/workers-types';

// Define the data sources
const dataSources = () => ({
	d1: new D1Database(), // Assuming your D1Database instance is available here
});

// Create the Apollo server instance
const server = new ApolloServer({
	typeDefs,
	resolvers,
	dataSources,
	context: () => ({
		dataSources: {
			d1: new D1Database(),
		},
	}),
});

// Start the server
server.listen().then(({ url }) => {
	console.log(`Server ready at ${url}`);
});
