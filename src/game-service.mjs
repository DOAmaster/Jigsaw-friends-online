import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { samples } from './puzzles.mjs';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BODY_IMAGE_CHARS = 5_800_000;
const NEXT_PUZZLE_DELAY_MS = 15_000;
let roomStore;
let imageStore;
const id = () => randomBytes(8).toString('hex');
const roomCode = () => randomBytes(3).toString('hex').toUpperCase();
const newPlayerToken = () => randomBytes(32).toString('base64url');
const hashToken = (token) => createHash('sha256').update(String(token || '')).digest('hex');
function tokenMatches(token, storedHash) {
  const supplied = Buffer.from(hashToken(token));
  const stored = Buffer.from(String(storedHash || ''));
  return supplied.length === stored.length && timingSafeEqual(supplied, stored);
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ApiError(status, message);
}

function publicRoom(room) {
  const suggestions = (room.suggestions || []).map(({ id, playerId, playerName, name, status, image }) => ({
    id, playerId, playerName, name, status, image: status === 'pending' ? image : undefined
  }));
  return {
    code: room.code,
    roomName: room.roomName,
    locked: room.locked,
    adminId: room.adminId,
    phase: room.phase,
    image: room.image,
    imageName: room.imageName,
    level: room.level,
    puzzleId: room.puzzleId,
    currentQueueId: room.currentQueueId,
    nextLevelAt: room.nextLevelAt,
    nextPuzzleName: room.levelQueue?.[0]?.name || room.fallbackPuzzle?.name || null,
    serverNow: Date.now(),
    revision: room.revision,
    players: (room.players || []).map(({ id, name, total }) => ({ id, name, total })),
    pieces: room.pieces || [],
    suggestions,
    levelQueue: room.levelQueue || [],
    votes: room.votes || {},
    nextVotes: room.nextVotes || {}
  };
}

function makePieces() {
  return Array.from({ length: 48 }, (_, pieceId) => ({ id: pieceId, x: 50, y: 50, onBoard: false, placed: false }));
}

function defaultPuzzleFor(room) {
  const choices = samples.filter((sample) => sample.name !== room.imageName);
  const pool = choices.length ? choices : samples;
  return pool[Math.floor(Math.random() * pool.length)];
}

function startFreshLevel(room, image = room.image, name = room.imageName) {
  room.nextLevelAt = null;
  room.fallbackPuzzle = null;
  room.image = image;
  room.imageName = name;
  room.currentQueueId = null;
  room.phase = 'playing';
  room.level++;
  room.puzzleId = id();
  room.pieces = makePieces();
  room.startedPlayers = room.players.map((player) => player.id);
  room.votes = {};
  room.nextVotes = {};
}

function scheduleNextPuzzle(room) {
  room.nextLevelAt = Date.now() + NEXT_PUZZLE_DELAY_MS;
  room.fallbackPuzzle = defaultPuzzleFor(room);
}

function advancePuzzle(room) {
  if (room.phase !== 'complete') return false;
  const next = room.levelQueue.shift() || room.fallbackPuzzle || defaultPuzzleFor(room);
  room.image = next.image;
  room.imageName = next.name;
  const usedSuggestion = room.suggestions.find((suggestion) => suggestion.id === next.suggestionId);
  if (usedSuggestion) usedSuggestion.status = 'used';
  room.fallbackPuzzle = null;
  room.nextLevelAt = null;
  room.currentQueueId = null;
  room.phase = 'playing';
  room.level++;
  room.puzzleId = id();
  room.pieces = makePieces();
  room.startedPlayers = room.players.map((player) => player.id);
  room.votes = {};
  room.nextVotes = {};
  return true;
}

function maybeAdvance(room) {
  if (room.phase === 'complete' && room.nextLevelAt && room.nextLevelAt <= Date.now()) {
    return advancePuzzle(room);
  }
  return false;
}

async function withRoomLock(code, callback) {
  const key = `room:${code}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await roomStore.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    if (!current) fail(404, 'Room not found');
    const room = structuredClone(current.data);
    const response = await callback(room);
    room.revision = Number(room.revision || 0) + 1;
    const saved = await roomStore.setJSON(key, room, { onlyIfMatch: current.etag });
    if (saved.modified) return { room: publicRoom(room), ...response };
  }
  fail(409, 'The room changed at the same time. Please try again.');
}

async function readRoom(code) {
  const key = `room:${code}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await roomStore.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    if (!current) fail(404, 'Room not found');
    const room = current.data;
    if (!maybeAdvance(room)) return publicRoom(room);
    room.revision = Number(room.revision || 0) + 1;
    const saved = await roomStore.setJSON(key, room, { onlyIfMatch: current.etag });
    if (saved.modified) return publicRoom(room);
  }
  fail(409, 'The room changed at the same time. Please try again.');
}

