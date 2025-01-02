# Tarkov Time Capsule Discord Bot

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Project Structure](#project-structure)
- [Setup and Installation](#setup-and-installation)
- [Bot Commands](#bot-commands)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Tarkov Time Capsule Discord Bot is an interactive companion designed to enhance the Tarkov Time Capsule community experience. This bot integrates seamlessly with Discord's API to provide users with real-time information, data queries, and community-driven features.

## Features

- **Interactive Commands**: Provides various commands for querying game data and interacting with the community.
- **Real-Time Updates**: Fetches data from the API and delivers timely information directly to Discord.
- **Modular Architecture**: Built with scalability and easy extensibility in mind.
- **Comprehensive Test Suite**: Ensures reliable and bug-free operations with Vitest.

## Project Structure

- **Source Code**: Contains bot commands, utilities, and core functionality.
  - `src/commands/`: Houses individual bot commands.
  - `src/utils/`: Utility functions and helpers for bot operations.
- **Tests**: Comprehensive tests for the bot's functionality using Vitest.
- **Configuration**:
  - `wrangler.toml`: Cloudflare Worker and environment configuration.

## Setup and Installation

### Clone the Repository:

```bash
git clone https://github.com/yourusername/Tarkov-Time-Capsule-Discord.git
cd Tarkov-Time-Capsule-Discord
```

### Install Dependencies:

```bash
npm install
```

### Configure Environment Variables:

- Add your Discord bot token and other necessary variables in a `.env` file.

### Running the Bot:

- **Start the development server**:
  ```bash
  npm run dev
  ```

- **Build for production**:
  ```bash
  npm run build
  ```

- **Deploy to Cloudflare**:
  ```bash
  wrangler publish
  ```

## Bot Commands

### Example Commands

- **`!spawnchance [boss]`**
  - Fetch spawn chance data for a specific boss.
  - **Usage**: `!spawnchance Reshala`

- **`!mapinfo [map]`**
  - Retrieve detailed information about a specific map.
  - **Usage**: `!mapinfo Customs`

- **`!help`**
  - Displays a list of available commands.
  - **Usage**: `!help`

## Usage Examples

### Query Spawn Chances for a Boss

```bash
!spawnchance Reshala
```

### Get Map Information

```bash
!mapinfo Customs
```

## Configuration

- **Environment Variables**: Add your Discord bot token and API keys in a `.env` file.
- **Wrangler Configuration**: Update `wrangler.toml` with your Cloudflare account details.

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
