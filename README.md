# Tarkov Time Capsule Solution

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Sub-Projects](#sub-projects)
- [Setup and Installation](#setup-and-installation)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Tarkov Time Capsule is a comprehensive solution designed to collect, store, and analyze data from the Tarkov game. It consists of multiple sub-projects that work together to provide historical data analysis, real-time Discord interactions, and a seamless web interface for users.

This solution leverages modern technologies like Cloudflare Workers, D1 databases, React, and Discord API integrations to deliver an end-to-end experience for users and developers alike.

## Features

- Historical data collection and analysis.
- Real-time data querying via a Discord bot.
- Interactive and responsive web interface.
- Modular architecture for easy development and maintenance.

## Sub-Projects

The Tarkov Time Capsule consists of the following sub-projects:

1. **[Tarkov Time Capsule API](#)**
   - Provides backend services for data collection and querying.
   - For detailed setup and usage, see the [API README](./tarkov-time-capsule-api/README.md).

2. **[Tarkov Time Capsule Discord Bot](#)**
   - An interactive Discord bot for real-time data querying.
   - For detailed setup and usage, see the [Discord Bot README](./tarkov-time-capsule-discord/README.md).

3. **[Tarkov Time Capsule Web](#)**
   - A web application for data visualization and interaction.
   - For detailed setup and usage, see the [Web README](./tarkov-time-capsule-web/README.md).

## Setup and Installation

Each sub-project has its own setup instructions detailed in its respective README file. To get started with the solution:

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/Tarkov-Time-Capsule.git
   cd Tarkov-Time-Capsule
   ```

2. Navigate to the desired sub-project folder and follow the setup instructions in its README.

### Example:

To set up the API:
```bash
cd tarkov-time-capsule-api
npm install
npm run dev
```

To set up the Discord Bot:
```bash
cd tarkov-time-capsule-discord
npm install
npm run dev
```

To set up the Web application:
```bash
cd tarkov-time-capsule-web
npm install
npm start
```

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