async function createRoom(action) {
  const playerToken = newPlayerToken();
  const player = {
    id: String(action.playerId || id()),
    name: String(action.name || 'Puzzle maker').slice(0, 18),
    total: 0,
    tokenHash: hashToken(playerToken)
  };
  const sample = samples.find((item) => item.id === action.sampleId) || samples[0];
  const roomName = String(action.roomName || `${player.name}'s puzzle room`).trim().slice(0, 36) || `${player.name}'s puzzle room`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = roomCode();
    const room = {
      code, roomName, locked: !!action.locked, adminId: player.id, phase: 'lobby',
      image: sample.image, imageName: sample.name, level: 0, puzzleId: id(),
      currentQueueId: null, nextLevelAt: null, fallbackPuzzle: null, revision: 1,
      players: [player], pieces: [], suggestions: [], levelQueue: [], votes: {},
      nextVotes: {}, startedPlayers: []
    };
    const saved = await roomStore.setJSON(`room:${code}`, room, { onlyIfNew: true });
    if (saved.modified) return { room: publicRoom(room), playerId: player.id, playerToken };
  }
  fail(503, 'Could not reserve a room code. Please try again.');
}

function isImageReference(value) {
  return typeof value === 'string' && (
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) ||
    /^\/\.netlify\/functions\/game\?image=[a-f0-9]{16}$/.test(value)
  );
}

async function storeUpload(action) {
  if (!['setLobbyImage', 'suggest'].includes(action.type)) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(action.image || '');
  if (!match || action.image.length > MAX_BODY_IMAGE_CHARS) fail(400, 'Use a JPG or PNG under 4 MB');
  const contentType = match[1] === 'png' ? 'image/png' : 'image/jpeg';
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail(400, 'Use a JPG or PNG under 4 MB');
  const key = id();
  const stored = await imageStore.set(key, new Blob([bytes], { type: contentType }), {
    onlyIfNew: true,
    metadata: { contentType, uploadedAt: new Date().toISOString() }
  });
  action.image = `/.netlify/functions/game?image=${key}`;
  return key;
}

