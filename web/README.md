# Web app

React archive interface with dark styling, boss/map filters, date ranges, charts and tabular observations.

Use Node 24. Run `npm ci`, then `npm start`. Set `REACT_APP_API_URL` to the API origin for local development. Container builds use same-origin `/api/` requests.

Run `CI=true npm test -- --watchAll=false --runInBand` and `npm run build` to validate.
