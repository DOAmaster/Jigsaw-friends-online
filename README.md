# Jigsaw Friends Online

**A cozy, cooperative jigsaw game for 1–8 players.** Start a room, share its code, and put a picture together with friends—one piece at a time.

Jigsaw Friends Online runs in the browser and is designed to deploy on Netlify. Players can join public rooms from the room browser, join by room code, or play solo in a locked room.

## Highlights

- Public room browser and six-character room codes
- Locked rooms for private groups or solo play
- Cooperative 48-piece puzzles with movable, unsnapped pieces
- Shared puzzle lineup with host-controlled selection
- JPG and PNG uploads, plus image-link suggestions for host review
- Star totals for completed puzzles
- Three temporary sample puzzles, ready to be replaced with final artwork

## Play

1. Choose **Start a room** and enter a player name and room name.
2. Pick a sample puzzle. Leave the room open for friends, or lock it for private/solo play.
3. Share the room code, or let friends find the room in **Open rooms**.
4. Drag pieces onto the board. A piece locks only when it lands in its matching position; other placements stay movable.
5. Finish the puzzle together. Players who were in the room when the puzzle started earn one star. At the finish screen, vote to replay or move on. The host can also select a puzzle from the lineup.

See [the gameplay guide](docs/gameplay.md) for the full rules, image suggestions, and level flow.

## Deploy on Netlify

The project uses a static frontend and one standard Netlify Function. Room state and uploaded pictures are stored in Netlify Blobs, which Netlify provisions for the deployed site. There is no always-on server or separate database to create.

1. Unzip `netlify-ready-game.zip` into a folder.
2. Sign in to Netlify and open its Drag and Drop publisher.
3. Drag the **project folder** into the publisher so Netlify can build the site and deploy its Function.

Do not deploy only the `public` folder: that would omit the multiplayer Function. See [architecture and deployment](docs/architecture-and-deployment.md) for details.

## Development

The site source is in `public/`, the Netlify Function is in `netlify/functions/game.ts`, and its shared helpers are in `src/`.

Requirements: Node.js 22 or newer and pnpm. From the project folder, install dependencies with `pnpm install`, then run the app locally with `pnpm dev` (Netlify CLI). The deployed site does not require a user-supplied API key or a manually provisioned database.

## Project documents

- [Gameplay guide](docs/gameplay.md)
- [Architecture and deployment](docs/architecture-and-deployment.md)
- [Credits and attribution](CREDITS.md)

## Credits

Credit and thanks: [DOA on itch.io](https://doamaster.itch.io/).

## License

No license is included yet. Add a license only after the project owner chooses the terms for the game code and any included artwork.