async function applyAction(action) {
  if (action.type === 'create') return createRoom(action);
  const code = String(action.code || '').toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) fail(404, 'Room not found');
  if (action.type === 'join') {
    return withRoomLock(code, async (room) => {
      let player = room.players.find((candidate) => candidate.id === action.playerId && tokenMatches(action.playerToken, candidate.tokenHash));
      if (!player) {
        if (room.locked) fail(403, 'This room is locked by its owner');
        if (room.players.length >= 8) fail(409, 'This room is full (8 players max)');
        const playerToken = newPlayerToken();
        player = { id: id(), name: String(action.name || 'Player').slice(0, 18), total: 0, tokenHash: hashToken(playerToken) };
        room.players.push(player);
        return { playerId: player.id, playerToken };
      }
      return { playerId: player.id, playerToken: action.playerToken };
    });
  }

  return withRoomLock(code, async (room) => {
    const player = room.players.find((candidate) => candidate.id === action.playerId);
    if (!player || !tokenMatches(action.playerToken, player.tokenHash)) fail(403, 'Join this room first');
    const isOwner = player.id === room.adminId;

    if (action.type === 'start') {
      if (!isOwner) fail(403, 'Only the room owner can start');
      if (room.phase !== 'lobby') fail(409, 'Return to the lobby before starting a puzzle');
      if (action.nextQueued) {
        const next = room.levelQueue.shift();
        if (!next) fail(409, 'There are no queued puzzles yet');
        room.image = next.image;
        room.imageName = next.name;
        const suggestion = room.suggestions.find((item) => item.id === next.suggestionId);
        if (suggestion) suggestion.status = 'used';
      } else if (room.currentQueueId) {
        const index = room.levelQueue.findIndex((item) => item.suggestionId === room.currentQueueId);
        if (index >= 0) {
          const [selected] = room.levelQueue.splice(index, 1);
          const suggestion = room.suggestions.find((item) => item.id === selected.suggestionId);
          if (suggestion) suggestion.status = 'used';
        }
      }
      room.currentQueueId = null;
      room.phase = 'playing';
      room.level++;
      room.puzzleId = id();
      room.pieces = makePieces();
      room.startedPlayers = room.players.map((item) => item.id);
      room.votes = {};
      room.nextVotes = {};
    } else if (action.type === 'setLobbyImage') {
      if (!isOwner) fail(403, 'Only the room owner can add a lobby picture');
      if (room.phase !== 'lobby') fail(409, 'A lobby picture can only be added before the puzzle starts');
      if (!isImageReference(action.image)) fail(400, 'Use a JPG or PNG under 4 MB');
      if (room.levelQueue.length >= 8) fail(409, 'The puzzle lineup is full (8 levels max)');
      const entry = { suggestionId: id(), name: String(action.name || 'Lobby picture').slice(0, 48), image: action.image, addedBy: player.name };
      room.levelQueue.push(entry);
      room.currentQueueId = entry.suggestionId;
      room.image = entry.image;
      room.imageName = entry.name;
      room.puzzleId = id();
    } else if (action.type === 'lock') {
      if (!isOwner) fail(403, 'Only the room owner can change the lock');
      room.locked = !!action.locked;
    } else if (action.type === 'piece') {
      if (room.phase !== 'playing') fail(409, 'Puzzle is not in progress');
      if (action.puzzleId !== room.puzzleId) fail(409, 'This puzzle has changed. Please move a piece from the current puzzle.');
      const tile = room.pieces.find((item) => item.id === action.pieceId);
      if (!tile) fail(404, 'Piece not found');
      const x = Number(action.x), y = Number(action.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) fail(400, 'Invalid piece position');
      tile.x = Math.max(0, Math.min(100, x));
      tile.y = Math.max(0, Math.min(100, y));
      tile.onBoard = !!action.onBoard;
      tile.placed = !!action.snap && tile.onBoard;
      if (tile.placed) {
        tile.x = (tile.id % 8 + 0.5) * 100 / 8;
        tile.y = (Math.floor(tile.id / 8) + 0.5) * 100 / 6;
      }
      if (room.pieces.every((item) => item.placed)) {
        room.phase = 'complete';
        for (const playerId of room.startedPlayers || []) {
          const startedPlayer = room.players.find((item) => item.id === playerId);
          if (startedPlayer) startedPlayer.total++;
        }
        scheduleNextPuzzle(room);
      }
    } else if (action.type === 'suggest') {
      if (!isImageReference(action.image)) fail(400, 'Use a JPG or PNG under 4 MB');
      if (room.suggestions.filter((item) => item.status === 'pending').length >= 12) fail(409, 'The owner has 12 pictures waiting to review. Please try again later.');
      room.suggestions.push({ id: id(), playerId: player.id, playerName: player.name, name: String(action.name || 'Untitled puzzle').slice(0, 40), image: action.image, status: 'pending' });
    } else if (action.type === 'review') {
      if (!isOwner) fail(403, 'Only the room owner can review suggestions');
      const suggestion = room.suggestions.find((item) => item.id === action.suggestionId);
      if (!suggestion) fail(404, 'Suggestion not found');
      if (suggestion.status !== 'pending') fail(409, 'This picture has already been reviewed');
      if (action.approved) {
        if (room.levelQueue.length >= 8) fail(409, 'The puzzle queue is full (8 levels max)');
        const queued = { suggestionId: suggestion.id, name: suggestion.name, image: suggestion.image };
        room.levelQueue.push(queued);
        suggestion.status = 'queued';
        suggestion.image = null;
        if (room.phase === 'lobby') {
          room.currentQueueId = queued.suggestionId;
          room.image = queued.image;
          room.imageName = queued.name;
          room.puzzleId = id();
        }
      } else {
        suggestion.status = 'declined';
        suggestion.image = null;
      }
    } else if (action.type === 'selectQueued') {
      if (!isOwner) fail(403, 'Only the room owner can change the active puzzle');
      const index = room.levelQueue.findIndex((item) => item.suggestionId === action.suggestionId);
      if (index < 0) fail(404, 'That puzzle is no longer in the lineup');
      if (room.phase === 'lobby') {
        const selected = room.levelQueue[index];
        room.currentQueueId = selected.suggestionId;
        room.image = selected.image;
        room.imageName = selected.name;
        room.puzzleId = id();
      } else if (room.phase === 'playing' || room.phase === 'complete') {
        const [selected] = room.levelQueue.splice(index, 1);
        const suggestion = room.suggestions.find((item) => item.id === selected.suggestionId);
        if (suggestion) suggestion.status = 'used';
        startFreshLevel(room, selected.image, selected.name);
      } else {
        fail(409, 'This room cannot change puzzles right now');
      }
    } else if (action.type === 'restartCurrent') {
      if (!isOwner) fail(403, 'Only the room owner can restart the active puzzle');
      if (room.phase !== 'playing' && room.phase !== 'complete') fail(409, 'There is no active puzzle to restart');
      startFreshLevel(room);
    } else if (action.type === 'vote') {
      if (room.phase !== 'complete') fail(409, 'The puzzle is not finished');
      room.votes[player.id] = action.choice === 'restart' ? 'restart' : 'next';
      if (Object.keys(room.votes).length >= room.players.length) {
        const restartVotes = Object.values(room.votes).filter((vote) => vote === 'restart').length;
        const nextVotes = Object.values(room.votes).filter((vote) => vote === 'next').length;
        let choice = restartVotes === nextVotes ? room.votes[room.adminId] : restartVotes > nextVotes ? 'restart' : 'next';
        if (!choice) choice = 'next';
        if (choice === 'restart') {
          room.nextLevelAt = null;
          room.fallbackPuzzle = null;
          room.phase = 'playing';
          room.currentQueueId = null;
          room.puzzleId = id();
          room.pieces = makePieces();
          room.startedPlayers = room.players.map((item) => item.id);
          room.votes = {};
          room.nextVotes = {};
        } else {
          advancePuzzle(room);
        }
      }
    } else if (action.type === 'changeImage') {
      if (!isOwner) fail(403, 'Only the room owner can change the image');
      if (room.phase !== 'complete') fail(409, 'Finish this puzzle first');
      const suggestion = room.suggestions.find((item) => item.id === action.suggestionId && item.status === 'approved');
      if (!suggestion) fail(404, 'Approved suggestion not found');
      room.nextImageId = suggestion.id;
    } else {
      fail(400, 'Unknown action');
    }
    return {};
  });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createGameHandler({ rooms, images }) {
  roomStore = rooms;
  imageStore = images;
  return async function handler(request) {
    try {
      const url = new URL(request.url);
      const imageKey = url.searchParams.get('image');
      if (request.method === 'GET' && imageKey) {
        if (!/^[a-f0-9]{16}$/.test(imageKey)) fail(404, 'Image not found');
        const result = await imageStore.getWithMetadata(imageKey, { consistency: 'strong', type: 'blob' });
        if (!result) fail(404, 'Image not found');
        const contentType = result.metadata?.contentType || 'image/jpeg';
        return new Response(result.data, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
      }
      const actionName = url.searchParams.get('action');
      if (request.method === 'GET' && actionName === 'samples') return json(samples.map(({ id, name, image, swatch }) => ({ id, name, image, swatch })));
      if (request.method === 'GET' && actionName === 'rooms') {
        const listing = await roomStore.list({ prefix: 'room:' });
        const roomsList = await Promise.all(listing.blobs.map(async ({ key }) => {
          const entry = await roomStore.getWithMetadata(key, { consistency: 'strong', type: 'json' });
          return entry?.data;
        }));
        return json(roomsList.filter((room) => room && !room.locked && room.phase !== 'complete').map((room) => ({ code: room.code, roomName: room.roomName, players: room.players.length, phase: room.phase })));
      }
      if (request.method === 'GET' && actionName === 'room') return json(await readRoom(String(url.searchParams.get('code') || '').toUpperCase()));
      if (request.method === 'POST') {
        let action;
        try { action = await request.json(); } catch { fail(400, 'Invalid request'); }
        if (!action || typeof action !== 'object' || Array.isArray(action)) fail(400, 'Invalid request');
        const uploadedKey = await storeUpload(action);
        try { return json(await applyAction(action)); }
        catch (error) { if (uploadedKey) await imageStore.delete(uploadedKey).catch(() => {}); throw error; }
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('Jigsaw API error:', error);
      return json({ error: 'The room service had a problem. Please try again.' }, 500);
    }
  };
}

