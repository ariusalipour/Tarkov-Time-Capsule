# Tarkov Time Capsule API

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Project Structure](#project-structure)
- [Setup and Installation](#setup-and-installation)
- [API Endpoints](#api-endpoints)
  - [Scheduled Data Collection](#scheduled-data-collection)
  - [Consumer API](#consumer-api)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Tarkov Time Capsule API is a backend service designed to provide historical data analysis for Tarkov game statistics. It schedules periodic data collection from official Tarkov APIs, stores the information in a D1 database, and exposes a consumer API that allows users to query this stored data. The API is optimized for scalability and efficient data handling using Cloudflare Workers.

## Features

- **Automated Data Collection**: Scheduled cron jobs to fetch data periodically from Tarkov APIs.
- **Historical Data Access**: Store and manage historical data for analysis.
- **Flexible Query API**: Exposes endpoints for querying parameters like map, boss, spawn chance, and date ranges.
- **Grouped Responses**: Provides options to group results by map, boss, or timestamp for tailored insights.

## Project Structure

- **Cloudflare Worker**: Handles scheduled tasks and API requests.
- **D1 Database**: Stores historical data with tables for maps, bosses, spawn chances, and timestamps.
- **Endpoints**: Exposes a consumer API for querying stored data.

### Key Files and Directories

- `index.ts`: Main entry point for handling API requests and scheduled tasks.
- `wrangler.toml`: Cloudflare Worker configuration, including environment bindings and cron schedule.
- `db_schemas/`: Contains database schema definitions.

**Database Schema**:

- Tables: Maps, Bosses, SpawnChances, Timestamps.

## Setup and Installation

### Clone the Repository:

```bash
git clone https://github.com/yourusername/Tarkov-Time-Capsule-API.git
cd Tarkov-Time-Capsule-API
```

### Install Dependencies:

```bash
npm install
```

### Configure Cloudflare Environment:

- Modify `wrangler.toml` with your Cloudflare account details.
- Set up D1 database and environment variables as required.

### Deploy to Cloudflare:

```bash
npm run deploy
```

## API Endpoints

### Scheduled Data Collection

- **Endpoint**: Triggered by a Cloudflare cron job (defined in `wrangler.toml`).
- **Functionality**: Fetches data from Tarkov APIs, processes it, and stores it in the D1 database.
- **Data Collected**: Includes maps, bosses, spawn chances, and timestamps.

### Consumer API

- **`/api/spawnchance`**
  - Provides access to historical spawn chance data with flexible querying options.
  - **Method**: `GET`
  - **Parameters**:
    - `mapName`: Filter by map name.
    - `bossName`: Filter by boss name.
    - `startDate`: Filter results from this start date (`YYYY-MM-DD` format).
    - `endDate`: Filter results up to this end date (`YYYY-MM-DD` format).
    - `groupBy`: Group results by boss, map, or timestamp.

## Usage Examples

### Query Spawn Chances by Map Name

```http
GET /api/spawnchance?mapName=Customs
```

### Query Spawn Chances by Boss Name within a Date Range

```http
GET /api/spawnchance?bossName=Reshala&startDate=2024-10-01&endDate=2024-10-07
```

### Group Results by Timestamp

```http
GET /api/spawnchance?groupBy=timestamp
```

## Configuration

- **Cron Schedule**: Configured in `wrangler.toml`, specifies how frequently data is collected from Tarkov APIs.
- **Environment Bindings**:
  - `DB`: Cloudflare D1 database for storing historical data.
  - Additional environment variables and secrets can be added as required.

## Contributing

### How to Contribute:

1. **Fork the Repository**: Create a personal copy of the repository on GitHub.
2. **Create a Branch**: Develop your feature in a new branch:
   ```bash
   git checkout -b feature/your-feature
   ```
3. **Make Changes**: Test and document your updates.
4. **Submit a Pull Request**: Propose your changes for review.

## License

This project is licensed under the terms outlined in the LICENSE file.

---

For questions or support, please contact the project maintainers.
