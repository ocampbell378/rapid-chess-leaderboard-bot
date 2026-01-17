# Rapid Chess Leaderboard Bot

A Discord bot that tracks registered users Chess.com rapid ratings and posts a sortable leaderboard. Data comes from the Chess.com public API.

## Features

**Slash commands**

- `/setchess username`  
  Save your Chess.com username

- `/mychess`  
  Show your saved Chess.com username

- `/leaderboard`  
  Refresh and show the rapid leaderboard

**Rating deltas**

- Elo change since last refresh  
- Rank movement since last refresh  
- Weekly change vs a baseline that resets weekly  

## Requirements

- Node.js 18 or newer recommended  
- Node.js 20 or newer also works  
- A Discord application and bot token  
- Bot invited to the server with the `applications.commands` scope  

## Setup

### Install dependencies

Clone the repository and run:

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root.

**Required**

- `DISCORD_TOKEN` Discord bot token  
- `CLIENT_ID` Discord application client id  
- `LEADERBOARD_CHANNEL_ID` Channel id where the leaderboard message is maintained  

**Optional**

- `GUILD_ID`  
  If set, slash commands are registered to that guild only for faster testing.  
  If not set, commands are registered globally.

**Example**

```env
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
LEADERBOARD_CHANNEL_ID=your_channel_id_here
GUILD_ID=optional_guild_id_here
```

### Register slash commands

Run once after initial setup and again any time command definitions change:

```bash
node deploy-commands.js
```

Notes:
- If `GUILD_ID` is set, commands update immediately in that server  
- If not set, commands are registered globally and may take time to appear  

### Start the bot

```bash
node index.js
```

## Usage

- Use `/setchess username` to register your Chess.com username  
- Use `/leaderboard` to refresh the leaderboard  
- The bot edits the same leaderboard message after the first creation  

## Data files

The following files are created in the project directory:

- `players.json`  
  Stores Discord users and their Chess.com usernames  

- `leaderboard_state.json`  
  Stores the leaderboard message id and rating baselines  

These files must persist in production or registrations and historical deltas will be lost.

## Weekly baseline schedule

The weekly baseline resets automatically via cron.

- Every Monday at 7:00 PM America Chicago time  

## Rate limiting

- Per user cooldown: 60 seconds  
- Global cooldown: 15 seconds  
- Chess.com API ratings cached for 5 minutes per username  

## Permissions

The bot needs permission to:
- Read messages in the leaderboard channel  
- Send messages and edit its own messages in that channel  

## Troubleshooting

**Slash commands do not appear**

- Run `node deploy-commands.js`  
- Confirm the bot was invited with the `applications.commands` scope  
- If using global registration, wait and try again  

**Leaderboard does not post or refresh**

- Confirm `LEADERBOARD_CHANNEL_ID` is correct  
- Confirm the bot has permission to send messages in that channel  

## Deployment notes

Use a process manager so the bot restarts automatically if it crashes.

pm2 is recommended for production deployments.
