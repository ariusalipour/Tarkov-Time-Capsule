# Tarkov-Time-Capsule

An API service that schedules data collection from Tarkov APIs, stores historical data, and provides an accessible consumer API for querying and analyzing this data over time. This project is ideal for anyone looking to track trends, spawn chances, and other historical insights within the Tarkov game.

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

Tarkov-Time-Capsule is designed to provide historical data analysis for Tarkov game statistics. The API schedules periodic data collection from official Tarkov APIs, stores the information in a D1 database, and exposes a consumer API that allows users to query this stored data.

This project leverages Cloudflare Workers for efficient scheduling and API handling, making it scalable and easy to maintain.

## Features

- **Automated Data Collection**: Scheduled cron job to periodically fetch data from Tarkov APIs and store it in a D1 database.
- **Historical Data Access**: Store and manage historical data for analysis.
- **Flexible Query API**: Consumer API that allows querying by parameters like map, boss, spawn chance, and date ranges.
- **Grouped Responses**: Allows grouping results by map, boss, or timestamp for tailored data insights.

## Project Structure

- **Cloudflare Worker**: Handles scheduled tasks and API requests.
- **D1 Database**: Stores historical data with tables for maps, bosses, spawn chances, and timestamps.
- **Endpoints**: Exposes a consumer API for querying stored data.

### Key Files and Directories

- `index.ts`: Main entry point for handling API requests and scheduled tasks.
- `README.md`: Documentation for the project.
- `wrangler.toml`: Cloudflare Worker configuration, including environment bindings and cron schedule.

**Database Schema**:

- Maps, Bosses, SpawnChances, Timestamps tables.

## Setup and Installation

### Clone the Repository:

```bash
git clone https://github.com/yourusername/Tarkov-Time-Capsule.git
cd Tarkov-Time-Capsule
```

### Install Dependencies (requires wrangler for Cloudflare Workers):

```bash
npm install
```

### Set Up Cloudflare Environment:

- Configure `wrangler.toml` with your Cloudflare account details.
- Add D1 database binding and Cloudflare Worker KV bindings as required.

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
  - Provides access to historical spawn chance data, with flexible querying options.
  - **Method**: `GET`
  - **Parameters**:
    - `mapName`: Filter by map name.
    - `bossName`: Filter by boss name.
    - `startDate`: Filter results from this start date (`YYYY-MM-DD` format).
    - `endDate`: Filter results up to this end date (`YYYY-MM-DD` format).
    - `groupBy`: Group results by boss, map, or timestamp.

## Usage Examples

### 1. Query Spawn Chances by Map Name

```http
GET /api/spawnchance?mapName=Customs
```

### 2. Query Spawn Chances by Boss Name within a Date Range

```http
GET /api/spawnchance?bossName=Reshala&startDate=2024-10-01&endDate=2024-10-07
```

### 3. Group Results by Timestamp

```http
GET /api/spawnchance?groupBy=timestamp
```

Each request returns data that reflects spawn chances and can be organized as specified by the parameters.

## Configuration

- **Cron Schedule**: Configured in `wrangler.toml`, specifies how frequently data is collected from Tarkov APIs.
- **Environment Bindings**:
  - `DB`: Cloudflare D1 database for storing historical data.
  - Additional environment variables and secrets can be added as required.

## Contributing

Contributions are welcome! Please open an issue to discuss your ideas, or submit a pull request.

### How to Contribute

1. **Fork the Repository**: Fork this repository on GitHub.
2. **Create a Branch**: Create a feature branch for your changes.
3. **Test Your Changes**: Ensure your code is working as expected.
4. **Submit a Pull Request**: Open a pull request to merge your changes.

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
