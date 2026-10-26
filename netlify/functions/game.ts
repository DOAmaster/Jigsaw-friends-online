import { getStore } from '@netlify/blobs';
import { createGameHandler } from '../../src/game-service.mjs';

const handler = createGameHandler({
  rooms: getStore({ name: 'jigsaw-game-rooms', consistency: 'strong' }),
  images: getStore({ name: 'jigsaw-game-images', consistency: 'strong' })
});

export default handler;
