require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const PLAYERS_FILE = path.join(__dirname, "players.json");
const STATE_FILE = path.join(__dirname, "leaderboard_state.json");
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID || "";

const CACHE_TTL_MS = 5 * 60 * 1000;
const USER_COOLDOWN_MS = 60 * 1000;
const GLOBAL_COOLDOWN_MS = 15 * 1000;

const rapidCache = new Map(); // username -> { rating, ts }
const userCooldown = new Map();
let globalCooldownTs = 0;

function loadPlayers() {
  try {
    return JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function savePlayers(players) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2), "utf8");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}

function escapeChessUsername(u) {
  return encodeURIComponent(normalizeUsername(u));
}

async function getRapidRating(username) {
  const norm = normalizeUsername(username);
  if (!norm) return null;

  const cached = rapidCache.get(norm);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.rating;

  try {
    const res = await fetch(
      `https://api.chess.com/pub/player/${escapeChessUsername(username)}/stats`,
      { headers: { "User-Agent": "RapidChessLeaderboardBot/1.0" } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const rating = typeof data?.chess_rapid?.last?.rating === "number"
      ? data.chess_rapid.last.rating
      : null;

    rapidCache.set(norm, { rating, ts: now });
    return rating;
  } catch {
    return null;
  }
}

function medal(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "▫️";
}

function formatDelta(delta) {
  if (typeof delta !== "number" || delta === 0) return "";
  return delta > 0 ? `⬆️ +${delta}` : `⬇️ ${delta}`;
}

function buildLeaderboardEmbed(rows) {
  const embed = new EmbedBuilder()
    .setTitle("Rapid Chess.com leaderboard")
    .setFooter({ text: "Data from Chess.com public API" });

  if (!rows.length) {
    embed.setDescription("No one is registered yet. Use `/setchess <username>`.");
    return embed;
  }

  const lines = rows.map((r, i) => {
    const ratingText = r.rating ?? "unrated";
    const deltaText = r.deltaText ? ` · ${r.deltaText}` : "";
    return `${medal(i)} **${r.discordTag}** -> ${r.chessUsername} (**${ratingText}**)${deltaText}`;
  });

  embed.setDescription(lines.join("\n").slice(0, 3800));
  return embed;
}

async function getOrCreateLeaderboardMessage(client, channelId) {
  const state = loadState();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  if (state.messageId && state.channelId === channelId) {
    const msg = await channel.messages.fetch(state.messageId).catch(() => null);
    if (msg) return msg;
  }

  const msg = await channel.send("Creating leaderboard...");
  saveState({ ...state, channelId, messageId: msg.id });
  return msg;
}

async function refreshLeaderboardMessage(client, channelId) {
  const msg = await getOrCreateLeaderboardMessage(client, channelId);
  if (!msg) return false;

  const players = loadPlayers();
  const state = loadState();
  const prev = state.lastRatings || {};

  const rowsBase = await Promise.all(
    Object.entries(players).map(async ([id, p]) => ({
      discordTag: p.discordTag,
      chessUsername: p.chessUsername,
      rating: await getRapidRating(p.chessUsername),
    }))
  );

  rowsBase.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));

  const rows = rowsBase.map((r) => {
    const norm = normalizeUsername(r.chessUsername);
    const prevRating = prev[norm];
    const delta =
      typeof r.rating === "number" && typeof prevRating === "number"
        ? r.rating - prevRating
        : null;

    return { ...r, deltaText: formatDelta(delta) };
  });

  await msg.edit({ content: "", embeds: [buildLeaderboardEmbed(rows)] });

  const nextRatings = {};
  for (const r of rows) {
    if (typeof r.rating === "number") {
      nextRatings[normalizeUsername(r.chessUsername)] = r.rating;
    }
  }

  saveState({ ...state, channelId, messageId: msg.id, lastRatings: nextRatings });
  return true;
}

function checkAndSetCooldown(userId) {
  const now = Date.now();
  if (now - globalCooldownTs < GLOBAL_COOLDOWN_MS) return false;

  const last = userCooldown.get(userId) || 0;
  if (now - last < USER_COOLDOWN_MS) return false;

  globalCooldownTs = now;
  userCooldown.set(userId, now);
  return true;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  if (LEADERBOARD_CHANNEL_ID) {
    refreshLeaderboardMessage(client, LEADERBOARD_CHANNEL_ID).catch(() => {});
  }
});

cron.schedule(
  "0 19 * * 1",
  () => refreshLeaderboardMessage(client, LEADERBOARD_CHANNEL_ID),
  { timezone: "America/Chicago" }
);

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const players = loadPlayers();

  if (interaction.commandName === "leaderboard") {
    if (!checkAndSetCooldown(interaction.user.id)) {
      await interaction.reply({ content: "Leaderboard is refreshing. Try again shortly.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await refreshLeaderboardMessage(client, LEADERBOARD_CHANNEL_ID || interaction.channelId);
    await interaction.deleteReply();
  }
});

client.login(process.env.DISCORD_TOKEN);