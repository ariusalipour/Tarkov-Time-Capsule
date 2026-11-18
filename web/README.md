# Web app

React archive interface with dark styling, boss/map filters, date ranges, charts and tabular observations. Built with Vite; tested with Vitest and Testing Library.

Use Node 24.15 or newer. Run `npm ci`, then `npm start` (listens on localhost). Set `VITE_API_URL` to the API origin for local development, for example `http://localhost:3000`. Container builds use same-origin `/api/` requests. Variables prefixed `VITE_` are public build-time configuration, never secrets.

Run `npm test` and `npm run build` to validate. Production files are written to `dist/`. `npm run preview` serves that build locally for review.
