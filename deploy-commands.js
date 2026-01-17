require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong"),

  new SlashCommandBuilder()
    .setName("setchess")
    .setDescription("Set your Chess.com username")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Your Chess.com username")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("mychess")
    .setDescription("Show your saved Chess.com username"),

  new SlashCommandBuilder()
    .setName("chesslist")
    .setDescription("List all registered Chess.com players"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Refresh or Show the Rapid Chess.com leaderboard"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    const appId = process.env.CLIENT_ID;
    if (!appId) {
      throw new Error("Missing CLIENT_ID in .env");
    }

    const guildId = process.env.GUILD_ID;

    // If you set GUILD_ID in .env, commands appear almost instantly in that server
    // If not, it falls back to global commands which can take a while to show up
    const route = guildId
      ? Routes.applicationGuildCommands(appId, guildId)
      : Routes.applicationCommands(appId);

    await rest.put(route, { body: commands });

    console.log(
      guildId
        ? "Slash commands registered to guild successfully."
        : "Slash commands registered globally successfully."
    );
  } catch (error) {
    console.error(error);
  }
})();