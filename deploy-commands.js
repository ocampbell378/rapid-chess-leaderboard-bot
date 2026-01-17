require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  /*
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong"),
  */

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
    .setName("leaderboard")
    .setDescription("Refresh or show the Rapid Chess.com leaderboard"),
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