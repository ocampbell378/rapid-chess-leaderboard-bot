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
    const rating =
      typeof data?.chess_rapid?.last?.rating === "number"
        ? data.chess_rapid.last.rating
        : null;

    rapidCache.set(norm, { rating, ts: now });
    return rating;
  } catch {
    return null;
  }
}

function rankPrefix(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

function formatEloDelta(delta) {
  if (typeof delta !== "number" || delta === 0) return "";
  return delta > 0 ? `⬆️ +${delta}` : `⬇️ ${delta}`;
}

function formatRankMove(move) {
  if (typeof move !== "number" || move === 0) return "";
  return move > 0 ? `⬆️${move}` : `⬇️${Math.abs(move)}`;
}

function formatWeeklyDelta(delta) {
  if (typeof delta !== "number" || delta === 0) return "";
  return delta > 0 ? `wk +${delta}` : `wk ${delta}`;
}

function buildLeaderboardEmbed(rows) {
  const embed = new EmbedBuilder().setFooter({
    text: "Data from Chess.com public API",
  });

  if (!rows.length) {
    embed.setDescription("No one is registered yet. Use `/setchess <username>`.");
    return embed;
  }

  const lines = rows.map((r, i) => {
    const ratingText = r.rating ?? "unrated";

    const parts = [];
    if (r.rankMoveText) parts.push(r.rankMoveText);
    if (r.eloDeltaText) parts.push(r.eloDeltaText);
    if (r.weeklyDeltaText) parts.push(r.weeklyDeltaText);

    const suffix = parts.length ? ` · ${parts.join(" · ")}` : "";
    return `${rankPrefix(i)} **${r.discordTag}** -> ${r.chessUsername} (**${ratingText}**)${suffix}`;
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

async function refreshLeaderboardMessage(client, channelId, opts = {}) {
  const msg = await getOrCreateLeaderboardMessage(client, channelId);
  if (!msg) return false;

  const players = loadPlayers();
  const state = loadState();

  const prevRatings = state.lastRatings || {};
  const weeklyBaseline = state.weeklyBaselineRatings || {};
  const prevRanks = state.lastRanks || {}; 

  const rowsBase = await Promise.all(
    Object.entries(players).map(async ([id, p]) => ({
      discordTag: p.discordTag,
      chessUsername: p.chessUsername,
      rating: await getRapidRating(p.chessUsername),
    }))
  );

  rowsBase.sort((a, b) => {
    const ar = a.rating;
    const br = b.rating;

    if (ar === null && br === null) return a.discordTag.localeCompare(b.discordTag);
    if (ar === null) return 1;
    if (br === null) return -1;
    if (br !== ar) return br - ar;
    return a.discordTag.localeCompare(b.discordTag);
  });

  const currentRanks = {};
  for (let i = 0; i < rowsBase.length; i++) {
    const norm = normalizeUsername(rowsBase[i].chessUsername);
    if (norm) currentRanks[norm] = i + 1;
  }

  const rows = rowsBase.map((r) => {
    const norm = normalizeUsername(r.chessUsername);

    const prevRating = prevRatings[norm];
    const eloDelta =
      typeof r.rating === "number" && typeof prevRating === "number"
        ? r.rating - prevRating
        : null;

    const prevRank = prevRanks[norm];
    const currRank = currentRanks[norm];
    const rankMove =
      typeof prevRank === "number" && typeof currRank === "number"
        ? prevRank - currRank
        : null;

    const weeklyBase = weeklyBaseline[norm];
    const weeklyDelta =
      typeof r.rating === "number" && typeof weeklyBase === "number"
        ? r.rating - weeklyBase
        : null;

    return {
      ...r,
      rankMoveText: formatRankMove(rankMove),
      eloDeltaText: formatEloDelta(eloDelta),
      weeklyDeltaText: formatWeeklyDelta(weeklyDelta),
    };
  });

  const nextRatings = {};
  const nextRanks = {};
  for (let i = 0; i < rowsBase.length; i++) {
    const norm = normalizeUsername(rowsBase[i].chessUsername);
    const rating = rowsBase[i].rating;

    if (norm) nextRanks[norm] = i + 1;
    if (norm && typeof rating === "number") nextRatings[norm] = rating;
  }

  const nextState = {
    ...state,
    channelId,
    messageId: msg.id,
    lastRatings: nextRatings,
    lastRanks: nextRanks,
  };

  if (opts.setWeeklyBaseline) {
    nextState.weeklyBaselineRatings = nextRatings;
    nextState.weeklyBaselineAt = new Date().toISOString();
  }

  await msg.edit({ content: "", embeds: [buildLeaderboardEmbed(rows)] });
  saveState(nextState);

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
  () =>
    refreshLeaderboardMessage(client, LEADERBOARD_CHANNEL_ID, {
      setWeeklyBaseline: true,
    }),
  { timezone: "America/Chicago" }
);

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setchess") {
    const username = interaction.options.getString("username", true).trim();
    const norm = normalizeUsername(username);

    if (!norm) {
      await interaction.reply({
        content: "Please provide a valid Chess.com username.",
        ephemeral: true,
      });
      return;
    }

    const players = loadPlayers();
    players[interaction.user.id] = {
      discordTag: interaction.user.tag,
      chessUsername: username,
    };
    savePlayers(players);

    await interaction.reply({
      content: `Saved: **${interaction.user.tag}** -> **${username}**`,
      ephemeral: true,
    });

    await refreshLeaderboardMessage(
      client,
      LEADERBOARD_CHANNEL_ID || interaction.channelId
    ).catch(() => {});
    return;
  }

  if (interaction.commandName === "mychess") {
    const players = loadPlayers();
    const entry = players[interaction.user.id];

    if (!entry?.chessUsername) {
      await interaction.reply({
        content: "You are not registered yet. Use `/setchess <username>`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Your saved Chess.com username is: **${entry.chessUsername}**`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "leaderboard") {
    if (!checkAndSetCooldown(interaction.user.id)) {
      await interaction.reply({
        content: "Leaderboard is refreshing. Try again shortly.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await refreshLeaderboardMessage(client, LEADERBOARD_CHANNEL_ID || interaction.channelId);
    await interaction.deleteReply();
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);